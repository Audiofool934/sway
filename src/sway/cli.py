"""Setup, diagnostics, and the local server."""

import argparse
import importlib.metadata
import json
import platform
import shutil
import subprocess

from .config import (
    DATA,
    MRT_DIR,
    MRT_FILES,
    MRT_REPO,
    MRT_REVISION,
    ROOT,
    VISION_ASSETS,
    VISION_DIR,
)


def require_mac():
    if platform.system() != "Darwin" or platform.machine() != "arm64":
        raise SystemExit("Sway requires an Apple Silicon Mac and Python 3.12.")


def setup(include_music=True):
    require_mac()
    import httpx
    from huggingface_hub import snapshot_download

    DATA.mkdir(parents=True, exist_ok=True)
    needed = 2 if include_music else 1
    if shutil.disk_usage(DATA).free < needed * 1024**3:
        raise SystemExit(f"Setup needs at least {needed} GB of free space, including a reserve.")
    if include_music:
        snapshot_download(
            MRT_REPO, revision=MRT_REVISION, local_dir=MRT_DIR, allow_patterns=list(MRT_FILES)
        )
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
    from .qwen import qwen_status

    # The V1 instrument needs only hand tracking. MRT2 is optional: it renders V1's generated
    # harmony, and the theremin experiment needs it.
    missing = [
        str(VISION_DIR / name) for name in VISION_ASSETS if not (VISION_DIR / name).is_file()
    ]
    vendor = ROOT / "node_modules" / "@mediapipe" / "tasks-vision" / "vision_bundle.js"
    if not vendor.exists():
        missing.append(str(vendor))
    music = [str(MRT_DIR / name) for name in MRT_FILES if not (MRT_DIR / name).is_file()]
    versions = {}
    for package in ("mlx", "ai-edge-litert", "fastapi"):
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
                "missing_music_assets": music,
                "qwen": qwen_status(),
                "free_disk_gb": round(shutil.disk_usage(ROOT).free / 1024**3, 1),
            },
            indent=2,
        )
    )
    return 1 if missing else 0


def main():
    parser = argparse.ArgumentParser(description="Sway - an instrument you play with your hands")
    sub = parser.add_subparsers(dest="command", required=True)
    install = sub.add_parser("setup", help="Download pinned models and browser dependencies")
    install.add_argument(
        "--instrument-only",
        action="store_true",
        help="Install only hand tracking and browser dependencies: V1 without generated harmony",
    )
    sub.add_parser("doctor", help="Check local assets, runtime versions, and disk space")
    serve = sub.add_parser("serve", help="Open the local instrument on loopback")
    serve.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    if args.command == "setup":
        setup(include_music=not args.instrument_only)
    elif args.command == "doctor":
        raise SystemExit(doctor())
    else:
        require_mac()
        import uvicorn

        print(f"Sway is at http://127.0.0.1:{args.port}. Press Ctrl-C to stop.")
        uvicorn.run("sway.app:app", host="127.0.0.1", port=args.port, access_log=False)


if __name__ == "__main__":
    main()
