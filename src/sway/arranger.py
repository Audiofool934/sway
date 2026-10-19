"""The arranger for V2: Qwen plans each phrase of a piece, a phrase ahead.

When a phrase begins, the piece asks for two plans for the phrase after it: the one to
play next, and another to play instead if the player claps, which asks to move on. A plan
names the section, a chord for each bar, and a direction for the sound in words, which
becomes part of MRT2's style. The request describes the phrase that is ending in musical
words only; no camera images leave the Mac. Every answer is validated, and the world's
own plan plays whenever an answer is missing, invalid, or late.
"""

import json
import logging
import re
from dataclasses import dataclass

from .qwen import QwenClient, QwenError, content
from .world import World

log = logging.getLogger(__name__)

DIRECTION_CHARACTERS = 160
CAPTION_CHARACTERS = 48


@dataclass(frozen=True)
class Plan:
    section: str
    chords: tuple[str, ...]
    direction: str  # Words for the sound, read by MRT2's style.
    caption: str  # A few words for the player.
    source: str  # "qwen", or "world" for the world's own plan.


@dataclass(frozen=True)
class Summary:
    """The phrase that is ending, as the player played it."""

    phrase: int  # Its index in the piece, from 0.
    section: str
    phrases_in_section: int  # How many phrases the section has lasted, this one included.
    chords: tuple[str, ...]
    direction: str
    activity: float  # Means over the phrase, each from 0 to 1.
    activity_change: float  # The second half's mean activity minus the first half's.
    height: float
    spread: float
    still: float  # The share of the phrase spent still.
    claps: int
    history: tuple[str, ...]  # The sections of the phrases before it, oldest first.
    played: bool = True  # False at the opening, before the player has played a phrase.


def opening(world: World) -> Plan:
    return world_plan(world, world.first)


def world_plan(world: World, name: str) -> Plan:
    section = world.section(name)
    return Plan(name, section.chords, section.direction, name.capitalize(), "world")


def own_plans(world: World, summary: Summary) -> tuple[Plan, Plan]:
    """The world's own next plan and clap plan: two phrases a section, then move on."""
    after = world.section(summary.section).after
    stay = summary.phrases_in_section < 2
    return world_plan(world, summary.section if stay else after), world_plan(world, after)


def _level(value: float, words: tuple[str, str, str]) -> str:
    return words[0] if value < 0.35 else words[1] if value < 0.65 else words[2]


def _ordinal(n: int) -> str:
    return {1: "1st", 2: "2nd", 3: "3rd"}.get(n, f"{n}th")


def prompt(world: World, summary: Summary) -> str:
    change = summary.activity_change
    trend = "rising" if change > 0.1 else "falling" if change < -0.1 else "steady"
    sections = "\n".join(f"- {s.name}: {s.meaning}" for s in world.sections)
    history = " ".join(summary.history) or "none before it"
    seconds = world.bar_frames * 0.04
    bars = world.phrase_bars
    return "\n".join(
        [
            "You arrange a live film score. A player leads it with their hands: height "
            "sets the register, movement sets the energy, the distance between the hands "
            "opens the harmony, and stillness thins the music. A generative model plays "
            "every note, within the chords and the sound you choose. You plan the music "
            "one phrase ahead.",
            "",
            f"World: {world.name}, {world.key}, {world.tempo} BPM. A phrase is {bars} bars "
            f"of {seconds:g} seconds, one chord a bar, from: {', '.join(world.chords)}.",
            "Sections:",
            sections,
            "",
            f"Now: phrase {summary.phrase + 1}, the {_ordinal(summary.phrases_in_section)} "
            f"phrase of {summary.section}. Chords: {' '.join(summary.chords)}. "
            f'Sound: "{summary.direction}".',
            f"Sections before it: {history}.",
            (
                f"The player in the last phrase: energy {summary.activity:.2f} of 1 "
                f"({trend}), register {_level(summary.height, ('low', 'middle', 'high'))}, "
                f"hands {_level(summary.spread, ('close together', 'apart', 'wide apart'))}, "
                f"still {round(summary.still * 100)}% of the time, clapped "
                f"{summary.claps} times."
                if summary.played
                else "The player has not started playing yet."
            ),
            "",
            "Plan the next phrase, and a second one to play instead if the player claps "
            "before it begins. A clap asks the music to move on now.",
            "- Move to a new section every 2 to 4 phrases, following the player: build "
            "when their energy rises, peak when it is high, release after a peak or when "
            "they grow still.",
            f"- The clap plan must be a different section from {summary.section}.",
            f"- Chords: {bars} chords that lead on from {summary.chords[-1]} and suit the section.",
            "- Direction: what the orchestra plays, in under 16 words. Name instruments "
            "and texture; not tempo, key, or chords.",
            f"- Caption: under {CAPTION_CHARACTERS} characters, telling the player where "
            "the music is going.",
            "",
            'Return only a JSON object: {"next": {"section": name, "chords": '
            f'[{bars} chord names], "direction": text, "caption": text}}, "clap": '
            "{the same fields}}",
        ]
    )


def _text(value, limit: int) -> str:
    if not isinstance(value, str):
        raise ValueError("Expected text")
    text = " ".join(re.sub(r"[\x00-\x1f\x7f]", " ", value).split())[:limit]
    if not text:
        raise ValueError("Expected text")
    return text


def _plan(value, world: World) -> Plan:
    if not isinstance(value, dict):
        raise ValueError("Expected a plan")
    section = value.get("section")
    if section not in {s.name for s in world.sections}:
        raise ValueError("Unknown section")
    chords = value.get("chords")
    if not (
        isinstance(chords, list)
        and len(chords) == world.phrase_bars
        and all(isinstance(name, str) and name in world.chords for name in chords)
    ):
        raise ValueError("Expected one chord a bar from the world's chords")
    return Plan(
        section,
        tuple(chords),
        _text(value.get("direction"), DIRECTION_CHARACTERS),
        _text(value.get("caption"), CAPTION_CHARACTERS),
        "qwen",
    )


def parse(text: str, world: World, section: str) -> tuple[Plan, Plan]:
    """The next plan and the clap plan from Qwen's reply, or ValueError."""
    value = json.loads(text)
    if not isinstance(value, dict):
        raise ValueError("Expected a JSON object")
    following, clap = _plan(value.get("next"), world), _plan(value.get("clap"), world)
    if clap.section == section:
        raise ValueError("A clap must move on to another section")
    return following, clap


class Arranger:
    """Plans phrases with Qwen; `plan` returns None whenever the world's own plan should play."""

    def __init__(self, world: World, qwen: QwenClient):
        self.world = world
        self.qwen = qwen

    async def aclose(self):
        await self.qwen.aclose()

    async def plan(self, summary: Summary) -> tuple[Plan, Plan] | None:
        try:
            body, ms = await self.qwen.json_reply(prompt(self.world, summary), max_tokens=320)
            plans = parse(content(body), self.world, summary.section)
        except QwenError as error:
            log.warning("The arranger's request failed: %s", error)
            return None
        except (ValueError, KeyError, TypeError, IndexError):
            log.warning("The arranger's reply was not a usable plan")
            return None
        log.info("The arranger planned %s in %.0f ms", plans[0].section, ms)
        return plans
