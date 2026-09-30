"""Run a source-preserving DEMON feasibility trial inside an owned Colab VM.

Uses upstream's documented setup and Session API, with no web server or LoRAs.
The uploaded input is an existing Sway render, not camera or microphone data.
"""

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import time
import traceback
import zipfile
from pathlib import Path

SOURCE_REVISION = "229af3d3d68e7e40764c93259e88149ef6546077"
ROOT = Path("/content/sway-demon-trial")
SOURCE = ROOT / "DEMON"
RESULTS = ROOT / "results"


def restore_cache(path):
    import tensorrt
    import torch

    with zipfile.ZipFile(path) as archive:
        manifest = json.loads(archive.read("manifest.json"))
        compatible = (
            manifest["source_revision"] == SOURCE_REVISION
            and manifest["gpu"] == torch.cuda.get_device_name()
            and manifest["tensorrt"] == tensorrt.__version__
        )
        if not compatible:
            print("Engine cache is incompatible with this GPU/runtime; rebuilding.", flush=True)
            return
        destination = ROOT / "models/trt_engines"
        for item in manifest["files"]:
            target = (destination / item["path"]).resolve()
            if not target.is_relative_to(destination.resolve()):
                raise ValueError("Invalid engine cache path")
            data = archive.read(item["path"])
            if hashlib.sha256(data).hexdigest() != item["sha256"]:
                raise ValueError("Engine cache hash mismatch")
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
        print(f"Restored {len(manifest['files'])} compatible engine cache files.", flush=True)


def run(command, **kwargs):
    print("Running:", " ".join(map(str, command)), flush=True)
    return subprocess.run(command, check=True, **kwargs)


def bootstrap(args):
    if not Path("/content").is_dir() or not shutil.which("nvidia-smi"):
        raise RuntimeError("This script requires a Colab NVIDIA GPU VM")
    ROOT.mkdir(exist_ok=True)
    RESULTS.mkdir(exist_ok=True)
    shutil.copy2(__file__, RESULTS / "trial-script.py")
    if shutil.disk_usage(ROOT).free < 55 * 1024**3:
        raise RuntimeError("DEMON setup needs at least 55 GB of free VM disk")
    started = time.monotonic()
    os.environ["ACESTEP_MODELS_DIR"] = str(ROOT / "models")
    os.environ["DEMON_SKIP_STARTER_LORAS"] = "1"
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
    os.environ["GIT_TERMINAL_PROMPT"] = "0"
    if not SOURCE.exists():
        run(["git", "init", str(SOURCE)])
        run(
            [
                "git",
                "-C",
                str(SOURCE),
                "remote",
                "add",
                "origin",
                "https://github.com/daydreamlive/DEMON.git",
            ]
        )
        run(["git", "-C", str(SOURCE), "fetch", "--depth", "1", "origin", SOURCE_REVISION])
        run(["git", "-C", str(SOURCE), "checkout", "--detach", SOURCE_REVISION])
    uv = shutil.which("uv")
    if not uv:
        run([sys.executable, "-m", "pip", "install", "--target", str(ROOT / "bootstrap"), "uv"])
        uv = str(ROOT / "bootstrap/bin/uv")
    timings = {}
    phase = time.monotonic()
    run([uv, "sync", "--no-dev"], cwd=SOURCE)
    timings["dependencies_seconds"] = time.monotonic() - phase
    python = SOURCE / ".venv/bin/python"
    if args.engine_cache:
        cache_path = Path(args.engine_cache)
        with cache_path.open("wb") as assembled:
            for part in sorted(cache_path.parent.glob("sway-engine-cache.part*")):
                with part.open("rb") as source:
                    shutil.copyfileobj(source, assembled)
        run(
            [
                str(python),
                str(Path(__file__).resolve()),
                "--restore-cache",
                "--engine-cache",
                args.engine_cache,
                "--input",
                args.input,
            ],
            cwd=SOURCE,
        )
    phase = time.monotonic()
    run([uv, "run", "--no-sync", "demon-setup", "--skip-loras", "--skip-sa3-source"], cwd=SOURCE)
    timings["models_and_engines_seconds"] = time.monotonic() - phase
    with (RESULTS / "dependencies.txt").open("w") as output:
        run([uv, "pip", "freeze", "--python", str(python)], stdout=output)
    lock = SOURCE / "uv.lock"
    if lock.exists():
        shutil.copy2(lock, RESULTS / "upstream-uv.lock")
    # Preserve the actual downloaded HF revisions, even where upstream uses main.
    revisions = {}
    for p in (ROOT / "models").rglob("*.metadata"):
        if ".cache/huggingface/download" in str(p):
            lines = p.read_text(errors="replace").splitlines()
            if lines:
                revisions[str(p.relative_to(ROOT / "models"))] = lines[0]
    (RESULTS / "download-revisions.json").write_text(json.dumps(revisions, indent=2) + "\n")
    timings["setup_seconds"] = time.monotonic() - started
    (RESULTS / "setup.json").write_text(json.dumps(timings, indent=2) + "\n")
    if getattr(args, "setup_only", False):
        return
    command = [str(python), str(Path(__file__).resolve()), "--run", "--input", args.input]
    if args.stream_only:
        command.append("--stream-only")
    run(command, cwd=SOURCE)


