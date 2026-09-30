# Sway evaluation plan

Created: 2026-09-26.
Status: proposed experiments and acceptance targets; no new benchmark results are claimed here.
This plan was written for the earlier single-action prototype and remains historical measurement guidance.
The project is now paused with Qwen retained; [project status](project-status.md) defines the resume priorities.
Adapt action labels, false-switch metrics, and performer tasks to simultaneous ensemble parts before reusing this plan.
The [cloud pilot results](cloud-validation-2026-09-26.md) establish initial connectivity and generation throughput, but do not satisfy the recognition, listening, or sustained-playback gates below.
The [model and architecture decision](product-research-2026-09-26.md) explains the candidate choices.

## What success means

A performer can intentionally start, repeat, vary, pause, and finish a short musical idea.
The same gesture change should produce a recognizable musical change across repeated attempts.
The system should keep playing through slow or failed interpretation requests.
Sound quality, timing, control, and reliability must all be reported; none can be replaced by a single model leaderboard score.

The following are initial engineering targets, not published standards or measured capabilities.

| Property                            | First acceptance target                                                                                                  | Measurement                                                                                          |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Immediate performed voice, if added | Physical gesture-to-audible-attack p95 below 80 ms, with median and timing variance also reported.                       | Synchronized observation of physical motion and output audio; software-only latency is insufficient. |
| Generated note response             | Control-to-audible-change p95 below 500 ms for note changes the engine supports.                                         | Scripted note changes and aligned audio analysis with listening confirmation.                        |
| Semantic update                     | Action-change-to-valid-applied-intent p95 below two seconds for the tested vocabulary.                                   | Includes gathering evidence, request delay, inference, validation, and debounce.                     |
| False musical changes               | At most one false applied action change in ten minutes of annotated rest, incidental movement, and tracking loss.        | Count controller commits, not just wrong model answers.                                              |
| Playback stability                  | Zero underruns, catch-up drops, and lost audio frames over 20 minutes initially, then 60 minutes before a release claim. | Actual playback counters and a synchronized output recording under camera and interpretation load.   |
| Learnable control                   | Each test performer can demonstrate at least three intended audible transformations after a brief introduction.          | Repeated trials, blind listening, and performer feedback.                                            |
| Musical continuity                  | A three-minute take develops a motif, tolerates rests, and ends deliberately.                                            | Performer and listener assessment with failure examples retained.                                    |

An engine that cannot satisfy attack timing may still qualify for slow arrangement changes.
Report that role explicitly rather than averaging incompatible tasks into one score.
Longer observation needed for an ambiguous action should cause abstention or a documented slower vocabulary, not a fabricated instant result.

## 1. Establish a measured baseline

Record timestamps for camera capture, landmark completion, onset detection, controller commit, generation start/end, audio enqueue, and playback consumption.
Use monotonic clocks and document how browser and backend clocks are aligned.
Track the age of queued audio and the age of the observation behind every semantic update.
Record device, sample rate, audio route, camera frame rate, model revision, configuration, and source commit.

Run the same replay through map-only, local-Qwen, and cloud-Qwen modes.
First hold controller rules and input sampling fixed to isolate provider effects.
Then test revised sampling and semantic authority as separate conditions.
This separates recognition gains from reduced local GPU load and from controller changes.

The existing WAV is saved before browser playback and therefore cannot prove that the listener heard no gaps.
Use output loopback plus playback counters for delivery failures.
For physical end-to-end latency, capture motion and speaker/headphone output with a common clock, or a synchronized high-speed reference and audio capture.
State synchronization uncertainty, onset-label ambiguity, and audio-device buffering.
Do not infer physical latency by adding unrelated medians.

## 2. Build a small, representative action set

Start with the six existing labels: piano, strum, strike, sustain, still, and unknown.
Collect full sessions from at least four performers, covering camera distance, lighting, hand size in the image, one or two hands, and temporary occlusion.
Include transitions, incidental waving, gestures near the face, hands leaving view, and natural rests.
Test tempo, intensity, and register changes while holding action constant.
Include the same action at different tempos and different actions at similar tempos.

Use two performers for prompt/controller development and hold two out for the first screening.
Aim for at least 120 labeled observation windows, balanced by action, plus continuous sequences for transition and false-switch measurements.
This is a pilot, not sufficient evidence for a population-wide claim.
Keep every overlapping window from one session in the same split.
Obtain additional unseen sessions after choosing a candidate; do not repeatedly tune against the screening set.

