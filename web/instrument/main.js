// Page wiring: input sources feed one set of controls, controls drive the engine,
// and every animation frame draws the instrument and the heads-up display.

import { Camera } from "./camera.js";
import { Coach } from "./coach.js";
import { Controls } from "./controls.js";
import { Engine } from "./engine.js";
import { GeneratedHarmony, PALETTES } from "./harmony.js";
import { HandTracker } from "./hands.js";
import { DRUM_NOTES, encodeMidi } from "./midi.js";
import { Overlay } from "./overlay.js";
import { Synth } from "./synth.js";
import { WORLD, chordAt } from "./theory.js";
import { encodeWav } from "./wav.js";

const $ = (id) => document.getElementById(id);
const stage = $("stage");

// Settings are a per-browser convenience; the page works without storage.
const store = {
  get(key, fallback) {
    try {
      const value = localStorage.getItem(`sway.${key}`);
      return value === null ? fallback : JSON.parse(value);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(`sway.${key}`, JSON.stringify(value));
    } catch {
      /* Storage unavailable. */
    }
  },
};

const settings = {
  leadSide: store.get("leadSide", "Right"),
  grid: store.get("grid", 0.25),
  range: store.get("range", { top: 0.14, bottom: 0.86 }),
  offset: store.get("offset", 0), // Calibrated timing offset, in seconds.
  harmony: store.get("harmony", "strings"), // A generated palette, or "off".
};
// A camera frame is exposed before its capture time; this is the allowance for that.
const SENSOR = 0.02;

let audio = null; // { ctx, synth }
let engine = null;
// Generated harmony for the current piece, when MRT2 is installed and chosen.
let harmony = null;
const harmonyCheck = { done: false, available: false, warned: false };
let tracker = new HandTracker({ leadSide: settings.leadSide });
let controls = newControls();
let cameraRoles = {};
let scripted = {};
let trail = [];
let captures = [];
let lastLoopPulse = new Map();
let noteCount = 0;
let startedAt = 0;
const overlay = new Overlay($("overlay"));
const camera = new Camera($("video"), {
  onHands: (hands, time, info) => {
    tracker.aspect = info.aspect;
    cameraRoles = tracker.update(hands, time);
    update(time);
    coach.onHands(currentHands().lead, time);
  },
  onStatus: cameraStatus,
  delegate:
    new URLSearchParams(location.search).get("delegate") === "gpu"
      ? "GPU"
      : "CPU",
});

function newControls() {
  return new Controls({
    rungs: WORLD.ladder.length,
    levels: WORLD.levels.length,
    range: settings.range,
  });
}

// Pointer and keyboard: the same features a camera hand provides.
const pointer = { lead: null, band: null, pressed: false };
const levelY = (level) => {
  const { top, bottom } = settings.range;
  return bottom - ((level + 0.5) / WORLD.levels.length) * (bottom - top);
};
const bandX = () => (settings.leadSide === "Right" ? 0.22 : 0.78);

function pointerLead(event) {
  const rect = stage.getBoundingClientRect();
  pointer.lead = {
    x: (event.clientX - rect.left) / rect.width,
    y: (event.clientY - rect.top) / rect.height,
    pinch: pointer.pressed,
    fist: pointer.lead?.fist ?? false,
  };
}

stage.addEventListener("pointermove", (event) => {
  if (camera.active || stage.dataset.state !== "playing") return;
  pointerLead(event);
  update(performance.now() / 1000);
});
stage.addEventListener("pointerdown", (event) => {
  if (
    camera.active ||
    stage.dataset.state !== "playing" ||
    event.target.closest("button")
  )
    return;
  pointer.pressed = true;
  pointerLead(event);
  update(event.timeStamp / 1000);
});
window.addEventListener("pointerup", (event) => {
  if (!pointer.pressed) return;
  pointer.pressed = false;
  if (pointer.lead) pointer.lead.pinch = false;
  update(event.timeStamp / 1000);
});
stage.addEventListener("pointerleave", () => {
  if (!pointer.pressed) pointer.lead = null;
});

const keyBand = () =>
  (pointer.band ??= { x: bandX(), y: levelY(1), pinch: false, fist: false });

