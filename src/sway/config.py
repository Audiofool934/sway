"""Pinned assets and paths; runtime data stays in this checkout by default."""

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = Path(os.environ.get("SWAY_DATA_DIR", ROOT / ".cache")).expanduser().resolve()
MRT_DIR = DATA / "models" / "mrt2"
SEMANTIC_DIR = DATA / "models" / "semantics-small"
VISION_DIR = DATA / "models" / "vision"
RECORDINGS = DATA / "recordings"

MRT_REPO = "google/magenta-realtime-2"
MRT_REVISION = "010aa0dcb0dfd27b24f0ad07b4dad63e8f9521cc"
MRT_FILES = (
    "models/mrt2_small/mrt2_small.mlxfn",
    "models/mrt2_small/mrt2_small_state.safetensors",
    "resources/musiccoca/spm.model",
    "resources/musiccoca/text_encoder.tflite",
    "resources/musiccoca/pretrained_vector_quantizer.tflite",
)
SEMANTIC_REPO = "mlx-community/Qwen3.5-0.8B-4bit"
SEMANTIC_REVISION = "da28692b5f139cb0ec58a356b437486b7dac7462"
VISION_ASSETS = {
    "hand_landmarker.task": (
        "https://storage.googleapis.com/mediapipe-models/hand_landmarker/"
        "hand_landmarker/float16/1/hand_landmarker.task"
    ),
    "pose_landmarker_lite.task": (
        "https://storage.googleapis.com/mediapipe-models/pose_landmarker/"
        "pose_landmarker_lite/float16/1/pose_landmarker_lite.task"
    ),
}

PALETTES = {
    "chamber": "An intimate instrumental chamber ensemble, warm piano, plucked strings, "
    "soft bass, delicate percussion, an evolving coherent composition",
    "nocturne": "A quiet instrumental nocturne, felt piano, sustained strings, "
    "spacious ambient textures, gentle harmonic development",
    "groove": "An instrumental downtempo ensemble, electric piano, warm bass, "
    "subtle drums, a relaxed evolving groove",
}
ACTION_STYLES = {
    "piano": "expressive acoustic piano phrases, articulated keys",
    "strum": "rhythmic plucked acoustic guitar and strings",
    "strike": "rhythmic percussion, accented ensemble phrases",
    "sustain": "bowed strings and sustained flowing melodic lines",
    "unknown": "balanced ensemble instrumentation",
    "still": "gentle spacious phrasing with room to breathe",
}
