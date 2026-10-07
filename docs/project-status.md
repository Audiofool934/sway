# Project status

Updated: October 7, 2026, Asia/Singapore.
This page is the map of Sway: what exists, where it lives, what is open, and what comes next.
Update it when a piece of work starts or lands.

## Summary

Sway is an instrument played with the hands in front of a camera, with generative models in the band.
V1 is playable and stable.
On October 4, Everett said that it feels like adding notes over an accompaniment, not like leading the music.
The open question is what makes the music feel like the player's own.
One experiment, the generative theremin, tests an answer.
On October 7 the project was cleaned up: one line of history, and the paused prototypes removed.

## Branches

| Branch        | Contains                                                                                                                                   | State                                                                  |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| `clean-start` | V1 with the code of #2, #4, and #5 and its fixes, the theremin experiment, and the October 7 cleanup.                                      | The new baseline. Local only, until Everett asks for its pull request. |
| `main`        | V1 as merged on October 1 ([#1](https://github.com/Audiofool934/sway/pull/1)), and CI ([#8](https://github.com/Audiofool934/sway/pull/8)). | On GitHub. `clean-start` builds on it.                                 |
| `v2-design`   | [#3](https://github.com/Audiofool934/sway/pull/3): the V2 proposal, `src/sway/pitch.py`, and the palette probe.                            | Open pull request, kept as a reference. Not built.                     |

Numbers such as #3 are pull requests on GitHub.
[#2](https://github.com/Audiofool934/sway/pull/2), [#4](https://github.com/Audiofool934/sway/pull/4), and [#5](https://github.com/Audiofool934/sway/pull/5) are still open there, but `clean-start` includes their work.
They can close when `clean-start` goes up as one pull request.
[Issue #6](https://github.com/Audiofool934/sway/issues/6) records an evaluation of DEMON, ACE-Step 1.5, and Stable Audio 3 for later.

## Pages

| URL              | What it is                                                                              | State                                                           |
| ---------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `/`              | V1: the lead hand plays a pitch ladder, and the band hand sets energy, cuts, and loops. | Current. MRT2 plays the harmony, and Qwen can compose the band. |
| `/theremin.html` | The hands shape MRT2's live sound directly.                                             | Experiment. Its interface is in Chinese.                        |

The Qwen gesture ensemble and Flow pages from September 26 and 27, their pipeline, and their documents were removed on October 7.
The [documentation index](README.md) says how to find them in Git.

## The open question

The two play tests found two different gaps.

| Play test | Finding                                                                                                                               | What it asks for                                |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| October 1 | The AI changed what the band played but not how it sounded, and the lead was a plain synthesizer.                                     | Make the AI's part audible and the lead lively. |
| October 4 | Playing feels like adding notes over an accompaniment. Each session is the same Night Drive, and the right hand mostly changes pitch. | Make the player's part shape the music.         |

The V2 proposal answers October 1.
Its first step, the expressive lead, is in V1 now.
Its later steps give the AI more decisions, which does not by itself give the player more.
No design has been chosen for October 4.
The theremin is the first experiment for it.

## The theremin experiment

The [experiment guide](generative-theremin-experiment.md) has the details.
The first design on September 26 was also a generative theremin.
That version sent gestures through Qwen to MRT2's text prompt and took 8 to 14 seconds to change the sound.
This version sends hand controls to MRT2 every 40 ms.

- Hand height picks a pitch in A minor, and the distance between the hands widens the sound.
- Short back-and-forth strokes make the sound plucked, and stillness lets it settle.
- All pitched sound comes from MRT2.
  There is no band and no Qwen.
- To try it, run `uv run --locked sway serve` and open `http://127.0.0.1:8765/theremin.html`.
  Pointer input works without a camera.

With camera tracking running, MRT2 needed a median of 37 to 39 ms for each 40 ms frame, and two-minute replays had four or five dropouts.
On October 7, with nothing else running, the same render path took a median of 22 ms, with 90% of frames under 24 ms.
So the model itself has headroom, and the dropouts come from sharing the Mac with camera tracking and the browser.
Pointer input does not run the tracker.
The decisive checks are the four listening questions in the guide, and they need Everett's ears.

## V1's open play tests

The [readiness record](v1-readiness.md#remaining-play-tests) lists seven play tests that need Everett's hands.
The October 4 session was informal play, not those tests.
The V1 checklist in the [V1 plan](v1-plan.md#v1-checklist) stays the release bar.

## Next

1. **Everett plays the theremin with the mouse,** for about ten minutes, against the four listening questions.
   This decides whether direct shaping of the generated sound is the answer to October 4.
2. **At the same time, find what slows MRT2 when the camera runs,** and remove it, so that the camera version can be tested fairly.
3. **Then choose the direction:** build the theremin's idea into the instrument, or make V1's band follow the player.

## Working rules

- One piece of work at a time, on its own branch and pull request.
- Everett reviews on GitHub.
  Nothing merges until he asks.
- When more than one agent works on Sway, each reads this page first and updates it at the end.

## Timeline

| Date            | Event                                                                                              |
| --------------- | -------------------------------------------------------------------------------------------------- |
| September 26    | First prototype: camera to Qwen to MRT2 text prompts.                                              |
| September 26-27 | Gesture ensemble, Flow with DEMON, and Colab trials.                                               |
| September 27    | Paused. A gesture took 8 to 14 seconds to change the sound.                                        |
| September 28    | Restarted from first principles as V1: a hand-played lead, a band hand, and a music-game tutorial. |
| October 1       | V1 merged (#1). First play test. Pull requests #2 to #5 and issue #6 opened.                       |
| October 2       | CI merged (#8).                                                                                    |
| October 3-4     | The V1 candidate: #2, #4, and #5 combined, with fixes and a 20-minute browser run.                 |
| October 4       | Second play test: stable, but it does not feel like leading the music.                             |
| October 5       | The theremin experiment.                                                                           |
| October 7       | Cleanup: one branch, the paused prototypes and 15 historical documents removed.                    |

## Where things are

- The [documentation index](README.md) lists the current documents.
- Recordings and test evidence are in `outputs/` and `work/`, which Git ignores.
  The [data map](development.md#data-and-evidence) lists the current ones.
- The Qwen credential is in `~/.config/sway/qwen.json`, outside the repository.
- On `clean-start` on October 7, 58 Python tests and 128 JavaScript tests passed.
- No Sway server or other Sway process was running at this update.
