import { wavBlob, VariationScheduler } from "./flow-engine.js";
import { FlowHands } from "./flow-hands.js";

const $ = (id) => document.getElementById(id);
let context,
  player,
  volume,
  anchor,
  variation,
  passages = [],
  cloud = {};
let running = false,
  loading = true,
  preparing = false,
  recording = false,
  finishing = false;
let snapshot = {},
  baseChannels,
  variationChannels,
  sequence = 0,
  generation = 0;
let trace = [],
  chunks = [],
  recordStart = 0,
  recordAnchor,
  recordVariation,
  recordInitial;
let stats = {},
  pendingControls = new Map(),
  downloads = [];
let cameraStream,
  vision,
  cameraFrame,
  cameraBusy = false,
  visionBusy = false;
let lastVideoTime = -1,
  lastHands = [],
  cameraEpoch = 0;
let lastGesture = 0,
  requestAbort;
let handController = new FlowHands();
const variationScheduler = new VariationScheduler();

function notice(message, error = false) {
  $("notice").textContent = message;
  $("notice").classList.toggle("error", error);
}
async function request(path, body) {
  const response = await fetch(
    `/api/flow/${path}`,
    body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: requestAbort?.signal,
        }
      : {},
  );
  const result = await response.json();
  if (!response.ok)
    throw new Error(
      typeof result.detail === "string"
        ? result.detail
        : "Check the prompt and tempo, then try again.",
    );
  return result;
}
function updateControls() {
  const available = cloud.configured && cloud.expires_at > Date.now() / 1000;
  $("play").disabled = loading || !anchor || finishing;
  $("play").textContent = running ? "■ Stop flow" : "▶ Begin flow";
  $("library").disabled = running || loading || preparing;
  $("generate").disabled = !available || running || loading || preparing;
  $("transform").disabled = !available || loading || preparing || !anchor;
  $("ending").disabled = !running || finishing;
  $("record").disabled = !running || finishing;
  $("morph").disabled = !(variation || available) || loading;
  $("auto-variation").disabled = !available;
  $("home").disabled = loading;
  $("cloud-state").textContent = available ? "COLAB READY" : "LOCAL PLAYBACK";
  $("engine-state").textContent = preparing
    ? "PREPARING…"
    : available
      ? "LIVE GENERATION"
      : "PREPARED AUDIO";
  $("cloud-note").textContent = available
    ? `New variations use Colab until ${new Date(cloud.expires_at * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}. They enter at the next bar; the original keeps playing.`
    : "Saved music keeps playing. Start the Colab Flow runner to generate a new piece or variation.";
  updateHandStatus();
}
function updateHandStatus() {
  const text = (element, value) => {
    if (element.textContent !== value) element.textContent = value;
  };
  const { intensity: right, morph: left } = handController.visible;
  const enabled = Boolean(cameraStream);
  const label = (axis, visible) => {
    if (!enabled) return "Camera off";
    if (handController.manual.has(axis)) return "Slider active";
    if (!visible) return "Not in view · value held";
    if (axis === "morph" && !variation) return "No variation ready";
    return "Hand active";
  };
  for (const [axis, visible] of [
    ["intensity", right],
    ["morph", left],
  ]) {
    const element = $(`${axis}-hand`);
    text(element, label(axis, visible));
    element.dataset.active = String(
      enabled &&
        Boolean(visible) &&
        !handController.manual.has(axis) &&
        (axis !== "morph" || Boolean(variation)),
    );
  }
  text(
    $("hand-status"),
    !enabled
      ? "Use the sliders, or enable the camera to play with your hands."
      : right || left
        ? "Hands are connected. The percentages follow your movement."
        : "Show either hand in the camera. Music holds while hands are out of view.",
  );
  if (!enabled) return;
  text(
    $("camera-state"),
    right && left
      ? "TRACKING BOTH HANDS"
      : right
        ? "TRACKING RIGHT HAND"
        : left
          ? "TRACKING LEFT HAND"
          : "SHOW YOUR HANDS",
  );
}
function setValues(
  morph = Number($("morph").value),
  intensity = Number($("intensity").value),
  source = "slider",
) {
  $("morph").value = morph;
  $("intensity").value = intensity;
  $("morph-value").textContent = `${Math.round(morph * 100)}%`;
  $("intensity-value").textContent = `${Math.round(intensity * 100)}%`;
  sequence++;
  pendingControls.set(sequence, { source, sent: performance.now() });
  pendingControls.delete(sequence - 200);
  player?.port.postMessage({ type: "control", morph, intensity, sequence });
}
async function prepareAudio() {
  if (context) return;
  context = new AudioContext({ sampleRate: 48000, latencyHint: "interactive" });
  await context.audioWorklet.addModule("/flow-worklet.js");
  player = new AudioWorkletNode(context, "sway-flow", {
    outputChannelCount: [2],
  });
  volume = context.createGain();
  volume.gain.value = Number($("volume").value);
  player.connect(volume).connect(context.destination);
  player.port.onmessage = ({ data }) => {
    if (data.type === "pcm") {
      chunks.push(data.chunk);
      return;
    }
    if (data.type === "recorded") {
      finishRecording();
      return;
    }
    if (data.type === "record-started") {
      recordStart = data.frame;
      recordInitial = data;
      return;
    }
    if (data.type === "error") {
      notice(data.message, true);
      return;
    }
    if (data.type === "control-applied") {
      const sent = pendingControls.get(data.sequence);
      stats.control_ack_ms = sent
        ? Math.round((performance.now() - sent.sent) * 10) / 10
        : null;
      if (recording && recordInitial)
        trace.push({
          ...data,
          source: sent?.source,
          relative_frame: data.frame - recordStart,
        });
      return;
    }
    if (data.type === "variation-applied") {
      $("variation-state").textContent = "Variation in place";
      if (recording && recordInitial)
        trace.push({ ...data, relative_frame: data.frame - recordStart });
      notice(
        "Your variation is in place. Explore it with the slider or your left hand.",
      );
    }
    if (data.type === "ended") {
      running = finishing = false;
      context.suspend().catch(() => {});
      $("phase").textContent = "A little silence";
      $("phase").classList.remove("live");
      updateControls();
    }
    if (data.type !== "state") return;
    snapshot = data;
    const seconds = Math.floor(data.seconds);
    $("elapsed").textContent =
      `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
    $("bar").textContent =
      `BAR ${String(data.bar || 1).padStart(2, "0")} / ${String(anchor?.bars || 8).padStart(2, "0")}`;
    if (baseChannels)
      $("playhead").style.left =
        `${(data.position / baseChannels[0].length) * 100}%`;
    if (data.pending && running)
      $("variation-state").textContent = "Queued for next bar";
    $("diagnostics").textContent = [
      `Source: ${anchor?.origin || "-"} · grid: ${anchor?.grid || "-"}`,
      `Audio clock: ${context.sampleRate} Hz · frame ${data.frame}`,
      `Variation swaps: ${data.applied} · active blend: ${Math.round(data.morph * 100)}%`,
      `Control → audio-thread acknowledgement: ${stats.control_ack_ms ?? "-"} ms`,
      `Browser output latency estimate: ${Math.round((context.outputLatency || 0) * 1000)} ms`,
      `Latest cloud request: ${stats.request_ms ?? "-"} ms · engine: ${stats.engine_ms ?? "-"} ms`,
      "Acknowledgement and engine timing are not physical gesture-to-speaker measurements.",
    ].join("\n");
  };
}
async function decode(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error("This saved passage is unavailable.");
  const buffer = await context.decodeAudioData(await response.arrayBuffer());
  return [buffer.getChannelData(0).slice(), buffer.getChannelData(1).slice()];
}
function showLibrary() {
  $("library").replaceChildren(
    ...passages
      .filter((p) => p.kind === "anchor")
      .map((p) => {
        const option = document.createElement("option");
        option.value = p.id;
        option.textContent = passageTitle(p);
        return option;
      }),
  );
  if (anchor) $("library").value = anchor.id;
}
function passageTitle(item) {
  return item.origin === "DEMON on Colab"
    ? item.prompt
        .split(",")[0]
        .replace(/^Instrumental\s+/i, "")
        .trim()
    : item.title;
}
async function loadAnchor(item) {
  if (running) return;
  loading = true;
  updateControls();
  const current = ++generation;
  try {
    await prepareAudio();
    const channels = await decode(item.audio_url);
    if (current !== generation) return;
    anchor = item;
    snapshot = {};
    baseChannels = channels;
    variation = null;
    variationChannels = null;
    player.port.postMessage({ type: "load", channels, bars: item.bars });
    setValues(0, 0.6, "load");
    handController.recenter();
    $("piece-title").textContent = passageTitle(item);
    $("piece-detail").textContent =
      `${item.bars} bars · ${item.bpm} BPM · ${item.key} · ${item.origin}`;
    $("phase").textContent = "Ready when you are";
    $("elapsed").textContent = "00:00";
    $("playhead").style.left = "0%";
    $("variation-state").textContent = "Original only";
    $("bar").textContent = `BAR 01 / ${String(item.bars).padStart(2, "0")}`;
    const saved = passages.find(
      (p) => p.kind === "variation" && p.anchor === item.id,
    );
    if (saved) await loadVariation(saved, current);
    showLibrary();
    draw();
    notice(
      "Your starting piece is ready. Begin flow, then explore the variation.",
    );
  } catch (error) {
    notice(error.message, true);
  } finally {
    if (current === generation) {
      loading = false;
      updateControls();
    }
  }
}
async function loadVariation(item, current = generation) {
  const channels = await decode(item.audio_url);
  if (current !== generation || item.anchor !== anchor.id) return;
  if (channels[0].length !== baseChannels[0].length)
    throw new Error("This variation has a different timeline.");
  variation = item;
  variationChannels = channels;
  player.port.postMessage({ type: "variation", channels, id: item.id });
  $("variation-state").textContent = running
    ? "Queued for next bar"
    : "Variation ready";
  updateControls();
  draw();
}
function draw() {
  const canvas = $("flow-wave"),
    scale = devicePixelRatio || 1;
  const width = canvas.clientWidth,
    height = canvas.clientHeight;
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);
  ctx.strokeStyle = "#c9d0be";
  ctx.lineWidth = 1;
  for (let bar = 1; bar < (anchor?.bars || 8); bar++) {
    ctx.beginPath();
    ctx.moveTo((width * bar) / (anchor?.bars || 8), 0);
    ctx.lineTo((width * bar) / (anchor?.bars || 8), height);
    ctx.stroke();
  }
  for (const [index, channels] of [baseChannels, variationChannels].entries()) {
    const middle = height * (index ? 0.75 : 0.28);
    ctx.strokeStyle = index ? "#9a6549" : "#48674e";
    if (!channels) {
      ctx.setLineDash([3, 5]);
      ctx.beginPath();
      ctx.moveTo(0, middle);
      ctx.lineTo(width, middle);
      ctx.stroke();
      ctx.setLineDash([]);
      continue;
    }
    const data = channels[0];
    for (let x = 0; x < width; x += 2) {
      let peak = 0;
      const start = Math.floor((x / width) * data.length),
        end = Math.floor(((x + 2) / width) * data.length);
      for (let i = start; i < end; i += 8)
        peak = Math.max(peak, Math.abs(data[i]));
      ctx.beginPath();
      ctx.moveTo(x, middle - peak * height * 0.31);
      ctx.lineTo(x, middle + peak * height * 0.31);
      ctx.stroke();
    }
  }
}
$("play").onclick = async () => {
  try {
    await context.resume();
    if (running) {
      finishing = true;
      player.port.postMessage({ type: "end", immediate: true });
    } else {
      running = true;
      finishing = false;
      setValues();
      player.port.postMessage({ type: "play" });
      $("phase").textContent = "The piece keeps flowing";
      $("phase").classList.add("live");
      notice("Take your time. The original is always there to return to.");
    }
    updateControls();
  } catch (error) {
    notice(error.message, true);
  }
};
$("ending").onclick = () => {
  finishing = true;
  player.port.postMessage({ type: "end" });
  $("phase").textContent = "Ending over the next bar";
  notice("Finishing the phrase, then letting the music settle into silence.");
  updateControls();
};
for (const id of ["morph", "intensity"]) {
  $(id).addEventListener("pointerdown", (event) => {
    $(id).setPointerCapture(event.pointerId);
    handController.hold(id, true);
    updateHandStatus();
  });
  for (const event of ["pointerup", "pointercancel", "lostpointercapture"])
    $(id).addEventListener(event, () => {
      handController.hold(id, false);
      updateHandStatus();
    });
  $(id).oninput = () => {
    handController.recenter([id]);
    setValues();
    updateHandStatus();
  };
}
$("home").onclick = () => {
  setValues(0, Number($("intensity").value), "return-to-base");
  handController.recenter(["morph"]);
  notice(
    "Back to the original. Your left hand picks up from here; your right hand stays in control.",
  );
};
$("volume").oninput = () =>
  volume?.gain.setTargetAtTime(
    Number($("volume").value),
    context.currentTime,
    0.02,
  );
$("library").onchange = () =>
  loadAnchor(passages.find((p) => p.id === $("library").value));
$("strength").oninput = () =>
  ($("strength-value").textContent =
    Number($("strength").value) <= 0.3 ? "Gentle" : "Further out");
async function render(type, strength = Number($("strength").value)) {
  if (preparing) return;
  preparing = true;
  requestAbort = new AbortController();
  updateControls();
  const current = generation;
  notice(
    type === "generate"
      ? "Preparing a new starting piece on Colab…"
      : "Preparing your variation. The music keeps its place.",
  );
  try {
    const item = await request("render", {
      type,
      prompt: $(type === "generate" ? "prompt" : "variation-prompt").value,
      bpm: Number($("bpm").value),
      bars: Number($("bars").value),
      key: "A minor",
      seed: 557,
      strength,
      anchor: type === "transform" ? anchor.id : null,
    });
    passages.unshift(item);
    stats = {
      ...stats,
      engine_ms: item.engine_ms,
      request_ms: item.request_ms,
    };
    if (type === "generate") {
      if (running)
        notice("Your new piece is saved. Stop the flow to select it.");
      else await loadAnchor(item);
    } else if (current === generation) {
      await loadVariation(item, current);
      notice(
        running
          ? "Variation ready. It will enter at the next bar."
          : "Variation ready. Begin flow to explore it.",
      );
    }
    showLibrary();
  } catch (error) {
    $("auto-variation").checked = false;
    if (error.name !== "AbortError") notice(error.message, true);
  } finally {
    preparing = false;
    requestAbort = null;
    updateControls();
  }
}
$("generate").onclick = () => render("generate");
$("transform").onclick = () => render("transform");
$("auto-variation").onchange = () => {
  variationScheduler.last = null;
};
const evolve = setInterval(() => {
  if (
    !running ||
    finishing ||
    loading ||
    preparing ||
    !anchor ||
    !cloud.configured ||
    cloud.expires_at <= Date.now() / 1000 ||
    !$("auto-variation").checked
  )
    return;
  const amount = variationScheduler.update(
    `${anchor.id}:${$("variation-prompt").value}:${$("strength").value}`,
    Number($("morph").value),
    performance.now(),
  );
  if (amount !== null)
    render("transform", 0.15 + (Number($("strength").value) - 0.15) * amount);
}, 250);
$("record").onclick = () => {
  if (recording) {
    player.port.postMessage({ type: "record", active: false });
    return;
  }
  chunks = [];
  trace = [];
  recordStart = snapshot.frame || 0;
  recordInitial = null;
  recordAnchor = anchor;
  recordVariation = variation;
  recording = true;
  player.port.postMessage({ type: "record", active: true });
  $("record").classList.add("active");
  $("record").querySelector("span").textContent = "Finish take";
};
function finishRecording() {
  if (!recording) return;
  recording = false;
  $("record").classList.remove("active");
  $("record").querySelector("span").textContent = "Record";
  downloads.forEach((url) => URL.revokeObjectURL(url));
  const stamp = new Date().toISOString().replaceAll(":", "-");
  const controls = {
    version: 1,
    sample_rate: context.sampleRate,
    anchor: recordAnchor,
    variation: recordVariation,
    start_frame: recordStart,
    initial_state: recordInitial,
    events: trace,
    note: "Audio captures the performed mix before listening volume. Keep its WAV for exact replay.",
  };
  downloads = [
    URL.createObjectURL(wavBlob(chunks, context.sampleRate)),
    URL.createObjectURL(
      new Blob([JSON.stringify(controls, null, 2)], {
        type: "application/json",
      }),
    ),
  ];
  ["audio-download", "controls-download"].forEach((id, index) => {
    $(id).href = downloads[index];
    $(id).download = `sway-flow-${stamp}.${index ? "json" : "wav"}`;
  });
  $("downloads").hidden = false;
  chunks = [];
  notice("Your take is ready: save the audio and its performance controls.");
}

function stopCamera() {
  cameraEpoch++;
  cancelAnimationFrame(cameraFrame);
  vision?.terminate();
  vision = null;
  cameraStream?.getTracks().forEach((track) => track.stop());
  cameraStream = null;
  $("video").srcObject = null;
  visionBusy = false;
  lastVideoTime = -1;
  lastHands = [];
  handController = new FlowHands();
  $("landmarks")
    .getContext("2d")
    .clearRect(0, 0, $("landmarks").width, $("landmarks").height);
  $("camera-empty").hidden = false;
  $("camera-state").textContent = "CAMERA OFF";
  $("camera").textContent = "Enable camera ↗";
  $("calibrate").disabled = true;
  updateHandStatus();
}
function drawHands(hands) {
  const canvas = $("landmarks"),
    video = $("video");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext("2d");
  for (const hand of mappedHands(hands)) {
    const isRight = hand.side === "Left";
    ctx.fillStyle = isRight ? "#d8edb6" : "#f0c5a8";
    for (const p of hand.points) {
      ctx.beginPath();
      ctx.arc(p.x * canvas.width, p.y * canvas.height, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    const wrist = hand.points[0];
    if (!wrist) continue;
    // Cancel the preview's CSS mirror for readable hand-role labels.
    ctx.save();
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.font = "bold 24px Arial";
    const text = isRight ? "RIGHT · INTENSITY" : "LEFT · VARIATION";
    const width = ctx.measureText(text).width + 20;
    const x = Math.max(
      4,
      Math.min(
        canvas.width - width - 4,
        (1 - wrist.x) * canvas.width - width / 2,
      ),
    );
    const y = Math.max(
      32,
      Math.min(canvas.height - 8, wrist.y * canvas.height + 32),
    );
    ctx.fillStyle = "#20332a";
    ctx.fillRect(x, y - 30, width, 36);
    ctx.fillStyle = isRight ? "#d8edb6" : "#f0c5a8";
    ctx.fillText(text, x + 10, y - 3);
    ctx.restore();
  }
}
async function trackCamera(epoch) {
  if (!cameraStream || epoch !== cameraEpoch) return;
  const video = $("video");
  if (
    !visionBusy &&
    video.readyState >= 2 &&
    video.currentTime !== lastVideoTime
  ) {
    visionBusy = true;
    lastVideoTime = video.currentTime;
    try {
      const image = await createImageBitmap(video);
      if (epoch !== cameraEpoch || !vision) {
        image.close();
        return;
      }
      vision.postMessage(
        { type: "frame", image, timestamp: performance.now() },
        [image],
      );
    } catch (error) {
      stopCamera();
      notice(`Camera processing stopped: ${error.message}`, true);
      return;
    }
  }
  cameraFrame = requestAnimationFrame(() => trackCamera(epoch));
}
function mappedHands(hands) {
  return $("swap-hands").checked
    ? hands.map((h) => ({ ...h, side: h.side === "Left" ? "Right" : "Left" }))
    : hands;
}
$("calibrate").onclick = () => {
  setValues(0, 0.6, "calibrate");
  handController.recenter();
  notice(
    "This is home. Raise your right hand for intensity; move your left hand to your right for variation.",
  );
};
$("swap-hands").onchange = () => {
  handController = new FlowHands();
  updateHandStatus();
  notice(
    "Hand roles swapped. Move either hand to keep playing from the current sound.",
  );
};
$("camera").onclick = async () => {
  if (cameraBusy) return;
  if (cameraStream) {
    stopCamera();
    notice("Camera off. Your music and controls hold their state.");
    return;
  }
  cameraBusy = true;
  $("camera").disabled = true;
  const epoch = ++cameraEpoch;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, frameRate: { ideal: 30, max: 30 } },
      audio: false,
    });
    if (epoch !== cameraEpoch) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    cameraStream = stream;
    $("video").srcObject = stream;
    await $("video").play();
    stream.getVideoTracks()[0].onended = stopCamera;
    $("camera-empty").hidden = true;
    $("camera").textContent = "Turn camera off";
    $("camera-state").textContent = "LOADING TRACKER";
    handController = new FlowHands();
    vision = new Worker("/vision-worker.js");
    vision.onerror = () => {
      stopCamera();
      notice(
        "The hand tracker could not start. The sliders remain available.",
        true,
      );
    };
    vision.onmessage = ({ data }) => {
      if (epoch !== cameraEpoch) return;
      if (data.type === "ready") {
        updateHandStatus();
        trackCamera(epoch);
      }
      if (data.type === "error") {
        stopCamera();
        notice(data.error, true);
      }
      if (data.type !== "motion") return;
      visionBusy = false;
      lastHands = data.hands;
      drawHands(lastHands);
      $("calibrate").disabled = !lastHands.length;
      if (performance.now() - lastGesture > 40) {
        lastGesture = performance.now();
        const controls = handController.update(
          mappedHands(lastHands),
          {
            morph: Number($("morph").value),
            intensity: Number($("intensity").value),
          },
          lastGesture,
        );
        updateHandStatus();
        if (Object.keys(controls).length)
          setValues(
            variation || cloud.configured
              ? (controls.morph ?? Number($("morph").value))
              : 0,
            controls.intensity ?? Number($("intensity").value),
            "hand",
          );
      }
    };
    vision.postMessage({ type: "init", handsOnly: true });
  } catch (error) {
    stopCamera();
    notice(`Camera unavailable: ${error.message}`, true);
  } finally {
    cameraBusy = false;
    $("camera").disabled = false;
  }
};

new ResizeObserver(draw).observe($("flow-wave"));
const refresh = setInterval(async () => {
  try {
    cloud = (await request("library")).cloud;
    updateControls();
  } catch {
    /* Loaded music remains usable. */
  }
}, 15000);
window.addEventListener("pagehide", () => {
  clearInterval(refresh);
  clearInterval(evolve);
  stopCamera();
  requestAbort?.abort();
  player?.disconnect();
  context?.close();
  downloads.forEach((url) => URL.revokeObjectURL(url));
});
try {
  const library = await request("library");
  passages = library.passages;
  cloud = library.cloud;
  showLibrary();
  const requested = new URLSearchParams(location.search).get("anchor");
  await loadAnchor(
    passages.find((p) => p.id === requested && p.kind === "anchor") ||
      passages.find((p) => p.id === library.default_anchor),
  );
} catch (error) {
  loading = false;
  updateControls();
  notice(error.message, true);
}
