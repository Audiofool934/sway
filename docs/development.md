# Development

The [V1 plan](v1-plan.md) defines the instrument and its milestones, and the [project status](project-status.md) says where the work stands.
The V1 instrument is browser code in `web/instrument/`; the Python server serves its files, renders its generated harmony with MRT2, and asks Qwen for the band's composer.
The generative theremin experiment is a second page with its own MRT2 stream.
The motion-to-music harness measures how much of the music a movement steers, offline.

## Runtime

Sway targets Apple Silicon macOS and Python 3.12.
Use `uv sync --locked` and retain the pinned dependencies.
The MRT2 MLX export failed to import under MLX 0.32.2 and loaded under the pinned 0.31.2 during the original validation.
Do not treat a dependency upgrade as routine cleanup without rerunning a real model workload.

`uv run --locked sway setup` installs the tracking assets, browser dependencies, and MRT2.
`--instrument-only` skips MRT2; V1 then plays its synthesized pad, and the theremin and steered pages cannot start.
`uv run --locked sway doctor` checks local assets and credential configuration without calling Qwen; only missing V1 assets make it fail.

The server listens on `127.0.0.1:8765` by default.
V1 is served at `/` and the theremin experiment at `/theremin.html`.
Only one theremin window can generate at a time.
Stop the server with Ctrl-C when finished.

## Checks

```bash
uv run --locked pytest -q
node --test tests/*.test.js
uv run --locked ruff check src tests
uv run --locked ruff format --check src tests
node_modules/.bin/prettier --check 'web/*.{js,css,html}' 'web/instrument/*.{js,css}'
git diff --check
```

On October 7, 78 Python tests and 128 JavaScript tests passed, including the real MRT2 render on the development Mac.
The Starlette TestClient emits one upstream deprecation warning about `httpx`.
No dependency change was made to suppress it.

These tests cover timing, harmony, hand tracking, controls, the band, loops, the camera, the engine, exports, lessons, the composer, the theremin's controls and stream, and the steering measurements.
They do not substitute for a camera performance, physical output recording, or musical listening assessment.
The [V1 readiness record](v1-readiness.md) describes the browser checks and the remaining human play tests.

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
| `web/instrument/listening.js`                                       | Optional mixer for comparing parts; closing it restores the full band.                   |
| `web/instrument/harmony.js`                                         | Generated harmony: requests MRT2 bars ahead and starts each on its bar line.             |
| `src/sway/harmony.py`, `/api/harmony/*` in `app.py`                 | Renders a bar's chord with MRT2 from one continuous model stream.                        |
| `web/instrument/arrange.js`, `composer.js`                          | A cycle's plan as notes per bar, and the page's side of the composer.                    |
| `src/sway/composer.py`, `/api/compose` in `app.py`                  | Asks Qwen for the band's next cycle and validates its plan.                              |
| `web/instrument/camera.js`, `web/vision-worker.js`                  | Camera capture with capture times, and MediaPipe hand tracking off the main thread.      |
| `web/instrument/overlay.js`, `main.js`                              | The drawn instrument, heads-up display, and page wiring.                                 |
| `web/instrument/tutorial.js`, `coach.js`                            | Lesson charts, judging, and timing calibration; the setup and lesson flow.               |
| `web/instrument/midi.js`, `wav.js`, `recorder-worklet.js`           | MIDI and WAV encoding, and recording the mix while a piece plays.                        |
| `tests/instrument-*.test.js`, `test_harmony.py`, `test_composer.py` | Timing, harmony, hand, control, band, looper, camera, engine, export, and lesson checks. |

The theremin experiment:

| Path                                                        | Responsibility                                                                       |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `web/theremin.html`, `theremin.css`, `theremin.js`          | The page, its words, and its readouts.                                               |
| `web/theremin-controls.js`                                  | Hand features to pitch, spread, articulation, and energy.                            |
| `web/theremin-audio.js`, `theremin-worklet.js`              | Streamed playback with gain, filter, room, and limiter, and the recording of a take. |
| `web/audio-buffer.js`                                       | The stereo buffer the worklet plays from.                                            |
| `src/sway/theremin.py`, `/api/theremin/stream`              | Turns the newest controls into MRT2's notes and style, 40 ms at a time.              |
| `tests/theremin-controls.test.js`, `tests/test_theremin.py` | Controls, validation, stream ownership, and cleanup.                                 |

The motion-to-music measurements ([design note](motion-to-music.md)):

| Path                                            | Responsibility                                                                      |
| ----------------------------------------------- | ----------------------------------------------------------------------------------- |
| `src/sway/steering.py`                          | Scripted movements, instrument variants, copied model states, and the measurements. |
| `src/sway/pitch.py`                             | Which notes a stretch of audio plays, found by harmonic summation.                  |
| `src/sway/listening_test.html`                  | The blind listening page that a run writes next to its clips.                       |
| `tests/test_steering.py`, `tests/test_pitch.py` | Variants, features, measurements, and note finding, with a fake model.              |

