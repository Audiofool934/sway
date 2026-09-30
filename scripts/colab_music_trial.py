"""Run inside an owned Colab VM: install pinned MRT2, render, and measure generation.

The local runner uploads this file explicitly. No Sway credentials or camera data
are needed. This is a generation benchmark, not a live network audio server.
"""

import argparse
import importlib.metadata
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

SOURCE_REVISION = "694a545e4ba0b88bf1150137b129582166d3e07f"
ASSET_REVISION = "010aa0dcb0dfd27b24f0ad07b4dad63e8f9521cc"
ROOT = Path("/content/sway-music-trial")


def prepare_runtime():
    if not Path("/content").is_dir() or not shutil.which("nvidia-smi"):
        raise RuntimeError("Run this script on a Colab NVIDIA GPU VM")
    ROOT.mkdir(exist_ok=True)
    if shutil.disk_usage(ROOT).free < 20 * 1024**3:
        raise RuntimeError("The trial needs at least 20 GB of free VM disk space")
    source = ROOT / "magenta-realtime"
    if not source.exists():
        subprocess.run(
            [
                "git",
                "clone",
                "--no-checkout",
                "https://github.com/magenta/magenta-realtime.git",
                str(source),
            ],
            check=True,
        )
    subprocess.run(["git", "-C", str(source), "checkout", "--detach", SOURCE_REVISION], check=True)
    subprocess.run(
        ["git", "-C", str(source), "submodule", "update", "--init", "--recursive"], check=True
    )
    uv = shutil.which("uv")
    if not uv:
        subprocess.run(
            [sys.executable, "-m", "pip", "install", "--target", str(ROOT / "bootstrap"), "uv"],
            check=True,
        )
        uv = str(ROOT / "bootstrap/bin/uv")
    python = ROOT / "venv/bin/python"
    if not python.exists():
        subprocess.run([uv, "venv", "--python", "3.12", str(ROOT / "venv")], check=True)
    subprocess.run(
        [
            uv,
            "pip",
            "install",
            "--python",
            str(python),
            "jax[cuda12]==0.10.1",
            "flax==0.12.7",
            "optax==0.2.8",
            "numpy==2.3.5",
            "ai-edge-litert==2.1.5",
            f"{source}[jax]",
        ],
        check=True,
    )
    return python


def bootstrap(args):
    python = prepare_runtime()
    extra = ["--conditioning", args.conditioning] if args.conditioning else []
    subprocess.run(
        [
            str(python),
            str(Path(__file__).resolve()),
            "--run",
            "--model",
            args.model,
            "--seconds",
            str(args.seconds),
            *extra,
        ],
        check=True,
    )


