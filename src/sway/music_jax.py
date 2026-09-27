"""Colab's JAX engine using the same style blending and controls as local music."""

import time

import numpy as np

from .config import ACTION_STYLES, PALETTES
from .music import MusicEngine, StyleEncoder, style_prompt


class JaxMusicEngine(MusicEngine):
    def __init__(self, model="mrt2_base"):
        from magenta_rt import MagentaRT2Jax, paths

        self.model_id = model
        self.model = MagentaRT2Jax(size=model, temperature=1.1, top_k=40)
        self.style = StyleEncoder(paths.magenta_home() / "resources/musiccoca")
        for palette in PALETTES:
            for action in ACTION_STYLES:
                self.style.embed(style_prompt(palette, action))
        self.reset()
        for _ in range(50):
            self.generate()
        self.reset()

    def reset(self):
        self.state = None
        self.current = None
        self.target = None
        self.frame = 0
        self.last_ms = 0.0
        self.style_tokens = np.full(12, -1, dtype=np.int32)
        self.set_style("chamber", "unknown")

    def generate(self, notes=None, drumless=False, note_guidance=1.0):
        from magenta_rt.config import MUSICCOCA, PIANOROLL_WITH_ONSETS

        started = time.perf_counter()
        self.update_style()
        if notes is None:
            notes = np.full(128, -1, dtype=np.int32)
        conditioning = {MUSICCOCA.key: self.style_tokens, PIANOROLL_WITH_ONSETS.key: notes}
        waveform, self.state = self.model.generate(
            conditioning=conditioning,
            cfg_scales={"musiccoca": 3.0, "notes": note_guidance, "drums": 1.0},
            frames=1,
            state=self.state,
        )
        samples = np.asarray(waveform.samples, dtype=np.float32)
        if samples.shape != (1920, 2) or not np.isfinite(samples).all():
            raise ValueError("Remote engine returned an invalid stereo frame")
        self.frame += 1
        self.last_ms = (time.perf_counter() - started) * 1000
        return np.clip(samples, -1, 1)
