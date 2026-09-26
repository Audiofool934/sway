const $ = (id) => document.getElementById(id);
const names = {
  unknown: "Open",
  piano: "Air piano",
  strum: "Air guitar",
  strike: "Air drums",
  sustain: "Flowing",
  still: "Spacious",
};
const paletteNotes = {
  chamber: "Warm piano, plucked strings, delicate percussion.",
  nocturne: "Felt piano, long strings, open space.",
  groove: "Electric piano, warm bass, a relaxed groove.",
};
let socket,
  state,
  assets,
  busy = false,
  connected = false,
  acceptingAudio = false;
let stickyError = null;
let audioContext,
  player,
  gain,
  analyser,
  audioStats = {},
  waveData;
let cameraStream,
  vision,
  cameraBusy = false,
  visionBusy = false,
  cameraFrame;
let lastVideoTime = -1;
let clipFrames = [],
  lastCapture = 0,
  lastClip = 0,
  clipBusy = false,
  cameraGeneration = 0;
const video = $("video"),
  overlay = $("landmarks"),
  capture = document.createElement("canvas");
const wave = $("waveform"),
  waveContext = wave.getContext("2d");
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

function notice(message, error = false) {
  if (error) stickyError = message;
  if (stickyError && !error) return;
  $("notice").textContent = message;
  $("notice").classList.toggle("error", error);
}
async function api(path, body = {}) {
  const response = await fetch(`/api/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      typeof data.detail === "string"
        ? data.detail
        : "The instrument could not accept that request.",
    );
  return data;
}
function connect() {
  socket = new WebSocket(
    `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws`,
  );
  socket.binaryType = "arraybuffer";
  socket.onopen = () => {
    connected = true;
    updateControls();
  };
  socket.onmessage = ({ data }) => {
    if (typeof data === "string") update(JSON.parse(data));
    else if (acceptingAudio && player) player.port.postMessage(data, [data]);
  };
  socket.onclose = (event) => {
    connected = false;
    acceptingAudio = false;
    player?.port.postMessage("reset");
    stopCamera();
    updateControls();
    notice(
      event.code === 1008
        ? "Another performance window is open, or this session was rejected. Close the other window, then reload."
        : "The local instrument disconnected. Restart the server and reload this page.",
      true,
    );
  };
  socket.onerror = () =>
    notice(
      "Could not connect to Sway. Check that the local server is running.",
      true,
    );
}
async function prepareAudio() {
  if (!audioContext) {
    audioContext = new AudioContext({
      sampleRate: 48000,
      latencyHint: "interactive",
    });
    await audioContext.audioWorklet.addModule("/audio-worklet.js");
    player = new AudioWorkletNode(audioContext, "sway-player", {
      outputChannelCount: [2],
    });
    gain = audioContext.createGain();
    gain.gain.value = Number($("volume").value);
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;
    waveData = new Float32Array(analyser.fftSize);
    player.connect(gain).connect(analyser).connect(audioContext.destination);
    player.port.onmessage = ({ data }) => {
      audioStats = data;
    };
  }
  await audioContext.resume();
  player.port.postMessage("reset");
}
function updateControls() {
  const running = Boolean(state?.running);
  $("play").disabled = busy || !connected || assets?.music === false;
  $("play").innerHTML = running
    ? '<span aria-hidden="true">■</span> End performance'
    : '<span aria-hidden="true">▶</span> Begin performance';
  $("palette").disabled = running || busy;
  $("interpretation").disabled = running || busy;
  $("record").disabled =
    busy || !running || state.workers.music.phase !== "ready";
}
function update(next) {
  state = next;
  const music = state.music,
    worker = state.workers.music,
    semantic = state.workers.semantics;
  const seconds = Math.floor(state.elapsed || 0);
  $("elapsed").textContent =
    `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  const live = state.running && worker.phase === "ready";
  $("phase").textContent =
    worker.phase === "error"
      ? "Music paused"
      : worker.phase === "loading"
        ? "Preparing the ensemble…"
        : live
          ? "The piece is unfolding"
          : "Ready when you are";
  $("phase").classList.toggle("live", live);
  $("phrase").textContent = live
    ? `PHRASE ${String(Math.floor((state.metrics.beat || 0) / 16) + 1).padStart(2, "0")} · ${$("palette").selectedOptions[0].text.toUpperCase()}`
    : "WAITING FOR THE FIRST NOTE";
  $("bpm").textContent = Math.round(music.bpm);
  $("pulse-note").textContent =
    music.rhythm.confidence >= 0.4 && $("follow").checked
      ? `${Math.round(music.rhythm.confidence * 100)}% pulse consistency`
      : $("follow").checked
        ? "Waiting for a steady pulse"
        : "Manual tempo";
  $("action-readout").textContent = names[music.action];
  const source = music.action_source || "none";
  $("action-note").textContent =
    source === "manual"
      ? "Chosen by you"
      : source === "gesture"
        ? "From the gesture map"
        : source === "ai"
          ? "AI context, supported by motion"
          : "Waiting for a clear gesture";
  const gesture = music.rhythm.gesture;
  $("gesture-readout").textContent =
    cameraStream && gesture
      ? gesture.action === "unknown"
        ? "Unclear"
        : names[gesture.action]
      : "Waiting";
  $("gesture-reason").textContent =
    cameraStream && gesture ? gesture.reason : "Show your hands";
  const register = music.register ?? 0.5;
  $("register-meter").value = register;
  $("register-readout").textContent =
    register < 0.35 ? "Low" : register > 0.65 ? "High" : "Middle";
  $("motion-readout").textContent = cameraStream
    ? music.rhythm.hands
      ? `${music.rhythm.hands} ${music.rhythm.hands === 1 ? "hand" : "hands"}`
      : "No hands"
    : "Waiting";
  $("energy").style.width = `${Math.round(music.energy * 100)}%`;
  $("record").classList.toggle("active", state.recording);
  $("record").querySelector("span").textContent = state.recording
    ? "Finish take"
    : "Record";
  if (state.last_recording) {
    $("download").hidden = false;
    $("download").href =
      `/api/recordings/${encodeURIComponent(state.last_recording)}`;
    $("download").download = state.last_recording;
  }
  if (worker.phase === "error")
    notice(`The music engine stopped: ${worker.error}`, true);
  else if (semantic.phase === "error")
    notice(
      `Music is running, but movement interpretation stopped: ${semantic.error}. The gesture map still works. End the performance to select Gesture map only.`,
      true,
    );
  else if (state.recording_error) notice(state.recording_error, true);
  else if (live && cameraStream && music.tracking_gain === 0)
    notice("Bring your hands back into view to continue the music.");
  else if (live && Number(audioStats.underruns) > 0)
    notice(
      $("interpretation").value === "auto"
        ? "Playback has had gaps. Try Gesture map only in a new performance to reduce GPU load."
        : "Playback has had gaps. Open Session details to check generation timing. Continuous playback is still experimental.",
    );
  else if (live)
    notice(
      cameraStream
        ? "Tap your fingers, strum sideways, or make a downstroke. Raise your hands for higher notes."
        : "The ensemble is playing. Enable your camera to guide it.",
    );
  if ($("interpretation").value === "auto") {
    $("semantic-note").textContent = semantic.last_error
      ? "AI context is uncertain. The gesture map remains active."
      : semantic.phase === "loading"
        ? "Gesture map ready. Loading optional AI context…"
        : semantic.phase === "ready" && semantic.inference_ms
          ? `Gesture map active · latest AI observation ${(semantic.inference_ms / 1000).toFixed(1)} s${semantic.stale ? " · too old to apply" : ""}.`
          : "Gestures control the music directly; AI adds slower context.";
  }
  $("diagnostics").textContent = [
    `Music: ${worker.phase} · semantics: ${semantic.phase}`,
    `Generation: ${state.metrics.frame_ms ?? "-"} ms / 40 ms frame`,
    `Playback queue: ${Math.round(audioStats.queuedMs || 0)} ms · gaps: ${audioStats.underruns || 0}`,
    `Engine overruns: ${state.metrics.overruns || 0} · dropped frames: ${state.metrics.dropped_frames || 0}`,
    `Playback catch-up: ${Math.round((audioStats.dropped || 0) / 48)} ms`,
    `Audio output: ${audioContext?.sampleRate || "-"} Hz`,
    `Performed note cues: ${state.metrics.note_cues || 0} · last requested MIDI pitch: ${state.metrics.last_pitch ?? "-"}`,
    `Direction source: ${source} · note guidance: ${state.metrics.note_guidance ?? "-"}`,
    `Latest AI suggestion: ${music.last_semantic?.action || "-"} · confidence: ${music.last_semantic?.confidence ?? "-"}`,
  ].join("\n");
  updateControls();
}
$("play").onclick = async () => {
  if (busy) return;
  busy = true;
  updateControls();
  stickyError = null;
  try {
    if (state?.running) {
      acceptingAudio = false;
      gain?.gain.setTargetAtTime(0, audioContext.currentTime, 0.025);
      update(await api("stop"));
      player?.port.postMessage("reset");
      await audioContext?.suspend();
      notice("A little silence. Begin again whenever you like.");
    } else {
      await prepareAudio();
      gain.gain.setValueAtTime(
        Number($("volume").value),
        audioContext.currentTime,
      );
      audioStats = {};
      acceptingAudio = true;
      notice("Warming up the ensemble. The first start takes a few seconds.");
      update(
        await api("start", {
          palette: $("palette").value,
          semantics: $("interpretation").value === "auto",
          gesture_mapping: $("interpretation").value !== "manual",
          action:
            $("interpretation").value === "manual"
              ? $("action").value
              : "unknown",
          tempo: Number($("tempo").value),
          follow_motion: $("follow").checked,
        }),
      );
    }
  } catch (error) {
    acceptingAudio = false;
    player?.port.postMessage("reset");
    notice(error.message, true);
  } finally {
    busy = false;
    updateControls();
  }
};
$("record").onclick = async () => {
  stickyError = null;
  try {
    update(await api(state.recording ? "record/stop" : "record/start"));
  } catch (error) {
    notice(error.message, true);
  }
};
$("volume").oninput = () =>
  gain?.gain.setTargetAtTime(
    Number($("volume").value),
    audioContext.currentTime,
    0.02,
  );
$("palette").onchange = () => {
  $("palette-note").textContent = paletteNotes[$("palette").value];
  $("style-label").textContent =
    `${$("palette").selectedOptions[0].text} / a little room to breathe`;
};
$("interpretation").onchange = () => {
  const manual = $("interpretation").value === "manual";
  $("manual-actions").hidden = !manual;
  $("semantic-note").textContent = manual
    ? "Choose the action; your movement still supplies the pulse."
    : $("interpretation").value === "mapped"
      ? "Hand trajectories map to musical actions, register, pulse, and intensity."
      : "Gestures control the music directly; AI adds slower context.";
};
async function control(body) {
  if (!state?.running) return;
  try {
    update(await api("control", body));
  } catch (error) {
    notice(error.message, true);
  }
}
$("action").onchange = () => control({ action: $("action").value });
$("follow").onchange = () => control({ follow_motion: $("follow").checked });
$("tempo").oninput = () => {
  $("tempo-value").textContent = `${$("tempo").value} BPM`;
  if (!state?.running) $("bpm").textContent = $("tempo").value;
};
$("tempo").onchange = () => control({ tempo: Number($("tempo").value) });

function drawHands(hands, pose) {
  overlay.width = video.videoWidth || 640;
  overlay.height = video.videoHeight || 480;
  const ctx = overlay.getContext("2d"),
    w = overlay.width,
    h = overlay.height;
  ctx.strokeStyle = "#d8edb6";
  ctx.fillStyle = "#f2e9c8";
  ctx.lineWidth = 2;
  const chains = [
    [0, 1, 2, 3, 4],
    [0, 5, 6, 7, 8],
    [5, 9, 10, 11, 12],
    [9, 13, 14, 15, 16],
    [13, 17, 18, 19, 20],
    [0, 17],
  ];
  for (const hand of hands) {
    for (const chain of chains) {
      ctx.beginPath();
      chain.forEach((index, n) => {
        const p = hand.points[index];
        n ? ctx.lineTo(p.x * w, p.y * h) : ctx.moveTo(p.x * w, p.y * h);
      });
      ctx.stroke();
    }
    for (const p of hand.points) {
      ctx.beginPath();
      ctx.arc(p.x * w, p.y * h, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (pose.length) {
    ctx.globalAlpha = 0.3;
    for (const [a, b] of [
      [11, 12],
      [11, 13],
      [13, 15],
      [12, 14],
      [14, 16],
    ]) {
      ctx.beginPath();
      ctx.moveTo(pose[a].x * w, pose[a].y * h);
      ctx.lineTo(pose[b].x * w, pose[b].y * h);
      ctx.stroke();
    }
  }
}
function stopCamera() {
  cameraGeneration++;
  cancelAnimationFrame(cameraFrame);
  vision?.terminate();
  vision = null;
  cameraStream?.getTracks().forEach((track) => track.stop());
  cameraStream = null;
  video.srcObject = null;
  visionBusy = false;
  clipFrames = [];
  lastVideoTime = -1;
  overlay.getContext("2d").clearRect(0, 0, overlay.width, overlay.height);
  $("camera-empty").hidden = false;
  $("camera-state").textContent = "CAMERA OFF";
  $("camera").innerHTML = 'Enable camera <span aria-hidden="true">↗</span>';
  if (connected) {
    socket.send(
      JSON.stringify({ timestamp_ms: performance.now(), hands: [], pose: [] }),
    );
    control({ camera_active: false });
  }
}
async function trackCamera(generation) {
  if (!cameraStream || generation !== cameraGeneration) return;
  const timestamp = performance.now();
  if (
    !visionBusy &&
    video.readyState >= 2 &&
    video.currentTime !== lastVideoTime
  ) {
    lastVideoTime = video.currentTime;
    visionBusy = true;
    try {
      const image = await createImageBitmap(video);
      if (generation !== cameraGeneration || !vision) {
        image.close();
        return;
      }
      vision.postMessage({ type: "frame", image, timestamp }, [image]);
    } catch (error) {
      visionBusy = false;
      notice(`Camera processing failed: ${error.message}`, true);
    }
  }
  if (
    timestamp - lastCapture >= 500 &&
    video.readyState >= 2 &&
    state?.running &&
    $("interpretation").value === "auto"
  ) {
    lastCapture = timestamp;
    capture.width = 256;
    capture.height = Math.round((256 * video.videoHeight) / video.videoWidth);
    capture
      .getContext("2d")
      .drawImage(video, 0, 0, capture.width, capture.height);
    clipFrames.push({
      image: capture.toDataURL("image/jpeg", 0.7).split(",")[1],
      timestamp,
    });
    clipFrames = clipFrames
      .filter((frame) => timestamp - frame.timestamp <= 2000)
      .slice(-3);
    if (
      clipFrames.length === 3 &&
      timestamp - lastClip >= 3500 &&
      !clipBusy &&
      state.workers.semantics.phase === "ready"
    ) {
      lastClip = timestamp;
      clipBusy = true;
      api("clip", {
        frames: clipFrames.map((f) => f.image),
        timestamps_ms: clipFrames.map((f) => f.timestamp),
      })
        .catch((error) => notice(error.message, true))
        .finally(() => {
          clipBusy = false;
        });
    }
  }
  cameraFrame = requestAnimationFrame(() => trackCamera(generation));
}
$("camera").onclick = async () => {
  if (cameraBusy) return;
  if (cameraStream) {
    stopCamera();
    return;
  }
  cameraBusy = true;
  $("camera").disabled = true;
  stickyError = null;
  const generation = ++cameraGeneration;
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, frameRate: { ideal: 30, max: 30 } },
      audio: false,
    });
    if (generation !== cameraGeneration) {
      cameraStream.getTracks().forEach((track) => track.stop());
      cameraStream = null;
      return;
    }
    video.srcObject = cameraStream;
    await video.play();
    cameraStream.getVideoTracks()[0].onended = () => {
      stopCamera();
      notice(
        "The camera disconnected. Enable it again to resume motion control.",
        true,
      );
    };
    $("camera-empty").hidden = true;
    $("camera-state").textContent = "LOADING TRACKER";
    $("camera").textContent = "Turn camera off";
    vision = new Worker("/vision-worker.js");
    vision.onerror = (event) => {
      stopCamera();
      notice(`The motion tracker could not start: ${event.message}`, true);
    };
    vision.onmessage = ({ data }) => {
      if (data.type === "ready") {
        $("camera-state").textContent = "CAMERA ON";
        trackCamera(generation);
      } else if (data.type === "error") {
        stopCamera();
        notice(`Motion tracking stopped: ${data.error}`, true);
      } else if (data.type === "motion") {
        visionBusy = false;
        const { type, ...motion } = data;
        drawHands(motion.hands, motion.pose);
        if (connected && socket.bufferedAmount < 64000)
          socket.send(JSON.stringify(motion));
      }
    };
    vision.postMessage({ type: "init" });
  } catch (error) {
    stopCamera();
    notice(
      `Camera unavailable: ${error.message}. You can still play with a chosen musical action.`,
      true,
    );
  } finally {
    cameraBusy = false;
    $("camera").disabled = false;
  }
};

