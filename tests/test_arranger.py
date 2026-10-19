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
    "next": {
        "section": "build",
        "chords": ["Dm", "Gm", "Bb", "C"],
        "direction": "Ostinato cellos gather under a rising horn line",
        "caption": "The strings start to climb",
    },
    "clap": {
        "section": "peak",
        "chords": ["Bb", "F", "C", "Dm"],
        "direction": "Full orchestra, soaring violins and timpani",
        "caption": "All in!",
    },
}


def summary(**changes):
    values = {
        "phrase": 2,
        "section": "build",
        "phrases_in_section": 2,
        "chords": ("Dm", "Gm", "Bb", "C"),
        "direction": "Building tension",
        "activity": 0.72,
        "activity_change": 0.2,
        "height": 0.8,
        "spread": 0.9,
        "still": 0.1,
        "claps": 1,
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
        assert set(tones) <= WORLD.scale  # The hands can open any chord to the scale.
    assert WORLD.pentatonic <= WORLD.scale and len(WORLD.corners) == 4


def test_the_prompt_describes_the_phrase_and_the_player():
    text = arranger.prompt(WORLD, summary())
    assert "Film score, D minor, 80 BPM" in text
    assert "4 bars of 3 seconds" in text and "Dm, Gm, Am, Bb, F, C" in text
    assert "phrase 3, the 2nd phrase of build" in text
    assert "Chords: Dm Gm Bb C." in text and "lead on from C" in text
    assert "Sections before it: intro build." in text
    assert "last phrase: energy 0.72 of 1 (rising), register high, hands wide apart" in text
    assert "still 10% of the time, clapped 1 times" in text
    assert "different section from build" in text
    for section in WORLD.sections:
        assert f"- {section.name}: {section.meaning}" in text
    calm = arranger.prompt(WORLD, summary(activity_change=-0.3, history=()))
    assert "(falling)" in calm and "none before it" in calm
    opening = arranger.prompt(WORLD, summary(played=False))
    assert "has not started playing yet" in opening
    assert "The player in the last phrase" not in opening


def test_a_good_reply_becomes_two_plans():
    following, clap = arranger.parse(json.dumps(PLANS), WORLD, "build")
    assert following.section == "build" and following.chords == ("Dm", "Gm", "Bb", "C")
    assert clap.section == "peak" and clap.caption == "All in!"
    assert following.source == clap.source == "qwen"


def test_words_are_cleaned_and_bounded():
    messy = {
        **PLANS,
        "next": {
            **PLANS["next"],
            "direction": "Strings\n\tswell " + "x" * 400,
            "caption": "y" * 90,
        },
    }
    following, _ = arranger.parse(json.dumps(messy), WORLD, "build")
    assert following.direction.startswith("Strings swell x")
    assert len(following.direction) == arranger.DIRECTION_CHARACTERS
    assert len(following.caption) == arranger.CAPTION_CHARACTERS


@pytest.mark.parametrize(
    "change",
    [
        {"next": {**PLANS["next"], "section": "outro"}},
        {"next": {**PLANS["next"], "chords": ["Dm", "Gm"]}},
        {"next": {**PLANS["next"], "chords": ["Dm", "Gm", "Bb", "E"]}},
        {"next": {**PLANS["next"], "direction": " "}},
        {"clap": {**PLANS["clap"], "section": "build"}},  # A clap must move on.
        {"clap": "peak"},
    ],
)
def test_unplayable_replies_are_refused(change):
    with pytest.raises(ValueError):
        arranger.parse(json.dumps({**PLANS, **change}), WORLD, "build")
    with pytest.raises(ValueError):
        arranger.parse("[1, 2]", WORLD, "build")


def test_the_world_s_own_plans_stay_two_phrases_then_move_on():
    first = summary(section="intro", phrases_in_section=1)
    following, clap = arranger.own_plans(WORLD, first)
    assert following.section == "intro" and clap.section == "build"
    following, clap = arranger.own_plans(WORLD, summary(section="intro", phrases_in_section=2))
    assert following.section == "build" and clap.section == "build"
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

    following, clap = plan(handler)
    assert (following.section, clap.section) == ("build", "peak")
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
