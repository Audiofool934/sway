// Launches Chromium for the renderers. On the development Mac this uses the installed
// Chrome; in a container it uses a Playwright-provided Chromium. Set SWAY_CHROME to a
// browser executable to override both.

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";

function findChromium() {
  if (process.env.SWAY_CHROME) return process.env.SWAY_CHROME;
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (base && existsSync(base)) {
    for (const name of readdirSync(base).sort().reverse()) {
      if (!name.startsWith("chromium")) continue;
      const candidate = join(base, name, "chrome-linux", "chrome");
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

export async function launch() {
  const executablePath = findChromium();
  const args = [
    "--no-sandbox",
    "--autoplay-policy=no-user-gesture-required",
    "--disable-dev-shm-usage",
    "--force-color-profile=srgb",
  ];
  return executablePath
    ? chromium.launch({ executablePath, args })
    : chromium.launch({ channel: "chrome", args });
}
