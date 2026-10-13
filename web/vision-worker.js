/* MediaPipe runs off the UI thread. Its WASM and models are served locally. */
importScripts("/vendor/vision_bundle.js");
let hands;

self.onmessage = async ({ data }) => {
  if (data.type === "init") {
    try {
      const vision =
        await Vision.FilesetResolver.forVisionTasks("/vendor/wasm");
      hands = await Vision.HandLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: "/models/hand_landmarker.task",
          delegate: data.delegate === "GPU" ? "GPU" : "CPU",
        },
        runningMode: "VIDEO",
        numHands: 2,
        minHandDetectionConfidence: 0.5,
      });
      self.postMessage({ type: "ready" });
    } catch (error) {
      self.postMessage({ type: "error", error: error.message });
    }
    return;
  }
  if (data.type !== "frame") return;
  try {
    const result = hands.detectForVideo(data.image, data.timestamp);
    const point = ({ x, y, z }) => ({ x, y, z });
    self.postMessage({
      type: "motion",
      timestamp_ms: data.timestamp,
      capture_ms: data.captureTime,
      hands: result.landmarks.map((points, index) => ({
        side: result.handedness[index][0].categoryName,
        score: result.handedness[index][0].score,
        points: points.map(point),
        // Metric 3D landmarks make hand-shape ratios independent of camera distance.
        world: result.worldLandmarks[index]?.map(point) || [],
      })),
    });
  } catch (error) {
    self.postMessage({ type: "error", error: error.message });
  } finally {
    data.image.close();
  }
};
