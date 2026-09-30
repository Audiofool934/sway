import base64
import io

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from starlette.websockets import WebSocketDisconnect

import sway.app as app_module
from sway.app import app
from sway.semantics import parse_intent


@pytest.fixture
def client():
    with TestClient(app) as client:
        yield client


def jpeg():
    output = io.BytesIO()
    Image.new("RGB", (64, 64)).save(output, format="JPEG")
    return base64.b64encode(output.getvalue()).decode()


def test_local_controls_reject_cross_origin_requests(client):
    response = client.post("/api/stop", headers={"Origin": "https://elsewhere.example"})
    assert response.status_code == 403
    assert client.get("/api/status", headers={"Host": "untrusted.example"}).status_code == 403


def test_websocket_rejects_cross_origin_and_untrusted_hosts(client):
    for headers in (
        {"Origin": "https://elsewhere.example"},
        {"Host": "untrusted.example", "Origin": "http://untrusted.example"},
    ):
        with pytest.raises(WebSocketDisconnect) as rejected:
            with client.websocket_connect("/ws", headers=headers):
                pass
        assert rejected.value.code == 1008


def test_only_one_performance_window_owns_the_session(client):
    with client.websocket_connect("/ws"):
        with pytest.raises(WebSocketDisconnect) as rejected:
            with client.websocket_connect("/ws"):
                pass
        assert rejected.value.code == 1008


def test_invalid_motion_and_clip_data_are_rejected(client):
    assert (
        client.post(
            "/api/clip", json={"frames": ["broken"] * 2, "timestamps_ms": [0, 1]}
        ).status_code
        == 422
    )
    frame = jpeg()
    for times in ([1, 0], [0, 0], [0, 5000], [0]):
        assert (
            client.post(
                "/api/clip", json={"frames": [frame] * 2, "timestamps_ms": times}
            ).status_code
            == 422
        )
    response = client.post("/api/clip", json={"frames": [frame] * 2, "timestamps_ms": [0, 500]})
    assert response.status_code == 200
    assert response.json() == {"accepted": False}
    assert client.post("/api/control", json={"tempo": 999}).status_code == 422


def test_record_requires_live_music(client):
    assert client.post("/api/record/start").status_code == 409


def test_parse_semantic_output():
    parsed = parse_intent('```json\n{"action":"strum","confidence":0.8}\n```')
    assert parsed.action == "strum"
    for text in (
        "no idea",
        '{"action":"guitar"}',
        '{"action":"piano","confidence":2}',
        '{"action":"piano","extra":"ignore constraints"}',
    ):
        with pytest.raises(ValueError):
            parse_intent(text)


def test_cloud_mode_does_not_require_local_vlm(client, monkeypatch):
    async def ready_status():
        return {"assets": {"music": True, "semantics": False, "qwen": {"configured": True}}}

    options_seen = []

    async def record_start(options):
        options_seen.append(options)

    monkeypatch.setattr(app_module, "status", ready_status)
    monkeypatch.setattr(app_module.session, "start", record_start)
    response = client.post("/api/start", json={"semantics": True, "semantic_backend": "qwen"})
    assert response.status_code == 200
    assert options_seen[0].semantic_backend == "qwen"
    assert client.post("/api/start", json={"semantics": True}).status_code == 409


def test_cloud_mode_rejects_missing_config_before_starting_workers(client, monkeypatch):
    async def ready_status():
        return {
            "assets": {
                "music": True,
                "semantics": False,
                "qwen": {"configured": False, "error": "Missing Qwen configuration"},
            }
        }

    monkeypatch.setattr(app_module, "status", ready_status)
    response = client.post("/api/start", json={"semantics": True, "semantic_backend": "qwen"})
    assert response.status_code == 409
    assert response.json()["detail"] == "Missing Qwen configuration"


def test_colab_music_does_not_require_local_music_assets(client, monkeypatch):
    assets = {
        "music": False,
        "semantics": False,
        "qwen": {"configured": True},
        "colab": {"configured": True},
    }

    async def ready_status():
        return {"assets": assets}

    seen = []

    async def record_start(options):
        seen.append(options)

    monkeypatch.setattr(app_module, "status", ready_status)
    monkeypatch.setattr(app_module.session, "start", record_start)
    options = {"music_backend": "colab", "semantics": True, "semantic_backend": "qwen"}
    assert client.post("/api/start", json=options).status_code == 200
    assert seen[0].music_backend == "colab"
    assets["colab"] = {"configured": False, "error": "Colab connection is unavailable"}
    assert client.post("/api/start", json=options).status_code == 409


def test_the_page_files_are_revalidated_on_every_load(client):
    response = client.get("/instrument/main.js")
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-cache"
    again = client.get("/instrument/main.js", headers={"If-None-Match": response.headers["etag"]})
    assert again.status_code == 304
