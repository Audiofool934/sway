# Flow mode: implementation and live validation

Date: 2026-09-27, Asia/Singapore.
Status: playable local mode, prompt generation and source transformation verified on Colab, GPU released.
This is a dated implementation record; Flow is now deferred and the [project is paused](project-status.md).
The [Flow guide](flow-mode.md) describes the controls and repeatable setup.

## What changed

Flow has a separate browser AudioWorklet that owns a saved source, playback position, bar boundaries, expression smoothing, variation crossfades, and an intentional ending.
The original source is immutable within a performance.
Movement can blend toward the current variation immediately and request a new, bounded transformation after settling.
Cloud generation finishes and transfers the complete passage before a bar-aligned replacement is scheduled.
Camera loss, cloud loss, and local server restarts do not discard already loaded audio.

The included original sketch has a known eight-bar, 96 BPM timeline.
The Colab adapter also generated two independent twenty-second passages from text prompts and produced five transformations across them.
Both neural sources and all variations were retained locally.
Generated tempo and key remain requests rather than verified musical properties.

## Actual browser recordings

The first browser run recorded 77.207 seconds of the composed sketch with a manual variation move, return to the source, and a phrase ending.
The second recorded **182.111 seconds** from a prompt-generated source.
Its audio-clock trace contains three generated-variation swaps, two returns to the original, intensity changes, and a final fade.
Every swap occurred on an exact bar boundary of the requested 96 BPM grid: frames 1,320,000, 2,040,000, and 4,800,000 at 48 kHz.
The source was not restarted during those changes.

Both WAVs are finite, stereo, 48 kHz PCM recordings captured after expression and before listening volume.
The live take's peak was approximately 0.717 full scale and its RMS approximately 0.090.
Its duration matches the captured sample count, and the ending decays toward silence.
These are signal and timing checks, not a perceptual judgment of the music.

- [Three-minute generated performance](../outputs/flow-validation-2026-09-27/live-performance.wav)
- [Composed-sketch performance](../outputs/flow-validation-2026-09-27/local-performance.wav)
- [Generated performance evidence and control trace](../outputs/flow-validation-2026-09-27/live-browser-check.json)
- [Sources, variations, hashes, and request metrics](../outputs/flow-validation-2026-09-27/passages.json)

The long-running browser check remained active for about 25 minutes with a synthetic camera stream containing no hands.
Its final displayed audio time was 24:59, with the selected blend still held at 65%.
The checks polled the browser state, not physical speaker output; they do not prove the absence of output-device dropouts.
The camera tests cover permission/startup, local hand-tracker execution, missing hands, and shutdown.
Real hand calibration, repeatability, musical identity, and subjective responsiveness need performer evaluation.

## Live GPU and network timing

One A100-SXM4-40GB allocation ran the pinned DEMON revision `229af3d3d68e7e40764c93259e88149ef6546077`.
Dependency setup took about 75 seconds, and model download plus engine preparation about 585 seconds.
Total recorded setup was about 662 seconds, excluding allocation, upload, and service startup.
The adapter uses full-passage generation and decoding, with the prepared source and prompt conditions reused where applicable.

| Observation                                     |   Engine | Complete request and transfer | Source upload |
| ----------------------------------------------- | -------: | ----------------------------: | ------------: |
| First text-generated source                     | 1,357 ms |                      4,365 ms |          None |
| First transformation before transport repair    |   418 ms |                     14,593 ms |   Full source |
| Warm transformation before transport repair     |   202 ms |                      5,525 ms |   Full source |
| Text-generated source after service repair      | 1,137 ms |                      3,891 ms |          None |
| First transformation with source reuse          |   378 ms |                      3,251 ms |       0 bytes |
| Warm automatic transformation with source reuse |   195 ms |                      2,699 ms |       0 bytes |

These are individual observations, not latency percentiles.
The first transport implementation redundantly uploaded the source on each transformation.
An authenticated SHA-256 handshake now requests source bytes only when the GPU service does not already hold them.
The service also retains the bytes of newly generated starting pieces, avoiding the first return upload.
This repair was validated on the same allocation with its existing compiled engines.

Playback and expression do not wait for these network round trips.
Audio-thread acknowledgement is shown separately in the interface and is not physical gesture-to-speaker latency.
The generated performance's requested control changes were sent through the actual sliders; no real-person gesture-latency claim is made.

## Failure behavior and resource outcome

After the runner released the GPU, the browser changed its badge to local playback and continued the saved source and variation.
The observed audio time advanced from 01:03 to 02:28 after release, and the variation blend changed from 80% to 40%.
The local audio timeline remained active without a Colab connection.
The [offline check](../outputs/flow-validation-2026-09-27/offline-browser-check.json) retains those observations.

The account balance moved from 195.04 to **193.00 compute units**, an approximate decrease of **2.04 units**.
The runner confirmed release, and the account check showed **zero active assignments and 0.00 units/hour**.
Runtime versions, model revisions, setup measurements, service code, and logs are retained under `outputs/flow-validation-2026-09-27/runtime/`.

## Checks and remaining scope

The complete Python suite passed with 77 tests.
The JavaScript suites cover the existing audio buffer plus exact source recovery before expression, stereo preservation, bar-aligned replacement, held controls with absent hands, fade endings, request coalescing, WAV encoding, and recording timestamps.
Desktop and narrow-screen layouts were inspected as rendered screenshots, and the serving application was checked at its normal localhost address.
An existing FastAPI/Starlette test-client deprecation warning remains; it did not fail tests.

This is a functioning prototype, with a repeatable compute workflow and real recordings.
Musical continuity still needs listening evaluation, and generated beat grids may require correction.
A manual beat-grid editor, Qwen phrase-level intent, MIDI composition, isolated stems, and a session importer are not implemented in Flow.

## Follow-up: hands appeared disconnected

The performer reported that hand movements did not change either control percentage.
Browser reproduction confirmed that enabling the camera left gesture control disabled until a separate calibration click.
Moving either slider or returning to the original disabled both hand controls again.
The earlier automated slider performance did not exercise these activation transitions.

Hand control now starts automatically from the current sound when either hand becomes visible.
Sliders take over their own axis while dragging and return control automatically on release.
Returning to the original preserves right-hand control and establishes a new left-hand starting position.
Missing hands hold their values; re-entry after a tracking gap picks up without a jump.
The camera is now the first setup panel, with readable hand-role labels and a tracking indicator beside each slider.

The browser regression sent controlled landmark sequences through the same worker-message handler used by the camera.
Before the fix, moving the hands without calibration left variation at 0% and intensity at 60%.
After the fix, the same movements reached 50% and 90%, and the actual AudioWorklet reported those values.
Further checks covered slider takeover, return to the original, missing hands, re-entry, and using one hand alone.
The browser captured 4.624 seconds of non-silent audio and 79 hand-origin control events, with variation spanning 0-75% and intensity spanning 40-90%.
All 18 JavaScript tests passed, including eight regressions for automatic hand control, takeover behavior, and slow tracking frames.
Desktop and narrow layouts were inspected as screenshots.
The actual MediaPipe worker also started with a synthetic camera, correctly reported no hands, and stopped cleanly.

This reproduces and fixes the control-activation fault using synthetic landmarks; it does not establish real-person tracking accuracy or subjective musical response.
No GPU was allocated for the correction.
The [before](../outputs/flow-hand-response-2026-09-27/before.json) and [after](../outputs/flow-hand-response-2026-09-27/after.json) browser evidence is retained locally.
