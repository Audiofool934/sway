"""A piece in a world, conducted: V2's second milestone (docs/v2-design.md).

The player is the conductor. Their gestures blend the world's 16 style descriptions:
which voice leads and how far, calm or driving playing, and long or short notes. The
composer writes the score, one plan a phrase: the section and the chords, or the world's
own whenever the composer has not answered. A section's sound is the world's, and it is
a fifth of the style, so that how the music is played stays the conductor's.

Time runs on two clocks. A frame is heard when it is rendered, but MRT2 is told each
chord and sound `lead` frames earlier, so that its delay lands them on their bar lines.
So the next phrase is chosen when the told clock reaches its first bar line, and the
composer is then asked for the phrase after it: about one phrase ahead.

Moving on happens at once: the move-on plan begins on the first bar line that MRT2 can
still be told in time, between 1.2 and 4.2 seconds after the gesture at 80 beats a minute.
"""

from dataclasses import dataclass

import numpy as np

from .arranger import Plan, Summary, opening, own_plans
from .steering import FRAME, SAMPLE_RATE, Spine
from .world import FILM_SCORE, World

HISTORY = 6  # Earlier sections the composer is told about.


@dataclass(frozen=True)
class Gesture:
    """The conductor's controls, each from 0 to 1."""

    dynamics: float = 0.5  # The size of the right hand's motion.
    energy: float = 0.5  # Its speed.
    voice: float = 0.5  # Where the left hand points: 0 the left voice, 1 the right.
    forward: float = 0.0  # How far that voice comes forward: the left hand's height.
    articulation: float = 0.0  # 0 for an open palm's long notes, 1 for a pinch's short ones.
    hush: bool = False  # A fist, or stillness.

    # The spine reads these: a hush rests the music, and the harmony stays open to the
    # pentatonic scale around each chord, because the harmony is the composer's.
    @property
    def activity(self) -> float:
        return 0.0 if self.hush else 1.0

    @property
    def spread(self) -> float:
        return 0.5


def voice_weights(voice: float, forward: float) -> np.ndarray:
    """Weights of the balanced orchestra and the three voices, left to right."""
    position = min(1.0, max(0.0, voice)) * 2
    lower = min(1, int(position))
    share = position - lower
    voices = np.zeros(3)
    voices[lower] = 1 - share
    voices[lower + 1] += share
    forward = min(1.0, max(0.0, forward))
    return np.concatenate([[1 - forward], forward * voices])


@dataclass(frozen=True)
class Phrase:
    start: int  # The frame of its first bar line.
    plan: Plan
    index: int  # Its place in the piece, from 0.


