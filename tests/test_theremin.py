import asyncio
import json

import numpy as np
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from starlette.websockets import WebSocketDisconnect

from sway import theremin
from sway.app import app


class FakeStyle:
    def __init__(self):
        self.index = 0

    def embed(self, _):
        vector = np.eye(3, dtype=np.float32)[self.index]
        self.index += 1
        return vector

    def tokens(self, _):
        return np.zeros(12, dtype=np.int32)


class FakeEngine:
    def __init__(self):
        self.style = FakeStyle()
        self.rows = []
        self.seeds = []

    def generate(self, notes, drumless=False, note_guidance=1):
        assert drumless
        self.rows.append(notes.copy())
        return np.full((1920, 2), 0.1, dtype=np.float32)

    def apply_style(self, embedding):
        self.target = embedding

    def reset(self, seed):
        self.seeds.append(seed)
        self.rows.clear()


def test_actual_gesture_controls_reach_the_generated_notes_and_style():
    engine = FakeEngine()
    renderer = theremin.ThereminRenderer(lambda: engine)
    renderer.start(17)
    held = theremin.Control(active=True, energy=0.5, pitch=57, spread=0.2)
    audio, _ = renderer.render(held)
    assert len(audio) == 1920 * 2 * 4
    assert engine.rows[-1][57] == 2
    renderer.render(held)
    assert engine.rows[-1][57] == 1
    assert np.count_nonzero(engine.rows[-1]) == 1
    for _ in range(20):
        renderer.render(held.model_copy(update={"grain": 1, "spread": 0.9, "accent": 1}))
    assert engine.target[2] > 0.97
    assert np.count_nonzero(engine.rows[-1]) == 0  # Plucked notes release.
    renderer.render(held.model_copy(update={"grain": 1, "spread": 0.9, "accent": 2}))
    assert engine.rows[-1][57] == 2 and engine.rows[-1][45] == 2
    assert np.count_nonzero(engine.rows[-1]) == 3
    renderer.render(held.model_copy(update={"active": False}))
    assert np.count_nonzero(engine.rows[-1]) == 0
    renderer.start(18)
    assert engine.seeds == [17, 18]
    assert not renderer.held and renderer.frames == 0


@pytest.mark.parametrize(
    "change", [{"pitch": 900}, {"grain": float("nan")}, {"spread": 2}, {"camera": "image"}]
)
def test_unbounded_or_unrelated_controls_are_rejected(change):
    with pytest.raises(ValidationError):
        theremin.Control(**change)


@pytest.fixture
def client(monkeypatch):
    renderer = theremin.ThereminRenderer(FakeEngine)
    service = theremin.ThereminService(renderer)
    monkeypatch.setattr(theremin, "SERVICE", service)
    monkeypatch.setattr(theremin, "assets_ready", lambda: True)
    with TestClient(app) as client:
        yield client, service


def test_browser_stream_has_audio_rejects_second_window_and_releases_on_disconnect(client):
    browser, service = client
    with browser.websocket_connect("/api/theremin/stream") as ws:
        assert ws.receive_json()["type"] == "loading"
        assert ws.receive_json()["type"] == "ready"
        ws.send_json({"seq": 1, "active": True, "energy": 0.7, "pitch": 64})
        assert len(ws.receive_bytes()) == 15360
        with pytest.raises(WebSocketDisconnect) as rejected:
            with browser.websocket_connect("/api/theremin/stream"):
                pass
        assert rejected.value.code == 1008
    assert service.owner is None
    with browser.websocket_connect("/api/theremin/stream") as ws:
        assert ws.receive_json()["type"] == "loading"
        assert ws.receive_json()["type"] == "ready"


def test_cross_origin_websocket_is_rejected_before_loading(client):
    browser, service = client
    with pytest.raises(WebSocketDisconnect):
        with browser.websocket_connect(
            "/api/theremin/stream", headers={"origin": "https://elsewhere.test"}
        ):
            pass
    assert service.renderer.engine is None


def test_disconnect_during_handshake_does_not_leave_the_instrument_busy(monkeypatch):
    class Gone:
        url = type("URL", (), {"hostname": "testserver"})()
        headers = {}

        async def accept(self):
            raise WebSocketDisconnect

    monkeypatch.setattr(theremin, "assets_ready", lambda: True)
    service = theremin.ThereminService()
    asyncio.run(service.connect(Gone()))
    assert service.owner is None


def test_frozen_controls_release_and_late_sequences_do_not_rewind_the_instrument():
    class Socket:
        url = type("URL", (), {"hostname": "testserver"})()
        headers = {}

        def __init__(self):
            self.messages = [
                {"seq": 2, "active": True, "energy": 0.6, "pitch": 64},
                {"seq": 1, "active": True, "energy": 0.6, "pitch": 48},
            ]
            self.audio = 0

        async def accept(self):
            pass

        async def receive_text(self):
            if self.messages:
                await asyncio.sleep(0.05)
                return json.dumps(self.messages.pop(0))
            await asyncio.sleep(0.85)
            raise WebSocketDisconnect

        async def send_json(self, _):
            pass

        async def send_bytes(self, _):
            self.audio += 1

    async def run():
        engine = FakeEngine()
        service = theremin.ThereminService(theremin.ThereminRenderer(lambda: engine))
        socket = Socket()
        try:
            # Asset availability is checked separately by the route tests.
            original = theremin.assets_ready
            theremin.assets_ready = lambda: True
            await service.connect(socket)
        finally:
            theremin.assets_ready = original
            await service.close()
        assert socket.audio > 15
        assert any(row[64] > 0 for row in engine.rows)
        assert not any(row[48] > 0 for row in engine.rows)
        assert np.count_nonzero(engine.rows[-1]) == 0
        assert service.owner is None

    asyncio.run(run())
