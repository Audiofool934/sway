# Qwen cloud interpretation and Colab music trials

Updated: 2026-09-27.
Development is paused and no GPU is allocated at the [pause checkpoint](project-status.md#runtime-and-retained-data).
This guide is retained for work after the project resumes.
Sway can interpret selected camera frames through Qwen while music runs either on the Mac or on a Colab GPU.
The live Colab runner streams controls and audio through an authenticated SSH connection.
A separate trial runner renders and benchmarks models without a live browser.
See the [measured results](cloud-validation-2026-09-26.md) before choosing a GPU.
The [live streaming results](cloud-live-validation-2026-09-27.md) cover network delay and remaining playback gaps.
For the separate source-preserving Flow experiment, follow the [Flow guide](flow-mode.md) and [live validation](flow-validation-2026-09-27.md).

## Compute policy

Everett has delegated ongoing responsibility for Sway to the agent, including model selection, implementation, evaluation, and compute management.
On 2026-09-27, Everett authorized as much Colab GPU use as the Sway work needs, provided it is careful and efficient.
The Colab allocation is reserved exclusively for agent-managed Sway work.
This is standing authorization for repeated use of the workflow; routine project experiments do not need renewed approval.
There is no preset overall compute-unit budget for these experiments.
Prepare the experiment and its inputs before allocating, batch related measurements on the same loaded model, and preserve useful outputs before release.
Choose hardware for the workload and measured throughput, and check current availability and usage rather than assuming an older account balance or allocation rate still applies.
Give each run an automatic runtime limit to catch stalls, release owned sessions on success or failure, and verify that the allocation has ended.

The DEMON feasibility runner reuses a supplied Sway render as source audio and collects three transformations plus headless streaming measurements:

```bash
uv run python scripts/run_colab_demon_trial.py \
  --input /absolute/path/to/stereo-48khz-source.wav \
  --gpu A100 --timeout 2400
```

Input duration must be 10-60 seconds.
The runner pins the inspected DEMON revision, follows its upstream setup, skips unused LoRAs and Stable Audio 3 assets, and saves results under `outputs/colab/`.
These engine measurements exclude network, playback, and perceptual control latency.
The [DEMON trial report](demon-colab-validation-2026-09-27.md) contains the measured results, listening comparisons, and compute usage.
Use `--stream-only` to measure streaming without repeating the batch renders.
An optional `--engine-cache /absolute/path/to/cache` accepts retained engine/metadata pairs with a manifest; it validates hashes locally and checks the GPU and TensorRT version remotely.
The first cache-transfer trial found that this Mac's upload time exceeded the saved compilation time, so cache upload remains opt-in.
Prefer batching useful measurements on one loaded runtime; default to rebuilding when transferring a cache would take longer.

## Configure Qwen privately

On the configured development machine, the Beijing API key is already installed and verified.
There is no need to paste it into chat or put it in the repository.
For a new installation, create `~/.config/sway/qwen.json` in a local editor with this structure:

```json
{
  "region": "beijing",
  "workspace_id": "",
  "api_key": "PASTE_YOUR_KEY_LOCALLY",
  "model": "qwen3.8-max"
}
```

Restrict access to your account:

```bash
chmod 700 ~/.config/sway
chmod 600 ~/.config/sway/qwen.json
```

Sway rejects a credential file that grants permissions to other users.
Keep the file outside the repository and use an editor rather than a shell command containing the actual key.
The backend reads it when starting the interpretation worker; restart the performance after changing it.
The browser receives configuration status, region, model identity, token counts, and safe errors, but no key or workspace ID.
Sway does not log provider response bodies, request headers, or camera images.

The default Beijing URL is `https://dashscope.aliyuncs.com/compatible-mode/v1`.
Set `region` to `singapore` to use `https://dashscope-intl.aliyuncs.com/compatible-mode/v1` instead.
A supplied workspace ID selects the corresponding workspace-specific URL in that region.
Use a key and workspace from the same region; the Beijing regional URL worked without a workspace ID in this pilot. [Alibaba regional endpoints](https://www.alibabacloud.com/help/en/model-studio/regions)

Environment variables override the file:

| Variable                 | Purpose                                     |
| ------------------------ | ------------------------------------------- |
| `DASHSCOPE_API_KEY`      | API credential                              |
| `SWAY_QWEN_REGION`       | `beijing` or `singapore`                    |
| `SWAY_QWEN_WORKSPACE_ID` | Optional workspace ID                       |
| `SWAY_QWEN_MODEL`        | Model identifier; defaults to `qwen3.8-max` |
| `SWAY_QWEN_CONFIG`       | Alternative path to the private JSON file   |

## Verify and play

```bash
uv run sway doctor
uv run sway qwen-check
uv run sway serve
```

`doctor` checks configuration without calling Qwen.
`qwen-check` makes one billable API request with two synthetic blank images, then prints a validated intent, duration, and token usage.
It does not access the camera.
A low-confidence arrangement is expected for blank images and confirms connectivity, not recognition quality.

Open `http://127.0.0.1:8765/ensemble.html`, choose **Qwen conductor / ensemble**, begin a performance, and enable the camera.
The mode selector and camera notice make the cloud data flow visible.
This mode is selected automatically when Qwen is configured.
Cloud mode does not need the downloaded local Qwen model; `uv run sway setup --music-only` is sufficient for a new installation that will use cloud interpretation.

The browser sends three ordered JPEG frames, 384 pixels wide and sampled 500 ms apart, at a 3.5-second submission interval.
The worker processes requests serially and drops outdated observations.
The backend adds independent hand observations and the current arrangement, and requests structured JSON with thinking disabled.
The client uses an 8-second read timeout and 2-second connect/write/pool timeouts; these are network operation timeouts, not a guarantee of total request duration.
Timeouts, temporary server errors, and rate limits preserve the current arrangement and allow later observations to retry.
Credential or model-access errors stop the interpretation worker and show an error while music continues.
Session details report the latest model identity, token usage, and inference duration.

Qwen returns simultaneous parts, harmony, phrasing, energy and a pace suggestion.
The controller prepares the new style without blocking generation and applies the complete arrangement at a bar boundary.
Sparse harmonic cues follow the shared musical clock, not raw hand strikes.
Qwen's musical energy also controls a slow gain envelope after generation; it does not directly change the browser's playback-volume setting.
The local gesture classifier supplies evidence and cannot overrule Qwen in conductor mode.
Cloud request latency therefore is not the full gesture-to-sound latency.
See the [Gesture ensemble guide](gesture-ensemble.md) for the control contract and its measured limitations.

## Play with Colab music and Qwen cloud

Run this in a terminal using the installed, authenticated Colab CLI:

```bash
colab usage
uv run python scripts/run_colab_live.py --gpu A100 --model mrt2_base --minutes 30
```

Keep that runner active and wait for `READY`.
It allocates one GPU, installs the pinned runtime, loads the model, and warms it up before exposing the connection to Sway.
In another terminal, start or restart `uv run sway serve`, then open `http://127.0.0.1:8765/ensemble.html?music=colab&interpretation=qwen`.
The URL selects **Colab / MRT2 Base (experimental)** and **Qwen conductor / ensemble** when both are configured.
Press **Begin performance**, enable the camera, and allow camera access.

The Mac performs tracking, maintains the musical controller, and plays and records the returned audio.
Qwen receives selected images and motion features for interpretation.
In Qwen mode, Colab receives the validated arrangement, its revision, tempo target, and musical controls; raw hand accents are not forwarded.
The older comparison modes send action, register, articulation, intensity, and accent events.
The remote worker uses the same arrangement clock, style preparation, note planning, and gain behavior as the corresponding local mode.
It does not receive camera images, landmarks, or the Qwen key.

The service listens only on the VM's loopback interface.
The runner opens an SSH connection through Colab's authenticated runtime connection and forwards one loopback port on the Mac.
An ephemeral SSH identity and a separate random music-session token are stored in a private, ignored `.cache/colab/` directory.
The browser uses the normal local Sway server and does not receive these credentials.
No public tunnel or public music endpoint is created.

**End performance** stops music generation and resets the performance for the next play.
The GPU remains allocated for reuse until the runner's deadline or until you stop the runner with Ctrl-C.
The default deadline is 30 minutes after readiness, and the UI displays the local end time.
The runner attempts to release its VM when the window expires, when the connection fails, or when it is interrupted.
Keep the runner and Mac active for automatic cleanup to execute.
After stopping, verify `colab usage` and the runner's `.cache/colab/SESSION/result.json` release report.

The setup timeout is 20 minutes, separate from the playing window.
Use `--minutes 5` through `--minutes 60` for a different playing window.
The script refuses to replace an existing connection file or occupy an already-used port.
An unavailable cloud music connection shows an error; restarting the performance is required after reconnection.

Session details show GPU frame time, relay drops, and the interval from sending a control to receiving audio generated with that control.
That interval excludes camera processing, browser buffering, and physical speaker latency.
Cloud interpretation adds its own observation, request, and controller delays.
The initial browser audio buffer remains 320 ms.

This is a bounded interactive compute experiment using the account's paid compute units.
Colab resource availability and runtime limits remain variable; the connection is not an always-on deployment. [Colab FAQ](https://research.google.com/colaboratory/faq.html)

## Run MRT2 on Colab

Use the installed, authenticated `colab` CLI on the development machine.
Each run allocates a GPU and consumes the account's compute units.
Check the balance and active assignments first:

```bash
colab usage
uv run python scripts/run_colab_trial.py --gpu A100 --model mrt2_base --seconds 30 --timeout 1200
colab usage
```

The runner uploads only `scripts/colab_music_trial.py` and a launcher to its own named session.
Qwen credentials, camera frames, and other local files are not uploaded.
The remote script downloads public model assets and runs the pinned upstream JAX implementation in an isolated Python 3.12 environment.
Its source and asset revisions, critical dependency versions, GPU, and timing results are recorded in `metrics.json`.
Transitive packages are resolved during installation; this is not a fully locked VM image.

The trial renders 30 seconds of 48 kHz stereo music with repeated note cues and a piano-to-guitar style change halfway through.
It measures individual 40 ms audio frames after compilation and 50 warmup frames.
This tests generation throughput and produces a take for listening; it does not measure network delivery, browser playback, motion recognition, or audible note alignment.

Results are written under `outputs/colab/sway-mrt2-DATE-TIME-ID/`:

| File                 | Contents                                                       |
| -------------------- | -------------------------------------------------------------- |
| `performance.wav`    | Generated stereo audio                                         |
| `metrics.json`       | Generation timing, runtime versions, GPU, and audio statistics |
| `control-trace.json` | Requested notes and style changes                              |
| `run.log`            | Setup and inference output                                     |
| `remote-status.json` | Remote script exit status                                      |
| `session.json`       | Session identity, GPU request, and release confirmation        |

The default work limit is 20 minutes, covering allocation, setup, execution, and downloads.
The runner attempts to release its VM in `finally`, including after errors or interruption, with up to one additional minute for cleanup.
Check `session.json` for `"released": true` and confirm assignments with `colab usage`.
If release fails, use the exact recovery command printed by the runner; it includes the isolated state file and session name.
Do not stop unrelated sessions.

To compare models on the V1 instrument's own music, pass `--conditioning` with a `.npz` holding `tokens` (one row of 128 note states per 40 ms frame, from Sway's arrangement and `sway.harmony.bar_tokens`), `palettes`, and `prompts`.
The remote script then renders that conditioning in each palette with the Mac engine's sampling settings, and the runner downloads `harmony-PALETTE.wav` files and per-palette timings instead of the benchmark.

MRT2 Base was too slow for this one-frame workload on L4.
A100 was slightly faster than playback, leaving limited headroom for a live transport experiment.
The live runner connects streaming controls and audio; sustained playback and full input-to-sound delay require separate measurement.
