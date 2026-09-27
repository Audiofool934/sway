# Sway

**A generative instrument, inspired by movement.**

**Development paused on September 27, 2026.**
Start with the [project status and handoff](docs/project-status.md) for decisions, known problems, validation, and where to resume.
The [documentation index](docs/README.md) separates operating guides from historical experiments and proposals.

Sway explores music shaped by hands, body movement, and visual context.
The person supplies inspiration; the models take responsibility for the musical result.
Precise gestures and an exact human-supplied beat should not be prerequisites.
The prototype does not yet deliver consistently clear connections between movement and sound.

## What is implemented

| Mode               | Pipeline                                                                                            | Status                                                                                      |
| ------------------ | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Gesture ensemble   | MediaPipe observations and camera images → Qwen3.8-Max → arrangement and musical clock → MRT2 audio | Main direction when work resumes; Qwen remains the chosen interpreter and musical director. |
| Flow               | Saved passage → local playback and hand controls → optional DEMON variations on Colab               | Retained experiment; further product development is deferred.                               |
| Legacy comparisons | Gesture map, optional local Qwen, or manually selected musical action → MRT2                        | Available for diagnostics and comparison.                                                   |

Gesture ensemble sends all requested parts into one generated stereo mix.
Independent instrument stems, exact audible tempo, and reliable drum-versus-strum interpretation are unresolved.
Qwen responses took 4.68-6.49 seconds in the recorded ensemble test; physical gesture-to-sound latency was not measured.
Playback gaps also remain unresolved.
See the [ensemble guide](docs/gesture-ensemble.md) for the implementation and evidence behind these limits.

## Run the installed prototype

On the configured development Mac:

```bash
cd ~/Projects/sway
uv run --locked sway doctor
uv run --locked sway serve
```

Open **http://127.0.0.1:8765/?interpretation=qwen** for Gesture ensemble.
Choose **Qwen conductor / ensemble**, press **Begin performance**, then enable the camera.
The [first-play guide](docs/morning-test.md) explains controls and recording.
Press **End performance**, turn off the camera, and stop the server with Ctrl-C when finished.

Music defaults to local MRT2 Small, so a Colab GPU is optional.
Qwen interpretation uses the configured cloud account.
The pause checkpoint leaves the local server stopped and Colab with no active assignments.

For a fresh checkout, use an Apple Silicon Mac, Python 3.12 through [uv](https://docs.astral.sh/uv/), Node.js/npm, and a recent Chrome browser:

```bash
git clone https://github.com/Audiofool934/sway.git
cd sway
uv sync --locked
uv run --locked sway setup --music-only
uv run --locked sway doctor
```

Setup downloads the pinned music and tracking assets and installs browser dependencies.
Configure Qwen through the [private credential instructions](docs/cloud-setup.md#configure-qwen-privately), then run `uv run --locked sway serve`.
Use `sway setup` without `--music-only` only when also installing the optional local vision-language model.
The prototype was developed on an M2 Pro with 16 GB of unified memory.

## Data and compute

The server listens on loopback.
Qwen mode sends selected camera images and motion observations to Alibaba; recordings contain generated audio only.
The Qwen credential stays in backend configuration outside the repository and browser.
Colab receives musical controls or Flow source audio, depending on the mode, without camera images or the Qwen key.

Models, recordings, generated passages, and experiment outputs are ignored by Git and remain on the development machine.
A clone does not include them.
See [data locations](docs/development.md#data-and-evidence) before moving or archiving the checkout.

The [cloud guide](docs/cloud-setup.md) covers bounded MRT2 and DEMON sessions, setup, and release verification.
The separate Flow page is **http://127.0.0.1:8765/flow.html**; its [guide](docs/flow-mode.md) describes the retained experiment.

## Development

```bash
uv run --locked pytest -q
node --test tests/*.test.js
uv run --locked ruff check src tests scripts
uv run --locked ruff format --check src tests scripts
node_modules/.bin/prettier --check 'web/*.{js,css,html}'
git diff --check
```

At the pause checkpoint, all 89 Python tests and 18 JavaScript tests passed, along with lint and formatting checks.
These checks do not establish musical quality, recognition accuracy, or gap-free physical playback.
The [development guide](docs/development.md) maps the source, runtime, and evidence locations.

## Models and attribution

- [Magenta RealTime 2](https://github.com/magenta/magenta-realtime): continuous music generation and style resources.
- [Qwen](https://www.alibabacloud.com/help/en/model-studio/vision): cloud visual interpretation and musical direction.
- [MediaPipe](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker/web_js): browser hand and pose tracking.
- [DEMON](https://github.com/daydreamlive/DEMON): experimental Flow generation and source transformation on Colab.
- [Qwen3.5-0.8B via MLX Community](https://huggingface.co/mlx-community/Qwen3.5-0.8B-4bit): optional local interpretation for the older comparison mode.

See [third-party notices](THIRD_PARTY_NOTICES.md) for attribution and model licensing references.
No license for original Sway code has been selected.