def benchmark(args):
    os.environ["MAGENTA_HOME"] = str(ROOT / "assets")
    os.environ["XLA_PYTHON_CLIENT_PREALLOCATE"] = "false"
    os.environ["JAX_PLATFORMS"] = "cuda"
    import jax
    import numpy as np
    import soundfile as sf
    from huggingface_hub import snapshot_download
    from magenta_rt import MagentaRT2Jax, paths
    from magenta_rt.config import MUSICCOCA, PIANOROLL_WITH_ONSETS
    from magenta_rt.musiccoca import MusicCoCa

    devices = jax.devices()
    if not any(device.platform == "gpu" for device in devices):
        raise RuntimeError("JAX did not discover a GPU")
    output = ROOT / "results"
    output.mkdir(exist_ok=True)
    snapshot_download(
        "google/magenta-realtime-2",
        revision=ASSET_REVISION,
        local_dir=str(paths.magenta_home()),
        allow_patterns=[
            f"checkpoints/{args.model}.safetensors",
            "resources/musiccoca/spm.model",
            "resources/musiccoca/text_encoder.tflite",
            "resources/musiccoca/pretrained_vector_quantizer.tflite",
        ],
    )
    style = MusicCoCa()
    if args.conditioning:
        return harmony(args, devices, output, style, MagentaRT2Jax)
    prompts = [
        "Expressive acoustic piano, warm bass, intimate acoustic chamber music, coherent harmony",
        "Acoustic guitar-led music, rhythmic guitar strumming, warm bass, coherent harmony",
    ]
    styles = []
    for prompt in prompts:
        tokens = style.tokenize(style.embed(prompt, use_mapper=False)).tolist()[:12]
        tokens[6:] = [-1] * 6
        styles.append(tokens)
    started = time.monotonic()
    model = MagentaRT2Jax(
        size=args.model,
        style_model=style,
        temperature=1.1,
        top_k=40,
        cfg_scales={"musiccoca": 3.0, "notes": 5.0, "drums": 1.0},
    )
    load_and_compile_seconds = time.monotonic() - started
    state = None
    for _ in range(50):
        _, state = model.generate(conditioning={MUSICCOCA.key: styles[0]}, frames=1, state=state)
    samples, frame_times, trace = [], [], []
    frame_count = round(args.seconds * 25)
    middle = frame_count // 2
    render_start = time.monotonic()
    for frame in range(frame_count):
        phase = int(frame >= middle)
        pitch = (60, 64, 67, 72)[(frame // 12) % 4]
        notes = [-1] * 128
        notes[48:96] = [0] * 48
        beat_frame = frame % 12
        if beat_frame < 8:
            notes[pitch] = 2 if beat_frame == 0 else 1
        conditioning = {MUSICCOCA.key: styles[phase], PIANOROLL_WITH_ONSETS.key: notes}
        started = time.monotonic()
        wav, state = model.generate(conditioning=conditioning, frames=1, state=state)
        # generate() transfers the waveform to the host, so this includes device completion.
        frame_times.append((time.monotonic() - started) * 1000)
        if wav.samples.shape != (1920, 2) or not np.isfinite(wav.samples).all():
            raise RuntimeError("MRT2 returned an invalid stereo frame")
        samples.append(wav.samples)
        if beat_frame == 0 or frame == middle:
            trace.append(
                {"frame": frame, "time_seconds": frame / 25, "pitch": pitch, "style": phase}
            )
    elapsed = time.monotonic() - render_start
    audio = np.concatenate(samples)
    sf.write(output / "performance.wav", audio, 48000, subtype="PCM_16")
    metrics = {
        "scope": "GPU generation only; network and playback latency are not measured",
        "model": args.model,
        "source_revision": SOURCE_REVISION,
        "asset_revision": ASSET_REVISION,
        "gpu": [str(device) for device in devices],
        "nvidia_smi": subprocess.check_output(
            ["nvidia-smi", "--query-gpu=name,memory.total,driver_version", "--format=csv,noheader"],
            text=True,
        ).strip(),
        "versions": {
            name: importlib.metadata.version(name)
            for name in ("jax", "jaxlib", "flax", "numpy", "ai-edge-litert")
        },
        "sample_rate": 48000,
        "channels": 2,
        "seconds": len(audio) / 48000,
        "load_and_compile_seconds": load_and_compile_seconds,
        "warmup_frames": 50,
        "generation_seconds": elapsed,
        "realtime_factor": args.seconds / elapsed,
        "frame_ms_p50": float(np.percentile(frame_times, 50)),
        "frame_ms_p95": float(np.percentile(frame_times, 95)),
        "frame_ms_max": max(frame_times),
        "frames_over_40_ms": sum(t > 40 for t in frame_times),
        "rms": float(np.sqrt(np.mean(audio**2))),
        "peak": float(np.max(np.abs(audio))),
        "prompts": prompts,
        "requested_note_interval_ms": 480,
        "sampling_note": "The pinned upstream JAX sampler initializes its PRNG with seed 0.",
        "frame_times_ms": frame_times,
    }
    (output / "metrics.json").write_text(json.dumps(metrics, indent=2) + "\n")
    (output / "control-trace.json").write_text(json.dumps(trace, indent=2) + "\n")
    print(
        json.dumps(
            {key: value for key, value in metrics.items() if key != "frame_times_ms"}, indent=2
        ),
        flush=True,
    )


def harmony(args, devices, output, style, model_class):
    """Render the V1 instrument's written notes, frame by frame, in each palette.

    The conditioning file holds one row of 128 note states per 40 ms frame, made by Sway's
    own arrangement code, so this model hears exactly what the Mac's model hears. Sampling
    matches the Mac: temperature 1.1, top-k 40, style guidance 3, note guidance 1, no drums.
    """
    import numpy as np
    import soundfile as sf
    from magenta_rt.config import DRUM_PIANOROLL, MUSICCOCA, PIANOROLL_WITH_ONSETS

    data = np.load(args.conditioning)
    rows = data["tokens"].astype(int)
    palettes = [str(value) for value in data["palettes"]]
    prompts = [str(value) for value in data["prompts"]]
    started = time.monotonic()
    model = model_class(
        size=args.model,
        style_model=style,
        temperature=1.1,
        top_k=40,
        cfg_scales={"musiccoca": 3.0, "notes": 1.0, "drums": 1.0},
    )
    load_and_compile_seconds = time.monotonic() - started
    quiet = {PIANOROLL_WITH_ONSETS.key: [0] * 128, DRUM_PIANOROLL.key: [0]}
    state = None
    for _ in range(50):
        _, state = model.generate(conditioning=quiet, frames=1, state=state)
    results = {}
    for palette, prompt in zip(palettes, prompts, strict=True):
        tokens = style.tokenize(style.embed(prompt, use_mapper=False)).tolist()[:12]
        tokens[6:] = [-1] * 6
        state, samples, frame_times = None, [], []
        for row in rows:
            conditioning = {
                MUSICCOCA.key: tokens,
                PIANOROLL_WITH_ONSETS.key: row.tolist(),
                DRUM_PIANOROLL.key: [0],
            }
            begun = time.monotonic()
            wav, state = model.generate(conditioning=conditioning, frames=1, state=state)
            frame_times.append((time.monotonic() - begun) * 1000)
            if wav.samples.shape != (1920, 2) or not np.isfinite(wav.samples).all():
                raise RuntimeError("MRT2 returned an invalid stereo frame")
            samples.append(wav.samples)
        audio = np.concatenate(samples)
        sf.write(output / f"harmony-{palette}.wav", audio, 48000, subtype="PCM_16")
        results[palette] = {
            "prompt": prompt,
            "frame_ms_p50": float(np.percentile(frame_times, 50)),
            "frame_ms_p95": float(np.percentile(frame_times, 95)),
            "frame_ms_max": max(frame_times),
            "realtime_factor": len(frame_times) * 40 / sum(frame_times),
            "rms": float(np.sqrt(np.mean(audio**2))),
            "peak": float(np.max(np.abs(audio))),
        }
        print(palette, json.dumps(results[palette]), flush=True)
    metrics = {
        "scope": "GPU generation of Sway's written harmony; network and playback not measured",
        "model": args.model,
        "source_revision": SOURCE_REVISION,
        "asset_revision": ASSET_REVISION,
        "gpu": [str(device) for device in devices],
        "nvidia_smi": subprocess.check_output(
            ["nvidia-smi", "--query-gpu=name,memory.total,driver_version", "--format=csv,noheader"],
            text=True,
        ).strip(),
        "load_and_compile_seconds": load_and_compile_seconds,
        "frames": len(rows),
        "palettes": results,
    }
    (output / "metrics.json").write_text(json.dumps(metrics, indent=2) + "\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--model", choices=("mrt2_base", "mrt2_small"), default="mrt2_base")
    parser.add_argument("--seconds", type=int, default=30, help="Audio duration, 10 to 60 seconds")
    parser.add_argument(
        "--conditioning", help="Sway harmony conditioning (.npz) to render instead of the benchmark"
    )
    arguments = parser.parse_args()
    if not 10 <= arguments.seconds <= 60:
        parser.error("Use 10-60 seconds of audio")
    if arguments.run:
        benchmark(arguments)
    else:
        bootstrap(arguments)
