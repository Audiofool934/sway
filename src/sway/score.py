"""The score that Sway writes for Stable Audio 3, one bar at a time, from the hands.

The score variant (`sway.scored`) plays it. It keeps the renderer comparison's score of
October 29 (docs/steered-page.md#renderers): Night Drive's Am, F, C, and G at 100 beats a
minute, and a violin melody over piano, strings, cellos, and basses. As on the theme
variant, the theme plays four bars in every twelve, with the comparison's two away lines
between. The hands set each bar's accompaniment at its bar line, as the offline test of
October 30 changed it (docs/steered-page.md#following-the-hands), at the page's thresholds:

- Activity sets the texture. Stillness holds only the chord's root and fifth, and the
  melody rests; calm movement holds chords; flowing movement plays arpeggios in eighths;
  lively movement plays sixteenths over pizzicato strings and a bass in quarters. Each
  texture is louder than the one before.
- Height sets the register. Low moves the melody, the piano, and the strings an octave
  down; high moves the whole ensemble an octave up. The test heard the register less
  through SA3 than in the score, so here the melody moves too.
- Spread opens the piano's harmony: the triad when the hands are close; a seventh or a
  sixth from the pentatonic scale in between; and the scale's ninth as well when wide.
"""

from dataclasses import dataclass

from .steering import A_MINOR_PENTATONIC, PROGRESSION, REST, Move, Spine
from .theme import THEME

BEAT = 60 / Spine.tempo
BAR = Spine.beats_per_bar * BEAT  # Seconds: 2.4.

# The comparison's away lines: the theme's climb turned downward, ending open on D; and
# the first note of each of the theme's bars, held for the bar.
ANSWER = (
    ((76, 1), (74, 1), (72, 1), (71, 1)),
    ((69, 3), (72, 1)),
    ((79, 1), (76, 1), (74, 1), (72, 1)),
    ((74, 4),),
)
HELD = tuple(((bar[0][0], 4),) for bar in THEME)
LINES = (ANSWER, THEME, HELD)  # Twelve bars, as the theme variant's: away, theme, away.

# The sampler's tracks: (name, General MIDI program, volume).
TRACKS = (
    ("violin", 40, 1.0),
    ("bass", 43, 0.8),  # Contrabass.
    ("cello", 42, 0.6),
    ("piano", 0, 0.55),  # Acoustic grand piano.
    ("strings", 48, 0.55),  # String ensemble.
    ("pizzicato", 45, 0.5),
)
VIOLIN, BASS, CELLO, PIANO, STRINGS, PIZZICATO = range(len(TRACKS))

TEXTURES = ("still", "slow", "medium", "fast")
REGISTERS = ("low", "middle", "high")
HARMONIES = ("chord", "pentatonic", "scale")
LEVELS = {"still": 56, "slow": 64, "medium": 80, "fast": 96}  # Each texture's MIDI velocity.
SHIFTS = {"low": -12, "middle": 0, "high": 12}
UP_AND_DOWN = (0, 1, 2, 3, 4, 3, 2, 1) * 2  # The piano's path through its five notes.


@dataclass(frozen=True)
class State:
    """What the hands chose for one bar."""

    texture: str = "still"
    register: str = "middle"
    harmony: str = "chord"


def band(x: float, names: tuple[str, str, str]) -> str:
    """Which of three bands a control is in, as the page names them: below 0.35, below
    0.65, and above."""
    return names[0 if x < 0.35 else 1 if x < 0.65 else 2]


def read(move: Move) -> State:
    """The bar's state from the hands as they are when it is decided."""
    still = move.activity < REST
    return State(
        texture="still" if still else band(move.activity, TEXTURES[1:]),
        register=band(move.height, REGISTERS),
        harmony=band(move.spread, HARMONIES),
    )


