# DEMON on Colab: source transformation feasibility

Date: 2026-09-27, Asia/Singapore.
Status: batch transformations and corrected headless streaming measurements completed; both GPU allocations released.
This is a dated engine trial; Flow is now deferred and the [project is paused](project-status.md).

## Question

Can DEMON transform existing Sway music efficiently enough to justify a live prototype of the [proposed music flow](product-direction-2026-09-27.md)?
This first experiment tests installation, source conditioning, transformation output, and headless update throughput.
It does not establish musical quality, gesture reliability, or end-to-end performance latency.

## Method

Use one A100-SXM4-40GB allocation, with the existing 30-second MRT2 Base render from `outputs/colab/sway-mrt2-20260926-231343-5827/performance.wav`.
Its SHA-256 is `42ec753399a91b238b692913b8c45356651c9b27c9e71110ce7d5e0a9ea123cd`.
The source contains a deliberate piano-to-guitar conditioning change halfway through; it is a transport/engine reference, not a curated composition or a test of a fixed musical identity.
Reusing it avoids allocating another GPU to regenerate a baseline.

The trial uses upstream DEMON revision `229af3d3d68e7e40764c93259e88149ef6546077`, its documented `uv sync` and `demon-setup` path, and the minimal TensorRT engine set.
Unused starter LoRAs and Stable Audio 3 source are skipped with upstream flags.
The actual Python dependency lock and downloaded model revisions are collected with the results. [Installation](https://github.com/daydreamlive/DEMON/blob/229af3d3d68e7e40764c93259e88149ef6546077/docs/INSTALL.md)

The Session API holds the same prepared source across three eight-step renders with seed 557:

| Render             | Prompt intent                                                    | Denoise strength |
| ------------------ | ---------------------------------------------------------------- | ---------------: |
| Preserve           | Piano/guitar chamber music with the source melody and phrasing   |             0.30 |
| Gentle variation   | Electric piano, soft synth pads, rounded bass, restrained groove |             0.30 |
| Stronger variation | Same variation prompt                                            |             0.60 |

“Preserve” is the requested condition, not a verified perceptual result.
Tempo and key are estimated by upstream's audio analysis rather than assumed from the original note cues.
The source serves as both the audio anchor and the timbre/structure reference.

For streaming, compare pipeline depths one and four, each with eight denoising steps, four completed warmup generations, and 40 measured completions.
Switch the cached prompt during the stream without replacing the source.
Decode 0.36-second windows and include every measured tick, including ticks with no completed generation, in throughput calculations.

DEMON produces successive transformations of a source timeline.
Its transformation updates per second are not the same quantity as MRT2's audio frames per second.
These measurements exclude a live playback clock, network, camera, Qwen, and physical audio output; they cannot be presented as gesture-to-sound latency.

## Resource handling

The local runner owns a unique session and an isolated CLI state file, with a 2,400-second work limit followed by cleanup.
It uploads the generated source recording and experiment script, without camera data or the Qwen credential.
It collects result files before stopping the session, and treats a failed remote script as failure even if the CLI exits successfully.
Five local tests cover allocation/upload/execution failures, hidden remote errors, and failure to confirm release.

Run directory: `outputs/colab/sway-demon-20260927-120056-5ac7/`.
Starting account snapshot: 197.41 compute units, zero active assignments.
Observed allocation rate: 5.30 compute units per hour.

## Batch result

The first allocation completed all three 30-second stereo renders at 48 kHz.
The source analysis estimated 123 BPM and C major.

| Render                     | Generation | Full audio decode |  Total |
| -------------------------- | ---------: | ----------------: | -----: |
| Preserve, first generation |     457 ms |             59 ms | 517 ms |
| Gentle variation, warm     |     130 ms |             46 ms | 176 ms |
| Stronger variation, warm   |     128 ms |             45 ms | 173 ms |

These are individual observations, not a latency distribution.
They reuse a prepared source and cached prompt embeddings, and do not measure making new music from a text prompt alone.
Initialization took 19.96 seconds, source preparation 0.45 seconds, and the two prompt encodes 0.26 and 0.07 seconds.
Dependency installation took 67 seconds; model download and engine builds took 592 seconds.

All files passed stereo/sample-rate/duration checks and contained finite, nonzero audio.
The stronger render's raw peak exceeded full scale, so its saved file received constant attenuation before PCM export.
Separate listening copies match integrated loudness at approximately -26.08 LUFS using constant gain only, with at least 2 dB of measured true-peak headroom.
No compression or limiting was applied to those comparison copies.

- [Source](../outputs/colab/sway-demon-20260927-120056-5ac7/listening/source.wav)
- [Preserve condition](../outputs/colab/sway-demon-20260927-120056-5ac7/listening/preserve.wav)
- [Gentle variation](../outputs/colab/sway-demon-20260927-120056-5ac7/listening/variation_gentle.wav)
- [Stronger variation](../outputs/colab/sway-demon-20260927-120056-5ac7/listening/variation_stronger.wav)

These checks validate output artifacts, not musical quality or motif retention.
Listening evaluation is still needed.

## Streaming harness repair

The first streaming attempt failed because the harness changed the session's window size after construction, leaving the full-length TensorRT decoder selected.
That decoder accepts at least 125 latent frames, while the windowed path supplies 25.
This was a harness configuration error; no valid streaming-rate measurement came from that attempt.

The corrected harness constructs a new Session with `vae_window=0.36`, allowing upstream's constructor to choose the fixed one-second decoder before loading it.
The retry uses `--stream-only` and skips the completed batch renders.
Two compiled decoder engines were retained with hashes and build metadata; the cache option validates the source revision, GPU name, TensorRT version, and file hashes before reuse.
Dependencies and models were prepared concurrently with cache transfer on the same owned VM, coordinated through a setup lock.

The first GPU session ran for about 12.1 minutes and was released successfully.
The account balance moved from 197.41 to 196.35 compute units; the subsequent check showed zero active assignments and a 0.00/hour rate.
The retry was `sway-demon-20260927-121817-ea57`.

## Corrected streaming result

The corrected run confirmed `vae_decode_fp16_1s_fixed.engine` as the active streaming decoder and completed both configurations.

| Pipeline depth | Measured completions | Measured ticks | Tick plus any decode, median / p95 | Completed transformations per second |
| -------------- | -------------------: | -------------: | ---------------------------------: | -----------------------------------: |
| 1              |                   40 |            320 |                   16.60 / 25.15 ms |                                 7.02 |
| 4              |                   40 |             80 |                   42.43 / 47.05 ms |                                11.98 |

Each configuration used eight denoising steps and decoded 0.36-second windows from the same 30-second source.
The median and p95 cover individual compute ticks, including ticks with no finished transformation.
Throughput includes all measured ticks and their completed-window decoding and host copies.
It excludes Python bookkeeping outside the timed work, network transport, audio mixing/playback scheduling, and any perceptual response measurement.

The prompt changed during each stream, with no source replacement or session restart.
The test verified valid finite output after the change, but did not tag each output with its originating control or measure when that change became audible.
Higher update throughput does not establish lower control latency; pipeline depth also changes how many generations remain in flight.

Both runs used the same A100-SXM4-40GB model and driver 580.82.07, PyTorch 2.9.1+cu128, and TensorRT 10.16.1.11.
The checkpoint metadata recorded Hugging Face revision `19671f406d603126926c1b7e2adc169acbcade22` in both runs.
The raw observations, selected engine paths, dependency lock, source hash, and experiment script are retained in the run directories.
The reported PyTorch allocation peak is not total GPU memory usage because TensorRT maintains its own allocations.

## Resource outcome and next decision

The second session ran for about 15.4 minutes and was released successfully.
Its dependency/model preload completed successfully, and the uploaded temporary cache chunks were removed locally after cleanup.
The final account check showed **195.04 compute units, zero active assignments, and 0.00 units/hour**.
The account balance decreased by approximately **2.37 compute units** across the two experiments.
No trial runner or cache-transfer process remained active.

Cache reuse skipped the retained engine builds, but uploading them from this Mac took longer than the compilation time saved.
The default runner therefore continues to rebuild; cache upload is optional for a connection where it is beneficial.
Batching related experiments on one loaded VM offers the clearer efficiency improvement.

The result justifies a live prototype of source-anchored transformation.
It does not yet establish a better musical experience than MRT2, reliable camera control, a three-minute coherent performance, or sustained gap-free playback.
The next product test should use one chosen musical anchor and one bounded variation control, with an explicit return-to-base and measured playback behavior.
