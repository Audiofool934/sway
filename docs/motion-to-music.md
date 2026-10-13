# Motion to music

Started: October 7, 2026, Asia/Singapore.
Status: first measurements done on October 7; Everett took the listening test on October 13.

## The problem

After several sessions with V1 and the generative theremin, Everett could not tell how his movements changed the music.
V1's band felt pre-rendered.
The theremin felt like a synthesizer that imitates a theremin.
In his words, it is "motion as music instead of motion to music".
The hands should guide the lead, not play its main notes.
They should change the direction of the generated music, and the model should write its theme and motive.

The code agrees.
The theremin marks every pitch "off" in every 40 ms frame and turns on only the one to three pitches that the hand chose ([theremin.py](../src/sway/theremin.py)).
MRT2 never chooses a note; it only gives those notes a sound.
In V1, the band's drums, bass, keys, and arpeggio are fixed patterns for five energy levels.
Qwen picks four chords every four bars, and MRT2 renders exactly those chords ([harmony.py](../src/sway/harmony.py)).

## Two axes

- **Influence:** how much the music changes when only the movement changes.
- **Freedom:** how much the music changes when only the model's random choices change, with the same movement.

|                | Low model freedom                       | High model freedom                                  |
| -------------- | --------------------------------------- | --------------------------------------------------- |
| High influence | Theremin and V1's lead: motion as music | The goal: motion to music                           |
| Low influence  | V1's band: a backing track              | September's ensemble: a jukebox steered 8-14 s late |

Each prototype fixed the last one's problem by giving up the other axis.
September's ensemble generated freely, but the player could not steer it.
V1 restricted the model to get control and stability back, and the theremin restricted it further.

## Who decides what

Every musical attribute is decided by the hand, by the model, or by a fixed rule.
Motion to music splits them:

- **Direction belongs to the hand:** register and contour, how busy the line is, intensity, harmonic tension, and when to build and when to rest.
- **Content belongs to the model:** the exact notes and rhythms, the motive, and how it develops.

## Measurements

MRT2's state can be copied and continued more than once, and a continuation with the same seed reproduces the same audio exactly.
So two runs can start from one moment of music and differ in only one thing.

Each test starts from the same moment, after six seconds of music, and runs two opposite movements for six seconds, once for each of six seeds.
The audio is measured in 0.25-second windows:

- loudness;
- brightness, the spectral centroid;
- register, the mean pitch of the notes found;
- tension, the share of the notes' energy off the A minor triad;
- density, the spectral flux: how much new sound arrives, which grows with the number and speed of notes;
- the notes themselves, as pitch-class shares over one second.

| Measurement  | Question                                                                                    |
| ------------ | ------------------------------------------------------------------------------------------- |
| Influence    | With the same seed, how far apart do the two movements take the music?                      |
| Freedom      | With the same movement, how far apart do different seeds take it?                           |
| Share        | Influence divided by influence plus freedom: how much of the variation belongs to the hand. |
| Consistency  | In what fraction of seeds does the movement push the attribute the expected way?            |
| Effect       | How far the movement moves the attribute, in units of the seeds' spread.                    |
| Response     | How soon the movement's effect rises above the seeds' spread, held for 0.15 s.              |
| Half time    | How soon the movement's effect reaches half its settled size, held for 0.15 s.              |
| Note freedom | How different the notes are between seeds: 0 is the same notes, 1 is none in common.        |

| Test     | Movement a            | Movement b       | Attribute | Expected           |
| -------- | --------------------- | ---------------- | --------- | ------------------ |
| Register | The hand rises        | The hand sinks   | Register  | a is higher        |
| Density  | The hands move a lot  | They move little | Density   | a is busier        |
| Harmony  | The hands spread wide | They come close  | Tension   | a has more tension |
| Rest     | The hands hold still  | They keep moving | Loudness  | a is quieter       |

A good instrument shows a high share, high consistency, and a fast response for direction, and clearly non-zero note freedom.

One listening test turns the complaint into a measurement.
The listener hears two clips from the same moment and the same seed, one for each movement, and picks the one that matches a described movement.
If the listener cannot pick it more often than chance, the movement does not audibly steer the music.
Each run writes this test as `listening-test.html` next to its clips.

