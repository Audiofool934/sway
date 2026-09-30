import json

import numpy as np
import pytest
from fastapi.testclient import TestClient

from sway import flow
from sway.app import app
from sway.flow_audio import RATE, prepare_loop, read_wave, sketch, wave_bytes
from sway.flow_schema import FlowRequest


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(flow, "STORE", tmp_path)
    with TestClient(app) as client:
        yield client


def test_sketch_has_exact_grid_and_safe_stereo_audio():
    base, variation = sketch(), sketch(True)
    assert base.shape == variation.shape == (RATE * 20, 2)
    assert np.max(np.abs(base)) <= 0.800001
    assert np.max(np.abs(variation)) <= 0.800001
    assert np.isfinite(base).all()
    assert np.max(np.abs(base - variation)) > 0.05
    assert np.max(np.abs(base[[0, -1]])) == 0


def test_library_is_usable_without_cloud_and_blocks_path_traversal(client):
    data = client.get("/api/flow/library").json()
    assert len(data["passages"]) == 2
    response = client.get(f"/api/flow/audio/{data['default_anchor']}")
    assert response.status_code == 200
    assert read_wave(response.content).shape == (RATE * 20, 2)
    assert client.get("/api/flow/audio/private.json").status_code == 404
    assert (
        client.post(
            "/api/flow/render", headers={"Origin": "https://example.com"}, json={}
        ).status_code
        == 403
    )


def test_transform_uses_saved_anchor_grid_and_retains_original(client, monkeypatch):
    client.get("/api/flow/library")
    original = flow.asset_path(flow.DEMO, "wav").read_bytes()
    seen = []

    def remote(request, source):
        seen.append((request, source))
        return wave_bytes(sketch(True)), {"engine_ms": 150, "request_ms": 500}

    monkeypatch.setattr(flow, "render_remote", remote)
    response = client.post(
        "/api/flow/render",
        json={
            "type": "transform",
            "prompt": "More texture",
            "anchor": flow.DEMO,
            "bpm": 120,
        },
    )
    assert response.status_code == 200
    assert seen[0][0].bpm == 96
    assert seen[0][1] == original
    assert flow.asset_path(flow.DEMO, "wav").read_bytes() == original
    item = response.json()
    assert item["anchor"] == flow.DEMO and item["id"] != flow.DEMO
    assert json.loads(flow.asset_path(item["id"], "json").read_text())["request_ms"] == 500
    again = client.post(
        "/api/flow/render",
        json={
            "type": "transform",
            "prompt": "More texture",
            "anchor": flow.DEMO,
            "bpm": 120,
        },
    )
    assert again.json()["cache_hit"] is True
    assert again.json()["id"] == item["id"] and len(seen) == 1
    assert (
        client.post(
            "/api/flow/render",
            json={
                "type": "transform",
                "prompt": "Again",
                "anchor": item["id"],
            },
        ).status_code
        == 422
    )


def test_failed_render_preserves_library_and_releases_gate(client, monkeypatch):
    client.get("/api/flow/library")

    def fail(*args):
        raise ValueError("Cloud unavailable")

    monkeypatch.setattr(flow, "render_remote", fail)
    response = client.post("/api/flow/render", json={"type": "generate", "prompt": "Quiet piano"})
    assert response.status_code == 503
    assert not flow.render_lock.locked()
    assert len(client.get("/api/flow/library").json()["passages"]) == 2
    with flow.render_lock:
        assert (
            client.post(
                "/api/flow/render", json={"type": "generate", "prompt": "Piano"}
            ).status_code
            == 409
        )


def test_audio_and_generation_requests_are_bounded():
    for raw in (b"broken", wave_bytes(np.zeros((RATE * 8, 2)))):
        with pytest.raises((ValueError, RuntimeError)):
            read_wave(raw)
    with pytest.raises(ValueError):
        prepare_loop(np.zeros((RATE * 8, 2)), RATE * 20)
    for patch in (
        {"strength": 1},
        {"bpm": 20},
        {"bars": 128},
        {"key": "invalid"},
        {"camera": "secret"},
    ):
        with pytest.raises(ValueError):
            FlowRequest(type="generate", prompt="Warm piano", **patch)
