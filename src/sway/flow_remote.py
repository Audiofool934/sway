"""Private request/response bridge for persistent source transformations."""

import hashlib
import json
import os
import time
from pathlib import Path

from websockets.sync.client import connect

from .config import DATA
from .flow_audio import MAX_AUDIO_BYTES
from .flow_schema import FlowWireRequest
from .remote_music import RemoteMusicConfig


def flow_config_path():
    return Path(os.environ.get("SWAY_FLOW_CONFIG", DATA / "colab-flow.json")).expanduser()


def flow_status():
    try:
        config = RemoteMusicConfig.load(flow_config_path(), models=("demon",))
        return {"configured": True, "expires_at": config.expires_at, "model": "DEMON"}
    except ValueError:
        return {"configured": False, "error": "Start the Colab Flow runner to generate music"}


def render_remote(request, source=None):
    started = time.monotonic()
    try:
        config = RemoteMusicConfig.load(flow_config_path(), models=("demon",))
        with connect(
            config.url,
            additional_headers={"Authorization": "Bearer " + config.token},
            proxy=None,
            compression=None,
            open_timeout=10,
            close_timeout=1,
            max_size=MAX_AUDIO_BYTES,
            max_queue=2,
        ) as socket:
            wire = FlowWireRequest(
                **request.model_dump(),
                source_sha256=(hashlib.sha256(source).hexdigest() if source is not None else None),
            )
            socket.send(wire.model_dump_json())
            uploaded = 0
            if source is not None:
                handshake = json.loads(socket.recv(timeout=15))
                if handshake.get("error") or "source_required" not in handshake:
                    raise ValueError("Source handshake failed")
                if handshake["source_required"]:
                    socket.send(source)
                    uploaded = len(source)
            metadata = json.loads(socket.recv(timeout=120))
            if metadata.get("error"):
                raise ValueError("Remote transformation failed")
            raw = socket.recv(timeout=60)
            if not isinstance(raw, bytes):
                raise ValueError("Expected audio")
        metadata["request_ms"] = round((time.monotonic() - started) * 1000, 1)
        metadata["source_uploaded_bytes"] = uploaded
        return raw, metadata
    except Exception:
        raise ValueError(
            "Colab could not prepare this passage. Your current music is unchanged. "
            "Check the Flow runner and try again."
        ) from None
