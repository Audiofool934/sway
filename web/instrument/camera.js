// Camera capture and the tracking worker. Frames are taken as the camera delivers
// them, one in flight at a time, and each result carries its capture time so the
// engine can place a gesture where it happened rather than when it was recognised.

const TRACKING_WIDTH = 640;

export class Camera {
  constructor(
    video,
    { onHands, onStatus = () => {}, delegate = "CPU", maxFps = Infinity } = {},
  ) {
    this.video = video;
    this.onHands = onHands;
    this.onStatus = onStatus;
    this.delegate = delegate;
    this.maxFps = maxFps;
    this.lastSample = -Infinity;
    this.stream = null;
    this.worker = null;
    this.busy = false;
    this.epoch = 0;
    this.stats = {
      frames: 0,
      dropped: 0,
      skipped: 0,
      tracking: [],
      captureTimes: 0,
    };
  }

  get active() {
    return Boolean(this.stream);
  }

  get aspect() {
    return this.video.videoWidth / this.video.videoHeight || 16 / 9;
  }

  async start() {
    if (this.stream) return;
    const epoch = ++this.epoch;
    this.lastSample = -Infinity;
    this.onStatus("starting");
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 60 },
      },
      audio: false,
    });
    if (epoch !== this.epoch) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    this.stream = stream;
    this.video.srcObject = stream;
    await this.video.play();
    stream.getVideoTracks()[0].addEventListener("ended", () => {
      this.stop();
      this.onStatus("ended");
    });
    this.onStatus("loading");
    this.worker = new Worker("/vision-worker.js");
    this.worker.onerror = (event) => {
      this.stop();
      this.onStatus(
        "error",
        event.message || "The hand tracker could not start.",
      );
    };
    this.worker.onmessage = ({ data }) => this.#message(data, epoch);
    this.worker.postMessage({
      type: "init",
      handsOnly: true,
      delegate: this.delegate,
    });
  }

  stop() {
    this.epoch++;
    this.worker?.terminate();
    this.worker = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.video.srcObject = null;
    this.busy = false;
  }

  #message(data, epoch) {
    if (epoch !== this.epoch) return;
    if (data.type === "ready") {
      this.onStatus("tracking");
      this.video.requestVideoFrameCallback((now, meta) =>
        this.#frame(now, meta, epoch),
      );
      return;
    }
    if (data.type === "error") {
      this.stop();
      this.onStatus("error", data.error);
      return;
    }
    if (data.type !== "motion") return;
    this.busy = false;
    const received = performance.now();
    const tracking = received - data.capture_ms;
    this.stats.tracking.push(tracking);
    if (this.stats.tracking.length > 120) this.stats.tracking.shift();
    this.onHands(data.hands, data.capture_ms / 1000, {
      tracking,
      aspect: this.aspect,
    });
  }

  async #frame(now, meta, epoch) {
    if (epoch !== this.epoch) return;
    this.video.requestVideoFrameCallback((n, m) => this.#frame(n, m, epoch));
    this.stats.frames++;
    // Continuous music generation can reserve headroom by sampling fewer camera
    // frames, while the preview remains at the device's full frame rate.
    if (now - this.lastSample < 1000 / this.maxFps - 1) {
      this.stats.skipped++;
      return;
    }
    if (this.busy) {
      this.stats.dropped++;
      return;
    }
    this.busy = true;
    this.lastSample = now;
    // Chrome reports when the camera captured the frame; otherwise use its arrival.
    if (meta.captureTime) this.stats.captureTimes++;
    const captureTime = meta.captureTime ?? meta.presentationTime ?? now;
    try {
      const scale = TRACKING_WIDTH / this.video.videoWidth;
      const image = await createImageBitmap(this.video, {
        resizeWidth: TRACKING_WIDTH,
        resizeHeight: Math.round(this.video.videoHeight * scale),
        resizeQuality: "low",
      });
      if (epoch !== this.epoch || !this.worker) {
        image.close();
        return;
      }
      this.worker.postMessage(
        { type: "frame", image, timestamp: performance.now(), captureTime },
        [image],
      );
    } catch (error) {
      if (epoch !== this.epoch) return;
      this.stop();
      this.onStatus("error", `Camera processing stopped: ${error.message}`);
    }
  }
}
