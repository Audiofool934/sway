import { startStreamPage } from "./stream-page.js";
import { REST, SteeredControls } from "./steered-controls.js";
import {
  ConductorControls,
  VOICE_PLACES,
  voiceWeights,
} from "./conductor-controls.js";
import { GestureGuide } from "./gesture-guide.js";

// By default the player conducts a film score (docs/v2-design.md). `?variant=spine`
// plays V2's first milestone, Night Drive's chords on repeat, `?variant=free` the page
// as it was on October 14, without the spine, and `?variant=theme` the spine with a
// theme that returns every twelve bars; all three are steered, not conducted.
// `?hand=left` lets a left-handed player conduct with the left hand.
const params = new URLSearchParams(location.search);
const variant = params.get("variant");
const earlier = ["spine", "free", "theme"].includes(variant);
const free = variant === "free";
const themed = variant === "theme";
const leftHanded = params.get("hand") === "left";
const LEAD = 1.2; // Seconds by which the server tells the model ahead (steering.Spine).

const level = (x, words) => words[x < 0.35 ? 0 : x < 0.65 ? 1 : 2];

// Where the theme is: playing, resting while the hands are still, or bars away.
function showTheme($, model) {
  if (!model.theme) return;
  $("section").textContent =
    model.theme === "playing"
      ? "The theme"
      : model.theme === "resting"
        ? "The theme · resting"
        : `The theme returns in ${model.themeIn} bar${model.themeIn === 1 ? "" : "s"}`;
}

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

// The world's voices, placed across the view where the left hand reaches them, each
// as bright as the conductor brings it forward.
let voices = null;
function showVoices($, state, model) {
  if (!model.voices) return;
  if (voices !== model.voices.join("|")) {
    voices = model.voices.join("|");
    $("voices").replaceChildren(
      ...model.voices.map((name, index) => {
        const label = document.createElement("span");
        label.textContent = name;
        label.style.left = `${VOICE_PLACES[index] * 100}%`;
        return label;
      }),
    );
  }
  const weights = voiceWeights(state.voice, state.forward).slice(1);
  [...$("voices").children].forEach((label, index) => {
    label.style.opacity = 0.3 + 0.7 * weights[index];
    label.classList.toggle("lead", weights[index] > 0.5);
  });
}

// When the new section will be heard, in the audio's time: from the server's count of
// frames once it has one, else from the beat, as the server will choose it.
function landing(model, audio) {
  const now = audio.context.currentTime;
  const queued = (audio.stats.queuedMs ?? 160) / 1000;
  if (model.landing != null) return now + model.landing * 0.04 + queued;
  const bar = (model.beatsPerBar * 60) / model.tempo;
  const into = (model.beat / model.beatsPerBar) * bar;
  return now + Math.ceil((into + LEAD) / bar) * bar - into + queued;
}

// Raising both hands starts a swell; bringing them down lands it, with the new section,
// on the bar; letting them down slowly lets it fade.
let cues = 0,
  preparing = false,
  movingOn = null;
function showMove(state, $, model, audio) {
  if (state.cue < cues) [cues, preparing, movingOn] = [0, false, null]; // A new take.
  if (!audio || !model.tempo) return;
  if (state.prepared && !preparing) {
    preparing = true;
    audio.cue(audio.context.currentTime + 6);
  }
  if (state.cue > cues) {
    cues = state.cue;
    preparing = false;
    movingOn = { section: model.section, confirmed: false };
    audio.cue(landing(model, audio));
  } else if (preparing && !state.prepared) {
    preparing = false;
    audio.cancelCue();
  }
  if (movingOn && !movingOn.confirmed && model.landing != null) {
    movingOn.confirmed = true;
    audio.cue(landing(model, audio)); // Land the swell where the server will.
  }
  if (movingOn && model.section !== movingOn.section) movingOn = null;
}

function showSection($, model) {
  const section = model.section
    ? `${model.section[0].toUpperCase()}${model.section.slice(1)}`
    : "";
  $("section").textContent = preparing
    ? "Ready…"
    : movingOn
      ? "Moving on…"
      : section && model.caption && model.caption !== section
        ? `${section} · ${model.caption}`
        : section;
}

