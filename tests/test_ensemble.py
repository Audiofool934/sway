import queue
import threading
import time

import numpy as np
import pytest
from test_gestures import gesture_frame

from sway.controller import MusicalController
from sway.ensemble import EnsemblePulse, MusicalClock, ensemble_prompt, opening_arrangement
from sway.motion import MotionAnalyzer, Rhythm
from sway.remote_music import MusicControl
from sway.schema import EnsembleIntent, MotionFrame, SessionOptions
from sway.workers import music_worker


def two_hand_frame(t, second="strum"):
    frame = gesture_frame(t, "piano")  # Raw Right is the performer's left in unmirrored video.
    other = gesture_frame(t, second).hands[0]
    other.side = "Left"
    frame.hands.append(other)
    return frame


def duet(**changes):
    values = {
        "parts": [
            {"instrument": "acoustic piano", "role": "melody", "source": "left_hand"},
            {"instrument": "acoustic guitar", "role": "harmony", "source": "right_hand"},
        ],
        "description": "Warm interlocking phrases",
        "chords": [[48, 64, 67], [45, 60, 64]],
        "pulse_beats": 2,
        "energy": 0.5,
        "confidence": 0.9,
    }
    return EnsembleIntent(**(values | changes))


@pytest.mark.parametrize("second", ["strum", "strike"])
def test_simultaneous_hand_trajectories_survive_as_independent_observations(second):
    analyzer = MotionAnalyzer()
    controller = MusicalController(SessionOptions(semantic_backend="qwen"))
    for frame in range(150):
        t = frame / 30
        rhythm = analyzer.update(two_hand_frame(t, second))
        controller.motion(rhythm, t)
    assert rhythm.per_hand["Left"].action == "piano"
    assert rhythm.per_hand["Right"].action == second
    assert controller.action == "unknown"  # The classifier cannot decide Qwen's arrangement.
    assert controller.semantic(duet(), 5)
    for frame in range(150, 180):
        controller.motion(analyzer.update(two_hand_frame(frame / 30, second)), frame / 30)
    snapshot = controller.snapshot(6)
    assert {part["instrument"] for part in snapshot["arrangement"]["parts"]} == {
        "acoustic piano",
        "acoustic guitar",
    }
    assert snapshot["action_source"] == "qwen"


def test_a_missing_hand_does_not_leak_a_stale_gesture_into_the_next_observation():
    analyzer = MotionAnalyzer()
    for frame in range(150):
        analyzer.update(two_hand_frame(frame / 30))
    observation = analyzer.update(gesture_frame(5, "piano"))
    assert set(observation.per_hand) == {"Left"}
    assert not analyzer.update(MotionFrame(timestamp_ms=5100)).per_hand


def test_qwen_can_use_body_and_scene_without_hand_tracker_and_rest_preserves_music():
    controller = MusicalController(SessionOptions(semantic_backend="qwen"))
    assert controller.semantic(duet(), 1)
    controller.motion(Rhythm(hands=0, energy=0), 2)
    assert not controller.semantic(duet(description="Discard this", confidence=0.2), 5)
    assert controller.snapshot(30)["arrangement"]["description"] == "Warm interlocking phrases"
    assert controller.snapshot(30)["tracking_gain"] == 1
    assert controller.semantic(duet(description="A new phrase from the body's movement"), 31)


def test_jittery_hand_pulse_does_not_set_tempo_and_qwen_cues_need_persistence():
    controller = MusicalController(SessionOptions(semantic_backend="qwen"))
    for i, bpm in enumerate([150, 85, 140, 90, 120] * 30):
        controller.motion(Rhythm(hands=2, bpm=bpm, confidence=0.99), i / 30)
    assert controller.tempo == 108
    controller.semantic(duet(tempo_direction="faster"), 5)
    assert controller.tempo == 108
    controller.semantic(duet(tempo_direction="faster"), 8.5)
    assert controller.tempo == 114
    controller.semantic(duet(tempo_direction="faster"), 12)
    assert controller.tempo == 114
    controller.options.follow_motion = False
    controller.semantic(duet(tempo_direction="faster"), 17)
    assert controller.tempo == 114


