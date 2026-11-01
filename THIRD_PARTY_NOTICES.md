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

## Stable Audio 3

The score variant of the steered page plays its score with Stability AI's [Stable Audio 3](https://github.com/Stability-AI/stable-audio-3), in the project's official MLX version.
Stable Audio 3 is installed apart from Sway, with its own Python environment, and Sway bundles neither its code nor its weights.
`src/sway/sa3_worker.py` runs in that environment and imports its modules at run time.
Its audio encoding, decoding, and window rendering are adapted from the project's `optimized/mlx/scripts/sa3_mlx.py`.
Copyright 2026 Stability AI.
The code is licensed under the MIT License, reproduced in [third_party/STABLE_AUDIO_3_LICENSE](third_party/STABLE_AUDIO_3_LICENSE).

Inspected source revision: `77e0398`.

The weights are downloaded separately from [stabilityai/stable-audio-3-optimized](https://huggingface.co/stabilityai/stable-audio-3-optimized).
Their use is governed by the [Stability AI Community License](https://stability.ai/license).
The text encoder in those weights, T5Gemma, is from Google.
Consult those terms before using the score variant's output beyond personal use.

## The macOS General MIDI sound bank

The score variant's sampler, `src/sway/sampler.swift`, plays the General MIDI sound bank that ships with macOS, `gs_instruments.dls`, through Apple's `AVAudioUnitSampler`.
Sway does not copy or distribute the bank.

## Qwen

V1's optional band composer calls Alibaba's hosted Qwen3.8-Max API with musical data only.
Its weights are not bundled with Sway.

## MediaPipe

Browser tracking uses Google's [MediaPipe Tasks Vision](https://github.com/google-ai-edge/mediapipe) package and its published Hand Landmarker model bundle.
The package retains its upstream Apache 2.0 license in `node_modules`.
The model download URL is listed in `src/sway/config.py`.

Other installed dependencies retain their respective upstream licenses.
This notice does not assign a license to original Sway code.