window.addEventListener("keydown", (event) => {
  if (event.target.closest("select") || event.metaKey || event.ctrlKey) return;
  const key = event.key.toLowerCase();
  if (key === "d") return toggleDetails();
  if (stage.dataset.state !== "playing" || event.repeat) return;
  if (/^[1-5]$/.test(key)) keyBand().y = levelY(Number(key) - 1);
  else if (key === " ") keyBand().fist = true;
  else if (key === "l") keyBand().pinch = true;
  else if (key === "e") {
    keyBand().fist = true;
    pointer.lead = {
      ...(pointer.lead ?? { x: 0.75, y: 0.5 }),
      pinch: false,
      fist: true,
    };
  } else if (key === "backspace") engine?.undoLoop();
  else return;
  event.preventDefault();
  update(event.timeStamp / 1000);
});
window.addEventListener("keyup", (event) => {
  const key = event.key.toLowerCase();
  if (!pointer.band) return;
  if (key === " ") pointer.band.fist = false;
  else if (key === "l") pointer.band.pinch = false;
  else if (key === "e") {
    pointer.band.fist = false;
    if (pointer.lead) pointer.lead.fist = false;
  } else return;
  update(event.timeStamp / 1000);
});

// Per role, the camera wins over scripted input, which wins over mouse and keyboard.
function currentHands() {
  const seen = camera.active ? cameraRoles : {};
  return {
    lead: seen.lead ?? scripted.lead ?? (camera.active ? null : pointer.lead),
    band: seen.band ?? scripted.band ?? pointer.band,
  };
}

// One path from any input to the engine.
let lastUpdate = 0;
function update(time) {
  // Camera frames carry capture times; other sources must not run backwards past them.
  time = Math.max(time, lastUpdate);
  lastUpdate = time;
  const events = controls.update(currentHands(), time);
  if (stage.dataset.state === "playing" && engine) dispatch(events);
}

const BAND_EVENTS = new Set(["energy", "cut", "capture", "end"]);

function dispatch(events) {
  for (const event of events) {
    // Lessons lock the band-hand controls they are not teaching.
    if (BAND_EVENTS.has(event.type) && !coach.allows(event.type)) continue;
    if (BAND_EVENTS.has(event.type)) coach.onControl(event, engine.heardBeat());
    controlLog.push({
      ...event,
      time: +(event.time - startedAt / 1000).toFixed(4),
    });
    if (event.type === "noteOn") engine.noteOn(event.rung, event.time);
    else if (event.type === "noteMove") engine.noteMove(event.rung, event.time);
    else if (event.type === "noteOff") engine.noteOff(event.time);
    else if (event.type === "energy") engine.setEnergy(event.level);
    else if (event.type === "cut") engine.setCut(event.on);
    else if (event.type === "capture" && !engine.capture())
      flashHint(
        "Play a phrase first, then pinch and hold with your band hand to loop it.",
      );
    else if (event.type === "end") engine.end();
  }
}

// Audio starts on the first click, as browsers require.
async function ensureAudio() {
  if (audio) return audio;
  const ctx = new AudioContext({ latencyHint: "interactive" });
  await ctx.resume();
  const synth = new Synth(ctx, { beatSeconds: 60 / WORLD.tempo });
  let recorder = null;
  try {
    await ctx.audioWorklet.addModule("/instrument/recorder-worklet.js");
    recorder = new AudioWorkletNode(ctx, "sway-recorder", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });
    recorder.port.onmessage = ({ data }) => {
      if (data.left) take.chunks.push(data);
      else if (data.done) take.stopped?.();
    };
    synth.route(recorder);
  } catch {
    recorder = null; // Playing works without recording.
  }
  audio = { ctx, synth, recorder };
  return audio;
}

// Every performance is recorded; its files are offered when the piece ends.
let take = { chunks: [] };
let controlLog = [];
let downloads = [];

const MIDI_TRACKS = [
  ["Lead", ["lead"], 0],
  ["Loops", ["loop"], 1],
  ["Keys", ["keys"], 2],
  ["Pad", ["pad"], 3],
  ["Bass", ["bass"], 4],
  ["Arp", ["arp"], 5],
  ["Drums", Object.keys(DRUM_NOTES), 9],
];

