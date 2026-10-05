# Sway

**An instrument you play with your hands.**

Development resumed on September 28, 2026 with a first-principles redesign.
The [V1 plan](docs/v1-plan.md) defines the instrument, the rules it is built by, and the milestones.
The [documentation index](docs/README.md) separates current guides from the paused experiments that came before.

Someone with no musical training should be able to make a piece they want to keep.
One hand plays a melody on a pitch ladder, with quicker pinches making stronger notes and leaning toward the camera swelling a held note.
The other hand sets the band's energy, cuts it, and loops what was played.
Sway keeps every note in time and in key, and the notes you play are synthesized in the browser, so no network request or large model sits between a gesture and its sound.
The band is generative: Qwen writes its next four bars while the current four play, from what you just played and the energy you set, and MRT2, a music model running on the same Mac, performs the harmony and Qwen's answering lines.
The engine checks every plan and keeps it in key and on the beat, and the built-in band steps in whenever a model is late.
V1 is playable and has had its first test with real hands.
The current candidate adds expressive lead controls, a listening mixer, and a matching tutorial and manual.
The [readiness record](docs/v1-readiness.md) tracks the checks and remaining play tests.

## Play

On the configured development Mac:

```bash
cd ~/Projects/sway
uv run --locked sway serve
```

Open **http://127.0.0.1:8765** in Chrome, turn the camera on, and press **Learn to play** for setup and short lessons, or **Start playing** to go straight to a piece.
The camera tutorial includes expression practice; without a camera, it teaches the four core lessons with the mouse and keyboard.
**Leave lesson** returns to free play at any time.
The mirrored camera keeps your body, hands, and room visible for a sense of space.
Subtle hand skeletons and small fingertip markers show which hand controls each part of the instrument.
Without a camera, the mouse plays the lead and the keyboard steers the band; the start screen lists the keys.
Two fists or **End piece** finish a piece, which offers its audio, MIDI, and a performance file to save.
The **Harmony** setting on the start screen picks generated strings, piano, or choir, or the synthesized pad; a chip at the top lights while the generated harmony is playing.
**Band** chooses whether Qwen composes the band's cycles or the built-in patterns play; while a composed cycle plays, "by Qwen" shows under the beat and its caption appears at the bottom.
Qwen needs a DashScope API key in `~/.config/sway/qwen.json`, and `sway doctor` shows whether it is configured; only musical data is sent to it, never camera images.
Press D while playing to see measured tracking, audio timing, and how many bars were generated.
Press M during free play to compare the band's parts in the listening mixer.
Closing it restores the full mix; its extra comparison voices run only while it is open.
Stop the server with Ctrl-C when finished.

The separate [generative theremin experiment](docs/generative-theremin-experiment.md) is at **http://127.0.0.1:8765/theremin.html**.
It explores continuous hand control of MRT2's generated sound through sustained movement, short strokes, and rests.
Either hand can play, and pointer input is also available.

For a fresh checkout, use an Apple Silicon Mac, Python 3.12 through [uv](https://docs.astral.sh/uv/), Node.js/npm, and a recent Chrome browser:

```bash
git clone https://github.com/Audiofool934/sway.git
cd sway
uv sync --locked
uv run --locked sway setup --music-only
uv run --locked sway doctor
```

`--music-only` installs hand tracking, browser dependencies, and MRT2 for the generated harmony.
`--instrument-only` skips MRT2, and V1 then plays its synthesized pad; plain `sway setup` adds the optional local vision-language model used by the legacy pages.

## Earlier experiments

The paused prototypes remain available for comparison.

| Page             | Pipeline                                                                                            | Status                                                                               |
| ---------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `/ensemble.html` | MediaPipe observations and camera images → Qwen3.8-Max → arrangement and musical clock → MRT2 audio | Superseded by V1; the [ensemble guide](docs/gesture-ensemble.md) records its limits. |
| `/flow.html`     | Saved passage → local playback and hand controls → optional DEMON variations on Colab               | Retained experiment; the [Flow guide](docs/flow-mode.md) describes it.               |

In the ensemble prototype, a gesture took roughly 8 to 14 seconds to change what was heard, all parts came out as one stereo mix, and drumming could be read as strumming.
The [project status](docs/project-status.md) records that prototype's state at the pause.
The [first-play guide](docs/morning-test.md) explains how to run it, and it needs `sway setup --music-only` and a configured Qwen credential.

## Data and compute

The server listens on loopback.
In the V1 instrument, tracking and sound run in the browser, and camera images never leave the machine.
When Qwen composes the band, the server sends it musical data only: the energy, the chords, and the notes just played.
In the legacy ensemble page, Qwen mode sends selected camera images and motion observations to Alibaba; recordings contain generated audio only.
The Qwen credential stays in backend configuration outside the repository and browser.
Colab receives musical controls or Flow source audio, depending on the mode, without camera images or the Qwen key.

Models, recordings, generated passages, and experiment outputs are ignored by Git and remain on the development machine.
A clone does not include them.
See [data locations](docs/development.md#data-and-evidence) before moving or archiving the checkout.

The [cloud guide](docs/cloud-setup.md) covers the legacy pages' bounded MRT2 and DEMON sessions, setup, and release verification.

## Development

```bash
uv run --locked pytest -q
node --test tests/*.test.js
uv run --locked ruff check src tests scripts
uv run --locked ruff format --check src tests scripts
node_modules/.bin/prettier --check 'web/*.{js,css,html}' 'web/instrument/*.{js,css}'
git diff --check
```

[CI](.github/workflows/ci.yml) runs the same checks on Linux for every pull request and every push to `main`; the test that needs MRT2's model skips there.
The JavaScript tests cover the V1 instrument's timing, harmony, hand tracking, controls, band, looper, camera, engine, generated harmony scheduling, exports, and lessons.
These checks do not establish musical quality, recognition accuracy, or how the instrument feels to play.
The [development guide](docs/development.md) maps the source, runtime, and evidence locations.

## Models and attribution

V1 uses MediaPipe to track hands, synthesizes its lead and rhythm in the browser, and can use local MRT2 for harmony and cloud Qwen for composition.
The legacy pages also use the models noted below.

- [Magenta RealTime 2](https://github.com/magenta/magenta-realtime): generated harmony in V1 and continuous generation in the legacy pages.
- [Qwen](https://www.alibabacloud.com/help/en/model-studio/vision): V1's musical composer and the legacy ensemble's visual interpretation.
- [MediaPipe](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker/web_js): browser hand and pose tracking, used by V1 and the legacy pages.
- [DEMON](https://github.com/daydreamlive/DEMON): experimental Flow generation and source transformation on Colab.
- [Qwen3.5-0.8B via MLX Community](https://huggingface.co/mlx-community/Qwen3.5-0.8B-4bit): optional local interpretation for the older comparison mode.

See [third-party notices](THIRD_PARTY_NOTICES.md) for attribution and model licensing references.
No license for original Sway code has been selected.