class Piece(Spine):
    """The spine, playing a world's phrases as the composer plans them, conducted."""

    name = "film"
    direction_weight = 0.2  # The section's share of the style.
    direction_smoothing = 0.1  # Per frame, so a new section's sound takes about 0.4 s.
    dynamics_share = 0.4  # Of the calm-to-driving texture: the rest is the energy.
    level_time = 1.0  # Seconds for the gain to move most of the way to a new section's.
    # MRT2's output level depends on the texture: on October 20 it ranged from -59 to
    # -30 dBFS RMS with the same world, 15 to 40 dB below recorded music. So its level is
    # measured over `loudness_time` and brought to `loudness`, before the score's level
    # and the conductor's dynamics apply. A hush is not measured, so it stays quiet.
    loudness = -13.0  # dBFS RMS.
    loudness_time = 2.0  # Seconds.
    boosts = (-12.0, 48.0)  # dB: the least and the most the output is changed.
    # dB above `loudness`: while the measure catches up with a sudden loud passage, no
    # frame is boosted past this.
    ceiling = 6.0

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
        self.directions = {
            section.direction: engine.style.embed(section.direction) for section in world.sections
        }
        self.direction_now = None

    def start(self, seed: int):
        first = Phrase(0, opening(self.world), 0)
        self.phrases = [first]
        self.pending = None  # (ticket, next plan, move-on plan) from the composer.
        self.ticket = 0  # The request that the pending plans must answer.
        self.landing = None  # The frame where a move-on's phrase begins, until it is heard.
        self._listen_reset()
        self.summary = self._summary(first, played=None)
        self.wants_plan = True
        self.direction_now = self.directions[first.plan.direction].copy()
        self.level = self._gain(first.plan.section)
        # The output's mean square, until it is measured: MRT2's quietest textures, so
        # that a quiet opening is heard at once and a loud one meets the ceiling.
        self.heard = 10 ** (-55 / 10)
        self.boost = self._boost()
        super().start(seed)

    def blend(self, gesture: Gesture) -> np.ndarray:
        """The 16 corners' weights, in the order of `World.corners`."""
        if not isinstance(gesture, Gesture):  # The spine's start blends a neutral movement.
            gesture = Gesture()
        texture = (1 - self.dynamics_share) * gesture.energy
        texture += self.dynamics_share * gesture.dynamics
        texture = min(1.0, max(0.0, texture))
        notes = min(1.0, max(0.0, gesture.articulation))
        lead = voice_weights(gesture.voice, gesture.forward)
        weights = np.einsum("i,j,k->ijk", lead, [1 - texture, texture], [1 - notes, notes])
        return weights.reshape(-1).astype(np.float32)

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

    def render(self, gesture: Gesture) -> np.ndarray:
        self._schedule()
        self._listen(gesture)
        heard = self.phrase.plan.section
        audio = self._leveled(super().render(gesture), heard, gesture.hush)
        if self.landing is not None and self.frame >= self.landing:
            self.landing = None
        return audio

    def _gain(self, section: str) -> float:
        return 10 ** (self.world.section(section).level / 20)

    def _boost(self) -> float:
        """The gain that brings the measured output to `loudness`."""
        db = self.loudness - 10 * np.log10(self.heard)
        least, most = self.boosts
        return 10 ** (min(most, max(least, db)) / 20)

    def _leveled(self, audio: np.ndarray, section: str, hushed: bool) -> np.ndarray:
        """`audio` brought to `loudness`, then to the score's level for `section`.

        Both gains move to their new values with a `level_time` time constant, but the
        boost falls at once if this frame would be louder than the `ceiling`.
        """
        square = float(np.mean(audio**2))
        if not hushed and self.gain > 0.9 and square > 1e-7:  # Not a hush, nor silence.
            self.heard += (square - self.heard) * min(1.0, FRAME / self.loudness_time)
        decay = np.exp(-np.arange(1, len(audio) + 1) / (self.level_time * SAMPLE_RATE))
        level, boost = self._gain(section), self._boost()
        levels = level + (self.level - level) * decay
        boosts = boost + (self.boost - boost) * decay
        if square > 1e-7:
            most = 10 ** ((self.loudness + self.ceiling) / 20) / np.sqrt(square)
            boosts = np.minimum(boosts, most)
        self.level, self.boost = float(levels[-1]), float(boosts[-1])
        return audio * (levels * boosts)[:, None].astype(audio.dtype)

    def _schedule(self):
        """Choose the next phrase when the told clock reaches the current one's end."""
        told = self.frame + self.lead
        current = self._phrase_at(told)
        if told - current.start == self.phrase_frames:
            self._begin(told, self._take(move_on=False), current)

    def cue(self):
        """Move on, on the first bar line MRT2 can still be told in time."""
        if self.landing is not None:
            return  # One move at a time.
        self.cues += 1
        told = self.frame + self.lead
        landing = -(-told // self.bar_frames) * self.bar_frames
        # A phrase that would begin there anyway gives way to the move-on's.
        self.phrases = [p for p in self.phrases if p.start < landing]
        self._begin(landing, self._take(move_on=True), self.phrases[-1])
        self.landing = landing

    def _take(self, move_on: bool) -> Plan:
        if self.pending is not None and self.pending[0] == self.ticket:
            return self.pending[2] if move_on else self.pending[1]
        following, moving = own_plans(self.world, self.summary)
        return moving if move_on else following

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
        target = self.directions[direction]
        self.direction_now += self.direction_smoothing * (target - self.direction_now)
        hands = self.weights @ self.styles
        embedding = (1 - self.direction_weight) * hands + self.direction_weight * (
            self.direction_now
        )
        self.engine.apply_style(embedding)
        self.engine.current = embedding.copy()

    # How the player conducted the phrase being heard.

    def _listen_reset(self):
        self.energies = []
        self.dynamics = 0.0
        self.leading = np.zeros(3)
        self.articulation = 0.0
        self.hushed = 0
        self.cues = 0

    def _listen(self, gesture: Gesture):
        self.energies.append(gesture.energy)
        self.dynamics += gesture.dynamics
        self.leading += voice_weights(gesture.voice, gesture.forward)[1:]
        self.articulation += gesture.articulation
        self.hushed += gesture.hush

    def _listened(self) -> dict:
        count = max(1, len(self.energies))
        values = np.array(self.energies or [0.0])
        half = len(values) // 2
        change = float(values[half:].mean() - values[:half].mean()) if half else 0.0
        leading = self.leading / count
        strongest = int(np.argmax(leading))
        return {
            "energy": float(values.mean()),
            "energy_change": change,
            "dynamics": self.dynamics / count,
            # A voice counts as brought forward when it led a quarter of the phrase.
            "voice": self.world.voices[strongest].name.lower() if leading.max() > 0.25 else "",
            "articulation": self.articulation / count,
            "still": self.hushed / count,
            "cues": self.cues,
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
            "energy": 0.0,
            "energy_change": 0.0,
            "dynamics": 0.0,
            "voice": "",
            "articulation": 0.0,
            "still": 1.0,
            "cues": 0,
        }
        return Summary(
            phrase=phrase.index,
            section=phrase.plan.section,
            phrases_in_section=run,
            chords=phrase.plan.chords,
            history=tuple(p.plan.section for p in earlier[-HISTORY:]),
            played=listened,
            **played,
        )

    # The composer's side, from the stream's event loop.

    def request(self) -> tuple[int, Summary] | None:
        """The plans the composer should write now, once: their ticket and the summary."""
        if not self.wants_plan:
            return None
        self.wants_plan = False
        return self.ticket, self.summary

    def offer(self, ticket: int, plans: tuple[Plan, Plan]) -> bool:
        """Keep the composer's plans if they still answer the current request."""
        if ticket != self.ticket:
            return False
        self.pending = (ticket, *plans)
        return True

    def describe(self) -> dict:
        """Where the piece is, for the page."""
        phrase = self.phrase
        return {
            "world": self.world.name,
            "voices": [voice.name for voice in self.world.voices],
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
            "listening": (
                list(self.energies),
                self.dynamics,
                self.leading.copy(),
                self.articulation,
                self.hushed,
                self.cues,
            ),
            "direction_now": self.direction_now.copy(),
            "level": self.level,
            "heard": self.heard,
            "boost": self.boost,
        }

    def restore(self, snapshot: dict, seed: int):
        self.phrases = list(snapshot["phrases"])
        self.pending = snapshot["pending"]
        self.ticket = snapshot["ticket"]
        self.landing = snapshot["landing"]
        self.summary = snapshot["summary"]
        self.wants_plan = snapshot["wants_plan"]
        energies, self.dynamics, leading, self.articulation, self.hushed, self.cues = snapshot[
            "listening"
        ]
        self.energies = list(energies)
        self.leading = leading.copy()
        self.direction_now = snapshot["direction_now"].copy()
        self.level = snapshot["level"]
        self.heard = snapshot["heard"]
        self.boost = snapshot["boost"]
        super().restore(snapshot, seed)
