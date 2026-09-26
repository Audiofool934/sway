"""An explicit, training-free vocabulary from recent hand trajectories.

These are playable gesture mappings, not an open-ended instrument recognizer.
"""

import math
import statistics
from collections import deque
from dataclasses import dataclass

from .schema import Hand, MotionFrame


def hand_signal(hand: Hand):
    points = hand.points
    wrist = points[0]
    across = (points[17].x - points[5].x, points[17].y - points[5].y)
    scale = max(0.045, math.hypot(*across))
    middle = ((points[5].x + points[17].x) / 2, (points[5].y + points[17].y) / 2)
    down = (wrist.x - middle[0], wrist.y - middle[1])
    length = math.hypot(*down)
    dy = (down[0] / length, down[1] / length) if length > 0.015 else (0, 1)
    dx = (dy[1], -dy[0])
    tips = []
    for index in (4, 8, 12, 16, 20):
        x, y = points[index].x - wrist.x, points[index].y - wrist.y
        tips.append(((x * dx[0] + y * dx[1]) / scale, (x * dy[0] + y * dy[1]) / scale))
    return wrist.x, wrist.y, scale, tips


@dataclass
class Gesture:
    action: str = "unknown"
    confidence: float = 0
    articulation: str = "unknown"
    register: float = 0.5
    wrist_speed: float = 0
    finger_speed: float = 0
    open_fingers: float = 0
    horizontal: float = 0
    vertical: float = 0
    reason: str = "Show your hands"


class GestureMapper:
    def __init__(self):
        self.previous = {}
        self.history = deque(maxlen=180)
        self.strokes = {}
        self.finger_events = deque(maxlen=16)
        self.register = 0.5
        self.last_time = None

    def update(self, frame: MotionFrame, *, finger_event=False) -> Gesture:
        t = frame.timestamp_ms / 1000
        dt = t - self.last_time if self.last_time is not None else 0
        if self.last_time is not None and dt <= 0:
            return self.describe()
        self.last_time = t
        if dt > 0.25 or not frame.hands:
            self.previous.clear()
            self.history.clear()
            self.strokes.clear()
            self.finger_events.clear()
        if not frame.hands:
            return Gesture(register=self.register)
        if finger_event:
            self.finger_events.append(t)
        while self.finger_events and t - self.finger_events[0] > 2:
            self.finger_events.popleft()
        heights, observations, current = [], {}, {}
        for hand in frame.hands:
            x, y, scale, tips = hand_signal(hand)
            heights.append(max(0, min(1, (0.85 - y) / 0.65)))
            prior = self.previous.get(hand.side)
            vx = vy = finger = 0.0
            reversal = 0
            if prior is not None and 0.008 <= dt <= 0.25:
                px, py, old_scale, old_tips = prior
                size = (scale + old_scale) / 2
                vx, vy = (x - px) / size / dt, (y - py) / size / dt
                finger = max(math.dist(a, b) / dt for a, b in zip(tips, old_tips, strict=True))
                strokes = self.strokes.setdefault(hand.side, [(0, 0.0), (0, 0.0)])
                for axis, delta in enumerate(((x - px) / size, (y - py) / size)):
                    direction, distance = strokes[axis]
                    sign = 1 if delta > 0 else -1 if delta < 0 else direction
                    if direction and sign != direction:
                        reversal += int(abs(distance) > 0.15)
                        distance = 0.0
                    strokes[axis] = (sign, distance + delta)
                vx, vy = max(-12, min(12, vx)), max(-12, min(12, vy))
                finger = min(12, finger)
            current[hand.side] = (x, y, scale, tips)
            points = hand.points
            origin = (points[0].x, points[0].y, points[0].z)

            distances = [math.dist((p.x, p.y, p.z), origin) for p in points]
            extended = sum(
                distances[tip] > distances[pip] * 1.1
                for tip, pip in ((8, 6), (12, 10), (16, 14), (20, 18))
            )
            observations[hand.side] = (abs(vx), abs(vy), finger, reversal, x, extended)
        self.previous = current
        self.strokes = {side: value for side, value in self.strokes.items() if side in current}
        alpha = 1 - math.exp(-max(dt, 0) / 0.25)
        self.register += alpha * (statistics.mean(heights) - self.register)
        self.history.append((t, observations))
        while self.history and t - self.history[0][0] > 1.2:
            self.history.popleft()
        return self.describe()

    def describe(self) -> Gesture:
        result = Gesture(register=round(self.register, 3), reason="Listening for a gesture")
        if not self.history or self.history[-1][0] - self.history[0][0] < 0.35:
            return result
        sides = {side for _, hands in self.history for side in hands}
        summaries = []
        for side in sides:
            values = [hands[side] for _, hands in self.history if side in hands]
            if len(values) < 5:
                continue
            x, y, finger = (statistics.mean(v[i] for v in values) for i in range(3))
            reversals = sum(v[3] for v in values)
            summaries.append(
                (
                    x,
                    y,
                    finger,
                    reversals,
                    statistics.mean(v[4] for v in values),
                    statistics.mean(v[5] for v in values),
                )
            )
        if not summaries:
            return result
        moving = max(summaries, key=lambda s: math.hypot(s[0], s[1]))
        x, y, _, reversals, _, _ = moving
        wrist = math.hypot(x, y)
        finger = max(s[2] for s in summaries)
        result.wrist_speed = round(wrist, 3)
        result.finger_speed = round(finger, 3)
        result.open_fingers = round(max(s[5] for s in summaries), 1)
        result.horizontal, result.vertical = round(x, 3), round(y, 3)
        anchored_guitar = False
        if len(summaries) == 2:
            other = min(summaries, key=lambda s: math.hypot(s[0], s[1]))
            quiet = math.hypot(other[0], other[1])
            anchored_guitar = (
                wrist > 0.9
                and quiet < 0.65
                and wrist > quiet * 2.5
                and abs(moving[4] - other[4]) > 0.16
            )
        independent_fingers = finger > 0.65 and (
            (wrist < 0.75 and finger > wrist * 1.6) or (wrist < 1.8 and finger > wrist * 3)
        )
        if (
            independent_fingers
            and not anchored_guitar
            and result.open_fingers >= 1.5
            and len(self.finger_events) >= 2
        ):
            result.action, result.articulation, result.confidence = "piano", "detached", 0.8
            result.reason = "Finger movement dominates the wrist movement"
        elif reversals >= 2 and (anchored_guitar or (x > 0.8 and x > y * 1.35)):
            result.action, result.articulation, result.confidence = "strum", "detached", 0.85
            result.reason = (
                "Repeated side-to-side strokes"
                if not anchored_guitar
                else "Strumming hand with a steady fret hand"
            )
        elif y > 0.9 and y > x * 1.25 and reversals >= 2:
            result.action, result.articulation, result.confidence = "strike", "accented", 0.85
            result.reason = "Repeated whole-hand downstrokes"
        elif 0.2 < wrist < 1.2 and reversals < 2:
            result.action, result.articulation, result.confidence = "sustain", "flowing", 0.7
            result.reason = "A slow continuous sweep"
        elif wrist < 0.15 and finger < 0.25:
            result.action, result.articulation, result.confidence = "still", "flowing", 0.8
            result.reason = "Hands at rest"
        return result
