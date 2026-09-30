"""Private Colab connection and streaming protocol; never sends camera images or API keys."""

import json
import os
import queue
import struct
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit

import numpy as np
from pydantic import BaseModel, ConfigDict, Field
from websockets.exceptions import ConnectionClosed
from websockets.sync.client import connect

from .config import DATA
from .schema import Action, Arrangement
from .workers import latest


def remote_config_path():
    return Path(os.environ.get("SWAY_REMOTE_MUSIC_CONFIG", DATA / "colab-live.json")).expanduser()


@dataclass(frozen=True)
class RemoteMusicConfig:
    url: str
    token: str = field(repr=False)
    expires_at: float
    model: str = "mrt2_base"

    @classmethod
    def load(cls, path=None, models=("mrt2_base", "mrt2_small")):
        try:
            path = path or remote_config_path()
            if path.stat().st_mode & 0o077:
                raise ValueError("Colab connection file must have mode 600")
            values = json.loads(path.read_text())
            config = cls(**{key: values[key] for key in ("url", "token", "expires_at", "model")})
            target = urlsplit(config.url)
            if (
                target.scheme != "ws"
                or target.hostname != "127.0.0.1"
                or not target.port
                or target.username
                or target.password
                or target.query
                or target.fragment
                or target.path not in ("", "/")
                or not isinstance(config.token, str)
                or len(config.token) != 64
                or any(c not in "0123456789abcdef" for c in config.token)
                or type(config.expires_at) not in (int, float)
                or not time.time() < config.expires_at < time.time() + 4 * 3600
                or config.model not in models
            ):
                raise ValueError("Invalid or expired Colab connection")
            return config
        except (OSError, ValueError, KeyError, TypeError, AttributeError):
            raise ValueError("Start the Colab live runner, then reload Sway") from None


def remote_music_status():
    try:
        config = RemoteMusicConfig.load()
        return {"configured": True, "model": config.model, "expires_at": config.expires_at}
    except ValueError as exc:
        return {"configured": False, "error": str(exc)}


class MusicControl(BaseModel):
    """An allowlist excludes camera frames, landmarks, and Qwen credentials."""

    model_config = ConfigDict(serialize_by_alias=True)
    palette: Literal["chamber", "nocturne", "groove"]
    action: Action
    articulation: Literal["detached", "flowing", "accented", "unknown"] = "unknown"
    bpm: float = Field(ge=50, le=180, allow_inf_nan=False)
    energy: float = Field(default=0, ge=0, le=1, allow_inf_nan=False)
    pitch_register: float = Field(default=0.5, alias="register", ge=0, le=1, allow_inf_nan=False)
    tracking_gain: float = Field(default=1, ge=0, le=1, allow_inf_nan=False)
    guided: bool = False
    control_seq: int = Field(default=0, ge=0)
    conducted: bool = False
    arrangement: Arrangement | None = None
    arrangement_revision: int = Field(default=0, ge=0)


class ControlMessage(BaseModel):
    type: Literal["start", "control"]
    control: MusicControl
    accent: int | None = Field(default=None, ge=0, le=9)


def pack_audio(raw, metrics):
    header = json.dumps(metrics, allow_nan=False, separators=(",", ":")).encode()
    return struct.pack("!I", len(header)) + header + raw


def unpack_audio(packet):
    if len(packet) < 4:
        raise ValueError("Invalid remote audio packet")
    size = struct.unpack("!I", packet[:4])[0]
    if size > 4096 or len(packet) != 4 + size + 1920 * 2 * 4:
        raise ValueError("Invalid remote audio packet")
    metrics = json.loads(packet[4 : 4 + size])
    raw = packet[4 + size :]
    if not isinstance(metrics, dict) or not np.isfinite(np.frombuffer(raw, dtype="<f4")).all():
        raise ValueError("Invalid remote audio packet")
    return raw, metrics


def remote_music_worker(controls, accents, audio, status, stop, initial):
    sender = None
    done = threading.Event()
    try:
        config = RemoteMusicConfig.load()
        with connect(
            config.url,
            additional_headers={"Authorization": "Bearer " + config.token},
            proxy=None,
            compression=None,
            open_timeout=10,
            close_timeout=1,
            ping_interval=5,
            ping_timeout=10,
            max_size=24_000,
            max_queue=8,
        ) as socket:
            first = MusicControl.model_validate(initial).model_dump()
            socket.send(json.dumps({"type": "start", "control": first}))
            sent = {}

            def send_controls():
                current, sequence = first, 0
                try:
                    while not stop.is_set() and not done.is_set():
                        try:
                            while True:
                                current = MusicControl.model_validate(
                                    controls.get_nowait()
                                ).model_dump()
                        except queue.Empty:
                            pass
                        accent = None
                        try:
                            event = accents.get_nowait()
                            if time.monotonic() - event["time"] <= 0.4:
                                accent = event["finger"] if event["finger"] is not None else 0
                        except queue.Empty:
                            pass
                        sequence += 1
                        current["control_seq"] = sequence
                        sent[sequence] = time.monotonic()
                        sent.pop(sequence - 250, None)
                        socket.send(
                            json.dumps({"type": "control", "control": current, "accent": accent})
                        )
                        done.wait(0.04)
                except (ConnectionClosed, OSError, ValueError):
                    done.set()

            sender = threading.Thread(target=send_controls, name="sway-colab-controls", daemon=True)
            sender.start()
            last_audio = time.monotonic()
            dropped = 0
            while not stop.is_set():
                if done.is_set():
                    raise ConnectionError("Colab control connection closed")
                if time.time() >= config.expires_at:
                    raise ConnectionError("Colab test window ended")
                try:
                    packet = socket.recv(timeout=0.25)
                except TimeoutError:
                    if time.monotonic() - last_audio > 15:
                        raise ConnectionError("Colab stopped delivering audio") from None
                    continue
                if isinstance(packet, str):
                    update = json.loads(packet)
                    if update.get("phase") == "error":
                        raise ConnectionError("Remote music generation stopped")
                    latest(
                        status,
                        {**update, "worker": "music", "backend": "colab", "model": config.model},
                    )
                    continue
                raw, metrics = unpack_audio(packet)
                last_audio = time.monotonic()
                when = sent.get(metrics.get("control_seq"))
                if when is not None:
                    metrics["control_to_audio_ms"] = round((last_audio - when) * 1000, 1)
                metrics["network_dropped_frames"] = dropped
                try:
                    audio.put_nowait((raw, metrics))
                except queue.Full:
                    dropped += 1
    except Exception:
        # No raw connection exceptions: they may carry authentication headers.
        latest(
            status,
            {
                "worker": "music",
                "phase": "error",
                "backend": "colab",
                "error": "Colab music disconnected. Check the live runner, "
                "then restart the performance.",
            },
        )
    finally:
        done.set()
        if sender is not None:
            sender.join(timeout=2)