`uv run --locked python -m sway.steering --out <new folder>` runs every variant with real MRT2 and writes `summary.md`, `results.json`, the kept clips, and `listening-test.html`.
`--variants`, `--tests`, `--seeds`, and `--keep-audio` narrow the run, and `--ask sound` makes the listening test ask about the sound instead of the movement.
`--continuity` instead compares a scripted performance with and without V2's spine, in a listening page that counts preferences rather than right answers.

The steered page ([guide](steered-page.md)):

| Path                                                                          | Responsibility                                                                                    |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `web/steered.html`, `steered.js`                                              | The page, its words, and its readouts; it uses `theremin.css`.                                    |
| `web/steered-controls.js`                                                     | Hand features to height, activity, and spread, for the steered variants.                          |
| `web/conductor-controls.js`                                                   | Hand features to the conductor's dynamics, energy, voice, articulation, hush, and moving on.      |
| `web/gesture-guide.js`                                                        | The conductor's gestures, drawn as looping animations that open over the stage.                   |
| `src/sway/steered.py`, `/api/steered/stream`                                  | Plays the film score, or an earlier variant, 40 ms at a time.                                     |
| `src/sway/world.py`, `arranger.py`, `piece.py`                                | The film score world, the composer's phrase plans, and the conducted piece.                       |
| `tests/steered-controls.test.js`, `tests/test_steered.py`                     | Controls, claps, validation, stream ownership, and the one model thread.                          |
| `tests/test_arranger.py`, `tests/test_piece.py`, `conductor-controls.test.js` | The world, the composer's prompt and checks, phrases, gestures, moving on, loudness, and silence. |

Shared by the theremin and steered pages:

| Path                 | Responsibility                                                                                 |
| -------------------- | ---------------------------------------------------------------------------------------------- |
| `web/stream-page.js` | The camera and pointer input, the stream's socket, start and stop, recording, and drawing.     |
| `src/sway/stream.py` | One window at a time plays a renderer on the model thread, with the GPU filler between frames. |

Shared by both:

| Path                 | Responsibility                                                                            |
| -------------------- | ----------------------------------------------------------------------------------------- |
| `src/sway/music.py`  | The MRT2 adapter: the exported model, MusicCoCa style embeddings, and note conditioning.  |
| `src/sway/app.py`    | The loopback-only server and its static files.                                            |
| `src/sway/cli.py`    | `sway setup`, `doctor`, and `serve`.                                                      |
| `src/sway/config.py` | Data paths and pinned model revisions.                                                    |
| `src/sway/schema.py` | Validated harmony and composer messages.                                                  |
| `src/sway/qwen.py`   | The Qwen credential, endpoint, and the client that V1's composer and V2's arranger share. |

In the browser console, `window.sway` exposes the engine, controls, and a scripted `input()` that feeds the same features as a hand.
Hand features carry 21 mirrored, smoothed image landmarks, centred on the same palm position that drives the controls.
The mirrored live video remains visible with reduced saturation and brightness so the performer and room provide spatial context behind the instrument.
Hand accents use only the tracked bones and six small markers per hand; no inferred surfaces, particles, or trails are drawn.
`POST /api/harmony/start` begins a piece's model stream, and `POST /api/harmony/bar` returns one bar of 16-bit stereo PCM at 48 kHz; bars for a piece that has since been replaced get HTTP 409.
With real MRT2 assets present, `tests/test_harmony.py` also renders two bars with each of five seeds and checks that each bar's median over the seeds stays in key.
`POST /api/compose` returns Qwen's plan for the next cycle, and `GET /api/compose/status` says whether Qwen is configured without revealing the key; the tests replace Qwen with a mock transport, so they make no billable requests.

## Data and evidence

These are default locations on the development machine.
All repository-local paths in this table are ignored by Git.

| Location                        | Contents                                                                      |
| ------------------------------- | ----------------------------------------------------------------------------- |
| `.cache/models/`                | Downloaded MRT2 and MediaPipe assets.                                         |
| `outputs/v1-ready-2026-10-03/`  | V1 candidate test results, browser recordings, exports, and UI screenshots.   |
| `outputs/theremin-2026-10-05/`  | Theremin test scripts, replays, recordings, and screenshots.                  |
| `outputs/v1-settle-2026-10-14/` | The October 14 20-minute V1 run: script, recording, statistics, and analysis. |
| `work/finger-drumming.y4m`      | The recorded drumming clip used as a fake camera in headless browser checks.  |
| `~/.config/sway/qwen.json`      | Private Qwen credential and region configuration outside the repository.      |

V1's finished pieces are browser downloads, and the theremin saves each take's WAV the same way.

`SWAY_DATA_DIR` relocates the default `.cache` data root.
Setup and serving must use the same value.
Git history preserves source and reports, but not model assets, recordings, or credentials.
Preserve wanted local artifacts separately before deleting or archiving this checkout.
