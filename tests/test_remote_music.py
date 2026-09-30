import json
import queue
import threading
import time

import numpy as np
import pytest
from websockets.exceptions import InvalidStatus
from websockets.sync.client import connect
from websockets.sync.server import serve

from sway.ensemble import opening_arrangement
from sway.remote_music import (
    MusicControl,
    RemoteMusicConfig,
    pack_audio,
    remote_music_status,
    remote_music_worker,
    unpack_audio,
)
from sway.remote_server import MusicService

INITIAL = {"palette": "chamber", "action": "unknown", "bpm": 108}
TOKEN = "a" * 64


class FakeStyle:
    def embed(self, text):
        return np.zeros(2, dtype=np.float32)


class FakeEngine:
    model_id = "mrt2_base"
    style = FakeStyle()
    frame = 0
    last_ms = 1.0

    def reset(self):
        self.frame = 0

    def set_style(self, palette, action):
        self.action = action

    def set_arrangement(self, palette, arrangement, bpm):
        self.arrangement = arrangement

    def prepare_arrangement(self, palette, arrangement, bpm):
        return arrangement

    def apply_style(self, arrangement):
        self.arrangement = arrangement

    def generate(self, notes=None, note_guidance=1.0):
        self.frame += 1
        return np.tile(np.array([0.2, -0.1], dtype=np.float32), (1920, 1))


@pytest.fixture
def private_config(tmp_path, monkeypatch):
    path = tmp_path / "connection.json"
    path.write_text(
        json.dumps(
            {
                "url": "ws://127.0.0.1:12345",
                "token": TOKEN,
                "model": "mrt2_base",
                "expires_at": time.time() + 60,
            }
        )
    )
    path.chmod(0o600)
    monkeypatch.setenv("SWAY_REMOTE_MUSIC_CONFIG", str(path))
    return path


@pytest.fixture
def music_service(private_config):
    engine = FakeEngine()
    service = MusicService(engine, TOKEN)
    with serve(
        service.handle,
        "127.0.0.1",
        0,
        process_request=service.authorize,
        compression=None,
        max_size=8192,
        close_timeout=0.5,
    ) as server:
        port = server.socket.getsockname()[1]
        thread = threading.Thread(target=server.serve_forever)
        thread.start()
        values = json.loads(private_config.read_text())
        values["url"] = f"ws://127.0.0.1:{port}"
        private_config.write_text(json.dumps(values))
        try:
            yield service, values["url"]
        finally:
            server.shutdown()
            thread.join(timeout=3)
            assert not thread.is_alive()


def test_private_connection_rejects_external_targets_expiry_and_permissions(private_config):
    assert TOKEN not in repr(RemoteMusicConfig.load())
    assert TOKEN not in json.dumps(remote_music_status())
    original = json.loads(private_config.read_text())
    for change in (
        {"url": "ws://example.com:80"},
        {"expires_at": time.time() - 1},
        {"url": "ws://127.0.0.1:8000?token=secret"},
    ):
        private_config.write_text(json.dumps({**original, **change}))
        assert not remote_music_status()["configured"]
    private_config.write_text(json.dumps(original))
    private_config.chmod(0o644)
    assert not remote_music_status()["configured"]


def test_remote_controls_exclude_images_landmarks_and_credentials():
    values = MusicControl.model_validate(
        {**INITIAL, "frames": ["camera"], "rhythm": {"hands": 2}, "api_key": "secret"}
    )
    assert set(values.model_dump()).isdisjoint(("frames", "rhythm", "api_key"))
    with pytest.raises(ValueError):
        MusicControl.model_validate({**INITIAL, "bpm": float("nan")})


