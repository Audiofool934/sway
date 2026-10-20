"""The composer for V2: Qwen writes the score of each phrase, a phrase ahead.

The player conducts; the composer writes what is played (docs/v2-design.md). When a
phrase begins, the piece asks for two plans for the phrase after it: the one to play
next, and another to play instead if the player moves on now. A plan names the section,
a chord for each bar, and a caption for the player. How the music is played belongs to
the player alone, so the composer does not choose the sound: each section's sound is
the world's. The request describes the phrase that is ending in words and numbers only;
no camera images leave the Mac. Every answer is checked, and the world's own plan plays
whenever an answer is missing, invalid, or late.
"""

import json
import logging
import re
from dataclasses import dataclass

from .qwen import QwenClient, QwenError, content
from .world import World

log = logging.getLogger(__name__)

CAPTION_CHARACTERS = 48


@dataclass(frozen=True)
class Plan:
    section: str
    chords: tuple[str, ...]
    direction: str  # The section's sound, in the world's words for MRT2's style.
    caption: str  # A few words for the player.
    source: str  # "qwen", or "world" for the world's own plan.


@dataclass(frozen=True)
class Summary:
    """The phrase now playing, and how the player conducted the one before it."""

    phrase: int  # Its index in the piece, from 0.
    section: str
    phrases_in_section: int  # How many phrases the section has lasted, this one included.
    chords: tuple[str, ...]
    energy: float  # Means over the last phrase, each from 0 to 1.
    energy_change: float  # The second half's mean energy minus the first half's.
    dynamics: float
    voice: str  # The voice brought forward most, or "" if none was.
    articulation: float  # 0 for long notes, 1 for short ones.
    still: float  # The share of the phrase spent hushed.
    cues: int  # How often the player moved on.
    history: tuple[str, ...]  # The sections of the phrases before it, oldest first.
    played: bool = True  # False at the opening, before the player has conducted a phrase.


def opening(world: World) -> Plan:
    return world_plan(world, world.first)


def world_plan(world: World, name: str, chords=None, caption=None, source="world") -> Plan:
    section = world.section(name)
    return Plan(
        name,
        tuple(chords or section.chords),
        section.direction,
        caption or name.capitalize(),
        source,
    )


def own_plans(world: World, summary: Summary) -> tuple[Plan, Plan]:
    """The world's own next plan and move-on plan: two phrases a section, then on."""
    after = world.section(summary.section).after
    stay = summary.phrases_in_section < 2
    return world_plan(world, summary.section if stay else after), world_plan(world, after)


def _level(value: float, words: tuple[str, str, str]) -> str:
    return words[0] if value < 0.35 else words[1] if value < 0.65 else words[2]


def _ordinal(n: int) -> str:
    return {1: "1st", 2: "2nd", 3: "3rd"}.get(n, f"{n}th")


def _player(summary: Summary) -> str:
    if not summary.played:
        return "The player has not started conducting yet."
    change = summary.energy_change
    trend = "rising" if change > 0.1 else "falling" if change < -0.1 else "steady"
    voice = f"brought the {summary.voice} forward" if summary.voice else "kept the voices balanced"
    notes = _level(summary.articulation, ("long notes", "mixed notes", "short notes"))
    return (
        f"The player in the last phrase: energy {summary.energy:.2f} of 1 ({trend}), "
        f"dynamics {_level(summary.dynamics, ('soft', 'moderate', 'loud'))}, {voice}, "
        f"asked for {notes}, hushed the music {round(summary.still * 100)}% of the time, "
        f"and moved on {summary.cues} times."
    )


def prompt(world: World, summary: Summary) -> str:
    sections = "\n".join(f"- {s.name}: {s.meaning}" for s in world.sections)
    history = " ".join(summary.history) or "none before it"
    seconds = world.bar_frames * 0.04
    bars = world.phrase_bars
    voices = ", ".join(voice.name.lower() for voice in world.voices)
    return "\n".join(
        [
            f"You compose a live score for a {world.ensemble}. A player conducts it with "
            "their hands: the size of their motion sets the dynamics, its speed the "
            f"energy, and their left hand brings a voice forward ({voices}). A "
            "generative model plays every note. You write the score: the sections and "
            "the chords, one phrase ahead. The player decides how it is played.",
            "",
            f"World: {world.name}, {world.key}, {world.tempo} BPM. A phrase is {bars} bars "
            f"of {seconds:g} seconds, one chord a bar, from: {', '.join(world.chords)}.",
            "Sections:",
            sections,
            "",
            f"Now: phrase {summary.phrase + 1}, the {_ordinal(summary.phrases_in_section)} "
            f"phrase of {summary.section}. Chords: {' '.join(summary.chords)}.",
            f"Sections before it: {history}.",
            _player(summary),
            "",
            "Write the next phrase, and a second one to play instead if the player moves "
            "on now: they raise both hands and bring them down, asking for the next "
            "section.",
            "- Move to a new section every 2 to 4 phrases, following the player: build "
            "when their energy rises, peak when it is high, release after a peak or when "
            "they hush the music.",
            f"- The move-on phrase must be a different section from {summary.section}.",
            f"- Chords: {bars} chords that lead on from {summary.chords[-1]} and suit the section.",
            f"- Caption: under {CAPTION_CHARACTERS} characters, telling the player where "
            "the music is going. Do not name instruments: the player chooses which voice "
            "leads.",
            "",
            'Return only a JSON object: {"next": {"section": name, "chords": '
            f'[{bars} chord names], "caption": text}}, "move_on": {{the same fields}}}}',
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
    caption = _text(value.get("caption"), CAPTION_CHARACTERS)
    return world_plan(world, section, chords, caption, "qwen")


def parse(text: str, world: World, section: str) -> tuple[Plan, Plan]:
    """The next plan and the move-on plan from Qwen's reply, or ValueError."""
    value = json.loads(text)
    if not isinstance(value, dict):
        raise ValueError("Expected a JSON object")
    following, move_on = _plan(value.get("next"), world), _plan(value.get("move_on"), world)
    if move_on.section == section:
        raise ValueError("Moving on must lead to another section")
    return following, move_on


class Arranger:
    """Plans phrases with Qwen; `plan` returns None whenever the world's own plan should play."""

    def __init__(self, world: World, qwen: QwenClient):
        self.world = world
        self.qwen = qwen

    async def aclose(self):
        await self.qwen.aclose()

    async def plan(self, summary: Summary) -> tuple[Plan, Plan] | None:
        try:
            body, ms = await self.qwen.json_reply(prompt(self.world, summary), max_tokens=240)
            plans = parse(content(body), self.world, summary.section)
        except QwenError as error:
            log.warning("The composer's request failed: %s", error)
            return None
        except (ValueError, KeyError, TypeError, IndexError):
            log.warning("The composer's reply was not a usable plan")
            return None
        log.info("The composer planned %s in %.0f ms", plans[0].section, ms)
        return plans
