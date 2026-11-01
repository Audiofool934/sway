"""The scored instrument, `?variant=score`: Sway writes the score, and Stable Audio 3 plays it.

On October 30 Everett chose Stable Audio 3 (SA3) at noise 0.3 in 1-bar pieces, and three
offline tests chose how it plays live (docs/steered-page.md#offline-tests-before-the-live-page).
Once a bar, at the last moment that leaves time to render it:

1. Sway decides the next bar's score from the hands as they are (`score.read`).
2. The sampler (sampler.swift) plays it, from the start of the bar before, so that notes
   and reverb ring on into it, to 0.56 s into the bar after it, which it plays as if the
   hands stay where they are.
3. SA3 (sa3_worker.py) redraws the bar in one window: 2.4 s of the music already played,
   kept, then the bar and the guessed 0.56 s from the sampler's audio, from noise 0.3 in
   4 steps. The guess is dropped.
4. The bar joins the music with a 40 ms crossfade before its join, and goes from SA3's
   44.1 kHz to the page's 48 kHz.

The page receives 40 ms frames, as from the other variants, and the volume answers
stillness at once, as on the spine. If SA3 has not finished a bar when it is due, the
sampler's bar plays instead and counts as late. The sampler and SA3 run in their own
processes, and stay loaded from one take to the next.

`?steps=`, `?context=` (seconds), `?model=small`, and `?noise=` change how SA3 renders.
"""

import asyncio
import inspect
import json
import logging
import os
import shutil
import subprocess
import time
from collections import deque
from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np
from fastapi import APIRouter, WebSocket

from . import score
from .config import DATA, SA3_DIR
from .steered import Control
from .steering import FADE_IN, FRAME, PROGRESSION, REST, SAMPLE_RATE, Move, Spine
from .stream import StreamService

log = logging.getLogger(__name__)
router = APIRouter()

WORKER = Path(__file__).with_name("sa3_worker.py")
SAMPLER_SOURCE = Path(__file__).with_name("sampler.swift")
SAMPLER = DATA / "sampler" / "sampler"
BANK = Path("/System/Library/Components/CoreAudio.component/Contents/Resources/gs_instruments.dls")

RATE = 44_100  # SA3's sample rate, at which the sampler plays for it.
LATENT = 4096  # Samples in one SA3 latent: 92.9 ms.
BAR = round(score.BAR * RATE)  # Samples in one bar: 105,840.
TAIL = 6  # Latents of the guessed bar after each bar: 0.56 s, dropped.
PIECE = BAR // LATENT + 1  # The most latents that one bar's piece spans: 26.
FADE = round(0.04 * RATE)  # The crossfade into each bar, before its join.
FRAME_SAMPLES = round(FRAME * SAMPLE_RATE)  # One 40 ms frame at the page's 48 kHz.
REVERB = 22  # The sampler's reverb, in percent wet, as in the comparison.
MARGIN = 0.3  # Seconds to spare, beyond the slowest recent bar, when a bar is decided.
# And more for the first bar after the first window: the GPU has idled for about 3.5 s, and
# that window can be slower. In the first take after the server started on November 1, it
# took 1.18 s, against a median of 0.91 s.
WAKE = 0.3
MODELS = {"medium": "medium", "small": "sm-music"}  # SA3's DiTs, by the names `?model=` takes.
PROMPT = (
    "Cinematic orchestral ensemble in A minor at 100 BPM: a solo violin melody over flowing "
    "piano arpeggios, a warm string section, cellos and double bass. Expressive and realistic, "
    "recorded in a concert hall. Instrumental."
)  # As in the renderer comparison.


def join(bar: int) -> int:
    """The sample where `bar`'s piece starts: the latent at or before its downbeat."""
    return bar * BAR // LATENT * LATENT


