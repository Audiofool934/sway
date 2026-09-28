# Sway V1: design and execution plan

Started: September 28, 2026, Asia/Singapore.
Status: in progress.
This plan supersedes the paused Gesture ensemble direction as the definition of the product.
The earlier Qwen and MRT2 pipeline remains available as a legacy experiment at `/ensemble.html`.

## What V1 is

Someone with no musical training moves their hands in front of a laptop camera and makes a piece they would want to keep.
The piece has a pulse, a key, a recognizable idea, a beginning and an end, and it audibly reflects the choices they made.
They get better with practice, because the instrument behaves the same way every time.

The machine supplies musical competence: harmony, timing precision, arrangement, and sound.
The person supplies intention: when, how much, higher or lower, calmer or more intense, change now.

## Rules we build by

1. The note path is local and never waits for a network request or a large model.
2. Every gesture has one meaning, always.
3. The beat grid owns exact timing; the hands own what happens and how.
4. The screen stands in for touch: every control is drawn where the hand is.
5. Nothing sounds wrong: pitches come from the ladder, and band changes land on bar lines.
6. Hands leaving the view never stops the music; only an explicit ending does.
7. Latency, gesture reliability, and playback stability are measured, not assumed.
8. Camera, mouse and keyboard, and scripted input all drive the same controls, so everything is testable without a camera.

## Defaults chosen for V1

These choices keep V1 focused and can be revisited after the first play test.

| Question       | V1 default                                                                                |
| -------------- | ----------------------------------------------------------------------------------------- |
| Musical world  | One world: warm downtempo electronic groove, A minor, 100 BPM, light swing.               |
| Pitch freedom  | A minor pentatonic ladder, so no rung can clash; chord tones are highlighted.             |
| Band and loops | The band plays by default and follows the band hand; captured loops are the player's own. |
| Sound          | Synthesized in Web Audio; sampled instruments come later.                                 |
| Platform       | Chrome on a laptop with its built-in camera; all real-time audio runs in the browser.     |
| Handedness     | Right hand leads by default, with a setting to swap roles.                                |

## The instrument

### Lead hand: the voice

| Movement                           | Result                                                     |
| ---------------------------------- | ---------------------------------------------------------- |
| Hand height                        | Selects a rung on the pitch ladder drawn beside the hand.  |
| Pinch (thumb and index together)   | Starts a note on the current rung; holding sustains it.    |
| Move to another rung while pinched | Plays the new rung legato, so a held pinch draws a melody. |
| Release the pinch                  | Ends the note.                                             |

The ladder has ten rungs spanning two octaves of A minor pentatonic, from A3 to G5.
A short calibration maps the ladder to the player's comfortable reach.
Rung boundaries use hysteresis so a steady hand does not flicker between notes.

### Band hand: the band

| Movement       | Result                                                                                                   |
| -------------- | -------------------------------------------------------------------------------------------------------- |
| Hand height    | Sets band energy from 0 (air) to 4 (peak); changes land on the next downbeat, with a fill on the way up. |
| Fist           | Cuts the band on the next eighth note; opening the hand brings it back on the next downbeat.             |
| Pinch and hold | Captures the last four bars of the lead as a loop layer that keeps playing.                              |

Energy levels add layers in a fixed order: pad; kick, shaker and sub bass; snare, hats and bass groove; busier drums and brighter chords; arpeggio and full drums.
A capture needs the pinch held for 0.6 seconds, with a ring filling around the band cursor.
Recorded finger drumming produced pinch-like shapes lasting up to 0.58 seconds, so a brief pinch must not loop anything.

### Both hands

Two fists held for just under a second end the piece: the band resolves to the tonic chord on the next downbeat, rings out, and stops.
Losing a hand never ends anything; a lost lead hand releases its note, and a lost band hand keeps the band at its current energy.

### Structure the machine owns

The chord progression repeats every four bars.
Low energy uses Am, F, C, G; high energy switches to F, G, Am, C at the next four-bar boundary.
Every chord is voiced to avoid a semitone against the ladder, so the G chord is played without its third.
Loops are stored by their position in the four-bar cycle, so they stay aligned with the harmony they were played over.

