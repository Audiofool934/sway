# Steered page

Started: October 13, 2026, Seattle time.
This page plays the steered design from the [motion-to-music note](motion-to-music.md) with the hands.
The hands steer the direction of the music, and MRT2 writes every note.
On October 14, after playing it with his hands and the camera, Everett said it does feel like leading the music.
Since V2's second milestone the player [conducts a film score](#the-conductor): a composer writes its phrases, and the player decides how they are played.

## Play

Run `uv run --locked sway serve` and open `http://127.0.0.1:8765/steered.html` in Chrome.
Choose the camera or the mouse on the page.
The sound is generated on this Mac, and the camera image stays on this Mac.

| Gesture                                     | What the music does                                                                    |
| ------------------------------------------- | -------------------------------------------------------------------------------------- |
| The right hand's motion: bigger, or smaller | Louder or softer, at once; the playing grows fuller or thinner within a second or two. |
| The right hand's motion: faster, or slower  | Driving and rhythmic, or calm and sustained.                                           |
| The left hand's place, left to right        | The violins, the brass, or the cellos and basses lead.                                 |
| The left hand's height                      | How far that voice comes forward; a low hand keeps the orchestra balanced.             |
| An open palm, or a pinch                    | Long lines, or short notes.                                                            |
| A fist, or holding still                    | After about 0.65 seconds it hushes to a quiet chord. Moving again grows it back.       |
| Both hands up, then down                    | A swell rises while they are up; the next section lands on the beat after the drop.    |

