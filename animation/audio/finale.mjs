// Render the finale's soundtrack with Sway's own synthesizer and band, in headless Chromium.
//   node audio/finale.mjs        -> out/finale.wav (stereo float, 48 kHz, starting at bar 72)
// The page (finale-page.js) imports web/instrument/*.js directly from the repository.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "../tools/browser.mjs";
import { startServer } from "../tools/serve.mjs";
import { SR } from "../src/timeline.js";
import { writeWav } from "./wav.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(ROOT, "out", "finale.wav");
mkdirSync(dirname(out), { recursive: true });

const server = await startServer();
const browser = await launch();
const page = await browser.newPage();
page.on("pageerror", (error) => console.error("page error:", error.message));
page.on("console", (message) => {
  if (message.type() === "error") console.error("console:", message.text());
});
await page.goto(`${server.url}/animation/audio/finale.html`);
await page.waitForFunction(() => window.finaleReady === true, null, {
  timeout: 30000,
});
const started = Date.now();
const result = await page.evaluate(() => window.renderFinale({}));
await browser.close();
await server.close();

const bytes = Buffer.from(result.base64, "base64");
const interleaved = new Float32Array(
  bytes.buffer,
  bytes.byteOffset,
  bytes.byteLength / 4,
);
const left = new Float32Array(result.frames);
const right = new Float32Array(result.frames);
for (let i = 0; i < result.frames; i++) {
  left[i] = interleaved[2 * i];
  right[i] = interleaved[2 * i + 1];
}
writeWav(out, [left, right], SR);
writeFileSync(
  join(ROOT, "out", "finale.json"),
  JSON.stringify({
    start: result.start,
    frames: result.frames,
    layers: result.layers,
  }),
);
console.log(
  `finale: ${(result.frames / SR).toFixed(1)} s from film time ${result.start.toFixed(1)} s, ${result.layers} loop layer(s), rendered in ${((Date.now() - started) / 1000).toFixed(1)} s -> ${out}`,
);
