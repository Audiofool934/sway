"""The band's composer for the V1 instrument: Qwen writes the band's next four bars.

At the start of each four-bar cycle the page asks for the cycle after it, describing what
the player just played and where the energy is. Qwen answers with a chord per bar from the
world's vocabulary, a texture for the chords, a short answering line on the ladder, and a
caption for the player. Only musical data is sent, never camera images. Every answer is
validated here and again in the page, which keeps the built-in progression whenever an
answer is missing, invalid, or late.
"""

import json
import re
import time

import httpx

from .qwen import QwenConfig
from .schema import ComposeRequest

TEXTURES = ("hold", "pulse", "arpeggio")
MAX_ANSWER = 8  # Notes in an answering line.
MAX_LENGTH = 16  # Sixteenths in one answering note.


class ComposerError(Exception):
    """A failed request, with the HTTP status the page should see."""

    def __init__(self, message, status):
        super().__init__(message)
        self.status = status


def _notes(notes) -> str:
    return ", ".join(f"{note.rung}@{note.at} for {note.len}" for note in notes)


def prompt(request: ComposeRequest) -> str:
    world = request.world
    bars = world.cycle_bars
    length = bars * world.beats_per_bar * 4
    levels = world.levels
    energy = f"{levels[request.level]} ({request.level} on a scale of 0 to {len(levels) - 1})"
    if request.earlier_levels:
        before = request.earlier_levels[-1]
        if before < request.level:
            energy += f", rising from {levels[before]}"
        elif before > request.level:
            energy += f", falling from {levels[before]}"
        else:
            energy += ", holding steady"
    history = f" Before that: {' '.join(request.history)}." if request.history else ""
    phrase = _notes(sorted(request.phrase, key=lambda n: n.at)) or "the player rested"
    previous = _notes(request.previous_answer) or "none yet"
    placement = (
        "mostly in the second half of bars 2 and 4"
        if bars == 4
        else "mostly in the second half of every other bar"
    )
    last = len(world.ladder) - 1
    return "\n".join(
        [
            "You compose for the band in a live instrumental piece. A player leads the "
            f"melody with hand gestures. While the band plays {bars} bars, you write its "
            f"next {bars}.",
            "",
            f"World: {world.name}, {world.key}, {world.tempo:g} BPM, a swung downtempo "
            "electronic groove. Each bar has one chord from: "
            f"{', '.join(world.vocabulary)}.",
            f"The player's notes sit on a ladder of rungs 0 to {last}: "
            f"{' '.join(world.ladder)}. Times count sixteenth notes from the start of "
            f"{bars} bars, 0 to {length - 1}.",
            "",
            f"This is cycle {request.cycle} of the piece. Energy: {energy}.",
            f"The band is playing {' '.join(request.current)}; you are writing the {bars} "
            f"bars after these.{history}",
            f"The player's last {bars} bars (rung@start for length): {phrase}.",
            f"Your last answering line: {previous}.",
            "",
            f"Write the next {bars} bars:",
            "- Harmony that suits the energy: steady and spacious when it is low, more "
            "movement and color as it rises. Lead smoothly on from "
            f"{request.current[-1]}.",
            f"- An answering line of 3 to {MAX_ANSWER} notes that develops the player's "
            "recent ideas, or offers a motif of your own when they rested. It plays an "
            f"octave below their ladder. Leave room for the player: place it {placement}.",
            '- A texture for the chords: "hold", "pulse" (struck on each beat), or "arpeggio".',
            "",
            f'Return only a JSON object: {{"chords": [{bars} chord names], '
            '"texture": "hold" | "pulse" | "arpeggio", '
            f'"answer": [{{"rung": 0-{last}, "at": 0-{length - 1}, "len": 1-8}}], '
            '"caption": "one sentence under 70 characters telling the player what the '
            'band does"}',
        ]
    )


