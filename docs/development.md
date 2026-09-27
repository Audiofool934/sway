# Development

The project is paused; [project status](project-status.md) records the intended direction and unresolved product behavior.
This guide covers the saved implementation rather than proposing new work.

## Runtime

The local prototype targets Apple Silicon macOS and Python 3.12.
Use `uv sync --locked` and retain the pinned dependencies.
The MRT2 MLX export failed to import under MLX 0.32.2 and loaded under the pinned 0.31.2 during the original validation.
Do not treat a dependency upgrade as routine cleanup without rerunning a real model workload.

`uv run --locked sway setup --music-only` installs music assets, tracking assets, and browser dependencies for cloud Qwen use.
Plain `sway setup` also downloads the optional local Qwen model.
`uv run --locked sway doctor` checks local assets and credential configuration without calling Qwen.
`uv run --locked sway qwen-check` makes one billable request using synthetic blank images and checks connectivity only.

The server listens on `127.0.0.1:8765` by default.
Gesture ensemble supports one performance window at a time.
End the performance, turn off its camera, and stop the server with Ctrl-C when finished.
Colab runners have a separate lifecycle; use the [cloud guide](cloud-setup.md) to stop and verify those allocations.

## Checks

```bash
uv run --locked pytest -q
node --test tests/*.test.js
uv run --locked ruff check src tests scripts
uv run --locked ruff format --check src tests scripts
node_modules/.bin/prettier --check 'web/*.{js,css,html}'
git diff --check
```

The pause checkpoint passed 89 Python tests and 18 JavaScript tests.
The Starlette TestClient emitted one upstream deprecation warning about `httpx`.
No dependency change was made to suppress it.

These tests cover motion observations, ensemble state, cloud failure handling, private configuration, session cleanup, audio buffering, and Flow timeline behavior.
They do not substitute for a camera performance, physical output recording, or musical listening assessment.
See the [validation index](README.md#validation-records) for hardware and browser evidence.

## Source map

| Path                                                     | Responsibility                                                                      |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `src/sway/config.py`                                     | Local paths, pinned model revisions, and starting palettes.                         |
| `src/sway/schema.py`                                     | Gesture, session, semantic, and ensemble data contracts.                            |
| `src/sway/motion.py`, `gestures.py`                      | Temporal motion features and fallible gesture suggestions.                          |
| `src/sway/qwen.py`, `semantics.py`                       | Cloud Qwen client, prompts, response validation, and optional local interpretation. |
| `src/sway/controller.py`, `ensemble.py`                  | Persistent arrangement, tempo intent, shared clock, and harmonic cues.              |
| `src/sway/music.py`, `music_jax.py`                      | Local MLX and Colab JAX music adapters.                                             |
| `src/sway/workers.py`, `session.py`                      | Generation and interpretation workers, ownership, streaming, and recording.         |
| `src/sway/app.py`, `cli.py`                              | Local HTTP/WebSocket interface, setup, diagnostics, and offline renders.            |
| `src/sway/remote_music.py`, `remote_server.py`           | Private live music protocol and Colab service.                                      |
| `src/sway/flow*.py`                                      | Saved passages, Flow protocol, source transformations, and remote service.          |
| `web/app.js`, `vision-worker.js`, `audio-*.js`           | Gesture ensemble controls, tracking, and playback.                                  |
| `web/flow*`                                              | Flow interface, hand controls, timeline, and recording.                             |
| `scripts/run_colab_trial.py`, `run_colab_demon_trial.py` | Bounded evaluation runners.                                                         |
| `scripts/run_colab_live.py`, `colab_live_bootstrap.py`   | Bounded live GPU service and startup.                                               |
| `tests/`                                                 | Python and JavaScript regression checks.                                            |

The current [ensemble guide](gesture-ensemble.md) explains how these components compose.
The separate [Flow guide](flow-mode.md) documents its different playback and generation model.

## Data and evidence

These are default locations on the development machine.
All repository-local paths in this table are ignored by Git.

| Location                       | Contents and retention                                                                     |
| ------------------------------ | ------------------------------------------------------------------------------------------ |
| `.cache/models/`               | Downloaded MRT2, MediaPipe, and optional local Qwen assets.                                |
| `.cache/recordings/`           | Gesture ensemble WAV takes and JSON sidecars; camera frames are not included.              |
| `.cache/flow/`                 | Saved Flow sources, variations, and provenance; retain for returning to existing passages. |
| `.cache/colab/`                | Per-run connection state, temporary credentials, logs, and release reports.                |
| `outputs/colab/`               | Downloaded GPU trial outputs and measurements.                                             |
| `outputs/ensemble-2026-09-27/` | Qwen ensemble recordings, status samples, diagnostics, and UI screenshots.                 |
| `outputs/pause-2026-09-27/`    | Sanitized runtime snapshots from stopping the local session.                               |
| `work/`                        | Earlier local experiment evidence and working files cited in dated reports.                |
| `~/.config/sway/qwen.json`     | Private Qwen credential and region configuration outside the repository.                   |

Flow recordings are downloaded by the browser as WAV and JSON files.
Gesture ensemble recordings contain generated audio before browser volume control; Flow recordings include its expression controls before listening volume.
Neither capture alone proves that physical browser playback had no gaps.

`SWAY_DATA_DIR` relocates the default `.cache` data root.
Setup and serving must use the same value.
Git history preserves source and reports, but not model assets, recordings, generated passages, or credentials.
Preserve wanted local artifacts separately before deleting or archiving this checkout.

## Offline music render

```bash
uv run --locked sway render --seconds 30 --palette chamber --action piano --tempo 108 --output outputs/first-take.wav
```

This invokes the real local music model and writes a WAV plus a timing report.
It refuses to overwrite the destination.
Use a new output name for another run.
Generation throughput does not establish recognition accuracy, physical control latency, or musical quality.
