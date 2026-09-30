"""Persistent musical intent; Qwen conducts the ensemble when selected."""

import math
from dataclasses import asdict

from .ensemble import opening_arrangement
from .motion import Rhythm
from .schema import Arrangement, EnsembleIntent, SemanticIntent, SessionOptions


class MusicalController:
    def __init__(self, options: SessionOptions):
        self.options = options
        self.action = options.action
        self.articulation = "unknown"
        self.action_source = "manual" if not options.gesture_mapping else "none"
        self.action_at = None
        self.tempo = options.tempo
        self.energy = 0.0
        self.rhythm = Rhythm()
        self.last_seen = None
        self.pending_action = None
        self.pending_count = 0
        self.pending_gesture = None
        self.gesture_since = 0.0
        self.semantic_updates = 0
        self.last_semantic = None
        self.conducted = options.semantics and options.semantic_backend == "qwen"
        self.arrangement = opening_arrangement(options.palette)
        self.arrangement_revision = 0
        self.tempo_cue = "hold"
        self.tempo_since = 0.0
        self.last_tempo_change = float("-inf")
        self.last_tempo_observation = float("-inf")

    def set_tempo(self, tempo):
        self.tempo = tempo
        self.tempo_cue = "hold"

    def _tempo_suggestion(self, direction, now):
        if not self.options.follow_motion:
            self.tempo_cue = "hold"
            return
        interrupted = now - self.last_tempo_observation > 10
        self.last_tempo_observation = now
        if direction != self.tempo_cue or interrupted:
            self.tempo_cue, self.tempo_since = direction, now
            return
        # Require sustained intent, not the timing of individual hand strikes.
        if direction == "hold" or now - self.tempo_since < 3 or now - self.last_tempo_change < 8:
            return
        self.tempo = max(50, min(180, self.tempo + (6 if direction == "faster" else -6)))
        self.last_tempo_change = now

    def _apply(self, action, articulation, source, now):
        changed = self.action != action or self.articulation != articulation
        self.action, self.articulation = action, articulation
        self.action_source, self.action_at = source, now
        return changed

    def manual(self, action):
        self._apply(action, "unknown", "manual", None)

    def motion(self, rhythm: Rhythm, now: float) -> None:
        self.rhythm = rhythm
        self.energy = rhythm.energy
        if rhythm.hands:
            self.last_seen = now
        if self.conducted:
            # Fast sensing supplies evidence to Qwen, not an overriding instrument rule.
            return
        direction = "hold"
        if rhythm.hands and rhythm.bpm and rhythm.confidence >= 0.65:
            candidates = [rhythm.bpm / 2, rhythm.bpm, rhythm.bpm * 2]
            pulse = min(candidates, key=lambda bpm: abs(math.log(bpm / self.tempo)))
            if pulse > self.tempo * 1.12:
                direction = "faster"
            elif pulse < self.tempo * 0.88:
                direction = "slower"
        self._tempo_suggestion(direction, now)
        gesture = rhythm.gesture
        if self.options.gesture_mapping and rhythm.hands and gesture.confidence >= 0.65:
            if gesture.action != self.pending_gesture:
                self.pending_gesture, self.gesture_since = gesture.action, now
            elif now - self.gesture_since >= 0.75:
                self._apply(gesture.action, gesture.articulation, "gesture", now)
                self.pending_action, self.pending_count = None, 0
        else:
            self.pending_gesture = None
        self._expire(now)

    def semantic(self, intent: SemanticIntent | EnsembleIntent, now: float) -> bool:
        self.last_semantic = intent.model_dump()
        if self.conducted:
            if not isinstance(intent, EnsembleIntent) or intent.confidence < 0.55:
                self.tempo_cue = "hold"
                return False
            arrangement = Arrangement.model_validate(
                intent.model_dump(exclude={"confidence", "tempo_direction"})
            )
            changed = self.arrangement != arrangement
            self.arrangement = arrangement
            self.arrangement_revision += int(changed)
            self.action_source, self.action_at = "qwen", now
            self.semantic_updates += 1
            self._tempo_suggestion(intent.tempo_direction, now)
            return changed
        self._expire(now)
        if not self.options.semantics or not isinstance(intent, SemanticIntent):
            return False
        features = self.rhythm.gesture
        # The VLM can add context, but cannot contradict a clear measured gesture.
        supported = {
            "piano": features.finger_speed > 0.3
            and features.wrist_speed < 1.0
            and features.open_fingers >= 1.5,
            "strum": features.wrist_speed > 0.3,
            "strike": features.vertical > 0.3,
            "sustain": features.wrist_speed > 0.15,
            "still": features.wrist_speed < 0.2 and features.finger_speed < 0.3,
        }.get(intent.action, False)
        if (
            not self.rhythm.hands
            or intent.confidence < 0.55
            or not supported
            or (self.action_source == "gesture" and now - self.action_at < 2)
        ):
            self.pending_action, self.pending_count = None, 0
            return False
        if intent.action == self.pending_action:
            self.pending_count += 1
        else:
            self.pending_action, self.pending_count = intent.action, 1
        if self.pending_count < 2:
            return False
        self.semantic_updates += 1
        return self._apply(intent.action, intent.articulation, "ai", now)

    def _expire(self, now):
        if self.conducted:
            return  # A rest or an uncertain observation should not dismantle the ensemble.
        if self.action_source in ("gesture", "ai") and self.action_at is not None:
            lifetime = 3 if self.action_source == "gesture" else 8
            if now - self.action_at > lifetime:
                self._apply("unknown", "unknown", "none", None)
                self.pending_action, self.pending_count = None, 0

    def snapshot(self, now: float) -> dict:
        self._expire(now)
        missing = max(0, now - self.last_seen) if self.last_seen is not None else 0
        gain = max(0, 1 - max(0, missing - 2) / 2)
        return {
            "action": self.action,
            "articulation": self.articulation,
            "action_source": self.action_source,
            "action_age": round(now - self.action_at, 1) if self.action_at is not None else None,
            "register": self.rhythm.gesture.register,
            "guided": bool(self.rhythm.hands),
            "bpm": round(self.tempo, 1),
            "tempo_cue": self.tempo_cue,
            "energy": round(self.energy, 3),
            "palette": self.options.palette,
            "tracking_gain": 1.0 if self.conducted else gain,
            "rhythm": asdict(self.rhythm),
            "last_semantic": self.last_semantic,
            "semantic_updates": self.semantic_updates,
            "conducted": self.conducted,
            "arrangement": self.arrangement.model_dump() if self.conducted else None,
            "arrangement_revision": self.arrangement_revision,
        }
