# Project status

Updated: November 1, 2026, Seattle time.
Dates are in Seattle time; the V1 plan and the motion-to-music note were dated in Singapore time.
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

| URL                           | What it is                                                                              | State                                                           |
| ----------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `/`                           | V1: the lead hand plays a pitch ladder, and the band hand sets energy, cuts, and loops. | Current. MRT2 plays the harmony, and Qwen can compose the band. |
| `/theremin.html`              | The hands shape MRT2's live sound directly.                                             | Experiment. Its interface is in Chinese.                        |
| `/steered.html`               | A film score that the player conducts and Qwen composes.                                | V2. Milestone 1 merged October 19; milestone 2 in review.       |
| `/steered.html?variant=score` | A score that Sway writes from the hands, a bar at a time, which Stable Audio 3 plays.   | Built November 1 on `score-variant`; not yet played by Everett. |

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
On October 15 he called V1 OK and began V2's design; V1's remaining play tests are still open.

1. **Settle V1 against its checklist.**
   The [October 14 20-minute run](v1-readiness.md#20-minute-run-october-14) found no quiet interval of 300 ms or longer outside the cuts, which cannot rule out shorter gaps, and kept MRT2's harmony for all but 3 of 484 bars; one 399 ms page pause at 17:27 made two band steps late.
   On October 15 Everett listened to it and heard only the scripted cuts and the fallback bars, so the gap test is met.
   Still open: his play tests, and a new player for lesson 1.
2. **V2:** on October 15 Everett called V1 OK and started V2's design.
   On October 19 he approved the [V2 design](v2-design.md): one continuous piece that anyone leads in five minutes, without playing a note.
   Its first milestone, continuity, was built on October 19: the steered page now plays on a spine of bars and chords ([guide](steered-page.md#the-spine)).
   On October 19 Everett chose it as more continuous in six of six blind pairs, but playing it he still heard piano fragments.
   The cause was solo piano itself, so the spine now plays an ensemble whose instruments follow the hands.
   Later that day he played it and said: "this is GREAT!!!"
   The second milestone, a film score world with Qwen as the arranger and a clap, is in draft [#17](https://github.com/Audiofool934/sway/pull/17).
   Playing it, Everett found that it has the film-score sound but is not controllable: "I don't know what my hands are actually controlling."
   So the V2 design now makes the player [the conductor](v2-design.md#the-conductor) of an AI orchestra, with fixed gestures whose meaning each world sets, and a [world designer](v2-design.md#worlds-and-the-world-designer) that writes worlds from the player's words.
3. **The conductor,** milestone 2's continuation on #17's branch, was built the same day: the conductor's gestures, the film score written as a world, and the composer kept to the score ([guide](steered-page.md#the-conductor)).
   On October 20 Everett played it: it starts to come together, and "the instrument itself is a generative result".
   He asked for drawings of the gestures that open on screen at any time, and found the sound too quiet.
   Both are now on #17: a [gesture guide](steered-page.md#the-gesture-guide), and a [steady, louder level](steered-page.md#loudness).
   He also asked when a player can choose or describe the theme in words: that is milestone 3, the [world designer](v2-design.md#worlds-and-the-world-designer).
   In one test take MRT2 fell silent for about 11 seconds.
   Traced the same day: under a calm style MRT2 can stop playing by itself and stay silent, whatever notes it may play, and striking the chord brings it back; the spine now does that after 0.8 s of silence ([guide](steered-page.md#silence)).
   Later that day Everett played it again and said: "I completely don't get it"; the music went "back to being isolated musical snippets without any real subjectivity or consistency" ([guide](steered-page.md#the-second-play-test)).
4. **The theme test,** on its own branch: whether a theme that MRT2 is given as notes, and that leaves and returns, makes the spine sound like one piece with its own identity.
   The [V2 design](v2-design.md#what-we-have-learned) gives the reasons.
   It runs offline, as a blind listening test, before any more is built on the conductor.
   Built on October 20 ([guide](steered-page.md#the-theme-test)): MRT2 plays the theme's notes, 81% to 90% of the melody early in each note against 12% to 27% without it.
   Everett found the blind pairs tiring and asked to go on without the answers, so the theme is now playable at `steered.html?variant=theme` ([guide](steered-page.md#the-theme-played)).
   Everett played it the same day: when the theme returns, it clearly switches, but overall it is stronger than before.
   Four offline runs then measured the theme's seams ([guide](steered-page.md#the-themes-seams)).
   The exit jumps about twice as much as the spine alone, easing over a bar made both seams larger, and inner voices smoothed the return's register but not the exit.
   So the ramp is removed, and inner voices are an option, off by default.
   Nobody has listened to the seam clips, and the next step is not decided.
5. **The renderer comparison,** October 29.
   A design discussion that day asked whether the hands should shape the piece over time as well as at once, and whether MRT2 holds Sway back; nothing was decided.
   If Sway gives the melody, the chords, and the form, MRT2's part is to play them.
   So an offline comparison played one score with MRT2 in two ways, with the General MIDI sampler that ships with macOS, and with Stable Audio 3 redrawing the sampler's audio ([guide](steered-page.md#renderers)).
   MRT2 follows a given line about as closely as the theme.
   But on the Mac mini its loudness changes across every bar line by a median of about 3 to 4 dB, against about 1 dB for the others, and it still falls silent about 2% of the time.
   Stable Audio 3 keeps the score at noise 0.3 and 0.5, and leaves the chords from 0.7.
   The page is `outputs/renderers-2026-10-29/index.html`.
   Everett listened the same day; in his words, translated from Chinese: SA3 is more stable, and it sounds better.
   He did not name a noise level.
   Rendered piece by piece with its models loaded, as live, SA3 keeps up on the Mac mini: about 2.4 s for each 4-bar piece and 1.5 s for each 1-bar piece ([guide](steered-page.md#sa3-in-pieces)).
   At noise 0.3 the pieces measure like the one clip; at 0.5, 1-bar pieces drift from the score.
   Their page is `outputs/renderers-2026-10-29/pieces/index.html`.
   On October 30 Everett chose noise 0.3; in his words, translated from Chinese: "0.3 is enough."
   At 0.3, 1-bar pieces work, so a plan was given the same day to play SA3 on the steered page in 1-bar pieces.
   Before building it, Everett chose three offline tests ([guide](steered-page.md#offline-tests-before-the-live-page)).
   Without the 0.56 s tail drawn after each piece, every join dips about 6.4 dB, so a live window keeps a tail, guessed from the hands as they are; a wrong guess before a change did no harm.
   With 4 steps and 2.4 s of music before each piece, a window takes about 1 s instead of 1.9 s on the same machine, and measures as well; whether it sounds as good is for listening.
   SA3 follows a change of texture in its own bar, and a change of register in its own bar but less: the pieces keep 50% to 64% of the bass's change.
   The tests' page is `outputs/renderers-2026-10-29/tests/index.html`; nobody has listened to it.
   On November 1 Everett chose to build the live version; in his words, translated from Chinese: "start building."
   It is the score variant, `steered.html?variant=score`, on the branch `score-variant` ([guide](steered-page.md#the-score-variant)).
   Sway writes each bar from the hands, the macOS sampler plays it, and SA3 redraws it in its own process, with 4 steps and 2.4 s of music before each bar.
   In two scripted five-minute takes in headless Chrome, with a fake camera, no bar was late and the browser never ran out of audio.
   A change of the hands reached the music in 1.5 to 4.1 s, 2.6 s at the median.
   A 100 s recording is `outputs/score-2026-11-01/live-probe-100s.wav`; nobody has played or heard the variant yet.

## Working rules

- One piece of work at a time, on its own branch and pull request.
- Everett reviews on GitHub.
  Nothing merges until he asks.
- When more than one agent works on Sway, each reads this page first and updates it at the end.

## Timeline

| Date            | Event                                                                                                                                        |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| September 26    | First prototype: camera to Qwen to MRT2 text prompts.                                                                                        |
| September 26-27 | Gesture ensemble, Flow with DEMON, and Colab trials.                                                                                         |
| September 27    | Paused. A gesture took 8 to 14 seconds to change the sound.                                                                                  |
| September 28    | Restarted from first principles as V1: a hand-played lead, a band hand, and a music-game tutorial.                                           |
| October 1       | V1 merged (#1). First play test. Pull requests #2 to #5 and issue #6 opened.                                                                 |
| October 2       | CI merged (#8).                                                                                                                              |
| October 3-4     | The V1 candidate: #2, #4, and #5 combined, with fixes and a 20-minute browser run.                                                           |
| October 4       | Second play test: stable, but it does not feel like leading the music.                                                                       |
| October 5       | The theremin experiment.                                                                                                                     |
| October 7       | Cleanup: one branch, the paused prototypes and 15 historical documents removed.                                                              |
| October 7       | Motion as music versus motion to music; the first steering measurements.                                                                     |
| October 7       | `clean-start` opened as #9, and the README rewrite as #10.                                                                                   |
| October 13      | Listening test: 20 of 24 right; spread not heard.                                                                                            |
| October 13      | Spread check: asked about the sound, 9 of 12 right.                                                                                          |
| October 13      | `motion-to-music` opened as #11, stacked on #9.                                                                                              |
| October 13      | #9 merged into `main`; #10 and #11 now target `main`; #2, #4, and #5 closed.                                                                 |
| October 13      | Speed run: the fade makes rest fast; MRT2 itself takes 1.2 to 1.7 seconds to follow.                                                         |
| October 13      | The steering latency is accepted; next is a playable steered page.                                                                           |
| October 13      | The playable steered page, as draft #12; the GPU slowdown found and filled.                                                                  |
| October 14      | Everett played the steered page: it feels like leading the music.                                                                            |
| October 14      | #11 and #12 merged; V1 to be settled before V2.                                                                                              |
| October 14      | V1's setup advice fixed: it named `sway setup --music-only`, an option removed on October 7 (#13).                                           |
| October 14      | 20-minute V1 run on `main`: 3 fallback bars instead of 78, no quiet interval of 300 ms or longer outside the cuts, one late moment at 17:27. |
| October 15      | Everett listened to the 20-minute recording: only the planned cuts and fallback bars.                                                        |
| October 15      | V1 called OK; the V2 design draft started.                                                                                                   |
| October 19      | The V2 design approved.                                                                                                                      |
| October 19      | V2 milestone 1: the steered page plays on a spine; each chord is told 1.2 s early.                                                           |
| October 19      | Blind comparison: the spine chosen as more continuous in six of six pairs.                                                                   |
| October 19      | Still fragments when played; the spine changes from solo piano to an ensemble.                                                               |
| October 19      | Everett played the ensemble spine: "this is GREAT!!!"                                                                                        |
| October 19      | V2 milestone 2: the film score world, Qwen as the arranger, and the clap.                                                                    |
| October 19      | The product pictured as an orchestra you conduct; the conductor model and the world designer added to the V2 design.                         |
| October 19      | The conductor built: fixed gestures, the film score as a world, and the composer kept to the score.                                          |
| October 20      | Everett played the conductor; a gesture guide and a steady, louder level added.                                                              |
| October 20      | MRT2's silences traced to calm styles; the spine strikes the chord after 0.8 s of silence.                                                   |
| October 20      | The theme test: MRT2 plays the theme's notes 81% to 90% early in each note; the theme made playable.                                         |
| October 20      | Everett played the theme: it switches when it returns, but it is stronger overall.                                                           |
| October 20      | Four seam runs: the exit jumps most, and easing over a bar makes both seams larger.                                                          |
| October 22      | On the new Mac mini, MRT2's key test judges the median over five seeds, and Qwen is reached in US Virginia.                                  |
| October 29      | The renderer comparison: MRT2 changes about 3 to 4 dB across every bar line, the sampler and Stable Audio 3 about 1 dB.                      |
| October 29      | Everett listened: Stable Audio 3 is more stable, and it sounds better.                                                                       |
| October 29      | SA3 in pieces, as live: it keeps up on the Mac mini, and at noise 0.3 its joins measure like one clip.                                       |
| October 30      | Everett chose noise 0.3 for SA3: "0.3 is enough."                                                                                            |
| October 30      | Three offline tests: pieces need a tail, 4 steps halve a window, and SA3 follows a texture change in its own bar.                            |
| November 1      | The score variant: Sway writes each bar from the hands, and SA3 plays it live; in 10 scripted minutes no bar was late.                       |

## Where things are

- The [documentation index](README.md) lists the current documents.
- Recordings and test evidence are in `outputs/` and `work/`, which Git ignores.
  The [data map](development.md#data-and-evidence) lists the current ones.
- The Qwen credential is in `~/.config/sway/qwen.json`, outside the repository.
- On `score-variant` on November 1, on the Mac mini, 187 Python tests and 141 JavaScript tests passed, including the real MRT2 key test and the real macOS sampler.
- At this update, no Sway process was running.
