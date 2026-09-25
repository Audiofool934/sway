# First prototype validation

Date: 2026-09-26, Singapore time.
Machine: Apple M2 Pro, 16 GB unified memory, macOS 26.6.2.
This is an engineering validation of a research prototype, not a gesture-recognition or musical-quality benchmark.

## Working implementation

- Camera acquisition, local MediaPipe hand/pose workers, and timestamped motion messages.
- Causal stroke detection, pulse estimation, confidence handling, and tracking-loss fade.
- Actual local Qwen inference over ordered images plus motion features.
- A validated semantic schema, two-observation debounce, and a tracked-hands gate.
- Continuous MRT2 generation with persistent state, style blending, and a harmonic note planner.
- Stereo browser playback, manual action and tempo control, recording, and WAV download.
- Owned model processes that stop on End performance, window disconnect, or server shutdown.

## Automated checks

26 Python tests and 3 JavaScript tests passed.
Ruff, Prettier, JavaScript syntax checks, and `git diff --check` passed.
`uv run --locked sway doctor` found all required local assets.

Tests include synthetic smooth finger motion at 90, 120, and 150 BPM, pulse intervals from 60 to 180 BPM, duplicate timestamps, tracking gaps, semantic rejection, and MIDI conditioning states.
They also cover stereo resampling to 44.1 kHz, playback underruns, bounded queue catch-up, recording closure, spawned-process lifecycle, cross-origin rejection, and single-window ownership.
Synthetic landmark tests demonstrate the signal-processing behavior, not real-camera recognition accuracy.

The test suite currently emits one upstream Starlette warning about its deprecated `httpx` TestClient backend.
It does not affect the passing results.

## Real model measurements

The final command-line render used the actual MRT2 Small export with chamber style, piano action, a requested 108 BPM, and seed 7.
Five warm-up frames were excluded before recording the measurements.

| Measurement | Result |
| --- | --- |
| Generated audio | 30.00 seconds, 48 kHz stereo |
| Timed generation | 13.91 seconds |
| Median frame generation | 18.15 ms |
| 95th-percentile frame generation | 19.29 ms |
| Frames taking over the 40 ms budget | 0 / 750 |
| Audio RMS | 0.04448 |
| Peak absolute amplitude | 0.36078 |

These are measurements of model generation in isolation.
They do not establish total performance latency, measured output BPM, or the absence of playback glitches under other workloads.

## Browser and combined workload

Desktop and narrow layouts were inspected in Chrome at 1440 px and 390 px widths.
The performance surface, camera controls, live waveform, model states, and recording state were checked.
The narrow layout had no horizontal overflow.
Camera tests used Chrome's generated test video, not the user's camera or a recorded human performance.
The actual MediaPipe models and Qwen model processed that test stream.

An earlier combined run with Qwen3.5-0.8B, token yielding, and a 320 ms playback buffer ran for roughly 4 minutes 53 seconds.
It reported **two playback underruns**, zero music-queue dropped frames, and zero playback catch-up drops.
Typical semantic observations in that run took roughly 1.2 to 1.6 seconds.
Occasional generation overruns occurred even where the playback buffer concealed them.
Subsequent runs also exposed sustained live scheduling slowdowns, including with semantics disabled.
These results prompted an explicit macOS interactive scheduling request for the audio worker.

During that session, explicit control messages changed the requested tempo from 108 to 132 to 84 BPM and the action from open ensemble to strumming to sustained phrasing.
The saved take contains 205.64 seconds of generated stereo audio, with RMS 0.03996 and peak 0.36136.
Its recording metadata closed successfully and reports `recording: false`.
The style changes were deliberately supplied as controls; they were not inferred from a human gesture video.
The WAV captures generated samples before browser playback, so it does not reproduce browser underrun silence or the user's volume setting.

## Final live scheduling check

After requesting `QOS_CLASS_USER_INTERACTIVE` for the audio worker, a fresh combined run reached **4 minutes 58 seconds with zero playback underruns, zero dropped audio frames, and zero catch-up drops**.
Both model workers and the synthetic camera stream remained active.
The server reported successful application of the scheduling request.
Typical sampled generation times were around 23 to 26 ms, with a 320 ms initial playback buffer.
At roughly 202 seconds, 4,928 audio frames had been generated and 69 individual frame-budget overruns had been absorbed without a reported playback gap.
The latest semantic inference took 1.215 seconds.
Explicit tempo and style controls were changed during this run.

This is a successful bounded runtime check on this machine, not a guarantee for arbitrary real-world scenes or competing workloads.
That scheduling test did not use human air-instrument footage, so it does not establish gesture accuracy.

## Recorded human gesture check

