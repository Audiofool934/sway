import numpy as np
import pytest
from fastapi.testclient import TestClient

from sway import harmony
from sway.app import app
from sway.schema import HarmonyNote

A_MINOR = {9, 11, 0, 2, 4, 5, 7}


def held(voicing, carried=()):
    """A chord held for a 4/4 bar; notes in `carried` continue from the last bar."""
    return [HarmonyNote(pitch=pitch, start=0, length=4, tie=pitch in carried) for pitch in voicing]


AM = {"notes": held([57, 60, 64, 67]), "tones": [9, 0, 4]}
F = {"notes": held([53, 57, 60, 64], carried=(57, 60, 64)), "tones": [5, 9, 0]}


def bar_request(**changes):
    return {
        "bar": 3,
        "notes": [note.model_dump() for note in AM["notes"]],
        "tones": AM["tones"],
        "palette": "strings",
        "stream": 7,
        "tempo": 100,
        "beats_per_bar": 4,
        **changes,
    }


def scale_share(audio, scale=A_MINOR):
    """Share of 60 Hz to 2 kHz spectral energy on the pitch classes of `scale`."""
    mono = audio.astype(np.float64).mean(axis=1)
    spectrum = np.abs(np.fft.rfft(mono * np.hanning(len(mono)))) ** 2
    freqs = np.fft.rfftfreq(len(mono), 1 / harmony.SAMPLE_RATE)
    band = (freqs > 60) & (freqs < 2000)
    classes = np.round(69 + 12 * np.log2(freqs[band] / 440)).astype(int) % 12
    chroma = np.bincount(classes, weights=spectrum[band], minlength=12)
    return sum(chroma[pc] for pc in scale) / chroma.sum()


def test_bars_are_whole_model_frames():
    assert harmony.frames_per_bar(100, 4) == 60  # 2.4 s
    assert harmony.frames_per_bar(120, 4) == 50
    with pytest.raises(ValueError):
        harmony.frames_per_bar(90, 4)  # 2.67 s is not a whole number of 40 ms frames


def test_conditioning_silences_everything_outside_the_chord():
    tokens = harmony.bar_tokens(AM["notes"], AM["tones"], 60, 15)
    assert tokens.shape == (60, 128)
    allowed = {9, 0, 4, 7}  # The triad plus the voicing's G.
    for pitch in range(128):
        if pitch % 12 not in allowed:
            assert (tokens[:, pitch] == harmony.SILENT).all(), pitch
    # The voicing is struck, then held for the bar; other octaves stay free.
    for pitch in (57, 60, 64, 67):
        assert tokens[0, pitch] == harmony.STRUCK
        assert (tokens[1:, pitch] == harmony.HELD).all()
    assert (tokens[:, 69] == harmony.FREE).all()


def test_tied_notes_carry_over_a_chord_change():
    tokens = harmony.bar_tokens(F["notes"], F["tones"], 60, 15)
    assert tokens[0, 53] == harmony.STRUCK  # New in F.
    for pitch in (57, 60, 64):  # Tied over from the Am bar.
        assert tokens[0, pitch] == harmony.HELD
    assert (tokens[:, 67] == harmony.SILENT).all()  # Am's G has no place in F.


def test_a_line_is_articulated_as_written():
    # A two-note line over Am: C4 on beat 2 for half a beat, then E4 held from beat 3.
    line = [
        HarmonyNote(pitch=48, start=1, length=0.5),
        HarmonyNote(pitch=52, start=2, length=2),
    ]
    tokens = harmony.bar_tokens(line, [9, 0, 4], 60, 15)
    assert tokens[15, 48] == harmony.STRUCK
    assert (tokens[16:22, 48] == harmony.HELD).all()  # 7.5 frames, rounded to 8.
    assert (tokens[:15, 48] == harmony.SILENT).all() and (tokens[23:, 48] == harmony.SILENT).all()
    assert tokens[30, 52] == harmony.STRUCK and (tokens[31:, 52] == harmony.HELD).all()
    assert (tokens[:, 36] == harmony.FREE).all()  # C in another octave stays free.


def test_pcm_is_clipped_interleaved_little_endian():
    audio = np.array([[0.5, -2.0], [2.0, 0.0]], dtype=np.float32)
    samples = np.frombuffer(harmony.to_pcm(audio), dtype="<i2")
    assert samples.tolist() == [16383, -32767, 32767, 0]


class FakeStyle:
    def __init__(self):
        self.prompts = []

    def embed(self, text):
        self.prompts.append(text)
        return np.full(4, len(self.prompts), dtype=np.float32)

    def tokens(self, embedding):
        return np.zeros(12, dtype=np.int32)


class FakeEngine:
    def __init__(self):
        self.style = FakeStyle()
        self.rows = []
        self.seeds = []
        self.target = self.current = None

    def apply_style(self, embedding):
        self.target = embedding

    def generate(self, notes, drumless=False):
        assert drumless  # The band's synthesized drums keep the beat.
        self.rows.append(notes.copy())
        return np.full((harmony.FRAME_SAMPLES, 2), 0.25, dtype=np.float32)

    def reset(self, seed):
        self.seeds.append(seed)
        self.rows.clear()


