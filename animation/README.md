# Between Hand and Sound

A 3 minute 41 second animated history of the machines between a plucked string and an instrument you play with your hands.
Sway is a generative instrument.
This film explains where its parts come from, and the picture and the music are both made from code.

The film tells the history as a chain of re-representations.
Sound became a ratio, then a mark on a page, then holes in paper, then a groove, then a voltage, then a list of numbers, then messages, then layers in a studio on a laptop, and finally something software can play for you.
One short tune in A minor, the key of Sway's own band, is re-performed on each era's technology, so you can hear the material change while the music stays the same.
A single line is the same object in every scene: a string, a quill stroke, a groove, a wave, a playhead, a trail left by a fingertip.
The last chapter is Sway itself, played by its real synthesizer and band.

The finished film is [`between-hand-and-sound.mp4`](between-hand-and-sound.mp4) in this folder (1920 x 1080, 30 fps, stereo AAC, 33 MB), and you can rebuild it as described below.

## Chapters

| Bars | Chapter   | Time        | Era                                | What it shows                                                                        |
| ---- | --------- | ----------- | ---------------------------------- | ------------------------------------------------------------------------------------ |
| 8    | Vibrate   | 0:00 - 0:19 | c. 500 BCE, ancient Greece         | A monochord: halve the string, double the pitch. Pitch is a ratio.                   |
| 6    | Write     | 0:19 - 0:34 | c. 1025, Guido of Arezzo and after | Staff notation, solfège, and the later mnemonic hand.                                |
| 6    | Repeat    | 0:34 - 0:48 | 9th century - 1904                 | A pinned cylinder, then a punched paper roll played by a Welte-Mignon.               |
| 8    | Record    | 0:48 - 1:07 | 1857 - 1948                        | A wobbling line, a wax cylinder, then tape that can be cut, looped, and reversed.    |
| 8    | Electrify | 1:07 - 1:26 | 1920 - 1935                        | The theremin and the Hammond organ's nine drawbars: Fourier in a wooden box.         |
| 4    | Control   | 1:26 - 1:36 | 1964, Moog and Buchla              | Voltage control: one volt per octave turns a melody into a staircase.                |
| 8    | Count     | 1:36 - 1:55 | 1957 - 1982                        | Sampling, bit depth, the Nyquist limit, and a spectrum you can edit.                 |
| 8    | Connect   | 1:55 - 2:14 | 1980 - 1988                        | The TR-808 grid, the MIDI message, and the sampler.                                  |
| 8    | Assemble  | 2:14 - 2:34 | 1989 - 2004                        | A digital audio workstation, built from every earlier machine, then a hard stop.     |
| 8    | Delegate  | 2:34 - 2:53 | 1957 - today                       | Software that supplies harmony, timing, arrangement, and sound. One box stays empty. |
| 16   | Play      | 2:53 - 3:31 | 2026, Sway                         | Two hands, a ladder of pitches, a band that follows, and a loop you capture.         |
| 4    | End       | 3:31 - 3:41 |                                    | The chord resolves; the verbs light up in order.                                     |

The film runs at 100 BPM for 92 bars.
Every chapter starts on a bar line, so a cut in the picture lands on a downbeat in the music.

## How it is made

Everything is generated; there are no recorded samples, stock footage, or stock music.

- **Picture.** Each chapter is a pure function of its local time, drawn with Canvas 2D in a Chromium page (`src/scenes/`).
  A compositor (`src/film.js`) slides each chapter in as a sheet of cut paper and morphs the single line between scenes.
  The hands are a stylized model driven by 21 MediaPipe-indexed landmarks, the same layout Sway tracks.
  `tools/render.mjs` steps the page frame by frame in four headless browsers and pipes PNGs to ffmpeg.
- **Sound, chapters 1 to 10.** `audio/` is a small synthesis library in plain Node: filters, a Moog-style ladder, a feedback-delay reverb, a compressor, a lookahead limiter, and an instrument per era.
  There are additive strings, a pipe organ, a music box, a piano and pianola with inharmonic overtones, a theremin, a tonewheel organ, a subtractive synth, FM keys, and 808-style drums.
  Each era is also processed like its medium: the wax cylinder is band-limited, saturated, and crackly, and the tape stem has a head bump, wow, flutter, hiss, and a tape stop.
  The Count chapter lowers the sample rate and bit depth on purpose, then restores them.
- **Sound, chapter 11.** `audio/finale.mjs` renders the Play chapter with Sway's own `Synth`, `bandStep`, and `Looper` from `web/instrument/`, in an offline audio context in headless Chromium.
  `audio/finale-page.js` repeats the scheduling in `web/instrument/engine.js` (swing, energy changes on downbeats, loop capture, the choke-and-resolve ending) and takes its performance from a script instead of a camera.
