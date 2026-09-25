import math

import pytest

from sway.motion import MotionAnalyzer, PulseEstimator
from sway.schema import MotionFrame


@pytest.mark.parametrize("bpm", [60, 90, 120, 150, 180])
def test_pulse_from_event_timestamps(bpm):
    estimator = PulseEstimator()
    for i in range(12):
        estimator.observe(i * 60 / bpm)
    assert estimator.bpm == pytest.approx(bpm)
    assert estimator.confidence == pytest.approx(1)
    estimator.expire(12 * 60 / bpm + 3)
    assert estimator.confidence == 0


def test_duplicate_events_and_long_gap():
    estimator = PulseEstimator()
    for i in range(8):
        estimator.observe(i * 0.5)
        estimator.observe(i * 0.5 + 0.05)
        estimator.observe(i * 0.5)
    assert estimator.bpm == pytest.approx(120)
    for i in range(8):
        estimator.observe(10 + i * 60 / 90)
    assert estimator.bpm == pytest.approx(90)


def hand_frame(seconds, bpm=120):
    points = [{"x": 0.5, "y": 0.5, "z": 0} for _ in range(21)]
    points[5] = {"x": 0.4, "y": 0.4, "z": 0}
    points[17] = {"x": 0.6, "y": 0.4, "z": 0}
    points[8] = {"x": 0.4, "y": 0.3 + 0.035 * math.sin(seconds * bpm / 60 * math.tau)}
    return MotionFrame(timestamp_ms=seconds * 1000, hands=[{"side": "Right", "points": points}])


@pytest.mark.parametrize("bpm", [90, 120, 150])
def test_smooth_finger_strokes_produce_rhythm(bpm):
    motion = MotionAnalyzer()
    for i in range(360):
        rhythm = motion.update(hand_frame(i / 30, bpm))
    assert rhythm.bpm == pytest.approx(bpm, abs=3)
    assert rhythm.confidence > 0.8
    assert rhythm.accents > 10


def test_tracking_gap_does_not_create_false_onset():
    motion = MotionAnalyzer()
    motion.update(hand_frame(0))
    motion.update(hand_frame(0.033))
    after = motion.update(hand_frame(1.5))
    assert not after.event
    count = after.accents
    assert motion.update(hand_frame(1.4)).accents == count
    assert not motion.update(MotionFrame(timestamp_ms=1600)).event
    assert not motion.update(hand_frame(1.7)).event
