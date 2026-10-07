# V1 readiness

This record follows the October 3-4, 2026 review of open issue #6 and pull requests #2, #4, and #5.
The V2 proposal, PR #3, is outside this work.
The local candidate passed the engineering checks below; the human play tests are still required before calling V1 ready to release.

## Scope and disposition

| Item | V1 disposition |
| --- | --- |
| [PR #2: listening controls](https://github.com/Audiofool934/sway/pull/2) | Optional mixer hidden by default; closing it restores the band and releases comparison voices. |
| [PR #4: expressive lead](https://github.com/Audiofool934/sway/pull/4) | Its instrument code is incorporated without the V2 proposal or model probes, with camera lessons for strike dynamics and swell. |
| [PR #5: manual](https://github.com/Audiofool934/sway/pull/5) | Incorporated and updated to match the candidate's lead, loops, mixer, tutorial, and exports. |
| [Issue #6: model design notes](https://github.com/Audiofool934/sway/issues/6) | Future research; its proposed style blending, control curves, and offline restyling are outside V1. |

Issue #6's statement that V1 sends nothing off the Mac is outdated: optional Qwen composition sends musical data, while camera images stay local.
No new model backend, checkpoint, remote GPU allocation, or licensing decision is part of this candidate.
The model claims and proposals in that issue have not been independently revalidated here.

## Reproduced and fixed

- Hiding the listening panel after selecting a solo preset left the band muted with no visible explanation.
  Closing it now restores every part and normal composition.
- The draft mixer allocated silent synthesized voices under every generated bar.
  Those voices now exist only while comparing parts, and opening the mixer during a bar starts the remaining chord without duplicating exported notes.
- The piece lesson passed after every melody note was hit even if no loop was captured and the player never ended the piece.
  Passing now requires at least one success for every skill the lesson teaches, in addition to the 70% overall hit rate.
- The expressive lead had no corresponding tutorial lesson.
  Camera tutorials now include soft and strong strikes and held-note swells; mouse tutorials keep the four core lessons.
- Capturing while holding a legato note restarted its remembered segment at the original strike's louder velocity.
  The next capture now keeps that segment at the legato note's logged velocity.
- A lesson could only be exited from its introduction or by reloading.
  The header now offers **Leave lesson** throughout the tutorial.
- Double-clicking **Start playing** while audio initialized created two running AudioContexts.
  Initialization is shared and superseded starts are ignored.
- Losing window focus while holding a mouse or keyboard gesture could leave it held.
  Focus loss now releases those controls, and Space on a button keeps its normal button action.
- The recorded drumming clip triggered lead notes when thumb and index came near one another without a deliberate pinch.
  The contact threshold is now 0.2 hand lengths, with release at 0.32, and the captured landmarks are a regression fixture.
  This removes false notes in that recording; real deliberate pinches still need testing before calling the threshold tuned.
- The first 20-minute browser run recorded one band scheduler step 2 ms late.
  A 150 ms pause on the page thread reproduced late hat and arpeggio notes in a regression test.
  The band now schedules 180 ms ahead, up from 120 ms; the live lead keeps its separate immediate onset path.
- Performance JSON included file-encoding time in its duration, adding 8.6 seconds to the final long take.
  Duration now comes from the recorded audio's sample count, or from the elapsed performance time captured before encoding when audio recording is unavailable.

## Verification

Evidence is retained in `outputs/v1-ready-2026-10-03/`, an ignored local directory.
These are engineering checks; they do not establish physical camera latency or whether a player likes the music.

| Check | Result and scope |
| --- | --- |
| JavaScript | 136 tests passed, including the drumming fixture, expression, loops, lesson judging, mixer routing, and browser-pause scheduling regression. |
| Python | 133 tests passed, including a real two-bar MRT2 render and an in-key energy check. |
| Formatting | Ruff, Python formatting, Prettier, and whitespace checks passed. |
| Browser controls | Double start uses one AudioContext; mixer reset, keyboard focus, focus loss, and leaving a lesson passed through the page. |
| Lessons | Scripted hand features completed all five lessons, including strikes, swell, capture, and ending; this bypasses image tracking. |
| Three-minute performance | A 186.55-second stereo WAV, MIDI, and performance JSON exported through the real page with builds, cuts, two loops, and a two-fist ending. |
| MIDI | An independent reader matched every note-on pitch, time, and velocity against the performance JSON and found balanced note-on and note-off events across eight musical tracks. |
| Audio file | The three-minute WAV peaked at -0.28 dBFS with no full-scale clipped samples or quiet intervals longer than 300 ms below -80 dBFS. |
| Real models | Qwen returned 19 of 19 requests and 17 composed cycles played; MRT2 performed 48 bars, with 26 synthesized fallbacks while its initial render backlog caught up. |
| Mixer audio | Audio-node measurements confirmed generated harmony alone, synthesized stand-ins alone, and restored drums after closing; comparison voices returned to zero. |
| Laptop layout | Intro, playing, mixer, expression lesson, and exports were rendered and inspected at 1280 by 800; camera play was also inspected at 1440 by 900. |
| 20-minute run | Camera tracking, generated strings, energy changes, cuts, recording, and overlays ran for 1,200 seconds with zero late scheduler steps; all three exports completed. |
| Drumming replay | The final run processed 14,393 camera frames from the repeated 12 fps clip and produced zero lead notes; deliberate pinches were not part of this recording. |
| Long audio and MIDI | The 1,206.57-second WAV peaked at -0.09 dBFS with no full-scale clipped samples; quiet intervals longer than 300 ms below -80 dBFS aligned with intentional cuts. All 19,039 MIDI note-ons matched the performance JSON and had balanced note-offs. |
| Held capture and duration | Two browser captures preserved the legato segment at velocity 0.82; a fresh export's JSON duration matched the WAV sample count to the reported hundredth of a second. |

The three-minute performance's 108 scripted lead events had a median estimated input-to-output delay of 36.9 ms and a maximum of 37.9 ms.
Those inputs bypassed MediaPipe, and the estimate uses the browser's output timestamps rather than a microphone measurement.
MRT2's initial bar in that take took 9.8 seconds to render; the synthesized band kept playing until the backlog caught up.
This is observed recovery under load, not a promise that generated harmony is ready immediately.

The final 20-minute run used real MediaPipe tracking with a prerecorded camera clip, MRT2 strings, and the built-in composer.
MRT2 performed 408 bars and needed 78 synthesized fallbacks; fallback use rose near the end as rendering slowed.
There were at most 11 live voices and no late scheduler steps, including during five observed page-thread pauses of 51 to 113 ms.
Heap use rose from 11.8 MB to 474.6 MB while retaining the stereo recording, consistent with its roughly 461 MB of floating-point samples.
This is an in-memory recording path, so memory demand grows with take length.
The five scripted lessons were checked in a second browser tab during part of the run.

The first 20-minute attempt also saved a valid WAV, but its automation bridge became unresponsive during evidence transfer and its wrapper restarted the session before JSON and MIDI were retained.
The final run used the normal audio download and saved periodic diagnostics independently.
The held-capture and export-duration corrections were subsequently checked through the page.
The retained three-minute and 20-minute performance JSON files predate the duration correction; use the WAV headers for their exact audio lengths.

## First hands-on feedback, October 4

Everett tried the local candidate at `003d7d4` and described its overall effect positively, with a more stable feel and steadier perceived generation.
He did not experience a new standout moment in this update.
The strongest moment for him remains the earlier interface change that moved the camera from a side view into the background and made the hands feel mirrored in the same space as the instrument.

This is positive qualitative feedback on stability, while the source of the product's strongest appeal remains the embodied camera interaction.
It does not establish measured camera latency, completion of the lessons, a full 20-minute listening test, or that a particular piece was worth keeping.
In follow-up, Everett confirmed that playing feels more like adding notes over a continuing accompaniment than leading a phrase.
He described repeated sessions as the same Night Drive, with similar drums and lead timbre, and the right hand mainly changing pitch.
Source inspection confirms one fixed musical world, energy-dependent rhythm patterns, one lead synthesis patch, and a composer that plans chords, texture, and an answering line one four-bar cycle ahead.
The next design question is how to make the player's musical contribution perceptible in the accompaniment and in the development of a phrase.
No new interaction design has been selected or implemented from this feedback.

Performance JSON is optional supporting evidence when a specific behavior needs investigation.
It contains recognized control events, notes, settings, composition plans, and generated-versus-synthesized bar counts, without camera images or audio.
It cannot establish musical appeal or physical camera-to-speaker latency on its own.

## Remaining play tests

These are inherited from the V1 plan, not substitutes for its original requirements.

1. Measure camera-to-sound delay on the intended camera and audio device, aiming below about 150 ms.
2. Play for 20 minutes and check for audible gaps; scheduler statistics alone do not prove this.
3. Have a new player finish the first lesson in under three minutes.
4. Deliberately play the same phrase twice.
5. Make a three-minute piece with a build, a cut, a loop, and an ending that the player wants to keep.
6. Compare gentle and quick pinches and held-note swells, keeping pitch stable while leaning.
7. Compare deliberate pinches with finger drumming at the camera's native frame rate.
   The existing 2.75-second drumming clip at 12 fps is insufficient to establish recognition accuracy or tune both types of gesture.

For a useful test, turn the camera on, complete setup and the lessons, then play a free piece.
Press D to inspect tracking and note delay and M to compare the generated and synthesized parts.
At the end, save the performance JSON and WAV so timing, dynamics, and musical feedback can be related to the same take.
