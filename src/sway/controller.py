"""Persistent musical state with fast mapped gestures and optional AI context."""

from dataclasses import asdict

from .motion import Rhythm
from .schema import SemanticIntent, SessionOptions


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
        if self.options.follow_motion and rhythm.bpm and rhythm.confidence >= 0.4:
            self.tempo = rhythm.bpm
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

    def semantic(self, intent: SemanticIntent, now: float) -> bool:
        self.last_semantic = intent.model_dump()
        self._expire(now)
        if not self.options.semantics:
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
            "energy": round(self.energy, 3),
            "palette": self.options.palette,
            "tracking_gain": gain,
            "rhythm": asdict(self.rhythm),
            "last_semantic": self.last_semantic,
            "semantic_updates": self.semantic_updates,
        }
