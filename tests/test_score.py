import pytest

from sway import score
from sway.score import State
from sway.steering import A_MINOR, A_MINOR_PENTATONIC, PROGRESSION, Move
from sway.theme import THEME


def tracks(notes, track):
    return [note for note in notes if note[0] == track]


@pytest.mark.parametrize(
    ("move", "state"),
    [
        (Move(height=0.5, activity=0.04, spread=0.5), State("still", "middle", "pentatonic")),
        (Move(height=0.2, activity=0.2, spread=0.1), State("slow", "low", "chord")),
        (Move(height=0.5, activity=0.5, spread=0.5), State("medium", "middle", "pentatonic")),
        (Move(height=0.9, activity=0.8, spread=0.9), State("fast", "high", "scale")),
    ],
)
def test_the_hands_choose_each_bar_at_the_page_s_thresholds(move, state):
    assert score.read(move) == state


def test_the_theme_plays_four_bars_in_every_twelve_between_the_away_lines():
    melody = [[pitch for pitch, _ in score.line(bar)] for bar in range(24)]
    assert melody[4:8] == [[pitch for pitch, _ in bar] for bar in THEME]
    assert melody[16:20] == melody[4:8]
    assert melody[0:4] == [[pitch for pitch, _ in bar] for bar in score.ANSWER]
    assert melody[8:12] == [[pitch for pitch, _ in bar] for bar in score.HELD]
    playing = State("medium")
    assert score.theme(5, playing) == {"theme": "playing", "themeIn": 0}
    assert score.theme(5, State("still")) == {"theme": "resting", "themeIn": 0}
    assert score.theme(9, playing) == {"theme": "away", "themeIn": 7}


@pytest.mark.parametrize("bar", range(4))
def test_stillness_rests_the_melody_and_holds_the_root_and_the_fifth(bar):
    notes = score.notes(bar, State("still"))
    assert not tracks(notes, score.VIOLIN)
    root = PROGRESSION[bar][1][0]
    strings = sorted(pitch for _, _, _, pitch, _ in tracks(notes, score.STRINGS))
    assert strings[0] % 12 == root and strings[1] - strings[0] == 7
    assert {track for track, *_ in notes} == {score.BASS, score.STRINGS}


def test_each_texture_is_busier_and_louder_than_the_one_before():
    onsets, loudness = [], []
    for texture in score.TEXTURES:
        notes = score.notes(4, State(texture))
        onsets.append(len({round(start, 6) for _, start, *_ in notes}))
        loudness.append(max(velocity for *_, velocity in notes))
        for _, start, length, pitch, velocity in notes:
            assert 0 <= start < score.BAR and length > 0
            assert 0 < pitch < 128 and 0 < velocity <= 127
    assert onsets == [1, 4, 8, 16]
    assert loudness == sorted(loudness) and len(set(loudness)) == 4
    fast = score.notes(4, State("fast"))
    assert len(tracks(fast, score.BASS)) == 4 and tracks(fast, score.PIZZICATO)
    assert not tracks(score.notes(4, State("medium")), score.PIZZICATO)


@pytest.mark.parametrize("texture", score.TEXTURES[1:])
def test_height_moves_the_melody_and_the_accompaniment_an_octave(texture):
    def pitches(register, track):
        return [note[3] for note in tracks(score.notes(5, State(texture, register)), track)]

    for track in (score.VIOLIN, score.PIANO, score.STRINGS, score.PIZZICATO):
        middle = pitches("middle", track)
        assert pitches("high", track) == [pitch + 12 for pitch in middle]
        assert pitches("low", track) == [pitch - 12 for pitch in middle]
    for track in (score.BASS, score.CELLO):  # They cannot go lower.
        middle = pitches("middle", track)
        assert pitches("high", track) == [pitch + 12 for pitch in middle]
        assert pitches("low", track) == middle


@pytest.mark.parametrize("bar", range(4))
def test_spread_adds_a_seventh_or_sixth_and_then_a_ninth_to_the_piano(bar):
    tones = set(PROGRESSION[bar][1])

    def piano(harmony):
        notes = score.notes(bar, State("medium", "middle", harmony))
        return {pitch % 12 for _, _, _, pitch, _ in tracks(notes, score.PIANO)}

    assert piano("chord") == tones
    (colour,) = piano("pentatonic") - tones
    assert colour in A_MINOR_PENTATONIC
    assert piano("scale") - tones == {colour, (PROGRESSION[bar][1][0] + 2) % 12}
    assert piano("scale") <= A_MINOR


def test_the_accompaniment_stays_below_the_melody():
    for bar in range(12):
        for texture in score.TEXTURES[1:]:
            for register in score.REGISTERS:
                notes = score.notes(bar, State(texture, register))
                melody = min(pitch for _, _, _, pitch, _ in tracks(notes, score.VIOLIN))
                below = max(pitch for track, _, _, pitch, _ in notes if track != score.VIOLIN)
                assert below < melody
