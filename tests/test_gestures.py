"""Temporal trajectories exercise the complete landmarks -> controller path."""

import math

from sway.controller import MusicalController
from sway.motion import MotionAnalyzer
from sway.schema import MotionFrame, SessionOptions


def gesture_frame(t, action, height=0.55, *, scale=1.0):
    wave = math.sin(t * math.tau * 2)
    x = 0.56 + (0.12 * wave if action == "strum" else 0)
    y = height + (0.12 * wave if action in ("strike", "guitar") else 0)
    if action == "sustain":
        x = 0.4 + t * 0.04
    points = [{"x": x, "y": y, "z": 0.0} for _ in range(21)]
    points[5] = {"x": x - 0.08 * scale, "y": y - 0.09 * scale}
    points[17] = {"x": x + 0.08 * scale, "y": y - 0.09 * scale}
    for digit, index in enumerate((4, 8, 12, 16, 20)):
        points[index] = {"x": x + (digit - 2) * 0.035 * scale, "y": y - 0.21 * scale}
    if action == "piano":
        points[8]["y"] += 0.045 * wave
    hands = [{"side": "Right", "points": points}]
    if action == "guitar":
        anchor = [{"x": p["x"] - x + 0.2, "y": p["y"] - y + height} for p in points]
        hands.append({"side": "Left", "points": anchor})
    return MotionFrame(timestamp_ms=t * 1000, hands=hands)


def run_gesture(action, height=0.55):
    motion = MotionAnalyzer()
    controller = MusicalController(SessionOptions(semantics=False))
    for i in range(120):
        rhythm = motion.update(gesture_frame(i / 30, action, height))
        controller.motion(rhythm, i / 30)
    return controller, rhythm


def test_different_trajectories_change_the_accepted_musical_action():
    for gesture, expected in (
        ("piano", "piano"),
        ("strum", "strum"),
        ("strike", "strike"),
        ("guitar", "strum"),
        ("sustain", "sustain"),
        ("still", "still"),
    ):
        controller, rhythm = run_gesture(gesture)
        assert rhythm.gesture.action == expected, (gesture, rhythm.gesture)
        assert controller.snapshot(4)["action"] == expected
        assert controller.snapshot(4)["action_source"] == "gesture"


def test_switching_from_fingers_to_strumming_does_not_stay_on_piano():
    motion = MotionAnalyzer()
    controller = MusicalController(SessionOptions())
    for i in range(240):
        action = "piano" if i < 120 else "strum"
        controller.motion(motion.update(gesture_frame(i / 30, action)), i / 30)
        if i == 119:
            assert controller.action == "piano"
    assert controller.action == "strum"


def test_hand_height_changes_register_without_changing_the_action():
    low, _ = run_gesture("piano", 0.75)
    high, _ = run_gesture("piano", 0.25)
    assert high.snapshot(4)["register"] > low.snapshot(4)["register"] + 0.5
    assert high.action == low.action == "piano"


def test_change_in_apparent_hand_size_does_not_become_a_wrist_strike():
    motion = MotionAnalyzer()
    for i in range(120):
        rhythm = motion.update(gesture_frame(i / 30, "still", scale=1 + 0.1 * math.sin(i / 3)))
    assert rhythm.gesture.wrist_speed == 0
    assert rhythm.gesture.action == "still"
    assert rhythm.accents == 0


def test_manual_choice_is_not_replaced_by_the_map():
    motion = MotionAnalyzer()
    controller = MusicalController(
        SessionOptions(semantics=False, gesture_mapping=False, action="sustain")
    )
    for i in range(120):
        controller.motion(motion.update(gesture_frame(i / 30, "strike")), i / 30)
    assert controller.action == "sustain"
    assert controller.snapshot(4)["action_source"] == "manual"


def test_one_finger_motion_without_repetition_does_not_select_piano():
    motion = MotionAnalyzer()
    controller = MusicalController(SessionOptions(semantics=False))
    for i in range(90):
        t = i / 30
        frame = gesture_frame(t, "still")
        if 15 <= i < 30:
            frame.hands[0].points[8].y += 0.06 * math.sin((i - 15) / 15 * math.pi)
        controller.motion(motion.update(frame), t)
        assert controller.action != "piano"
