# Qwen and Colab pilot validation

Historical validation of the pre-ensemble pilot; see [project status](project-status.md) for the later implementation and paused state.

Date: 2026-09-26, Asia/Singapore.
This records the initial pilot; the [September 27 setup](cloud-setup.md#play-with-colab-music-and-qwen-cloud) adds live Colab streaming after these measurements.
The working tree adds an optional cloud interpreter and a separate Colab music trial runner.
The broader [evaluation plan](evaluation-plan.md) still requires recognition, listening, and sustained-playback tests.

## Qwen connectivity and browser flow

The local backend successfully called `qwen3.8-max` in Beijing with thinking disabled and JSON output.
The API key is stored in a private file outside the repository and was not pasted into chat, browser code, or Colab.
The regional endpoint worked with no workspace ID.

| Check                                | Observed result                                                          | Limit                                                                |
| ------------------------------------ | ------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| `uv run sway qwen-check`             | Valid `unknown` intent in 2,374 ms; 346 input and 22 output tokens       | Two synthetic blank images; no action-recognition measurement        |
| Browser capture through the real API | Valid intents and token diagnostics from `qwen3.8-max`                   | Chrome's synthetic camera; no performer footage or recognition score |
| Saved browser/API status             | Latest inference 1,318 ms; 549 input and 17 output tokens                | One observation, not a latency percentile                            |
| Cloud mode without local VLM assets  | API tests pass                                                           | Browser trial also had local assets installed                        |
| Camera notice and mode selection     | Visible at desktop and 500 px compact width, with no horizontal overflow | No claim about every viewport or browser                             |
| Stop lifecycle                       | Camera disabled, performance stopped, test browser and server closed     | Checks apply to task-owned resources                                 |

The browser trial used the existing local MRT2 Small music engine.
It reported playback gaps, so moving interpretation to the API has not established continuous playback.
At a saved status point around 226 seconds, the latest generation frame took 48.03 ms and the engine had counted 1,667 frames exceeding its 40 ms budget, with zero dropped producer frames.
These counters do not measure physical output latency or identify the cause of every playback gap.
The cloud model's action remained `unknown` for the synthetic camera, as expected; there were no accepted semantic action changes.
No user-facing claim of improved recognition or musical quality follows from this test.

Local evidence is retained in ignored `work/qwen-cloud-browser-status.json`, `work/qwen-cloud-desktop.png`, and `work/qwen-cloud-compact.png`.

## MRT2 Base on Colab

Both successful trials generated 750 frames, each containing 40 ms of stereo audio, after 50 warmup frames.
The workload supplied a note onset every 480 ms, repeated C/E/G/C pitches, and changed text style conditioning at 15 seconds.
The model retained its audio state across frames and used the pinned upstream sampler's seed 0.
Both WAV files were verified as 1,440,000 frames, 48 kHz, stereo, PCM 16-bit.
No blind listening or note-following score has been collected.

| Measurement                          | NVIDIA L4, 23,034 MiB | NVIDIA A100-SXM4, 40 GB |
| ------------------------------------ | --------------------: | ----------------------: |
| Audio duration                       |               30.00 s |                 30.00 s |
| Generation wall time                 |               63.69 s |                 26.89 s |
| Audio seconds per compute second     |                  0.47 |                    1.12 |
| Median frame generation              |              84.80 ms |                35.63 ms |
| p95 frame generation                 |              85.23 ms |                36.80 ms |
| Maximum frame generation             |              87.14 ms |                38.80 ms |
| Frames exceeding 40 ms               |             750 / 750 |                 0 / 750 |
| Model initialization and compilation |               61.49 s |                 48.43 s |
| VM release confirmed                 |                   Yes |                     Yes |

L4 cannot sustain this workload at playback speed.
A100 crossed the throughput threshold in this short run, but only by about 12% in audio throughput.
Networking, encoding, buffering, scheduling variation, longer performances, and different conditioning remain unmeasured.
A100 is a candidate for a live experiment, not a validated production music backend.
Sway's browser still connects to local music generation.

The initialization measurement covers model construction and compilation after style resources are loaded; it excludes VM allocation, package installation, model downloads, and warmup.
The remote environment used Python 3.12, JAX/JAXlib 0.10.1, Flax 0.12.7, NumPy 2.3.5, and AI Edge LiteRT 2.1.5.
The source revision was `694a545e4ba0b88bf1150137b129582166d3e07f`, and the model-asset revision was `010aa0dcb0dfd27b24f0ad07b4dad63e8f9521cc`.
GPU driver 580.82.07 was reported on both VMs.

Local result directories under `outputs/colab/`:

- L4: `sway-mrt2-20260926-230902-58bf`.
- A100: `sway-mrt2-20260926-231343-5827`.
- An earlier setup failure, `sway-mrt2-20260926-230649-3da5`, also released its VM.

The first failed attempt did not forward enough remote output to establish its cause.
The runner now forwards subprocess output, uses an explicit Python 3.12 environment, and checks a remote exit-status file because a successful `colab exec` exit code alone can hide a remote exception.
After all trials, `colab usage` reported zero active assignments and a 0.00/hr usage rate.
The reported balance changed from 200.00 to 199.89 compute units; this is a balance snapshot, not a final billing statement.

## Automated checks

- `uv run pytest -q`: 58 passed.
- `node --test tests/audio-buffer.test.js`: 3 passed.
- `uv run ruff check src tests scripts`: passed.
- `uv run ruff format --check src tests scripts`: passed.
- `node --check web/app.js`: passed.

The Python run emitted the existing Starlette test-client deprecation warning about `httpx` and `httpx2`.
Cloud tests use mocked HTTP transports and verify credential redaction, frame order, structured output, failure handling, and worker recovery.
Colab runner tests verify release on failure, recorded cleanup failure, and detection of a remote failure when the CLI itself exits successfully.
Real provider connectivity and GPU measurements were separate live checks; ordinary tests incur no API or GPU charges.
