# Sway V2: design

Started: October 15, 2026, Seattle time.
Status: Everett approved the first direction on October 19, 2026, and later that day the conductor model, the world designer, and the new order of milestones.
The gestures, the open questions, and the later milestones will change as play tests answer them.
Nothing here is built yet, except where it says so.
It replaces the October 1 proposal in [#3](https://github.com/Audiofool934/sway/pull/3), which gave the AI more decisions; this design gives them to the player.

## Goal

**Anyone can lead one continuous, evolving piece of music in five minutes, without playing a note.**

Everett's answers on October 15 set the frame:

| Question                              | Answer                                                                                                    |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Who is it for?                        | Anyone who wants to make something good in five minutes. Intuitive first; the professional comes later.   |
| Live experience, or a finished piece? | The live experience.                                                                                      |
| Do the hands play actual notes?       | The most important open question. Notes make leading hard; no notes may make specific control impossible. |
| How much should the AI surprise you?  | More interactive, more evolving.                                                                          |

## The product

**An orchestra you conduct with your hands.**
An AI composes and plays a live score around you, and your gestures decide how it is played.
Everett agreed to this picture on October 19.

### A first session

1. You open Sway, in a browser or the Mac app.
   It asks one thing: what should we play?
   You pick a world, such as a film score, a night drive, rain, or fantasy, or you describe one: "a lonely waltz in an empty ballroom".
2. The camera turns on.
   Your room appears, dimmed, behind the music, and the orchestra is laid out around you: in the film score, violins on your left, brass in the middle, cellos and basses on your right.
3. The music has already begun, quietly.
   You raise your hands, and it swells at once.
   Your left hand drifts left, and the violins lift into the melody.
   Open palms give long lines, and pinched fingers give short notes.
   Close your hands, and it falls to a hush.
4. Within a minute, you understand it.
   You raise both hands, and a swell rises; you bring them down, and the full orchestra lands on the beat.
5. The composer listens.
   After a long quiet stretch, it writes something tender, and after a climax, a release.
   When it plays a phrase you love, you can keep it, and it comes back later on horns, and at the end on the full orchestra.
6. When you let your hands fall, the piece ends on a cadence.
   Sway offers the recording, a title the composer suggests, and the shape of your piece: an intro, two builds, a peak, a quiet ending.

### What makes it work

- **Nothing to learn** beyond what everyone has seen of conductors in films.
- **An instant answer:** the volume and the swell respond at once, and the notes follow within a second or two, as a real orchestra follows a conductor.
- **One piece, never a loop:** themes return and develop.
- **It sounds like real music,** at the level of a film score.
- **Private:** the camera image never leaves the device, and the language models get only words and numbers about the music.

### Use cases

| Priority | Who                                                | When                               | What they get                                                   |
| -------- | -------------------------------------------------- | ---------------------------------- | --------------------------------------------------------------- |
| 1        | Anyone, the first time                             | At home, at a party, at an exhibit | "I conducted an orchestra", in five minutes                     |
| 1        | One person, regularly                              | An evening, 10 to 30 minutes       | A way to express a mood without musical skill                   |
| 2        | Creators                                           | Scoring a short video              | A soundtrack conducted live over the clip                       |
| 3        | Performers and streamers                           | On stage, online                   | An AI orchestra under their direction, for an audience          |
| 3        | Two people together                                | Family, friends                    | Each conducts part of the orchestra                             |
| 3        | Learners, and people who cannot play an instrument | Classes, music therapy             | Orchestration and form understood by doing; large gestures only |

The first two follow Everett's answers: anyone, and the live experience.
The others inform later decisions, but V2 is not designed for them yet.

### What it is not

- **Not a composition tool:** no notes to edit, no timeline.
- **Not a text-to-song generator:** the value is the control while playing, not the file.
- **Not a rhythm game:** there are no wrong notes to avoid.

## What we have learned

| Version                                                                                                  | What worked                                                                                        | What was missing                                                                                                                |
| -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| V1 (`/`)                                                                                                 | The camera behind the display, real-time MRT2 on an M2 Pro, Qwen planning the band, lessons, form. | Playing felt like adding notes over an accompaniment. Every session was the same Night Drive.                                   |
| Theremin (`/theremin.html`)                                                                              | Immediate response.                                                                                | The hand chose every note: motion as music, not motion to music.                                                                |
| Steered (`/steered.html`, [guide](steered-page.md)), October 14                                          | On October 14, Everett said it does feel like leading the music.                                   | It "feels like some random music pieces joined together", not one continuous flow.                                              |
| Steered on a spine, with an ensemble (milestone 1)                                                       | One continuous piece. Everett: "this is GREAT!!!"                                                  | One world, the same four chords on repeat, nothing that evolves.                                                                |
| A film score, an arranger, and a clap (milestone 2, [#17](https://github.com/Audiofool934/sway/pull/17)) | "It has that film-score sound."                                                                    | "It doesn't seem very controllable", "I don't know what my hands are actually controlling", and the clap was hard to recognize. |

So V1 flows, but the player does not lead it.
The steered page lets the player lead, and on a spine it flows too.
Milestone 2 added a world and a composer, but lost the player's sense of control.

Milestone 1 traced the steered page's discontinuity to four causes: nothing held the music together, changes landed on any frame, stillness stopped the music, and the style corners were different textures.

Milestone 2's play test, on October 19, traced the loss of control to five causes:

1. The arranger's direction was 40% of the sound and could change every phrase, so the music changed for reasons other than the hands.
2. The arranger sometimes read the player wrongly, as in "Release · Drifting deeper into silence".
3. With one hand tracked, spread and height changed meaning, so losing a hand changed the music.
4. A clap overlaps the hands, and the tracker lost one of them.
5. Height, speed, and spread are abstract axes with nothing to point at.
   In Everett's words: "When it's not a piano, what do ten fingers across two hands map to and control?"

## Levels of control

The question "notes or no notes" has a middle:

| Level      | The player decides              | The model decides | Example                 |
| ---------- | ------------------------------- | ----------------- | ----------------------- |
| Note       | Every pitch and its timing      | Only the sound    | V1's lead, the theremin |
| **Intent** | A direction, a moment, a choice | Every note        | V2                      |
| Direction  | Higher, livelier, tenser, rest  | Everything else   | The steered page        |

A beginner does not think in notes.
A beginner thinks in intents:

- **Direction:** bigger, calmer, higher, darker, more tense.
- **Moment:** now: start, stop, drop, hit.
  Untrained people time well, even when they cannot name a note.
- **Choice:** that one again; not that.
- **Story:** build up, breathe, end here.

V2 gives gestures to intents, not to notes.
A conductor works at exactly this level, which is why the conductor model fits.
A note level can come later, for performers.

## Principles

1. **Control intents, not notes.**
2. **A spine keeps the music continuous.**
   A tempo, a bar grid, a chord progression, a returning theme, and sections keep going whatever the hands do.
   The hands shape the spine; they never replace it.
3. **Changes land on musical boundaries:** the next bar or phrase, not the next frame.
4. **Stillness thins the music, never stops it.**
   A rest leaves one quiet voice, and moving again grows the music back from it.
5. **What you choose comes back.**
   Kept material returns, varied, so the piece remembers you.
6. **Answer every gesture at once, and land the change on the beat.**
   A 1-2 second delay feels broken when it is silent and intentional when it builds up.
   Every gesture gets an immediate sign that it was heard, and its musical change lands on the next downbeat.
7. **Few gestures.**
   A first-time player learns them in the first minute, without a lesson.
8. **The player can tell what they caused.**
   How the music is played belongs to the player alone.
   The composer changes only the score, on phrase lines, and the page shows what it changed.
9. **Gestures the camera can see.**
   No gesture makes the hands cross or cover each other, and losing a hand never changes the music by itself.

## Who decides what

| Role               | Who              | Decides                                                                                         | When                 |
| ------------------ | ---------------- | ----------------------------------------------------------------------------------------------- | -------------------- |
| The conductor      | The player       | How the music is played: dynamics, energy, which voice leads, articulation, when to move on     | Now, or the next bar |
| The world designer | A language model | The world, from the player's words: key, tempo, chords, voices and their places, sections, look | Once, at the start   |
| The composer       | A language model | What is played: chords, sections, themes, and when a kept theme returns                         | A phrase ahead       |
| The orchestra      | MRT2             | Every note, within the chords and the sound it is given                                         | 40 ms frames         |
| The browser        | The page         | The instant answers: the volume and the swell                                                   | At once              |

The composer is milestone 2's arranger, Qwen, kept to the score.
Gemini or another model can take either language model's role later.
Models stay off the immediate path: what answers a gesture at once is made in the browser.

## The conductor

The gestures are the same in every world.

| Gesture                              | What a conductor means by it         | What it controls                                                                                    | How fast                                  |
| ------------------------------------ | ------------------------------------ | --------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| The size of the right hand's motion  | Big is loud, small is soft           | Dynamics: the volume, then the texture                                                              | The volume at once; the texture in 1-2 s  |
| The speed of the right hand          | Drive                                | Energy: calm and sustained, or driving and rhythmic                                                 | 1-2 s                                     |
| The left hand's place, left to right | Pointing at a section                | Which of the world's three voices leads: the voices sit left, middle, and right                     | About 1 s                                 |
| The left hand's height               | Bringing a section up                | How far that voice comes forward                                                                    | About 1 s                                 |
| Hand shape: open palm or pinch       | Smooth and broad, or short and crisp | Articulation                                                                                        | About 1 s                                 |
| A fist, or stillness                 | Cut off                              | Hush: the music thins to a quiet chord                                                              | At once                                   |
| Both hands up, then down             | The preparation, then the downbeat   | Move on: a swell rises while the hands are up, and the next section lands on the bar after the drop | The swell at once; the landing on the bar |

- **One hand conducts as the right hand,** and the balance stays where it was, so losing a hand never changes the music.
  Left-handed players can swap the hands.
- **The harmony is the composer's.**
  The hands no longer open it: in the October 13 listening tests, its change was not reliably heard as the hands' doing.
- **The page shows the voices** in their places, and lights the one the left hand brings forward, so there is something to point at.
- **Keeping a phrase, and waving one away,** come with a later milestone.
  A fist already means hush, so keeping needs another gesture.

## Worlds, and the world designer

A world holds everything the gestures act on: a tempo and key, its chords, three voices and their places, two articulations, the sections with their meaning and default sound, the textures for calm and driving, and words for the page's look.

- **Preset worlds** are the direct way in.
  The film score is the first, written by hand.
- **Worlds from words:** the player describes a world, and the world designer, a language model, writes it in the same form.
  This is text-to-live-music: the description sets the start, and the hands lead from there.
- **Growing from nothing** is the ultimate goal: the first gestures choose the world.

**The rule: the gestures stay the same in every world, and the world designer changes only what they mean.**
Raising and dropping both hands always moves on, and the left hand over a place always brings that voice forward.
If every world invented its own gestures, nothing learned in one world would carry to the next.

An example: from "a rainy noir chase through Tokyo", the world designer might write:

| Part of the world   | What it decides                                  |
| ------------------- | ------------------------------------------------ |
| Key, tempo, chords  | C minor, 100 beats a minute, a few minor chords  |
| Left, middle, right | Muted trumpet, smoky piano, upright bass         |
| Open palm, pinch    | Long smoky lines, short stabs                    |
| Sections            | Night streets, footsteps, the chase, the getaway |
| Look                | Words for the page's colors and labels           |

A world is checked before anyone plays it:

- Its instruments and textures come from those MRT2 is measured to play, a list that grows with each measurement.
- A few seconds of each voice and each articulation are rendered, and their differences must be audible: words can mislead, as the brass did on October 19.
- Its tempo gives whole model frames, and its chords belong to its key.
- Preparing it takes a few seconds: one language model call, and about 2 seconds to embed its words.

Text during play, typed or spoken, is a later layer, not part of V2.
V2 leaves room for it: the composer and the world designer already work in words, and MRT2's style is a text prompt.

## Measurements

On October 19, four candidate conductor controls were measured on MRT2, each a pair of style texts from the same moment, over six seeds.
The clips and numbers are in `outputs/conductor-2026-10-19/`.

| Control                               | Result                                                                                                       |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Violins forward, or cellos and basses | Every seed the expected way: register effect 3.3, brightness 7.6. Half the change in 0.9 s, the fastest yet. |
| Brass forward, or strings             | Every seed clearly different, brightness effect 2.7, but darker, not brighter as expected.                   |
| Short staccato, or long legato        | Four of six seeds denser, effect 1.7; half the change in 0.7 s.                                              |
| Fortissimo, or pianissimo, in words   | Louder in five of six seeds; denser and brighter in all six. The volume itself can answer at once instead.   |

So MRT2 can bring voices forward quickly, and the words for a voice must be checked by ear and by measurement, not trusted.

## How we will know it works

A first-time player, with only the start screen, within five minutes:

1. Says they led the music.
2. Can say what each hand controls.
3. Can point to a moment they caused.
4. Hears one piece, not pieces joined together.
5. Wants to play again.

Everett's own judgment comes first; then a few people who have never seen Sway.
MOTIF's player study can measure the same points.

## Milestones

Each is one piece of work on its own branch and pull request, and Everett plays it before the next begins.

1. **Continuity:** the steered page with a spine: a bar grid, a chord progression that MRT2 follows, changes only on bar lines, and stillness that thins instead of stopping.
   Built and merged on October 19 ([#16](https://github.com/Audiofool934/sway/pull/16)); the [steered page guide](steered-page.md#the-spine) describes it.
   Everett chose it as more continuous in six of six blind pairs, but still heard piano fragments when he played it; solo piano itself was the cause, so the spine became an ensemble whose instruments follow the hands.
   He then played the ensemble and said: "this is GREAT!!!"
2. **The conductor,** with the world as data.
   [#17](https://github.com/Audiofool934/sway/pull/17) built a film score world, Qwen as the arranger, and a clap on October 19, but its play test lost the sense of control.
   So milestone 2 continues: the gestures in the table above, the film score written by hand as a world in the form the world designer will use, and the composer kept to the score.
   Built the same day; the [steered page guide](steered-page.md#the-conductor) describes it and its measurements.
3. **The world designer:** worlds from the player's words, in the same form, checked before play.
4. **Keeping a phrase:** looping a kept phrase, and the composer bringing it back, varied.
5. **New players:** the five-minute test with people who have never played Sway.

## Open questions

- Can players control the size and the speed of their motion separately?
- How reliably can hand shape be read at the camera's 12 frames a second, and which hand is which?
  The tracker labels hands, but older code flips those labels.
- Can every world have three voices that MRT2 plays distinctly enough to point at?
- Where does the beat grid live, and can worlds have drums?
  The stream plays without drums, and MRT2's drums do not follow the bar grid.
- Which gesture keeps a phrase, now that a fist means hush?
- Does keeping a phrase feel like leading or like curating?
- Can a kept phrase become notes reliably enough to vary?
  `pitch.py` finds notes in audio, but dense textures confuse it.
- The October 1 decisions to ship on the web with cloud models and on the Mac with MRT2 still stand; V2 is designed on the Mac first.

## Related work

| Example                                          | What to learn from it                                               |
| ------------------------------------------------ | ------------------------------------------------------------------- |
| Max Mathews' Radio Baton                         | Conducting tempo and dynamics alone already feels like leading.     |
| Magenta's Piano Genie                            | A model can turn a rough contour into good notes.                   |
| Google's Blob Opera                              | Few controls, an instant reward, and a model that does the harmony. |
| François Pachet's Continuator, Magenta's AI Duet | A model answering in the player's style feels collaborative.        |

None of them combines conducting, a composer that listens, and worlds designed from the player's words.
