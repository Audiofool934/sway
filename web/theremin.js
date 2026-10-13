import { startStreamPage } from "./stream-page.js";
import { ThereminControls } from "./theremin-controls.js";

const NAMES = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];

startStreamPage({
  stream: "theremin",
  Controls: ThereminControls,
  audio: { expression: true },
  text: {
    cameraEnded: "摄像头已断开。可以重新开始，或用鼠标试奏。",
    preparing: "准备声音中",
    hint: {
      camera: "高度改变音高 · 拉开双手展开声音 · 握拳留白",
      pointer: "按住并移动 · 高度改变音高 · 左右改变展开程度 · 松开留白",
    },
    loadTimeout: "声音准备超时。请重试。",
    ready: {
      camera: "双手入镜，即可演奏",
      pointer: "按住画面，开始试奏",
    },
    busy: "这个实验需要本机 MRT2，且一次只能打开一个演奏窗口。请关闭其他实验窗口后重试。",
    stopped: "声音连接已停止。请重新开始。",
    stoppedSave: "声音连接已停止。可以保存刚才的声音，再试一次。",
    checking: "正在检查声音连接",
    startFailed: {
      camera: "摄像头或声音未能启动。请允许摄像头访问，或用鼠标试奏。",
      pointer: "声音未能启动。请重新开始。",
    },
    ended: "这一段已结束。可以保存声音，或再探索一次。",
    ending: "收好这一段尾音",
    idle: "弦 · 继续探索",
    hidden: "演奏已在切换页面时停止。可以保存刚才的声音。",
    handsGone: "让手回到画面里",
    playing: "弦 · 正在生成",
    timeLimit: "五分钟的探索已保存下来。可以下载声音，再开始新的一段。",
  },
  glow: (state) => state.energy,
  swing: (state) => state.spread,
  show(state, $) {
    $("pitch-name").textContent = NAMES[state.pitch % 12];
    $("pitch-octave").textContent = Math.floor(state.pitch / 12) - 1;
    $("gesture-name").textContent = !state.active
      ? "留一点空白"
      : state.grain > 0.55
        ? "短促，清晰的颗粒"
        : state.spread > 0.65
          ? "让声音展开"
          : "顺着声音，慢慢延展";
    $("bow-meter").style.width = `${(1 - state.grain) * state.energy * 100}%`;
    $("spread-meter").style.width = `${state.spread * 100}%`;
    $("grain-meter").style.width = `${state.grain * 100}%`;
  },
});
