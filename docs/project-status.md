# Project status

Updated: October 7, 2026, Asia/Singapore.
This page is the map of Sway: what exists, where it lives, what is open, and what comes next.
Update it when a piece of work starts or lands.

## Summary

Sway is an instrument played with the hands in front of a camera, with generative models in the band.
V1 is playable and stable.
On October 4, Everett said that it feels like adding notes over an accompaniment, not like leading the music.
The open question is what makes the music feel like the player's own.
On October 7 the project was cleaned up: one line of history, and the paused prototypes removed.
The same day, Everett found that the theremin is motion as music: the hand plays every note, and the model only voices them.
What he wants is motion to music: the hands steer the direction, and the model writes the content.
The [motion-to-music note](motion-to-music.md) defines how to measure that, and its first measurement found a steered design that works, but too slowly.

## Branches

| Branch            | Contains                                                                                                                                   | State                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| `clean-start`     | V1 with the code of #2, #4, and #5 and its fixes, the theremin experiment, and the October 7 cleanup.                                      | The new baseline. Local only, until Everett asks for its pull request. |
| `motion-to-music` | `clean-start` with the steering measurements, their design note, and copying MRT2's state.                                                 | Current work. Local only.                                              |
| `main`            | V1 as merged on October 1 ([#1](https://github.com/Audiofool934/sway/pull/1)), and CI ([#8](https://github.com/Audiofool934/sway/pull/8)). | On GitHub. `clean-start` builds on it.                                 |
| `v2-design`       | [#3](https://github.com/Audiofool934/sway/pull/3): the V2 proposal, `src/sway/pitch.py`, and the palette probe.                            | Open pull request, kept as a reference. Not built.                     |

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

October 4 is being answered in two steps.
The theremin experiment of October 5 let the hands shape MRT2's sound directly, but Everett found that it is motion as music: the hand chooses every note.
The [motion-to-music note](motion-to-music.md) splits the music into direction, which the hands steer, and content, which the model writes, and measures both.

## Motion to music

The note's harness copies MRT2's state and plays scripted movements from one moment, so that influence and freedom can be measured apart.
The results so far:

- **MRT2's handles:** it obeys silenced pitch classes, not silenced octaves, and words in its style description move the register.
- **Steered, the design built on those handles,** moved register, density, harmony, and rest the expected way in at least five of six seeds, while choosing different notes in every seed.
- **It is too slow:** half of each change took 1.2 to 2.3 seconds; the target is about half a second.
- **The theremin** moves its register in 0.12 seconds, but its notes are all the hand's.

The listening test at `outputs/motion-to-music-2026-10-07/listening-test.html` checks whether the movements can be heard.

The theremin page itself is at `/theremin.html`, and the [experiment guide](generative-theremin-experiment.md) describes it.
With camera tracking running, MRT2 needed a median of 37 to 39 ms for each 40 ms frame, and two-minute replays had four or five dropouts; with nothing else running, it needed 22 ms.

## V1's open play tests

The [readiness record](v1-readiness.md#remaining-play-tests) lists seven play tests that need Everett's hands.
The October 4 session was informal play, not those tests.
The V1 checklist in the [V1 plan](v1-plan.md#v1-checklist) stays the release bar.

## Next

1. **Everett takes the listening test,** 24 pairs in about ten minutes, and copies the results back.
   It shows whether the measured steering can be heard.
2. **Make steered respond within about half a second:** read the style every frame, smooth it less, and fade the output on rest; then measure again.
3. **If both hold up, build a playable steered page** with the camera, reusing the theremin page's tracking and audio streaming.

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
| October 7       | Motion as music versus motion to music; the first steering measurements.                           |

## Where things are

- The [documentation index](README.md) lists the current documents.
- Recordings and test evidence are in `outputs/` and `work/`, which Git ignores.
  The [data map](development.md#data-and-evidence) lists the current ones.
- The Qwen credential is in `~/.config/sway/qwen.json`, outside the repository.
- On `motion-to-music` on October 7, 78 Python tests and 128 JavaScript tests passed.
- No Sway server or other Sway process was running at this update.
