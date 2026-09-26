"""Small, validated messages exchanged by sensing, interpretation, and music."""

from typing import Literal

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


class SessionOptions(BaseModel):
    palette: Literal["chamber", "nocturne", "groove"] = "chamber"
    semantics: bool = True
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
