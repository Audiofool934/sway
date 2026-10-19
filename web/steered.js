import { startStreamPage } from "./stream-page.js";
import { REST, SteeredControls } from "./steered-controls.js";

// By default the page plays a film score: the spine, with an arranger's phrases and a
// clap that moves on. `?variant=spine` plays V2's first milestone, Night Drive's chords
// on repeat, and `?variant=free` the page as it was on October 14, without the spine.
const variant = new URLSearchParams(location.search).get("variant");
const earlier = variant === "spine" || variant === "free";
const free = variant === "free";
const LEAD = 1.2; // Seconds by which the server tells the model ahead (steering.Spine).

// Words for where the hands are taking the music. The harmony thresholds are
// steering.Steered.pitch_classes's, and the spine opens the harmony the same way
// around each bar's chord.
const energy = (a) => (a < 0.4 ? "Calm" : a < 0.7 ? "Flowing" : "Lively");
const register = (h) => (h < 0.33 ? "Low" : h < 0.67 ? "Middle" : "High");
const harmony = (s) =>
  s < 0.35 ? "On the chord" : s < 0.65 ? "Pentatonic" : "Whole scale";

// The phrase's chords, with the one heard now marked. The server reports them every
// five model frames; the strip changes only when the chord does.
let shown = null;
function showChords($, model) {
  const chords = model.chords ?? [];
  const now = model.chordIndex ?? model.bar % chords.length;
  const key = `${chords.join(" ")}|${now}`;
  if (key === shown) return;
  shown = key;
  $("chords").replaceChildren(
    ...chords.map((name, index) => {
      const chord = document.createElement("span");
      chord.textContent = name;
      if (index === now) chord.className = "now";
      return chord;
    }),
  );
}

// When the clap's new section will be heard, in the audio's time: from the server's
// count of frames once it has one, else from the beat, as the server will choose it.
function landing(model, audio) {
  const now = audio.context.currentTime;
  const queued = (audio.stats.queuedMs ?? 160) / 1000;
  if (model.landing != null) return now + model.landing * 0.04 + queued;
  const bar = (model.beatsPerBar * 60) / model.tempo;
  const into = (model.beat / model.beatsPerBar) * bar;
  return now + Math.ceil((into + LEAD) / bar) * bar - into + queued;
}

let claps = 0,
  movingOn = null;
function showClap(state, $, model, audio) {
  if (state.cue < claps) [claps, movingOn] = [0, null]; // A new take.
  if (state.cue > claps && model.tempo && audio) {
    claps = state.cue;
    movingOn = { section: model.section, confirmed: false };
    audio.cue(landing(model, audio));
  }
  if (movingOn && !movingOn.confirmed && model.landing != null) {
    movingOn.confirmed = true;
    audio?.cue(landing(model, audio)); // Land the swell where the server will.
  }
  if (movingOn && model.section !== movingOn.section) movingOn = null;
  const section = model.section
    ? `${model.section[0].toUpperCase()}${model.section.slice(1)}`
    : "";
  $("section").textContent = movingOn
    ? "Moving on…"
    : section && model.caption && model.caption !== section
      ? `${section} · ${model.caption}`
      : section;
}

startStreamPage({
  stream: "steered",
  query: earlier ? `?variant=${variant}` : "",
  Controls: SteeredControls,
  audio: { expression: false },
  text: {
    cameraEnded: "The camera disconnected. Start again, or try with the mouse.",
    preparing: "Preparing the orchestra",
    hint: {
      camera: `Height sets the register · Movement sets the energy · Hands apart open the harmony · Stillness ${free ? "rests" : "thins the music"}${earlier ? "" : " · Clap to move on"}`,
      pointer: `Hold and move · Height sets the register · Left to right opens the harmony · Speed sets the energy · Release to ${free ? "rest" : "thin the music"}${earlier ? "" : " · Double-click to move on"}`,
    },
    loadTimeout: "The sound took too long to prepare. Please try again.",
    ready: {
      camera: "Bring your hands into view to play",
      pointer: "Hold the stage and move to play",
    },
    busy: "This page needs MRT2 on this Mac, and only one performance window can play at a time. Close the other window and try again.",
    stopped: "The sound stopped. Please start again.",
    stoppedSave:
      "The sound stopped. You can save what you played and try again.",
    checking: "Checking the sound connection",
    startFailed: {
      camera:
        "The camera or the sound did not start. Allow camera access, or try with the mouse.",
      pointer: "The sound did not start. Please start again.",
    },
    ended: "That take has ended. Save it, or play another.",
    ending: "Letting the last notes ring",
    idle: earlier ? "Steered · ready" : "Film score · ready",
    hidden: "The performance stopped when you left the page. You can save it.",
    handsGone: "Bring your hands back into view",
    playing: earlier ? "Steered · generating" : "Film score · generating",
    timeLimit: "Five minutes are saved. Download them, or start a new take.",
  },
  glow: (state) => state.activity,
  swing: (state) => state.spread,
  show(state, $, model, audio) {
    showChords($, model);
    showClap(state, $, model, audio);
    $("gesture-name").textContent =
      state.activity < REST
        ? free
          ? "Resting"
          : "Resting · the music thins"
        : [
            energy(state.activity),
            register(state.height),
            harmony(state.spread),
          ].join(" · ");
    $("height-meter").style.width = `${state.height * 100}%`;
    $("energy-meter").style.width = `${state.activity * 100}%`;
    $("spread-meter").style.width = `${state.spread * 100}%`;
  },
});