const conducting = {
  Controls: leftHanded
    ? class extends ConductorControls {
        constructor() {
          super({ leftHanded: true });
        }
      }
    : ConductorControls,
  hint: {
    camera:
      "Bigger motion plays louder · Faster motion drives harder · The other hand brings a voice forward · Pinch for short notes · A fist hushes · Both hands up, then down, to move on",
    pointer:
      "Hold and move · Bigger motion plays louder · Faster motion drives harder · Release to hush · Double-click to move on",
  },
  glow: (state) => state.dynamics,
  swing: (state) => state.energy,
  show(state, $, model, audio) {
    showChords($, model);
    showVoices($, state, model);
    guide?.setVoices(model.voices);
    showMove(state, $, model, audio);
    showSection($, model);
    // The volume answers the motion's size at once: from -12 dB to full.
    audio?.level(10 ** ((-12 + 12 * state.dynamics) / 20));
    $("gesture-name").textContent = state.hush
      ? "Hushed"
      : [
          level(state.dynamics, ["Soft", "Moderate", "Loud"]),
          level(state.energy, ["Calm", "Flowing", "Driving"]),
          level(state.articulation, [
            "Long notes",
            "Mixed notes",
            "Short notes",
          ]),
        ].join(" · ");
    $("first-meter").style.width = `${state.dynamics * 100}%`;
    $("second-meter").style.width = `${state.energy * 100}%`;
    $("third-meter").style.width = `${state.articulation * 100}%`;
  },
};

// The earlier, steered variants' words for where the hands are taking the music.
const steering = {
  Controls: SteeredControls,
  hint: {
    camera: `Height sets the register${themed ? " and the theme's octave" : ""} · Movement sets the energy · Hands apart open the harmony · Stillness ${free ? "rests" : "thins the music"}`,
    pointer: `Hold and move · Height sets the register${themed ? " and the theme's octave" : ""} · Left to right opens the harmony · Speed sets the energy · Release to ${free ? "rest" : "thin the music"}`,
  },
  glow: (state) => state.activity,
  swing: (state) => state.spread,
  show(state, $, model) {
    showChords($, model);
    showTheme($, model);
    $("gesture-name").textContent =
      state.activity < REST
        ? free
          ? "Resting"
          : "Resting · the music thins"
        : [
            level(state.activity, ["Calm", "Flowing", "Lively"]),
            level(state.height, ["Low", "Middle", "High"]),
            level(state.spread, ["On the chord", "Pentatonic", "Whole scale"]),
          ].join(" · ");
    $("first-meter").style.width = `${state.height * 100}%`;
    $("second-meter").style.width = `${state.activity * 100}%`;
    $("third-meter").style.width = `${state.spread * 100}%`;
  },
};

const mode = earlier ? steering : conducting;

// The gestures, drawn: open at any time with the button or G; Escape closes the guide
// before it would end the take.
const guideButton = document.getElementById("gestures");
const guide = earlier
  ? null
  : new GestureGuide(document.getElementById("gesture-guide"), {
      onToggle: (open) => guideButton.setAttribute("aria-expanded", open),
    });
if (guide) {
  guideButton.onclick = () => guide.toggle();
  document.getElementById("show-gestures").onclick = () => guide.show();
  window.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape" && guide.open) {
        guide.hide();
        event.stopPropagation();
        event.preventDefault();
      } else if (
        event.key.toLowerCase() === "g" &&
        !event.repeat &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.target.closest?.("textarea, select, input:not([type=range])")
      )
        guide.toggle();
    },
    true,
  );
} else {
  guideButton.hidden = true;
  document.getElementById("show-gestures").hidden = true;
}
if (earlier)
  for (const [id, text] of [
    ["first-label", "Height"],
    ["second-label", "Energy"],
    ["third-label", "Spread"],
  ])
    document.getElementById(id).textContent = text;

startStreamPage({
  stream: "steered",
  query: earlier ? `?variant=${variant}` : "",
  Controls: mode.Controls,
  audio: { expression: false },
  text: {
    cameraEnded: "The camera disconnected. Start again, or try with the mouse.",
    preparing: "Preparing the orchestra",
    hint: mode.hint,
    loadTimeout: "The sound took too long to prepare. Please try again.",
    ready: {
      camera: "Bring your hands into view to conduct",
      pointer: "Hold the stage and move to conduct",
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
    idle: themed
      ? "Theme · ready"
      : earlier
        ? "Steered · ready"
        : "Film score · ready",
    hidden: "The performance stopped when you left the page. You can save it.",
    handsGone: "Bring your hands back into view",
    playing: themed
      ? "Theme · playing"
      : earlier
        ? "Steered · generating"
        : "Film score · conducting",
    timeLimit: "Five minutes are saved. Download them, or start a new take.",
  },
  glow: mode.glow,
  swing: mode.swing,
  show: mode.show,
});
