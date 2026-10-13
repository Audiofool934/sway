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
    def embed(self, text):
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


def test_the_hands_reach_the_style_the_harmony_and_the_fade():
    engine = FakeEngine()
    renderer = steered.SteeredRenderer(lambda: engine)
    renderer.start(17)
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
    renderer.start(18)
    assert engine.seeds[-1] == 18 and renderer.frames == 0
    assert renderer.instrument.gain == 1.0


@pytest.mark.parametrize(
    "change", [{"height": 2}, {"activity": float("nan")}, {"spread": -1}, {"pitch": 60}]
)
def test_unbounded_or_unrelated_controls_are_rejected(change):
    with pytest.raises(ValidationError):
        steered.Control(**change)


def test_a_silent_controller_is_released_into_stillness():
    service = steered.SteeredService(steered.SteeredRenderer(FakeEngine))
    held = steered.Control(seq=3, height=0.8, activity=0.7, spread=0.4)
    released = service.release(held)
    assert released.activity == 0
    assert (released.height, released.spread, released.seq) == (0.8, 0.4, 3)


@pytest.fixture
def client(monkeypatch):
    service = steered.SteeredService(steered.SteeredRenderer(FakeEngine))
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
