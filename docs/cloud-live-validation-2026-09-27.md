# Live Colab music with Qwen cloud

Date: 2026-09-27, Asia/Singapore.
This historical record covers the live single-action implementation before the later Qwen ensemble revision.
It verified a live performance path with MRT2 Base on Colab and Qwen3.8-Max on Alibaba's Beijing endpoint.
See [project status](project-status.md) for the paused state and [ensemble validation](gesture-ensemble.md#validation-evidence) for the later local test.
The Mac handles tracking, the musical controller, audio playback, and recording.
The [setup guide](cloud-setup.md#play-with-colab-music-and-qwen-cloud) explains how to reproduce the connection.

## Implementation

An authenticated Colab SSH connection carries a private WebSocket music stream.
The GPU service binds to loopback and accepts one performer with an ephemeral music-session token.
It receives an allowlist of musical controls and reuses Sway's existing note planner, style blending, gain envelope, and pacing.
It retains the model in memory between performances and resets generation state when a new performance starts.
The Colab upload contains selected source files and that session token, without camera frames, landmarks, or the Qwen credential.
The browser only connects to the local Sway server.

The UI offers **Colab / MRT2 Base (experimental)** independently of **Gesture map + Qwen cloud**.
It identifies where music runs, explains the camera data flow, and displays the GPU session's expiry time.
**End performance** stops generation but leaves the allocated GPU available until the runner's deadline or Ctrl-C.
The live runner releases its VM after its bounded test window and on handled failures or interruption.
Keep the runner and Mac active for cleanup to execute.

## Live checks

The assigned GPU was an NVIDIA A100-SXM4-40GB with 40,960 MiB and driver 580.82.07.
The runtime used the pinned source and model revisions from the [initial Colab pilot](cloud-validation-2026-09-26.md).
The trial used Chrome's synthetic camera and the real Qwen API, so it tests the combined data path without recording a performer's camera footage.
Qwen returned valid `unknown` intents for those synthetic images.
No recognition-accuracy or musical-quality comparison is claimed.

The first live pass exposed six dropped relay frames when network packets arrived in bursts.
The local interprocess audio queue now holds up to 32 remote frames, while local generation retains its eight-frame queue.
The browser's existing 320 ms startup buffer and bounded catch-up behavior remain unchanged.

The repeat collected 56 status observations over approximately 55 seconds and reached 58.7 seconds of performance time:

| Observation                                                  |                   Result |
| ------------------------------------------------------------ | -----------------------: |
| GPU generation, sampled median                               | 37.64 ms per 40 ms frame |
| GPU generation, sampled p95                                  | 39.83 ms per 40 ms frame |
| Control sent to corresponding audio received, sampled median |                 309.2 ms |
| Control sent to corresponding audio received, sampled p95    |                 369.2 ms |
| Generated frames at the final sample                         |                    1,436 |
| Producer / relay dropped frames                              |                    0 / 0 |
| Browser gaps immediately after that window                   |                        0 |
| Browser queue immediately after that window                  |                   739 ms |

These are periodic status samples, not a complete per-frame latency distribution.
The control measurement excludes camera processing, Qwen inference, browser buffering, and physical audio output.
The configured startup buffer is not a guarantee that the live playback queue stays at exactly 320 ms.
Continued inspection reported a playback gap by 2:26 and the counter showed two after stopping, while the relay drop counter remained zero.
Continuous playback is still experimental; the short zero-gap interval does not establish sustained reliability.

Recording through the browser produced a valid stereo PCM WAV at 48 kHz, with 1,618,560 frames (33.72 seconds) and nonzero audio.
Manual piano and strum changes traversed the existing controller during that recording.
The recorded file is retained locally at `.cache/recordings/sway-20260927-032000-58c9ac2c.wav`.
The test browser was inspected at 1200 px and 500 px widths; the compact layout had no horizontal overflow.
An expiry simulation confirmed that **End performance** remains enabled when the GPU reservation expires.

Sanitized status observations, UI diagnostics, and screenshots are retained under ignored `work/colab-live-*` paths.
The live session was `sway-live-20260927-111455-9337`, initially reserved until 11:47:16 Singapore time.
The observed allocation rate was 5.30 compute units per hour, and the balance snapshot was 199.61 units.
Those are account snapshots, not a final billing statement.

## Verification and handoff

The full Python suite passed 65 tests, including real loopback WebSocket tests for authentication, stereo framing, control delivery, and disconnect cleanup.
After the relay-queue change, the eight affected transport, session, and live-runner tests passed again.
The three JavaScript audio-buffer tests, Python lint/format checks, JavaScript syntax check, and Git whitespace check passed.
The existing Starlette test-client deprecation warning remains.
`uv add` generated the direct WebSocket dependency and updated lockfile platform markers; package versions did not change.

Task-owned synthetic-camera browser and test servers were stopped after validation.
The local Sway server and bounded Colab runner were left available for the user's live test.
After the reserved window expired, the runner reported successful release and exited; a subsequent `colab usage` check confirmed zero active assignments and a usage rate of 0.00 units per hour.
The local Sway server remains available, but the expired Colab session must be replaced before another cloud music performance.
The next evaluation is a real performer session, with particular attention to the added control delay, occasional playback gaps, audible gesture response, and the larger model's musical quality.