def test_audio_protocol_preserves_stereo_and_rejects_invalid_frames():
    pcm = np.tile(np.array([0.25, -0.5], dtype=np.float32), (1920, 1))
    packet = pack_audio(pcm.tobytes(), {"frame_ms": 35.2, "control_seq": 8})
    raw, metrics = unpack_audio(packet)
    assert metrics["control_seq"] == 8
    np.testing.assert_array_equal(np.frombuffer(raw, dtype=np.float32).reshape(-1, 2), pcm)
    for invalid in (b"", packet[:-1], packet[:4] + b"x" * (len(packet) - 4)):
        with pytest.raises(ValueError):
            unpack_audio(invalid)
    pcm[0, 0] = np.nan
    with pytest.raises(ValueError):
        unpack_audio(pack_audio(pcm.tobytes(), {}))


def test_remote_service_requires_token_and_rejects_browser_origins(music_service):
    _, url = music_service
    for headers in ({}, {"Authorization": "Bearer " + TOKEN, "Origin": "http://localhost"}):
        with pytest.raises(InvalidStatus) as denied:
            with connect(url, additional_headers=headers, proxy=None):
                pass
        assert denied.value.response.status_code == 401
    with connect(url, additional_headers={"Authorization": "Bearer " + TOKEN}, proxy=None) as ws:
        ws.send('{"type":"health"}')
        assert json.loads(ws.recv(timeout=1))["ready"]


def test_live_relay_applies_controls_delivers_stereo_and_stops_generation(music_service):
    service, _ = music_service
    controls, accents, audio, status = (queue.Queue(n) for n in (2, 32, 8, 32))
    stop = threading.Event()
    worker = threading.Thread(
        target=remote_music_worker, args=(controls, accents, audio, status, stop, INITIAL)
    )
    worker.start()
    try:
        raw, _ = audio.get(timeout=4)
        pcm = np.frombuffer(raw, dtype=np.float32).reshape(-1, 2)
        assert pcm[-1, 0] > 0 and pcm[-1, 1] < 0
        controls.put({**INITIAL, "action": "piano", "guided": True, "energy": 0.5})
        accents.put({"time": time.monotonic(), "finger": 2})
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            _, metrics = audio.get(timeout=1)
            if metrics["note_cues"] > 0 and "control_to_audio_ms" in metrics:
                break
        else:
            pytest.fail("Remote musical controls did not reach audio generation")
        assert metrics["control_to_audio_ms"] >= 0
        assert service.engine.action == "piano"
        assert any(item.get("backend") == "colab" for item in list(status.queue))
    finally:
        stop.set()
        worker.join(timeout=4)
    assert not worker.is_alive()
    deadline = time.monotonic() + 3
    while service.lock.locked() and time.monotonic() < deadline:
        time.sleep(0.02)
    assert not service.lock.locked()
    frames = service.engine.frame
    time.sleep(0.1)
    assert service.engine.frame == frames


def test_remote_ensemble_preserves_all_parts_and_applies_new_plan(music_service):
    service, _ = music_service
    arrangement = opening_arrangement("chamber").model_dump()
    initial = {**INITIAL, "conducted": True, "arrangement": arrangement}
    controls, accents, audio, status = (queue.Queue(n) for n in (2, 32, 8, 32))
    stop = threading.Event()
    worker = threading.Thread(
        target=remote_music_worker, args=(controls, accents, audio, status, stop, initial)
    )
    worker.start()
    try:
        _, first = audio.get(timeout=4)
        assert len(first["ensemble_parts"]) == 3
        updated = {
            **arrangement,
            "parts": [
                {"instrument": "piano", "role": "melody", "source": "left_hand"},
                {"instrument": "drum kit", "role": "rhythm", "source": "right_hand"},
            ],
        }
        controls.put({**initial, "arrangement": updated, "arrangement_revision": 1})
        deadline = time.monotonic() + 4
        while time.monotonic() < deadline:
            _, metrics = audio.get(timeout=1)
            if metrics["arrangement_revision"] == 1:
                break
        else:
            pytest.fail("The ensemble plan did not reach the remote generator")
        assert [part["instrument"] for part in metrics["ensemble_parts"]] == ["piano", "drum kit"]
        assert metrics["bpm"] == 108
        assert service.engine.arrangement.parts[1].instrument == "drum kit"
    finally:
        stop.set()
        worker.join(timeout=4)
    assert not worker.is_alive()