- **One clock.** `src/timeline.js` defines the bars, and `src/score.js` holds the tune and the cue sheets the picture and the soundtrack share, so a drawbar moves when its chord starts and a step lights when its drum hits.
  `audio/master.mjs` balances the chapters (the film opens quietly and builds), mixes in the finale, and normalizes the whole to -17 LUFS integrated with a -1 dBFS ceiling.

## Rebuild it

You need Node.js 20 or later, `ffmpeg`, and Chrome (or set `SWAY_CHROME` to a Chromium executable).

```bash
cd animation
npm install
npm run build             # the four steps below, in order
```

The steps, one at a time:

```bash
node audio/render.mjs     # chapters 1-10 -> out/eras.wav
node audio/finale.mjs     # the finale, played by Sway's synth -> out/finale.wav
node audio/master.mjs     # balance and mix -> out/soundtrack.wav, .m4a, and .ogg
node tools/render.mjs     # picture and sound -> out/between-hand-and-sound.mp4
```

Rendering takes about 7 minutes for the picture and about a minute and a half for the sound on four cores.
The chapters' audio and every frame of the picture come out the same each time.
The finale is rendered by a browser's audio engine, so two runs agree to floating-point rounding but their files can differ in the last bit.

To change only the music, rebuild the soundtrack and swap it into the finished film without redrawing a frame:

```bash
npm run audio
ffmpeg -i out/between-hand-and-sound.mp4 -i out/soundtrack.wav -map 0:v -map 1:a \
  -c:v copy -c:a aac -b:a 192k -t 220.8 -movflags +faststart out/remuxed.mp4
```

Other tools:

- `npm run serve` serves a live preview at `http://127.0.0.1:8766/animation/index.html`; hover for play and a scrubber.
- `node tools/still.mjs 12.5 80` writes full-size frames at those times to `out/stills/`.
- `node tools/still.mjs --sheet 48:67 --count 6 --cols 2` tiles frames from a range into one contact sheet.
- `node tools/render.mjs --from 3600 --to 3780 --scale 0.5` renders a short, small test cut.
- `out/` is ignored by Git; the finished film above is the one file kept in the repository.

## Facts the film relies on

Dates and attributions were checked against sources, and the captions say "tradition credits" or "later" where the record is uncertain.

- The monochord and the octave ratio 2:1 are attributed to Pythagoras by tradition, not by surviving evidence.
- Guido of Arezzo's _Micrologus_ (about 1025) describes staff-based teaching and solmization; the mnemonic hand appears in later teaching and is not shown to be his.
- Banu Musa's 9th-century treatise describes a pinned-cylinder automatic flute; the Welte-Mignon reproducing piano dates from 1904.
- Scott's phonautograph (1857) recorded sound as a line; its 1860 recordings were first played back in 2008.
  Edison's phonograph is 1877.
- Ampex's Model 200, the first professional tape recorder in the United States, appeared in 1948.
  Les Paul used an Ampex machine for sound-on-sound recording in 1948 and 1949, and his Ampex eight-track followed in 1957.
  Schaeffer's first musique concrète pieces, also from 1948, were made with discs and their looping lock-grooves.
- The theremin was demonstrated in 1920 and the Hammond organ's nine drawbars date from 1935.
- Moog's voltage-controlled modules use one volt per octave (1964); _Switched-On Bach_ is 1968.
- Max Mathews's MUSIC program at Bell Labs dates from 1957; the Nyquist-Shannon sampling theorem is the film's rule for "often enough"; the Compact Disc used 44.1 kHz and 16 bits in 1982.
- The Roland TR-808 is from 1980, MIDI from August 1983, and the Akai MPC60 from 1988.
- Cubase (1989), Pro Tools (1991), VST (1996), Ableton Live (2001), and GarageBand (2004) stand for the workstation.
- The Illiac Suite (1957), Eno's _Music for Airports_ (1978, tape loops of different lengths), and Magenta RealTime (2025) stand for generative music.

## Limits

- The soundtrack was checked by measurement: spectrograms, loudness (integrated -17.0 LUFS, true peak -1.7 dBFS in the finished file, measured with ffmpeg), click and DC detection, and pitch and chroma analysis.
  Sync was checked on the finished file by comparing audio onsets with lit drum steps and lit piano keys, which agree to within one frame.
  The film has not been listened to on speakers or headphones, so mix balance and taste still need a listen.
- The history is a path through the story, not a complete account: it follows Western and technological lines and leaves out most of the world's music.
- The fonts (Fraunces, DM Sans, IBM Plex Mono) are bundled under the SIL Open Font License; see `assets/fonts` and [third-party notices](../THIRD_PARTY_NOTICES.md).
