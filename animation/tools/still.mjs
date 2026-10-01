// Render stills for inspection:
//   node tools/still.mjs 12.5 40            -> out/stills/still-12.50.png ...
//   node tools/still.mjs --sheet 33.6:52.8 --count 6 --cols 3
// A contact sheet tiles evenly spaced frames from a time range, to review a scene at a glance.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "./browser.mjs";
import { startServer } from "./serve.mjs";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "out", "stills");
mkdirSync(OUT, { recursive: true });

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : fallback;
};
const sheet = option("sheet", null);
const times = [];
if (sheet) {
  const [from, to] = sheet.split(":").map(Number);
  const count = Number(option("count", 6));
  for (let i = 0; i < count; i++) times.push(from + ((to - from) * i) / Math.max(1, count - 1));
} else {
  for (const arg of args) if (!Number.isNaN(Number(arg))) times.push(Number(arg));
}

const server = await startServer();
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.on("pageerror", (error) => console.error("page error:", error.message));
page.on("console", (message) => {
  if (message.type() === "error") console.error("console:", message.text());
});
await page.goto(`${server.url}/animation/index.html?render`);
await page.evaluate(() => window.film.ready);

const files = [];
for (const time of times) {
  const data = await page.evaluate(async (t) => {
    await window.film.at(t);
    return document.getElementById("stage").toDataURL("image/png").split(",")[1];
  }, time);
  const file = join(OUT, `still-${time.toFixed(2).padStart(6, "0")}.png`);
  writeFileSync(file, Buffer.from(data, "base64"));
  files.push(file);
  console.log(file);
}
await browser.close();
await server.close();

if (sheet) {
  const { spawnSync } = await import("node:child_process");
  const cols = Number(option("cols", 3));
  const name = option("name", "sheet");
  const target = join(OUT, `${name}.png`);
  const tile = option("tile", "640x360");
  const result = spawnSync("montage", [...files, "-tile", `${cols}x`, "-geometry", `${tile}+4+4`, "-background", "#111", target]);
  if (result.status !== 0) {
    const fallback = spawnSync("convert", [...files, "-resize", tile, "+append", target]);
    if (fallback.status !== 0) console.error("montage and convert both failed");
  }
  console.log(`sheet: ${target}`);
}
