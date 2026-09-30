"""Allocate one Colab GPU, collect an MRT2 trial, and release the owned session."""

import argparse
import json
import shutil
import signal
import subprocess
import time
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--gpu", choices=("L4", "T4", "A100", "H100"), default="L4")
    parser.add_argument("--model", choices=("mrt2_base", "mrt2_small"), default="mrt2_base")
    parser.add_argument("--seconds", type=int, default=30, help="Audio duration, 10 to 60 seconds")
    parser.add_argument(
        "--timeout", type=int, default=1200, help="VM work limit, 120 to 1800 seconds"
    )
    parser.add_argument(
        "--conditioning",
        type=Path,
        help="Render this Sway harmony conditioning (.npz) in each of its palettes instead",
    )
    args = parser.parse_args()
    if not 10 <= args.seconds <= 60 or not 120 <= args.timeout <= 1800:
        parser.error("Use 10-60 seconds of audio and a 120-1800 second work limit")
    colab = shutil.which("colab")
    if not colab:
        raise SystemExit("Install and authenticate the Colab CLI before running the trial")
    name = "sway-mrt2-" + time.strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:4]
    output = ROOT / "outputs" / "colab" / name
    output.mkdir(parents=True)
    state = ROOT / ".cache" / "colab" / name
    state.mkdir(parents=True)
    base = [colab, "--config", str(state / "sessions.json")]
    deadline = time.monotonic() + args.timeout
    release_ok = False

    def terminate(signum, frame):
        raise SystemExit(128 + signum)

    signal.signal(signal.SIGTERM, terminate)
    with (output / "run.log").open("w") as log:

        def run(arguments, limit=120):
            remaining = min(limit, deadline - time.monotonic())
            if remaining <= 0:
                raise TimeoutError("The Colab trial reached its runtime limit")
            subprocess.run(
                base + arguments,
                stdout=log,
                stderr=subprocess.STDOUT,
                timeout=remaining,
                check=True,
            )

        try:
            print(f"Allocating {args.gpu} for {args.model}; session {name}", flush=True)
            print(f"Log and results: {output}", flush=True)
            run(["new", "-s", name, "--gpu", args.gpu], limit=180)
            run(
                [
                    "upload",
                    "-s",
                    name,
                    str(ROOT / "scripts/colab_music_trial.py"),
                    "/content/sway_music_trial.py",
                ]
            )
            if args.conditioning:
                run(
                    ["upload", "-s", name, str(args.conditioning), "/content/sway_conditioning.npz"]
                )
            remaining = max(1, int(deadline - time.monotonic() - 90))
            launcher = state / "launch.py"
            remote_command = [
                "python3",
                "/content/sway_music_trial.py",
                "--model",
                args.model,
                "--seconds",
                str(args.seconds),
                *(
                    ["--conditioning", "/content/sway_conditioning.npz"]
                    if args.conditioning
                    else []
                ),
            ]
            launcher.write_text(
                "import subprocess, json\nfrom pathlib import Path\n"
                "process = subprocess.Popen("
                + repr(remote_command)
                + ", stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)\n"
                "for line in process.stdout:\n    print(line, end='', flush=True)\n"
                "code = process.wait()\n"
                "status = Path('/content/sway_trial_status.json')\n"
                "status.write_text(json.dumps({'returncode': code}))\n"
            )
            print("Installing the pinned runtime, then measuring and rendering.", flush=True)
            run(
                ["exec", "-s", name, "-f", str(launcher), "--timeout", str(remaining)],
                limit=remaining + 15,
            )
            # colab exec can exit successfully even when a remote cell raises.
            run(
                [
                    "download",
                    "-s",
                    name,
                    "/content/sway_trial_status.json",
                    str(output / "remote-status.json"),
                ]
            )
            remote_status = json.loads((output / "remote-status.json").read_text())
            if remote_status.get("returncode") != 0:
                raise RuntimeError(f"Remote trial failed; see {output / 'run.log'}")
            if args.conditioning:
                import numpy as np

                palettes = [str(value) for value in np.load(args.conditioning)["palettes"]]
                filenames = ["metrics.json", *(f"harmony-{palette}.wav" for palette in palettes)]
            else:
                filenames = ["metrics.json", "control-trace.json", "performance.wav"]
            for filename in filenames:
                run(
                    [
                        "download",
                        "-s",
                        name,
                        f"/content/sway-music-trial/results/{filename}",
                        str(output / filename),
                    ],
                    limit=60,
                )
            print("Results collected.", flush=True)
        finally:
            print(f"Releasing owned Colab session {name}.", flush=True)
            try:
                result = subprocess.run(
                    base + ["stop", "-s", name], stdout=log, stderr=subprocess.STDOUT, timeout=60
                )
                release_ok = result.returncode == 0
            except subprocess.TimeoutExpired:
                release_ok = False
            (output / "session.json").write_text(
                json.dumps(
                    {
                        "session": name,
                        "gpu_requested": args.gpu,
                        "model": args.model,
                        "timeout_seconds": args.timeout,
                        "released": release_ok,
                        "state_file": str(state / "sessions.json"),
                    },
                    indent=2,
                )
                + "\n"
            )
            if not release_ok:
                print(
                    f"Cleanup needs verification: colab --config {state / 'sessions.json'} "
                    f"stop -s {name}",
                    flush=True,
                )
    if not release_ok:
        raise SystemExit("Colab did not confirm session release")
    metrics = json.loads((output / "metrics.json").read_text())
    print(
        json.dumps(
            {key: value for key, value in metrics.items() if key != "frame_times_ms"}, indent=2
        )
    )


if __name__ == "__main__":
    main()