async function exportTake() {
  const stamp = new Date()
    .toISOString()
    .slice(0, 19)
    .replace(/[-:]/g, "")
    .replace("T", "-");
  const base = `sway-${stamp}`;
  const files = [];
  if (audio.recorder) {
    await new Promise((resolve) => {
      take.stopped = resolve;
      audio.recorder.port.postMessage("stop");
    });
    const frames = take.chunks.reduce(
      (sum, chunk) => sum + chunk.left.length,
      0,
    );
    const left = new Float32Array(frames);
    const right = new Float32Array(frames);
    let at = 0;
    for (const chunk of take.chunks) {
      left.set(chunk.left, at);
      right.set(chunk.right, at);
      at += chunk.left.length;
    }
    take.chunks = [];
    files.push([
      "Save audio",
      `${base}.wav`,
      "audio/wav",
      encodeWav(left, right, audio.ctx.sampleRate),
    ]);
  }
  const notes = engine.log.filter((note) => note.beats !== null);
  const midi = encodeMidi({
    tempo: WORLD.tempo,
    tracks: MIDI_TRACKS.map(([name, parts, channel]) => ({
      name,
      channel,
      notes: notes.filter((note) => parts.includes(note.part)),
    })).filter((track) => track.notes.length),
  });
  files.push(["Save MIDI", `${base}.mid`, "audio/midi", midi]);
  const record = {
    app: "Sway",
    version: 1,
    world: {
      id: WORLD.id,
      name: WORLD.name,
      key: WORLD.key,
      tempo: WORLD.tempo,
      swing: WORLD.swing,
    },
    settings: {
      leadSide: settings.leadSide,
      grid: settings.grid,
      range: settings.range,
      harmony: harmony ? harmony.palette : "off",
    },
    harmony: harmony && {
      model: "MRT2 small",
      palette: harmony.palette,
      generatedBars: harmony.stats.played,
      synthesizedBars: harmony.stats.missed,
    },
    recordedAt: new Date(
      Date.now() - (performance.now() - startedAt),
    ).toISOString(),
    durationSeconds: +((performance.now() - startedAt) / 1000).toFixed(2),
    controls: controlLog,
    notes,
  };
  files.push([
    "Save performance",
    `${base}.json`,
    "application/json",
    JSON.stringify(record, null, 2),
  ]);
  return files;
}

function showDownloads(files) {
  downloads.forEach((url) => URL.revokeObjectURL(url));
  downloads = [];
  $("downloads").replaceChildren(
    ...files.map(([label, name, type, data]) => {
      const url = URL.createObjectURL(new Blob([data], { type }));
      downloads.push(url);
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      link.textContent = label;
      return link;
    }),
  );
}

// Free play records the piece; lessons do not.
async function start({ level, lesson = false } = {}) {
  const { ctx, synth } = await ensureAudio();
  engine?.stop();
  level ??= controls.band.level ?? 1;
  controls = newControls();
  trail = [];
  captures = [];
  noteCount = 0;
  harmony = null;
  harmonyCheck.warned = false;
  if (harmonyCheck.available && PALETTES[settings.harmony]) {
    harmony = new GeneratedHarmony(ctx, synth.buses.harmony, {
      palette: settings.harmony,
      world: WORLD,
    });
    harmony.start();
  }
  engine = new Engine(ctx, synth, {
    grid: settings.grid,
    level,
    compensation: SENSOR + settings.offset,
    harmony,
  });
  engine.on(onEngine);
  take = { chunks: [] };
  controlLog = [];
  if (!lesson) audio.recorder?.port.postMessage("start");
  engine.start();
  startedAt = performance.now();
  $("end-piece").hidden = lesson;
  stage.dataset.state = "playing";
  $("finished").hidden = true;
  renderLoops();
  return engine;
}

