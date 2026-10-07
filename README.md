# Sway

**An instrument you play with your hands.**

Sway turns a laptop camera into an instrument.
One hand plays a melody, and the other hand leads a band.
You need no musical training: Sway keeps every note in time and in key, so nothing you play sounds wrong.
Generative models play in the band, but your own notes never wait for a model or the network.

> **Status:** V1 is playable on an Apple Silicon Mac, and it is still in early testing.
> There is no release yet.
> The [project status](docs/project-status.md) says where the work stands and what comes next.

## How it plays

| Hand      | Movement                      | Result                                                     |
| --------- | ----------------------------- | ---------------------------------------------------------- |
| Lead hand | Hand height                   | Picks a note on a ladder of ten notes in A minor.          |
| Lead hand | Pinch thumb and index         | Plays the note, and holding the pinch holds it.            |
| Lead hand | Move up or down while pinched | Draws a melody from note to note.                          |
| Lead hand | Pinch quickly or gently       | Plays a louder, brighter note or a softer one.             |
| Lead hand | Lean toward the camera        | Swells a held note.                                        |
| Band hand | Hand height                   | Sets the band's energy, from a quiet pad to the full band. |
| Band hand | Fist                          | Cuts the band, and opening the hand brings it back.        |
| Band hand | Pinch and hold                | Loops the last four bars you played.                       |
| Both      | Hold two fists                | Ends the piece.                                            |

The right hand leads by default, and a setting swaps the roles.
Without a camera, the mouse plays the lead: its height picks the note, and a click plays it.
Keys 1 to 5 set the energy, and holding Space cuts the band, holding L loops, and holding E ends the piece.

At the end of a piece, you can save its audio, its MIDI, and a performance file.

## The band

The band is generative, and it follows the energy you set.

- **Harmony:** [Magenta RealTime 2](https://github.com/magenta/magenta-realtime) (MRT2), a real-time music model, runs on the same Mac and plays the chords as strings, piano, or choir.
- **Composer:** [Qwen](https://www.alibabacloud.com/help/en/model-studio/text-generation), in the cloud, can write the band's next four bars while the current four play.
  It writes from the energy you set and the notes you just played.
- **Engine:** Sway checks every plan from a model and keeps it in key and on the beat.
  If a model is late, the built-in band plays instead, so the music never stops.

The lead, the drums, and the bass are synthesized in the browser.
Both models are optional, and Sway plays without them.

## Requirements

- A Mac with Apple Silicon.
- [uv](https://docs.astral.sh/uv/), which installs Python 3.12 for Sway.
- Node.js and npm.
- A recent version of Chrome.
- About 1 GB of disk space for MRT2.
- For the composer only: a [DashScope](https://www.alibabacloud.com/help/en/model-studio/get-api-key) API key.

## Install

```bash
git clone https://github.com/Audiofool934/sway.git
cd sway
uv sync --locked
uv run --locked sway setup
uv run --locked sway doctor
```

`sway setup` downloads hand tracking, the browser dependencies, and MRT2.
To skip MRT2, use `sway setup --instrument-only`.
Sway then plays a synthesized pad for the harmony.

`sway doctor` checks the setup and shows whether the composer is configured.

### Optional: the composer

To let Qwen compose the band, put your DashScope API key in `~/.config/sway/qwen.json`:

```json
{ "api_key": "your-dashscope-key", "region": "singapore" }
```

Use `"region": "beijing"` for a key from the China mainland console.
The file must be private:

```bash
chmod 600 ~/.config/sway/qwen.json
```

## Play

```bash
uv run --locked sway serve
```

1. Open **http://127.0.0.1:8765** in Chrome.
2. Turn the camera on.
3. Press **Learn to play** for setup and short lessons, or **Start playing** to go straight to a piece.

On the start screen, **Harmony** picks the sound of the chords, and **Band** picks the Qwen composer or the built-in patterns.
While you play, press D to see tracking and timing measurements.
In free play, press M to open a mixer that compares the band's parts.
Stop the server with Ctrl-C.

## Privacy

- The server listens only on your own machine.
- Hand tracking runs in the browser, and camera images never leave your machine.
- When Qwen composes, Sway sends it musical data only: the energy, the chords, and the notes you just played.
- The Qwen key stays in the server process, outside the repository and the browser.

## Experiment: the generative theremin

A second page, **http://127.0.0.1:8765/theremin.html**, tests a different idea.
Your hands shape MRT2's sound directly, with no band and no composer.
It needs MRT2, its interface is in Chinese, and the mouse also works.
The [experiment guide](docs/generative-theremin-experiment.md) describes it.

## Documentation

| Document                                 | Read it for                                                 |
| ---------------------------------------- | ----------------------------------------------------------- |
| [Manual](docs/manual.md)                 | How Sway works, and the music and audio ideas behind it.    |
| [V1 plan](docs/v1-plan.md)               | The design of the instrument, and why each choice was made. |
| [Project status](docs/project-status.md) | Where the work stands and what comes next.                  |
| [V1 readiness](docs/v1-readiness.md)     | The checks done so far, and the play tests still open.      |
| [Development](docs/development.md)       | The source map, the checks, and where local data lives.     |

## Development

```bash
uv run --locked pytest -q
node --test tests/*.test.js
uv run --locked ruff check src tests
uv run --locked ruff format --check src tests
node_modules/.bin/prettier --check 'web/*.{js,css,html}' 'web/instrument/*.{js,css}'
git diff --check
```

[CI](.github/workflows/ci.yml) runs these checks on Linux for every pull request and every push to `main`.
The test that needs MRT2 skips there.
The tests check timing, harmony, tracking, and controls.
They do not show how the music sounds or how the instrument feels to play.

## Credits and license

Sway uses [MediaPipe](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker/web_js) for hand tracking, [Magenta RealTime 2](https://github.com/magenta/magenta-realtime) for the harmony, and [Qwen](https://www.alibabacloud.com/help/en/model-studio/text-generation) for the composer.
The [third-party notices](THIRD_PARTY_NOTICES.md) give their attribution and licenses.

No license has been chosen yet for the original Sway code.
