// Render the film: several headless Chromium pages draw frames in parallel, and the
// frames are piped in order to ffmpeg, which muxes them with the soundtrack.
//
//   node tools/render.mjs                         full film -> out/between-hand-and-sound.mp4
//   node tools/render.mjs --from 0 --to 300       a frame range (end exclusive), for tests
//   node tools/render.mjs --scale 0.5 --crf 28    a quick half-size preview
//   options: --audio out/soundtrack.wav  --out <file>  --workers 4  --fps 30  --crf 18
//            --preset slow  --jpeg (faster, slightly lossy intermediate frames)

import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "./browser.mjs";
import { startServer } from "./serve.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : fallback;
};
const flag = (name) => args.includes(`--${name}`);

const out = resolve(ROOT, option("out", "out/between-hand-and-sound.mp4"));
const audioPath = resolve(ROOT, option("audio", "out/soundtrack.wav"));
const workers = Number(option("workers", 4));
const crf = option("crf", "18");
const preset = option("preset", "slow");
const scale = Number(option("scale", 1));
const jpeg = flag("jpeg");
mkdirSync(dirname(out), { recursive: true });

const server = await startServer();
const browser = await launch();
const pages = [];
for (let i = 0; i < workers; i++) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.on("pageerror", (error) => {
    console.error("page error:", error.message);
    process.exitCode = 1;
  });
  await page.goto(`${server.url}/animation/index.html?render`);
  await page.evaluate(() => window.film.ready);
  pages.push(page);
}
const info = await pages[0].evaluate(() => ({
  fps: window.film.fps,
  frames: Math.round(window.film.duration * window.film.fps),
}));
const from = Number(option("from", 0));
const to = Math.min(Number(option("to", info.frames)), info.frames);
const total = to - from;
const fps = Number(option("fps", info.fps));

const hasAudio = existsSync(audioPath) && !flag("silent");
const ffmpegArgs = [
  "-y",
  "-loglevel", "warning",
  "-f", "image2pipe",
  "-framerate", String(fps),
  "-c:v", jpeg ? "mjpeg" : "png",
  "-i", "pipe:0",
];
if (hasAudio) ffmpegArgs.push("-ss", String(from / fps), "-i", audioPath);
const filters = [];
if (scale !== 1) filters.push(`scale=${Math.round(1920 * scale)}:${Math.round(1080 * scale)}:flags=lanczos`);
filters.push("scale=in_range=full:out_range=tv:out_color_matrix=bt709", "format=yuv420p");
ffmpegArgs.push(
  "-vf", filters.join(","),
  "-c:v", "libx264",
  "-preset", preset,
  "-crf", crf,
  "-tune", "animation",
  "-profile:v", "high",
  "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
  "-movflags", "+faststart",
);
if (hasAudio)
  ffmpegArgs.push("-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-t", String(total / fps));
else ffmpegArgs.push("-an");
ffmpegArgs.push(out);

const ffmpeg = spawn("ffmpeg", ffmpegArgs, { stdio: ["pipe", "inherit", "inherit"] });
const finished = new Promise((done, fail) => {
  ffmpeg.on("exit", (code) => (code === 0 ? done() : fail(new Error(`ffmpeg exited ${code}`))));
  ffmpeg.stdin.on("error", fail);
});

const ready = new Map();
let nextWrite = from;
let nextTake = from;
let writing = Promise.resolve();
const started = Date.now();

function flush() {
  writing = writing.then(async () => {
    while (ready.has(nextWrite)) {
      const buffer = ready.get(nextWrite);
      ready.delete(nextWrite);
      nextWrite++;
      if (!ffmpeg.stdin.write(buffer)) await new Promise((r) => ffmpeg.stdin.once("drain", r));
      const done = nextWrite - from;
      if (done % 150 === 0 || done === total) {
        const elapsed = (Date.now() - started) / 1000;
        const eta = (elapsed / done) * (total - done);
        console.log(`frame ${done}/${total}  ${elapsed.toFixed(0)}s elapsed, ~${eta.toFixed(0)}s left`);
      }
    }
  });
  return writing;
}

async function work(page) {
  while (nextTake < to) {
    const index = nextTake++;
    // Keep workers from racing far ahead of the writer.
    while (index - nextWrite > workers * 6) await new Promise((r) => setTimeout(r, 5));
    const data = await page.evaluate(
      ([i, type]) => window.film.frame(i, type, 0.96),
      [index, jpeg ? "image/jpeg" : "image/png"],
    );
    ready.set(index, Buffer.from(data, "base64"));
    flush();
  }
}

await Promise.all(pages.map(work));
await flush();
ffmpeg.stdin.end();
await finished;
await browser.close();
await server.close();
console.log(`wrote ${out} (${total} frames, ${((Date.now() - started) / 1000).toFixed(0)}s)`);
