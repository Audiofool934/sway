import asyncio
import shutil
from dataclasses import asdict

import numpy as np
import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from sway import score, scored
from sway.app import app
from sway.score import State
from sway.scored import FADE, LATENT, RATE, TAIL, Settings, Take, join
from sway.steering import SAMPLE_RATE, Move, Spine

FRAME_SAMPLES = 1920
SAMPLED, REDRAWN = 0.25, 0.5  # What the fakes play.


class FakeSampler:
    """Plays every sample at SAMPLED, and keeps what it was asked."""

    def __init__(self):
        self.requests = []

    async def play(self, frames, keep, notes):
        self.requests.append({"frames": frames, "keep": keep, "notes": notes})
        return np.full((2, frames - keep), SAMPLED, np.float32)


class FakeSA3:
    """Redraws a window to REDRAWN from `keep` on, once `release` is set."""

    def __init__(self):
        self.windows = []
        self.release = None

    async def window(self, audio, keep, level, steps, seed):
        self.windows.append({"audio": audio.copy(), "keep": keep, "level": level, "steps": steps})
        if self.release is not None:
            await self.release.wait()
        out = audio.copy()
        out[:, keep * LATENT :] = REDRAWN
        return out, {"encode": 0.1, "sample": 0.5, "decode": 0.1}


def take():
    return Take(Settings(), 7, FakeSampler(), FakeSA3())


def drain(take, seconds):
    return np.concatenate([take.frame(False) for _ in range(round(seconds / 0.04))])


def test_settings_come_from_the_stream_s_address():
    assert Settings.from_query({}) == Settings("medium", 4, 2.4, 0.3)
    chosen = Settings.from_query({"model": "small", "steps": "8", "context": "4.8", "noise": "0.5"})
    assert chosen == Settings("small", 8, 4.8, 0.5)
    assert (chosen.kept, chosen.length) == (52, 84)
    wrong = {"model": "large", "steps": "99", "context": "x", "noise": "0"}
    assert Settings.from_query(wrong) == Settings()
    assert (Settings().kept, Settings().length) == (26, 58)


def test_the_resampler_keeps_a_tone_whatever_pieces_it_comes_in():
    seconds = np.arange(RATE * 2) / RATE
    tone = np.stack([np.sin(2 * np.pi * 1000 * seconds)] * 2).astype(np.float32) * 0.5
    whole = scored.Resampler()(tone)
    assert whole.shape == (2, SAMPLE_RATE * 2)
    delay = (scored.Resampler.UP * scored.Resampler.TAPS - 1) / (2 * scored.Resampler.UP) / RATE
    expected = 0.5 * np.sin(2 * np.pi * 1000 * (np.arange(whole.shape[1]) / SAMPLE_RATE - delay))
    error = whole[0, 4800:-100] - expected[4800:-100]
    assert np.sqrt(np.mean(error**2)) < 1e-4
    resampler, pieces, at = scored.Resampler(), [], 0
    for size in np.random.default_rng(3).integers(1, 20_000, 40):
        pieces.append(resampler(tone[:, at : at + size]))
        at += size
    pieces.append(resampler(tone[:, at:]))
    assert np.allclose(np.concatenate(pieces, axis=1), whole, atol=1e-6)


def test_the_first_window_redraws_the_bars_that_fit_from_the_hands_as_they_are():
    t = take()
    t.move = Move(height=0.9, activity=0.5, spread=0.1)
    assert asyncio.run(t.begin()) == 2
    (request,) = t.sampler.requests
    assert (request["frames"], request["keep"]) == (58 * LATENT, 0)
    bars = {int(note[1] / score.BAR + 1e-6) for note in request["notes"]}
    assert bars == {0, 1, 2}  # Bar 2 is the guess after them.
    assert t.states == {0: State("medium", "high", "chord"), 1: State("medium", "high", "chord")}
    (window,) = t.sa3.windows
    assert window["keep"] == 0 and (window["level"], window["steps"]) == (0.3, 4)
    assert t.due == 2 and t.lead == pytest.approx(t.recent[0] + scored.MARGIN + scored.WAKE)
    # All but the last 40 ms, which the next bar crossfades into, goes to the page.
    assert t.queued == pytest.approx((join(2) - FADE) * SAMPLE_RATE / RATE, abs=40)


def test_each_bar_is_decided_when_due_and_drawn_after_the_music_already_played():
    t = take()
    asyncio.run(t.begin())
    drain(t, 3.0)
    t.move = Move(height=0.1, activity=0.9, spread=0.9)
    asyncio.run(t.play(2))
    request = t.sampler.requests[-1]
    stop = join(3) // LATENT + TAIL
    assert request["frames"] == stop * LATENT - score.BAR * RATE  # From bar 1's downbeat.
    assert request["keep"] == join(2) - FADE - round(score.BAR * RATE)
    bars = {}
    for _, at, _, _, velocity in request["notes"]:
        bars.setdefault(int(at / score.BAR + 1e-6) + 1, set()).add(velocity)
    # Bar 1 as it was decided, bar 2 as the hands are now, and bar 3 guessed the same.
    assert set(bars) == {1, 2, 3} and bars[2] == bars[3] != bars[1]
    window = t.sa3.windows[-1]
    keep = join(2) // LATENT - (stop - 58)
    assert window["keep"] == keep and window["audio"].shape == (2, 58 * LATENT)
    assert np.all(window["audio"][:, : keep * LATENT] == REDRAWN)  # The music played.
    assert np.all(window["audio"][:, keep * LATENT :] == SAMPLED)  # The bar and the guess.
    assert t.due == 3 and t.late == 0 and t.decided["spareMs"] > 0
    assert t.states[2] == State("fast", "low", "scale")
    assert np.all(t.tape[:, -(join(3) - join(2)) :] == REDRAWN)