let lastDraw = 0;
function draw(now) {
  requestAnimationFrame(draw);
  if (now - lastDraw < (reducedMotion ? 200 : 33)) return;
  lastDraw = now;
  const { width, height } = wave.getBoundingClientRect(),
    scale = devicePixelRatio || 1;
  if (
    wave.width !== Math.round(width * scale) ||
    wave.height !== Math.round(height * scale)
  ) {
    wave.width = Math.round(width * scale);
    wave.height = Math.round(height * scale);
  }
  waveContext.setTransform(scale, 0, 0, scale, 0, 0);
  waveContext.clearRect(0, 0, width, height);
  if (analyser) analyser.getFloatTimeDomainData(waveData);
  waveContext.strokeStyle = "#85996d";
  waveContext.lineWidth = 1.25;
  waveContext.beginPath();
  for (let x = 0; x <= width; x++) {
    const sample =
      waveData && acceptingAudio
        ? waveData[
            Math.min(
              waveData.length - 1,
              Math.floor((x / width) * waveData.length),
            )
          ]
        : 0;
    const y = height / 2 + sample * height * 1.7;
    x ? waveContext.lineTo(x, y) : waveContext.moveTo(x, y);
  }
  waveContext.stroke();
}
requestAnimationFrame(draw);
window.addEventListener("pagehide", () => {
  stopCamera();
  socket?.close();
  audioContext?.close();
});
try {
  const response = await fetch("/api/status");
  if (!response.ok) throw new Error("The local server is not ready.");
  const initial = await response.json();
  assets = initial.assets;
  update(initial);
  connect();
  if (!assets.music || !assets.vision)
    notice(
      "Local model files are missing. Run “uv run sway setup” in the Sway folder, then reload.",
      true,
    );
  if (!assets.semantics) {
    $("interpretation").value = "mapped";
    $("interpretation").onchange();
  }
} catch (error) {
  notice(error.message, true);
  updateControls();
}
