# Third-party notices

Sway uses pretrained models without modifying their weights.
Model files are downloaded separately and excluded from Git.
Their licenses are separate from the license of any original Sway code.

## Magenta RealTime 2

The text tokenization, style quantization, exported graph arguments, and conditioning layout in `src/sway/music.py` are adapted from the Google Magenta RealTime project.
Copyright 2026 Google LLC.
The original code is licensed under the Apache License, Version 2.0, reproduced in [third_party/MAGENTA_LICENSE](third_party/MAGENTA_LICENSE).
Sway provides a reduced Python adapter, its own bar-by-bar harmony renderer, and the theremin experiment's controller.

Inspected source revision: `694a545e4ba0b88bf1150137b129582166d3e07f`.

- [MusicCoCa implementation](https://github.com/magenta/magenta-realtime/blob/694a545e4ba0b88bf1150137b129582166d3e07f/magenta_rt/musiccoca.py)
- [MLX exported system](https://github.com/magenta/magenta-realtime/blob/694a545e4ba0b88bf1150137b129582166d3e07f/magenta_rt/mlx/system.py)
- [C++ conditioning and state handling](https://github.com/magenta/magenta-realtime/blob/694a545e4ba0b88bf1150137b129582166d3e07f/core/src/mlx_engine.cpp)

The downloaded [Magenta RealTime 2 weights](https://huggingface.co/google/magenta-realtime-2) are distributed under CC BY 4.0 according to the model card.
The local adapter uses the Small exported model and MusicCoCa resources at revision `010aa0dcb0dfd27b24f0ad07b4dad63e8f9521cc`.
Consult that model card for its attribution, terms, and limitations.

## Qwen

V1's optional band composer calls Alibaba's hosted Qwen3.8-Max API with musical data only.
Its weights are not bundled with Sway.

## MediaPipe

Browser tracking uses Google's [MediaPipe Tasks Vision](https://github.com/google-ai-edge/mediapipe) package and its published Hand Landmarker model bundle.
The package retains its upstream Apache 2.0 license in `node_modules`.
The model download URL is listed in `src/sway/config.py`.

Other installed dependencies retain their respective upstream licenses.
This notice does not assign a license to original Sway code.