def parse_plan(text: str, request: ComposeRequest) -> dict:
    """A playable plan from Qwen's reply, or ValueError.

    Chords and the texture must be exactly right. The answering line is repaired rather
    than refused: notes off the ladder, outside the cycle, or overlapping an earlier note
    are dropped, and the rest are kept in time order.
    """
    value = json.loads(text)
    if not isinstance(value, dict):
        raise ValueError("Expected a JSON object")
    world = request.world
    chords = value.get("chords")
    if not (
        isinstance(chords, list)
        and len(chords) == world.cycle_bars
        and all(isinstance(name, str) and name in world.vocabulary for name in chords)
    ):
        raise ValueError("Expected one chord per bar from the vocabulary")
    texture = value.get("texture")
    if texture not in TEXTURES:
        raise ValueError("Unknown texture")
    length = world.cycle_bars * world.beats_per_bar * 4
    notes = value.get("answer")
    whole = [
        note
        for note in (notes if isinstance(notes, list) else [])
        if isinstance(note, dict)
        and all(type(note.get(key)) is int for key in ("rung", "at", "len"))
    ]
    answer, free = [], 0
    for note in sorted(whole, key=lambda note: note["at"]):
        rung, at, span = note["rung"], note["at"], note["len"]
        if not 0 <= rung < len(world.ladder) or not free <= at < length or span < 1:
            continue
        span = min(span, MAX_LENGTH, length - at)
        answer.append({"rung": rung, "at": at, "len": span})
        free = at + span
        if len(answer) == MAX_ANSWER:
            break
    caption = value.get("caption")
    caption = re.sub(r"[\x00-\x1f\x7f]", " ", caption) if isinstance(caption, str) else ""
    return {
        "chords": chords,
        "texture": texture,
        "answer": answer,
        "caption": " ".join(caption.split())[:90],
    }


class Composer:
    """Asks Qwen for plans; the API key stays in this process."""

    def __init__(self, config=None, *, transport=None, timeout=6.0):
        self.config = config or QwenConfig.load()
        self.client = httpx.AsyncClient(
            base_url=self.config.endpoint + "/",
            headers={"Authorization": f"Bearer {self.config.api_key}"},
            timeout=httpx.Timeout(timeout, connect=2),
            follow_redirects=False,
            transport=transport,
        )

    async def aclose(self):
        await self.client.aclose()

    async def compose(self, request: ComposeRequest) -> dict:
        payload = {
            "model": self.config.model,
            "messages": [{"role": "user", "content": prompt(request)}],
            "enable_thinking": False,
            "response_format": {"type": "json_object"},
            "max_tokens": 400,
            "stream": False,
        }
        started = time.perf_counter()
        try:
            response = await self.client.post("chat/completions", json=payload)
        except httpx.TimeoutException:
            raise ComposerError(
                "Qwen took too long; the band keeps its own progression", 504
            ) from None
        except httpx.HTTPError:
            raise ComposerError(
                "Qwen could not be reached; the band keeps its own progression", 502
            ) from None
        ms = (time.perf_counter() - started) * 1000
        code = response.status_code
        # Provider bodies can echo the request; they are never passed on.
        if code in (401, 403):
            raise ComposerError("Qwen refused the request; check the key and model access", 503)
        if code == 429:
            raise ComposerError(
                "Qwen is limiting requests; the band keeps its own progression", 429
            )
        if code != 200:
            raise ComposerError(f"Qwen returned HTTP {code}", 502)
        if len(response.content) > 65_536:
            raise ComposerError("Qwen returned an oversized response", 502)
        try:
            body = response.json()
            choice = body["choices"][0]
            if choice.get("finish_reason") != "stop":
                raise ValueError("Incomplete reply")
            plan = parse_plan(choice["message"]["content"], request)
        except (ValueError, KeyError, TypeError, IndexError):
            raise ComposerError("Qwen did not return a usable plan", 502) from None
        usage = body.get("usage") if isinstance(body.get("usage"), dict) else {}
        model = body.get("model")
        return {
            "cycle": request.cycle,
            "plan": plan,
            "ms": round(ms),
            "model": (
                model
                if isinstance(model, str) and re.fullmatch(r"[a-zA-Z0-9._-]{1,128}", model)
                else self.config.model
            ),
            "tokens": {
                key: usage[key]
                for key in ("prompt_tokens", "completion_tokens")
                if type(usage.get(key)) is int and usage[key] >= 0
            },
        }
