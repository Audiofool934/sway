import json
import threading
import time

import numpy as np
import pytest
from websockets.exceptions import InvalidStatus
from websockets.sync.client import connect
from websockets.sync.server import serve

from sway.flow_audio import RATE, wave_bytes
from sway.flow_remote import flow_status, render_remote
from sway.flow_schema import FlowRequest
from sway.flow_server import FlowService


def test_private_bridge_transports_source_and_keeps_credentials_local(tmp_path, monkeypatch):
    calls = []
    raw = wave_bytes(np.full((RATE * 8, 2), 0.1, dtype=np.float32))

    class Engine:
        def render(self, request, source):
            calls.append((request, source))
            return raw, {"engine_ms": 1}

    token = "c" * 64
    service = FlowService(Engine(), token)
    with serve(
        service.handle, "127.0.0.1", 0, process_request=service.authorize, max_size=16_000_000
    ) as server:
        thread = threading.Thread(target=server.serve_forever)
        thread.start()
        try:
            url = f"ws://127.0.0.1:{server.socket.getsockname()[1]}"
            config = tmp_path / "connection.json"
            config.write_text(
                json.dumps(
                    {"url": url, "token": token, "model": "demon", "expires_at": time.time() + 60}
                )
            )
            config.chmod(0o600)
            monkeypatch.setenv("SWAY_FLOW_CONFIG", str(config))
            status = flow_status()
            assert status["configured"] and token not in json.dumps(status)
            with pytest.raises(InvalidStatus):
                with connect(url, proxy=None):
                    pass
            with pytest.raises(InvalidStatus):
                with connect(
                    url,
                    proxy=None,
                    origin="http://127.0.0.1",
                    additional_headers={"Authorization": "Bearer " + token},
                ):
                    pass
            result, metrics = render_remote(
                FlowRequest(type="transform", prompt="A soft variation"), raw
            )
            assert result == raw and metrics["request_ms"] > 0
            assert metrics["source_uploaded_bytes"] == len(raw)
            assert calls[0][1] == raw
            _, again = render_remote(FlowRequest(type="transform", prompt="Another variation"), raw)
            assert again["source_uploaded_bytes"] == 0
            assert calls[1][1] == raw
            _, generation = render_remote(FlowRequest(type="generate", prompt="Piano"))
            assert generation["source_uploaded_bytes"] == 0
            _, from_generated = render_remote(
                FlowRequest(type="transform", prompt="Soft piano"), raw
            )
            assert from_generated["source_uploaded_bytes"] == 0
            with service.lock:
                with pytest.raises(ValueError, match="current music is unchanged") as failure:
                    render_remote(FlowRequest(type="generate", prompt="Piano"))
                assert token not in str(failure.value)
        finally:
            server.shutdown()
            thread.join(timeout=5)
            assert not thread.is_alive()
