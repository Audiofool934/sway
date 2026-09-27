"""MRT2's exported streaming graph, with a small MusicCoCa text adapter.

Conditioning and text tokenization follow Google's Apache-2.0 Magenta RT code.
See THIRD_PARTY_NOTICES.md for attribution and the inspected source revision.
"""

import time
from pathlib import Path

import numpy as np

from .config import ACTION_STYLES, MRT_DIR, PALETTE_CONTEXT, PALETTES
from .ensemble import ensemble_prompt
from .schema import Arrangement


def style_prompt(palette: str, action: str) -> str:
    if action in ("unknown", "still"):
        return f"{PALETTES[palette]}, {ACTION_STYLES[action]}"
    return f"{ACTION_STYLES[action]}, {PALETTE_CONTEXT[palette]}"


class StyleEncoder:
    def __init__(self, resource_dir: Path):
        import sentencepiece
        from ai_edge_litert.interpreter import Interpreter

        self.vocab = sentencepiece.SentencePieceProcessor(
            model_file=str(resource_dir / "spm.model")
        )
        self.encoder = Interpreter(
            model_path=str(resource_dir / "text_encoder.tflite"), num_threads=2
        )
        self.quantizer = Interpreter(
            model_path=str(resource_dir / "pretrained_vector_quantizer.tflite"), num_threads=2
        )
        self.encoder.allocate_tensors()
        self.quantizer.allocate_tensors()
        self.cache = {}

    def embed(self, text: str) -> np.ndarray:
        if text in self.cache:
            return self.cache[text]
        ids = [1, *self.vocab.encode(text.lower())[:127]]
        padding = np.ones(128, dtype=np.float32)
        padding[: len(ids)] = 0
        ids = np.array(ids + [0] * (128 - len(ids)), dtype=np.int32)
        for spec in self.encoder.get_input_details():
            value = ids if spec["dtype"] == np.int32 else padding
            self.encoder.set_tensor(spec["index"], value.reshape(spec["shape"]))
        self.encoder.invoke()
        embedding = (
            self.encoder.get_tensor(self.encoder.get_output_details()[0]["index"])
            .flatten()
            .astype(np.float32)
        )
        self.cache[text] = embedding
        if len(self.cache) > 256:
            self.cache.pop(next(iter(self.cache)))
        return embedding

    def tokens(self, embedding: np.ndarray) -> np.ndarray:
        spec = self.quantizer.get_input_details()[0]
        self.quantizer.set_tensor(
            spec["index"], embedding.astype(np.float32).reshape(spec["shape"])
        )
        self.quantizer.invoke()
        result = self.quantizer.get_tensor(self.quantizer.get_output_details()[0]["index"])
        tokens = result.flatten()[:12].astype(np.int32)
        tokens[6:] = -1  # Same coarse style conditioning as the upstream realtime runner.
        return tokens


def conditioning(style, notes, *, drumless=False):
    """Exported graph uses 7 as offset; -1 means unspecified, 0 means off."""
    vector = np.concatenate([style, notes, [0 if drumless else -1]]).astype(np.int32) + 7
    negative_style = vector.copy()
    negative_style[:12] = 6
    negative_notes = vector.copy()
    negative_notes[12:140] = 6
    return vector, negative_style, negative_notes