// The tutorial, driving the same engine and controls as free play.
const coach = new Coach({
  startEngine: ({ level }) => start({ level, lesson: true }),
  stopEngine: () => {
    engine?.stop();
    stage.dataset.state = "lesson";
  },
  endEngine: () => engine?.end(),
  engineState: () => engine?.state,
  engineLevel: () => engine?.level,
  showCard,
  hideCard: () => ($("lesson").hidden = true),
  setRange: (range) => {
    settings.range = range;
    store.set("range", range);
    controls.range = { ...range };
  },
  setCompensation: (offset) => {
    settings.offset = offset ?? 0;
    store.set("offset", settings.offset);
    if (engine) engine.compensation = SENSOR + settings.offset;
  },
  camera: () => camera.active,
  leadName: () => settings.leadSide.toLowerCase(),
  now: () => performance.now() / 1000,
  beatSeconds: () => 60 / WORLD.tempo,
  currentRung: () => controls.lead.rung,
  freePlay: () => {
    $("lesson").hidden = true;
    start();
  },
  record: (id, summary) => {
    const lessons = store.get("lessons", {});
    lessons[id] = { ...summary, at: new Date().toISOString() };
    store.set("lessons", lessons);
  },
});

function showCard({
  step,
  title,
  body,
  details = [],
  actions = [],
  compact = false,
}) {
  if (stage.dataset.state !== "playing" || engine?.state !== "playing")
    stage.dataset.state = "lesson";
  $("lesson-step").textContent = step;
  $("lesson-title").textContent = title;
  $("lesson-body").textContent = body;
  $("lesson-details").hidden = !details.length;
  $("lesson-details").replaceChildren(
    ...details.map((line) => {
      const item = document.createElement("li");
      item.textContent = line;
      return item;
    }),
  );
  $("lesson-actions").replaceChildren(
    ...actions.map(({ label, secondary, run }) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = secondary ? "secondary" : "primary";
      button.textContent = label;
      button.onclick = run;
      return button;
    }),
  );
  $("lesson").classList.toggle("compact", compact);
  $("lesson").hidden = false;
  $("lesson-actions").querySelector("button")?.focus({ preventScroll: true });
}

function onEngine(event) {
  const beat = event.time !== undefined ? engine.beatAt(event.time) : null;
  if (event.type === "note") {
    coach.onNote(event);
    const open = trail.at(-1);
    if (open && open.end === null) open.end = beat;
    trail.push({
      rung: event.rung,
      start: beat,
      end: null,
      legato: Boolean(event.legato),
    });
    if (trail.length > 64) trail.shift();
    noteCount++;
  } else if (event.type === "noteOff") {
    const open = trail.at(-1);
    if (open && open.end === null) open.end = beat;
  } else if (event.type === "capture") {
    captures.push(engine.heardBeat());
    coach.onCapture(engine.heardBeat());
    flashHint("Looped. Play something new over it.");
    renderLoops();
  } else if (event.type === "loopNote") {
    lastLoopPulse.set(event.layer, event.time);
  } else if (event.type === "ending" && !coach.active) {
    flashHint("Ending on the next bar.");
  } else if (event.type === "finished" && !coach.active) {
    const wait = Math.max(0, (event.tail - engine.ctx.currentTime) * 1000);
    setTimeout(() => finish(), wait);
  }
}

async function finish() {
  if (
    !engine ||
    engine.state !== "finished" ||
    stage.dataset.state === "finished"
  )
    return;
  $("end-piece").hidden = true;
  const preparing = document.createElement("span");
  preparing.className = "preparing";
  preparing.textContent = "Preparing your files…";
  $("downloads").replaceChildren(preparing);
  const seconds = Math.round((performance.now() - startedAt) / 1000);
  const minutes = Math.floor(seconds / 60);
  const count = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const loops = engine.looper.layers.length;
  $("finished-summary").textContent =
    `${minutes}:${String(seconds % 60).padStart(2, "0")} of music, ${count(noteCount, "note")}` +
    (loops ? `, ${count(loops, "loop")}.` : ".");
  stage.dataset.state = "finished";
  $("finished").hidden = false;
  try {
    showDownloads(await exportTake());
  } catch (error) {
    preparing.textContent = `The files could not be prepared: ${error.message}`;
  }
}

// Camera.

