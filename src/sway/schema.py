"""Validated messages between the page and the local server."""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

# The V1 instrument's generated harmony: the page sends each bar's chord to be rendered.
HarmonyPalette = Literal["strings", "piano", "choir"]


class HarmonyStart(BaseModel):
    model_config = ConfigDict(extra="forbid")
    palette: HarmonyPalette
    seed: int = Field(ge=0, le=2**31 - 1)


class HarmonyNote(BaseModel):
    """A note of one bar, in beats from its start; a tied note continues from the last bar."""

    model_config = ConfigDict(extra="forbid")
    pitch: int = Field(ge=21, le=108)
    start: float = Field(ge=0, lt=12, allow_inf_nan=False)
    length: float = Field(gt=0, le=12, allow_inf_nan=False)
    tie: bool = False


class HarmonyBar(BaseModel):
    model_config = ConfigDict(extra="forbid")
    bar: int = Field(ge=0, le=1_000_000)
    notes: list[HarmonyNote] = Field(min_length=1, max_length=48)
    tones: list[Annotated[int, Field(ge=0, le=11)]] = Field(min_length=1, max_length=7)
    palette: HarmonyPalette
    stream: int = Field(ge=0, le=2**31 - 1)  # The seed its piece started with.
    tempo: float = Field(ge=40, le=240, allow_inf_nan=False)
    beats_per_bar: int = Field(ge=1, le=12)

    @model_validator(mode="after")
    def notes_fit_the_bar(self):
        if any(note.start + note.length > self.beats_per_bar + 1e-6 for note in self.notes):
            raise ValueError("Every note must end within its bar")
        return self


# The band's composer: the page describes the music so far, and Qwen writes the next cycle.
ChordName = Annotated[str, Field(pattern=r"^[A-G][b#]?(m|maj7|m7|7|sus2|sus4|dim)?$")]
NoteName = Annotated[str, Field(pattern=r"^[A-G][b#]?[0-8]$")]
LevelName = Annotated[str, Field(pattern=r"^[A-Za-z ]{1,20}$")]


class PhraseNote(BaseModel):
    """A note on the ladder, in sixteenths from the start of its cycle."""

    model_config = ConfigDict(extra="forbid")
    rung: int = Field(ge=0, le=15)
    at: int = Field(ge=0, le=255)
    len: int = Field(ge=1, le=256)


class ComposeWorld(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(pattern=r"^[A-Za-z0-9 '-]{1,40}$")
    key: str = Field(pattern=r"^[A-G][b#]? (major|minor)$")
    tempo: float = Field(ge=40, le=240, allow_inf_nan=False)
    beats_per_bar: int = Field(ge=2, le=8)
    cycle_bars: int = Field(ge=1, le=8)
    vocabulary: list[ChordName] = Field(min_length=2, max_length=12)
    ladder: list[NoteName] = Field(min_length=5, max_length=16)
    levels: list[LevelName] = Field(min_length=2, max_length=8)


class ComposeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    world: ComposeWorld
    cycle: int = Field(ge=1, le=100_000)
    level: int = Field(ge=0, le=7)
    earlier_levels: list[Annotated[int, Field(ge=0, le=7)]] = Field(max_length=4)
    current: list[ChordName] = Field(min_length=1, max_length=8)
    history: list[ChordName] = Field(max_length=8)
    phrase: list[PhraseNote] = Field(max_length=64)
    previous_answer: list[PhraseNote] = Field(max_length=8)

    @model_validator(mode="after")
    def within_the_world(self):
        world = self.world
        if not all(chord in world.vocabulary for chord in self.current + self.history):
            raise ValueError("Chords must come from the world's vocabulary")
        if self.level >= len(world.levels) or any(
            level >= len(world.levels) for level in self.earlier_levels
        ):
            raise ValueError("Energy levels must be the world's")
        if any(note.rung >= len(world.ladder) for note in self.phrase + self.previous_answer):
            raise ValueError("Notes must be on the ladder")
        return self
