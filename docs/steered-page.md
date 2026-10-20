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

End the take to save it as a WAV file.
Escape also ends it, and a take stops after five minutes.

## How it works

- `web/steered-controls.js` turns the hands into height, activity, and spread, each from 0 to 1.
  Activity below 0.05 is stillness.
- `src/sway/steered.py` plays V2's spine (`steering.Spine`), one 40 ms frame for each control.
  `?variant=free` plays the page as it was on October 14, without the spine, for comparison (`steering.Live`).
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
