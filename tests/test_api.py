import pytest
from fastapi.testclient import TestClient

from sway.app import app


@pytest.fixture
def client():
    with TestClient(app) as client:
        yield client


def test_local_controls_reject_cross_origin_requests(client):
    response = client.post(
        "/api/harmony/start",
        json={"palette": "strings", "seed": 1},
        headers={"Origin": "https://elsewhere.example"},
    )
    assert response.status_code == 403
    assert (
        client.get("/api/harmony/status", headers={"Host": "untrusted.example"}).status_code == 403
    )


def test_the_page_files_are_revalidated_on_every_load(client):
    response = client.get("/instrument/main.js")
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-cache"
    again = client.get("/instrument/main.js", headers={"If-None-Match": response.headers["etag"]})
    assert again.status_code == 304
