# Steered page

Started: October 13, 2026, Asia/Singapore.
This page plays the steered design from the [motion-to-music note](motion-to-music.md) with the hands.
The hands steer the direction of the music, and MRT2 writes every note.

## Play

Run `uv run --locked sway serve` and open `http://127.0.0.1:8765/steered.html` in Chrome.
Choose the camera or the mouse on the page.
The sound is generated on this Mac, and the camera image stays on this Mac.

| Movement                                       | What the music does                                                                      |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Raise or lower the hands                       | It moves to a higher or a lower register.                                                |
| Move more, or less                             | Quick, wide movement makes it lively; slow movement keeps it calm.                       |
| Spread the hands apart                         | Close hands keep the melody on the A minor triad; wide hands open it to the whole scale. |
| Hold still, close the hands, or leave the view | It rests after about 0.65 seconds, and fades out. Moving again continues it.             |

With one hand, its left-to-right position sets the spread.
With the mouse, hold the stage and move: height sets the register, left to right sets the spread, and speed sets the energy.
The music follows a movement within a second or two; Everett accepted this latency on October 13.

End the take to save it as a WAV file.
Escape also ends it, and a take stops after five minutes.

## How it works

- `web/steered-controls.js` turns the hands into height, activity, and spread, each from 0 to 1.
  Activity below 0.05 is stillness.
- `src/sway/steered.py` plays `steering.Steered` with the fade on stillness from the speed run, one 40 ms frame for each control.
- `src/sway/stream.py` and `web/stream-page.js` are shared with the theremin page: one window at a time, the camera, streamed audio, and recording.
- The page plays the model's output without its own gain or filter, so what is heard is what the model wrote.

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
