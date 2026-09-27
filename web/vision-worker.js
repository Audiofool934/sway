/* MediaPipe runs off the UI thread. Its WASM and models are served locally. */
importScripts("/vendor/vision_bundle.js");
let hands,
  pose,
  frame = 0;

self.onmessage = async ({ data }) => {
  if (data.type === "init") {
    try {
      const vision =
        await Vision.FilesetResolver.forVisionTasks("/vendor/wasm");
      hands = await Vision.HandLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: "/models/hand_landmarker.task",
          delegate: "CPU",
        },
        runningMode: "VIDEO",
        numHands: 2,
        minHandDetectionConfidence: 0.5,
      });
      pose = data.handsOnly
        ? null
        : await Vision.PoseLandmarker.createFromOptions(vision, {
            baseOptions: {
              modelAssetPath: "/models/pose_landmarker_lite.task",
              delegate: "CPU",
            },
            runningMode: "VIDEO",
            numPoses: 1,
            outputSegmentationMasks: false,
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
    const body =
      pose && ++frame % 3 === 0
        ? pose.detectForVideo(data.image, data.timestamp)
        : null;
    const point = ({ x, y, z }) => ({ x, y, z });
    self.postMessage({
      type: "motion",
      timestamp_ms: data.timestamp,
      hands: result.landmarks.map((points, index) => ({
        side: result.handedness[index][0].categoryName,
        points: points.map(point),
      })),
      pose: body?.landmarks[0]?.map(point) || [],
    });
  } catch (error) {
    self.postMessage({ type: "error", error: error.message });
  } finally {
    data.image.close();
  }
};