function cameraStatus(status, message) {
  stage.dataset.camera = status === "tracking" ? "on" : "off";
  const label = {
    starting: "Starting camera",
    loading: "Loading tracker",
    tracking: "Turn camera off",
  }[status];
  for (const button of [$("camera-toggle"), $("camera-intro")])
    button.textContent = label ?? "Turn camera on";
  if (status === "error" || status === "ended") {
    cameraRoles = {};
    const error = $("camera-error");
    error.hidden = !message;
    error.textContent = message ?? "";
    if (message) flashHint(message);
  }
}

async function toggleCamera() {
  if (camera.active) {
    camera.stop();
    cameraRoles = {};
    cameraStatus("off");
    return;
  }
  try {
    $("camera-error").hidden = true;
    await camera.start();
  } catch (error) {
    camera.stop();
    cameraStatus("error", `Camera unavailable: ${error.message}`);
  }
}

// Generated harmony.

// MRT2 runs in the local server; without it, the synthesized pad plays the harmony.
async function checkHarmony() {
  try {
    const response = await fetch("/api/harmony/status");
    harmonyCheck.available =
      response.ok && (await response.json()).available === true;
  } catch {
    harmonyCheck.available = false;
  }
  harmonyCheck.done = true;
  $("harmony-note").textContent =
    "Generated harmony needs MRT2 on this Mac: run uv run --locked sway setup --music-only, then restart the server.";
  applySettings();
}

function renderHarmony() {
  const chip = $("harmony-status");
  chip.hidden = !harmony || harmony.state === "failed";
  if (!harmony) return;
  chip.textContent = PALETTES[harmony.palette];
  chip.classList.toggle("seen", harmony.last === "generated");
  chip.title =
    harmony.last === "generated"
      ? "Generated by MRT2 on this Mac: the band's harmony."
      : "The synthesized pad plays until MRT2's next bar is ready.";
  if (harmony.state === "failed" && !harmonyCheck.warned) {
    harmonyCheck.warned = true;
    flashHint(
      `Generated harmony stopped (${harmony.error}); the synthesized pad plays instead.`,
    );
  }
}

// Heads-up display.

let hintUntil = 0;
function flashHint(text) {
  $("hint").textContent = text;
  hintUntil = performance.now() + 3500;
}

function currentHint() {
  if (performance.now() < hintUntil) return null;
  const progress = coach.progress;
  if (progress !== null) return progress;
  if (stage.dataset.state !== "playing" || !engine) return "";
  const leadName = settings.leadSide.toLowerCase();
  const bandName = settings.leadSide === "Right" ? "left" : "right";
  if (engine.state === "ending") return "Ending on the next bar.";
  if (!controls.lead.visible)
    return camera.active
      ? `Raise your ${leadName} hand into view to play.`
      : "Move the mouse over the stage, and click to play.";
  if (noteCount === 0)
    return "Pinch to play. A higher hand plays a higher note.";
  if (noteCount < 6)
    return "Keep the pinch and move up or down to draw a melody.";
  if (camera.active && !controls.band.visible)
    return `Show your ${bandName} hand to steer the band.`;
  if (!engine.looper.layers.length && noteCount > 16)
    return `When you like a phrase, pinch and hold with your ${bandName} hand to loop it.`;
  return "";
}

function renderLoops() {
  const layers = engine?.looper.layers ?? [];
  $("loop-chips").replaceChildren(
    ...layers.map((layer, i) => {
      const chip = document.createElement("span");
      chip.className = "loop-chip";
      chip.dataset.layer = layer.id;
      chip.textContent = `Loop ${i + 1}`;
      return chip;
    }),
  );
  $("undo-loop").hidden = !layers.length;
}

function toggleDetails() {
  $("details").hidden = !$("details").hidden;
}

const median = (values) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

