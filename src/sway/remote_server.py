"""Single-performer music service bound to the Colab VM's loopback interface."""

import argparse
import hmac
import json
import queue
import threading
import time
from http import HTTPStatus
from pathlib import Path

from websockets.exceptions import ConnectionClosed
from websockets.sync.server import serve

from .remote_music import ControlMessage, pack_audio
from .workers import latest, music_worker


class MusicService:
    def __init__(self, engine, token):
        self.engine = engine
        self.token = token
        self.lock = threading.Lock()

    def authorize(self, connection, request):
        if request.headers.get("Origin") or not hmac.compare_digest(
            request.headers.get("Authorization", ""), "Bearer " + self.token
        ):
            return connection.respond(HTTPStatus.UNAUTHORIZED, "Private music session\n")
        return None

    def handle(self, socket):
        stop = threading.Event()
        producer = receiver = None
        owned = False
        try:
            opening = json.loads(socket.recv(timeout=10))
            if opening == {"type": "health"}:
                socket.send(
                    json.dumps(
                        {"ready": True, "model": self.engine.model_id, "busy": self.lock.locked()}
                    )
                )
                return
            message = ControlMessage.model_validate(opening)
            if message.type != "start":
                raise ValueError("Start required")
            owned = self.lock.acquire(blocking=False)
            if not owned:
                socket.close(1013, "Another performance is active")
                return
            controls, accents, audio, status = (queue.Queue(n) for n in (2, 32, 8, 32))
            producer = threading.Thread(
                target=music_worker,
                args=(
                    controls,
                    accents,
                    audio,
                    status,
                    stop,
                    message.control.model_dump(),
                    self.engine,
                ),
                name="sway-colab-generator",
                daemon=True,
            )

            def receive_controls():
                try:
                    while not stop.is_set():
                        try:
                            raw = socket.recv(timeout=2)
                        except TimeoutError:
                            # A missing control heartbeat ends generation even if TCP remains open.
                            break
                        update = ControlMessage.model_validate_json(raw)
                        if update.type != "control":
                            break
                        latest(controls, update.control.model_dump())
                        if update.accent is not None:
                            try:
                                accents.put_nowait(
                                    {"time": time.monotonic(), "finger": update.accent}
                                )
                            except queue.Full:
                                pass
                except (ConnectionClosed, ValueError, TypeError):
                    pass
                finally:
                    stop.set()

            producer.start()
            receiver = threading.Thread(
                target=receive_controls, name="sway-colab-receiver", daemon=True
            )
            receiver.start()
            while not stop.is_set():
                try:
                    while True:
                        update = status.get_nowait()
                        socket.send(json.dumps(update))
                        if update.get("phase") == "error":
                            stop.set()
                except queue.Empty:
                    pass
                try:
                    raw, metrics = audio.get(timeout=0.04)
                    socket.send(pack_audio(raw, metrics))
                except queue.Empty:
                    pass
                if not producer.is_alive() and status.empty():
                    break
        except (ConnectionClosed, ValueError, TypeError, TimeoutError):
            pass
        finally:
            stop.set()
            socket.close()
            for thread in (receiver, producer):
                if thread is not None:
                    thread.join(timeout=5)
            if owned and (producer is None or not producer.is_alive()):
                self.lock.release()


def run_service(token_file, port, model):
    from .music_jax import JaxMusicEngine

    engine = JaxMusicEngine(model)
    service = MusicService(engine, token_file.read_text().strip())
    with serve(
        service.handle,
        "127.0.0.1",
        port,
        process_request=service.authorize,
        compression=None,
        max_size=8192,
        max_queue=4,
        close_timeout=1,
        ping_interval=5,
        ping_timeout=10,
    ) as server:
        print("Sway Colab music ready", flush=True)
        server.serve_forever()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--token-file", type=Path, required=True)
    parser.add_argument("--port", type=int, default=8766)
    parser.add_argument("--model", choices=("mrt2_base", "mrt2_small"), default="mrt2_base")
    args = parser.parse_args()
    run_service(args.token_file, args.port, args.model)


if __name__ == "__main__":
    main()
