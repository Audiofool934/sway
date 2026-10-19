"""Musical worlds for V2: where a piece starts, and what its arranger may choose from.

A world sets the tempo, the key, the chords, the four style corners that the hands blend,
and the sections a piece moves through. Each section has a default direction for the
sound and default chords, which play whenever the arranger has not planned the phrase.
docs/v2-design.md describes how the hands, the arranger, and the model share the music.
"""

from dataclasses import dataclass

FRAME = 0.04  # Seconds in one model frame.


@dataclass(frozen=True)
class Section:
    name: str
    meaning: str  # What the section does in the piece, for the arranger.
    direction: str  # The default direction for the sound, in words MRT2's style reads.
    chords: tuple[str, ...]  # The default chords, one a bar, for one phrase.
    after: str  # The section the world's own plan moves on to.


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
    corners: tuple[str, str, str, str]
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


FILM_SCORE = World(
    name="Film score",
    key="D minor",
    tempo=80,  # A bar is 3 s, so a phrase of four bars is 12 s.
    beats_per_bar=4,
    phrase_bars=4,
    # Only chords from the scale, so that the hands can open the harmony to the whole
    # scale without a note clashing with the chord.
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
    # The ensemble corners that Everett heard as continuous on October 19; their
    # instruments, not register words, move the register (docs/steered-page.md).
    corners=(
        "Calm cinematic ensemble: slow sustained cellos and double bass with soft low "
        "piano chords, warm and continuous, instrumental",
        "Calm cinematic ensemble: slow sustained high violins and soft high piano, airy, "
        "bright and continuous, instrumental",
        "Energetic cinematic ensemble: fast rhythmic low piano arpeggios and pulsing "
        "staccato cellos over a driving double bass, continuous, instrumental",
        "Energetic cinematic ensemble: fast rhythmic high piano arpeggios and pulsing "
        "staccato violins, bright and continuous, instrumental",
    ),
    sections=(
        Section(
            name="intro",
            meaning="The opening: sparse and quiet, setting the scene.",
            direction="Sparse and quiet opening: a soft solo piano over distant sustained "
            "strings, intimate, instrumental",
            chords=("Dm", "Bb", "F", "C"),
            after="build",
        ),
        Section(
            name="build",
            meaning="Tension gathers: more instruments and more motion, rising.",
            direction="Building tension: ostinato strings gather and horns enter softly, "
            "rising, instrumental",
            chords=("Dm", "Gm", "Bb", "C"),
            after="peak",
        ),
        Section(
            name="peak",
            meaning="The climax: the full orchestra, the largest sound of the piece.",
            direction="Climax: the full orchestra with soaring strings, bold brass, and "
            "timpani, powerful, instrumental",
            chords=("Bb", "F", "C", "Dm"),
            after="release",
        ),
        Section(
            name="release",
            meaning="After a climax: the music breathes and softens.",
            direction="Release: the orchestra falls away to a solo cello and piano, "
            "tender and spacious, instrumental",
            chords=("Gm", "Dm", "Bb", "Am"),
            after="build",
        ),
    ),
    first="intro",
)
