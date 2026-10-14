# Project status

Updated: October 14, 2026, Asia/Singapore.
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
On October 13 Everett accepted that latency, and the steered design became a playable page.
On October 14, after playing it with his hands, he said it does feel like leading the music.

## Branches

| Branch      | Contains                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | State                                                                 |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| `main`      | V1 as merged on October 1 ([#1](https://github.com/Audiofool934/sway/pull/1)), CI ([#8](https://github.com/Audiofool934/sway/pull/8)), `clean-start` ([#9](https://github.com/Audiofool934/sway/pull/9)): the code of #2, #4, and #5 and its fixes, the theremin experiment, and the October 7 cleanup; `motion-to-music` ([#11](https://github.com/Audiofool934/sway/pull/11)): the steering measurements; and `steered-page` ([#12](https://github.com/Audiofool934/sway/pull/12)): the playable steered page, one model thread, and the GPU filler. | The baseline. #9 merged on October 13, and #11 and #12 on October 14. |
| `readme`    | [#10](https://github.com/Audiofool934/sway/pull/10): the README rewritten for people who find Sway on GitHub.                                                                                                                                                                                                                                                                                                                                                                                                                                          | Open pull request, based on `main`.                                   |
| `v2-design` | [#3](https://github.com/Audiofool934/sway/pull/3): the V2 proposal, `src/sway/pitch.py`, and the palette probe.                                                                                                                                                                                                                                                                                                                                                                                                                                        | Open pull request, kept as a reference. Not built.                    |

Numbers such as #3 are pull requests on GitHub.
[#2](https://github.com/Audiofool934/sway/pull/2), [#4](https://github.com/Audiofool934/sway/pull/4), and [#5](https://github.com/Audiofool934/sway/pull/5) closed on October 13, because `main` includes their work.
[Issue #6](https://github.com/Audiofool934/sway/issues/6) records an evaluation of DEMON, ACE-Step 1.5, and Stable Audio 3 for later.

## Pages

| URL              | What it is                                                                              | State                                                                       |
| ---------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `/`              | V1: the lead hand plays a pitch ladder, and the band hand sets energy, cuts, and loops. | Current. MRT2 plays the harmony, and Qwen can compose the band.             |
| `/theremin.html` | The hands shape MRT2's live sound directly.                                             | Experiment. Its interface is in Chinese.                                    |
| `/steered.html`  | The hands steer the direction, and MRT2 writes every note.                              | Merged on October 14. Played the same day: it feels like leading the music. |

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

Everett took the listening test on October 13 and picked the right clip in 20 of 24 pairs.
Activity, stillness, and height are heard; spread is at chance in every variant, even in steered, where the audio measured its strongest effect.
The [note's listening section](motion-to-music.md#listening-test) has the details.
A spread check the same day asked about the sound instead: Everett heard the triad-to-scale change in 9 of 12 pairs, so it is audible but subtle, and the movement question did not point to it.
The [spread check](motion-to-music.md#spread-check) has the details.

The theremin page itself is at `/theremin.html`, and the [experiment guide](generative-theremin-experiment.md) describes it.
Its live stream slowed from 22 ms to about 40 ms for each 40 ms frame after about 25 seconds, which caused dropouts.
On October 13 this was traced to macOS lowering the GPU clock between frames, and a filler now keeps the GPU busy; the [steered page guide](steered-page.md#the-gpu-filler) has the details.

## V1's open play tests

The [readiness record](v1-readiness.md#remaining-play-tests) lists seven play tests that need Everett's hands.
The October 4 session was informal play, not those tests.
The V1 checklist in the [V1 plan](v1-plan.md#v1-checklist) stays the release bar.

## Next

Everett decided on October 14 to settle V1 first, then begin V2.

1. **Settle V1 against its checklist:** a 20-minute run checked for gaps on the merged code, Everett's play tests, and a new player for lesson 1.
2. **Then begin V2.** Building it around the steered design, with a clearer spread, is proposed but not decided.

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
| October 7       | `clean-start` opened as #9, and the README rewrite as #10.                                         |
| October 13      | Listening test: 20 of 24 right; spread not heard.                                                  |
| October 13      | Spread check: asked about the sound, 9 of 12 right.                                                |
| October 13      | `motion-to-music` opened as #11, stacked on #9.                                                    |
| October 13      | #9 merged into `main`; #10 and #11 now target `main`; #2, #4, and #5 closed.                       |
| October 13      | Speed run: the fade makes rest fast; MRT2 itself takes 1.2 to 1.7 seconds to follow.               |
| October 13      | The steering latency is accepted; next is a playable steered page.                                 |
| October 13      | The playable steered page, as draft #12; the GPU slowdown found and filled.                        |
| October 14      | Everett played the steered page: it feels like leading the music.                                  |
| October 14      | #11 and #12 merged; V1 to be settled before V2.                                                    |
| October 14      | V1's setup advice fixed: it named `sway setup --music-only`, an option removed on October 7 (#13). |

## Where things are

- The [documentation index](README.md) lists the current documents.
- Recordings and test evidence are in `outputs/` and `work/`, which Git ignores.
  The [data map](development.md#data-and-evidence) lists the current ones.
- The Qwen credential is in `~/.config/sway/qwen.json`, outside the repository.
- On `steered-page` on October 13, 92 Python tests and 133 JavaScript tests passed.
- At this update, Everett's own `sway serve` was running in his terminal; no agent-started Sway process was.
