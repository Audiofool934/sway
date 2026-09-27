"""Install the music runtime and replace this process with the private GPU service."""

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path

from colab_music_trial import ASSET_REVISION, ROOT, prepare_runtime


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", choices=("mrt2_base", "mrt2_small", "demon"), required=True)
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--websockets-version", required=True)
    parser.add_argument("--pydantic-version", required=True)
    parser.add_argument("--serve", action="store_true")
    args = parser.parse_args()
    root = Path(__file__).resolve().parent
    if args.model == "demon":
        from types import SimpleNamespace

        from colab_demon_trial import ROOT as DEMON_ROOT
        from colab_demon_trial import SOURCE, bootstrap

        if not args.serve:
            bootstrap(SimpleNamespace(engine_cache=None, setup_only=True))
            python = SOURCE / ".venv/bin/python"
            env = dict(
                os.environ, PYTHONPATH=str(root), ACESTEP_MODELS_DIR=str(DEMON_ROOT / "models")
            )
            os.execve(
                python,
                [str(python), "-u", str(Path(__file__).resolve()), *sys.argv[1:], "--serve"],
                env,
            )
        sys.path.insert(0, str(SOURCE))
        from sway.flow_server import run_service as run_flow_service

        run_flow_service(root / "music.token", args.port)
        return
    if not args.serve:
        python = prepare_runtime()
        uv = shutil.which("uv") or str(ROOT / "bootstrap/bin/uv")
        subprocess.run(
            [
                uv,
                "pip",
                "install",
                "--python",
                str(python),
                "websockets==" + args.websockets_version,
                "pydantic==" + args.pydantic_version,
            ],
            check=True,
        )
        env = dict(
            os.environ,
            MAGENTA_HOME=str(ROOT / "assets"),
            PYTHONPATH=str(root),
            JAX_PLATFORMS="cuda",
            XLA_PYTHON_CLIENT_PREALLOCATE="false",
        )
        os.execve(
            python,
            [str(python), "-u", str(Path(__file__).resolve()), *sys.argv[1:], "--serve"],
            env,
        )
    from huggingface_hub import snapshot_download
    from magenta_rt import paths

    from sway.remote_server import run_service

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
    run_service(root / "music.token", args.port, args.model)


if __name__ == "__main__":
    main()
