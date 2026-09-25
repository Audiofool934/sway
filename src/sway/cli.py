"""Setup, diagnostics, a local performance server, and reproducible audio renders."""

import argparse
import importlib.metadata
import json
import platform
import shutil
import subprocess
import time
from pathlib import Path

from .config import (
    ACTION_STYLES,
    DATA,
    MRT_DIR,
    MRT_FILES,
    MRT_REPO,
    MRT_REVISION,
    PALETTES,
    ROOT,
    SEMANTIC_DIR,
    SEMANTIC_REPO,
    SEMANTIC_REVISION,
    VISION_ASSETS,
    VISION_DIR,
)


def require_mac():
    if platform.system() != "Darwin" or platform.machine() != "arm64":
        raise SystemExit("This first prototype requires an Apple Silicon Mac and Python 3.12.")


def setup(include_semantics=True):
    require_mac()
    import httpx
    from huggingface_hub import snapshot_download

    DATA.mkdir(parents=True, exist_ok=True)
    needed = 6 if include_semantics and not (SEMANTIC_DIR / "model.safetensors").exists() else 2
    if shutil.disk_usage(DATA).free < needed * 1024**3:
        raise SystemExit(f"Setup needs at least {needed} GB of free space, including a reserve.")
    snapshot_download(
        MRT_REPO, revision=MRT_REVISION, local_dir=MRT_DIR, allow_patterns=list(MRT_FILES)
    )
    if include_semantics:
        snapshot_download(SEMANTIC_REPO, revision=SEMANTIC_REVISION, local_dir=SEMANTIC_DIR)
    VISION_DIR.mkdir(parents=True, exist_ok=True)
    for name, url in VISION_ASSETS.items():
        target = VISION_DIR / name
        if target.is_file():
            continue
        temporary = target.with_suffix(".download")
        try:
            with httpx.stream("GET", url, follow_redirects=True, timeout=120) as response:
                response.raise_for_status()
                with temporary.open("wb") as output:
                    for chunk in response.iter_bytes():
                        output.write(chunk)
            temporary.replace(target)
        finally:
            temporary.unlink(missing_ok=True)
    subprocess.run(["npm", "ci", "--ignore-scripts"], cwd=ROOT, check=True)
    print("Setup complete. Run: uv run sway serve")


def doctor():
    missing = [str(MRT_DIR / name) for name in MRT_FILES if not (MRT_DIR / name).is_file()]
    missing += [
        str(VISION_DIR / name) for name in VISION_ASSETS if not (VISION_DIR / name).is_file()
    ]
    vendor = ROOT / "node_modules" / "@mediapipe" / "tasks-vision" / "vision_bundle.js"
    if not vendor.exists():
        missing.append(str(vendor))
    versions = {}
    for package in ("mlx", "mlx-vlm", "ai-edge-litert", "fastapi"):
        try:
            versions[package] = importlib.metadata.version(package)
        except importlib.metadata.PackageNotFoundError:
            versions[package] = "missing"
    print(
        json.dumps(
            {
                "platform": platform.platform(),
                "python": platform.python_version(),
                "versions": versions,
                "missing_required_assets": missing,
                "semantic_model": (SEMANTIC_DIR / "model.safetensors").is_file(),
                "free_disk_gb": round(shutil.disk_usage(ROOT).free / 1024**3, 1),
            },
            indent=2,
        )
    )
    return 1 if missing else 0


def render(args):
    require_mac()
    import numpy as np
    import soundfile as sf

    from .music import MusicEngine, NotePlanner

    if not 1 <= args.seconds <= 600:
        raise SystemExit("Choose a render length from 1 to 600 seconds.")
    output = Path(args.output).expanduser().resolve()
    if output.exists():
        raise SystemExit(f"Refusing to overwrite {output}")
    output.parent.mkdir(parents=True, exist_ok=True)
    engine = MusicEngine(seed=args.seed)
    planner = NotePlanner()
    engine.set_style(args.palette, args.action)
    for _ in range(5):
        engine.generate()
    timings = []
    sum_squares = 0.0
    peak = 0.0
    count = 0
    started = time.monotonic()
    with sf.SoundFile(output, mode="w", samplerate=48000, channels=2, subtype="PCM_16") as audio:
        for _ in range(round(args.seconds / 0.04)):
            samples = engine.generate(planner.next(args.tempo, args.action))
            audio.write(samples)
            timings.append(engine.last_ms)
            sum_squares += float(np.sum(samples**2))
            peak = max(peak, float(np.max(np.abs(samples))))
            count += samples.size
    report = {
        "output": str(output),
        "seconds": count / 2 / 48000,
        "generation_seconds": round(time.monotonic() - started, 2),
        "frame_median_ms": round(float(np.median(timings)), 2),
        "frame_p95_ms": round(float(np.percentile(timings, 95)), 2),
        "frames_over_40ms": sum(t > 40 for t in timings),
        "rms": (sum_squares / count) ** 0.5,
        "peak": peak,
        "seed": args.seed,
        "palette": args.palette,
        "action": args.action,
        "requested_tempo": args.tempo,
        "model_revision": MRT_REVISION,
    }
    output.with_suffix(".json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))


def main():
    parser = argparse.ArgumentParser(description="Sway - a generative theremin")
    sub = parser.add_subparsers(dest="command", required=True)
    install = sub.add_parser("setup", help="Download pinned models and browser dependencies")
    install.add_argument("--music-only", action="store_true", help="Skip the optional VLM")
    sub.add_parser("doctor", help="Check local assets, runtime versions, and disk space")
    serve = sub.add_parser("serve", help="Open the local instrument on loopback")
    serve.add_argument("--port", type=int, default=8765)
    audio = sub.add_parser("render", help="Generate a WAV without a camera or browser")
    audio.add_argument("--seconds", type=float, default=30)
    audio.add_argument("--output", required=True)
    audio.add_argument("--palette", choices=PALETTES, default="chamber")
    audio.add_argument("--action", choices=ACTION_STYLES, default="piano")
    audio.add_argument("--tempo", type=float, default=108)
    audio.add_argument("--seed", type=int, default=7)
    args = parser.parse_args()
    if args.command == "setup":
        setup(not args.music_only)
    elif args.command == "doctor":
        raise SystemExit(doctor())
    elif args.command == "render":
        if not 50 <= args.tempo <= 180:
            parser.error("Tempo must be between 50 and 180 BPM")
        render(args)
    else:
        require_mac()
        import uvicorn

        print(f"Sway is at http://127.0.0.1:{args.port}. Press Ctrl-C to stop.")
        uvicorn.run("sway.app:app", host="127.0.0.1", port=args.port, access_log=False)


if __name__ == "__main__":
    main()