def test_renderer_continues_one_stream_bar_after_bar():
    engine = FakeEngine()
    renderer = harmony.HarmonyRenderer(lambda: engine)
    renderer.start("choir", seed=42)
    assert engine.seeds == [42]
    assert engine.style.prompts == [harmony.PALETTES["choir"]]
    assert (engine.current == engine.target).all()  # A new piece starts in its palette.
    first = renderer.render(AM["notes"], AM["tones"], "choir", 60, 4)
    assert first.shape == (60 * harmony.FRAME_SAMPLES, 2)
    renderer.render(F["notes"], F["tones"], "choir", 60, 4)
    assert len(engine.rows) == 120
    assert engine.rows[60][53] == harmony.STRUCK
    assert engine.rows[60][57] == harmony.HELD  # Carried over from the Am bar.
    # A palette change mid-piece blends toward the new style instead of jumping.
    renderer.render(AM["notes"], AM["tones"], "piano", 60, 4)
    assert engine.style.prompts[-1] == harmony.PALETTES["piano"]
    assert not (engine.current == engine.target).all()
    assert renderer.status()["loaded"] and renderer.status()["frame_ms"] is not None


class FakeRenderer:
    def __init__(self, fail=False):
        self.fail = fail
        self.calls = []
        self.stream = 7

    def start(self, palette, seed):
        self.calls.append(("start", palette, seed))
        return {"palette": palette, "ms": 5}

    def render(self, notes, tones, palette, frames, beats_per_bar):
        if self.fail:
            raise RuntimeError("model failure with private detail")
        pitches = [note.pitch for note in notes]
        self.calls.append(("render", pitches, tones, palette, frames, beats_per_bar))
        return np.zeros((frames * harmony.FRAME_SAMPLES, 2), dtype=np.float32)

    def status(self):
        return {"loaded": True, "palette": "strings", "frame_ms": 19.5}


@pytest.fixture
def client():
    with TestClient(app) as client:
        yield client


@pytest.fixture
def renderer(monkeypatch):
    fake = FakeRenderer()
    monkeypatch.setattr(harmony, "RENDERER", fake)
    monkeypatch.setattr(harmony, "assets_ready", lambda *args: True)
    return fake


def test_the_page_can_start_a_stream_and_render_bars(client, renderer):
    status = client.get("/api/harmony/status").json()
    assert status["available"] and status["palettes"] == ["strings", "piano", "choir"]
    assert client.post("/api/harmony/start", json={"palette": "piano", "seed": 7}).json() == {
        "palette": "piano",
        "ms": 5,
    }
    response = client.post("/api/harmony/bar", json=bar_request())
    assert response.status_code == 200
    assert len(response.content) == 60 * harmony.FRAME_SAMPLES * 2 * 2
    assert response.headers["x-sample-rate"] == "48000"
    assert response.headers["x-channels"] == "2"
    assert response.headers["x-bar"] == "3"
    assert int(response.headers["x-render-ms"]) >= 0
    assert renderer.calls == [
        ("start", "piano", 7),
        ("render", [57, 60, 64, 67], AM["tones"], "strings", 60, 4),
    ]


@pytest.mark.parametrize(
    "changes",
    [
        {"notes": [{"pitch": 200, "start": 0, "length": 4}]},
        {"notes": [{"pitch": 60, "start": 3, "length": 2}]},  # Ends past the bar.
        {"notes": []},
        {"tones": [12]},
        {"stream": -1},
        {"palette": "banjo"},
        {"tempo": 90},  # Bars would not be whole model frames.
        {"extra": True},
    ],
)
def test_bar_requests_are_validated(client, renderer, changes):
    assert client.post("/api/harmony/bar", json=bar_request(**changes)).status_code == 422
    assert renderer.calls == []


def test_bars_for_a_replaced_piece_are_skipped(client, renderer):
    # A new piece starts while bars of the previous one are still queued.
    client.post("/api/harmony/start", json={"palette": "strings", "seed": 9})
    response = client.post("/api/harmony/bar", json=bar_request(stream=7))
    assert response.status_code == 409
    assert [call[0] for call in renderer.calls] == ["start"]
    assert client.post("/api/harmony/bar", json=bar_request(stream=9)).status_code == 200


def test_without_mrt2_the_page_is_told_how_to_install_it(client, monkeypatch):
    monkeypatch.setattr(harmony, "assets_ready", lambda *args: False)
    assert client.get("/api/harmony/status").json()["available"] is False
    response = client.post("/api/harmony/bar", json=bar_request())
    assert response.status_code == 503
    assert "sway setup" in response.json()["detail"]
    assert (
        client.post("/api/harmony/start", json={"palette": "strings", "seed": 1}).status_code == 503
    )


def test_render_failures_do_not_leak_details(client, monkeypatch):
    monkeypatch.setattr(harmony, "RENDERER", FakeRenderer(fail=True))
    monkeypatch.setattr(harmony, "assets_ready", lambda *args: True)
    response = client.post("/api/harmony/bar", json=bar_request())
    assert response.status_code == 500
    assert "private" not in response.text


def test_harmony_endpoints_are_local_only(client, renderer):
    response = client.post(
        "/api/harmony/bar", json=bar_request(), headers={"Origin": "https://elsewhere.example"}
    )
    assert response.status_code == 403
    assert renderer.calls == []


@pytest.mark.skipif(not harmony.assets_ready(), reason="MRT2 is not installed")
def test_mrt2_plays_the_chords_it_is_given_in_key():
    renderer = harmony.HarmonyRenderer()
    renderer.start("strings", seed=11)
    frames = harmony.frames_per_bar(100, 4)
    # The second bar adds a two-note answering line under the F chord.
    line = [HarmonyNote(pitch=48, start=1, length=1), HarmonyNote(pitch=45, start=2.5, length=1.5)]
    bars = [
        renderer.render(AM["notes"], AM["tones"], "strings", frames, 4),
        renderer.render(F["notes"] + line, F["tones"], "strings", frames, 4),
    ]
    for audio in bars:
        assert audio.shape == (frames * harmony.FRAME_SAMPLES, 2)
        assert np.isfinite(audio).all() and np.abs(audio).max() > 0.005
        # Skip the first 200 ms, where the previous chord can still ring.
        assert scale_share(audio[9600:]) > 0.95