function renderDetails() {
  if ($("details").hidden) return;
  const ms = (value) =>
    value === null || value === undefined ? "-" : `${Math.round(value)} ms`;
  const ctx = audio?.ctx;
  const rows = [
    ["Tracking (capture to hands)", ms(median(camera.stats.tracking))],
    ["Note delay (capture to sound)", ms(median(engine?.stats.delays ?? []))],
    [
      "Audio output",
      ms(
        ctx ? ((ctx.outputLatency || 0) + (ctx.baseLatency || 0)) * 1000 : null,
      ),
    ],
    [
      "Camera frames processed",
      `${camera.stats.frames - camera.stats.dropped} / ${camera.stats.frames}`,
    ],
    [
      "Frames with capture time",
      camera.stats.frames
        ? `${Math.round((100 * camera.stats.captureTimes) / Math.max(1, camera.stats.frames - camera.stats.dropped))}%`
        : "-",
    ],
    [
      "Generated harmony",
      harmony
        ? `${harmony.stats.played} bars, ${harmony.stats.missed} synthesized`
        : "Off",
    ],
    ["MRT2 render per bar", ms(median(harmony?.stats.renderMs ?? []))],
    ["Late scheduler steps", engine ? `${engine.stats.lateSteps}` : "-"],
    ["Worst lateness", engine ? ms(engine.stats.worstLateMs) : "-"],
  ];
  $("details-list").replaceChildren(
    ...rows.flatMap(([label, value]) => {
      const dt = document.createElement("dt");
      dt.textContent = label;
      const dd = document.createElement("dd");
      dd.textContent = value;
      return [dt, dd];
    }),
  );
}

// Drawing.

const PAST = 4;
const FUTURE = 2;

function energySegments(beat) {
  if (!engine?.transport) return [];
  const segments = [];
  const first = Math.floor((beat - PAST) / 4);
  const last = Math.floor((beat + FUTURE) / 4);
  for (let bar = first; bar <= last; bar++) {
    if (bar < 0) continue;
    const info = engine.barInfo(bar);
    const start = bar * 4;
    if (info) {
      const cutAt = info.cutAt === null ? 4 : info.cutAt / 4;
      if (cutAt > 0)
        segments.push({ start, end: start + cutAt, level: info.level });
      continue;
    }
    if (engine.state !== "playing") continue;
    const cut = engine.cut.active && !engine.cut.release;
    segments.push({
      start,
      end: start + 4,
      level: engine.pendingLevel ?? engine.level,
      cut,
      future: true,
    });
  }
  return segments;
}

function loopNotes(beat) {
  if (!engine) return [];
  return engine.looper
    .window(beat - PAST, beat + FUTURE)
    .map((note) => ({ ...note, rung: WORLD.ladder.indexOf(note.pitch) }))
    .filter((note) => note.rung >= 0);
}