Label action intervals and uncertainty before looking at model responses.
Retain ambiguous examples as unknown or disputed rather than forcing a plausible instrument label.
Use the existing nine Jester clips only as development regressions.
Keep camera footage local by default and identify which test clips are permitted for cloud processing.

## 3. Compare visual models fairly

Use the same prompt, semantic schema, timestamps, measured motion, and ordered image payload for the first comparison.
The September 26 proposal was to compare six images spanning one second at a 480-pixel long edge against the then-current three-image, 256-pixel input.
The September 27 ensemble implementation uses three images at 384 pixels wide; include that actual configuration as the baseline in any resumed comparison.
These sampling choices are hypotheses to test, not validated optimal settings.
Do not include frames captured after the decision time.
Run a second, explicitly separate comparison of provider-native video only if it improves the common-input baseline.

Begin with local Qwen3.5-0.8B, map-only, and Qwen3.8-Max without thinking.
If the first cloud candidate misses a gate, prioritize MiMo V2.6 Flash/Pro, then the available Kimi, GLM, and DeepSeek visual endpoints.
Use documented reasoning controls per model; do not send unsupported parameters just to make request bodies look identical.
Log exact IDs and resolved revisions because aliases may change.
Disable unrelated search, tools, and long conversational history.

For each request, retain the label result, validation outcome, capture interval, dispatch/completion times, token usage, estimated cost, and failure category.
Keep image contents, secrets, and unnecessary raw provider reasoning out of routine logs.
Measure time to complete valid JSON, not time to the first token.
Randomize provider order, repeat the same windows, and report cold connection behavior separately from warmed connections.

Report macro F1, per-action precision/recall, unknown abstention, schema failures, false applied switches per minute, p50/p95 latency, stale-result rejection, and cost per performance minute.
Report counts and results per performer; bootstrap by performer or session rather than treating overlapping frames as independent trials.
With only two held-out performers, uncertainty will remain wide.
Model-generated confidence is a feature to calibrate, not a probability to trust.

Choose among candidates that meet timing and false-switch gates by recognition and musical-control results.
Use cost to distinguish similarly effective candidates, rather than accepting unreliable control for a cheaper token price.
If none passes, narrow the vocabulary or improve observation and tracking before escalating model size again.

## 4. Compare music on quality and control separately

First render MRT2 Small and Base from identical recorded control traces, shared prompts, comparable sampling settings, and several seeds.
Match playback loudness for listening comparisons while retaining the original files.
Use short passages and three-minute takes that contain repeated motifs, note/register changes, instrument changes, rests, and endings.
Run Base on suitable hardware; record hardware, memory, warmup, and frame-time distribution.
Offline quality results are not real-time deployment results.

Compare Lyria with those engines on supported arrangement tasks: broad instrumentation, texture, density, and continuity.
Report note scheduling as unsupported in the inspected Lyria interface, rather than translating MIDI into prose and calling the tests equivalent.
Test its tempo/scale transitions explicitly, including the required context reset.

Randomize anonymous A/B order for the performer and at least two additional listeners in the pilot.
Score sound quality, audible obedience to the intended change, continuity, expressiveness, and the quality of the ending separately.
Include a control where a similar soundtrack plays without the corresponding movement input.
If listeners cannot distinguish intentional control from that condition, the interface needs improvement even if both recordings sound good.

Evaluate all-generated and local-voice-plus-generation versions separately.
Measure doubled attacks, accompaniment phase drift, clashes in register, and recovery after a tempo change.
Inspect audio and listen to failures; a tracker reporting the requested BPM does not prove the music follows it.
Promote the larger or cloud engine only if its audible benefit survives the control and stability tests.

## 5. Test failure recovery during a real performance

During sustained playback, introduce slow inference, timeouts, malformed JSON, rate limits, network loss, stale responses, camera interruption, and a session restart.
The latest observation should replace queued obsolete work.
A response from an earlier session must never change the current music.
Cloud failure should preserve local timing, allow manual control, and visibly change interpretation status.

Do not shorten the audio buffer until continuous-playback measurements justify it.
Compare native audio output if the browser path cannot meet the target under the measured workload.
Repeat only the tests affected by a change, then run the sustained-playback gate on the final configuration.

## Deliverable for each decision

Save a compact report containing source commit, model/configuration manifest, permitted input identifiers, raw metric summaries, representative recordings, failed cases, and the promotion decision.
Label every result as locally measured, provider-reported, or proposed.
Keep the chosen provider and engine replaceable, but implement only the adapters justified by the current experiment.
The next decision is whether cloud Qwen materially improves Sway's audible behavior while protecting immediate control and continuous playback.
