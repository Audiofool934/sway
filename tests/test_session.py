import asyncio
import json
import time

import numpy as np
import soundfile as sf

import sway.session as session_module
from sway.schema import SessionOptions
from sway.session import Session


def idle_music(controls, accents, audio, status, stop, initial):
    status.put({"worker": "music", "phase": "ready"})
    stop.wait(10)


def idle_semantics(clips, status, stop):
    status.put({"worker": "semantics", "phase": "ready"})
    stop.wait(10)


def test_spawned_workers_start_and_stop_cleanly(monkeypatch):
    monkeypatch.setattr(session_module, "music_worker", idle_music)
    monkeypatch.setattr(session_module, "semantic_worker", idle_semantics)

    async def exercise():
        session = Session()
        try:
            await session.start(SessionOptions())
            deadline = time.monotonic() + 8
            while time.monotonic() < deadline:
                if all(w["phase"] == "ready" for w in session.workers.values()):
                    break
                await asyncio.sleep(0.05)
            assert all(w["phase"] == "ready" for w in session.workers.values())
            assert all(p.is_alive() for p in session.processes)
        finally:
            await session.stop()
        assert not session.running
        assert session.processes == []
        assert session.queues == []

    asyncio.run(exercise())


def test_recording_closes_valid_audio_and_metadata(tmp_path, monkeypatch):
    monkeypatch.setattr(session_module, "RECORDINGS", tmp_path)
    session = Session()
    session.running = True
    session.started_at = time.monotonic()
    session.workers["music"]["phase"] = "ready"
    session.start_recording()
    session.recording.write(np.zeros((1920, 2), dtype=np.float32))
    session.stop_recording()
    path = tmp_path / session.last_recording
    assert sf.info(path).frames == 1920
    assert sf.info(path).channels == 2
    assert json.loads(path.with_suffix(".json").read_text())["recording"] is False