## Timing

The AudioContext clock is the only musical clock.
Band events are scheduled about 120 ms ahead by a lookahead scheduler.
Lead onsets are aligned to a sixteenth-note grid by default, with eighth-note and off settings.

Input latency is compensated before alignment.
Each camera frame carries the time it was captured, so tracking delay is excluded from the gesture's timing.
That capture time is mapped onto the audio timeline as heard, then shifted by a small sensor allowance and, later, the player's calibrated offset.
The note plays on the grid point nearest that moment if it is still ahead.
If that grid point passed within 50 ms, the note plays at once; if it passed earlier, the note waits for the next grid point.

## Learning: the music-game tutorial

Targets appear on the ladder and the energy meter and scroll toward the hand, so each lesson is a short piece of real music.
Hitting a target plays its note; the lesson measures timing and accuracy per gesture.

| Lesson           | Teaches                                                                  |
| ---------------- | ------------------------------------------------------------------------ |
| 0. Setup         | Hand roles, comfortable reach for the ladder, and a timing calibration.  |
| 1. Play notes    | Pinch on a rung at the right moment, starting with three rungs.          |
| 2. Draw a melody | Hold the pinch and move between rungs.                                   |
| 3. Lead the band | Raise and lower energy, cut the band, and bring it back on the downbeat. |
| 4. Make a piece  | Capture a loop, play over it, and end the piece.                         |

The same judging code produces per-gesture hit rates and timing errors, which is how we decide which gestures are reliable enough to keep.

## Architecture

All V1 code lives in `web/instrument/`, and the page is `web/index.html`.
Pure modules have no browser dependencies and run under `node --test`.

| Module                | Responsibility                                                                     | Kind    |
| --------------------- | ---------------------------------------------------------------------------------- | ------- |
| `theory.js`           | Pitches, scales, chords, and the V1 world definition.                              | Pure    |
| `clock.js`            | Beat and second conversion, swing, and grid alignment with latency compensation.   | Pure    |
| `hands.js`            | Landmark smoothing, pinch and fist detection, and stable hand-role assignment.     | Pure    |
| `controls.js`         | Hand features to instrument controls: rung, gate, energy, cut, capture, and end.   | Pure    |
| `band.js`             | The band's notes for each bar from energy, cut state, and progression.             | Pure    |
| `looper.js`           | Lead note history, loop capture, and loop playback windows.                        | Pure    |
| `midi.js`, `wav.js`   | Standard MIDI file and WAV encoding.                                               | Pure    |
| `tutorial.js`         | Lesson charts and judging.                                                         | Pure    |
| `synth.js`            | Web Audio instruments, mixer, and effects.                                         | Browser |
| `recorder-worklet.js` | Passes the master mix through and records it while a piece plays.                  | Browser |
| `engine.js`           | The lookahead scheduler that connects controls, band, looper, and synth.           | Browser |
| `camera.js`           | Camera capture, the tracking worker, and latency measurement.                      | Browser |
| `overlay.js`          | The ladder, energy meter, beat display, and tutorial targets over the camera view. | Browser |
| `main.js`             | Page wiring, settings, and input sources.                                          | Browser |

The existing `web/vision-worker.js` stays the tracking worker; V1 adds world landmarks and handedness scores to its messages.
The Python server only serves files for V1.

## Milestones

### M0: foundations

Move the legacy page to `/ensemble.html`, create the V1 page, and measure the delay from camera capture to landmarks and from scheduling to audio output.
Done when both measurements are recorded here and the default latency compensation is set from them.

### M1: playable core

Clock and scheduler, theory, synth voices, band with energy and cut, lead hand with the ladder, mouse and keyboard input, and the overlay.
Done when:

- Every lead and band note is in the scale and on the grid, checked by tests and an offline render.
- Band changes land on downbeats.
- A scripted 20-minute run reports no late scheduler events.
- The page shows measured tracking and output latency.
- Everett can deliberately play a melody and steer the band (first play test).

