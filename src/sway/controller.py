"""A persistent musical state combining fast events with slower interpretations."""

from dataclasses import asdict

from .motion import Rhythm
from .schema import SemanticIntent, SessionOptions


class MusicalController:
    def __init__(self, options: SessionOptions):
        self.options = options
        self.action = options.action
        self.articulation = "unknown"
        self.tempo = options.tempo
        self.energy = 0.0
        self.rhythm = Rhythm()
        self.last_seen = None
        self.pending_action = None
        self.pending_count = 0
        self.semantic_updates = 0
        self.last_semantic = None

    def motion(self, rhythm: Rhythm, now: float) -> None:
        self.rhythm = rhythm
        self.energy = rhythm.energy
        if rhythm.hands:
            self.last_seen = now
        if self.options.follow_motion and rhythm.bpm and rhythm.confidence >= 0.4:
            self.tempo = rhythm.bpm

    def semantic(self, intent: SemanticIntent, now: float) -> bool:
        self.last_semantic = intent.model_dump()
        if not self.rhythm.hands or intent.action == "unknown" or intent.confidence < 0.55:
            self.pending_action = None
            self.pending_count = 0
            return False
        if intent.action == self.pending_action:
            self.pending_count += 1
        else:
            self.pending_action = intent.action
            self.pending_count = 1
        # Debounce interpretations; self-reported confidence is not calibrated.
        if self.pending_count < 2:
            return False
        changed = self.action != intent.action or self.articulation != intent.articulation
        self.action = intent.action
        self.articulation = intent.articulation
        self.semantic_updates += 1
        return changed

    def snapshot(self, now: float) -> dict:
        missing = max(0, now - self.last_seen) if self.last_seen is not None else 0
        gain = max(0, 1 - max(0, missing - 2) / 2)
        return {
            "action": self.action,
            "articulation": self.articulation,
            "bpm": round(self.tempo, 1),
            "energy": round(self.energy, 3),
            "palette": self.options.palette,
            "tracking_gain": gain,
            "rhythm": asdict(self.rhythm),
            "last_semantic": self.last_semantic,
            "semantic_updates": self.semantic_updates,
        }
