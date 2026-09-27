# Third-party notices

Sway uses pretrained models without modifying their weights.
Model files are downloaded separately and excluded from Git.
Their licenses are separate from the license of any original Sway code.

## Magenta RealTime 2

The text tokenization, style quantization, exported graph arguments, and conditioning layout in `src/sway/music.py` are adapted from the Google Magenta RealTime project.
Copyright 2026 Google LLC.
The original code is licensed under the Apache License, Version 2.0, reproduced in [third_party/MAGENTA_LICENSE](third_party/MAGENTA_LICENSE).
Sway provides a reduced Python adapter, a different session lifecycle, and its own motion controller and harmonic planner.

Inspected source revision: `694a545e4ba0b88bf1150137b129582166d3e07f`.

- [MusicCoCa implementation](https://github.com/magenta/magenta-realtime/blob/694a545e4ba0b88bf1150137b129582166d3e07f/magenta_rt/musiccoca.py)
- [MLX exported system](https://github.com/magenta/magenta-realtime/blob/694a545e4ba0b88bf1150137b129582166d3e07f/magenta_rt/mlx/system.py)
- [C++ conditioning and state handling](https://github.com/magenta/magenta-realtime/blob/694a545e4ba0b88bf1150137b129582166d3e07f/core/src/mlx_engine.cpp)

The downloaded [Magenta RealTime 2 weights](https://huggingface.co/google/magenta-realtime-2) are distributed under CC BY 4.0 according to the model card.
The local adapter uses the Small exported model and MusicCoCa resources at revision `010aa0dcb0dfd27b24f0ad07b4dad63e8f9521cc`.
The optional Colab adapter uses upstream JAX inference; the trial scripts record source and asset revisions in their results.
Consult that model card for its attribution, terms, and limitations.

## Qwen and MLX Community

The optional local semantic model is [MLX Community's 4-bit conversion of Qwen3.5-0.8B](https://huggingface.co/mlx-community/Qwen3.5-0.8B-4bit), revision `da28692b5f139cb0ec58a356b437486b7dac7462`.
The model card lists Apache 2.0 and credits the original [Qwen3.5-0.8B](https://huggingface.co/Qwen/Qwen3.5-0.8B) model.
Sway runs inference through [MLX-VLM](https://github.com/Blaizzy/mlx-vlm).
Gesture ensemble instead calls Alibaba's hosted Qwen3.8-Max API; its weights are not bundled with Sway.

## DEMON

The optional Flow and evaluation runners download [DEMON](https://github.com/daydreamlive/DEMON/tree/229af3d3d68e7e40764c93259e88149ef6546077) at revision `229af3d3d68e7e40764c93259e88149ef6546077` into an owned Colab runtime.
The adapter uses its Session interface and retains upstream files and notices there.
The downloaded runtime and model assets are excluded from this repository.
See the [Flow integration notes](docs/flow-mode.md#implementation-and-limits) for the recorded upstream license and attribution context.

## MediaPipe

Browser tracking uses Google's [MediaPipe Tasks Vision](https://github.com/google-ai-edge/mediapipe) package and its published Hand Landmarker and Pose Landmarker Lite model bundles.
The package retains its upstream Apache 2.0 license in `node_modules`.
Model download URLs are listed in `src/sway/config.py`.

Other installed dependencies retain their respective upstream licenses.
This notice does not assign a license to original Sway code.
