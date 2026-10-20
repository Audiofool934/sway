import asyncio
import threading

import numpy as np
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from starlette.websockets import WebSocketDisconnect

from sway import steered
from sway.app import app
from sway.steering import A_MINOR, A_MINOR_TRIAD, FREE

FRAME_SAMPLES = 1920


class FakeStyle:
    def __init__(self):
        self.threads = {}  # The thread that embedded each text.

    def embed(self, text):
        self.threads[text] = threading.current_thread().name
        return np.random.default_rng(abs(hash(text)) % 2**32).standard_normal(8)

    def tokens(self, embedding):
        return np.zeros(12, dtype=np.int32)


class FakeEngine:
    def __init__(self):
        self.style = FakeStyle()
        self.target = self.current = None
        self.rows = []
        self.seeds = []
        self.idled = []

    def reset(self, seed):
        self.seeds.append(seed)
        self.rows.clear()

    def apply_style(self, embedding):
        self.target = embedding

    def keep_busy(self, until):
        self.idled.append(until)

    def generate(self, notes, drumless=False, note_guidance=1.0):
        assert drumless
        self.rows.append(notes.copy())
        return np.full((FRAME_SAMPLES, 2), 0.1, dtype=np.float32)


def classes(row):
    return {pitch % 12 for pitch in np.flatnonzero(row == FREE)}


def test_the_free_variant_follows_the_hands_at_once_and_fades():
    engine = FakeEngine()
    renderer = steered.SteeredRenderer(lambda: engine)
    assert renderer.start(17, variant="free")["variant"] == "free"
    narrow = steered.Control(seq=1, height=0.5, activity=0.6, spread=0.1)
    audio, stats = renderer.render(narrow)
    assert len(audio) == FRAME_SAMPLES * 2 * 4
    assert classes(engine.rows[-1]) == A_MINOR_TRIAD
    assert stats["pitchClasses"] == sorted(A_MINOR_TRIAD)
    renderer.render(narrow.model_copy(update={"spread": 0.9}))
    assert classes(engine.rows[-1]) == A_MINOR
    for _ in range(30):
        renderer.render(narrow.model_copy(update={"height": 1.0, "activity": 1.0}))
    assert renderer.instrument.weights[3] > 0.95  # The high, lively corner.
    for _ in range(8):  # 0.32 s, four times the fade's time constant.
        audio, stats = renderer.render(narrow.model_copy(update={"activity": 0.0}))
    assert not np.any(engine.rows[-1] == FREE)
    assert stats["pitchClasses"] == [] and stats["gain"] < 0.05
    assert np.abs(np.frombuffer(audio, dtype="<f4")).max() < 0.01
    renderer.start(18, variant="free")
    assert engine.seeds[-1] == 18 and renderer.frames == 0
    assert renderer.instrument.gain == 1.0


def test_the_spine_reports_its_chord_and_beat():
    engine = FakeEngine()
    renderer = steered.SteeredRenderer(lambda: engine)
    assert renderer.start(17, variant="spine")["variant"] == "spine"
    playing = steered.Control(seq=1, activity=0.6, spread=0.1)
    _, stats = renderer.render(playing)
    assert (stats["chord"], stats["bar"], stats["chords"]) == ("Am", 0, ["Am", "F", "C", "G"])
    assert classes(engine.rows[-1]) == A_MINOR_TRIAD
    still = playing.model_copy(update={"activity": 0.0})
    for _ in range(29):
        renderer.render(still)
    assert classes(engine.rows[-1]) == {9, 0, 4}  # Stillness waits for the next chord.
    _, stats = renderer.render(still)  # F is told 1.2 s before its bar line.
    assert classes(engine.rows[-1]) == {5, 0}  # F's root and fifth.
    assert stats["pitchClasses"] == [0, 5] and stats["gain"] > 0.3  # Thinned, not silent.
    assert stats["chord"] == "Am"  # Am is still the chord being heard.
    for _ in range(29):  # To frame 60, F's bar line.
        _, stats = renderer.render(still)
    assert (stats["chord"], stats["bar"], stats["beat"]) == ("F", 1, 0)


@pytest.mark.parametrize(
    "change", [{"height": 2}, {"activity": float("nan")}, {"spread": -1}, {"pitch": 60}]
)
def test_unbounded_or_unrelated_controls_are_rejected(change):
    with pytest.raises(ValidationError):
        steered.Control(**change)


def test_a_silent_controller_is_released_into_stillness():
    service = steered.SteeredService(steered.SteeredRenderer(FakeEngine), arranger=False)
    held = steered.Control(seq=3, height=0.8, activity=0.7, spread=0.4)
    released = service.release(held)
    assert released.activity == 0
    assert (released.height, released.spread, released.seq) == (0.8, 0.4, 3)


@pytest.fixture
def client(monkeypatch):
    service = steered.SteeredService(steered.SteeredRenderer(FakeEngine), arranger=False)
    monkeypatch.setattr(steered, "SERVICE", service)
    monkeypatch.setattr(steered, "assets_ready", lambda: True)
    with TestClient(app) as client:
        yield client, service


