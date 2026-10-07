# Generative theremin experiment

This October 5 experiment follows the hands-on observation that the stable V1 still feels like adding notes to an accompaniment.
The working question is whether a person can continuously shape the generated sound itself, recognize the result, and intentionally find it again.
The experiment is a separate page at `/theremin.html`.
The existing V1 remains available at `/`.

## Play

Run `uv run --locked sway serve` and open `http://127.0.0.1:8765/theremin.html` in Chrome.
Choose camera or pointer input on the page.
The camera and local MRT2 assets are the existing Sway installation; no cloud provider is called.
The first start warms up the model before recording and playing.

With the camera, either open hand can play.
The average hand height chooses a pitch in A minor with hysteresis, rather than continuous glissando.
The distance between two hands expands the sound; with one hand, left-to-right position controls expansion.
A slow, continuous movement sustains the phrase.
Short repeated changes of direction increase plucked articulation and send new note attacks to the generator.
Stillness lets the phrase settle after a short hold; closed or missing hands release it.
Moving again continues the same model session.

With the pointer, hold the stage and move to use the same controller.
Height controls pitch, horizontal position controls expansion, and short back-and-forth strokes build articulation.
Release the pointer to leave space.

End the performance to save its stereo WAV.
Escape also ends it.
Switching away from the page stops the session, and each take is limited to five minutes to bound recording memory.
Stopping releases camera capture, the socket, and the AudioContext.
The server retains the loaded model for the next take, and exits with Ctrl-C.

## What generates and what responds

All pitched sound in this page comes from the live MRT2 stream.
There is no synthesized lead, automatic drum pattern, separate accompaniment, Qwen request, saved sample bank, or bar-ahead render queue.
Movement controls both the model's next note-conditioning frame and a continuous mixture of three cached style embeddings: bowed cello, sustained chamber strings, and plucked strings.
The model state persists through changes and rests.
Expansion adds a lower octave and then a diatonic third, while the model supplies the actual audio texture.
In the articulated state, notes are released between motion-driven attacks.

The browser additionally applies gain, a low-pass filter, and a small room tail to that same generated signal.
These provide immediate expression and release, while new generated material has its own response delay.
They do not prove that the model follows a gesture perceptually.
The page shows the input's articulation and expansion levels, and the line at each hand uses the actual audio waveform.

The server renders 40 ms stereo frames on one dedicated model thread and consumes the newest controls.
No images leave the browser.
Its input is pitch, expansion, articulation, energy, note-attack count, and a sequence number.
A controller silent for 600 ms releases its notes.
Only one theremin window can generate at a time.
The camera preview runs at the device rate; this page budgets hand inference at at most 12 frames per second to leave compute for uninterrupted generation.
The browser targets a 160 ms PCM buffer and bounds queue growth at 280 ms.
These are buffer settings, not a measured physical camera-to-speaker latency.

## Verification and listening boundary

Automated checks exercise long sweeps, repeated strokes, stillness, closed hands, hand loss, small tracking noise, two-hand expansion, stream exclusivity, stale controls, input validation, and cleanup.
The final local suite passes 142 Python tests and 143 JavaScript tests, along with Ruff, Prettier, and whitespace checks.
Python reports the existing Starlette/httpx deprecation warning.
Real-model browser checks and retained recordings belong in `outputs/theremin-2026-10-05/`.
The test script supplies hand features through the same musical controller and must not be described as a human camera performance.

A pointer-driven browser check verifies sustained motion, repeated strokes, release, double-click start protection, saving a WAV, and starting a second take.
Both AudioContexts close after stopping, and the exported 7.12-second stereo recording is finite, has no full-scale clips, and ends in silence.
The final desktop introduction and playing state were inspected at 1366 by 768 pixels.

The 46-second scripted browser performance produced a finite 48 kHz stereo recording with no full-scale clips and no buffer underruns.
Its sustained, expanded, and articulated passages have different level envelopes, and the deliberate rest falls below -80 dBFS.
This is signal evidence, not a judgment that the gestures sound convincing.

A 30 fps replay of the existing finger-drumming clip tested hand tracking alongside generation.
At unrestricted tracking rates, both CPU and GPU tracking caused repeated audio underruns on this Mac under concurrent load.
Limiting CPU tracking to at most 12 fps and buffering 160 ms reduced the interruption count to five underruns in a two-minute replay.
Increasing the buffer to 240 ms still produced four underruns in a separate two-minute run, so it did not establish a fix and the shorter buffer is retained for responsiveness.
The stream therefore remains an experimental listening prototype with audible-interruption risk, not a verified uninterrupted instrument.
The desktop preview, controller, model steering, recording, and stop/restart flows can be tried now; sustained real-time headroom and the complete physical response delay remain open work.
On October 7, with no browser or camera running, the same render path took a median of 22 ms per 40 ms frame, with 90% of frames under 24 ms.
The model therefore has headroom on its own; the slowdown to 37-39 ms comes from sharing the Mac with tracking and the browser, and its exact cause is not yet measured.

The decisive listening checks remain:

1. A long sweep feels connected to a sustained, evolving generated sound.
2. Repeated short motions produce an audible change in articulation that can be intentionally repeated.
3. Stopping creates a useful musical rest, and resuming belongs to the same performance.
4. A person wants to keep exploring the sound after the first minute.

Model throughput, note-conditioning logs, or a moving meter cannot establish those four results.