@dataclass(frozen=True)
class Settings:
    """How SA3 renders. The defaults are what the offline tests chose."""

    model: str = "medium"  # Or "small", Stable Audio 3 Small-Music.
    steps: int = 4
    context: float = 2.4  # Seconds of the music already played that each window keeps.
    noise: float = 0.3

    @classmethod
    def from_query(cls, query) -> "Settings":
        """The settings in a stream's address; a value out of range keeps its default."""
        default = cls()

        def number(name, kind, low, high):
            try:
                value = kind(query.get(name, getattr(default, name)))
            except ValueError:
                return getattr(default, name)
            return value if low <= value <= high else getattr(default, name)

        model = query.get("model", default.model)
        return cls(
            model=model if model in MODELS else default.model,
            steps=number("steps", int, 1, 16),
            context=number("context", float, 1.0, 6.0),
            noise=number("noise", float, 0.1, 0.9),
        )

    @property
    def kept(self) -> int:
        """The latents of music already played that each window keeps."""
        return round(self.context * RATE / LATENT)

    @property
    def length(self) -> int:
        """The latents in each window. Even, so that the decoder takes it in one pass."""
        length = self.kept + PIECE + TAIL
        return length + length % 2


class Resampler:
    """From 44.1 to 48 kHz as the audio arrives, by a windowed-sinc filter.

    Each output sample weighs TAPS input samples, so the output lags the input by about
    TAPS / 2 of them: 0.7 ms. Up to 18 kHz its error is about -100 dB, and it removes the
    images above 22 kHz by about 85 dB.
    """

    UP, DOWN = 160, 147  # 48,000 / 44,100.
    TAPS = 64

    def __init__(self):
        n = np.arange(self.UP * self.TAPS) - (self.UP * self.TAPS - 1) / 2
        cutoff = 20_000 / (RATE * self.UP)  # Cycles per sample, at the upsampled rate.
        h = np.sinc(2 * cutoff * n) * np.kaiser(len(n), 9.0)
        h *= self.UP / h.sum()
        # For output phase p, the weights of the input samples x[q - TAPS + 1], ..., x[q].
        self.weights = np.ascontiguousarray(h.reshape(self.TAPS, self.UP).T[:, ::-1], np.float32)
        self.buffer = np.zeros((2, self.TAPS - 1), np.float32)
        self.start = -(self.TAPS - 1)  # The input index of the buffer's first sample.
        self.made = 0  # Output samples made.

    def __call__(self, audio: np.ndarray) -> np.ndarray:
        """The output that `audio`, (2, n) at 44.1 kHz, completes: (2, m) at 48 kHz."""
        buffer = np.concatenate([self.buffer, audio.astype(np.float32)], axis=1)
        received = self.start + buffer.shape[1]
        end = (received * self.UP + self.DOWN - 1) // self.DOWN  # Outputs whose inputs are in.
        out = np.empty((2, end - self.made), np.float32)
        step = buffer.strides[1]
        for r in range(self.UP):
            first = -(-(self.made - r) // self.UP)  # Outputs r + UP * s, for s in [first, last).
            last = -(-(end - r) // self.UP)
            if last <= first:
                continue
            q = (r + self.UP * first) * self.DOWN // self.UP
            at = q - self.TAPS + 1 - self.start
            for channel in range(2):
                windows = np.lib.stride_tricks.as_strided(
                    buffer[channel, at:],
                    shape=(last - first, self.TAPS),
                    strides=(self.DOWN * step, step),
                    writeable=False,
                )
                out[channel, r + self.UP * first - self.made :: self.UP] = (
                    windows @ self.weights[r * self.DOWN % self.UP]
                )
        self.made = end
        keep = self.made * self.DOWN // self.UP - self.TAPS + 1  # The next output's first input.
        self.buffer = buffer[:, keep - self.start :]
        self.start = keep
        return out


async def _forward(stream, name):
    """Log what a helper process prints."""
    async for line in stream:
        log.info("%s: %s", name, line.decode(errors="replace").rstrip())


class Helper:
    """A process that answers one request at a time on its stdin and stdout."""

    name = "helper"

    def __init__(self):
        self.process = None
        self.lock = asyncio.Lock()
        self.tasks = set()

    @property
    def running(self) -> bool:
        return self.process is not None and self.process.returncode is None

    async def spawn(self, *command, **options):
        self.process = await asyncio.create_subprocess_exec(
            *command,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            **options,
        )
        self._keep(asyncio.create_task(_forward(self.process.stderr, self.name)))

    def _keep(self, task):
        self.tasks.add(task)
        task.add_done_callback(self.tasks.discard)
        task.add_done_callback(lambda done: done.cancelled() or done.exception())

    async def ask(self, *args):
        """One request and its answer, read to the end even if the caller stops waiting,
        so that the next request starts in step."""
        task = asyncio.ensure_future(self._ask(*args))
        self._keep(task)
        return await asyncio.shield(task)

    async def _ask(self, *args):
        async with self.lock:
            process = self.process
            if process is None or process.returncode is not None:
                raise RuntimeError(f"The {self.name} process is not running")
            return await self.exchange(process, *args)

    async def exchange(self, process, *args):
        """Send one request to `process`, and read its whole answer."""
        raise NotImplementedError

    async def close(self):
        """Close the process's input, and wait for it to answer what it was asked and stop.

        A pipe with an answer left unread never closes, and asyncio then never reports
        that the process stopped, so every answer is read to the end first.
        """
        process, self.process = self.process, None
        if process is None:
            return
        if process.returncode is None:
            process.stdin.close()
        try:
            async with asyncio.timeout(10):
                await asyncio.gather(*self.tasks, return_exceptions=True)
        except TimeoutError:
            process.kill()
            await asyncio.gather(*self.tasks, return_exceptions=True)
        await process.stdout.read()
        await process.wait()


def build_sampler() -> Path:
    """The sampler, compiled from sampler.swift when it is missing or older than its source."""
    if not SAMPLER.exists() or SAMPLER.stat().st_mtime < SAMPLER_SOURCE.stat().st_mtime:
        SAMPLER.parent.mkdir(parents=True, exist_ok=True)
        building = SAMPLER.with_suffix(".building")
        subprocess.run(
            ["swiftc", "-O", str(SAMPLER_SOURCE), "-o", str(building)],
            check=True,
            capture_output=True,
        )
        building.replace(SAMPLER)
    return SAMPLER


class Sampler(Helper):
    """The General MIDI sampler that ships with macOS, playing score.TRACKS at 44.1 kHz."""

    name = "sampler"

    @staticmethod
    def installed() -> bool:
        return BANK.exists() and (SAMPLER.exists() or shutil.which("swiftc") is not None)

    async def open(self):
        if self.running:
            return
        await self.spawn(str(await asyncio.to_thread(build_sampler)))
        tracks = [{"program": program, "volume": volume} for _, program, volume in score.TRACKS]
        await self.ask({"sampleRate": RATE, "reverb": REVERB, "tracks": tracks})

    async def play(self, frames: int, keep: int, notes: list) -> np.ndarray:
        """`frames` samples of `notes`, from silence, and the samples from `keep` on."""
        return await self.ask({"frames": frames, "keep": keep, "notes": notes})

    async def exchange(self, process, request):
        process.stdin.write(json.dumps(request).encode() + b"\n")
        await process.stdin.drain()
        count = int.from_bytes(await process.stdout.readexactly(4), "little")
        data = await process.stdout.readexactly(count * 8)
        return np.frombuffer(data, "<f4").reshape(2, count)


class SA3(Helper):
    """Stable Audio 3 in its own Python, with the DiT for one window length warmed up."""

    name = "SA3"

    def __init__(self, folder: Path = SA3_DIR):
        super().__init__()
        self.folder = folder
        self.model = None
        self.warmed = None  # The window length that MLX has compiled for.

    def installed(self) -> bool:
        return (self.folder / ".venv" / "bin" / "python").exists() and (
            self.folder / "scripts" / "sa3_mlx.py"
        ).exists()

    async def open(self, settings: Settings):
        if not (self.running and self.model == settings.model):
            await self.close()
            await self.spawn(
                str(self.folder / ".venv" / "bin" / "python"),
                str(WORKER),
                cwd=self.folder,
                env={**os.environ, "HF_HUB_OFFLINE": "1"},
            )
            setup = {"folder": str(self.folder), "dit": MODELS[settings.model], "prompt": PROMPT}
            answer, _ = await self.ask(setup)
            log.info("SA3 %s loaded in %.1f s", settings.model, answer["ready"])
            self.model, self.warmed = settings.model, None
        if self.warmed != settings.length:
            started = time.perf_counter()
            await self.ask(
                {
                    "warm": settings.length,
                    "keep": settings.kept,
                    "level": settings.noise,
                    "steps": settings.steps,
                }
            )
            self.warmed = settings.length
            log.info("SA3 warmed in %.1f s", time.perf_counter() - started)

    async def window(self, audio, keep: int, level: float, steps: int, seed: int):
        """`audio` redrawn from latent `keep` on, and the seconds each stage took."""
        request = {"keep": keep, "level": level, "steps": steps, "seed": seed}
        answer, out = await self.ask(request, audio)
        return out, answer["took"]

    async def exchange(self, process, request, audio=None):
        if audio is not None:
            request = {**request, "frames": audio.shape[1]}
        process.stdin.write(json.dumps(request).encode() + b"\n")
        if audio is not None:
            process.stdin.write(np.ascontiguousarray(audio, "<f4").tobytes())
        await process.stdin.drain()
        line = await process.stdout.readline()
        if not line:
            raise RuntimeError("Stable Audio 3 stopped")
        answer = json.loads(line)
        out = None
        if "frames" in answer:
            data = await process.stdout.readexactly(answer["frames"] * 8)
            out = np.frombuffer(data, "<f4").reshape(2, answer["frames"])
        if "error" in answer:
            raise RuntimeError(f"Stable Audio 3: {answer['error']}")
        return answer, out


class Take:
    """One performance: the bars decided, the music joined so far, and the frames queued.

    `begin` renders the first bars, `run` decides and renders each later bar in time, and
    `frame` hands the page 40 ms at a time.
    """

    def __init__(self, settings: Settings, seed: int, sampler: Sampler, sa3: SA3):
        self.settings, self.seed = settings, seed
        self.sampler, self.sa3 = sampler, sa3
        self.move = Move(activity=0.0)  # The hands, as the page last sent them.
        self.states = {}  # The state that each decided bar was played in.
        self.sampled = {}  # The sampler's audio for each bar not yet joined, from FADE before.
        self.tape = np.zeros((2, 0), np.float32)  # The music joined, at 44.1 kHz, from `origin`.
        self.origin = 0
        self.passed = 0  # The samples handed on to the queue: all but the last crossfade's.
        self.due = 0  # The next bar to join.
        self.resampler = Resampler()
        self.queue = deque()  # 48 kHz audio for the page, (n, 2) each.
        self.queued = 0
        self.sent = 0  # Samples of the music sent to the page, at 48 kHz.
        self.late = 0  # Bars that the sampler played, because SA3 was late.
        self.gaps = 0  # Frames with nothing to send.
        self.recent = deque(maxlen=4)  # Seconds from deciding each recent bar to its SA3 audio.
        self.lead = 0.0  # How long before the music runs out the next bar is decided.
        self.decided = {}  # How the last bar went, for the page.
        self.gain = 1.0
        self.ramp = np.linspace(0, 1, FADE, dtype=np.float32)
        steps = np.arange(1, FRAME_SAMPLES + 1)
        self.decays = {
            True: np.exp(-steps / (Spine.fade * SAMPLE_RATE)).astype(np.float32),
            False: np.exp(-steps / (FADE_IN * SAMPLE_RATE)).astype(np.float32),
        }

    @property
    def ahead(self) -> float:
        """Seconds until the music joined so far runs out."""
        return self.queued / SAMPLE_RATE

    def _notes(self, bars, start: int) -> list:
        """The sampler's notes for `bars`, (bar, state) pairs, timed from sample `start`."""
        notes = []
        for bar, state in bars:
            offset = (bar * BAR - start) / RATE
            for track, at, length, pitch, velocity in score.notes(bar, state):
                notes.append([track, offset + at, length, pitch, velocity])
        return notes

    async def begin(self) -> int:
        """Render the bars that fit in the first window, from the hands as they are.

        Nothing comes before them, so SA3 redraws the whole window. Returns the next bar.
        """
        started = time.monotonic()
        state = score.read(self.move)
        length = self.settings.length
        first = max(bar for bar in range(1, 8) if join(bar) <= (length - TAIL) * LATENT)
        bars = [(bar, state) for bar in range(first + 1)]  # The last one is the guess.
        audio = await self.sampler.play(length * LATENT, 0, self._notes(bars, 0))
        out, _ = await self.sa3.window(
            audio, 0, self.settings.noise, self.settings.steps, self.seed
        )
        self.states.update(bars[:first])
        self._join(first, out[:, : join(first)])
        self.recent.append(time.monotonic() - started)
        self.lead = max(self.recent) + MARGIN + WAKE
        return first

    async def run(self, bar: int):
        """Decide and render each bar from `bar` on, when the music left is the lead."""
        while True:
            while (wait := self.ahead - self.lead) > 0:
                await asyncio.sleep(wait)
            await self.play(bar)
            bar += 1

    async def play(self, bar: int):
        """Decide `bar` from the hands as they are now, and render it."""
        decided = time.monotonic()
        ahead = self.ahead
        state = score.read(self.move)
        self.states[bar] = state
        before = self.states.get(bar - 1, state)
        stop = join(bar + 1) // LATENT + TAIL
        begin = stop - self.settings.length
        start = max(0, bar - 1) * BAR
        bars = [(bar - 1, before)] if bar else []
        bars += [(bar, state), (bar + 1, state)]  # The next bar is the guess.
        sampled = await self.sampler.play(
            stop * LATENT - start, join(bar) - FADE - start, self._notes(bars, start)
        )
        self.sampled[bar] = sampled
        sampler_seconds = time.monotonic() - decided
        # The bar before is joined: by SA3 in its own `play`, or by the sampler in `frame`.
        window = np.concatenate(
            [self.tape[:, begin * LATENT - self.origin :], sampled[:, FADE:]], axis=1
        )
        out, took = await self.sa3.window(
            window,
            join(bar) // LATENT - begin,
            self.settings.noise,
            self.settings.steps,
            (self.seed + 2 * bar) % 2**31,
        )
        elapsed = time.monotonic() - decided
        spare = self.ahead if self.due == bar else None  # Or the sampler played it.
        if spare is not None:
            offset = begin * LATENT
            self._join(bar + 1, out[:, join(bar) - FADE - offset : join(bar + 1) - offset])
        self.sampled.pop(bar, None)
        self.recent.append(elapsed)
        self.lead = max(self.recent) + MARGIN
        self.decided = {
            "bar": bar,
            **asdict(state),
            "aheadMs": round(ahead * 1000),
            "samplerMs": round(sampler_seconds * 1000),
            "sa3Ms": round(sum(took.values()) * 1000),
            "elapsedMs": round(elapsed * 1000),
            "spareMs": None if spare is None else round(spare * 1000),
        }
        log.debug("Bar %d: %s", bar, self.decided)

    def _join(self, end: int, audio: np.ndarray):
        """Join the music up to bar `end`, from `audio`, which starts FADE before the
        end of the music joined so far, or at its start.

        The last FADE samples stay back: the next bar crossfades into them.
        """
        overlap = self.origin + self.tape.shape[1] - join(end) + audio.shape[1]
        if overlap:
            audio = audio.copy()
            audio[:, :overlap] = (
                self.tape[:, -overlap:] * (1 - self.ramp) + audio[:, :overlap] * self.ramp
            )
            tape = np.concatenate([self.tape[:, :-overlap], audio], axis=1)
        else:
            tape = np.concatenate([self.tape, audio], axis=1)
        out = self.resampler(tape[:, self.passed - self.origin : join(end) - FADE - self.origin])
        self.queue.append(out.T)
        self.queued += out.shape[1]
        self.passed = join(end) - FADE
        kept = max(self.origin, join(end) - self.settings.length * LATENT)
        self.tape, self.origin = tape[:, kept - self.origin :], kept
        self.due = end

    def frame(self, still: bool) -> np.ndarray:
        """The next 40 ms for the page, (FRAME_SAMPLES, 2), quieter while the hands are still."""
        if self.queued < FRAME_SAMPLES and self.due in self.sampled:
            # The next bar is due, and SA3 has not finished it: the sampler's plays.
            bar = self.due
            self._join(bar + 1, self.sampled.pop(bar)[:, : join(bar + 1) - join(bar) + FADE])
            self.late += 1
            log.warning("Bar %d was late; the sampler played it", bar)
        if self.queued < FRAME_SAMPLES:
            self.gaps += 1
            return np.zeros((FRAME_SAMPLES, 2), np.float32)
        parts, needed = [], FRAME_SAMPLES
        while needed:
            head = self.queue[0]
            parts.append(head[:needed])
            if len(head) <= needed:
                self.queue.popleft()
            else:
                self.queue[0] = head[needed:]
            needed -= len(parts[-1])
        self.queued -= FRAME_SAMPLES
        self.sent += FRAME_SAMPLES
        audio = np.concatenate(parts)
        target = Spine.rest_level if still else 1.0
        gains = target + (self.gain - target) * self.decays[still]
        self.gain = float(gains[-1])
        return audio * gains[:, None]

    def describe(self) -> dict:
        """Where the music being sent is, and how the bars are going."""
        seconds = self.sent / SAMPLE_RATE
        bar = int(seconds / score.BAR + 1e-9)
        state = self.states.get(bar, score.State())
        return {
            "bar": bar,
            "beat": round(seconds % score.BAR / score.BAR * Spine.beats_per_bar, 2),
            "chord": PROGRESSION[bar % len(PROGRESSION)][0],
            "chords": [name for name, _ in PROGRESSION],
            **score.theme(bar, state),
            **{f"score{key.title()}": value for key, value in asdict(state).items()},
            "late": self.late,
            "gaps": self.gaps,
            "leadMs": round(self.lead * 1000),
            "aheadMs": round(self.ahead * 1000),
            "decided": self.decided,
            "gain": round(self.gain, 3),
        }


class ScoreRenderer:
    """The sampler and SA3, kept from one take to the next, and the take being played."""

    def __init__(self, sampler: Sampler | None = None, sa3: SA3 | None = None):
        self.sampler = sampler or Sampler()
        self.sa3 = sa3 or SA3()
        self.take = None
        self.task = None

    def ready(self) -> bool:
        return self.sampler.installed() and self.sa3.installed()

    async def start(self, seed: int, settings: Settings | None = None):
        settings = settings or Settings()
        self.stop()
        await self.sampler.open()
        await self.sa3.open(settings)
        take = Take(settings, seed, self.sampler, self.sa3)
        bar = await take.begin()
        self.take, self.frames = take, 0
        self.task = asyncio.create_task(take.run(bar))
        return {"variant": "score", "settings": asdict(settings)}

    def render(self, control):
        if self.task.done():
            self.task.result()  # Raise what stopped the bars.
        take = self.take
        take.move = Move(height=control.height, activity=control.activity, spread=control.spread)
        audio = take.frame(control.activity < REST)
        self.frames += 1
        stats = {"seq": control.seq, "frame": self.frames, **take.describe()}
        return audio.astype("<f4").tobytes(), stats

    def idle(self, until):
        """Nothing: SA3's windows did not slow down when the GPU idled between them
        (docs/steered-page.md#faster), so the GPU filler is for MRT2 only."""

    def stop(self):
        if self.task is not None:
            self.task.cancel()
            self.task = None

    async def aclose(self):
        self.stop()
        await asyncio.gather(self.sampler.close(), self.sa3.close())


class ScoreService(StreamService):
    name = "score"
    control = Control
    busy = "A scored performance is already open"
    missing = "Stable Audio 3 or the macOS sampler is missing"

    def __init__(self, renderer: ScoreRenderer | None = None):
        super().__init__(renderer or ScoreRenderer())

    def ready(self):
        return self.renderer.ready()

    async def call(self, fn, *args, **kwargs):
        """On the event loop: SA3 and the sampler run in their own processes, so nothing
        here needs the model thread."""
        result = fn(*args, **kwargs)
        return await result if inspect.isawaitable(result) else result

    def closed(self):
        self.renderer.stop()

    async def aclose(self):
        await self.renderer.aclose()

    def release(self, control):
        return control.model_copy(update={"activity": 0})

    def options(self, websocket):
        return {"settings": Settings.from_query(websocket.query_params)}


SERVICE = ScoreService()


@router.websocket("/api/score/stream")
async def stream(websocket: WebSocket):
    await SERVICE.connect(websocket)