def line(bar: int) -> tuple[tuple[int, int], ...]:
    """The melody's notes in `bar`, counted from the take's start: (pitch, beats)."""
    return LINES[bar // 4 % len(LINES)][bar % 4]


def has_theme(bar: int) -> bool:
    return LINES[bar // 4 % len(LINES)] is THEME


def theme(bar: int, state: State) -> dict:
    """Where the theme is in `bar`, as the theme variant reports it (`ThemeLoop.describe`)."""
    if has_theme(bar):
        return {"theme": "resting" if state.texture == "still" else "playing", "themeIn": 0}
    later = next(n for n in range(1, 4 * len(LINES)) if has_theme(bar + n))
    return {"theme": "away", "themeIn": later}


def chord(bar: int) -> tuple[int, ...]:
    """The pitch classes of the chord in `bar`: root, third, fifth."""
    return PROGRESSION[bar % len(PROGRESSION)][1]


def colours(tones: tuple[int, ...], harmony: str) -> tuple[int, ...]:
    """The pitch classes that `harmony` adds to the triad, as intervals above the root.

    The pentatonic scale adds a seventh or, where it has none, a sixth: Am7, Fmaj7, C6,
    and G6. The whole scale adds the ninth as well.
    """
    if harmony == "chord":
        return ()
    root = tones[0]
    colour = next(i for i in (10, 11, 9, 8) if (root + i) % 12 in A_MINOR_PENTATONIC)
    return (colour,) if harmony == "pentatonic" else (colour, 14)


def figure(tones: tuple[int, ...], harmony: str, shift: int) -> list[int]:
    """The piano's five notes, upward from the chord's root between E2 and D#3.

    The triad's are its root, third, and fifth, then the root and the third an octave
    up. A colour from `harmony` takes the place of the upper root, and the ninth that of
    the upper third.
    """
    root = 40 + (tones[0] - 40) % 12 + shift
    third = (tones[1] - tones[0]) % 12
    upper = [12, 12 + third]
    added = colours(tones, harmony)
    upper[: len(added)] = added
    return [root + interval for interval in (0, third, 7, *upper)]


def notes(bar: int, state: State) -> list[tuple[int, float, float, int, int]]:
    """The notes of `bar` in `state`: (track, start, length, pitch, velocity).

    Times are seconds from the bar's start. The accompaniment is the offline test's
    (work/renderers/tests.py), with the piano's notes from `figure`.
    """
    level, shift = LEVELS[state.texture], SHIFTS[state.register]
    tones = chord(bar)
    result = []
    if state.texture != "still":
        at = 0.0
        for pitch, beats in line(bar):
            result.append((VIOLIN, at, beats * BEAT * 0.97, pitch + shift, min(127, level + 12)))
            at += beats * BEAT
    root = 28 + (tones[0] - 28) % 12 + max(0, shift)  # From E1 to D#2, or an octave up.
    pad = [p for p in range(48 + shift, 60 + shift) if p % 12 in tones]  # Three chord tones.
    if state.texture == "fast":
        result += [(BASS, beat * BEAT, BEAT * 0.9, root, level) for beat in range(4)]
    else:
        result.append((BASS, 0.0, BAR, root, level))
    if state.texture == "still":
        low = next(p for p in pad if p % 12 == tones[0])
        return result + [(STRINGS, 0.0, BAR, p, level - 8) for p in (low, low + 7)]
    if state.texture != "fast":
        result.append((CELLO, 0.0, BAR, root + 12, level - 10))
    piano = figure(tones, state.harmony, shift)
    if state.texture == "slow":
        for half in range(2):
            result += [(PIANO, half * 2 * BEAT, 2 * BEAT, p, level - 14) for p in piano[1:]]
        return result + [(STRINGS, 0.0, BAR, p, level - 8) for p in pad]
    steps = 8 if state.texture == "medium" else 16
    step = BAR / steps
    for i in range(steps):
        result.append((PIANO, i * step, step * 1.6, piano[UP_AND_DOWN[i]], level - 16))
    if state.texture == "fast":
        for i in range(8):
            result += [(PIZZICATO, i * BEAT / 2, BEAT / 2 * 0.8, p, level - 20) for p in pad]
    else:
        result += [(STRINGS, 0.0, BAR, p, level - 18) for p in pad]
    return result