def test_motion_only_tempo_ignores_subdivision_changes_and_short_noise():
    controller = MusicalController(SessionOptions(semantics=False, tempo=90))
    for i in range(200):
        bpm = 180 if i % 2 else 90
        controller.motion(Rhythm(hands=1, bpm=bpm, confidence=1), i / 30)
    assert controller.tempo == 90
    for i in range(200, 310):
        controller.motion(Rhythm(hands=1, bpm=120, confidence=1), i / 30)
    assert controller.tempo == 96


def test_clock_changes_tempo_only_on_bars_with_a_bounded_step():
    clock = MusicalClock(108)
    transitions = []
    for _ in range(500):
        previous = clock.bpm
        boundary = clock.advance(150)
        if clock.bpm != previous:
            assert boundary
            assert clock.bpm - previous == 2
            transitions.append(clock.bpm)
    assert transitions and max(transitions) < 130
    assert clock.beat > 36


def test_clocked_harmonic_cues_are_regular_and_leave_other_notes_free():
    clock, pulse = MusicalClock(120), EnsemblePulse()
    arrangement = opening_arrangement("chamber")
    onsets = []
    for frame in range(250):
        clock.advance(120)
        notes = pulse.next(clock.beat, arrangement)
        assert np.count_nonzero(notes >= 0) <= 2
        if np.any(notes == 2):
            onsets.append(frame)
            assert pulse.last_pitch in arrangement.chords[int(clock.beat // 4) % 4]
    assert np.all(np.abs(np.diff(onsets) - 25) <= 1)


def test_complete_arrangement_survives_remote_allowlist_and_style_prompt():
    controller = MusicalController(SessionOptions(semantic_backend="qwen"))
    controller.semantic(duet(), 1)
    public = MusicControl.model_validate(controller.snapshot(1))
    assert public.conducted
    assert len(public.arrangement.parts) == 2
    prompt = ensemble_prompt("chamber", public.arrangement, 108)
    assert "acoustic piano" in prompt and "acoustic guitar" in prompt
    assert "Simultaneous" in prompt
    assert "rhythm" not in public.model_dump()


def test_worker_applies_whole_plan_at_a_bar_and_ignores_raw_gesture_accents():
    controller = MusicalController(SessionOptions(semantic_backend="qwen", tempo=120))
    initial = controller.snapshot(0)
    controls, accents, audio, status = (queue.Queue() for _ in range(4))

    class Stop(threading.Event):
        def wait(self, timeout=None):
            time.sleep(0.001)  # Let the text preparation thread run without realtime pacing.
            return self.is_set()  # Run the real worker logic without realtime sleeping.

    stop = Stop()
    release_encoder = threading.Event()

    class Engine:
        frame = 0
        last_ms = 1

        def reset(self):
            self.applied = []
            self.notes = []

        def set_arrangement(self, palette, arrangement, bpm):
            self.applied.append((self.frame, arrangement))

        def prepare_arrangement(self, palette, arrangement, bpm):
            before = self.frame
            release_encoder.wait(1)
            self.frames_during_encoding = self.frame - before
            return arrangement

        def apply_style(self, arrangement):
            self.applied.append((self.frame, arrangement))

        def generate(self, notes=None, note_guidance=1.0):
            self.frame += 1
            if self.frame == 25:
                controller.semantic(duet(), 1)
                controls.put(controller.snapshot(1))
            if self.frame == 40:
                release_encoder.set()
            if notes is not None:
                self.notes.append(notes)
            if self.frame >= 110:
                stop.set()
            return np.full((1920, 2), 0.1, dtype=np.float32)

    for _ in range(200):
        accents.put({"time": float("inf"), "finger": 2})
    engine = Engine()
    music_worker(controls, accents, audio, status, stop, initial, engine)
    assert not any(item.get("phase") == "error" for item in status.queue)
    assert len(engine.applied) == 2
    assert engine.frames_during_encoding > 0
    # Apply immediately before generating the bar-crossing frame, after five warmup frames.
    assert 54 <= engine.applied[-1][0] <= 55
    assert len(engine.applied[-1][1].parts) == 2
    onsets = [i for i, notes in enumerate(engine.notes) if np.any(notes == 2)]
    assert len(onsets) < 7
    last_raw, metrics = list(audio.queue)[-1]
    assert len(metrics["ensemble_parts"]) == 2
    assert metrics["bpm"] == 120
    assert np.max(np.frombuffer(last_raw, dtype=np.float32)) > 0.05
