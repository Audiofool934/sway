import { test } from "node:test";
import assert from "node:assert/strict";
import { Camera } from "../web/instrument/camera.js";

function harness(t, bitmap, options = {}) {
  const callbacks = [];
  const workers = [];
  const tracks = [];
  const statuses = [];
  const originals = new Map();
  const replace = (name, value) => {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, value });
  };
  t.after(() => {
    camera.stop();
    for (const [name, descriptor] of originals)
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
  });
  replace("navigator", {
    mediaDevices: {
      async getUserMedia() {
        const track = {
          stopped: false,
          stop() {
            this.stopped = true;
          },
          addEventListener() {},
        };
        tracks.push(track);
        return {
          getTracks: () => [track],
          getVideoTracks: () => [track],
        };
      },
    },
  });
  replace(
    "Worker",
    class {
      constructor() {
        workers.push(this);
        this.terminated = false;
      }
      postMessage(data) {
        if (data.type === "init") this.onmessage({ data: { type: "ready" } });
      }
      terminate() {
        this.terminated = true;
      }
    },
  );
  replace("createImageBitmap", bitmap);
  const video = {
    videoWidth: 640,
    videoHeight: 480,
    srcObject: null,
    async play() {},
    requestVideoFrameCallback: (callback) => callbacks.push(callback),
  };
  const camera = new Camera(video, {
    onHands() {},
    onStatus: (status) => statuses.push(status),
    ...options,
  });
  const frame = (time = 100) => callbacks.shift()(time, { captureTime: time });
  return { camera, video, frame, callbacks, workers, tracks, statuses };
}

test("a failed camera frame releases the stream and worker and stops callbacks", async (t) => {
  const h = harness(t, async () => {
    throw new Error("frame unavailable");
  });
  await h.camera.start();
  await h.frame();
  assert.equal(h.camera.active, false);
  assert.equal(h.video.srcObject, null);
  assert.equal(h.tracks[0].stopped, true);
  assert.equal(h.workers[0].terminated, true);
  assert.equal(h.statuses.at(-1), "error");
  // A callback was already queued before the failed capture; it must do no work.
  await h.frame();
  assert.equal(h.callbacks.length, 0);
  assert.equal(h.statuses.filter((status) => status === "error").length, 1);
  await h.camera.start();
  assert.equal(h.camera.active, true);
  assert.equal(h.statuses.at(-1), "tracking");
});

test("a tracking budget skips preprocessing without stopping the camera preview", async (t) => {
  let bitmaps = 0;
  const h = harness(
    t,
    async () => {
      bitmaps++;
      return { close() {} };
    },
    { maxFps: 12 },
  );
  await h.camera.start();
  for (let i = 0; i < 30; i++) {
    await h.frame(100 + i * (1000 / 30));
    h.workers[0].onmessage({
      data: { type: "motion", capture_ms: 100 + i * (1000 / 30), hands: [] },
    });
  }
  assert.equal(bitmaps, 10);
  assert.equal(h.camera.stats.skipped, 20);
  assert.equal(h.camera.stats.dropped, 0);
  assert.ok(h.camera.active && !h.tracks[0].stopped);
  h.camera.stop();
  await h.camera.start();
  await h.frame(1100); // Discard the already queued callback from the old session.
  await h.frame(1101);
  assert.equal(bitmaps, 11);
});

test("a failed frame from an old camera session cannot stop a restarted camera", async (t) => {
  let reject;
  const h = harness(
    t,
    () =>
      new Promise((_, fail) => {
        reject = fail;
      }),
  );
  await h.camera.start();
  const pending = h.frame();
  h.camera.stop();
  await h.camera.start();
  reject(new Error("old frame unavailable"));
  await pending;
  assert.equal(h.camera.active, true);
  assert.equal(h.tracks[1].stopped, false);
  assert.equal(h.workers[1].terminated, false);
  assert.equal(h.statuses.includes("error"), false);
  assert.equal(h.statuses.at(-1), "tracking");
});
