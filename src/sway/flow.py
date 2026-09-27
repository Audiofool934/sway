"""Saved musical anchors and asynchronous cloud transformations for Flow mode."""

import hashlib
import json
import re
import threading
import time
import uuid

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from .config import DATA
from .flow_audio import RATE, read_wave, sketch, wave_bytes
from .flow_remote import flow_status, render_remote
from .flow_schema import FlowRequest

router = APIRouter(prefix="/api/flow")
STORE = DATA / "flow"
render_lock = threading.Lock()
store_lock = threading.Lock()
DEMO = "00000000000000000000000000000001"
DEMO_VARIATION = "00000000000000000000000000000002"


def asset_path(identity, extension):
    if not re.fullmatch(r"[a-f0-9]{32}", identity):
        raise HTTPException(404, "Passage not found")
    return STORE / f"{identity}.{extension}"


def get_asset(identity):
    try:
        return json.loads(asset_path(identity, "json").read_text())
    except (OSError, ValueError):
        raise HTTPException(404, "Passage not found") from None


def save_asset(raw, metadata, identity=None):
    identity = identity or uuid.uuid4().hex
    audio = read_wave(raw)
    metadata = {
        **metadata,
        "id": identity,
        "created_at": time.time(),
        "seconds": len(audio) / RATE,
        "audio_url": f"/api/flow/audio/{identity}",
    }
    STORE.mkdir(parents=True, exist_ok=True)
    asset_path(identity, "wav").write_bytes(raw)
    asset_path(identity, "json").write_text(json.dumps(metadata, indent=2) + "\n")
    return metadata


def ensure_demo():
    with store_lock:
        if not asset_path(DEMO, "json").exists():
            save_asset(
                wave_bytes(sketch()),
                {
                    "title": "Room to breathe",
                    "prompt": "An original electric-piano sketch",
                    "bpm": 96,
                    "bars": 8,
                    "key": "A minor",
                    "kind": "anchor",
                    "origin": "Local composed sketch",
                    "grid": "composed",
                },
                DEMO,
            )
        if not asset_path(DEMO_VARIATION, "json").exists():
            save_asset(
                wave_bytes(sketch(variation=True)),
                {
                    "title": "A little more movement",
                    "bpm": 96,
                    "bars": 8,
                    "key": "A minor",
                    "kind": "variation",
                    "anchor": DEMO,
                    "origin": "Local composed sketch",
                },
                DEMO_VARIATION,
            )


@router.get("/library")
def library():
    ensure_demo()
    passages = []
    for path in STORE.glob("*.json"):
        try:
            item = json.loads(path.read_text())
            if asset_path(item["id"], "wav").is_file():
                passages.append(item)
        except (OSError, ValueError, KeyError):
            continue
    return {
        "passages": sorted(passages, key=lambda x: x["created_at"], reverse=True)[:100],
        "default_anchor": DEMO,
        "default_variation": DEMO_VARIATION,
        "cloud": flow_status(),
    }


@router.get("/audio/{identity}")
def audio(identity: str):
    get_asset(identity)
    return FileResponse(asset_path(identity, "wav"), media_type="audio/wav")


@router.post("/render")
def render(request: FlowRequest):
    # Acquire in the worker thread so cancellation of an HTTP request cannot release
    # the GPU gate while its synchronous inference/transfer is still running.
    if not render_lock.acquire(blocking=False):
        raise HTTPException(409, "A passage is already being prepared")
    try:
        source = None
        if request.type == "transform":
            if not request.anchor:
                raise HTTPException(422, "Choose a starting passage first")
            anchor = get_asset(request.anchor)
            if anchor["kind"] != "anchor":
                raise HTTPException(422, "A variation cannot replace the original anchor")
            request = request.model_copy(update={k: anchor[k] for k in ("bpm", "bars", "key")})
            source = asset_path(request.anchor, "wav").read_bytes()
        request_key = hashlib.sha256(request.model_dump_json().encode()).hexdigest()
        for path in STORE.glob("*.json"):
            try:
                saved = json.loads(path.read_text())
                if (
                    saved.get("request_key") == request_key
                    and asset_path(saved["id"], "wav").is_file()
                ):
                    return {**saved, "cache_hit": True}
            except (OSError, ValueError, KeyError):
                continue
        raw, metrics = render_remote(request, source)
        audio = read_wave(raw)
        if abs(len(audio) / RATE - request.seconds) > 0.01:
            raise ValueError("The returned passage does not match its beat grid")
        return save_asset(
            raw,
            {
                **request.model_dump(),
                "request_key": request_key,
                **metrics,
                "title": request.prompt.split(",")[0][:64].strip(),
                "kind": "anchor" if request.type == "generate" else "variation",
                "origin": "DEMON on Colab",
                "grid": "requested, confirm by ear",
            },
        )
    except ValueError as exc:
        raise HTTPException(503, str(exc)) from None
    finally:
        render_lock.release()
