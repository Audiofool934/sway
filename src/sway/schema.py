"""Small, validated messages exchanged by sensing, interpretation, and music."""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

Action = Literal["piano", "strum", "strike", "sustain", "still", "unknown"]


class Point(BaseModel):
    x: float = Field(ge=-5, le=5, allow_inf_nan=False)
    y: float = Field(ge=-5, le=5, allow_inf_nan=False)
    z: float = Field(default=0, ge=-5, le=5, allow_inf_nan=False)


class Hand(BaseModel):
    side: Literal["Left", "Right"]
    points: list[Point] = Field(min_length=21, max_length=21)


class MotionFrame(BaseModel):
    timestamp_ms: float = Field(ge=0, allow_inf_nan=False)
    hands: list[Hand] = Field(default_factory=list, max_length=2)
    pose: list[Point] = Field(default_factory=list, max_length=33)


class SemanticIntent(BaseModel):
    model_config = ConfigDict(extra="forbid")
    action: Action
    articulation: Literal["detached", "flowing", "accented", "unknown"] = "unknown"
    confidence: float = Field(default=0, ge=0, le=1, allow_inf_nan=False)


class EnsemblePart(BaseModel):
    model_config = ConfigDict(extra="forbid")
    instrument: str = Field(min_length=1, max_length=48)
    role: Literal["melody", "harmony", "rhythm", "bass", "texture"]
    source: Literal["left_hand", "right_hand", "both_hands", "body", "scene", "accompaniment"]


MidiPitch = Annotated[int, Field(strict=True, ge=36, le=84)]
Chord = Annotated[list[MidiPitch], Field(min_length=2, max_length=5)]


class Arrangement(BaseModel):
    model_config = ConfigDict(extra="forbid")
    parts: list[EnsemblePart] = Field(min_length=1, max_length=4)
    description: str = Field(min_length=1, max_length=160)
    chords: list[Chord] = Field(min_length=1, max_length=4)
    pulse_beats: Literal[1, 2, 4] = 2
    energy: float = Field(default=0.5, ge=0, le=1, allow_inf_nan=False)


class EnsembleIntent(Arrangement):
    tempo_direction: Literal["hold", "faster", "slower"] = "hold"
    confidence: float = Field(ge=0, le=1, allow_inf_nan=False)


class SessionOptions(BaseModel):
    palette: Literal["chamber", "nocturne", "groove"] = "chamber"
    music_backend: Literal["local", "colab"] = "local"
    semantics: bool = True
    semantic_backend: Literal["local", "qwen"] = "local"
    gesture_mapping: bool = True
    action: Action = "unknown"
    tempo: float = Field(default=108, ge=50, le=180, allow_inf_nan=False)
    follow_motion: bool = True


class SemanticClip(BaseModel):
    frames: list[str] = Field(min_length=2, max_length=4)
    timestamps_ms: list[float] = Field(min_length=2, max_length=4)


class ManualControl(BaseModel):
    action: Action | None = None
    tempo: float | None = Field(default=None, ge=50, le=180, allow_inf_nan=False)
    follow_motion: bool | None = None
    camera_active: bool | None = None


# The V1 instrument's generated harmony: the page sends each bar's chord to be rendered.
HarmonyPalette = Literal["strings", "piano", "choir"]


class HarmonyStart(BaseModel):
    model_config = ConfigDict(extra="forbid")
    palette: HarmonyPalette
    seed: int = Field(ge=0, le=2**31 - 1)


class HarmonyBar(BaseModel):
    model_config = ConfigDict(extra="forbid")
    bar: int = Field(ge=0, le=1_000_000)
    voicing: list[Annotated[int, Field(ge=21, le=108)]] = Field(min_length=1, max_length=8)
    tones: list[Annotated[int, Field(ge=0, le=11)]] = Field(min_length=1, max_length=7)
    palette: HarmonyPalette
    stream: int = Field(ge=0, le=2**31 - 1)  # The seed its piece started with.
    tempo: float = Field(ge=40, le=240, allow_inf_nan=False)
    beats_per_bar: int = Field(ge=1, le=12)
