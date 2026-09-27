"""Run one bounded DEMON experiment, collect its artifacts, and release its GPU."""

import argparse
import hashlib
import json
import shutil
import signal
import subprocess
import time
import uuid
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def package_engine_cache(cache, destination):
    """Validate and package only complete engine/metadata pairs before allocation."""
    manifest = json.loads((cache / "manifest.json").read_text())
    entries = {item["path"]: item for item in manifest["files"]}
    selected = []
    for name in entries:
        if not name.endswith(".engine") or name + ".metadata.json" not in entries:
            continue
        for path in (name, name + ".metadata.json"):
            source = (cache / path).resolve()
            if not source.is_relative_to(cache.resolve()):
                raise ValueError("Invalid engine cache path")
            if hashlib.sha256(source.read_bytes()).hexdigest() != entries[path]["sha256"]:
                raise ValueError("Engine cache hash mismatch")
            selected.append(entries[path])
    if not selected:
        raise ValueError("No complete engines in the cache")
    manifest["files"] = selected
    with zipfile.ZipFile(destination, "w", compression=zipfile.ZIP_STORED) as archive:
        archive.writestr("manifest.json", json.dumps(manifest))
        for item in selected:
            archive.write(cache / item["path"], item["path"])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True, help="A 10-60s stereo 48kHz WAV")
    parser.add_argument("--gpu", choices=("A100", "H100", "L4"), default="A100")
    parser.add_argument("--timeout", type=int, default=2400, help="Total work limit in seconds")
    parser.add_argument("--stream-only", action="store_true", help="Skip completed batch renders")
    parser.add_argument("--engine-cache", type=Path, help="Compatible retained engine directory")
    args = parser.parse_args()
    if not args.input.is_file() or not 300 <= args.timeout <= 5400:
        parser.error("Provide an existing input WAV and a 300-5400 second work limit")
    import soundfile as sf

    info = sf.info(args.input)
    if info.samplerate != 48000 or info.channels != 2 or not 10 <= info.duration <= 60:
        parser.error("Input must be stereo, 48kHz, and 10-60 seconds long")
    colab = shutil.which("colab")
    if not colab:
        raise SystemExit("Install and authenticate the Colab CLI first")
    name = "sway-demon-" + time.strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:4]
    output = ROOT / "outputs/colab" / name
    state = ROOT / ".cache/colab" / name
    output.mkdir(parents=True)
    state.mkdir(parents=True, mode=0o700)
    shutil.copy2(args.input, output / "source.wav")
    cache_bundle = state / "engine-cache.zip"
    cache_parts = []
    if args.engine_cache:
        package_engine_cache(args.engine_cache, cache_bundle)
        with cache_bundle.open("rb") as source:
            while data := source.read(16 * 1024**2):
                part = state / f"sway-engine-cache.part{len(cache_parts):03d}"
                part.write_bytes(data)
                cache_parts.append(part)
        cache_bundle.unlink()
    base = [colab, "--config", str(state / "sessions.json")]
    deadline = time.monotonic() + args.timeout
    released = False
    allocated = False
    started = time.time()

    def terminate(signum, frame):
        raise SystemExit(128 + signum)

    signal.signal(signal.SIGTERM, terminate)
    with (output / "run.log").open("w") as log:

        def run(arguments, limit=120, check=True):
            remaining = min(limit, deadline - time.monotonic())
            if remaining <= 0:
                raise TimeoutError("The DEMON experiment reached its work limit")
            return subprocess.run(
                base + arguments,
                stdout=log,
                stderr=subprocess.STDOUT,
                timeout=remaining,
                check=check,
            )

        try:
            print(f"Allocating {args.gpu}; session {name}", flush=True)
            print(f"Results and logs: {output}", flush=True)
            # Attempt cleanup even if allocation partially succeeds then errors.
            allocated = True
            run(["new", "-s", name, "--gpu", args.gpu], limit=180)
            run(["upload", "-s", name, str(args.input.resolve()), "/content/sway-source.wav"])
            for part in cache_parts:
                run(
                    ["upload", "-s", name, str(part), f"/content/{part.name}"],
                    limit=90,
                )
            run(
                [
                    "upload",
                    "-s",
                    name,
                    str(ROOT / "scripts/colab_demon_trial.py"),
                    "/content/sway_demon_trial.py",
                ]
            )
            remaining = max(1, int(deadline - time.monotonic() - 150))
            launcher = state / "launch.py"
            command = [
                "python3",
                "-u",
                "/content/sway_demon_trial.py",
                "--input",
                "/content/sway-source.wav",
            ]
            if args.stream_only:
                command.append("--stream-only")
            if args.engine_cache:
                command += ["--engine-cache", "/content/sway-engine-cache.zip"]
            launcher.write_text(
                "import json, subprocess, shutil, time\nfrom pathlib import Path\n"
                "started = time.time()\n"
                f"process = subprocess.Popen({command!r}, stdout=subprocess.PIPE, "
                "stderr=subprocess.STDOUT, text=True, bufsize=1)\n"
                "for line in process.stdout:\n    print(line, end='', flush=True)\n"
                "code = process.wait()\n"
                "results = Path('/content/sway-demon-trial/results')\n"
                "results.mkdir(parents=True, exist_ok=True)\n"
                "(results/'remote-status.json').write_text(json.dumps("
                "{'returncode': code, 'wall_seconds': time.time()-started}))\n"
                "shutil.make_archive('/content/sway-demon-results', 'zip', results)\n"
            )
            print(
                "Installing the pinned upstream runtime and measuring transformations.", flush=True
            )
            run(
                ["exec", "-s", name, "-f", str(launcher), "--timeout", str(remaining)],
                limit=remaining + 15,
            )
            run(
                [
                    "download",
                    "-s",
                    name,
                    "/content/sway-demon-results.zip",
                    str(output / "results.zip"),
                ],
                limit=120,
            )
            # The archive is produced by our launcher, but still constrain member paths.
            with zipfile.ZipFile(output / "results.zip") as archive:
                for member in archive.infolist():
                    target = (output / member.filename).resolve()
                    if not target.is_relative_to(output.resolve()):
                        raise ValueError("Unexpected path in experiment archive")
                archive.extractall(output)
            status = json.loads((output / "remote-status.json").read_text())
            if status.get("returncode") != 0:
                raise RuntimeError(f"Remote trial failed; see {output / 'failure.txt'}")
            shutil.copy2(args.input, output / "source.wav")
            print("Listening samples and measurements collected.", flush=True)
        finally:
            if allocated:
                print(f"Releasing owned Colab session {name}.", flush=True)
                try:
                    result = subprocess.run(
                        base + ["stop", "-s", name],
                        stdout=log,
                        stderr=subprocess.STDOUT,
                        timeout=60,
                    )
                    released = result.returncode == 0
                except subprocess.TimeoutExpired:
                    released = False
            (output / "session.json").write_text(
                json.dumps(
                    {
                        "session": name,
                        "gpu_requested": args.gpu,
                        "released": released,
                        "started_at": started,
                        "ended_at": time.time(),
                        "timeout_seconds": args.timeout,
                        "source_sha256": hashlib.sha256(args.input.read_bytes()).hexdigest(),
                        "state_file": str(state / "sessions.json"),
                    },
                    indent=2,
                )
                + "\n"
            )
            if allocated and not released:
                print(f"Cleanup needs verification: {base!r} stop -s {name}", flush=True)
            for part in cache_parts:
                part.unlink(missing_ok=True)
    if not released:
        raise SystemExit("Colab did not confirm session release")


if __name__ == "__main__":
    main()
