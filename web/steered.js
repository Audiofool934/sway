import { startStreamPage } from "./stream-page.js";
import { REST, SteeredControls } from "./steered-controls.js";

// Words for where the hands are taking the music. The harmony thresholds are
// steering.Steered.pitch_classes's.
const energy = (a) => (a < 0.4 ? "Calm" : a < 0.7 ? "Flowing" : "Lively");
const register = (h) => (h < 0.33 ? "Low" : h < 0.67 ? "Middle" : "High");
const harmony = (s) =>
  s < 0.35 ? "On the chord" : s < 0.65 ? "Pentatonic" : "Whole scale";

startStreamPage({
  stream: "steered",
  Controls: SteeredControls,
  audio: { expression: false },
  text: {
    cameraEnded: "The camera disconnected. Start again, or try with the mouse.",
    preparing: "Preparing the sound",
    hint: {
      camera:
        "Height sets the register · Movement sets the energy · Hands apart open the harmony · Stillness rests",
      pointer:
        "Hold and move · Height sets the register · Left to right opens the harmony · Speed sets the energy · Release to rest",
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
    idle: "Steered · ready",
    hidden: "The performance stopped when you left the page. You can save it.",
    handsGone: "Bring your hands back into view",
    playing: "Steered · generating",
    timeLimit: "Five minutes are saved. Download them, or start a new take.",
  },
  glow: (state) => state.activity,
  swing: (state) => state.spread,
  show(state, $) {
    $("gesture-name").textContent =
      state.activity < REST
        ? "Resting"
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
