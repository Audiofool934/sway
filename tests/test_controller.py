import pytest

from sway.controller import MusicalController
from sway.gestures import Gesture
from sway.motion import Rhythm
from sway.schema import SemanticIntent, SessionOptions


def test_semantics_require_repeated_evidence_and_unknown_holds():
    controller = MusicalController(SessionOptions())
    controller.motion(Rhythm(hands=1, gesture=Gesture(finger_speed=1, open_fingers=4)), 0)
    piano = SemanticIntent(action="piano", articulation="detached", confidence=0.9)
    assert not controller.semantic(piano, 0)
    assert controller.action == "unknown"
    assert controller.semantic(piano, 2)
    assert controller.action == "piano"
    assert not controller.semantic(SemanticIntent(action="unknown", confidence=1), 4)
    assert controller.action == "piano"
    low = SemanticIntent(action="strum", confidence=0.3)
    controller.semantic(low, 6)
    controller.semantic(low, 8)
    assert controller.action == "piano"


def test_semantic_hallucination_without_tracked_hands_cannot_change_music():
    controller = MusicalController(SessionOptions())
    hallucination = SemanticIntent(action="piano", confidence=1)
    controller.semantic(hallucination, 0)
    controller.semantic(hallucination, 2)
    assert controller.action == "unknown"


def test_tracking_loss_fades_and_reacquisition_restores():
    controller = MusicalController(SessionOptions())
    assert controller.snapshot(100)["tracking_gain"] == 1
    controller.motion(Rhythm(hands=1), 100)
    assert controller.snapshot(101)["tracking_gain"] == 1
    assert controller.snapshot(103)["tracking_gain"] == pytest.approx(0.5)
    assert controller.snapshot(105)["tracking_gain"] == 0
    controller.motion(Rhythm(hands=1), 106)
    assert controller.snapshot(106)["tracking_gain"] == 1


def test_manual_tempo_and_low_confidence_are_preserved():
    controller = MusicalController(SessionOptions(tempo=108))
    controller.motion(Rhythm(bpm=150, confidence=0.1), 0)
    assert controller.tempo == 108
    controller.motion(Rhythm(hands=1, bpm=120, confidence=0.9), 1)
    assert controller.tempo == 108
    controller.options.follow_motion = False
    controller.motion(Rhythm(bpm=150, confidence=0.9), 2)
    assert controller.tempo == 108


def test_low_confidence_observations_cannot_hold_old_piano_indefinitely():
    controller = MusicalController(SessionOptions())
    controller.motion(Rhythm(hands=1, gesture=Gesture(finger_speed=1, open_fingers=4)), 0)
    piano = SemanticIntent(action="piano", confidence=0.9)
    controller.semantic(piano, 0)
    controller.semantic(piano, 4)
    assert controller.action == "piano"
    for t in (8, 12, 16, 20):
        controller.motion(Rhythm(hands=1), t)
        controller.semantic(SemanticIntent(action="strum", confidence=0), t)
    assert controller.snapshot(20)["action"] == "unknown"
    assert controller.snapshot(20)["action_source"] == "none"


def test_ai_cannot_overrule_a_clear_strumming_mapping_with_piano():
    controller = MusicalController(SessionOptions())
    rhythm = Rhythm(
        hands=1, gesture=Gesture(action="strum", confidence=0.9, wrist_speed=2, finger_speed=1)
    )
    for t in (0, 0.4, 0.8):
        controller.motion(rhythm, t)
    for t in (1, 1.5):
        controller.semantic(SemanticIntent(action="piano", confidence=1), t)
    assert controller.action == "strum"
    assert controller.snapshot(1.5)["action_source"] == "gesture"


def test_expired_mapping_returns_to_open_without_resetting_tempo():
    controller = MusicalController(SessionOptions(tempo=125, semantics=False))
    rhythm = Rhythm(hands=1, gesture=Gesture(action="strike", confidence=0.9))
    controller.motion(rhythm, 0)
    controller.motion(rhythm, 0.8)
    assert controller.action == "strike"
    state = controller.snapshot(4)
    assert state["action"] == "unknown"
    assert state["bpm"] == 125
