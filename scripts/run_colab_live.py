"""Keep one private Colab music connection open for a bounded test, then release it."""

import argparse
import importlib.metadata
import json
import os
import secrets
import shlex
import shutil
import signal
import socket
import subprocess
import time
import uuid
import zipfile
from pathlib import Path

from websockets.sync.client import connect

from sway.flow_remote import flow_config_path
from sway.remote_music import remote_config_path

ROOT = Path(__file__).resolve().parents[1]


def health(url, token):
    with connect(
        url,
        additional_headers={"Authorization": "Bearer " + token},
        proxy=None,
        open_timeout=2,
        close_timeout=1,
        compression=None,
        max_size=4096,
    ) as ws:
        ws.send('{"type":"health"}')
        return json.loads(ws.recv(timeout=2))


def stop_tunnel(process):
    if process is None:
        return
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGKILL)
        process.wait(timeout=5)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--gpu", choices=("A100", "H100"), default="A100")
    parser.add_argument(
        "--model", choices=("mrt2_base", "mrt2_small", "demon"), default="mrt2_base"
    )
    parser.add_argument(
        "--minutes", type=int, default=30, help="Test time after readiness, 5-60 minutes"
    )
    parser.add_argument("--setup-timeout", type=int, default=1200)
    parser.add_argument("--port", type=int, default=8766)
    args = parser.parse_args()
    if (
        not 5 <= args.minutes <= 60
        or not 120 <= args.setup_timeout <= 1800
        or not 1024 <= args.port <= 65535
    ):
        parser.error("Use 5-60 test minutes, 120-1800 setup seconds, and an unprivileged port")
    colab = shutil.which("colab")
    if not colab:
        raise SystemExit("Install and authenticate the Colab CLI first")
    connection_path = flow_config_path() if args.model == "demon" else remote_config_path()
    if connection_path.exists():
        raise SystemExit("A Colab connection file already exists. Stop its live runner first.")
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", args.port))
    os.umask(0o077)
    name = "sway-live-" + time.strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:4]
    folder = ROOT / ".cache/colab" / name
    folder.mkdir(parents=True, mode=0o700)
    state_file = folder / "sessions.json"
    base = [colab, "--config", str(state_file)]
    token = secrets.token_hex(32)
    token_file = folder / "music.token"
    token_file.write_text(token)
    identity = folder / "id_ed25519"
    subprocess.run(["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-f", str(identity)], check=True)
    archive = folder / "music.zip"
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as bundle:
        # Explicit allowlist: never upload the checkout, user configuration, or camera data.
        for filename in (
            "__init__.py",
            "config.py",
            "music.py",
            "ensemble.py",
            "music_jax.py",
            "workers.py",
            "schema.py",
            "remote_music.py",
            "remote_server.py",
        ):
            bundle.write(ROOT / "src/sway" / filename, "sway/" + filename)
        bundle.write(ROOT / "scripts/colab_music_trial.py", "colab_music_trial.py")
        bundle.write(ROOT / "scripts/colab_live_bootstrap.py", "colab_live_bootstrap.py")
        if args.model == "demon":
            for filename in ("flow_audio.py", "flow_schema.py", "flow_server.py"):
                bundle.write(ROOT / "src/sway" / filename, "sway/" + filename)
            bundle.write(ROOT / "scripts/colab_demon_trial.py", "colab_demon_trial.py")
        bundle.write(token_file, "music.token")
    versions = {name: importlib.metadata.version(name) for name in ("websockets", "pydantic")}
    bootstrap = folder / "bootstrap.py"
    command = [
        "python3",
        "-u",
        "/content/sway-live/colab_live_bootstrap.py",
        "--model",
        args.model,
        "--port",
        str(args.port),
        "--websockets-version",
        versions["websockets"],
        "--pydantic-version",
        versions["pydantic"],
    ]
    bootstrap.write_text(
        "import subprocess, zipfile\nfrom pathlib import Path\n"
        "root = Path('/content/sway-live')\nroot.mkdir(exist_ok=True)\n"
        "with zipfile.ZipFile('/content/sway-live.zip') as z: z.extractall(root)\n"
        "(root / 'music.token').chmod(0o600)\n"
        "log = (root / 'server.log').open('w')\n"
        "process = subprocess.Popen(" + repr(command) + ", stdout=log, "
        "stderr=subprocess.STDOUT, start_new_session=True)\n"
        "print('Remote service launched:', process.pid, flush=True)\n"
    )
    deadline = time.monotonic() + args.setup_timeout
    tunnel = None
    released = False
    started = time.time()
    expires_at = None

    def terminate(signum, frame):
        raise SystemExit(128 + signum)

    signal.signal(signal.SIGTERM, terminate)
    with (folder / "runner.log").open("w") as log:

        def run(arguments, limit=120):
            remaining = min(limit, deadline - time.monotonic())
            if remaining <= 0:
                raise TimeoutError("Colab setup timed out")
            subprocess.run(
                base + arguments,
                stdout=log,
                stderr=subprocess.STDOUT,
                timeout=remaining,
                check=True,
            )

        try:
            print(f"Allocating {args.gpu} for live {args.model}: {name}", flush=True)
            print(f"Private logs and session state: {folder}", flush=True)
            run(["new", "-s", name, "--gpu", args.gpu], limit=180)
            run(["upload", "-s", name, str(archive), "/content/sway-live.zip"])
            print("Installing and loading the remote music engine.", flush=True)
            remaining = max(1, int(deadline - time.monotonic() - 60))
            run(
                ["exec", "-s", name, "-f", str(bootstrap), "--timeout", str(remaining)],
                limit=remaining + 15,
            )
            proxy = shlex.join(base + ["ssh", "--proxy-mode", "-s", name, "-i", str(identity)])
            tunnel = subprocess.Popen(
                [
                    "ssh",
                    "-F",
                    "/dev/null",
                    "-N",
                    "-i",
                    str(identity),
                    "-o",
                    "BatchMode=yes",
                    "-o",
                    "IdentitiesOnly=yes",
                    "-o",
                    "StrictHostKeyChecking=accept-new",
                    "-o",
                    f"UserKnownHostsFile={folder / 'known_hosts'}",
                    "-o",
                    "ExitOnForwardFailure=yes",
                    "-o",
                    "ServerAliveInterval=10",
                    "-o",
                    "ServerAliveCountMax=2",
                    "-o",
                    "ConnectTimeout=30",
                    "-o",
                    f"ProxyCommand={proxy}",
                    "-L",
                    f"127.0.0.1:{args.port}:127.0.0.1:{args.port}",
                    "root@colab-runtime",
                ],
                stdout=log,
                stderr=subprocess.STDOUT,
                start_new_session=True,
            )
            url = f"ws://127.0.0.1:{args.port}"
            while time.monotonic() < deadline:
                if tunnel.poll() is not None:
                    raise RuntimeError(
                        "Colab SSH connection failed; inspect the private runner log"
                    )
                try:
                    ready = health(url, token)
                    if ready.get("ready") and ready.get("model") == args.model:
                        break
                except Exception:
                    pass
                time.sleep(2)
            else:
                raise TimeoutError("Colab music did not become ready before the setup deadline")
            expires_at = time.time() + args.minutes * 60
            connection_path.parent.mkdir(parents=True, exist_ok=True)
            with connection_path.open("x") as output:
                json.dump(
                    {
                        "url": url,
                        "token": token,
                        "model": args.model,
                        "expires_at": expires_at,
                        "session": name,
                        "runner_pid": os.getpid(),
                    },
                    output,
                )
            print(f"READY: Colab {args.model} is available for {args.minutes} minutes.", flush=True)
            print(
                "Open Sway Flow at /flow.html. Ctrl-C releases the VM."
                if args.model == "demon"
                else "Select Colab music and Qwen cloud in Sway. Ctrl-C releases the VM.",
                flush=True,
            )
            print(
                "Automatic release at "
                + time.strftime("%Y-%m-%d %H:%M:%S %Z", time.localtime(expires_at)),
                flush=True,
            )
            while time.time() < expires_at:
                if tunnel.poll() is not None:
                    raise RuntimeError("Colab SSH connection ended")
                time.sleep(1)
        finally:
            if connection_path.exists():
                try:
                    if json.loads(connection_path.read_text()).get("session") == name:
                        connection_path.unlink()
                except (OSError, ValueError):
                    pass
            try:
                stop_tunnel(tunnel)
            except (OSError, subprocess.TimeoutExpired):
                print("SSH cleanup needs verification; proceeding with VM release.", flush=True)
            print(f"Releasing Colab session {name}.", flush=True)
            try:
                result = subprocess.run(
                    base + ["stop", "-s", name], stdout=log, stderr=subprocess.STDOUT, timeout=60
                )
                released = result.returncode == 0
            except (OSError, subprocess.TimeoutExpired):
                pass
            (folder / "result.json").write_text(
                json.dumps(
                    {
                        "session": name,
                        "gpu": args.gpu,
                        "model": args.model,
                        "started_at": started,
                        "expires_at": expires_at,
                        "released": released,
                    },
                    indent=2,
                )
                + "\n"
            )
            if not released:
                print(
                    "Release needs verification: " + shlex.join(base + ["stop", "-s", name]),
                    flush=True,
                )
    if not released:
        raise SystemExit("Colab did not confirm release")


if __name__ == "__main__":
    main()