## The variants

| Variant  | Height                                       | Activity                    | Spread                                               | Stillness           |
| -------- | -------------------------------------------- | --------------------------- | ---------------------------------------------------- | ------------------- |
| Theremin | Picks the note                               | Energy, and plucked strokes | Adds a lower octave and a third, and moves the style | Releases the note   |
| Window   | Centres a window of notes the model may play | Style from calm to lively   | Style from dark to bright                            | Silences every note |
| Steered  | Style from a low register to a high one      | Style from calm to lively   | Opens the harmony from triad to scale                | Silences every note |

- **Theremin** is today's renderer, driven by a script that follows the page's own mapping in [theremin-controls.js](../web/theremin-controls.js).
- **Window** is the design proposed on October 7: the model writes a solo piano lead in A minor, and height decides where it may play.
- **Steered** is the revision after the findings below. It uses only handles that MRT2 was measured to follow.
  Spread allows the A minor triad's pitch classes when the hands are close, the pentatonic scale in between, and the whole scale when they are wide.

The code is [steering.py](../src/sway/steering.py), and `uv run --locked python -m sway.steering --out <folder>` runs it.

## Findings before the measurement

- **MRT2 needs a prompt that asks for activity.**
  With notes left free, "Expressive solo piano improvisation, flowing melodic lines" kept playing, and "a slow lyrical melody of single long notes" faded to silence within two seconds.
  Every style description therefore asks for an improvisation.
- **MRT2 obeys silenced pitch classes.**
  With the other pitch classes silenced, 94-99% of the notes' energy stayed on the A minor scale, its pentatonic scale, or even only its triad.
- **MRT2 does not obey silenced octaves.**
  With a 12-semitone window placed high or low, only 11-55% of the notes' energy stayed inside it, and guidance from 1 to 5 did not help.
  A first check had found 96-100%, but only because that window covered the middle of the keyboard, where the music already was.
  The window design was kept in the measurement to record this.
- **Words in the style move the register.**
  "In a high register" placed the music around MIDI 70-73, and "in a low register" around 50-51, in three of three seeds.
- **A held theremin note fades.**
  In one pilot run, a hand that kept moving at one height lost about 28 dB over four seconds, because nothing re-strikes the held note.
- **The model is fast enough on its own.**
  With nothing else running, MRT2 renders a frame in about 22 ms of its 40 ms.

## Results

The run on October 7 used six seeds from one moment of music.
Each cell gives the consistency, the effect, and the half time of the test's own attribute.
"No reliable effect" means a consistency of 50% or less, or an effect under 0.5.

| Movement                 | Theremin           | Window             | Steered           |
| ------------------------ | ------------------ | ------------------ | ----------------- |
| Height, register         | 83%, 2.2, 0.12 s   | 67%, 0.9, 0.78 s   | 83%, 1.4, 1.23 s  |
| Activity, density        | 67%, 0.9, 0.12 s   | 67%, 1.4, 2.83 s   | 100%, 1.9, 2.33 s |
| Spread, harmonic tension | No reliable effect | No reliable effect | 100%, 2.6, 1.68 s |
| Stillness, loudness      | No reliable effect | 83%, 1.9, 2.93 s   | 100%, 1.9, 1.83 s |
| Note freedom             | 0.06-0.35          | 0.46-0.55          | 0.43-0.66         |

`outputs/motion-to-music-2026-10-07/summary.md` has every measurement, and `results.json` has every attribute.

- **Steered is the first version in the goal's corner.**
  Each movement moved its attribute the expected way in at least five of six seeds, and harmony, density, and rest did so in all six.
  Meanwhile the model chose different notes in every seed.
- **Steered is too slow.**
  Half of each change took 1.2 to 2.3 seconds, against 0.12 seconds for the theremin's register.
  For steering to feel connected, it probably needs to be within a beat, about 0.5 seconds.
  The style handles pass through two smoothing steps, about 0.2 seconds each: the renderer's blend, and MRT2 reading the style only every fifth frame.
  After that, the model finishes what it is playing.
  The harmony handle changes the conditioning at once, yet took 1.7 seconds, because sounding notes ring on and only new notes carry the new harmony.
  Rest took 1.8 seconds while the piano rang out; the theremin page fades its output for this, and a steered page could too.
