# Gesture ensemble

Updated September 27, 2026.
Status: implemented prototype, development paused.
Read [project status](project-status.md) for the latest performer feedback, unresolved issues, and resume priorities.

## Product principle

Sway is a generative instrument: visual input inspires the music, and the models are responsible for the musical result.
People should not need precise finger technique or a reliable internal metronome.
Qwen3.8-Max interprets the whole scene and decides how to arrange it; MRT2 generates the sound.
Two hands can suggest different parts at the same time, and body movement and visual context can also shape the composition.
Flow remains a separate experiment; Gesture ensemble is the chosen direction when work resumes.

## Try it

Open `http://127.0.0.1:8765/ensemble.html` and choose **Qwen conductor / ensemble**.
This is selected by default when the existing Qwen credential is configured.
Choose the starting ensemble, press **Begin performance**, then enable the camera.
Selected camera frames go to Qwen; credentials stay in the backend and recordings contain audio only.

Try piano-like finger movement in one hand and strumming or percussion in the other.
Keep the idea going for several seconds and watch **Qwen's arrangement** for the proposed parts and their sources of inspiration.
The gesture labels are fallible observations, not commands that override Qwen.
The arrangement readout reports generator conditioning, not instruments independently detected in the resulting audio.

Gradually faster or slower movement can suggest a change of pace.
There is no need to supply exact beats.
Turn off **Allow tempo suggestions** to hold the target tempo.
Resting or briefly losing the hands preserves the music.
Press **End performance** to stop the model workers.

## Implementation

The former contract contained one action for the entire scene, and the largest wrist movement could suppress the other hand's evidence.
The motion analyzer now also retains separate temporal observations for each hand, including finger articulation, wrist direction, position and confidence.
Labels are the performer's anatomical left and right: MediaPipe labels the camera worker's unmirrored images by each hand's actual side.

Qwen receives three ordered frames, 384 pixels wide, sampled at half-second intervals, plus motion observations and the current arrangement.
It returns one to four parts with an instrument, role and source of inspiration; a musical description; chord pitches; harmonic cue spacing; energy; confidence; and a hold/faster/slower suggestion.
The existing gesture rules cannot overrule this plan.
A valid interpretation with confidence at least 0.55 can update the arrangement; low-confidence results preserve it.
Responses older than ten seconds are ignored.
The self-reported confidence is not calibrated recognition accuracy.

One musical clock advances with each generated 40 ms audio frame.
The clock is independent of webcam cadence and hand-onset jitter.
Faster/slower suggestions must persist for at least three seconds across observations, with no observation gap over ten seconds.
They can change the target by six BPM at most once every eight seconds.
The generation clock approaches that target by at most two BPM per four-beat bar.
Half/double-rate hand pulses are treated as ambiguous subdivisions in the older motion-only mode.

The complete arrangement becomes one MusicCoCa text prompt describing simultaneous, complementary instruments.
Text encoding runs on a dedicated bounded worker thread because measured local encoding took 182-256 ms.
Generation continues with the previous plan while a replacement is prepared.
The prepared style, chord plan and dynamics are committed together at a bar boundary; the recurrent music state is retained.
The same logic runs locally and in the Colab service, and the live runner includes the new ensemble module.

Sparse harmonic cues use Qwen's chord pitches and cue spacing on the shared clock.
Raw hand accents no longer become immediate played notes in Qwen mode.
Other note lanes remain free for the model to compose, and musical energy changes smoothly rather than following every motion spike.
The older single-action modes remain available for comparisons.

## Limits and acceptance criteria

MRT2 renders one stereo mixture, not independently addressable instrument stems.
Preserving both hands in the observations and both instruments in the prompt removes Sway's single-action bottleneck, but does not prove that every requested instrument is clearly audible.
The next performer test must judge whether piano with guitar and piano with drums both sound like simultaneous, connected ensembles.

The displayed BPM is the conditioning clock, not an estimate of the audible recording's beat.
MRT2 offers frame-aligned style and note conditioning, not a guaranteed exact BPM or separate per-instrument MIDI channels in this adapter.
See the [official MRT2 technical description](https://magenta.withgoogle.com/magenta-realtime-2).
Audible tempo stability, instrument separation, response time and playback gaps remain listening-test criteria.

The latest performer feedback reported drum/strum confusion and a disconnected musical response.
The aggregate motion classifier can suggest guitar whenever one hand moves beside a separated quiet hand, even when the moving hand has a vertical striking motion.
This branch precedes the drum rule, and its hints may conflict with the independent per-hand observations sent to Qwen.
Qwen's three-image input can also miss intervening attacks and rebounds.
These are unresolved limitations; the pause cleanup did not change recognition or generation behavior.

## Validation evidence

The baseline reproduction fed simultaneous synthetic piano and strumming landmarks through the production analyzer and controller.
It produced only `strum`, rejected the conflicting Qwen suggestion, and copied a jittering 108/150/85/140/90/120 hand BPM sequence directly into the requested music tempo.
The new regression cases preserve piano alongside both guitar and drum observations, give Qwen final authority, reject raw hand tempo jitter, retain music through rests, and bound clock changes to bar boundaries.
Worker and network-service tests check that complete multi-part plans reach generation together and that raw gesture accents do not replace the shared pulse.

The real Qwen API accepted the new schema using synthetic blank frames and returned confidence 0.3, below the application threshold, in 3.78 seconds.
A separate live browser run used prerecorded Jester finger-drumming footage, real MediaPipe tracking, Qwen3.8-Max and local MRT2 Small.
Seven distinct observations sampled during a recorded interval returned in 4.68-6.49 seconds and produced three-part arrangements.
The resulting WAV contains 32.92 seconds of finite 48 kHz stereo audio, with peak 0.358 and RMS 0.044.
The requested generation clock remained 108 BPM throughout that interval.
These measurements verify integration, not correct recognition of a two-instrument performance or listening quality.

The initial browser run exposed stalls when new prompts were encoded on the generation thread.
Prompt preparation was moved off that thread and the browser test was repeated.
The repeated run applied 22 Qwen observations over about 131 seconds, retained a 108 BPM generation clock, and reported zero dropped audio frames.
Playback gaps still occurred; a diagnostic collected after stopping showed seven, including any stop-related underrun.
This was not a controlled latency benchmark and does not establish gap-free playback.
The new arrangement and transport layouts were inspected at 1440 px desktop width and a 390 px mobile viewport, with no horizontal overflow.
The full checks passed: 89 Python tests, 18 JavaScript tests, Ruff lint and format checks, Prettier for the changed web files, and whitespace validation.
Remote protocol behavior was exercised against the network service with a test engine; a fresh Colab GPU was not allocated for this revision.
The obsolete Flow A100 session was released, with zero active assignments confirmed.
Evidence, recordings and screenshots are retained in `outputs/ensemble-2026-09-27/`.
The recorded-image test uses one visible hand and is not evidence of real two-hand classification accuracy.
