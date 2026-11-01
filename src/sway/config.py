"""Pinned assets and paths; runtime data stays in this checkout by default."""

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = Path(os.environ.get("SWAY_DATA_DIR", ROOT / ".cache")).expanduser().resolve()
MRT_DIR = DATA / "models" / "mrt2"
VISION_DIR = DATA / "models" / "vision"
# Stable Audio 3's MLX version, for the score variant: installed apart from Sway, with its
# own Python and weights.
SA3_DIR = Path(os.environ.get("SWAY_SA3_DIR", "~/Developer/stable-audio-3/optimized/mlx"))
SA3_DIR = SA3_DIR.expanduser()

MRT_REPO = "google/magenta-realtime-2"
MRT_REVISION = "010aa0dcb0dfd27b24f0ad07b4dad63e8f9521cc"
MRT_FILES = (
    "models/mrt2_small/mrt2_small.mlxfn",
    "models/mrt2_small/mrt2_small_state.safetensors",
    "resources/musiccoca/spm.model",
    "resources/musiccoca/text_encoder.tflite",
    "resources/musiccoca/pretrained_vector_quantizer.tflite",
)
VISION_ASSETS = {
    "hand_landmarker.task": (
        "https://storage.googleapis.com/mediapipe-models/hand_landmarker/"
        "hand_landmarker/float16/1/hand_landmarker.task"
    ),
}
