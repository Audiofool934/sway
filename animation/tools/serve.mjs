// A tiny static server for the repository root, so the animation page can import its
// own modules and, for the finale, Sway's real instrument modules from web/instrument.
// Run directly for a live preview, or import startServer() from the renderers.

import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".mp4": "video/mp4",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

export function startServer(port = 0) {
  const server = createServer((request, response) => {
    const path = decodeURIComponent(new URL(request.url, "http://x").pathname);
    const file = normalize(join(ROOT, path));
    if (!file.startsWith(ROOT + sep) || !existsSync(file)) {
      response.writeHead(404).end("not found");
      return;
    }
    const target = statSync(file).isDirectory() ? join(file, "index.html") : file;
    if (!existsSync(target)) {
      response.writeHead(404).end("not found");
      return;
    }
    response.writeHead(200, {
      "content-type": TYPES[extname(target)] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    createReadStream(target).pipe(response);
  });
  return new Promise((done) =>
    server.listen(port, "127.0.0.1", () => {
      const { port: bound } = server.address();
      done({
        url: `http://127.0.0.1:${bound}`,
        close: () => new Promise((closed) => server.close(closed)),
      });
    }),
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { url } = await startServer(Number(process.env.PORT) || 8766);
  console.log(`Preview: ${url}/animation/index.html`);
}
