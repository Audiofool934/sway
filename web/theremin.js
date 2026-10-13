import { Camera } from "./instrument/camera.js";
import { HandTracker } from "./instrument/hands.js";
import { HandVisuals } from "./instrument/hand-visual.js";
import { ThereminControls } from "./theremin-controls.js";
import { ThereminAudio } from "./theremin-audio.js";

const $ = (id) => document.getElementById(id);
const stage = $("stage"),
  canvas = $("field"),
  ctx = canvas.getContext("2d");
const tracker = new HandTracker();
const visuals = new HandVisuals({
  lead: [199, 225, 211],
  band: [167, 196, 210],
});
let controls = new ThereminControls();
let audio = null,
  socket = null,
  phase = "idle",
  epoch = 0;
let source = "pointer",
  pointer = null,
  hands = {},
  lastInput = 0;
let lastSend = 0,
  started = 0,
  takeUrl = null,
  lastBlob = null;
let model = {},
  log = [],
  lastLog = 0,
  ending = null,
  loadTimer = null;
const waveform = new Float32Array(128);
const camera = new Camera($("video"), {
  maxFps: 12,
  onHands(raw, time, { aspect }) {
    if (source !== "camera") return;
    tracker.aspect = aspect;
    hands = tracker.update(raw, time);
    input(Object.values(hands), time);
  },
  onStatus(status, detail) {
    if (status === "error" || status === "ended") {
      void end(detail || "摄像头已断开。可以重新开始，或用鼠标试奏。");
    }
  },
});

function setPhase(next) {
  phase = next;
  stage.dataset.phase = next;
  $("intro").hidden = next !== "idle";
  $("preparing").hidden = next !== "loading";
  $("playing").hidden = next !== "playing";
  $("stop").hidden = next === "idle";
  $("stop").disabled = next === "ending";
  $("start-camera").disabled = $("start-pointer").disabled = next !== "idle";
}

function input(points, time = performance.now() / 1000) {
  lastInput = performance.now() / 1000;
  return controls.update(points, time);
}

async function begin(mode) {
  if (phase !== "idle") return;
  const turn = ++epoch;
  controls = new ThereminControls();
  tracker.tracks = [];
  pointer = null;
  hands = {};
  model = {};
  log = [];
  source = mode;
  $("message").classList.remove("error");
  $("save").hidden = true;
  $("status").textContent = "准备声音中";
  $("hint").textContent =
    mode === "camera"
      ? "高度改变音高 · 拉开双手展开声音 · 握拳留白"
      : "按住并移动 · 高度改变音高 · 左右改变展开程度 · 松开留白";
  setPhase("loading");
  try {
    audio = new ThereminAudio();
    const current = audio;
    await current.open();
    if (turn !== epoch) {
      await current.close({ save: false });
      return;
    }
    current.volume(Number($("volume").value));
    if (mode === "camera") await camera.start();
    if (turn !== epoch) return;
    const ws = new WebSocket(
      `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/theremin/stream`,
    );
    socket = ws;
    ws.binaryType = "arraybuffer";
    loadTimer = setTimeout(() => {
      if (turn === epoch) void end("声音准备超时。请重试。");
    }, 45000);
    ws.onmessage = ({ data }) => {
      if (turn !== epoch) return;
      if (data instanceof ArrayBuffer) {
        audio.push(data);
        return;
      }
      const message = JSON.parse(data);
      if (message.type === "ready") {
        clearTimeout(loadTimer);
        started = performance.now() / 1000;
        model = message;
        audio.record();
        setPhase("playing");
        $("status").textContent =
          mode === "camera" ? "双手入镜，即可演奏" : "按住画面，开始试奏";
      } else if (message.type === "frame") {
        model = { ...model, ...message };
      }
    };
    ws.onclose = ({ code, reason }) => {
      if (turn !== epoch) return;
      const message =
        code === 1008
          ? "这个实验需要本机 MRT2，且一次只能打开一个演奏窗口。请关闭其他实验窗口后重试。"
          : `声音连接已停止。${reason ? "请重新开始。" : "可以保存刚才的声音，再试一次。"}`;
      void end(message);
    };
    ws.onerror = () => {
      if (turn === epoch) $("status").textContent = "正在检查声音连接";
    };
  } catch (error) {
    if (turn === epoch) {
      console.error(error);
      await end(
        mode === "camera"
          ? "摄像头或声音未能启动。请允许摄像头访问，或用鼠标试奏。"
          : "声音未能启动。请重新开始。",
      );
    }
  }
}

function end(message = "这一段已结束。可以保存声音，或再探索一次。") {
  if (ending) return ending;
  if (phase === "idle") return Promise.resolve();
  ++epoch;
  clearTimeout(loadTimer);
  socket?.close();
  socket = null;
  camera.stop();
  pointer = null;
  hands = {};
  setPhase("ending");
  $("status").textContent = "收好这一段尾音";
  const current = audio;
  audio = null;
  ending = (async () => {
    try {
      lastBlob = await current?.close();
      if (lastBlob) {
        if (takeUrl) URL.revokeObjectURL(takeUrl);
        takeUrl = URL.createObjectURL(lastBlob);
        $("save").href = takeUrl;
        $("save").hidden = false;
      }
    } catch (error) {
      console.error(error);
    }
    $("message").textContent = message;
    $("status").textContent = "弦 · 继续探索";
    setPhase("idle");
    ending = null;
  })();
  return ending;
}

