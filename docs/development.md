# Development

Development resumed on September 28, 2026; the [V1 plan](v1-plan.md) defines the instrument and its milestones.
The V1 instrument is browser code in `web/instrument/`; the Python server serves its files, renders its generated harmony with MRT2, and asks Qwen for the band's composer.
The Python pipeline below serves the legacy ensemble and Flow pages.

## Runtime

The local prototype targets Apple Silicon macOS and Python 3.12.
Use `uv sync --locked` and retain the pinned dependencies.
The MRT2 MLX export failed to import under MLX 0.32.2 and loaded under the pinned 0.31.2 during the original validation.
Do not treat a dependency upgrade as routine cleanup without rerunning a real model workload.

`uv run --locked sway setup --instrument-only` installs the tracking assets and browser dependencies that V1 needs to play.
`uv run --locked sway setup --music-only` also installs MRT2, which renders V1's generated harmony and drives the legacy pages.
Plain `sway setup` also downloads the optional local Qwen model.
`uv run --locked sway doctor` checks local assets and credential configuration without calling Qwen; only missing V1 assets make it fail.
`uv run --locked sway qwen-check` makes one billable request using synthetic blank images and checks connectivity only.

The server listens on `127.0.0.1:8765` by default.
V1 is served at `/`, the legacy Gesture ensemble at `/ensemble.html`, and Flow at `/flow.html`.
Gesture ensemble supports one performance window at a time.
End the performance, turn off its camera, and stop the server with Ctrl-C when finished.
Colab runners have a separate lifecycle; use the [cloud guide](cloud-setup.md) to stop and verify those allocations.

## Checks

```bash
uv run --locked pytest -q
node --test tests/*.test.js
uv run --locked ruff check src tests scripts
uv run --locked ruff format --check src tests scripts
node_modules/.bin/prettier --check 'web/*.{js,css,html}' 'web/instrument/*.{js,css}'
git diff --check
```

The October 3-4 V1 candidate passed 133 Python tests and 136 JavaScript tests, including the real MRT2 render on the development Mac.
The Starlette TestClient emitted one upstream deprecation warning about `httpx`.
No dependency change was made to suppress it.

These tests cover motion observations, ensemble state, cloud failure handling, private configuration, session cleanup, audio buffering, and Flow timeline behavior.
They do not substitute for a camera performance, physical output recording, or musical listening assessment.
See the [validation index](README.md#validation-records) for hardware and browser evidence.
The [V1 readiness record](v1-readiness.md) describes the current candidate, the browser checks, and the remaining human play tests.

## Source map

The V1 instrument:

| Path                                                                | Responsibility                                                                           |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `web/index.html`, `web/instrument/style.css`                        | The instrument page and its styles.                                                      |
| `web/instrument/theory.js`                                          | Pitches, chords, and the V1 musical world.                                               |
| `web/instrument/clock.js`                                           | Beat and time conversion, swing, and latency-compensated grid alignment.                 |
| `web/instrument/hands.js`                                           | Landmark smoothing, pinch and fist detection, and stable hand roles.                     |
| `web/instrument/hand-visual.js`                                     | Fine hand skeletons and wrist/fingertip markers over the live camera image.              |
| `web/instrument/controls.js`                                        | Hand features to instrument events, shared by camera, pointer, and scripted input.       |
| `web/instrument/band.js`, `looper.js`                               | The band's parts per energy level, and retrospective loop capture.                       |
| `web/instrument/synth.js`, `engine.js`                              | Web Audio instruments and mix, and the lookahead scheduler.                              |
| `web/instrument/listening.js`                                      | Optional mixer for comparing parts; closing it restores the full band.                   |
| `web/instrument/harmony.js`                                         | Generated harmony: requests MRT2 bars ahead and starts each on its bar line.             |
| `src/sway/harmony.py`, `/api/harmony/*` in `app.py`                 | Renders a bar's chord with MRT2 from one continuous model stream.                        |
| `web/instrument/arrange.js`, `composer.js`                          | A cycle's plan as notes per bar, and the page's side of the composer.                    |
| `src/sway/composer.py`, `/api/compose` in `app.py`                  | Asks Qwen for the band's next cycle and validates its plan.                              |
| `web/instrument/camera.js`, `web/vision-worker.js`                  | Camera capture with capture times, and MediaPipe tracking off the main thread.           |
| `web/instrument/overlay.js`, `main.js`                              | The drawn instrument, heads-up display, and page wiring.                                 |
| `web/instrument/tutorial.js`, `coach.js`                            | Lesson charts, judging, and timing calibration; the setup and lesson flow.               |
| `web/instrument/midi.js`, `wav.js`, `recorder-worklet.js`           | MIDI and WAV encoding, and recording the mix while a piece plays.                        |
| `tests/instrument-*.test.js`, `test_harmony.py`, `test_composer.py` | Timing, harmony, hand, control, band, looper, camera, engine, export, and lesson checks. |

In the browser console, `window.sway` exposes the engine, controls, and a scripted `input()` that feeds the same features as a hand.
Hand features carry 21 mirrored, smoothed image landmarks, centred on the same palm position that drives the controls.
The mirrored live video remains visible with reduced saturation and brightness so the performer and room provide spatial context behind the instrument.
Hand accents use only the tracked bones and six small markers per hand; no inferred surfaces, particles, or trails are drawn.
`POST /api/harmony/start` begins a piece's model stream, and `POST /api/harmony/bar` returns one bar of 16-bit stereo PCM at 48 kHz; bars for a piece that has since been replaced get HTTP 409.
With real MRT2 assets present, `tests/test_harmony.py` also renders two bars and checks that they stay in key.
`POST /api/compose` returns Qwen's plan for the next cycle, and `GET /api/compose/status` says whether Qwen is configured without revealing the key; the tests replace Qwen with a mock transport, so they make no billable requests.

The legacy Python pipeline:

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
| `web/ensemble.html`, `app.js`, `audio-*.js`              | Gesture ensemble page, controls, and playback.                                      |
| `web/flow*`                                              | Flow interface, hand controls, timeline, and recording.                             |
| `scripts/run_colab_trial.py`, `run_colab_demon_trial.py` | Bounded evaluation runners.                                                         |
| `scripts/run_colab_live.py`, `colab_live_bootstrap.py`   | Bounded live GPU service and startup.                                               |
| `tests/`                                                 | Python and JavaScript regression checks.                                            |

The [ensemble guide](gesture-ensemble.md) explains how these legacy components compose.
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
| `outputs/v1-ready-2026-10-03/` | V1 candidate test results, browser recordings, exports, and UI screenshots.                 |
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