def benchmark(args):
    sys.path.insert(0, str(SOURCE))
    import numpy as np
    import soundfile as sf
    import torch
    from acestep.constants import TASK_INSTRUCTIONS
    from acestep.engine.session import Session
    from acestep.nodes import Audio
    from acestep.paths import available_trt_engines, checkpoints_dir

    torch.set_grad_enabled(False)
    torch._dynamo.config.disable = True
    if not torch.cuda.is_available():
        raise RuntimeError("CUDA is unavailable")
    input_path = Path(args.input)
    samples, sample_rate = sf.read(input_path, dtype="float32", always_2d=True)
    if sample_rate != 48_000 or samples.shape[1] != 2 or not np.isfinite(samples).all():
        raise ValueError("Provide finite, stereo 48 kHz audio")
    if not 10 <= len(samples) / sample_rate <= 60:
        raise ValueError("Provide 10-60 seconds of source audio")
    duration = len(samples) / sample_rate
    audio = Audio(waveform=torch.from_numpy(samples.T.copy()), sample_rate=sample_rate)
    engines, profile = available_trt_engines(
        duration_s=duration,
        needs=("decoder", "vae_encode", "vae_decode"),
        checkpoint="acestep-v15-turbo",
    )
    metrics = {
        "scope": "Headless engine feasibility, not live network or gesture-to-speaker latency",
        "source_revision": SOURCE_REVISION,
        "source_sha256": hashlib.sha256(input_path.read_bytes()).hexdigest(),
        "source_seconds": duration,
        "gpu": torch.cuda.get_device_name(),
        "nvidia_smi": subprocess.check_output(
            ["nvidia-smi", "--query-gpu=name,memory.total,driver_version", "--format=csv,noheader"],
            text=True,
        ).strip(),
        "trt_profile_seconds": profile,
        "trt_engines": engines,
        "versions": {"torch": torch.__version__, "cuda": torch.version.cuda},
        "timings": {},
        "renders": [],
        "streams": [],
    }

    def save_metrics():
        (RESULTS / "metrics.json").write_text(json.dumps(metrics, indent=2) + "\n")

    def measure(label, fn):
        torch.cuda.synchronize()
        started = time.perf_counter()
        result = fn()
        torch.cuda.synchronize()
        seconds = time.perf_counter() - started
        metrics["timings"][label] = seconds
        print(f"{label}: {seconds:.3f}s", flush=True)
        save_metrics()
        return result, seconds

    session = None
    try:
        session, _ = measure(
            "load",
            lambda: Session(
                project_root=str(checkpoints_dir()),
                decoder_backend="tensorrt",
                vae_backend="tensorrt",
                trt_engines=engines,
                vae_window=0.36 if args.stream_only else 0.0,
            ),
        )
        info, _ = measure("detect_source_metadata", lambda: session.audio_info(audio))
        metrics["detected_metadata"] = {k: str(v) for k, v in info.items()}
        source, _ = measure("prepare_source", lambda: session.prepare_source(audio))
        prompts = {
            "preserve": (
                "Instrumental acoustic chamber music, expressive piano and guitar, warm bass, "
                "coherent harmony, preserve the melody and rhythmic phrasing"
            ),
            "variation": (
                "Instrumental warm electric piano, soft spacious synthesizer pads, rounded bass, "
                "restrained gentle groove, preserve the melody and rhythmic phrasing"
            ),
        }
        conditions = {}
        for name, prompt in prompts.items():
            conditions[name], _ = measure(
                f"encode_{name}",
                lambda prompt=prompt: session.encode_text(
                    tags=prompt,
                    instruction=TASK_INSTRUCTIONS["cover"],
                    refer_latent=source.latent,
                    bpm=int(info["bpm"]),
                    duration=duration,
                    key=info["key"],
                ),
            )
        metrics["prompts"] = prompts
        render_cases = (
            [
                ("preserve", "preserve", 0.3),
                ("variation_gentle", "variation", 0.3),
                ("variation_stronger", "variation", 0.6),
            ]
            if not args.stream_only
            else []
        )
        for name, condition_name, denoise in render_cases:
            latent, generation = measure(
                f"generate_{name}",
                lambda condition_name=condition_name, denoise=denoise: session.generate(
                    conditioning=conditions[condition_name],
                    context_latent=source.context_latent,
                    source_latent=source.latent,
                    seed=557,
                    denoise=denoise,
                    steps=8,
                ),
            )
            rendered, decode = measure(
                f"decode_{name}", lambda latent=latent: session.decode(latent)
            )
            out = rendered.waveform.detach().cpu().float().squeeze(0).numpy().T
            if out.ndim != 2 or out.shape[1] != 2 or not np.isfinite(out).all():
                raise RuntimeError("DEMON returned invalid audio")
            peak = float(np.abs(out).max())
            attenuation = min(1.0, 0.98 / max(peak, 1e-12))
            out = out * attenuation
            sf.write(RESULTS / f"{name}.wav", out, rendered.sample_rate, subtype="PCM_24")
            metrics["renders"].append(
                {
                    "name": name,
                    "denoise": denoise,
                    "generation_seconds": generation,
                    "decode_seconds": decode,
                    "output_seconds": len(out) / rendered.sample_rate,
                    "rms": float(np.sqrt(np.mean(out**2))),
                    "raw_peak": peak,
                    "saved_attenuation": attenuation,
                }
            )
            save_metrics()

        # Use upstream's normal windowed decoder for all streaming timings.
        # The first four completed generations are warmup; include every tick,
        # including unfinished slots, when reporting throughput.
        if not args.stream_only:
            # Engine selection happens at construction, not on a window-size change.
            session.close()
            session, _ = measure(
                "load_windowed_session",
                lambda: Session(
                    project_root=str(checkpoints_dir()),
                    decoder_backend="tensorrt",
                    vae_backend="tensorrt",
                    trt_engines=engines,
                    vae_window=0.36,
                ),
            )
            source, _ = measure("prepare_windowed_source", lambda: session.prepare_source(audio))
            for name, prompt in prompts.items():
                conditions[name], _ = measure(
                    f"windowed_encode_{name}",
                    lambda prompt=prompt: session.encode_text(
                        tags=prompt,
                        instruction=TASK_INSTRUCTIONS["cover"],
                        refer_latent=source.latent,
                        bpm=int(info["bpm"]),
                        duration=duration,
                        key=info["key"],
                    ),
                )
        metrics["stream_vae_engine_paths"] = list(session._trt_vae_engine_paths)
        save_metrics()
        for depth in (1, 4):
            handle = session.stream(
                source=source,
                conditioning=conditions["preserve"],
                pipeline_depth=depth,
                steps=8,
            )
            records = []
            completed = 0
            try:
                for tick in range(500):
                    phase = "variation" if completed >= 24 else "preserve"
                    handle.conditioning = conditions[phase]
                    torch.cuda.synchronize()
                    started = time.perf_counter()
                    latent = handle.tick(denoise=0.45, seed=557, noise_sharing=0.0)
                    torch.cuda.synchronize()
                    tick_ms = (time.perf_counter() - started) * 1000
                    decode_ms = 0.0
                    if latent is not None:
                        started = time.perf_counter()
                        window = handle.decode(latent, t_start=duration / 2)
                        data = window.waveform.detach().cpu().float().numpy()
                        if not np.isfinite(data).all():
                            raise RuntimeError("Non-finite streaming window")
                        torch.cuda.synchronize()
                        decode_ms = (time.perf_counter() - started) * 1000
                    measured = completed >= 4
                    if latent is not None:
                        completed += 1
                    records.append(
                        {
                            "tick": tick,
                            "completed": latent is not None,
                            "measured": measured,
                            "prompt": phase,
                            "tick_ms": tick_ms,
                            "decode_ms": decode_ms,
                        }
                    )
                    if completed >= 44:
                        break
                if completed < 44:
                    raise RuntimeError("Streaming did not finish the requested measurements")
            finally:
                handle.close()
            measured = [r for r in records if r["measured"]]
            times = [r["tick_ms"] + r["decode_ms"] for r in measured]
            generated = sum(r["completed"] for r in measured)
            metrics["streams"].append(
                {
                    "depth": depth,
                    "steps": 8,
                    "completed_after_warmup": generated,
                    "tick_ms_p50": float(np.percentile(times, 50)),
                    "tick_ms_p95": float(np.percentile(times, 95)),
                    "completed_generations_per_second": generated / (sum(times) / 1000),
                    "scope_note": (
                        "Full-latent transformations with 0.36s window decoding; "
                        "not a measured audio lead or perceptual control latency"
                    ),
                    "records": records,
                }
            )
            save_metrics()
            print(f"Finished streaming depth {depth}", flush=True)
        metrics["torch_peak_allocated_bytes"] = torch.cuda.max_memory_allocated()
        save_metrics()
    finally:
        if session is not None:
            session.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True)
    parser.add_argument("--run", action="store_true")
    parser.add_argument("--stream-only", action="store_true")
    parser.add_argument("--engine-cache")
    parser.add_argument("--restore-cache", action="store_true")
    args = parser.parse_args()
    if not Path("/content").is_dir() or not shutil.which("nvidia-smi"):
        parser.error("Run this helper inside an owned Colab NVIDIA GPU VM")
    RESULTS.mkdir(parents=True, exist_ok=True)
    try:
        if args.restore_cache:
            restore_cache(args.engine_cache)
        elif args.run:
            benchmark(args)
        else:
            # Cooperate with a dependency preload on this owned VM.
            import fcntl

            with (ROOT / "setup.lock").open("a") as lock:
                fcntl.flock(lock, fcntl.LOCK_EX)
                bootstrap(args)
    except Exception:
        if not (RESULTS / "failure.txt").exists():
            (RESULTS / "failure.txt").write_text(traceback.format_exc())
        raise


if __name__ == "__main__":
    main()
