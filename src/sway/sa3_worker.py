"""Stable Audio 3 for the score variant: it redraws one window of audio at a time.

Sway never imports this file. `sway.scored` runs it with Stable Audio 3's own Python, whose
MLX differs from the one Sway pins for MRT2, and keeps it running between takes. Requests
and answers are one line of JSON each, followed by audio when they name `frames`: float32
samples at 44.1 kHz, the left channel's and then the right's.

- The first request sets it up: {"folder", "dit", "prompt"}. It loads the DiT, its encoder
  and decoder, and the prompt's text embedding, and answers {"ready": seconds}.
- {"keep": latents, "level", "steps", "seed", "frames"} and a window of audio: the window
  redrawn from latent `keep` on, from the given noise level (audio to audio), with the
  latents before `keep` kept at every step (inpainting). This is how
  work/renderers/sa3_pieces.py rendered the pieces offline on October 29 and 30
  (docs/steered-page.md#sa3-in-pieces). The answer names `frames` and `took`, the seconds of
  each stage, and the redrawn window follows.
- {"warm": latents, "keep": latents, "level", "steps"} builds the DiT for windows of that
  length and runs two on silence, with nothing kept and with `keep`, so that a take's first
  windows do not wait for MLX to compile.

A request that fails is answered with {"error"}. It loads only weights already on this Mac,
and never downloads. Anything that Stable Audio 3 prints goes to stderr, so that stdout
carries only answers. It stops when stdin closes.
"""

import gc
import json
import math
import os
import sys
import time
from pathlib import Path

import mlx.core as mx
import numpy as np


def main():
    answers = os.fdopen(os.dup(1), "wb")
    os.dup2(2, 1)
    sys.stdout = sys.stderr

    def answer(message, audio=None):
        answers.write(json.dumps(message).encode() + b"\n")
        if audio is not None:
            answers.write(audio.astype("<f4").tobytes())
        answers.flush()

    setup = json.loads(sys.stdin.buffer.readline())
    started = time.perf_counter()
    try:
        renderer = Renderer(Path(setup["folder"]), setup["dit"], setup["prompt"])
    except Exception as error:
        answer({"error": f"{type(error).__name__}: {error}"})
        return
    answer({"ready": time.perf_counter() - started})
    while line := sys.stdin.buffer.readline():
        request = json.loads(line)
        audio = None
        if "frames" in request:
            data = sys.stdin.buffer.read(2 * request["frames"] * 4)
            audio = np.frombuffer(data, "<f4").reshape(2, request["frames"])
        try:
            if "warm" in request:
                renderer.warm(request["warm"], request["keep"], request["level"], request["steps"])
                answer({"warm": request["warm"]})
            else:
                out, took = renderer.window(
                    audio, request["keep"], request["level"], request["steps"], request["seed"]
                )
                answer({"frames": out.shape[1], "took": took}, out)
        except Exception as error:
            answer({"error": f"{type(error).__name__}: {error}"})


