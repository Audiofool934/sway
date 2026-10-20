import asyncio
import json

import httpx
import pytest

from sway import arranger
from sway.arranger import Summary
from sway.qwen import QwenClient, QwenConfig
from sway.world import FILM_SCORE

WORLD = FILM_SCORE
PLANS = {
    "next": {"section": "build", "chords": ["Dm", "Gm", "Bb", "C"], "caption": "Strings climb"},
    "move_on": {"section": "peak", "chords": ["Bb", "F", "C", "Dm"], "caption": "All in!"},
}


def summary(**changes):
    values = {
        "phrase": 2,
        "section": "build",
        "phrases_in_section": 2,
        "chords": ("Dm", "Gm", "Bb", "C"),
        "energy": 0.72,
        "energy_change": 0.2,
        "dynamics": 0.8,
        "voice": "violins",
        "articulation": 0.1,
        "still": 0.1,
        "cues": 1,
        "history": ("intro", "build"),
    }
    return Summary(**{**values, **changes})


def test_the_film_score_world_is_consistent():
    assert WORLD.bar_frames == 75 and WORLD.phrase_frames == 300  # 3 s bars at 80 BPM.
    names = {section.name for section in WORLD.sections}
    assert WORLD.first in names
    for section in WORLD.sections:
        assert section.after in names and section.after != section.name
        assert len(section.chords) == WORLD.phrase_bars
        assert all(name in WORLD.chords for name in section.chords)
    for tones in WORLD.chords.values():
        assert set(tones) <= WORLD.scale  # The melody's scale never clashes with a chord.
    assert WORLD.pentatonic <= WORLD.scale and len(WORLD.voices) == 3


def test_the_world_s_corners_combine_every_voice_energy_and_articulation():
    corners = WORLD.corners
    assert len(corners) == 16 and len(set(corners)) == 16
    assert corners[0] == (
        "Calm, slow, and sustained cinematic orchestra, the whole orchestra balanced, "
        "long smooth legato lines, instrumental"
    )
    # Voices outermost, then energy, then articulation.
    assert "violins in front" in corners[4] and "Calm" in corners[4]
    assert "Energetic" in corners[6] and "staccato" in corners[7]
    assert "cellos and double basses in front" in corners[15]


def test_the_prompt_describes_the_phrase_and_the_conductor():
    text = arranger.prompt(WORLD, summary())
    assert "Film score, D minor, 80 BPM" in text
    assert "4 bars of 3 seconds" in text and "Dm, Gm, Am, Bb, F, C" in text
    assert "(violins, brass, cellos and basses)" in text
    assert "phrase 3, the 2nd phrase of build" in text
    assert "Chords: Dm Gm Bb C." in text and "lead on from C" in text
    assert "Sections before it: intro build." in text
    assert "energy 0.72 of 1 (rising), dynamics loud, brought the violins forward" in text
    assert "asked for long notes, hushed the music 10% of the time, and moved on 1 times" in text
    assert "different section from build" in text
    assert "Do not name instruments" in text  # The player chooses which voice leads.
    assert "direction" not in text.lower()  # The sound is the world's and the conductor's.
    for section in WORLD.sections:
        assert f"- {section.name}: {section.meaning}" in text
    balanced = arranger.prompt(WORLD, summary(voice="", energy_change=-0.3, history=()))
    assert "kept the voices balanced" in balanced and "(falling)" in balanced
    assert "none before it" in balanced
    opening = arranger.prompt(WORLD, summary(played=False))
    assert "has not started conducting yet" in opening
    assert "The player in the last phrase" not in opening


def test_a_good_reply_becomes_two_plans_with_the_world_s_sound():
    following, move_on = arranger.parse(json.dumps(PLANS), WORLD, "build")
    assert following.section == "build" and following.chords == ("Dm", "Gm", "Bb", "C")
    assert move_on.section == "peak" and move_on.caption == "All in!"
    assert following.direction == WORLD.section("build").direction
    assert following.source == move_on.source == "qwen"


def test_captions_are_cleaned_and_bounded():
    messy = {**PLANS, "next": {**PLANS["next"], "caption": "Strings\n\tclimb " + "y" * 90}}
    following, _ = arranger.parse(json.dumps(messy), WORLD, "build")
    assert following.caption.startswith("Strings climb y")
    assert len(following.caption) == arranger.CAPTION_CHARACTERS


@pytest.mark.parametrize(
    "change",
    [
        {"next": {**PLANS["next"], "section": "outro"}},
        {"next": {**PLANS["next"], "chords": ["Dm", "Gm"]}},
        {"next": {**PLANS["next"], "chords": ["Dm", "Gm", "Bb", "E"]}},
        {"next": {**PLANS["next"], "caption": " "}},
        {"move_on": {**PLANS["move_on"], "section": "build"}},  # Moving on must move on.
        {"move_on": "peak"},
    ],
)
def test_unplayable_replies_are_refused(change):
    with pytest.raises(ValueError):
        arranger.parse(json.dumps({**PLANS, **change}), WORLD, "build")
    with pytest.raises(ValueError):
        arranger.parse("[1, 2]", WORLD, "build")


def test_the_world_s_own_plans_stay_two_phrases_then_move_on():
    first = summary(section="intro", phrases_in_section=1)
    following, move_on = arranger.own_plans(WORLD, first)
    assert following.section == "intro" and move_on.section == "build"
    following, move_on = arranger.own_plans(WORLD, summary(section="intro", phrases_in_section=2))
    assert following.section == "build" and move_on.section == "build"
    assert following.chords == WORLD.section("build").chords and following.source == "world"


def reply(content, status=200):
    return httpx.Response(
        status,
        json={
            "model": "q",
            "choices": [{"finish_reason": "stop", "message": {"content": content}}],
        },
    )


def plan(handler):
    config = QwenConfig(api_key="test-key", model="qwen-test")
    client = arranger.Arranger(WORLD, QwenClient(config, transport=httpx.MockTransport(handler)))

    async def go():
        try:
            return await client.plan(summary())
        finally:
            await client.aclose()

    return asyncio.run(go())


def test_qwen_is_asked_in_words_only_and_its_plans_are_kept():
    sent = []

    def handler(request):
        sent.append(json.loads(request.content))
        return reply(json.dumps(PLANS))

    following, move_on = plan(handler)
    assert (following.section, move_on.section) == ("build", "peak")
    [message] = sent[0]["messages"]
    assert isinstance(message["content"], str)  # Text only: no camera images.
    assert sent[0]["response_format"] == {"type": "json_object"}


@pytest.mark.parametrize(
    "response",
    [httpx.Response(500, text="trace"), reply("not json"), reply(json.dumps({"next": 1}))],
)
def test_without_a_usable_reply_the_world_plays_its_own(response):
    assert plan(lambda request: response) is None


def test_a_timeout_leaves_the_world_s_own_plans():
    def handler(request):
        raise httpx.ReadTimeout("slow", request=request)

    assert plan(handler) is None