### M2: making a piece

Loop capture, the ending, WAV recording, MIDI export, and a saved performance file.
Done when a three-minute piece can be played from start to ending and its WAV and MIDI exports open correctly.

### M3: tutorial

Setup and calibration plus lessons 1 to 4, with judging and per-gesture statistics.
Done when every lesson can be completed by scripted input in a test and by Everett with his hands.

### M4: polish and validation

A visual pass at laptop sizes, a performance budget check with tracking, audio, and overlay running together, and updated guides.
Done when Everett's second play test passes the V1 checklist below.

## Progress

### September 28

M0, M1, and M2 are implemented, and the M3 tutorial runs end to end with scripted input.
Nothing has been played with real hands yet; that is the next step.

Checked through the real page with scripted input:

- A 23-second piece with a melody, a loop, a cut, and a two-fist ending produced a WAV, a MIDI file with seven tracks, and a performance file with every control event.
- Timing setup measured its known offset: pinches exactly on the beat registered 20 ms early because of the sensor allowance, and calibration cancelled it.
- Lesson 1 played on its targets scored 16 of 16 within 2 ms, then ended on the final chord with its results.

Two tutorial decisions came out of this testing:

- Energy targets are judged by the level the band is playing when the cue lands, not by when the change was asked for, because that is what the music depends on.
- Lessons look four beats ahead instead of two, so each target is visible for about 2.4 seconds before it must be played.

Measured on the development Mac (M2 Pro) in Chrome:

| Measurement                      | Result                                                                                                                                              | Conditions                                                               |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Camera capture to hand landmarks | Median 50 ms, 90th percentile 64 ms                                                                                                                 | Recorded 640×480 hand footage as a fake camera at 12 fps, CPU tracker.   |
| Audio output latency             | 37 ms                                                                                                                                               | `outputLatency` plus `baseLatency` on the default output device.         |
| Input to heard note              | 33 ms when a note plays at once, up to 142 ms when it waits                                                                                         | Scripted input; the wait is for the next sixteenth-note grid point.      |
| Mix, rendered offline per level  | Peaks at or below -0.4 dBFS, no clipped samples, about -16 dB RMS                                                                                   | The band at each level plus a lead phrase, through the real synthesizer. |
| 20-minute soak                   | No late scheduler steps or page errors; 15 to 19 live voices and 5 to 27 MB of heap with no upward trend; 73 of 14,786 camera frames skipped (0.5%) | Fake camera tracking under load, scripted lead, four loop layers.        |

Latency compensation defaults to a 20 ms sensor allowance, and setup adds the player's own measured offset.
In Chrome, every camera frame carried a capture time, so tracking time never delays where a gesture lands on the beat.

Before the first play test, these are known unknowns:

- Pinch and fist thresholds come from hand proportions and one recorded clip, not from real players.
- Recorded finger drumming produced pinch-like shapes; the held capture guards the band hand, but the lead hand may still play stray notes.
- The mix was balanced by measurement, not by ear.
- Capture-to-sound delay with a real camera is shown in the timing panel (press D) but has not been recorded.

## V1 checklist

- Always in key and on the grid.
- No audible gaps over 20 minutes.
- Camera-to-sound delay measured and under about 150 ms.
- A new player finishes lesson 1 in under three minutes.
- A player can deliberately play the same phrase twice.
- A three-minute piece with a build, a cut, a loop, and an ending that the player wants to keep.

## After V1

These are deliberately out of scope until the V1 checklist passes.

- A language or vision model as director: proposing the next section, or a musical world from what the camera sees.
- Sampled instruments and more musical worlds.
- MRT2 or another neural model as a texture layer or for rendering a finished take.
- MIDI controller input and sharing.

## What needs Everett

The agent can verify timing, tuning, stability, and gesture logic with tests, offline renders, and recorded footage.
Whether the instrument feels playable and whether the music is good need Everett's hands and ears, at the M1 and M4 play tests.
