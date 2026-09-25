import pytest

from sway.controller import MusicalController
from sway.motion import Rhythm
from sway.schema import SemanticIntent, SessionOptions


def test_semantics_require_repeated_evidence_and_unknown_holds():
    controller = MusicalController(SessionOptions())
    controller.motion(Rhythm(hands=1), 0)
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
    controller.motion(Rhythm(bpm=120, confidence=0.9), 1)
    assert controller.tempo == 120
    controller.options.follow_motion = False
    controller.motion(Rhythm(bpm=150, confidence=0.9), 2)
    assert controller.tempo == 120
