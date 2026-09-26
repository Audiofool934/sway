# Sway's first gesture map

This revision gives hand motion an explicit musical vocabulary and separates it from the experimental AI interpretation.
It responds to the first performer test: the original version acted mostly as a hand-presence volume gate and kept displaying Air piano.

## Playing vocabulary

| Movement | Musical control |
| --- | --- |
| Repeated finger taps with a relatively steady wrist | Piano direction, note accents, and pulse estimation |
| Repeated sideways whole-hand strokes | Guitar direction and short strummed chord cues |
| One hand strumming while the separated fret hand remains steady | Guitar direction |
| Repeated whole-hand downstrokes | Percussion direction and rhythmic cues |
| Slow, continuous whole-hand sweep | Sustained string direction and longer notes |
| Raise or lower the hands | Higher or lower note register, quantized to the current harmony |
| Move with more energy | A wider expressive volume range |
| Rest visible hands | Spacious phrasing |
| Remove hands | The existing two-second hold followed by a two-second fade |

Hand height changes the register of upcoming note cues.
It does not pitch-shift the complete recording.
With two hands, their mean height supplies this control.
Ambiguous movements can remain unclear; these are deliberate mappings rather than an open-ended instrument-recognition claim.
Hold a new gesture for around two seconds while the trajectory window and debounce settle.

## Why piano previously stuck

The old controller retained its last accepted action indefinitely after unknown or low-confidence observations.
The local vision-language model often returned piano or confidence zero, so the last accepted piano interpretation could remain visible for the rest of the session.
The style prompts also retained piano-heavy ensemble text when requesting guitar or percussion.

Now, recent hand trajectories select the mapped action.
The detector compares finger movement with wrist movement, uses stroke extent and direction changes, and checks for repeated finger accents before selecting piano.
A short debounce prevents isolated observations from switching the direction.
Unsupported mapped actions expire after three seconds and AI interpretations after eight seconds.
The interface shows the detected gesture separately from the musical direction currently applied, together with its source.

The frozen Qwen model remains an optional source of slower context.
Its suggestions must be supported by measured motion and cannot overrule a fresh mapped action.
This changes how Sway uses the model; it does not establish that the small model's visual recognition has improved.

## Controls that reach the generator

Guitar, drums, and bowed-string prompts now lead with their requested instrumentation without also requesting piano.
Mapped performances explicitly constrain the lead note range, leave the lower accompaniment free, and send performed accents instead of adding automatic lead notes every two beats.
Strums spread harmony-compatible note cues across successive frames.
Higher hands select higher chord tones and stronger motion changes the output dynamics.

The guided note-conditioning strength is 5, matching the default in the inspected [upstream MRT2 engine](https://github.com/magenta/magenta-realtime/blob/694a545e4ba0b88bf1150137b129582166d3e07f/core/src/mlx_engine.cpp).
The previous Sway adapter used 1.
The model still generates the audio and accompaniment; this revision adds no sampled piano or synthesizer overlay.

MRT2 accepts note and style conditioning, but that does not guarantee exact beat locking or individual drum-hit timing.
Those limitations still need listening tests. [MRT2 technical description](https://magenta.withgoogle.com/magenta-realtime-2)

## First comparison

1. Select **Gesture map only (recommended)**, begin a performance, and enable the camera.
2. Tap individual fingers with your wrist reasonably steady.
3. Repeat those taps with your hands low and then high in the picture.
4. Switch to repeated sideways strums, then whole-hand downstrokes.
5. Compare **Detected gesture**, **Musical direction**, and what you hear.
6. Try **Gesture map + AI context (experimental)** in a separate performance to compare its behavior and playback load.

The immediate success criterion is a repeatable audible change when you repeat the same movement change.
Correct labels alone are insufficient.

## Validation of this revision

39 Python tests and 3 audio-buffer JavaScript tests pass.
The added cases cover action changes across trajectories, the stuck-piano regression, rejection of conflicting AI suggestions, hand-height mapping, preservation of manual selection, and harmony-compatible strums.
They also check that apparent hand-size changes do not generate wrist strikes and that a single finger movement does not select piano.

Five controlled renders ran the real MRT2 model through synthetic hand trajectories and the production controller.
Each saved take contains twelve seconds after a two-second lead-in.
Median generation time was approximately 19–20 ms per 40 ms audio frame on this Mac.

| Controlled input | Measured result |
| --- | --- |
| Low versus high hands, with the same 90 BPM finger taps | Requested MIDI pitches changed from 55/57 to 76; dominant spectral bins changed from approximately 193 Hz to 662 Hz |
| Slow versus fast tapping, at 90 and 150 BPM | Strongest spectral-flux periods were approximately 0.68 s and 0.40 s |
| Guitar and drum trajectories | The controller selected strum and strike respectively and supplied different instrumentation prompts and generated audio |

The spectral measurements support register and pulse influence in these controlled renders.
They are not a benchmark of arbitrary webcam playing, timbre recognition, or long-form musical quality.
In particular, the drum mapping does not establish one-to-one drum-hit control.

A separate recorded-image check used the same nine low-resolution Jester clips documented in the original validation notes.
Real MediaPipe output fed the production gesture mapper and controller.
All three finger-drumming clips eventually selected piano, while the three thumbs-up and three no-gesture clips did not select a musical action.
Some intermediate gesture candidates were wrong, and only short portions of the finger clips passed the stability requirement.
This small development set was used while adjusting the mapping; it is not a held-out accuracy evaluation.

Desktop and narrow layouts were inspected, including the mapping guide and register readout.
The browser reports detected movement separately from applied musical direction so a brief candidate or an expired AI result is not presented as settled interpretation.

The combined browser check also replayed synthetic piano, strumming, striking, and high-piano trajectories through the normal WebSocket path while both model workers ran.
All four expected actions appeared with gesture-map provenance, and the requested register changed from 0.154 to 0.923.
The actual browser run reached 2 minutes 41 seconds, reporting three playback gaps, zero dropped audio frames, and zero catch-up drops.
A subsequent Gesture map only run reached 2 minutes 48 seconds and reported four playback gaps, zero dropped audio frames, and zero catch-up drops.
These runs were not a controlled performance comparison, and disabling AI did not eliminate playback gaps.
Continuous playback remains an unresolved limitation.
Gesture map only is the default because it uses the defined motion vocabulary without loading the unreliable optional AI model.
