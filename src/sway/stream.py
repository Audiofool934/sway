"""A live MRT2 stream that one browser window steers, one 40 ms frame at a time."""

import asyncio
import ctypes
import logging
import sys
import time
from urllib.parse import urlsplit

from pydantic import BaseModel, ValidationError
from starlette.websockets import WebSocketDisconnect

from .music import MODEL_THREAD

log = logging.getLogger(__name__)


def promote_thread() -> bool:
    """Raise this thread to macOS's interactive priority, so the camera cannot starve it.

    Call it before MLX creates its native threads. Returns whether it worked.
    """
    if sys.platform != "darwin":
        return False
    runtime = ctypes.CDLL("/usr/lib/libSystem.B.dylib")
    promote = runtime.pthread_set_qos_class_self_np
    promote.argtypes = (ctypes.c_uint, ctypes.c_int)
    promote.restype = ctypes.c_int
    return promote(0x21, 0) == 0


class StreamService:
    """Run one renderer on the model thread, and let one window at a time play it.

    The renderer has `start(seed)`, which returns details for the page, and
    `render(control)`, which returns 40 ms of stereo float32 audio and its stats.
    Subclasses name the stream and its controls, say whether the model is installed,
    and say how a controller that went silent is released.
    """

    name = "stream"
    control: type[BaseModel]
    busy = "A performance is already open"

    def __init__(self, renderer):
        self.renderer = renderer
        self.owner = None

    def ready(self) -> bool:
        raise NotImplementedError

    def release(self, control):
        raise NotImplementedError

    async def call(self, fn, *args):
        future = asyncio.get_running_loop().run_in_executor(MODEL_THREAD, fn, *args)
        try:
            return await asyncio.shield(future)
        except asyncio.CancelledError:
            # Finish the one in-flight model frame before releasing session ownership.
            await future
            raise

    async def connect(self, websocket):
        origin = websocket.headers.get("origin")
        if websocket.url.hostname not in ("127.0.0.1", "localhost", "testserver") or (
            origin and urlsplit(origin).netloc != websocket.headers.get("host")
        ):
            await websocket.close(code=1008)
            return
        if self.owner is not None:
            await websocket.close(code=1008, reason=self.busy)
            return
        if not self.ready():
            await websocket.close(code=1008, reason="Local MRT2 assets are missing")
            return
        owner = object()
        self.owner = owner
        control = self.control()
        received = time.monotonic()

        async def receive():
            nonlocal control, received
            while True:
                message = await websocket.receive_text()
                if len(message) > 2048:
                    await websocket.close(code=1009)
                    return
                try:
                    candidate = self.control.model_validate_json(message)
                except ValidationError:
                    await websocket.close(code=1008, reason="Invalid musical controls")
                    return
                if candidate.seq >= control.seq:
                    control, received = candidate, time.monotonic()

        receiver = None
        try:
            await websocket.accept()
            receiver = asyncio.create_task(receive())
            seed = time.time_ns() % (2**31 - 1)
            await websocket.send_json({"type": "loading"})
            prepared = await self.call(self.renderer.start, seed)
            if receiver.done():
                return
            await websocket.send_json(
                {"type": "ready", "seed": seed, "sampleRate": 48000, **prepared}
            )
            deadline = time.monotonic()
            while not receiver.done():
                current = control
                # A disconnected/frozen controller must not sustain a note forever.
                if time.monotonic() - received > 0.6:
                    current = self.release(current)
                render_started = time.monotonic()
                audio, stats = await self.call(self.renderer.render, current)
                stats["renderMs"] = round((time.monotonic() - render_started) * 1000, 1)
                if receiver.done():
                    break
                if stats["frame"] % 5 == 0:
                    await asyncio.wait_for(
                        websocket.send_json({"type": "frame", **stats}), timeout=2
                    )
                await asyncio.wait_for(websocket.send_bytes(audio), timeout=2)
                deadline = max(deadline + 0.04, time.monotonic() - 0.08)
                await asyncio.sleep(max(0, deadline - time.monotonic()))
        except (WebSocketDisconnect, TimeoutError):
            pass
        except Exception:
            log.exception("The %s stream stopped", self.name)
            try:
                await websocket.close(code=1011, reason="Sound generation stopped; please restart")
            except (RuntimeError, WebSocketDisconnect):
                pass
        finally:
            if receiver is not None:
                receiver.cancel()
                await asyncio.gather(receiver, return_exceptions=True)
            if self.owner is owner:
                self.owner = None
