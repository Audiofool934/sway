"""Warm DEMON engine on the GPU; browser playback never waits on this service."""

import hashlib
import hmac
import json
import threading
import time
from http import HTTPStatus

import numpy as np
from websockets.sync.server import serve

from .flow_audio import MAX_AUDIO_BYTES, RATE, prepare_loop, read_wave, wave_bytes
from .flow_schema import FlowWireRequest


class DemonEngine:
    def __init__(self):
        import torch
        from acestep.engine.session import Session
        from acestep.paths import available_trt_engines, checkpoints_dir

        torch._dynamo.config.disable = True
        engines, _ = available_trt_engines(
            duration_s=32,
            needs=("decoder", "vae_encode", "vae_decode"),
            checkpoint="acestep-v15-turbo",
        )
        self.session = Session(
            project_root=str(checkpoints_dir()),
            decoder_backend="tensorrt",
            vae_backend="tensorrt",
            trt_engines=engines,
            vae_window=0.0,
        )
        self.source_hash = None
        self.source = None
        self.conditions = {}

    def render(self, request, raw):
        import torch
        from acestep.constants import TASK_INSTRUCTIONS
        from acestep.nodes import Audio

        started = time.monotonic()
        with torch.inference_mode():
            source = None
            if request.type == "transform":
                digest = hashlib.sha256(raw).hexdigest()
                if digest != self.source_hash:
                    samples = read_wave(raw)
                    if abs(len(samples) / RATE - request.seconds) > 0.1:
                        raise ValueError("Source and beat grid disagree")
                    self.source = self.session.prepare_source(
                        Audio(waveform=torch.from_numpy(samples.T.copy()), sample_rate=RATE)
                    )
                    self.source_hash, self.conditions = digest, {}
                source = self.source
            condition_key = (request.type, request.prompt, request.bpm, request.bars, request.key)
            if condition_key not in self.conditions:
                if len(self.conditions) >= 8:
                    self.conditions.clear()
                self.conditions[condition_key] = self.session.encode_text(
                    tags=request.prompt,
                    instruction=TASK_INSTRUCTIONS["cover" if source else "text2music"],
                    refer_latent=source.latent if source else None,
                    bpm=request.bpm,
                    duration=request.seconds,
                    key=request.key,
                )
            latent = self.session.generate(
                conditioning=self.conditions[condition_key],
                context_latent=source.context_latent if source else None,
                source_latent=source.latent if source else None,
                duration=request.seconds,
                seed=request.seed,
                denoise=request.strength if source else 1.0,
                steps=8,
            )
            decoded = self.session.decode(latent)
            audio = decoded.waveform.detach().cpu().float().squeeze(0).numpy().T
            audio = prepare_loop(audio, round(request.seconds * RATE))
        metadata = {
            "engine_ms": round((time.monotonic() - started) * 1000, 1),
            "source_sha256": self.source_hash if source else None,
            "sample_rate": RATE,
            "frames": len(audio),
            "peak": float(np.abs(audio).max()),
        }
        return wave_bytes(audio), metadata


class FlowService:
    def __init__(self, engine, token):
        self.engine, self.token = engine, token
        self.lock = threading.Lock()
        self.source_raw = None
        self.source_digest = None

    def authorize(self, connection, request):
        if request.headers.get("Origin") or not hmac.compare_digest(
            request.headers.get("Authorization", ""), "Bearer " + self.token
        ):
            return connection.respond(HTTPStatus.UNAUTHORIZED, "Private Flow session\n")
        return None

    def handle(self, socket):
        owned = False
        try:
            opening = socket.recv(timeout=10)
            if opening == '{"type":"health"}':
                socket.send(json.dumps({"ready": True, "model": "demon"}))
                return
            request = FlowWireRequest.model_validate_json(opening)
            owned = self.lock.acquire(blocking=False)
            if not owned:
                socket.send('{"error":"Engine busy"}')
                return
            raw = None
            if request.type == "transform":
                required = not request.source_sha256 or request.source_sha256 != self.source_digest
                socket.send(json.dumps({"source_required": required}))
                raw = socket.recv(timeout=30) if required else self.source_raw
                if (
                    not isinstance(raw, bytes)
                    or hashlib.sha256(raw).hexdigest() != request.source_sha256
                ):
                    raise ValueError("Source hash mismatch")
                self.source_raw, self.source_digest = raw, request.source_sha256
            audio, metadata = self.engine.render(request, raw)
            if request.type == "generate":
                self.source_raw = audio
                self.source_digest = hashlib.sha256(audio).hexdigest()
            socket.send(json.dumps(metadata, allow_nan=False))
            socket.send(audio)
            print(json.dumps({"type": request.type, **metadata}), flush=True)
        except Exception:
            # The private VM log holds diagnostics, never credentials or camera data.
            import traceback

            traceback.print_exc()
            try:
                socket.send('{"error":"Transformation failed"}')
            except Exception:
                pass
        finally:
            if owned:
                self.lock.release()


def run_service(token_file, port):
    engine = DemonEngine()
    service = FlowService(engine, token_file.read_text().strip())
    try:
        with serve(
            service.handle,
            "127.0.0.1",
            port,
            process_request=service.authorize,
            compression=None,
            max_size=MAX_AUDIO_BYTES,
            max_queue=2,
            close_timeout=1,
        ) as server:
            print("Sway Flow ready", flush=True)
            server.serve_forever()
    finally:
        engine.session.close()