A subsequent check used recorded finger movement from [Qualcomm's Jester dataset](https://www.qualcomm.com/developer/software/jester-dataset), obtained from the small subset linked by [BrainChip's gesture example](https://doc.brainchipinc.com/examples/spatiotemporal/plot_0_introduction_to_spatiotemporal_models.html).
Jester is research-use data; these local QA fixtures are ignored by Git and are not included in the product.
The source frames are only 100 px high at 12 FPS, so this is a pipeline check with a substantial resolution limitation.

Nine clips were selected in archive order: the first three finger-drumming, thumbs-up, and no-gesture examples.
An isolated semantic pass sampled three frames at half-second intervals around each clip's midpoint, without measured motion features.
The original prompt returned valid schema output for eight of nine clips.
Two finger-drumming clips were called strike and one still; two resting clips were called still and one returned invalid output.
One thumbs-up was incorrectly called strike and the other two still.
This small diagnostic does not establish recognition accuracy and shows that unrelated hand gestures can still be misinterpreted.
A more explicit prompt trial reduced schema reliability to four of nine clips and was reverted.

For the full pipeline, clip 46546, labeled Drumming Fingers, was looped through Chrome's file-backed test camera with the production hand tracker, semantic worker, and music engine.
There were no manually supplied musical actions or tempos during this run.
The tracker observed a hand, extracted accents, and supplied pulse estimates to the controller.
The accepted semantic action changed from open ensemble to piano at approximately 30 seconds after repeated model observations.
The run reached 70 seconds with zero browser playback gaps, zero audio queue drops, and zero playback catch-up drops.
At the final browser sample, the music frame took 18.6 ms and 25 individual engine-budget overruns had occurred without a reported playback gap.

The footage contains independent moving fingers, but it is not a deliberate Sway performance with a known target BPM.
Loop boundaries and landmark noise can create extra accents; the observed tempo values are not an accuracy result.
Repeated low-confidence outputs delayed the first accepted interpretation.
This verifies that real recorded movement can drive both automatic control paths while generated music streams, but human testing remains essential.

## Findings that changed the implementation

- The MRT2 exported graph failed under MLX 0.32.2 and loaded under 0.31.2, so the runtime is pinned.
- Qwen3.5-4B ran locally but competed heavily with audio generation for the GPU.
- The smaller 0.8B model improved inference speed; chunked prefill and token yielding reduced contention further.
- A coarse shared GPU lock caused worse playback and was removed.
- Explicit macOS interactive scheduling stabilized the final live run; the audio worker requests it before creating the model runtime.
- CPU fallback was explored but was not viable with the tested MLX-VLM path; no dependency monkey patches are included in the product.
- The semantic model sometimes called the generated camera pattern “piano” with high confidence despite there being no hands.
- Consequently, semantic changes require tracked hands in addition to repeated model output; the UI labels interpretation experimental.
- Smooth finger strokes needed a peak velocity accumulated across the stroke, rather than a threshold applied only to the last sample before reversal.

The smaller model's self-reported confidence is not reliable evidence of correctness.
The hand gate prevents the observed empty-scene failure from changing the music, but it cannot validate the meaning of a real gesture.
Occasional invalid JSON responses were rejected while preserving musical state, and the interface reports interpretation failures.

## Still to measure

1. Accuracy and latency on deliberate air-piano, strumming, striking, and bowing performances beyond the small recorded-gesture check.
2. Motion onset to audible response, including camera, model, buffer, and output-device delays.
3. Actual generated beat alignment and tempo response.
4. Musical coherence over a complete piece and deliberate endings.
5. Performance with complex scenes, different camera positions, and other applications using the GPU.

The initial browser buffer is 320 ms and can grow during stalls.
This is additional to model response time.
Direct musical evaluation remains necessary.

## Prototype delivery audit

The immediate goal is a playable prototype for the first performer test.
The broader research measurements proposed in the initial design are not claimed as completed.

| Requested capability | Delivered evidence | Remaining limitation |
| --- | --- | --- |
| Camera captures finger and body motion | Browser camera input and actual MediaPipe inference, including recorded human fingers | The user's own camera and playing position await testing |
| Motion supplies rhythm | Causal accents and pulse estimation, synthetic timing tests, and live recorded-gesture control | Real-world tempo accuracy and audible beat alignment remain unmeasured |
| MLLM receives motion and meaning | Qwen receives ordered images and measured features; a real recorded gesture changed the accepted action | Small-model interpretations are inconsistent and can take tens of seconds |
| Music responds while a piece unfolds | Stateful MRT2 stereo streaming, harmonic cues, style blending, and combined runtime tests | Long-range musical form and intentional endings remain research work |
| Training-free implementation | Frozen, pinned model weights used only for inference | No new end-to-end model is trained |
| Ready for local testing | Installed assets, launcher, first-play guide, manual comparison controls, and WAV recording | Implementation remains local and has not been pushed to the public remote |

All task-owned test servers, model processes, and browser sessions were stopped after validation.
The launcher starts a fresh server for the performer, who stops it with Ctrl-C.

## Reproduce

```bash
uv run --locked sway doctor
uv run pytest -q
node --test tests/audio-buffer.test.js
uv run sway render --seconds 30 --output outputs/validation-take.wav
uv run sway serve
```

For browser testing, start with **Choose a musical action** to establish the lighter baseline.
Then end the performance, select **Interpret my movement (experimental)**, and compare the counters in Session details.
Keep the camera angle and gesture sequence consistent across the two runs.

Colab usage was checked before GPU planning: 200 compute units available, zero active assignments.
No Colab VM was started and no compute units were consumed by this build.
