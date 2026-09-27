"""Causal motion features and event timing, independent of the language model."""

import math
import statistics
from collections import deque
from dataclasses import dataclass, field

from .gestures import Gesture, GestureMapper, hand_signal
from .schema import MotionFrame


@dataclass
class Rhythm:
    bpm: float | None = None
    confidence: float = 0
    energy: float = 0
    hands: int = 0
    accents: int = 0
    event: bool = False
    finger: int | None = None
    gesture: Gesture = field(default_factory=Gesture)
    per_hand: dict[str, Gesture] = field(default_factory=dict)


class PulseEstimator:
    """Robust inter-onset estimate; pulse/subdivision ambiguity remains explicit."""

    def __init__(self):
        self.events = deque(maxlen=14)
        self.bpm = None
        self.confidence = 0.0

    def observe(self, seconds: float) -> bool:
        if self.events and seconds <= self.events[-1]:
            return False
        if self.events and seconds - self.events[-1] < 0.16:
            return False  # Closely spaced fingers can belong to one chord or accent.
        if self.events and seconds - self.events[-1] > 2.0:
            self.events.clear()
            self.bpm = None
        self.events.append(seconds)
        intervals = [b - a for a, b in zip(self.events, list(self.events)[1:], strict=False)]
        if len(intervals) < 3:
            self.confidence = 0.0
            return True
        period = statistics.median(intervals)
        spread = statistics.median(abs(i - period) for i in intervals) / period
        tempo = 60 / period
        while tempo > 180:
            tempo /= 2
        while tempo < 50:
            tempo *= 2
        self.confidence = max(0.0, 1 - 4 * spread) * min(1.0, len(intervals) / 6)
        if self.confidence >= 0.4:
            self.bpm = tempo if self.bpm is None else 0.7 * self.bpm + 0.3 * tempo

        return True

    def expire(self, seconds: float) -> None:
        if self.events and seconds - self.events[-1] > 2:
            self.confidence = 0.0


class MotionAnalyzer:
    def __init__(self):
        self.last_time = None
        self.previous = {}
        self.last_accents = {}
        self.pulse = PulseEstimator()
        self.energy = 0.0
        self.total_accents = 0
        self.gestures = GestureMapper()
        self.gesture = Gesture()
        self.hand_mappers = {side: GestureMapper() for side in ("Left", "Right")}
        self.per_hand = {}

    def update(self, frame: MotionFrame) -> Rhythm:
        t = frame.timestamp_ms / 1000
        if self.last_time is not None and t <= self.last_time:
            return self.snapshot(len(frame.hands))
        dt = t - self.last_time if self.last_time is not None else 0
        self.last_time = t
        if dt > 0.25 or not frame.hands:
            self.previous.clear()
        event = False
        finger = None
        finger_sides = set()
        speeds = []
        present = set()
        for hand in frame.hands:
            wx, wy, scale, tips = hand_signal(hand)
            signals = {"wrist": (wx, wy), "sweep": (wy, wx)}
            signals.update({str(digit): tip for digit, tip in enumerate(tips)})
            for channel, (x, y) in signals.items():
                key = f"{hand.side}:{channel}"
                present.add(key)
                previous = self.previous.get(key)
                velocity = 0.0
                peak_velocity = 0.0
                stroke_distance = 0.0
                if previous is not None and 0.008 <= dt <= 0.25:
                    px, py, prior_velocity, prior_peak, prior_distance, old_scale = previous
                    units = (scale + old_scale) / 2 if channel in ("wrist", "sweep") else 1
                    velocity = (y - py) / dt / units
                    if velocity > 0:
                        peak_velocity = max(prior_peak, velocity)
                        stroke_distance = prior_distance + (y - py) / units
                    speed = math.hypot(x - px, y - py) / dt / units
                    speeds.append(min(speed, 8))
                    # A downward stroke ending in a reversal is a candidate onset.
                    threshold = 0.65 if channel not in ("wrist", "sweep") else 0.85
                    if (
                        prior_velocity > 0
                        and prior_peak > threshold
                        and prior_distance > 0.025
                        and velocity <= 0
                        and t - self.last_accents.get(key, -100) > 0.16
                    ):
                        event = True
                        finger = int(channel) if channel not in ("wrist", "sweep") else finger
                        if channel not in ("wrist", "sweep"):
                            finger_sides.add(hand.side)
                        self.last_accents[key] = t
                self.previous[key] = (x, y, velocity, peak_velocity, stroke_distance, scale)
        self.previous = {key: val for key, val in self.previous.items() if key in present}
        raw_energy = min(1.0, statistics.mean(speeds) / 3) if speeds else 0
        alpha = 1 - math.exp(-max(dt, 0) / 0.2)
        self.energy += alpha * (raw_energy - self.energy)
        if event:
            event = self.pulse.observe(t)
            self.total_accents += int(event)
        self.gesture = self.gestures.update(frame, finger_event=event and finger is not None)
        self.per_hand = {}
        for side, mapper in self.hand_mappers.items():
            hands = [hand for hand in frame.hands if hand.side == side]
            observation = mapper.update(
                MotionFrame(timestamp_ms=frame.timestamp_ms, hands=hands),
                finger_event=side in finger_sides,
            )
            if hands:
                # The worker processes unmirrored video; MediaPipe assumes a selfie image.
                performer_side = "Left" if side == "Right" else "Right"
                self.per_hand[performer_side] = observation
        self.pulse.expire(t)
        result = self.snapshot(len(frame.hands))
        result.event = event
        result.finger = finger
        return result

    def snapshot(self, hands: int = 0) -> Rhythm:
        return Rhythm(
            bpm=self.pulse.bpm,
            confidence=self.pulse.confidence,
            energy=self.energy,
            hands=hands,
            accents=self.total_accents,
            gesture=self.gesture,
            per_hand=self.per_hand,
        )
