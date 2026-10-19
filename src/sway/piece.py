"""A piece in a world, V2's second milestone (docs/v2-design.md).

The spine's chords and part of its sound come from plans, one a phrase: the arranger's,
or the world's own whenever the arranger has not answered. The hands still steer the
rest of the sound, as on the spine.

Time runs on two clocks. A frame is heard when it is rendered, but MRT2 is told each
chord and sound `lead` frames earlier, so that its delay lands them on their bar lines.
So the next phrase is chosen when the told clock reaches its first bar line, and the
arranger is then asked for the phrase after it: about one phrase ahead.

A clap moves on at once: the clap plan begins on the first bar line that MRT2 can still
be told in time, between 1.2 and 4.2 seconds after the clap at 80 beats a minute.
"""

from dataclasses import dataclass

import numpy as np

from .arranger import Plan, Summary, opening, own_plans
from .steering import REST, Move, Spine
from .world import FILM_SCORE, World

HISTORY = 6  # Earlier sections the arranger is told about.
DIRECTIONS = 64  # Embedded directions kept for reuse.


@dataclass(frozen=True)
class Phrase:
    start: int  # The frame of its first bar line.
    plan: Plan
    index: int  # Its place in the piece, from 0.


class Piece(Spine):
    """The spine, playing a world's phrases as the arranger plans them."""

    name = "film"
    direction_weight = 0.4  # The phrase's direction's share of the style.
    direction_smoothing = 0.1  # Per frame, so a new direction takes about 0.4 s.

    def __init__(self, engine, world: World = FILM_SCORE):
        self.world = world
        self.corners = world.corners
        self.tempo = world.tempo
        self.beats_per_bar = world.beats_per_bar
        self.scale = world.scale
        self.pentatonic = world.pentatonic
        super().__init__(engine)
        if self.bar_frames != world.bar_frames:
            raise ValueError("The world's bars must match the spine's")
        self.phrase_frames = world.phrase_frames
        self.defaults = {section.direction for section in world.sections}
        self.directions = {}
        for direction in self.defaults:
            self.prepare(direction)
        self.direction_now = None

    def prepare(self, direction: str, embedding: np.ndarray | None = None) -> np.ndarray:
        """`direction` embedded for the style, once, unless its embedding is given."""
        if direction not in self.directions:
            if len(self.directions) >= DIRECTIONS:
                used = self.defaults | {p.plan.direction for p in self.phrases}
                for old in [d for d in self.directions if d not in used]:
                    del self.directions[old]
            if embedding is None:
                embedding = self.engine.style.embed(direction)
            self.directions[direction] = embedding
        return self.directions[direction]

    def start(self, seed: int):
        first = Phrase(0, opening(self.world), 0)
        self.phrases = [first]
        self.pending = None  # (ticket, next plan, clap plan) from the arranger.
        self.ticket = 0  # The request that the pending plans must answer.
        self.landing = None  # The frame where a clap's phrase begins, until it is heard.
        self._listen_reset()
        self.summary = self._summary(first, played=None)
        self.wants_plan = True
        self.direction_now = self.directions[first.plan.direction].copy()
        super().start(seed)

    # Where the music is.

    def _phrase_at(self, frame: int) -> Phrase:
        return next(p for p in reversed(self.phrases) if p.start <= frame)

    def _chord_at(self, frame: int) -> tuple[str, tuple[int, ...]]:
        phrase = self._phrase_at(frame)
        chords = phrase.plan.chords
        name = chords[(frame - phrase.start) // self.bar_frames % len(chords)]
        return name, self.world.chords[name]

    @property
    def phrase(self) -> Phrase:
        """The phrase being heard."""
        return self._phrase_at(self.frame)

    @property
    def chord(self):
        return self._chord_at(self.frame)

    @property
    def harmony(self):
        return self._chord_at(self.frame + self.lead)

    # Playing.

    def render(self, move: Move) -> np.ndarray:
        self._schedule()
        self._listen(move)
        audio = super().render(move)
        if self.landing is not None and self.frame >= self.landing:
            self.landing = None
        return audio

    def _schedule(self):
        """Choose the next phrase when the told clock reaches the current one's end."""
        told = self.frame + self.lead
        current = self._phrase_at(told)
        if told - current.start == self.phrase_frames:
            self._begin(told, self._take(clap=False), current)

    def cue(self):
        """A clap: move on, on the first bar line MRT2 can still be told in time."""
        if self.landing is not None:
            return  # One move at a time.
        self.claps += 1
        told = self.frame + self.lead
        landing = -(-told // self.bar_frames) * self.bar_frames
        # A phrase that would begin there anyway gives way to the clap's.
        self.phrases = [p for p in self.phrases if p.start < landing]
        self._begin(landing, self._take(clap=True), self.phrases[-1])
        self.landing = landing

    def _take(self, clap: bool) -> Plan:
        if self.pending is not None and self.pending[0] == self.ticket:
            return self.pending[2] if clap else self.pending[1]
        following, on_clap = own_plans(self.world, self.summary)
        return on_clap if clap else following

    def _begin(self, start: int, plan: Plan, before: Phrase):
        phrase = Phrase(start, plan, before.index + 1)
        self.phrases = [*self.phrases[-(HISTORY + 1) :], phrase]
        self.summary = self._summary(phrase, played=self._listened())
        self._listen_reset()
        self.pending = None
        self.ticket += 1
        self.wants_plan = True

    def _style(self):
        direction = self._phrase_at(self.frame + self.lead).plan.direction
        target = self.directions.get(direction)
        if target is None:  # Unprepared: the section's own direction stands in.
            section = self._phrase_at(self.frame + self.lead).plan.section
            target = self.directions[self.world.section(section).direction]
        self.direction_now += self.direction_smoothing * (target - self.direction_now)
        hands = self.weights @ self.styles
        embedding = (1 - self.direction_weight) * hands + self.direction_weight * (
            self.direction_now
        )
        self.engine.apply_style(embedding)
        self.engine.current = embedding.copy()

    # What the player did in the phrase being heard.

    def _listen_reset(self):
        self.activity = []
        self.heights = 0.0
        self.spreads = 0.0
        self.claps = 0

    def _listen(self, move: Move):
        self.activity.append(move.activity)
        self.heights += move.height
        self.spreads += move.spread

    def _listened(self) -> dict:
        count = max(1, len(self.activity))
        values = np.array(self.activity or [0.0])
        half = len(values) // 2
        change = float(values[half:].mean() - values[:half].mean()) if half else 0.0
        return {
            "activity": float(values.mean()),
            "activity_change": change,
            "height": self.heights / count,
            "spread": self.spreads / count,
            "still": float(np.mean(values < REST)),
            "claps": self.claps,
        }

    def _summary(self, phrase: Phrase, played: dict | None) -> Summary:
        earlier = [p for p in self.phrases if p.index < phrase.index]
        run = 1
        for p in reversed(earlier):
            if p.plan.section != phrase.plan.section:
                break
            run += 1
        listened = played is not None
        played = played or {
            "activity": 0.0,
            "activity_change": 0.0,
            "height": 0.5,
            "spread": 0.5,
            "still": 1.0,
            "claps": 0,
        }
        return Summary(
            phrase=phrase.index,
            section=phrase.plan.section,
            phrases_in_section=run,
            chords=phrase.plan.chords,
            direction=phrase.plan.direction,
            history=tuple(p.plan.section for p in earlier[-HISTORY:]),
            played=listened,
            **played,
        )

    # The arranger's side, from the stream's event loop.

    def request(self) -> tuple[int, Summary] | None:
        """The plans the arranger should write now, once: their ticket and the summary."""
        if not self.wants_plan:
            return None
        self.wants_plan = False
        return self.ticket, self.summary

    def offer(self, ticket: int, plans: tuple[Plan, Plan], embedded: dict) -> bool:
        """Keep the arranger's plans if they still answer the current request.

        `embedded` maps each plan's direction to its embedding, made off the model
        thread; call this on the model thread.
        """
        if ticket != self.ticket:
            return False
        for plan in plans:
            self.prepare(plan.direction, embedded[plan.direction])
        self.pending = (ticket, *plans)
        return True

    def describe(self) -> dict:
        """Where the piece is, for the page."""
        phrase = self.phrase
        return {
            "world": self.world.name,
            "section": phrase.plan.section,
            "caption": phrase.plan.caption,
            "source": phrase.plan.source,
            "chords": list(phrase.plan.chords),
            "chordIndex": (self.frame - phrase.start) // self.bar_frames,
            "landing": None if self.landing is None else self.landing - self.frame,
            "tempo": self.tempo,
            "beatsPerBar": self.beats_per_bar,
        }

    def snapshot(self) -> dict:
        return {
            **super().snapshot(),
            "phrases": list(self.phrases),
            "pending": self.pending,
            "ticket": self.ticket,
            "landing": self.landing,
            "summary": self.summary,
            "wants_plan": self.wants_plan,
            "listening": (list(self.activity), self.heights, self.spreads, self.claps),
            "direction_now": self.direction_now.copy(),
        }

    def restore(self, snapshot: dict, seed: int):
        self.phrases = list(snapshot["phrases"])
        self.pending = snapshot["pending"]
        self.ticket = snapshot["ticket"]
        self.landing = snapshot["landing"]
        self.summary = snapshot["summary"]
        self.wants_plan = snapshot["wants_plan"]
        activity, self.heights, self.spreads, self.claps = snapshot["listening"]
        self.activity = list(activity)
        self.direction_now = snapshot["direction_now"].copy()
        super().restore(snapshot, seed)
