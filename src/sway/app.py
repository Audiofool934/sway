"""Loopback-only control surface for the local instrument."""

import asyncio
import logging
import time
from contextlib import asynccontextmanager
from urllib.parse import urlsplit

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from . import composer, harmony, theremin
from .config import ROOT, VISION_DIR
from .qwen import qwen_status
from .schema import ComposeRequest, HarmonyBar, HarmonyStart

log = logging.getLogger(__name__)

# Created on first use, once Qwen is configured, so a key added later is picked up.
COMPOSER = None


@asynccontextmanager
async def lifespan(app):
    yield
    await theremin.SERVICE.close()
    if COMPOSER is not None:
        await COMPOSER.aclose()


app = FastAPI(title="Sway", lifespan=lifespan, docs_url=None, redoc_url=None)
app.include_router(theremin.router)


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
        audio = harmony.RENDERER.render(
            body.notes, body.tones, body.palette, frames, body.beats_per_bar
        )
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


@app.get("/api/compose/status")
async def compose_status():
    """Whether Qwen can compose; never includes the key or workspace."""
    return qwen_status()


@app.post("/api/compose")
async def compose(body: ComposeRequest):
    """Qwen's plan for the band's next cycle, or an error the page falls back from."""
    global COMPOSER
    if COMPOSER is None:
        try:
            COMPOSER = composer.Composer()
        except (OSError, ValueError) as exc:
            raise HTTPException(503, f"Qwen is not configured: {exc}") from None
    try:
        return await COMPOSER.compose(body)
    except composer.ComposerError as exc:
        raise HTTPException(exc.status, str(exc)) from None


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
