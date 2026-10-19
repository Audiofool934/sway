# Steered page

Started: October 13, 2026, Asia/Singapore.
This page plays the steered design from the [motion-to-music note](motion-to-music.md) with the hands.
The hands steer the direction of the music, and MRT2 writes every note.
On October 14, after playing it with his hands and the camera, Everett said it does feel like leading the music.

## Play

Run `uv run --locked sway serve` and open `http://127.0.0.1:8765/steered.html` in Chrome.
Choose the camera or the mouse on the page.
The sound is generated on this Mac, and the camera image stays on this Mac.

| Movement                                       | What the music does                                                                      |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Raise or lower the hands                       | It moves to a higher or a lower register.                                                |
| Move more, or less                             | Quick, wide movement makes it lively; slow movement keeps it calm.                       |
| Spread the hands apart                         | Close hands keep the melody on the A minor triad; wide hands open it to the whole scale. |
| Hold still, close the hands, or leave the view | After about 0.65 seconds it thins to a quiet chord. Moving again grows it back.          |

With one hand, its left-to-right position sets the spread.
With the mouse, hold the stage and move: height sets the register, left to right sets the spread, and speed sets the energy.
The music follows a movement within a second or two; Everett accepted this latency on October 13.

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
On October 20, Everett chose the clip with the spine as the more continuous one in all six pairs; with no preference, that happens once in 64 tries.
The clips without the spine fall silent when the hands rest, which is an obvious cue, so this shows that the largest seam is gone, not yet that the music feels like one piece while it plays.
The answers are in `outputs/continuity-2026-10-19/listening-results-2026-10-20.json`.

### Texture

On October 20, Everett played the spine and still heard "individual piano fragments", with transitions that are not blank, even with a steady motion; the note rate sped up and slowed down.
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
The clips are in `outputs/fragments-2026-10-20/`.

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
