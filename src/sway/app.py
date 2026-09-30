"""Loopback-only control surface for the local instrument."""

import asyncio
import base64
import io
import logging
import math
import time
from contextlib import asynccontextmanager
from urllib.parse import urlsplit

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from PIL import Image
from pydantic import ValidationError

from . import harmony
from .config import MRT_DIR, MRT_FILES, RECORDINGS, ROOT, SEMANTIC_DIR, VISION_ASSETS, VISION_DIR
from .flow import router as flow_router
from .qwen import qwen_status
from .remote_music import remote_music_status
from .schema import (
    HarmonyBar,
    HarmonyStart,
    ManualControl,
    MotionFrame,
    SemanticClip,
    SessionOptions,
)
from .session import Session

log = logging.getLogger(__name__)

session = Session()


@asynccontextmanager
async def lifespan(app):
    yield
    await session.stop()


app = FastAPI(title="Sway", lifespan=lifespan, docs_url=None, redoc_url=None)
app.include_router(flow_router)


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
            "qwen": qwen_status(),
            "colab": remote_music_status(),
            "vision": not missing_vision,
            "missing": missing_music + missing_vision,
        },
    }


MISSING_MRT2 = (
    "MRT2 is not installed. Run `uv run --locked sway setup --music-only` to add generated harmony."
)


async def on_harmony_thread(function, *args):
    return await asyncio.get_running_loop().run_in_executor(harmony.EXECUTOR, function, *args)


@app.get("/api/harmony/status")
async def harmony_status():
    return {
        "available": harmony.assets_ready(),
        "palettes": list(harmony.PALETTES),
        **harmony.RENDERER.status(),
    }


@app.post("/api/harmony/start")
async def harmony_start(body: HarmonyStart):
    if not harmony.assets_ready():
        raise HTTPException(503, MISSING_MRT2)
    harmony.RENDERER.stream = body.seed
    try:
        return await on_harmony_thread(harmony.RENDERER.start, body.palette, body.seed)
    except Exception as exc:
        log.exception("Generated harmony could not start")
        raise HTTPException(500, "Generated harmony could not start") from exc


@app.post("/api/harmony/bar")
async def harmony_bar(body: HarmonyBar):
    """One bar of the chord as 16-bit stereo PCM; the page decides when it plays."""
    if not harmony.assets_ready():
        raise HTTPException(503, MISSING_MRT2)
    try:
        frames = harmony.frames_per_bar(body.tempo, body.beats_per_bar)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc

    def render():
        if body.stream != harmony.RENDERER.stream:
            raise harmony.StaleStream
        started = time.perf_counter()
        audio = harmony.RENDERER.render(body.voicing, body.tones, body.palette, frames)
        return audio, (time.perf_counter() - started) * 1000

    try:
        audio, ms = await on_harmony_thread(render)
    except harmony.StaleStream:
        raise HTTPException(409, "That piece has ended") from None
    except Exception as exc:
        log.exception("Generated harmony could not render bar %d", body.bar)
        raise HTTPException(500, "Generated harmony could not render this bar") from exc
    return Response(
        harmony.to_pcm(audio),
        media_type="application/octet-stream",
        headers={
            "X-Bar": str(body.bar),
            "X-Sample-Rate": str(harmony.SAMPLE_RATE),
            "X-Channels": str(audio.shape[1]),
            "X-Render-Ms": str(round(ms)),
        },
    )


@app.post("/api/start")
async def start(options: SessionOptions):
    assets = (await status())["assets"]
    if (options.music_backend == "local" and not assets["music"]) or (
        options.semantics and options.semantic_backend == "local" and not assets["semantics"]
    ):
        raise HTTPException(
            409, "Model files are missing. Run sway setup in the project directory."
        )
    if (
        options.semantics
        and options.semantic_backend == "qwen"
        and not assets["qwen"]["configured"]
    ):
        raise HTTPException(409, assets["qwen"]["error"])
    if options.music_backend == "colab" and not assets["colab"]["configured"]:
        raise HTTPException(409, assets["colab"]["error"])
    await session.start(options)
    return session.snapshot()


@app.post("/api/stop")
async def stop():
    await session.stop()
    return session.snapshot()


@app.post("/api/control")
async def control(change: ManualControl):
    if change.action is not None:
        session.controller.manual(change.action)
    if change.tempo is not None:
        session.controller.set_tempo(change.tempo)
    if change.follow_motion is not None:
        session.controller.options.follow_motion = change.follow_motion
        session.controller.tempo_cue = "hold"
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


class RevalidatedFiles(StaticFiles):
    """The page's own files, which browsers check on every load.

    Without this, Chrome may reuse cached modules for hours after an update and run old
    and new code together. Unchanged files still cost only a 304 response.
    """

    async def get_response(self, path, scope):
        response = await super().get_response(path, scope)
        response.headers["Cache-Control"] = "no-cache"
        return response


app.mount(
    "/", RevalidatedFiles(directory=ROOT / "web", html=True, check_dir=False), name="performance"
)