One hand conducts as the right hand, and the voices keep their balance.
A left-handed player can open `steered.html?hand=left`.
With the mouse, hold the stage and move: the motion's size and speed conduct, and a double-click moves on.
The Gestures button, or G, shows [each gesture drawn](#the-gesture-guide) over the stage at any time, while the music keeps playing.
The music follows a gesture within a second or two, except the volume and the swell, which answer at once; Everett accepted this latency on October 13.

`?variant=spine` and `?variant=free` play the earlier, steered designs: height sets the register, movement the energy, spread the harmony, and stillness thins the music.
`?variant=theme` plays the spine with a theme that returns every twelve bars ([The theme, played](#the-theme-played)).
`?variant=score` plays a score that Sway writes from the hands, a bar at a time, and Stable Audio 3 renders ([The score variant](#the-score-variant)); it needs Stable Audio 3 on this Mac.

End the take to save it as a WAV file.
Escape also ends it, and a take stops after five minutes.

## How it works

- `web/steered-controls.js` turns the hands into height, activity, and spread, each from 0 to 1.
  Activity below 0.05 is stillness.
- `src/sway/steered.py` plays V2's spine (`steering.Spine`), one 40 ms frame for each control.
  `?variant=free` plays the page as it was on October 14, without the spine, for comparison (`steering.Live`).
- `src/sway/scored.py` plays the score variant: `src/sway/score.py` writes each bar, the macOS sampler plays it, and Stable Audio 3 redraws it, each in its own process.
- `src/sway/stream.py` and `web/stream-page.js` are shared with the theremin page: one window at a time, the camera, streamed audio, and recording.
- The page plays the model's output without its own gain or filter, so what is heard is what the model wrote.

## The spine

On October 15, Everett said the page "feels like some random music pieces joined together".
The [V2 design](v2-design.md) answers with a spine, its first milestone, added on October 19:

- **Bars and chords:** a bar grid at Night Drive's 100 beats a minute, and its chords, Am, F, C, and G, one a bar.
  The page shows the chords, with the one being heard underlined.
- **The hands open the harmony around each chord:** close hands keep the melody on the chord's tones, the middle adds the A minor pentatonic scale, and wide hands the whole scale.
- **Harmony changes with the chord, not on any frame.**
  The style still follows the hands continuously, as it changes gradually anyway.
- **Stillness thins the music:** the output falls to about a third at once, and from the next chord only its root and fifth may sound.
- **Each chord is told 1.2 seconds early,** so that MRT2's delay lands it on its bar line.
- **When MRT2 falls silent by itself,** it is told to strike the chord being heard ([Silence](#silence)).

The last point came from measuring.
With chords told on their bar lines, MRT2 had not settled on one chord before the next began: early in each bar, the melody had 26% of its energy on the bar's chord, and late in it 55%.
Six seeds were tried with the harmony 0.8, 1.2, and 1.6 seconds ahead:

| Harmony ahead of the bar line | Melody on the bar's chord, early in the bar | Late in the bar |
| ----------------------------- | ------------------------------------------- | --------------- |
| None                          | 26%                                         | 55%             |
| 0.8 s                         | 48%                                         | 74%             |
| 1.2 s                         | 60%                                         | 98%             |
| 1.6 s                         | 82%                                         | 48%             |

At 1.6 seconds, the next chord already arrives late in the bar.
Striking the chord's root in the bass on each bar line also put the melody on the chord at once, but the melody then faded, to 18% of the energy late in the bar.

`uv run --locked python -m sway.steering --out <new folder> --continuity` renders a 40-second scripted performance, which steers, rests twice, and starts again, with and without the spine, and writes a blind listening page that asks which of each pair sounds more like one continuous piece.
On October 19, over six seeds, the clips without the spine were silent 18% of the time, and those with it 1%.
On October 19, Everett chose the clip with the spine as the more continuous one in all six pairs; with no preference, that happens once in 64 tries.
The clips without the spine fall silent when the hands rest, which is an obvious cue, so this shows that the largest seam is gone, not yet that the music feels like one piece while it plays.
The answers are in `outputs/continuity-2026-10-19/listening-results-2026-10-19.json`.

### Texture

On October 19, Everett played the spine and still heard "individual piano fragments", with transitions that are not blank, even with a steady motion; the note rate sped up and slowed down.
The controller was not the cause: a simulated steady sway moved activity only between 0.49 and 0.58.
The model was: with the hands held constant and no chord changes at all, solo piano's note rate still varied 27% from second to second, and narrow chords made it more hesitant.

So the spine's four style corners changed from solo piano to an ensemble.
With the hands held constant and the chords on, measured over three seeds:

| Prompt                               | Note rate's variation, second to second | Time in dips |
| ------------------------------------ | --------------------------------------- | ------------ |
| Solo piano, the corners before       | 34%                                     | 1.8%         |
| Piano over strings and bass          | 21%                                     | 2.5%         |
| Flowing piano arpeggios              | 25%                                     | 0%           |
| Ensemble of piano, strings, and bass | 18%                                     | 0.1%         |

Everett ranked them: ensemble about equal to arpeggios, both far more continuous than solo piano.
The plain ensemble lost the energy control, though: over six seeds, activity moved the density the expected way in only half.
Naming instruments fixed both controls: low is cellos, double bass, and low piano; high is violins and high piano; calm is slow and sustained; lively is fast arpeggios and pulsing staccato strings.

| Corners                                   | Height moves the register | Activity moves the density |
| ----------------------------------------- | ------------------------- | -------------------------- |
| Solo piano, October 7                     | 83% of seeds, effect 1.4  | 100%, effect 1.9           |
| Ensemble                                  | 100%, effect 4.2          | 50%, effect -0.5           |
| Rhythmic ensemble, with register words    | 67%, effect 0.6           | 100%, effect 1.7           |
| Rhythmic ensemble, naming the instruments | 100%, effect 3.7          | 100%, effect 3.8           |

The last is the spine's texture now.
Its note rate varied 21% to 32% from second to second across its corners and middle, so this measure alone does not settle continuity; Everett's ears do.
On October 19, Everett played the ensemble with his hands and said: "this is GREAT!!!"
The clips are in `outputs/fragments-2026-10-19/`.

### Silence

On October 20, in a browser take of the conducted film score, MRT2's own output fell silent for about 11 seconds during small motion in the peak.
The music came back only when the motion grew.
Six scripted takes without the browser, 12 minutes in all, found it again: MRT2 fell silent five times.
Four lasted 1.0 to 8.8 s, under small motion or a hush, and one lasted 0.6 s, under moderate motion; none came under big motion.

The notes that MRT2 may play were not the cause.
From the moment before one hush, each condition had eight random continuations of 12 seconds:

| Condition                                              | Silent for 1 s or more | Longest |
| ------------------------------------------------------ | ---------------------- | ------- |
| The hush: the chord's root and fifth                   | 0 of 8                 | 0 s     |
| A hush with the chord's tones and the pentatonic scale | 2 of 8                 | 6.2 s   |
| A hush with the chord's three notes                    | 2 of 8                 | 8.4 s   |
| Small motion, no hush                                  | 1 of 8                 | 2.1 s   |

Once silent, MRT2 stays silent: from inside one silence, all eight continuations were still silent 4 seconds later.
Struck once, the chord being heard brought the sound back in all eight, in 0.1 to 1.0 s, and MRT2 played on by itself.
Holding the chord for a second, or stronger note guidance, did no better.

So the spine now listens for silence.
When MRT2's output has stayed below -65 dBFS for 0.8 seconds, the spine tells MRT2 to strike the chord being heard: its root at or above G2, the fifth, the root an octave up, and the third.
A shorter rest stays a rest.
In the same six takes with this guard, no silence lasted 1 second: the longest was 0.88 s.
MRT2 was struck six times in 12 minutes, and the sound came back 0.1 to 0.6 s after each strike.
The traces are in `outputs/silence-2026-10-20/`.

## The conductor

V2's second milestone ([design](v2-design.md)).
Its first version, on October 19, played a film score that an arranger planned and a clap moved on.
Everett found that it "has that film-score sound" but "doesn't seem very controllable": "I don't know what my hands are actually controlling".
The clap was hard to recognize, because the tracker lost a hand when the hands overlapped.
So the milestone continued with the conductor: the player conducts, a composer writes the score, and MRT2 is the orchestra.

- **The world** (`src/sway/world.py`) is D minor at 80 beats a minute: a bar is 3 seconds, and a phrase of four bars is 12 seconds.
  Its chords are Dm, Gm, Am, Bb, F, and C, all from the scale.
  It places three voices, the violins, the brass, and the cellos and basses, from left to right, and it gives the words for calm and driving playing and for long and short notes.
  Its 16 style descriptions combine each voice, or the balanced orchestra, with calm or driving playing and long or short notes, so that every gesture at its extreme reaches a whole description.
  Its four sections, intro, build, peak, and release, have default chords and the score's dynamics: a level of -6, -3, 0, and -6 dB, and words for it in the style.
- **The gestures** (`web/conductor-controls.js`) are those in the table above.
  The size of the conducting hand's motion over the last 0.8 seconds sets the dynamics, and its speed the energy.
  Its thumb-to-index distance sets the articulation, and a fist or 0.65 seconds without motion hushes.
  The left hand's place across the view, from 8% to 72% of its width so that it need not cross the right hand, chooses the voice, and its height how far that voice comes forward.
  Both hands above the top 30% of the view for a quarter of a second prepare, and both below the middle within 0.6 seconds of leaving the top move on.
  The left hand's balance holds while it is out of view, and while both hands are up.
- **The piece** (`src/sway/piece.py`) blends the 16 descriptions by the gestures; the dynamics is 40% of the calm-to-driving texture, and the section's words 20% of the style.
  It brings MRT2's output to a [steady loudness](#loudness), then applies the section's level as a gain, moving to a new section's level with a 1-second time constant.
  The harmony is the composer's: each chord's tones and the pentatonic scale.
- **The composer** (`src/sway/arranger.py`) is Qwen.
  For each phrase it writes the next section, its chords, and a caption that names no instrument, and a second plan in case the player moves on.
  It hears how the player conducted the last phrase, in words and numbers only, and the world's own plan plays whenever its answer is missing, invalid, or late.
- **The page** turns the volume with the motion's size at once, from -12 dB to full.
  It shows the voices' names across the view where the left hand reaches them, each as bright as it is brought forward.
  Raising both hands starts a swell, which lands with the new section on the beat after they come down, or fades if they come down slowly.
  It shows the section and the composer's caption above the phrase's chords.

Measured on October 19 with the real model, the conductor's gestures over six seeds:

| Gesture                                                     | Result                                                                                                  |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| The left hand between the violins and the cellos and basses | The register moved in five of six seeds (effect 1.3); half the change took 2.7 s.                       |
| The left hand raised, bringing the violins forward          | Brighter in all six (effect 2.9), higher and louder in five.                                            |
| Big and fast, against small and slow                        | Denser in all six (effect 1.5); half the change took 2.5 s.                                             |
| A pinch, against an open palm                               | A consistent change in all six (effect 4.2): short notes came out sparser and quieter, not denser.      |
| The peak, against the intro                                 | Louder in all six (effect 3.4) and denser in five (1.7), once the sections' words named their dynamics. |
| The build, against the intro                                | Louder in five of six (effect 1.0) and denser in five (1.9).                                            |
| The release, against the build                              | Louder than the build in all six (effect 2.1), in two wordings: "piano" and "softly and tenderly".      |

The sections' first words, such as "the full orchestra together, powerful and grand", had made the peak quieter, darker, and sparser than the intro; words for dynamics fixed the peak but not the release.
As a fifth of the style, a section's words often leave MRT2's six coarse style tokens unchanged: two wordings of the release gave identical results.
So the piece also applies each section's level as a gain, which is exact; the words only color the sound.

A scripted 62-second take in the browser, with the real model and Qwen, went as designed: the strongest style followed each gesture, both moves landed on bar lines, Qwen planned every phrase after the first, and its captions followed the playing, such as "Tension gathers. The orchestra wakes.".
Frames took a median of 22.5 ms, 95% under 24.4 ms, with no underrun and no console error.
At 1280 by 800, the voices sit across the top of the view and the readouts at the bottom; in a 400 by 300 pane they overlap.
The clips are in `outputs/conducted-2026-10-19/`.

### The gesture guide

On October 20 Everett played the conductor and said that it starts to come together, and that "the instrument itself is a generative result".
But the written guide did not show exactly how to point or move.
So the page draws each gesture as a short looping animation: louder or softer, calm or driving, bringing a voice forward, long or short notes, the hush, and moving on.
The hands are drawn from behind, as the player sees their own hands held up to the screen.
The voice card names the world's voices, and meters and notes show what each gesture changes.
The Gestures button in the header, "See the gestures" on the first screen, or G opens the guide; Close, Escape, or G closes it.
The music keeps playing while it is open, and Escape closes the guide before it would end the take.
With reduced motion, each card holds the pose that shows its gesture.
`web/gesture-guide.js` draws the animations.

### Loudness

The same day Everett found the sound too quiet: he had to turn the Mac's volume all the way up.
MRT2's output level depends on the texture: with the same world it ranged from -59 to -30 dBFS RMS, 15 to 40 dB below recorded music.

- **The piece** measures its output over 2 seconds and brings it to -13 dBFS RMS, by -12 to +48 dB, before the section's level.
  While the measure catches up with a sudden loud passage, no frame is boosted more than 6 dB above that level.
  A hush is not measured, so it stays quiet.
  The measure starts from MRT2's quietest textures, so that a quiet opening is heard at once.
- **The page's** volume starts at full instead of 70%, and a limiter after it keeps the peaks below full scale.

Measured in the browser with the real model, conducting with the mouse, at the page's output:

| Playing         | Before, dBFS RMS | After, dBFS RMS |
| --------------- | ---------------- | --------------- |
| Moderate motion | -24              | -15.5 to -18.5  |
| Big motion      | -27              | -11.4 to -14.7  |
| Small motion    | -32 to -42       | -19.8 to -21.8  |
| A hush          | -43 to -47       | -32             |

"Before" is the first version of this change, which aimed at -16 dBFS with at most +36 dB and a volume of 70%; the version Everett played had no leveling.
The quiet intro now reaches its level within 3 seconds.
The loudest peak was -0.5 dBFS.
Recorded music is usually played at about -14 LUFS, so big motion is about as loud as a song, and moderate motion a little softer.

In one take, MRT2's own output fell silent for about 11 seconds.
The leveling lowers a frame by at most 12 dB, or to the ceiling, and it holds its gain through a silence, so the silence came from the model; [Silence](#silence) traces it.

### The second play test

Later on October 20, Everett played the conductor with the gesture guide, the louder level, and the silence guard.
He said: "I completely don't get it".
In his account, the left hand has to move near a voice's name, the right hand turns in place, and a sound comes, but "it's not a sound that makes any sense": it goes "back to being isolated musical snippets without any real subjectivity or consistency".
The [V2 design](v2-design.md#what-we-have-learned) compares the conductor with the spine and traces the cause to what holds the music together, and the next test to a theme.

### The theme test

Nothing in Sway holds a theme, so this test gives the spine one and asks whether the music then sounds like one piece with its own identity.
It runs offline: `uv run --locked python -m sway.theme --out <new folder>` (`src/sway/theme.py`).

- **The theme** is four bars over Am, F, C, and G: A C E D, C held for three beats and A, G C E D, and B held for a bar.
- **MRT2 is given it as notes:** each note is struck on its first frame and held after.
  From middle C up, every other pitch is silent, so the theme is the top line; below middle C the spine's harmony stays free, and MRT2 accompanies.
- **The form** is 24 bars, 57.6 s: the theme for four bars, eight bars away, the theme, four away, and the theme.
- **The movement** is the same in both clips, eight bars each: moderate, livelier, then calmer, with no rest.
- **Each pair** branches from one moment after four bars of warmup, with the same random choices, so only the notes MRT2 is given differ.
  The listening copies are brought to -20 dBFS RMS by constant gain, with every peak below -1 dBFS.

A calibration on October 20, over three seeds and one statement of the theme, measured the share of the melody's energy, from middle C up, on the theme note's pitch class, in the note's first 0.3 s and after:

| The theme told early | Note guidance | Early in the note | Later |
| -------------------- | ------------- | ----------------- | ----- |
| No theme             | -             | 11%               | 16%   |
| 0 s                  | 1             | 83%               | 33%   |
| 0.12 s               | 1             | 57%               | 21%   |
| 0.24 s               | 1             | 41%               | 5%    |
| 0.4 s                | 1             | 39%               | 10%   |
| 0 s                  | 3             | 87%               | 41%   |
| 0.12 s               | 3             | 47%               | 35%   |
| 0.24 s               | 3             | 59%               | 10%   |
| 0.4 s                | 3             | 35%               | 10%   |

In 0.1 s steps after the strike, told on time, the share was:

| Seconds after the strike | 0.0 | 0.1 | 0.2 | 0.3 | 0.4 | 0.5 |
| ------------------------ | --- | --- | --- | --- | --- | --- |
| No theme                 | 21% | 17% | 19% | 21% | 24% | 20% |
| Note guidance 3          | 56% | 77% | 61% | 43% | 44% | 27% |
| Note guidance 6          | 64% | 89% | 74% | 59% | 58% | 56% |

So MRT2 answers a struck note within about 0.1 s, unlike a chord, which the spine tells 1.2 s ahead, and the note then fades toward the accompaniment.
The test tells the theme on time with note guidance 3, the theremin's; 6 holds the note better, but nobody has heard yet what it does to the sound.

The six pairs, seeds 100 to 105, measured over all three statements:

| Seed | On the theme early in the note, with / without | Later in the note | Silent  | Level before matching, dBFS RMS |
| ---- | ---------------------------------------------- | ----------------- | ------- | ------------------------------- |
| 100  | 90% / 12%                                      | 42% / 15%         | 0% / 0% | -25.8 / -22.3                   |
| 101  | 89% / 21%                                      | 51% / 14%         | 0% / 9% | -31.1 / -25.9                   |
| 102  | 88% / 12%                                      | 58% / 15%         | 0% / 0% | -26.9 / -24.3                   |
| 103  | 82% / 22%                                      | 48% / 18%         | 0% / 2% | -30.0 / -24.3                   |
| 104  | 86% / 18%                                      | 38% / 17%         | 3% / 0% | -25.7 / -22.7                   |
| 105  | 81% / 27%                                      | 21% / 19%         | 0% / 0% | -28.0 / -25.9                   |

The clips with the theme are 3 to 6 dB quieter before matching, because only one note may sound from middle C up.
The theme can be heard, so the test is not blind to which clip has it: it asks for a judgment.
The page asks of each pair which clip sounds more like one piece with its own identity, and then which one Everett would rather keep listening to, so that a theme that makes the music worse to hear shows.
The clips and the page are in `outputs/theme-2026-10-20/`.
On October 20 Everett found the pairs tiring to compare and asked to go on with the design without the answers, so the test has no listening result.
The theme became playable instead.

### The theme, played

`?variant=theme` (`theme.ThemeLoop`) plays the theme on the steered page, and the hands steer as on the spine.

- **The theme returns:** after four bars away at the start, it plays for four bars every twelve, 28.8 s.
  The page shows "The theme" while it plays, and otherwise how many bars until it returns.
- **Height still moves the register:** at each of the theme's bar lines, height below 0.3 moves the theme an octave down, and above 0.7 an octave up.
  The pitches that only the theme may play move with it.
- **Stillness rests the theme,** and the spine thins as before; moving again strikes the theme's note at once, even mid-note.
- **The page says what this variant does:** its first screen, header, and footer describe steering, not the film score; the spine and free variants get the same steered words, which they had before the film score replaced them.

Checked on October 20 in headless Chrome with the real model, with 40 seconds of scripted mouse motion: the theme played in bars 4 to 7 and 16 to 19, the count ran from 8 bars down to 1 between them, stillness showed "The theme · resting", and the audio had no underrun.

Everett played it the same day.
In his words, translated from Chinese: when the theme returns, it clearly switches, but overall it is stronger than before.

### The theme's seams

Everett heard the theme switch when it returned.
So on October 20, four offline runs measured the seams: how much the music changes across the bar line where the theme returns or leaves.

- **A seam** compares the 1.5 s before the bar line with the 1.5 s from 0.1 s after it, in loudness, density, brightness, and register.
- **Each clip** has two returns and two exits.
  Each number is the mean over those seams and over seeds 100 to 105, measured before the levels are matched.
- **The clips without the theme** are measured at the same times, so they show how much the spine changes there by itself.
  They are the same clips in all four runs.

| Run              | What changes in the theme                                                                                                                             | On the theme, early / later in the note |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| `seams-ramp0`    | Nothing: the test as above, with note guidance 3. Its clips are the six pairs' clips, bit for bit.                                                    | 86% / 43%                               |
| `seams-ramp1`    | For one bar before and after each statement, from middle C up only the chord's tones may play, and the note guidance moves between the spine's and 3. | 88% / 48%                               |
| `seams-g1`       | Note guidance 1.                                                                                                                                      | 80% / 40%                               |
| `seams-g1-inner` | Note guidance 1, and inner voices: the chord's tones from middle C to a minor third below the theme's note stay free.                                 | 76% / 27%                               |

Without the theme, 19% of the melody is on the theme's note early in the note, and 16% later.
The commands were not recorded.
`g1` is read as note guidance 1 (`--strength 1`) from the folder name and from the options that the code had at the time.

| Seam              | Run               | Loudness, dB | Density, spectral flux | Brightness, octaves | Register, semitones |
| ----------------- | ----------------- | ------------ | ---------------------- | ------------------- | ------------------- |
| The theme returns | Without the theme | 4.28         | 9.74                   | 0.29                | 6.47                |
|                   | `seams-ramp0`     | 3.96         | 7.99                   | 0.43                | 6.00                |
|                   | `seams-ramp1`     | 3.34         | 19.30                  | 0.30                | 5.84                |
|                   | `seams-g1`        | 3.51         | 8.61                   | 0.35                | 6.66                |
|                   | `seams-g1-inner`  | 4.30         | 7.91                   | 0.44                | 3.30                |
| The theme leaves  | Without the theme | 1.76         | 7.35                   | 0.28                | 4.04                |
|                   | `seams-ramp0`     | 3.58         | 17.49                  | 0.49                | 5.09                |
|                   | `seams-ramp1`     | 6.92         | 27.76                  | 0.84                | 7.15                |
|                   | `seams-g1`        | 3.29         | 15.29                  | 0.41                | 6.12                |
|                   | `seams-g1-inner`  | 5.88         | 20.33                  | 0.63                | 5.62                |

- **The exit is the larger seam.**
  When the theme leaves, every pitch from middle C up is free again at once.
  Its loudness jump is twice the spine's alone, and its density jump 2.4 times.
- **The return measures close to the spine alone,** except brightness: 0.43 octaves against 0.29.
  So these measures do not show the switch that Everett heard in the live variant.
- **Easing over a bar made both seams larger:** the density jump rose to 19.30 at the return and 27.76 at the exit.
  So the ramp is removed.
- **Note guidance 1 changed the seams little:** the exit's density jump fell from 17.49 to 15.29, and the theme early in the note fell from 86% to 80%.
- **Inner voices** halved the register jump at the return, 3.30 against 6.00.
  But they made the exit larger, 5.88 dB and 20.33, and the theme held less later in the note, 27% against 40%.

None of the four makes the exit as smooth as the spine alone.
Inner voices stay as an option, off by default: `uv run --locked python -m sway.theme --inner --out <new folder>`.
The live variant does not use them.
Nobody has listened to the seam clips yet; they are in `outputs/theme-2026-10-20/seams-*`.
All four runs were made on the old development Mac, an M2 Pro.
MRT2 plays a fixed seed differently on the Mac mini, so a new run there will not repeat these numbers exactly.

### Renderers

If Sway gives the melody, the chords, and the form, MRT2's part is to play them.
On October 29 an offline comparison asked whether MRT2 is the best renderer for that.
Five versions play one score: the theme test's 24 bars and movement, with a melody in every bar.

- **The away line** fills the bars between the theme's statements: first the theme's climb turned downward, ending open on D, then the first note of each of the theme's bars, held for the bar.
- **MRT2, theme only** is the theme test as above: given the theme, and free between its statements.
- **MRT2, whole melody** is given the away line too, so from middle C up it always plays a given line, and its note guidance stays 3 across the seams.
- **The sampler** plays the whole score with the General MIDI sound bank that ships with macOS, `gs_instruments.dls`, with a large-hall reverb.
  As in MRT2's theme bars, only the melody sounds from middle C up.
  Its accompaniment follows the movement: piano arpeggios in eighths over held strings, then sixteenths over pizzicato strings, then held chords.
- **SA3** is Stable Audio 3 Medium with the SAME-L decoder, redrawing the sampler's audio from noise level 0.3 or 0.5, with a prompt that names the instruments, the key, and the tempo.
  It takes no notes: it keeps the score only by starting from the sampler's audio.
- MRT2 and SA3 played seeds 100 to 105; the sampler has no seed.

A first try on seed 100 chose the noise levels.
From 0.7, SA3 left the chords: 31% of the notes below middle C were on the bar's chord, against 92% at 0.5 and 96% at 0.3.

The comparison needed a new measure.
The pitch analysis hears a melody note that is an overtone of the bass, such as A4 over A2, as part of the bass.
So the theme test's share of the melody on the theme's note reads only 78% early in the note for the sampler, which plays every note exactly; it compares runs of one renderer, not renderers.
Here each beat's pitch classes are correlated with the sampler's, so 1.00 is the written score.

| Version            | Agrees with the score: theme bars / away bars | Loudness change at a bar line, dB: theme starts or stops / other | Silent | Render time for 57.6 s |
| ------------------ | --------------------------------------------- | ---------------------------------------------------------------- | ------ | ---------------------- |
| MRT2, theme only   | 0.37 / 0.03                                   | 4.0 / 2.8                                                        | 2.2%   | 17.1 s                 |
| MRT2, whole melody | 0.40 / 0.37                                   | 4.4 / 3.7                                                        | 2.6%   | 17.0 s                 |
| Sampler            | 1.00 / 1.00                                   | 0.4 / 0.7                                                        | 0%     | 1.0 s                  |
| SA3, noise 0.3     | 0.87 / 0.86                                   | 0.3 / 1.0                                                        | 0%     | 8.0 s                  |
| SA3, noise 0.5     | 0.70 / 0.78                                   | 1.0 / 1.3                                                        | 0%     | 8.6 s                  |

- **Agreement** is the mean over the seeds.
- **The loudness change** is measured as for the seams, over 1.5 s on each side, and is the median over the seeds and bar lines.
  MRT2 jumps by more than 10 dB at about one bar line in six, up to 41 dB, so a mean would follow those few.
  The two bar lines where the movement changes are in neither group.

What the numbers show:

- **MRT2 follows a given away line as closely as the theme:** its away bars agree 0.37 with the line, against 0.03 when free, and its theme bars 0.37 to 0.40.
  It agrees less than SA3 by design: it writes its own accompaniment within the notes it may play.
- **MRT2's seams are mostly its change from bar to bar.**
  On the Mac mini, its loudness changes across any bar line by a median 2.8 to 3.7 dB, and across the theme's by 4.0 to 4.4 dB.
  The sampler and SA3 change by 0.3 to 1.3 dB.
  Part of that calm is the sampler's arrangement, which is the same in every bar of a section, and which SA3 starts from.
- **Giving MRT2 the whole melody did not make its bar lines smoother.**
- **MRT2 still falls silent** 2.2% to 2.6% of the time, 9.6% in one seed, with the spine's silence guard.
- **SA3 keeps the score closest at noise 0.3:** it agrees 0.87 and 0.86, and changes across bar lines about as little as the sampler.
  At 0.5 it agrees 0.70 and 0.78.
- **All three are fast enough offline on the M6:** MRT2 renders 57.6 s in 17 s, one 40 ms frame at a time, 3.4 times faster than real time; SA3 in about 8 s, loading its models each time; the sampler in 1 s.
- **On the theme test's measure, MRT2 repeats October 20:** 84% and 85% of the melody on the theme's note early in the note, against 86% on the M2 Pro.

The numbers cannot say which version sounds better or more alive.
Everett listened the same day.
In his words, translated from Chinese: SA3 is more stable, and it sounds better.
He did not name a noise level.

- The sampler's General MIDI sounds are a floor; a good sample library would sound better.
- SA3 redraws a finished clip here; [SA3 in pieces](#sa3-in-pieces) renders it as a live player would.
- MRT2's notes follow the spine's allowed notes and the movement; the sampler's arrangement and the away line were written for this comparison.

The page is `outputs/renderers-2026-10-29/index.html`.
It plays the five versions of one seed in step: switching keeps the position, so the same bar can be heard in another renderer.
The script is local and not in Git: `work/renderers/compare.py`, with `sampler.swift` for the sampler and `serve.py`, which serves the page with byte ranges so that its audio can seek.
`outputs/renderers-2026-10-29/manifest.json` keeps the commands, timings, and versions.

### SA3 in pieces

Live, SA3 would render each piece of music while the one before it plays, not a whole clip at once.
So on October 29 the same score was rendered piece by piece, in pieces of 4 bars and of 1 bar, at noise 0.3 and 0.5, for seeds 100 to 105.

- **Each window** holds about 4.8 s of the music already rendered, then the piece and 0.56 s after it from the sampler's audio.
  SA3 keeps the rendered part, pasted back at every step, and redraws the rest from the sampler's audio at the noise level: the combination of inpainting and audio to audio that Stable Audio 3's Gradio app uses.
- **The piece is kept** and joined with a 40 ms crossfade; the 0.56 s after it is dropped.
  A join sits at the last latent before the bar line, up to 93 ms early.
- **Every window has the same length,** because the MLX model is built for one latent length.
  The first window has no music before it, so it redraws its whole length and keeps the pieces that fit.
- **The models are loaded once:** the prompt's encoding, the codec, and the DiT.

| Version           | Agrees with the score: theme bars / away bars | Loudness change at the joins, dB: pieces / one clip there | Dip at the joins, dB: pieces / one clip there | Render a window: median / slowest | Piece  |
| ----------------- | --------------------------------------------- | --------------------------------------------------------- | --------------------------------------------- | --------------------------------- | ------ |
| One clip, 0.3     | 0.87 / 0.86                                   | -                                                         | -                                             | -                                 | 57.6 s |
| 4-bar pieces, 0.3 | 0.84 / 0.84                                   | 1.0 / 0.7                                                 | 2.7 / 1.4                                     | 2.4 / 2.6 s                       | 9.6 s  |
| 1-bar pieces, 0.3 | 0.84 / 0.86                                   | 0.9 / 1.0                                                 | 1.3 / 1.2                                     | 1.5 / 1.5 s                       | 2.4 s  |
| One clip, 0.5     | 0.70 / 0.78                                   | -                                                         | -                                             | -                                 | 57.6 s |
| 4-bar pieces, 0.5 | 0.62 / 0.62                                   | 1.4 / 1.6                                                 | 2.1 / 3.4                                     | 2.4 / 4.0 s                       | 9.6 s  |
| 1-bar pieces, 0.5 | 0.43 / 0.41                                   | 2.6 / 1.4                                                 | 3.5 / 1.1                                     | 1.6 / 1.9 s                       | 2.4 s  |

- **The joins** are measured as the bar lines are, over 1.5 s on each side, and by a dip: how much quieter the 50 ms around the join are than the music on either side.
  Each is the median over the joins and seeds, next to the one clip measured at the same moments, where nothing joins.
- **The render times** leave out each clip's first window, which redraws more; the first window of all took 3.7 s, because it also loaded the DiT.

What the numbers show:

- **SA3 keeps up on the Mac mini:** a 4-bar window, 15 s of audio, renders in 2.2 to 4.0 s, for a piece of 9.6 s; a 1-bar window, 7.8 s, in 1.5 to 1.9 s, for a piece of 2.4 s.
  Nothing else was running; live, the camera and the browser share the machine.
- **At noise 0.3, the pieces measure like the one clip:** they agree 0.84 with the score against 0.87, and their loudness changes across the joins about as much as the one clip's at the same moments.
  The 4-bar joins dip 1.3 dB more.
- **At noise 0.5, 4-bar pieces hold, but 1-bar pieces drift:** they agree 0.43 with the score, and their loudness changes across the other bar lines by a median 2.8 dB, against 1.4 for the one clip.
  The likely cause is that with more noise, each short piece follows the music before it more than the sampler's audio, so the drift adds up from bar to bar.

On October 30 Everett chose noise 0.3; in his words, translated from Chinese: "0.3 is enough."
He did not say whether he heard the joins.
The page is `outputs/renderers-2026-10-29/pieces/index.html`: seven versions, with ticks above the bars where the pieces join.
`work/renderers/sa3_pieces.py` renders the pieces with Stable Audio 3's own Python, and `compare.py --pieces` measures them and writes the page; `raw/pieces-timings.json` keeps each window's timings.

### Offline tests before the live page

On October 30, after Everett chose noise 0.3, a plan was given for SA3 to play on this page in 1-bar pieces.
In it, the server decides each bar's score from the hands, the sampler plays the bar, SA3 redraws it in one window, and the 40 ms frames reach the browser as they do now.
Before building it, Everett chose to run three offline tests, all at noise 0.3 in 1-bar pieces, for seeds 100 to 105:

1. **Without the tail:** each window drew 0.56 s of the next bar after its piece, but live, the next bar is not yet decided.
2. **Faster:** a window took 1.5 s of the 2.4 s bar, so fewer steps, less music before each piece, and the small model were tried.
3. **Following the hands:** live, the score changes at a bar line when the hands move, so does SA3 change in that bar?

`sa3_pieces.py` gained an option for each, and `work/renderers/tests.py` renders test 3's score, measures all three, and writes one page with a tab for each: `outputs/renderers-2026-10-29/tests/index.html`.
A remote desktop session used the GPU during the runs, so windows took about a quarter longer than on October 29: 1.93 s instead of 1.49 s for October 29's setting, with the same audio bit for bit.
All the times below were measured on October 30.

#### Without the tail

| Version          | Agrees with the score: theme / away | Loudness change at the joins, dB: pieces / one clip there | Dip at the joins, dB: pieces / one clip there | Render a window |
| ---------------- | ----------------------------------- | --------------------------------------------------------- | --------------------------------------------- | --------------- |
| One clip         | 0.87 / 0.86                         | -                                                         | -                                             | -               |
| With the tail    | 0.84 / 0.86                         | 0.9 / 1.0                                                 | 1.3 / 1.2                                     | 1.94 s          |
| Without the tail | 0.80 / 0.85                         | 0.8 / 1.0                                                 | 6.4 / 1.2                                     | 1.90 s          |

- **Without the tail, every join dips:** the 50 ms around it are 6.4 dB quieter than the music on either side, against 1.3 dB with the tail.
- **The dip sits on the join:** averaged over the joins, the level falls 14.5 dB 10 ms before the join, and stays 3 dB down from 20 ms before it to 60 ms after.
  The one clip and the pieces with the tail dip only 3 to 4 dB just before each downbeat, where the notes of a bar end.
  This suggests that SA3 ends each window quietly when nothing follows it, and that the next window continues from that quiet.
- **So a live window needs a tail.**
  The next bar is not decided when a piece is drawn, so live, the tail must be a guess; test 3 tries one.
  Another way, not tried, is to let each window redraw the last latent or two of the piece before it, at the cost of up to 0.19 s more delay.

#### Faster

| Setting                           | Agrees with the score: theme / away | Loudness change at the joins, dB: pieces / one clip there | Dip at the joins, dB: pieces / one clip there | Window audio | Render a window: median / slowest | Paced, one window a bar |
| --------------------------------- | ----------------------------------- | --------------------------------------------------------- | --------------------------------------------- | ------------ | --------------------------------- | ----------------------- |
| 8 steps, 4.8 s before, as Oct. 29 | 0.84 / 0.86                         | 0.9 / 1.0                                                 | 1.3 / 1.2                                     | 7.8 s        | 1.94 / 1.97 s                     | 1.95 / 2.01 s           |
| 6 steps                           | 0.85 / 0.86                         | 0.9 / 1.0                                                 | 1.9 / 1.2                                     | 7.8 s        | 1.65 / 1.91 s                     | -                       |
| 4 steps                           | 0.87 / 0.90                         | 0.9 / 1.0                                                 | 1.5 / 1.2                                     | 7.8 s        | 1.20 / 1.24 s                     | 1.21 / 1.23 s           |
| 4 steps, 2.4 s before             | 0.88 / 0.89                         | 0.7 / 1.0                                                 | 0.5 / 1.2                                     | 5.4 s        | 0.94 / 1.00 s                     | -                       |
| Small model                       | 0.86 / 0.86                         | 1.2 / 1.0                                                 | 1.2 / 1.2                                     | 7.8 s        | 0.53 / 0.59 s                     | 0.56 / 0.57 s           |

- **The steps are most of a window's time.**
  Timed once with 84 latents, a window took 0.25 s to encode, 1.39 s for 8 steps, and 0.25 s to decode.
  So 4 steps save about 0.7 s, and 2.4 s of music before the piece instead of 4.8 s saves about 0.25 s more.
  Compiling the DiT with MLX saved about 5%, and was left out.
- **Fewer steps cost nothing that the measures find:** with 4 steps the pieces agree with the score a little more, and their joins change and dip about as much.
  With 4 steps and 2.4 s before each piece, a window takes 0.94 s, under half the bar, and its joins dip least, 0.5 dB.
- **The small model,** Stable Audio 3 Small-Music with its SAME-S decoder, takes 0.53 s a window and measures close to the Medium model.
- **Pacing one window a bar, as live, did not slow the windows.**
  The GPU idled 0.4 to 1.8 s between windows, and macOS did not lower its clock as it did for MRT2's 40 ms frames ([the GPU filler](#the-gpu-filler)).
  The remote desktop session also used the GPU, so this does not rule out a slowdown when nothing else does.
- **The measures do not judge the sound.**
  Agreement measures how close a version stays to the sampler, so a version that agrees more may also sound more like the sampler.
  Which settings sound good enough is for listening.

#### Following the hands

Test 3's score has the comparison's melody, chords, and form, but its accompaniment changes every two bars after the first four, as the hands would change it.
The texture and the register take turns:

- **The texture** goes from still to fast, as the activity would set it: still holds only the root and the fifth; slow, medium, and fast are the comparison's calmer, moderate, and livelier sections.
- **The register** moves the piano and the strings an octave down or up, as the height would set it.
  The high register also lifts the bass and the cellos an octave; the low one leaves them, since the bass cannot go lower.

A second render plays each bar as the bar before it: the score a bar late.
Live, the tail after a piece must guess the next bar, and the natural guess is that the hands stay where they are.
So for the guessed tails, the tail before each change comes from the late render, and is wrong there.

| Version              | Agrees with the score: theme / away | Density at texture changes: change bar / bar after | Loudness at texture changes: change bar / bar after | Register, by the bass: share of the score's / seeds where the same bar fits better | Dip at the joins, dB: pieces / one clip there |
| -------------------- | ----------------------------------- | -------------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------- |
| The score a bar late | 0.98 / 0.96                         | 0.05 / 0.98                                        | 0.04 / 0.99                                         | -25% / 0%                                                                          | -                                             |
| One clip             | 0.86 / 0.80                         | 1.14 / 0.98                                        | 1.03 / 0.97                                         | 84% / 67%                                                                          | -                                             |
| Pieces, tail known   | 0.84 / 0.79                         | 1.28 / 0.99                                        | 0.91 / 0.88                                         | 60% / 100%                                                                         | 1.5 / 1.8                                     |
| Pieces, tail guessed | 0.84 / 0.79                         | 1.32 / 1.00                                        | 0.95 / 0.91                                         | 64% / 100%                                                                         | 1.2 / 1.8                                     |
| Pieces, no tail      | 0.84 / 0.79                         | 1.36 / 1.09                                        | 0.98 / 0.94                                         | 50% / 100%                                                                         | 6.8 / 1.8                                     |

- **Density and loudness** are the project's steering features, averaged over each beat and taken relative to the bars on the same chord.
  At each of the five texture changes, the move from the bar before into the change bar, and into the bar after, is compared with the score's by least squares over the changes and seeds: 1.00 moves as far as the score.
- **The register is judged by the bass:** the share of each bar's power below 120 Hz.
  Each bar's share is fitted on its chord, its texture, and its register; the effect from low to high is compared with the score's, and the fit on the bar's own register with a fit on the register of the bar before.
  Bar by bar does not work for the register here: every register change falls on the change from F to C, which moves the bass by itself.

What the numbers show:

- **The texture changes in its own bar.**
  In the change bar, density moves 1.14 to 1.36 times as far as the score's, and loudness 0.91 to 1.03 times; the score played a bar late moves 0.05 and 0.04 there.
- **The register follows in its own bar too, but less.**
  The pieces keep 50% to 64% of the score's change in the bass from the low register to the high, and the one clip 84%; in every seed, the pieces fit their own bar's register better than the bar before's.
  The notes themselves may move less: by the mean pitch of the notes from C2 to F#4, the one clip and the pieces with a tail kept 14% to 36% of the score's move.
  But that measure gave the late score 75% and could not tell it from the score, so it cannot be trusted here.
- **The guessed tail costs nothing measurable.**
  The pieces follow the changes as they do with the known tail.
  At the 60 joins before a change, where the guess is wrong, their loudness change and dip differ from the one clip's by a median of 0.4 dB or less, as with the known tail.
- **Without the tail, the joins dip again,** 6.8 dB, as in test 1.

#### What the tests mean for the live plan

1. **Keep a tail, and guess it from the hands as they are.**
   It costs no delay, and a wrong guess before a change did no harm.
2. **Render with 4 steps and 2.4 s of music before each piece,** if it sounds as good: a window then takes about 1 s, so a bar can be decided about 1.6 s before it plays, with the 0.32 s browser buffer and 0.3 s to spare.
   A gesture then reaches the music in 1.6 to 4.0 s, 2.8 s on average, against 2.6 to 5.0 s with October 29's setting on the same machine; the volume still answers at once.
   The small model would take another 0.4 s off, if it sounds good enough.
3. **The register is heard less through SA3 than in the score.**
   If the height should be heard clearly, the score may need to move more than the accompaniment's octave, for example the melody's octave as well.
4. **Not yet tested:** a score that a live hand changes at any bar, register changes on other chords than F to C, and the windows' timing while the camera, hand tracking, and browser share the GPU.

The page is `outputs/renderers-2026-10-29/tests/index.html`, with a tab for each test; `work/renderers/tests.py` writes it, and `raw/pieces-timings.json` keeps each window's timings.

### The score variant

On November 1 Everett chose to build the live version; in his words, translated from Chinese: "start building."
`steered.html?variant=score` plays it.
Sway writes the score from the hands, a bar at a time, and SA3 plays it with the offline tests' choices: noise 0.3, 4 steps, 2.4 s of music before each bar, and a guessed tail.

Each bar is made in four steps:

1. **The score.**
   `src/sway/score.py` writes the bar from the hands as they are when the bar is decided, at the page's thresholds of 0.35 and 0.65.
   It keeps the comparison's score: a violin melody over piano, strings, cellos, and basses, on Night Drive's four chords.
   The theme plays four bars in every twelve, as on the theme variant, with the comparison's two away lines between.
   - **Activity sets the texture,** as test 3 changed it: stillness holds the chord's root and fifth and rests the melody; calm movement holds chords; flowing movement plays arpeggios in eighths; lively movement plays sixteenths over pizzicato strings and a bass in quarters.
   - **Height moves the melody, the piano, and the strings an octave down or up,** and high also lifts the bass and the cellos.
     The melody moves too, because test 3 heard the register less through SA3 than in the score.
   - **Spread opens the piano's harmony:** triads; then a seventh or a sixth from the pentatonic scale, as Am7, Fmaj7, C6, and G6; then the ninth as well.
2. **The sampler.**
   `src/sway/sampler.swift` plays the bar with the General MIDI bank that ships with macOS, in its own process.
   It plays from the downbeat of the bar before, so that notes and reverb ring on into the bar, to 0.56 s into the bar after, which it plays as if the hands stay where they are.
3. **SA3.**
   `src/sway/sa3_worker.py` runs in SA3's own Python, with the Medium model loaded once.
   One window holds 2.4 s of the music already played, kept, then the bar and the guessed 0.56 s from the sampler, redrawn from noise 0.3 in 4 steps.
4. **The join.**
   `src/sway/scored.py` crossfades the bar into the music over the 40 ms before its join, converts it from 44.1 to 48 kHz, and queues it for the page.
   The conversion is a windowed-sinc filter: up to 18 kHz its error is about -100 dB, and it removes the images above 22 kHz by about 85 dB.

How the bars keep time:

- A bar is decided when the music queued for the page falls to the slowest of the last four bars' render times, plus 0.3 s: about 1.3 s.
  The first bar after the first window is decided 0.3 s earlier still: by then the GPU has idled for about 3.5 s, and in the first take after the server started, that bar's window took 1.18 s against a median of 0.91 s.
- The page receives 40 ms frames, as from the other variants.
  The volume answers stillness at once, as on the spine: it falls to about a third while the hands are still, and comes back as soon as they move.
- If SA3 has not finished a bar when it is due, the sampler's bar plays instead, and the bar counts as late.
- The sampler and SA3 stay loaded from one take to the next.
  The first take after the server starts waits about 7 s for them: about 1 s to load SA3, 3 to 5 s to compile its windows, and 1 s for the first window.
- `&steps=`, `&context=` in seconds, `&model=small`, and `&noise=` change how SA3 renders; a value out of range keeps its default.
  For example, `steered.html?variant=score&steps=8&context=4.8` plays October 29's setting.
- SA3 is found in `~/Developer/stable-audio-3/optimized/mlx`, or where `SWAY_SA3_DIR` points.
  Only weights already on this Mac are loaded; nothing is downloaded.

One finding about the sampler: a reset of its audio engine leaves the reverb ringing, and a restart changes the sound, so that the same score played about 10 dB louder.
So before each request the sampler stops every note and renders 4 s of silence, which takes about 15 ms.
Its first render is then the same, sample for sample, as the comparison's offline sampler, and a request after notes starts below -110 dBFS.

#### Ten scripted minutes in headless Chrome

On November 1 headless Chrome played the page in two takes of five minutes, the page's limit.
Its fake camera played `work/finger-drumming.y4m`, so the page tracked real hands while it drew the stage and played the audio, as it would live.
A script in the page replaced the height, activity, and spread in every control that the page sent with a schedule: every 5 to 12 s, one or two of the three moved to another band, and now and then the hands were still.
A remote desktop session was connected throughout, as on October 30.
For about 30 s in the second take, the test suite also ran, with MRT2's real key test on the GPU.
The script, its log, and the results are in `outputs/score-2026-11-01/`.

| Take | Bars after the first window | Late | Frames with nothing to send | Browser underruns | Decided before the music ran out: median | SA3 window: median / slowest | Spare when SA3 finished: least / median |
| ---- | --------------------------- | ---- | --------------------------- | ----------------- | ---------------------------------------- | ---------------------------- | --------------------------------------- |
| 1    | 124                         | 0    | 0                           | 0                 | 1.26 s                                   | 0.91 / 1.18 s                | 0.02 / 0.30 s                           |
| 2    | 124                         | 0    | 0                           | 0                 | 1.27 s                                   | 0.90 / 1.20 s                | 0.07 / 0.30 s                           |

- **No bar was late, and no frame was missing,** in either take, and the browser's buffer did not run empty while a take played.
- **A bar was decided about 1.26 s before the music queued for the page ran out.**
  The sampler took about 0.05 s and SA3 about 0.91 s, so about 0.3 s was spare.
- **Only two bars came within 0.1 s of late.**
  One was the first bar after the first window, in the first take after the server started; the extra lead for that bar came from it, and was added after this run.
  The other came when the test suite started MRT2 on the GPU; the lead then grew to 1.57 s by itself, and no bar was late.
- **The page's hand tracking runs on the CPU,** so in the browser only the drawing of the stage shares the GPU with SA3.

From a change of the hands to its first bar in the browser, over 70 changes, took 1.5 to 4.1 s, with a median of 2.6 s and 3.6 s at the 90th percentile.
This counts from the change to the first stats message that names the new state for the bar being sent, plus the browser's queue of 0.12 to 0.17 s, so it is accurate to about 0.2 s.
The offline tests estimated 1.6 to 4.0 s with a browser buffer of 0.32 s; the buffer measured here is about half that.

After the run, the same code without the server or the browser played 100 s that move through every texture, register, and harmony, into `outputs/score-2026-11-01/live-probe-100s.wav`; none of its 41 bars was late.

Not yet done:

- Everett has not played or heard it.
- Whether 4 steps and 2.4 s sound as good as October 29's setting: `&steps=8&context=4.8` plays that one for comparison.
- A take with a real camera and a player's own hands; here, the hands that the server followed were scripted.

## The model thread

With mlx 0.31.2, once one thread has run MRT2, another thread fails with "There is no Stream(gpu, 1) in current thread".
The V1 page loads MRT2 as soon as it opens, so opening `/` and then the theremin page broke the theremin.
Every MRT2 engine in the server now runs on one thread, `music.MODEL_THREAD`.

## The GPU filler

A live stream renders one 40 ms frame at a time, so the GPU is idle for about half of each frame.
After about 25 seconds of that, macOS lowers the GPU clock until a frame takes about 42 ms, and the stream falls behind.
Measured outside the server and the browser on October 13:

| Rendering                                                          | Median time for each frame after 30 seconds |
| ------------------------------------------------------------------ | ------------------------------------------- |
| Back to back, for 90 seconds                                       | 19 ms                                       |
| One frame every 40 ms                                              | 42 ms, and it stays slow                    |
| One frame every 40 ms, with another process keeping the GPU busy   | 27 ms                                       |
| One frame every 40 ms, with filler in the whole gap                | 22 ms, for two minutes                      |
| One frame every 40 ms, with filler in half or a quarter of the gap | 39 ms                                       |

Spinning the CPU thread, `NSProcessInfo`'s latency-critical activity, and `taskpolicy -t 0 -l 0` did not help.
So between frames, the model thread runs small GPU matrix products until 4 ms before the next frame (`MusicEngine.keep_busy`).
This costs GPU power during a performance, so it suits a Mac on mains power better than one on battery.
The theremin page uses the same stream, so it gets the fix too.

In the server, with the V1 page opened first and a scripted mouse performance on this page for 162 seconds, frames took a median of 22 ms, and 25 ms or less 95% of the time.
The browser buffer ran empty twice, at 84 and 111 seconds; the test suite was running alongside at about the first.
Before the filler, the same performance ran empty nine times in its first 40 seconds.