def test_browser_stream_has_audio_rejects_second_window_and_releases_on_disconnect(client):
    browser, service = client
    with browser.websocket_connect("/api/steered/stream") as ws:
        assert ws.receive_json()["type"] == "loading"
        assert ws.receive_json()["type"] == "ready"
        ws.send_json({"seq": 1, "height": 0.7, "activity": 0.6, "spread": 0.5})
        for _ in range(3):
            assert len(ws.receive_bytes()) == FRAME_SAMPLES * 2 * 4
        # Between frames, the model thread keeps the GPU busy until just before the next.
        assert service.renderer.engine.idled
        with pytest.raises(WebSocketDisconnect) as rejected:
            with browser.websocket_connect("/api/steered/stream"):
                pass
        assert rejected.value.code == 1008
    assert service.owner is None


def test_the_stream_s_address_chooses_the_variant(client):
    browser, _ = client
    for query, variant in (
        ("", "film"),
        ("?variant=spine", "spine"),
        ("?variant=free", "free"),
        ("?variant=theme", "theme"),
        ("?variant=nope", "film"),
    ):
        with browser.websocket_connect("/api/steered/stream" + query) as ws:
            assert ws.receive_json()["type"] == "loading"
            assert ws.receive_json()["variant"] == variant


def test_cross_origin_websocket_is_rejected_before_loading(client):
    browser, service = client
    with pytest.raises(WebSocketDisconnect):
        with browser.websocket_connect(
            "/api/steered/stream", headers={"origin": "https://elsewhere.test"}
        ):
            pass
    assert service.renderer.engine is None


def test_every_model_user_runs_on_the_one_model_thread():
    # MLX cannot run MRT2 on a second thread once one thread has run it.
    import asyncio
    import threading

    from sway import app as app_module
    from sway import harmony, theremin
    from sway.music import MODEL_THREAD

    async def run():
        here = threading.current_thread
        return {
            await steered.SteeredService().call(here),
            await theremin.ThereminService().call(here),
            await app_module.on_harmony_thread(here),
        }

    assert len(asyncio.run(run())) == 1
    assert harmony.EXECUTOR is MODEL_THREAD


def test_the_conductor_s_controls_reach_the_film_score():
    engine = FakeEngine()
    renderer = steered.SteeredRenderer(lambda: engine)
    assert renderer.start(17)["variant"] == "film"
    conducting = steered.Control(
        seq=1, dynamics=1, energy=1, voice=1, forward=1, articulation=1, hush=False
    )
    for _ in range(40):
        _, stats = renderer.render(conducting)
    assert renderer.instrument.weights[15] > 0.99  # Cellos and basses, driving, short.
    assert stats["voices"] == ["Violins", "Brass", "Cellos and basses"]
    assert stats["gain"] == 1
    _, stats = renderer.render(conducting.model_copy(update={"cue": 1}))
    assert stats["landing"] == 34 and stats["section"] == "intro"  # Lands on frame 75.
    assert stats["world"] == "Film score" and stats["chords"] == ["Dm", "Bb", "F", "C"]
    for _ in range(34):
        _, stats = renderer.render(conducting.model_copy(update={"cue": 1}))
    assert stats["section"] == "build" and stats["landing"] is None
    for _ in range(10):  # A hush thins the music at once.
        _, stats = renderer.render(conducting.model_copy(update={"cue": 1, "hush": True}))
    assert stats["gain"] < 0.6


def test_a_silent_conductor_is_released_into_a_hush():
    service = steered.SteeredService(steered.SteeredRenderer(FakeEngine), arranger=False)
    conducting = steered.Control(seq=3, dynamics=0.8, energy=0.7, hush=False)
    released = service.release(conducting)
    assert released.hush and released.dynamics == 0.8


class FakeArranger:
    def __init__(self, plans):
        self.plans = plans
        self.summaries = []

    async def plan(self, summary):
        self.summaries.append(summary)
        return self.plans

    async def aclose(self):
        pass


def test_the_composer_s_plans_reach_the_piece():
    from sway.arranger import world_plan
    from sway.world import FILM_SCORE

    plans = (
        world_plan(FILM_SCORE, "build", ("Dm", "Gm", "Bb", "C"), "Rising", "qwen"),
        world_plan(FILM_SCORE, "peak", ("Bb", "F", "C", "Dm"), "All in", "qwen"),
    )
    fake = FakeArranger(plans)
    service = steered.SteeredService(steered.SteeredRenderer(FakeEngine), arranger=fake)

    async def run():
        service.renderer.start(5)
        service.frame_done({})
        await asyncio.gather(*service.tasks)
        service.frame_done({})  # Asked once a phrase, not once a frame.

    asyncio.run(run())
    piece = service.renderer.instrument
    assert len(fake.summaries) == 1 and fake.summaries[0].section == "intro"
    assert piece.pending == (0, *plans)


def test_the_theme_variant_reports_where_the_theme_is():
    engine = FakeEngine()
    renderer = steered.SteeredRenderer(lambda: engine)
    assert renderer.start(17, variant="theme")["variant"] == "theme"
    _, stats = renderer.render(steered.Control(seq=1, activity=0.6))
    assert (stats["theme"], stats["themeIn"], stats["chord"]) == ("away", 4, "Am")
