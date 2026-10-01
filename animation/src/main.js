// Page entry. Three ways to use it:
//   index.html            live preview with play, pause, and a scrubber
//   index.html?t=12.5     one still at film time 12.5 s (no controls)
//   index.html?render     headless: window.film.frame(i) returns frame i as an image
// A frame is a pure function of film time, so every way draws identical pictures.

import { loadFonts } from "./core/fonts.js";
import { drawFilm } from "./film.js";
import { DURATION, FPS, H, W } from "./timeline.js";

const params = new URLSearchParams(location.search);
const canvas = document.getElementById("stage");
const ctx = canvas.getContext("2d");
const render = params.has("render");
if (render) document.body.classList.add("render");

const timeAt = (frame) => frame / FPS;
const draw = (time) => drawFilm(ctx, Math.min(Math.max(time, 0), DURATION));

async function boot() {
  await loadFonts();
  if (params.has("t")) draw(Number(params.get("t")));
  else draw(0);
}

const ready = boot();

window.film = {
  ready,
  width: W,
  height: H,
  fps: FPS,
  duration: DURATION,
  /** Draw frame `index` and return it as a base64 image (no data: prefix). */
  async frame(index, type = "image/png", quality = 0.95) {
    await ready;
    draw(timeAt(index));
    return canvas.toDataURL(type, quality).split(",")[1];
  },
  /** Draw at an arbitrary film time without encoding. */
  async at(time) {
    await ready;
    draw(time);
  },
};

if (!render && !params.has("t")) {
  const controls = document.getElementById("controls");
  const play = document.getElementById("play");
  const scrub = document.getElementById("scrub");
  const clock = document.getElementById("clock");
  const audio = document.getElementById("soundtrack");
  audio.src = new URL("../out/soundtrack.m4a", import.meta.url).href;
  controls.hidden = false;
  let playing = false;
  let origin = 0;
  let base = 0;
  const now = () =>
    audio.readyState >= 2 && !audio.error
      ? audio.currentTime
      : base + (playing ? (performance.now() - origin) / 1000 : 0);
  const seek = (time) => {
    base = Math.min(Math.max(time, 0), DURATION);
    origin = performance.now();
    if (audio.readyState >= 1) audio.currentTime = base;
  };
  const toggle = () => {
    playing = !playing;
    play.textContent = playing ? "Pause" : "Play";
    if (playing) {
      origin = performance.now();
      audio.play().catch(() => {});
    } else {
      base = now();
      audio.pause();
    }
  };
  play.addEventListener("click", toggle);
  scrub.addEventListener("input", () => seek(Number(scrub.value) * DURATION));
  window.addEventListener("keydown", (event) => {
    if (event.code === "Space") {
      event.preventDefault();
      toggle();
    } else if (event.code === "ArrowRight") seek(now() + 5);
    else if (event.code === "ArrowLeft") seek(now() - 5);
  });
  const format = (seconds) =>
    `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
  const tick = async () => {
    await ready;
    const time = now();
    if (time >= DURATION && playing) toggle();
    draw(time);
    scrub.value = time / DURATION;
    clock.textContent = `${format(time)} / ${format(DURATION)}`;
    requestAnimationFrame(tick);
  };
  tick();
}
