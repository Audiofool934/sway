# Sway V2: design

Started: October 15, 2026, Asia/Singapore.
Status: Everett approved this direction on October 19, 2026.
The gestures, the open questions, and the milestones after the first will change as play tests answer them.
Nothing here is built yet, except where it says so.
It replaces the October 1 proposal in [#3](https://github.com/Audiofool934/sway/pull/3), which gave the AI more decisions; this draft gives them to the player.

## Goal

**Anyone can lead one continuous, evolving piece of music in five minutes, without playing a note.**

Everett's answers on October 15 set the frame:

| Question                              | Answer                                                                                                    |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Who is it for?                        | Anyone who wants to make something good in five minutes. Intuitive first; the professional comes later.   |
| Live experience, or a finished piece? | The live experience.                                                                                      |
| Do the hands play actual notes?       | The most important open question. Notes make leading hard; no notes may make specific control impossible. |
| How much should the AI surprise you?  | More interactive, more evolving.                                                                          |

## What we have learned

| Version                                             | What worked                                                                                        | What was missing                                                                              |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| V1 (`/`)                                            | The camera behind the display, real-time MRT2 on an M2 Pro, Qwen planning the band, lessons, form. | Playing felt like adding notes over an accompaniment. Every session was the same Night Drive. |
| Theremin (`/theremin.html`)                         | Immediate response.                                                                                | The hand chose every note: motion as music, not motion to music.                              |
| Steered (`/steered.html`, [guide](steered-page.md)) | On October 14, Everett said it does feel like leading the music.                                   | It "feels like some random music pieces joined together", not one continuous flow.            |

So V1 flows, but the player does not lead it.
Steered lets the player lead, but it does not flow.
V2 has to do both.

The steered page's discontinuity has four likely causes, all in its design:

1. Nothing holds the music together: no tempo, no chord progression, no returning theme.
2. Changes land on any 40 ms frame, not at the end of a bar or a phrase.
3. Stillness fades the music to silence, so every rest becomes a seam.
4. Its four style corners are different textures, so moving between them crossfades from one piece to another.

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
   Caught material returns, varied, so the piece remembers you.
6. **Answer every gesture at once, and land the change on the beat.**
   A 1-2 second delay feels broken when it is silent and intentional when it builds up.
   Every gesture gets an immediate sign that it was heard, such as a riser, a sweep, or a fill, and its musical change lands on the next downbeat.
7. **Few gestures.**
   A first-time player learns them in the first minute, without a lesson.

## Who decides what

| Layer        | Decides                                                                    | Timescale                 | Built on                                                              |
| ------------ | -------------------------------------------------------------------------- | ------------------------- | --------------------------------------------------------------------- |
| The hands    | Direction, moments, choices                                                | Now, or the next bar      | The steered page's tracking and controls                              |
| The browser  | The immediate answer to a gesture, drums, the grid                         | Immediately               | V1's engine and scheduler                                             |
| MRT2         | Every note of the generated parts, within the chords and style it is given | 40 ms frames              | The steered stream and V1's chord rendering                           |
| The arranger | Chords, sections, instruments, and when a caught theme returns             | Bars to minutes           | V1's Qwen composer, moved up from chords to form; Gemini is an option |
| Text         | The world, and later the direction in words                                | A session, later a phrase | MRT2's style is already a text prompt (MusicCoCa)                     |

Models stay off the immediate path: what answers a gesture at once is made in the browser.

## The verbs

| Verb         | Intent    | Proposed gesture                                        | What happens                                                                             |
| ------------ | --------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| **Steer**    | Direction | Height, amount of movement, spread                      | Register, energy, and size change, landing on the next bar.                              |
| **Cue**      | A moment  | To be designed; for example, both hands down for a drop | An immediate build-up, then the change lands on the next downbeat or phrase.             |
| **Catch**    | A choice  | Close a hand on a phrase you like                       | The phrase loops quietly at once; the arranger makes it a theme, and it returns, varied. |
| **Wave off** | Not that  | To be designed                                          | The model drops that idea and tries another.                                             |

The gestures are proposals.
Four verbs may already be too many for five minutes; steer and catch may be the minimum.

**Spread should mean size.**
In the October 13 listening tests, Everett could not match "the hands spread wide" to the harmony, though he heard the change in 9 of 12 pairs when asked about the sound.
A wide stance suggests a bigger sound: more instruments, a fuller and wider mix.
Tension may suit a clenched or trembling hand.

**Catching must have consequences.**
Catching that only saves a phrase is curating, like a "like" button.
Catching leads when the caught theme audibly changes where the piece goes next.
Whether choosing feels like authorship is the riskiest assumption in this draft; only a play test can answer it.

An example: the piano plays a four-note phrase, and the player closes a hand.
At once, the phrase loops quietly under the music.
Over the next minute, the strings play it slowly, the bass takes its rhythm, and at the peak the player cues, it returns an octave higher with the whole band.
The player never played a note, but the theme of the piece is the one they chose.

## Worlds and text

A session starts in a world: a tempo, a key, instruments, style prompts for MRT2, and an opening theme.
The music starts by itself, and the player steers from there.

- **Preset worlds** are the direct way in, such as "night drive" or "film score".
- **Custom worlds from text:** the player describes a world in words, and the arranger turns the words into a world.
  This is text-to-live-music: the description sets the start, and the hands lead from there.
- **Growing from nothing** is the ultimate goal: the first gestures choose the world.

Text matters beyond the start.
Gestures alone are ambiguous: a raised hand can mean higher, brighter, or more intense, but words can say "darker", "add a choir", or "like a chase scene".
Text during play, typed or spoken, is a later layer, not necessarily part of V2.
V2 should leave room for it: the arranger already works in words, and MRT2's style is a text prompt.

## How we will know it works

A first-time player, with only the start screen, within five minutes:

1. Says they led the music.
2. Can point to a moment they caused.
3. Hears one piece, not pieces joined together.
4. Wants to play again.

Everett's own judgment comes first; then a few people who have never seen Sway.
MOTIF's player study can measure the same four points.

## Milestones

Each is one piece of work on its own branch and pull request, and Everett plays it before the next begins.

1. **Continuity:** the steered page with a spine: a bar grid, a chord progression that MRT2 follows, changes only on bar lines, and stillness that thins instead of stopping.
   It tests the answer to "random pieces joined together" first, because it is the most uncertain.
   Built on October 19; the [steered page guide](steered-page.md#the-spine) describes it.
   On October 19 Everett chose it as more continuous in six of six blind pairs, but still heard piano fragments when he played it; solo piano itself was the cause, so the spine became an ensemble whose instruments follow the hands.
   On October 20 he played the ensemble and said: "this is GREAT!!!"
2. **A world and the arranger:** one preset world, with the arranger planning chords and sections, and the first cue.
3. **Catch:** looping a caught phrase, and the arranger bringing it back, varied.
4. **Custom worlds from text.**
5. **New players:** the five-minute test with people who have never played Sway.

## Open questions

- Can the streamed MRT2 follow a chord progression bar by bar?
  V1's harmony renders bars with the chords it is given, but the steered stream has no bars yet.
- Where does the beat grid live: in the browser's drums, in MRT2's conditioning, or both?
- Can a caught phrase become notes reliably enough to vary?
  `pitch.py` finds notes in audio, but dense textures confuse it.
- Which gestures are intuitive for cue and wave off, and how many verbs fit in five minutes?
- Does catching feel like leading or like curating?
- The October 1 decisions to ship on the web with cloud models and on the Mac with MRT2 still stand; this draft is designed on the Mac first.

## Related work

| Example                                          | What to learn from it                                               |
| ------------------------------------------------ | ------------------------------------------------------------------- |
| Max Mathews' Radio Baton                         | Conducting tempo and dynamics alone already feels like leading.     |
| Magenta's Piano Genie                            | A model can turn a rough contour into good notes.                   |
| Google's Blob Opera                              | Few controls, an instant reward, and a model that does the harmony. |
| François Pachet's Continuator, Magenta's AI Duet | A model answering in the player's style feels collaborative.        |

None of them combines steering, cues, catching, and an evolving arrangement.