class MusicEngine:
    sample_rate = 48_000
    frame_samples = 1920

    def __init__(self, model_dir: Path = MRT_DIR, seed: int = 7):
        import mlx.core as mx

        self.mx = mx
        mx.set_cache_limit(128 * 1024 * 1024)
        prefix = model_dir / "models" / "mrt2_small" / "mrt2_small"
        self.fn = mx.import_function(str(prefix.with_suffix(".mlxfn")))
        stored = mx.load(str(prefix.parent / "mrt2_small_state.safetensors"))
        self.initial = [stored[f"state_{i}"] for i in range(len(stored))]
        if not self.initial:
            raise ValueError("MRT2 checkpoint has no initial state")
        for i, tensor in enumerate(self.initial):
            if tensor.dtype == mx.uint32 and tensor.shape[-1:] == (2,):
                self.initial[i] = mx.broadcast_to(mx.random.key(seed), tensor.shape)
        mx.eval(self.initial)
        self.state = list(self.initial)
        self.style = StyleEncoder(model_dir / "resources" / "musiccoca")
        self.base = None
        self.target = None
        self.current = None
        self.style_tokens = np.full(12, -1, dtype=np.int32)
        self.frame = 0
        self.last_ms = 0.0
        self.set_style("chamber", "unknown")

    def set_style(self, palette: str, action: str):
        base = self.style.embed(PALETTE_CONTEXT[palette])
        accent = self.style.embed(style_prompt(palette, action))
        self.target = (0.1 * base + 0.9 * accent).astype(np.float32)
        if self.current is None:
            self.current = self.target.copy()

    def set_arrangement(self, palette: str, arrangement: Arrangement, bpm: float):
        self.apply_style(self.prepare_arrangement(palette, arrangement, bpm))

    def prepare_arrangement(self, palette: str, arrangement: Arrangement, bpm: float):
        # One description of simultaneous parts, not a blend between solo instruments.
        return self.style.embed(ensemble_prompt(palette, arrangement, bpm)).copy()

    def apply_style(self, embedding):
        self.target = embedding
        if self.current is None:
            self.current = self.target.copy()

    def generate(
        self, notes: np.ndarray | None = None, drumless=False, note_guidance=1.0
    ) -> np.ndarray:
        mx = self.mx
        started = time.perf_counter()
        self.update_style()
        if notes is None:
            notes = np.full(128, -1, dtype=np.int32)
        cond, neg_style, neg_notes = conditioning(self.style_tokens, notes, drumless=drumless)
        args = [
            mx.array(cond.reshape(1, 1, -1)),
            mx.array([1.1], dtype=mx.float32),
            mx.array([40], dtype=mx.int32),
            mx.array([3.0], dtype=mx.float32),
            mx.array([note_guidance], dtype=mx.float32),
            mx.array([1.0], dtype=mx.float32),
            mx.array(neg_style.reshape(1, 1, -1)),
            mx.array(neg_notes.reshape(1, 1, -1)),
            mx.zeros((1, 0, 12), dtype=mx.int32),
        ]
        outputs = self.fn(args + self.state)
        mx.eval(outputs)
        raw = np.array(outputs[0])[0].T
        samples = raw.astype(np.float32)
        if raw.dtype == np.int16:
            samples /= 32768.0
        if not np.isfinite(samples).all():
            raise ValueError("Music engine returned non-finite samples")
        self.state = list(outputs[1:])
        self.frame += 1
        self.last_ms = (time.perf_counter() - started) * 1000
        return np.clip(samples, -1, 1)

    def update_style(self):
        """Share style blending between the local MLX and remote JAX engines."""
        if self.frame % 5 == 0:
            self.current += 0.2 * (self.target - self.current)
            self.style_tokens = self.style.tokens(self.current)


class NotePlanner:
    """A sparse repeating harmonic framework; the model supplies the arrangement."""

    chords = ((48, 60, 64, 67), (45, 57, 60, 64), (41, 53, 57, 60), (43, 55, 59, 62))

    def __init__(self):
        self.beat = 0.0
        self.active = {}
        self.tick = 0
        self.strum = []
        self.last_pitch = None
        self.cue_count = 0

    def next(
        self,
        bpm: float,
        action: str,
        accent: int | None = None,
        articulation: str = "unknown",
        *,
        register: float = 0.5,
        guided: bool = False,
        beat: float | None = None,
    ) -> np.ndarray:
        before = self.beat
        self.beat = self.beat + bpm / 60 * 0.04 if beat is None else beat
        self.tick += 1
        chord = self.chords[int(self.beat // 16) % len(self.chords)]
        onsets = []
        mapped = guided and action in ("piano", "strum", "strike", "sustain")
        if int(before) != int(self.beat) and int(self.beat) % 2 == 0 and not mapped:
            onsets.append(chord[(int(self.beat) // 2) % len(chord)])
        # Keep the lower accompaniment free; explicitly control the lead register.
        tokens = np.full(128, -1, dtype=np.int32)
        if mapped:
            tokens[48:96] = 0
        if accent is not None:
            if mapped:
                choices = [p for p in range(48, 85) if p % 12 in {n % 12 for n in chord}]
                center = round(max(0, min(1, register)) * (len(choices) - 4))
                pitch = choices[min(center + accent % 4, len(choices) - 1)]
            else:
                pitch = chord[accent % len(chord)] + (12 if action == "piano" else 0)
            onsets.append(pitch)
            self.last_pitch = pitch
            self.cue_count += 1
            if action == "strum":
                chord_tones = [
                    p
                    for p in range(pitch + 1, min(96, pitch + 13))
                    if p % 12 in {n % 12 for n in chord}
                ]
                self.strum = [(self.tick + i, p) for i, p in enumerate(chord_tones[:2], 1)]
        if mapped and action == "sustain" and not self.active:
            onsets.append(chord[2] + (12 if register > 0.65 else -12 if register < 0.35 else 0))
        onsets.extend(pitch for tick, pitch in self.strum if tick <= self.tick)
        self.strum = [(tick, pitch) for tick, pitch in self.strum if tick > self.tick]
        for pitch, expiry in list(self.active.items()):
            if expiry <= self.tick:
                tokens[pitch] = 0
                del self.active[pitch]
            else:
                tokens[pitch] = 1
        for pitch in onsets:
            tokens[pitch] = 2
            length = 35 if action == "sustain" else 20 if articulation == "flowing" else 5
            if articulation == "detached":
                length = 3
            self.active[pitch] = self.tick + length
        return tokens