function point(event) {
  const box = canvas.getBoundingClientRect();
  return {
    id: "pointer",
    x: Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)),
    y: Math.max(0, Math.min(1, (event.clientY - box.top) / box.height)),
  };
}
canvas.addEventListener("pointerdown", (event) => {
  if (phase !== "playing" || source === "camera") return;
  source = "pointer";
  canvas.setPointerCapture(event.pointerId);
  pointer = point(event);
});
canvas.addEventListener("pointermove", (event) => {
  if (pointer) pointer = point(event);
});
for (const type of ["pointerup", "pointercancel", "lostpointercapture"])
  canvas.addEventListener(type, () => {
    pointer = null;
  });
window.addEventListener("blur", () => {
  pointer = null;
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden && phase !== "idle")
    void end("演奏已在切换页面时停止。可以保存刚才的声音。");
});
window.addEventListener("pagehide", () => {
  socket?.close();
  camera.stop();
  void audio?.close({ save: false });
  if (takeUrl) URL.revokeObjectURL(takeUrl);
});
$("start-camera").onclick = () => begin("camera");
$("start-pointer").onclick = () => begin("pointer");
$("stop").onclick = () => end();
$("volume").oninput = (event) => audio?.volume(Number(event.target.value));
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") void end();
  if (
    event.key.toLowerCase() === "d" &&
    !event.repeat &&
    !event.target.closest("input, button, a")
  )
    $("diagnostics").hidden = !$("diagnostics").hidden;
});

function draw(now, state) {
  const width = canvas.clientWidth,
    height = canvas.clientHeight;
  const dpr = Math.min(devicePixelRatio, 2);
  if (
    canvas.width !== Math.round(width * dpr) ||
    canvas.height !== Math.round(height * dpr)
  ) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  if (phase !== "playing") return;
  const vw = $("video").videoWidth || width,
    vh = $("video").videoHeight || height;
  const scale = Math.max(width / vw, height / vh);
  const view =
    source === "camera"
      ? {
          x: (x) => (width - vw * scale) / 2 + x * vw * scale,
          y: (y) => (height - vh * scale) / 2 + y * vh * scale,
        }
      : { x: (x) => x * width, y: (y) => y * height };
  if (source === "camera")
    visuals.draw(
      ctx,
      { lead: { hand: hands.lead }, band: { hand: hands.band } },
      view,
    );
  audio?.analyser.getFloatTimeDomainData(waveform);
  const points = controls.points;
  for (const hand of points) {
    const x = view.x(hand.x),
      y = view.y(hand.y);
    ctx.strokeStyle = `rgba(196, 224, 207, ${0.22 + state.energy * 0.35})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < waveform.length; i++) {
      const px = x - 42 + (i / (waveform.length - 1)) * 84;
      const py = y + waveform[i] * (50 + state.spread * 50);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, 5 + state.energy * 6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "#d1e7d8";
    ctx.beginPath();
    ctx.arc(x, y, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(182, 209, 192, 0.12)";
    ctx.beginPath();
    ctx.moveTo(25, y);
    ctx.lineTo(width - 25, y);
    ctx.stroke();
  }
  if (points.length === 2) {
    ctx.strokeStyle = "rgba(182, 209, 192, 0.28)";
    ctx.beginPath();
    ctx.moveTo(view.x(points[0].x), view.y(points[0].y));
    ctx.lineTo(view.x(points[1].x), view.y(points[1].y));
    ctx.stroke();
  }
}

function frame(ms) {
  requestAnimationFrame(frame);
  const now = ms / 1000;
  if (source === "pointer") input(pointer ? [pointer] : [], now);
  else if (now - lastInput > 0.35) input([], now);
  const state = controls.snapshot();
  if (socket?.readyState === WebSocket.OPEN && now - lastSend >= 0.04) {
    socket.send(JSON.stringify(state));
    lastSend = now;
  }
  if (phase === "playing") {
    audio.control(state);
    const names = [
      "C",
      "C♯",
      "D",
      "E♭",
      "E",
      "F",
      "F♯",
      "G",
      "A♭",
      "A",
      "B♭",
      "B",
    ];
    $("pitch-name").textContent = names[state.pitch % 12];
    $("pitch-octave").textContent = Math.floor(state.pitch / 12) - 1;
    $("gesture-name").textContent = !state.active
      ? "留一点空白"
      : state.grain > 0.55
        ? "短促，清晰的颗粒"
        : state.spread > 0.65
          ? "让声音展开"
          : "顺着声音，慢慢延展";
    $("status").textContent =
      source === "camera" && !controls.seen
        ? "让手回到画面里"
        : "弦 · 正在生成";
    $("bow-meter").style.width = `${(1 - state.grain) * state.energy * 100}%`;
    $("spread-meter").style.width = `${state.spread * 100}%`;
    $("grain-meter").style.width = `${state.grain * 100}%`;
    if (now - lastLog > 0.2) {
      log.push({
        time: +(now - started).toFixed(3),
        control: state,
        model,
        audio: { ...audio.stats },
      });
      lastLog = now;
    }
    if (now - started > 300)
      void end("五分钟的探索已保存下来。可以下载声音，再开始新的一段。");
    if (!$("diagnostics").hidden)
      $("diagnostics").textContent = JSON.stringify(
        { model, audio: audio?.stats, control: state },
        null,
        2,
      );
  }
  draw(now, state);
}
requestAnimationFrame(frame);

window.theremin = {
  get phase() {
    return phase;
  },
  get controls() {
    return controls;
  },
  get audio() {
    return audio;
  },
  get camera() {
    return camera;
  },
  get model() {
    return model;
  },
  get log() {
    return log;
  },
  get recording() {
    return lastBlob;
  },
  input(points, time) {
    source = "scripted";
    return input(points, time);
  },
  end,
};
