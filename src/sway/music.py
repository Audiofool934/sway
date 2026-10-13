"""MRT2's exported streaming graph, with a small MusicCoCa text adapter.

Conditioning and text tokenization follow Google's Apache-2.0 Magenta RT code.
See THIRD_PARTY_NOTICES.md for attribution and the inspected source revision.
"""

import time
from pathlib import Path

import numpy as np

from .config import MRT_DIR


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
        # The style is unspecified until a caller applies one.
        self.target = None
        self.current = None
        self.style_tokens = np.full(12, -1, dtype=np.int32)
        self.frame = 0
        self.last_ms = 0.0

    def reset(self, seed: int):
        """Start a fresh stream whose random choices follow `seed`."""
        mx = self.mx
        state = list(self.initial)
        for i, tensor in enumerate(state):
            if tensor.dtype == mx.uint32 and tensor.shape[-1:] == (2,):
                state[i] = mx.broadcast_to(mx.random.key(seed), tensor.shape)
        mx.eval(state)
        self.state = state
        self.frame = 0

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
        """Move the style a fifth of the way to its target every five frames."""
        if self.current is not None and self.frame % 5 == 0:
            self.current += 0.2 * (self.target - self.current)
            self.style_tokens = self.style.tokens(self.current)