- **In steered, the hand and the model each account for about half of the variation.**
  Its shares were 0.49 to 0.58: a movement's effect is about as large as the difference between two seeds.
  The direction is reliable on average, but any single moment is half the hand's and half the model's.
- **The window design fails,** as the earlier findings predicted: height moved the register weakly, in four of six seeds.
- **The theremin is motion as music.**
  Its register follows height almost at once, and its notes are the hand's: while a note sounds clearly, two seeds play the same notes, with a distance of 0.00 to 0.10.
  Its note freedom rises to 0.35 only where held notes fade, the model drifts, and the note analysis becomes unreliable.
  Held notes fading also makes stillness hard to tell apart from steady movement.

These are measurements of audio, not of what a listener hears.
The listening test in `outputs/motion-to-music-2026-10-07/listening-test.html` has 24 pairs, eight per variant, and takes about ten minutes.
With eight pairs, guessing gets seven or more right only about 4% of the time.

The first run measured density by counting onsets.
That count fell for fast runs, whose flux stays high between notes, and it reversed the density result; the run was repeated with flux.

## Listening test

Everett took the test on October 13 and picked the right clip in 20 of 24 pairs.
Guessing does that well about once in 1,300 tries.
The answers are in `outputs/motion-to-music-2026-10-07/listening-results-2026-10-13.json`.

| Movement                 | Theremin | Window | Steered | All   |
| ------------------------ | -------- | ------ | ------- | ----- |
| Height, register         | 2/2      | 2/2    | 1/2     | 5/6   |
| Activity, density        | 2/2      | 2/2    | 2/2     | 6/6   |
| Spread, harmonic tension | 1/2      | 1/2    | 1/2     | 3/6   |
| Stillness, loudness      | 2/2      | 2/2    | 2/2     | 6/6   |
| All                      | 7/8      | 7/8    | 6/8     | 20/24 |

- **Activity and stillness are heard.**
  Every pair was right, in every variant.
- **Height is mostly heard.**
  The one miss was steered, seed 101.
- **Spread is not heard.**
  The answers were at chance in every variant.
  For theremin and window this matches the audio, which found no reliable effect.
  For steered it does not: harmony was its strongest measured movement, at 100% and 2.6.
  The test cannot tell which of two causes is at work:
  the change from triad to scale is not audible enough, or "the hands spread wide" does not suggest "more tension" to a listener.
- **The variants cannot be told apart.**
  With two pairs in each cell, 6 of 8 and 7 of 8 are within the same noise.
  The test confirms that steered's movements are audible, except spread; it does not rank steered against the others.

### Spread check

The same day, a second test asked about the sound instead of the hands.
It had 12 steered spread pairs, one for each of 12 seeds, and asked "In which clip does the melody sound more tense, with notes beyond the chord?"
The answers are in `outputs/spread-check-2026-10-13/listening-results-2026-10-13.json`, next to the clips.

- **Everett picked the wide clip in 9 of 12 pairs.**
  Guessing does that well about 7% of the time.
- **One miss was the music's, not the ear's.**
  In seed 107 the audio measured more tension in the narrow clip, and Everett chose that clip.
  Counted against what the clips contain, he agreed in 10 of 12, which guessing does about 2% of the time.
- **The other two misses, seeds 105 and 109, had large measured differences.**
  Three right answers, seeds 102, 103, and 106, had almost none, so the measured tension is not all that he heard.
- **He got the first eight right,** so the feedback after each answer does not explain the score.

The change from triad to scale can be heard when the listener knows what to listen for, but not reliably.
The first test's chance score came mostly from the question: "the hands spread wide" does not point a listener to tension.
A playable page should make the spread's sound clearer or give it a movement that suggests it.

## Limits

- The movements are scripted, not hands, and the renders are offline, so the response times leave out tracking and playback delay.
- The audio measurements approximate what a listener hears; the listening test checks them.
- The note analysis can mistake several notes for a lower note that is not there; comparing pitch classes over a second reduces, but does not remove, that error.
- One moment of music, one key, and one instrument are a narrow sample.
