# Sway V2: design proposal

Started: October 1, 2026, Asia/Singapore.
Status: proposal for discussion; nothing here is built yet.
V1 is merged and described in the [V1 plan](v1-plan.md), which stays the reference for its rules and measurements.

## Where V1 leaves us

V1 proved the core contract: notes follow the hand within a sixteenth note, the band stays in key and on the beat, and no model ever holds up a note.
The first play test with real hands ([October 1](v1-plan.md#october-1)) confirmed the contract and exposed what is missing:

- The lead is a two-oscillator synthesizer with automatic vibrato, and every note plays at the same velocity.
  Nothing about how a note is played changes how it sounds.
- The generated harmony is quiet and hard to identify.
  It is matched to the synthesized pad it replaces, about 3.5 dB below the bass in one measured piece.
- Qwen's choices change what the band plays, not how it sounds.
  Chords, a texture, and a short answering line are the least audible decisions a bandleader makes.
- There is one musical world, and one timbre per part.

V1 is a solid skeleton for an instrument, with a thin voice and an AI that is underused and barely heard.

## What V2 is for

Sway should be an instrument people want to keep playing, and a product worth shipping:

- **A voice worth playing:** real instruments that answer how the hand plays, not only where it is.
- **A band with taste:** an AI bandleader that orchestrates, arranges, and shapes the piece, audibly and in response to the player.
- **A result worth keeping:** a produced recording, not only a capture of the live mix.
- **Variety:** several musical worlds, each with its own instruments and feel.

What that could feel like:
A player opens Sway, picks a café world, and chooses the cello.
The quicker they pinch, the harder the bow bites, and leaning toward the camera swells a long note.
The band comes in behind them with nylon guitar and brushes, and a Rhodes answers their phrase an octave down.
At the chorus, the bandleader brings in strings a sixth under their melody.
When they close both hands, Sway offers the take as they heard it, and a produced record of the same performance, with their melody played by a generated cellist.

## One principle: match each decision to its clock

Everything Sway does fits one of three time budgets, and each gets the most capable machinery its budget allows.

| Clock        | What is decided                                                   | By whom                                         | Budget                        |
| ------------ | ----------------------------------------------------------------- | ----------------------------------------------- | ----------------------------- |
| Milliseconds | A note starts, swells, bends, and stops                           | The player's hand, rendered in the page         | Tens of milliseconds          |
| Seconds      | What the band plays next: chords, instruments, parts, and answers | The AI bandleader, bars ahead of the music      | 2 to 20 seconds ahead         |
| Minutes      | The recording the player keeps                                    | An AI producer, rendering after the performance | While the player listens back |

V1 already works this way for notes and chords.
V2 applies it everywhere.
The hand gets far richer expression with no model on its path.
The bandleader gets much more to decide, because it has seconds.
The heaviest generation moves to after the performance, where latency does not matter.

## 1. A lead worth playing

### Expression from the hand

A lively instrument answers how a note is played, not only which note.
The tracker already measures pinch distance and hand size in every frame; the lead uses them only to start and stop notes.
Each proposed mapping keeps one meaning everywhere in Sway:

| Gesture                                  | Musical result                              | Measured from                                                  | Confidence                        |
| ---------------------------------------- | ------------------------------------------- | -------------------------------------------------------------- | --------------------------------- |
| Strike: how quickly the pinch closes     | How loud and bright the note starts         | The change in pinch distance over the last two or three frames | High: the logic of striking a key |
| Lean in: move the hand toward the camera | A swell, louder and brighter, while holding | Hand size relative to its size when the note started           | Medium: needs a per-player range  |
| Wobble: a small, quick shake of the hand | Vibrato, deeper as the shake grows          | Motion of the unfiltered wrist at 3 to 8 Hz                    | Experimental                      |

Height still picks the note and pinch still plays it, so nothing a V1 player has learned changes.
The tutorial gains a lesson for dynamics, judged like the others.

### Real instruments

The lead should be able to sound like an instrument someone would choose: a cello, a flute, a muted trumpet, a nylon guitar, a Rhodes, a voice, or a well-made synthesizer.
The recommendation is multi-sampled instruments with several velocity layers and looped sustains, played by a sampler in the page, so the note path stays local and immediate.
Good libraries allow this: the VSCO 2 Community Edition (orchestral) and the Versilian Community Sample Library are both CC0, and the Salamander Grand Piano is CC BY 3.0, which asks only for attribution.
Physical-modelling voices for bowed strings, flutes, and plucked strings are a later option: they respond to continuous control naturally, but models that sound good take real work.

### Who chooses the lead's instrument

The player does, from the instruments the world offers, with a default for each world.
A player learns an instrument's response, how it attacks, sustains, and glides, and changing it under their hands would undo that.
The bandleader enriches the lead in two other ways:

- **Doubling:** another instrument plays the player's line with them, such as strings an octave below in a chorus.
- **Harmony:** another instrument plays a third or a sixth under each lead note, taken from the current chord.

The bandleader decides both for a section, and the page computes them for every note, so they are as immediate as the lead.
This is how the lead gains several instruments without gaining latency.

## 2. An AI bandleader

### From four chords to an arrangement

Today the composer writes four chords, a texture, an answering line, and a caption.
V2 asks the backbone for the decisions a human bandleader makes, each from a vocabulary the renderers can play:

| Decision        | Examples                                                                | Vocabulary                                                               |
| --------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Orchestration   | Which instrument plays each band role: harmony, bass, rhythm, and color | The world's instrument catalog, up to two layers per role                |
| Arrangement     | Which roles play, and in which pattern                                  | Patterns for each role in the world, like V1's band patterns             |
| Generated sound | How MRT2's part should sound                                            | A description of the sound, checked in key (see below)                   |
| Lead support    | Doubling and harmony, each with an instrument and an interval           | Catalog instruments; octave, third, or sixth                             |
| Harmony         | A chord for each bar                                                    | The world's chords, as now                                               |
| Dialogue        | Answering lines, and which instrument plays them                        | Ladder notes, as now                                                     |
| Form            | The section's type and length, and the transition into the next         | Intro, verse, chorus, bridge, breakdown, outro; fills, risers, and stops |
| Words           | A caption for the player, and later the piece's title                   | Short text                                                               |

Keeping every decision inside a playable vocabulary preserves V1's rule that nothing sounds wrong.
The creativity is in the choices and their timing: what enters when, what answers the player, how a section builds, and when the band drops out.

The stage should show those decisions as they happen: which instrument plays each role, and which parts the models chose or generated.
A player who can see the band's choices can hear them, and can learn to play off them.

### Two tiers: a director and an accompanist

One model call every four bars cannot also plan a piece, so the bandleader has two tiers:

- **The director** plans the next section, 8 to 16 bars, while the current one plays: its form, orchestration, generated sound, and lead support.
  It has 10 to 20 seconds, so it can use the strongest model available, with reasoning.
- **The accompanist** writes each four-bar cycle inside the director's plan: chords, answers, and small changes in response to what the player just did.
  It keeps V1's budget, a plan settled two bars ahead, 4.8 seconds at 100 BPM, so it needs a fast model.

When either tier is late or fails, the band keeps the current section's orchestration and falls back to the built-in progression, as V1 does.

### A replaceable backbone

Qwen is the backbone today, another model may be better tomorrow, and the two tiers may want different models.

- **One contract:** versioned JSON schemas for what the bandleader hears and what it returns, validated on the server and in the page.
- **Providers by configuration:** an OpenAI-compatible client covers Qwen on DashScope, OpenAI, DeepSeek, Gemini's compatible endpoint, and local servers such as Ollama or MLX; an Anthropic adapter covers Claude.
- **Chosen by evidence:** an offline harness replays recorded performances, from the performance files V1 already saves, through candidate models.
  It checks validity and latency, scores simple musical properties, and renders the results for listening.

A model change becomes a configuration change, and the product's quality rests on measured choices rather than on one vendor.

## 3. Generated sound where it fits

### Live: one generated part, described by the bandleader

MRT2 Small keeps the development Mac's GPU about half busy for one live stream, so live generation stays at one part.
In V2 the director describes that part's sound for each section, instead of the player choosing strings, piano, or choir before starting.
MRT2 blends toward a new description over about two seconds, so changes at section boundaries are smooth.
Two changes make this safe and audible:

- **A key guard:** before sending a rendered bar, the server measures how much of its energy lies in the world's scale.
  A bar that drifts is dropped, and the synthesized stand-in plays it; a description that drifts repeatedly is retired for the piece.
  This extends "nothing sounds wrong" from notes to generated audio.
- **A featured mix:** the generated part is no longer matched to the pad's level.
  It is balanced as a featured part, and the synthesized band thins out around it when the arrangement says so.

The [probe](#probe-which-sounds-mrt2-keeps-in-key) at the end of this document measured which descriptions MRT2 keeps in key, and showed two practical details.
Every bar that drifted came in the first two bars after a new description started, so a new description should start rendering a bar before it is heard.
Loudness differed by about 25 dB between descriptions, so loudness matching should restart with each new description.

### After the performance: the record

After the ending, a producer re-renders the piece for keeping, with no real-time limit:

- The player's melody performed by MRT2 in the lead instrument's sound, a generated performance of their own notes.
- The band as separate generated parts, following the recorded arrangement.
- A mix and master, a title, and later a cover image.

The live take stays available, and the record is offered beside it.
This is where Sway can sound its best, because it can use larger models such as MRT2 Base, cloud GPUs, and several passes.
It needs its own experiment first: how faithfully MRT2 performs a solo melody, and how long a three-minute piece takes to render on the Mac and on a GPU.

## 4. Worlds

A world is a key and ladder, a tempo and groove, an instrument catalog, patterns for each role, descriptions for the generated part, a default lead instrument, and a visual theme.
Start with three handcrafted worlds that differ clearly:

- **Night Drive,** from V1: downtempo electronic, A minor, 100 BPM.
- **A café world:** nylon guitar, upright bass, brushes, Rhodes, and strings, in a major key.
- **A cinematic world:** strings, horns, harp, and timpani, slower, with a wide dynamic range.

Later, the director can create a world from a sentence, such as "a warm summer night in Lisbon", or from what the camera sees, limited to parameters the renderers support.

## Rules V2 adds

V1's eight rules stay, and V2 adds four:

9. The bandleader changes the band only at section and cycle boundaries, and never changes the player's instrument or the world during a piece.
10. Every AI decision comes from a vocabulary the renderers can play, is validated on the server and in the page, and has a fallback.
11. Generated audio is checked before it is played.
12. Models are chosen by measured quality and latency on recorded sessions, and can be replaced by configuration.

## Roadmap

Each step is its own pull request, playable and tested on its own.

| Step | Change                                                                                                            | Depends on            |
| ---- | ----------------------------------------------------------------------------------------------------------------- | --------------------- |
| 1    | Expressive lead: strike and lean-in on the current synthesizer, and a fix for stray notes from drumming fingers   | Nothing               |
| 2    | Instrument catalog and sampler: four to six sampled lead instruments, chosen by the player                        | Decision 4            |
| 3    | Backbone v2: the provider-agnostic client, the arrangement contract, validation, and the offline harness          | Nothing               |
| 4    | Orchestrated band: band roles played by catalog instruments that the plan chooses, with lead doubling and harmony | 2 and 3               |
| 5    | The described generated part, the key guard, and a featured mix                                                   | 3                     |
| 6    | The director: sections, form, and transitions                                                                     | 3 and 4               |
| 7    | Two more handcrafted worlds                                                                                       | 2 and 4               |
| 8    | The record                                                                                                        | 5, and its experiment |

Steps 1 and 2 answer "not lively" directly, steps 3 to 5 make the AI's part substantial and audible, and steps 6 to 8 turn the instrument into a product.
The listening test's switches, which mute each part, are on a [draft pull request](https://github.com/Audiofool934/sway/pull/2); kept behind a key, they would help evaluate every step.

## Decisions for Everett

1. **Where Sway ships first:** a web app with the models in the cloud, a Mac app with MRT2 running locally, or both.
   This decides where the renderers run and what each session costs.
2. **Who owns the lead's instrument:** the proposal is the player, with the bandleader adding doubling and harmony.
3. **Which backbones to support first** beyond Qwen, and a budget for model calls per session.
4. **Which samples:** freely licensed libraries only, or a licensed commercial library.
5. **Which worlds** come after Night Drive.

## Experiments before building

- Which sound descriptions MRT2 keeps in key: done, [below](#probe-which-sounds-mrt2-keeps-in-key).
- Strike and lean-in on recorded footage: how reliably pinch speed and hand size follow intent.
- A sampled lead's load time, memory, and latency in Chrome.
- The bandleader's latency with the larger contract, for each candidate model, against the 4.8-second budget.
- MRT2 performing a solo melody, for the record.

## Probe: which sounds MRT2 keeps in key

MRT2 Small rendered the same twelve bars for each description on the development Mac, in one continuing stream, as V1's band writes its harmony: Am, F, C, and G held for eight bars, then struck on every beat for four.
Each bar was measured as in V1's test for generated harmony: the share of its energy between 60 Hz and 2 kHz on the pitch classes of A minor, or of the written chord, after its first 200 ms.
[`scripts/probe_palettes.py`](../scripts/probe_palettes.py) reproduces the table and saves each take for listening.

| Sound                 | In key, held | On the chord, held | In key, struck | Bars under 90% in key | Loudness |
| --------------------- | ------------ | ------------------ | -------------- | --------------------- | -------- |
| Strings (V1)          | 99.4%        | 96.8%              | 97.2%          | 0 of 12               | -31 dB   |
| Piano (V1)            | 99.2%        | 95.7%              | 96.0%          | 0 of 12               | -37 dB   |
| Choir (V1)            | 99.3%        | 98.2%              | 99.1%          | 0 of 12               | -29 dB   |
| Rhodes                | 99.2%        | 98.8%              | 98.5%          | 1 of 12               | -24 dB   |
| Nylon guitar          | 98.4%        | 96.0%              | 93.0%          | 0 of 12               | -29 dB   |
| Clean electric guitar | 97.0%        | 95.4%              | 98.4%          | 1 of 12               | -22 dB   |
| Brass                 | 99.7%        | 92.3%              | 99.0%          | 0 of 12               | -30 dB   |
| Woodwinds             | 99.6%        | 91.3%              | 99.0%          | 0 of 12               | -29 dB   |
| Cellos                | 98.0%        | 95.2%              | 97.6%          | 0 of 12               | -18 dB   |
| Harp                  | 99.6%        | 99.4%              | 97.8%          | 0 of 12               | -43 dB   |
| Vibraphone            | 98.5%        | 97.4%              | 97.5%          | 0 of 12               | -24 dB   |
| Organ                 | 93.5%        | 85.5%              | 98.3%          | 2 of 12               | -22 dB   |
| Synthesizer pad       | 96.5%        | 87.1%              | 96.8%          | 2 of 12               | -26 dB   |

- All ten new descriptions kept most of their energy in key: medians of 93.5% to 99.7% on held chords, and 93.0% to 99.0% on struck ones.
- Six of the 156 bars fell below 90% in key, all in the first two bars after a new description started: organ and the synthesizer pad twice each, Rhodes and clean electric guitar once.
  A key guard at 90% would have replaced those six bars, 4% of the total, with their synthesized stand-in.
- Brass and woodwinds stayed in key while putting less energy on the chord itself, because they add passing notes; the key guard should judge the scale, not the chord.
- Loudness ranged from -43 dB for the harp to -18 dB for the cellos.
- Each 28.8-second take rendered in 15 to 23 seconds, including starting its stream.
- The measure hears pitch, not timbre: whether the harp sounds like a harp still needs listening.

## Ideas for later

- **Call and response as play:** the band answers a phrase with a variation, and the player answers back.
- **Band members with character:** a drummer who fills when the player pauses, and strings that swell under long notes.
- **A lift for the last chorus:** a key change, with the ladder moving with it.
- **Two players, one camera:** one leads while the other steers the band.
- **Learn a song:** the tutorial's scrolling chart, with melodies to learn.
- **Motifs that return:** the bandleader remembers a player's recurring phrases and develops them across pieces.
- **Sharing a performance:** a link that plays a performance file back through the renderers.