let lastHud = "";
function frame() {
  requestAnimationFrame(frame);
  const now = performance.now() / 1000;
  if (!camera.active && stage.dataset.state === "playing") update(now);
  const playing = engine?.transport && stage.dataset.state !== "intro";
  if (playing && coach.active) coach.tick(engine.heardBeat());
  const beat = playing ? engine.heardBeat() : (now * WORLD.tempo) / 60;
  const bar = Math.max(0, Math.floor(beat / 4));
  const info = playing ? engine.barInfo(bar) : null;
  const chord = info?.chord ?? chordAt(WORLD, "low", 0);
  const level = info?.level ?? engine?.level ?? 1;
  // A cut can start mid-bar, on the sixteenth recorded for that bar.
  const sixteenth = (beat - bar * 4) * 4;
  const cut = Boolean(info && info.cutAt !== null && sixteenth >= info.cutAt);
  const view = {
    aspect: camera.active
      ? camera.aspect
      : stage.clientWidth / Math.max(1, stage.clientHeight),
  };
  const { lead: leadHand, band: bandHand } = currentHands();
  overlay.draw({
    ...view,
    range: settings.range,
    leadSide: settings.leadSide,
    beat,
    ladder: WORLD.ladder,
    chord,
    levels: WORLD.levels,
    level,
    cut,
    lead: {
      hand: leadHand,
      rung: controls.lead.rung,
      gate: controls.lead.gate,
    },
    band: {
      hand: bandHand,
      level: controls.band.level,
      cut: controls.band.cut,
    },
    trail: trail.filter((note) => (note.end ?? beat) > beat - PAST - 1),
    loopNotes: loopNotes(beat),
    energy: energySegments(beat),
    captures: captures.filter((mark) => mark > beat - PAST - 1),
    endProgress: controls.endProgress,
    captureProgress: controls.captureProgress,
    targets: coach.targets,
    leadHold: coach.holdProgress,
    view: coach.active ? "lesson" : "play",
  });

  // The HUD updates only when something visible changes.
  const beatIndex = Math.floor(beat) % 4;
  const next = info?.next ?? chordAt(WORLD, "low", bar + 1);
  const hud = [
    chord.name,
    next?.name,
    beatIndex,
    cut ? "Cut" : WORLD.levels[level],
    Boolean(leadHand),
    Boolean(bandHand),
    harmony ? `${harmony.state}:${harmony.last}` : "",
    currentHint(),
  ].join("|");
  if (hud !== lastHud) {
    lastHud = hud;
    $("chord").textContent = chord.name;
    $("next-chord").textContent = next ? `then ${next.name}` : "";
    [...$("beats").children].forEach((dot, i) => {
      dot.classList.toggle("on", playing && i === beatIndex);
      dot.classList.toggle("bar", i === 0);
    });
    $("level-name").textContent = cut ? "Cut" : WORLD.levels[level];
    $("lead-status").classList.toggle("seen", Boolean(leadHand));
    $("band-status").classList.toggle("seen", Boolean(bandHand));
    renderHarmony();
    const hint = currentHint();
    if (hint !== null) $("hint").textContent = hint;
  }
  const ctxTime = audio?.ctx.currentTime ?? 0;
  for (const chip of $("loop-chips").children) {
    const pulse = lastLoopPulse.get(Number(chip.dataset.layer));
    chip.classList.toggle(
      "pulse",
      pulse !== undefined && ctxTime - pulse < 0.12 && ctxTime >= pulse,
    );
  }
  renderDetails();
}

// Settings and buttons.

function applySettings() {
  $("lead-side").value = settings.leadSide;
  $("grid").value = String(settings.grid);
  $("lead-name").textContent = settings.leadSide;
  $("band-name").textContent = settings.leadSide === "Right" ? "Left" : "Right";
  $("lead-status").textContent = `${settings.leadSide} hand`;
  $("band-status").textContent =
    `${settings.leadSide === "Right" ? "Left" : "Right"} hand`;
  $("world").textContent = `${WORLD.name} · ${WORLD.key} · ${WORLD.tempo} BPM`;
  const choice = $("harmony");
  choice.disabled = !harmonyCheck.available;
  choice.value = harmonyCheck.available ? settings.harmony : "off";
  $("harmony-note").hidden = !harmonyCheck.done || harmonyCheck.available;
}

$("lead-side").onchange = (event) => {
  settings.leadSide = event.target.value;
  store.set("leadSide", settings.leadSide);
  tracker = new HandTracker({ leadSide: settings.leadSide });
  pointer.band = null;
  applySettings();
};
$("harmony").onchange = (event) => {
  settings.harmony = event.target.value;
  store.set("harmony", settings.harmony);
};
$("grid").onchange = (event) => {
  settings.grid = Number(event.target.value);
  store.set("grid", settings.grid);
  if (engine) engine.grid = settings.grid;
};
$("start").onclick = () => start();
$("again").onclick = () => start();
$("learn").onclick = () => coach.begin();
$("camera-toggle").onclick = toggleCamera;
$("camera-intro").onclick = toggleCamera;
$("end-piece").onclick = () => engine?.end();
$("undo-loop").onclick = () => {
  engine?.undoLoop();
  renderLoops();
};
window.addEventListener("pagehide", () => {
  downloads.forEach((url) => URL.revokeObjectURL(url));
  camera.stop();
  engine?.stop();
  harmony?.stop();
  audio?.ctx.close();
});

applySettings();
checkHarmony();
cameraStatus("off");
requestAnimationFrame(frame);

// Scripted input for automated checks: the same features any hand provides.
window.sway = {
  settings,
  camera,
  get hands() {
    return currentHands();
  },
  get engine() {
    return engine;
  },
  get controls() {
    return controls;
  },
  start,
  coach,
  input(hands, time = performance.now() / 1000) {
    scripted = hands;
    update(time);
  },
};
