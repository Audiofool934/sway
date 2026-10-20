"""Musical worlds for V2: what the conductor's gestures act on, and what the composer uses.

A world sets the tempo, the key, the chords, and the sections a piece moves through, and
it gives meaning to the conductor's gestures, which are the same in every world
(docs/v2-design.md): three voices placed left, middle, and right, the words for calm and
driving playing, and the words for long and short notes. A world is data, so that a
language model can write one from the player's words in the same form.
"""

from dataclasses import dataclass
from itertools import product

FRAME = 0.04  # Seconds in one model frame.


@dataclass(frozen=True)
class Section:
    name: str
    meaning: str  # What the section does in the piece, for the composer.
    direction: str  # What the score is like here, in words MRT2's style reads.
    chords: tuple[str, ...]  # The default chords, one a bar, for one phrase.
    after: str  # The section the world's own plan moves on to.
    level: float = 0.0  # The score's dynamics, in dB, which the piece applies itself.


@dataclass(frozen=True)
class Voice:
    name: str  # As the page shows it.
    words: str  # As MRT2's style reads it, when the conductor brings it forward.


@dataclass(frozen=True)
class World:
    name: str
    key: str
    tempo: int
    beats_per_bar: int
    phrase_bars: int
    chords: dict[str, tuple[int, ...]]  # Pitch classes, root first.
    scale: frozenset[int]
    pentatonic: frozenset[int]
    ensemble: str  # What plays, such as "cinematic orchestra".
    voices: tuple[Voice, Voice, Voice]  # Left, middle, right.
    balanced: str  # The words when no voice is brought forward.
    calm: str  # The words for calm playing, and for driving playing.
    driving: str
    legato: str  # The words for long notes, and for short ones.
    staccato: str
    sections: tuple[Section, ...]
    first: str

    @property
    def bar_frames(self) -> int:
        frames = self.beats_per_bar * 60 / self.tempo / FRAME
        if abs(frames - round(frames)) > 1e-9:
            raise ValueError("A bar must last a whole number of model frames")
        return round(frames)

    @property
    def phrase_frames(self) -> int:
        return self.phrase_bars * self.bar_frames

    def section(self, name: str) -> Section:
        return next(section for section in self.sections if section.name == name)

    @property
    def corners(self) -> tuple[str, ...]:
        """The 16 style texts that the conductor's gestures blend.

        In order: the balanced orchestra, then each voice brought forward; within each,
        calm then driving; within each of those, long notes then short ones. Each corner
        is a whole description, so that a gesture at its extreme gets the corner's full
        effect, as the ensemble corners did on October 19.
        """
        leading = (self.balanced, *(voice.words for voice in self.voices))
        return tuple(
            f"{energy} {self.ensemble}, {lead}, {notes}, instrumental"
            for lead, energy, notes in product(
                leading, (self.calm, self.driving), (self.legato, self.staccato)
            )
        )


FILM_SCORE = World(
    name="Film score",
    key="D minor",
    tempo=80,  # A bar is 3 s, so a phrase of four bars is 12 s.
    beats_per_bar=4,
    phrase_bars=4,
    # Only chords from the scale, so that the melody's notes from the scale never
    # clash with the chord.
    chords={
        "Dm": (2, 5, 9),
        "Gm": (7, 10, 2),
        "Am": (9, 0, 4),
        "Bb": (10, 2, 5),
        "F": (5, 9, 0),
        "C": (0, 4, 7),
    },
    scale=frozenset({2, 4, 5, 7, 9, 10, 0}),
    pentatonic=frozenset({2, 5, 7, 9, 0}),
    ensemble="cinematic orchestra",
    # Measured on October 19: bringing the violins or the low strings forward moved the
    # register in every seed, half the change in 0.9 s; the brass came out darker than
    # the strings, not brighter, but just as distinct (docs/v2-design.md).
    voices=(
        Voice(
            "Violins",
            "the violins in front with a soaring high melody, the rest soft behind",
        ),
        Voice(
            "Brass",
            "the brass in front, bold horns carrying the melody, the strings soft behind",
        ),
        Voice(
            "Cellos and basses",
            "the cellos and double basses in front with a deep melody, the rest soft behind",
        ),
    ),
    balanced="the whole orchestra balanced",
    calm="Calm, slow, and sustained",
    driving="Energetic, driving, and rhythmic",
    legato="long smooth legato lines",
    staccato="short detached staccato notes and pizzicato strings",
    # The score's dynamics in each section, not which voice leads: that is the
    # conductor's. The words color the sound but are not reliable: as a fifth of the
    # style, they often leave MRT2's six coarse style tokens unchanged. On October 19 the
    # peak's "fortissimo" came out louder than the intro's "pianissimo" in all six seeds,
    # but the release, in two different wordings, came out louder than the build in all
    # six. So each section's level is also applied as a gain, which is exact.
    sections=(
        Section(
            name="intro",
            meaning="The opening: sparse and quiet, setting the scene.",
            direction="Cinematic orchestra playing pianissimo: very soft, delicate, and "
            "hushed, instrumental",
            chords=("Dm", "Bb", "F", "C"),
            after="build",
            level=-6.0,
        ),
        Section(
            name="build",
            meaning="Tension gathers: more instruments and more motion, rising.",
            direction="Cinematic orchestra playing mezzo forte and growing louder, tension "
            "rising, instrumental",
            chords=("Dm", "Gm", "Bb", "C"),
            after="peak",
            level=-3.0,
        ),
        Section(
            name="peak",
            meaning="The climax: the full orchestra, the largest sound of the piece.",
            direction="Cinematic orchestra playing fortissimo: loud, powerful, at full force, "
            "instrumental",
            chords=("Bb", "F", "C", "Dm"),
            after="release",
            level=0.0,
        ),
        Section(
            name="release",
            meaning="After a climax: the music breathes and softens.",
            direction="Cinematic orchestra playing softly and tenderly, quiet and spacious, "
            "instrumental",
            chords=("Gm", "Dm", "Bb", "Am"),
            after="build",
            level=-6.0,
        ),
    ),
    first="intro",
)
