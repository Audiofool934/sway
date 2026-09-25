"""Loopback-only control surface for the local instrument."""

import asyncio
import base64
import io
import math
from contextlib import asynccontextmanager
from urllib.parse import urlsplit

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from PIL import Image
from pydantic import ValidationError

from .config import MRT_DIR, MRT_FILES, RECORDINGS, ROOT, SEMANTIC_DIR, VISION_ASSETS, VISION_DIR
from .schema import ManualControl, MotionFrame, SemanticClip, SessionOptions
from .session import Session

session = Session()


@asynccontextmanager
async def lifespan(app):
    yield
    await session.stop()


app = FastAPI(title="Sway", lifespan=lifespan, docs_url=None, redoc_url=None)


def same_origin(origin, host):
    return not origin or urlsplit(origin).netloc == host


@app.middleware("http")
async def local_origin(request: Request, call_next):
    hostname = request.url.hostname
    if hostname not in ("127.0.0.1", "localhost", "testserver"):
        return JSONResponse({"detail": "Sway is a local instrument"}, status_code=403)
    if not same_origin(request.headers.get("origin"), request.headers.get("host")):
        return JSONResponse({"detail": "Origin does not match the local app"}, status_code=403)
    try:
        length = int(request.headers.get("content-length", "0"))
    except ValueError:
        return JSONResponse({"detail": "Invalid content length"}, status_code=400)
    if length > 800_000:
        return JSONResponse({"detail": "Request is too large"}, status_code=413)
    return await call_next(request)


@app.get("/api/status")
async def status():
    missing_music = [name for name in MRT_FILES if not (MRT_DIR / name).is_file()]
    missing_vision = [name for name in VISION_ASSETS if not (VISION_DIR / name).is_file()]
    return {
        **session.snapshot(),
        "assets": {
            "music": not missing_music,
            "semantics": (SEMANTIC_DIR / "model.safetensors").is_file(),
            "vision": not missing_vision,
            "missing": missing_music + missing_vision,
        },
    }


@app.post("/api/start")
async def start(options: SessionOptions):
    assets = (await status())["assets"]
    if not assets["music"] or (options.semantics and not assets["semantics"]):
        raise HTTPException(
            409, "Model files are missing. Run sway setup in the project directory."
        )
    await session.start(options)
    return session.snapshot()


@app.post("/api/stop")
async def stop():
    await session.stop()
    return session.snapshot()


@app.post("/api/control")
async def control(change: ManualControl):
    if change.action is not None:
        session.controller.action = change.action
    if change.tempo is not None:
        session.controller.tempo = change.tempo
    if change.follow_motion is not None:
        session.controller.options.follow_motion = change.follow_motion
    if change.camera_active is False:
        session.controller.last_seen = None
    return session.snapshot()


@app.post("/api/clip")
async def clip(body: SemanticClip):
    if len(body.frames) != len(body.timestamps_ms):
        raise HTTPException(422, "Each frame needs a timestamp")
    times = body.timestamps_ms
    if not all(math.isfinite(t) for t in times) or any(
        b <= a for a, b in zip(times, times[1:], strict=False)
    ):
        raise HTTPException(422, "Clip timestamps must be finite and increasing")
    if times[-1] - times[0] > 4000:
        raise HTTPException(422, "Clip must cover at most four seconds")
    for encoded in body.frames:
        if len(encoded) > 150_000:
            raise HTTPException(413, "Frame is too large")
        try:
            raw = base64.b64decode(encoded, validate=True)
            with Image.open(io.BytesIO(raw)) as image:
                if image.format != "JPEG" or image.width * image.height > 512 * 512:
                    raise ValueError("Expected a small JPEG frame")
                image.verify()
        except (ValueError, OSError) as exc:
            raise HTTPException(422, "Invalid video frame") from exc
    return {"accepted": session.submit_clip(body.model_dump())}


@app.post("/api/record/start")
async def record_start():
    try:
        session.start_recording()
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc
    return session.snapshot()


@app.post("/api/record/stop")
async def record_stop():
    session.stop_recording()
    return session.snapshot()


@app.get("/api/recordings/{name}")
async def recording(name: str):
    if not name.startswith("sway-") or not name.endswith(".wav") or "/" in name or "\\" in name:
        raise HTTPException(404)
    path = RECORDINGS / name
    if not path.is_file():
        raise HTTPException(404)
    return FileResponse(path, media_type="audio/wav", filename=name)


@app.websocket("/ws")
async def stream(websocket: WebSocket):
    if websocket.url.hostname not in ("127.0.0.1", "localhost", "testserver") or not same_origin(
        websocket.headers.get("origin"), websocket.headers.get("host")
    ):
        await websocket.close(code=1008)
        return
    if session.clients:
        await websocket.close(code=1008, reason="Sway already has a performance window open")
        return
    await websocket.accept()
    outgoing = asyncio.Queue(16)
    session.clients.add(outgoing)

    async def sender():
        while True:
            packet = await outgoing.get()
            if isinstance(packet, bytes):
                await websocket.send_bytes(packet)
            else:
                await websocket.send_json(packet)

    task = asyncio.create_task(sender())
    try:
        while True:
            message = await websocket.receive_text()
            if len(message) > 20_000:
                await websocket.close(code=1009)
                break
            try:
                session.observe(MotionFrame.model_validate_json(message))
            except ValidationError:
                await websocket.close(code=1008, reason="Invalid motion frame")
                break
    except WebSocketDisconnect:
        pass
    finally:
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
        await session.stop()
        session.clients.discard(outgoing)


app.mount(
    "/vendor",
    StaticFiles(directory=ROOT / "node_modules" / "@mediapipe" / "tasks-vision", check_dir=False),
    name="vendor",
)
app.mount("/models", StaticFiles(directory=VISION_DIR, check_dir=False), name="vision-models")
app.mount("/", StaticFiles(directory=ROOT / "web", html=True, check_dir=False), name="performance")