def test_a_bar_that_sa3_has_not_finished_when_it_is_due_is_played_by_the_sampler():
    async def late():
        t = take()
        await t.begin()
        drain(t, 3.5)
        t.sa3.release = asyncio.Event()
        playing = asyncio.create_task(t.play(2))
        await asyncio.sleep(0)
        assert 2 in t.sampled
        audio = drain(t, 1.6)  # Past the end of bar 1.
        assert t.late == 1 and t.due == 3 and t.gaps == 0
        assert np.all(t.tape[:, -(join(3) - join(2) - FADE) :] == SAMPLED)
        assert np.abs(np.diff(audio[:, 0])).max() < 0.01  # Crossfaded, not cut.
        t.sa3.release.set()
        await playing
        assert t.due == 3 and t.decided["spareMs"] is None  # SA3's bar was dropped.
        drain(t, 2.4)  # Nothing is decided after it here, so the page gets silence.
        assert t.gaps > 0
        assert not t.frame(False).any()

    asyncio.run(late())


def test_stillness_lowers_the_volume_at_once_and_movement_restores_it():
    t = take()
    asyncio.run(t.begin())
    for _ in range(50):
        quiet = t.frame(True)
    assert t.gain == pytest.approx(Spine.rest_level, abs=0.02)
    assert np.abs(quiet).max() == pytest.approx(REDRAWN * t.gain, rel=0.05)
    t.frame(False)
    t.frame(False)
    assert t.gain > 0.95


def test_the_page_hears_where_the_bar_is_and_how_the_bars_go():
    t = take()
    asyncio.run(t.begin())
    drain(t, 3.84)  # Bar 1, beat 2.4.
    stats = t.describe()
    assert (stats["bar"], stats["chord"], stats["beat"]) == (1, "F", 2.4)
    assert stats["scoreTexture"] == "still" and stats["theme"] == "away"
    assert stats["late"] == 0 and stats["leadMs"] > 0


class FakeRenderer:
    def __init__(self, ready=True):
        self.installed = ready
        self.settings = []
        self.stopped = 0

    def ready(self):
        return self.installed

    async def start(self, seed, settings=None):
        self.settings.append(settings)
        return {"variant": "score", "settings": asdict(settings)}

    def render(self, control):
        audio = np.full((FRAME_SAMPLES, 2), control.activity, np.float32)
        return audio.astype("<f4").tobytes(), {"seq": control.seq, "frame": 1}

    def idle(self, until):
        pass

    def stop(self):
        self.stopped += 1

    async def aclose(self):
        pass


@pytest.fixture
def client(monkeypatch):
    service = scored.ScoreService(FakeRenderer())
    monkeypatch.setattr(scored, "SERVICE", service)
    with TestClient(app) as client:
        yield client, service


def test_the_score_stream_plays_with_the_settings_in_its_address(client):
    browser, service = client
    with browser.websocket_connect("/api/score/stream?variant=score&steps=8") as ws:
        assert ws.receive_json()["type"] == "loading"
        ready = ws.receive_json()
        assert ready["type"] == "ready" and ready["settings"]["steps"] == 8
        ws.send_json({"seq": 1, "height": 0.7, "activity": 0.6, "spread": 0.5})
        for _ in range(3):
            assert len(ws.receive_bytes()) == FRAME_SAMPLES * 2 * 4
        with pytest.raises(WebSocketDisconnect) as rejected:
            with browser.websocket_connect("/api/score/stream"):
                pass
        assert rejected.value.code == 1008
    assert service.renderer.settings == [Settings(steps=8)]
    assert service.renderer.stopped == 1 and service.owner is None


def test_without_sa3_the_score_stream_says_what_is_missing(monkeypatch):
    monkeypatch.setattr(scored, "SERVICE", scored.ScoreService(FakeRenderer(ready=False)))
    with TestClient(app) as browser:
        with pytest.raises(WebSocketDisconnect) as refused:
            with browser.websocket_connect("/api/score/stream"):
                pass
    assert refused.value.code == 1008 and "Stable Audio 3" in refused.value.reason


@pytest.mark.skipif(
    not (scored.BANK.exists() and shutil.which("swiftc")), reason="needs macOS's sampler"
)
def test_the_sampler_plays_each_request_from_silence():
    async def play():
        sampler = scored.Sampler()
        await sampler.open()
        try:
            notes = [[score.PIANO, 0.0, 0.5, 60, 100], [score.BASS, 0.1, 0.4, 33, 90]]
            first = await sampler.play(RATE, RATE // 4, notes)
            again = await sampler.play(RATE, RATE // 4, notes)
            silent = await sampler.play(RATE // 2, 0, [])
        finally:
            await sampler.close()
        return first, again, silent

    first, again, silent = asyncio.run(play())
    assert first.shape == (2, RATE - RATE // 4)
    assert np.sqrt(np.mean(first**2)) > 1e-3
    # The same score plays at the same level each time, though not sample for sample.
    level = np.sqrt(np.mean(first**2))
    assert np.sqrt(np.mean(again**2)) == pytest.approx(level, rel=0.05)
    assert np.sqrt(np.mean((first - again) ** 2)) < 0.1 * level
    assert np.abs(silent).max() < 1e-3  # Nothing rings on from the request before.
