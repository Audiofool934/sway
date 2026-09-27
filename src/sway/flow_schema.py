"""Named, validated musical requests; camera images never enter this protocol."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class FlowRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    type: Literal["generate", "transform"]
    prompt: str = Field(min_length=3, max_length=1000)
    bpm: int = Field(default=96, ge=60, le=160)
    bars: Literal[4, 8] = 8
    key: str = Field(default="A minor", pattern=r"^[A-G][#b]? (major|minor)$")
    seed: int = Field(default=557, ge=0, le=2**31 - 1)
    strength: float = Field(default=0.3, ge=0.15, le=0.55, allow_inf_nan=False)
    anchor: str | None = Field(default=None, pattern=r"^[a-f0-9]{32}$")

    @property
    def seconds(self):
        return self.bars * 4 * 60 / self.bpm


class FlowWireRequest(FlowRequest):
    source_sha256: str | None = Field(default=None, pattern=r"^[a-f0-9]{64}$")