class Renderer:
    """A Stable Audio 3 DiT, its encoder and decoder, and the prompt, loaded once."""

    def __init__(self, folder: Path, dit: str, prompt: str):
        sys.path[:0] = [str(folder), str(folder / "scripts")]
        from models.defs import sa3_pipeline
        from models.defs.t5gemma_mlx import T5Gemma
        from sa3_mlx import (
            DECODER_CHOICES,
            DIT_CHOICES,
            ENCODER_CHOICES,
            SAMPLE_RATE,
            SAMPLES_PER_LATENT,
            T5GEMMA_NPZ_REL,
            load_decoder,
            load_dit,
            load_encoder,
            patch_audio,
        )

        decoder = DIT_CHOICES[dit]["default_decoder"]
        needed = (
            T5GEMMA_NPZ_REL,
            DIT_CHOICES[dit]["ckpt"],
            ENCODER_CHOICES[decoder][2],
            DECODER_CHOICES[decoder][3],
        )
        missing = [name for name in needed if not (folder / name).exists()]
        if missing:
            raise FileNotFoundError(f"Stable Audio 3 weights are missing: {', '.join(missing)}")
        self.pipeline, self.load_dit, self.patch_audio = sa3_pipeline, load_dit, patch_audio
        self.rate, self.samples = SAMPLE_RATE, SAMPLES_PER_LATENT
        self.dit_name = dit
        self.dtype = mx.float16
        t5 = T5Gemma.from_npz(str(folder / T5GEMMA_NPZ_REL))
        self.embeds, self.mask = t5.encode([prompt], max_len=256)
        mx.eval(self.embeds, self.mask)
        del t5
        self.padding, self.seconds_embedder = sa3_pipeline.load_conditioner_from_npz(
            str(folder / DIT_CHOICES[dit]["ckpt"]), prefix="cond."
        )
        self.encoder, self.pad_modulo = load_encoder(decoder, mx.float32)
        self.decoder, self.decode_chunked, (self.chunk, self.overlap) = load_decoder(
            decoder, mx.float32
        )
        self.dit, self.dit_length = None, None

    def model(self, length: int):
        """The DiT, built for windows of `length` latents."""
        if self.dit_length != length:
            self.dit = None
            gc.collect()
            mx.clear_cache()
            self.dit, _ = self.load_dit(self.dit_name, T_lat=length, dtype=self.dtype)
            self.dit_length = length
        return self.dit

    def warm(self, length: int, keep: int, level: float, steps: int):
        silence = np.zeros((2, length * self.samples), dtype=np.float32)
        for kept in (0, keep):
            self.window(silence, kept, level, steps, 0)

    def encode(self, audio):
        length = audio.shape[-1] // self.samples
        padded_length = length
        if (length * 16) % self.pad_modulo:
            padded_length = math.ceil(length * 16 / self.pad_modulo) * self.pad_modulo // 16
        padded = np.pad(audio, ((0, 0), (0, (padded_length - length) * self.samples)))
        patches = mx.array(self.patch_audio(padded[None], patch_size=256))
        latents = self.encoder(patches)[..., :length]
        mx.eval(latents)
        return latents.astype(self.dtype)

    def decode(self, latents):
        latents = latents.astype(mx.float32)
        length = latents.shape[-1]
        if length > self.chunk + 2 * self.overlap:
            patches = self.decode_chunked(self.decoder, latents, self.chunk, self.overlap)
        elif length % 2 == 0:
            patches = self.decoder(latents)
        else:
            patches = self.decode_chunked(self.decoder, latents, 2, 2)
        audio = self.pipeline.patched_decode(patches, patch_size=256, channels=2)
        mx.eval(audio)
        return np.array(audio.astype(mx.float32))[0]

    def window(self, audio, keep: int, level: float, steps: int, seed: int):
        """`audio` redrawn from latent `keep` on, and the seconds each stage took."""
        length = audio.shape[-1] // self.samples
        took = {}
        started = time.perf_counter()
        latents = self.encode(audio)
        took["encode"] = time.perf_counter() - started

        started = time.perf_counter()
        seconds = self.seconds_embedder(length * self.samples / self.rate).astype(self.dtype)
        padded = self.pipeline.apply_prompt_padding(
            self.embeds.astype(self.dtype), self.mask, self.padding.astype(self.dtype)
        )
        cross = mx.concatenate([padded, seconds], axis=1)
        glob = seconds[:, 0, :]
        noise = mx.random.normal((1, 256, length), dtype=self.dtype, key=mx.random.key(seed))
        start = latents * (1.0 - level) + noise * level
        condition, paste_back = None, None
        if keep:
            kept = np.ones((1, 1, length), dtype=np.float32)
            kept[:, :, keep:] = 0.0
            kept = mx.array(kept)
            masked = latents.astype(mx.float32) * kept
            condition = mx.concatenate([kept, masked], axis=1).transpose(0, 2, 1)
            condition = condition.astype(self.dtype)
            paste_back = (latents, kept)
        model = self.model(length)
        sigmas = self.pipeline.build_pingpong_schedule(
            steps, sigma_max=level, use_logsnr_shift=True
        )
        result = self.pipeline.sample_flow_pingpong(
            lambda x, t: model(x, t, cross, glob, local_add_cond=condition),
            start,
            sigmas,
            seed=seed + 1,
            paste_back=paste_back,
        )
        mx.eval(result)
        took["sample"] = time.perf_counter() - started

        started = time.perf_counter()
        out = self.decode(result)
        took["decode"] = time.perf_counter() - started
        return out[:, : length * self.samples], took


if __name__ == "__main__":
    main()
