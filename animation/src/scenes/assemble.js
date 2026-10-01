// 9. Assemble. A digital audio workstation is built, layer by layer, from the machines of
// the earlier chapters: each piece flies in with the year it was invented, in step with the
// layers entering the track. Along the bottom the Line becomes a string of dated beads:
// the trajectory, with no gap in it. Then the stop.

import {
  FONT,
  PALETTE,
  fillCircle,
  lineSeg,
  paper,
  paperCircle,
  paperRect,
  rgba,
  rrectPath,
  text,
} from "../core/draw.js";
import { clamp, lerp, outBack, outCubic, seg, smooth } from "../core/ease.js";
import { wave } from "../core/line.js";
import { rng } from "../core/rand.js";
import { cues, motif } from "../score.js";
import { BEAT, atBar, byId } from "../timeline.js";

const C = byId.assemble;
const BG = "#1b1d2a";
const INK = "#e8ecf5";
const PANEL = "#252839";
const STOP = C.duration - 0.2;

const WIN = { x: 120, y: 112, w: 1680, h: 618 };
const HEAD_W = 232;
const AREA = { x: 360, w: 890 };
const BARS = 8;
const barX = (b) => AREA.x + (b / BARS) * AREA.w;
const TRACK0 = 228;
const TRACK_H = 66;
const trackY = (i) => TRACK0 + i * TRACK_H;
const RIGHT = { x: 1272, w: 508 };

const layerLocal = (id) =>
  atBar(cues.assemble.layers.find((l) => l.id === id).bar) - C.start;

// The tracks: what enters when, in what color.
const TRACKS = [
  {
    id: "drums",
    name: "Drums",
    color: "#ff6b57",
    at: layerLocal("drums"),
    kind: "steps",
  },
  {
    id: "bass",
    name: "Bass",
    color: "#ffa84a",
    at: layerLocal("bass"),
    kind: "bass",
  },
  {
    id: "melody",
    name: "Keys",
    color: "#ffd166",
    at: layerLocal("melody"),
    kind: "notes",
  },
  {
    id: "pad",
    name: "Pad",
    color: "#4fd1c5",
    at: layerLocal("pad"),
    kind: "pad",
  },
  {
    id: "chops",
    name: "Samples",
    color: "#7aa2ff",
    at: layerLocal("chops"),
    kind: "slices",
  },
  {
    id: "arp",
    name: "Arp",
    color: "#b9a7ff",
    at: layerLocal("arp"),
    kind: "dense",
  },
];

// Each piece of the DAW and the machine it descends from; landing times follow the layers.
const PIECES = [
  {
    id: "tape",
    year: "1950s",
    name: "MULTITRACK",
    at: layerLocal("pad"),
    slot: 3,
    from: [-420, 0],
  },
  {
    id: "roll",
    year: "1896",
    name: "PAPER ROLL",
    at: layerLocal("melody"),
    slot: 2,
    from: [0, 380],
  },
  {
    id: "moog",
    year: "1964",
    name: "MOOG",
    at: layerLocal("bass"),
    slot: 4,
    from: [520, -120],
  },
  {
    id: "tr808",
    year: "1980",
    name: "TR-808",
    at: layerLocal("drums"),
    slot: 5,
    from: [-420, 120],
  },
  {
    id: "wave",
    year: "1857",
    name: "PHONAUTOGRAPH",
    at: layerLocal("chops"),
    slot: 1,
    from: [-300, 360],
  },
  {
    id: "midi",
    year: "1983",
    name: "MIDI",
    at: layerLocal("arp"),
    slot: 6,
    from: [520, 260],
  },
  {
    id: "fourier",
    year: "1822",
    name: "FOURIER",
    at: layerLocal("claps"),
    slot: 0,
    from: [520, 120],
  },
];
const SLOT_X = (slot) => 214 + slot * 214;
const STRIP_Y = 782;

const MELODY = [...motif(56), ...motif(60)].map((n) => ({
  t: n.t - C.start,
  dur: n.dur,
  midi: n.midi,
}));
const jitter = rng(77);
const NOISE = Array.from({ length: 400 }, () => jitter());

/** Time since a piece landed, or negative before. */
const since = (piece, t) => t - piece.at;
const present = (track, t) => t >= track.at - 0.6;

function drawCursor(ctx, x, y, alpha = 1) {
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.translate(x, y);
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#111";
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, 30);
  ctx.lineTo(8, 23);
  ctx.lineTo(14, 36);
  ctx.lineTo(20, 33);
  ctx.lineTo(14, 21);
  ctx.lineTo(24, 21);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function clipContent(ctx, track, x0, x1, y, h, t) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x0, y, x1 - x0, h);
  ctx.clip();
  const inner = (v) => y + 6 + (1 - v) * (h - 12);
  ctx.fillStyle = rgba("#0b0c14", 0.55);
  switch (track.kind) {
    case "steps":
      for (let beat = 0; beat < BARS * 4; beat++) {
        const x = barX(beat / 4);
        if (x < x0) continue;
        const big = beat % 2 === 0;
        ctx.fillRect(
          x + 2,
          inner(big ? 0.85 : 0.45),
          8,
          big ? h * 0.5 : h * 0.25,
        );
        if (beat % 4 === 2) ctx.fillRect(x + 22, y + 10, 8, h * 0.3);
      }
      break;
    case "bass":
      for (let bar = 0; bar < BARS; bar++) {
        const root = [0.22, 0.12, 0.3, 0.2][bar % 4];
        for (const [beat, len] of [
          [0, 1.4],
          [1.5, 0.5],
          [2.5, 0.9],
          [3.5, 0.4],
        ])
          ctx.fillRect(
            barX(bar + beat / 4) + 2,
            inner(root + 0.3),
            (len / 4) * (AREA.w / BARS) - 4,
            10,
          );
      }
      break;
    case "notes":
      for (const n of MELODY)
        ctx.fillRect(
          AREA.x + (n.t / (BARS * 2.4)) * AREA.w,
          inner((n.midi - 64) / 14 + 0.1),
          Math.max(6, (n.dur / (BARS * 2.4)) * AREA.w - 3),
          9,
        );
      break;
    case "pad":
      ctx.beginPath();
      for (let x = x0; x <= x1; x += 4) {
        const v =
          0.35 + 0.18 * Math.sin(x * 0.03) + 0.1 * Math.sin(x * 0.11 + 1.3);
        const yy = y + h / 2 + (v - 0.35) * h * 1.2;
        x === x0 ? ctx.moveTo(x, yy) : ctx.lineTo(x, yy);
      }
      ctx.strokeStyle = rgba("#0b0c14", 0.6);
      ctx.lineWidth = 3;
      ctx.stroke();
      break;
    case "slices":
      for (let bar = 0; bar < BARS; bar++)
        for (let k = 0; k < 4; k++) {
          const x = barX(bar + [2, 5, 9, 13][k] / 16);
          for (let i = 0; i < 9; i++)
            ctx.fillRect(
              x + i * 4,
              y + h / 2 - NOISE[(bar * 4 + k) * 9 + i] * 22 * (1 - i / 11),
              3,
              NOISE[(bar * 4 + k) * 9 + i] * 44 * (1 - i / 11) + 4,
            );
        }
      break;
    case "dense":
      for (let s = 0; s < BARS * 16; s++) {
        const x = barX(s / 16);
        ctx.fillRect(x + 1, inner(0.2 + 0.7 * NOISE[s % 200]), 4, 7);
      }
      break;
  }
  ctx.restore();
}

function drawWindow(ctx, t) {
  const frozen = t >= STOP;
  const stopFade = smooth(seg(t, STOP, STOP + 0.35));
  const open = outBack(seg(t, 0, 0.5), 1.1);
  ctx.save();
  ctx.translate(WIN.x + WIN.w / 2, WIN.y + WIN.h / 2);
  ctx.scale(
    0.96 + 0.04 * clamp(open, 0, 1.05),
    0.96 + 0.04 * clamp(open, 0, 1.05),
  );
  ctx.translate(-(WIN.x + WIN.w / 2), -(WIN.y + WIN.h / 2));
  paperRect(ctx, WIN.x, WIN.y, WIN.w, WIN.h, 16, "#161826", { dx: 6, dy: 12 });
  paperRect(ctx, WIN.x, WIN.y, WIN.w, 34, 16, "#202336", { shadow: false });
  [PALETTE.vermilion, PALETTE.mustard, "#4fd1c5"].forEach((c, i) =>
    fillCircle(ctx, WIN.x + 24 + i * 22, WIN.y + 17, 6, c, 0.9),
  );
  text(ctx, "Untitled Project", WIN.x + WIN.w / 2, WIN.y + 23, {
    font: `500 14px ${FONT.sans}`,
    color: INK,
    align: "center",
    opacity: 0.6,
  });
  // Transport.
  const bar = 57 - 1 + Math.floor(clamp(t, 0, C.duration - 0.01) / 2.4) + 1;
  const beat = 1 + Math.floor((clamp(t, 0, C.duration - 0.01) % 2.4) / BEAT);
  paperRect(ctx, WIN.x + 14, WIN.y + 42, WIN.w - 28, 40, 10, "#1e2133", {
    shadow: false,
  });
  paperRect(ctx, WIN.x + 26, WIN.y + 48, 168, 28, 8, "#0d1b22", {
    shadow: false,
  });
  text(
    ctx,
    `${String(bar).padStart(3, "0")} . ${beat} . 1`,
    WIN.x + 110,
    WIN.y + 69,
    {
      font: `600 18px ${FONT.mono}`,
      color: "#6fd2c4",
      align: "center",
      tracking: 2,
    },
  );
  text(ctx, "100 BPM", WIN.x + 230, WIN.y + 69, {
    font: `500 15px ${FONT.mono}`,
    color: INK,
    opacity: 0.7,
    tracking: 2,
  });
  text(ctx, "A MINOR", WIN.x + 340, WIN.y + 69, {
    font: `500 15px ${FONT.mono}`,
    color: INK,
    opacity: 0.7,
    tracking: 2,
  });
  // Transport buttons: play lit, stop lit at the end.
  paperCircle(
    ctx,
    WIN.x + 520,
    WIN.y + 62,
    12,
    frozen ? "#33364a" : "#4fd1c5",
    { shadow: false },
  );
  paperRect(
    ctx,
    WIN.x + 556,
    WIN.y + 51,
    22,
    22,
    4,
    frozen ? PALETTE.vermilion : "#33364a",
    { shadow: false },
  );

  // Track headers, ruler, and the grid.
  for (let b = 0; b < BARS; b++) {
    text(ctx, String(57 + b), barX(b) + 6, WIN.y + 108, {
      font: `500 13px ${FONT.mono}`,
      color: INK,
      opacity: 0.5,
    });
    lineSeg(
      ctx,
      barX(b),
      WIN.y + 94,
      barX(b),
      TRACK0 + 6 * TRACK_H,
      "#2d3147",
      1.5,
    );
  }
  TRACKS.forEach((track, i) => {
    const y = trackY(i);
    const live = present(track, t);
    paperRect(ctx, WIN.x + 14, y + 4, HEAD_W, TRACK_H - 8, 8, "#1e2133", {
      shadow: false,
    });
    paperRect(ctx, WIN.x + 14, y + 4, 8, TRACK_H - 8, 4, track.color, {
      shadow: false,
      opacity: live ? 1 : 0.35,
    });
    text(ctx, track.name, WIN.x + 38, y + 36, {
      font: `600 17px ${FONT.sans}`,
      color: INK,
      opacity: live ? 0.95 : 0.4,
    });
    // Level meter.
    const level = live
      ? 0.35 + 0.4 * Math.abs(Math.sin(t * 7 + i * 1.7)) * (1 - stopFade)
      : 0;
    paperRect(
      ctx,
      WIN.x + HEAD_W - 28,
      y + 12,
      10,
      TRACK_H - 24,
      4,
      "#0d0e16",
      { shadow: false },
    );
    paperRect(
      ctx,
      WIN.x + HEAD_W - 28,
      y + 12 + (TRACK_H - 24) * (1 - level),
      10,
      (TRACK_H - 24) * level,
      4,
      track.color,
      { shadow: false },
    );
    lineSeg(
      ctx,
      WIN.x + 14,
      y + TRACK_H,
      AREA.x + AREA.w,
      y + TRACK_H,
      "#2d3147",
      1.5,
    );
    // The clip drops in on its layer's bar line.
    const land = clamp((t - (track.at - 0.5)) / 0.5);
    if (land > 0) {
      const x0 = barX(Math.max(0, Math.round((track.at / 2.4) * 1)));
      const x1 = AREA.x + AREA.w - 4;
      ctx.save();
      ctx.globalAlpha = smooth(land);
      ctx.translate(0, (1 - outCubic(land)) * -26);
      paper(
        ctx,
        (c) => rrectPath(c, x0 + 3, y + 8, x1 - x0 - 6, TRACK_H - 16, 8),
        mix(track.color, "#161826", frozen ? 0.5 : 0.08),
        { dx: 2, dy: 4, alpha: 0.3 },
      );
      clipContent(ctx, track, x0 + 3, x1 - 3, y + 8, TRACK_H - 16, t);
      ctx.restore();
    }
  });
  // The playhead.
  const px = AREA.x + (clamp(t, 0, STOP) / C.duration) * AREA.w;
  lineSeg(ctx, px, WIN.y + 94, px, TRACK0 + 6 * TRACK_H, "#ffffff", 2.5, {
    opacity: 0.8,
  });
  paper(
    ctx,
    (c) => {
      c.moveTo(px - 8, WIN.y + 94);
      c.lineTo(px + 8, WIN.y + 94);
      c.lineTo(px, WIN.y + 108);
      c.closePath();
    },
    "#ffffff",
    { shadow: false },
  );
  ctx.restore();
}

function mix(a, b, t) {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return `rgb(${pa.map((v, i) => Math.round(lerp(v, pb[i], t))).join(",")})`;
}

function plugins(ctx, t) {
  const frozen = t >= STOP;
  const ts = (id) => PIECES.find((p) => p.id === id);
  // Synth plugin (the Moog's descendant): knobs and a scope.
  const synth = clamp(since(ts("moog"), t) / 0.5 + 1);
  if (synth > 0) {
    ctx.save();
    ctx.globalAlpha = smooth(synth);
    paperRect(ctx, RIGHT.x, WIN.y + 94, RIGHT.w, 170, 12, PANEL, {
      dx: 3,
      dy: 6,
    });
    text(ctx, "SYNTH", RIGHT.x + 18, WIN.y + 122, {
      font: `600 13px ${FONT.mono}`,
      color: INK,
      tracking: 3,
      opacity: 0.7,
    });
    for (let k = 0; k < 4; k++) {
      const cx = RIGHT.x + 60 + k * 88;
      const cy = WIN.y + 190;
      paperCircle(ctx, cx, cy, 28, "#1b1d2a", { dx: 2, dy: 4 });
      const a =
        -2.2 +
        3.6 *
          (0.5 + 0.5 * Math.sin(t * (0.5 + k * 0.2) + k)) *
          (frozen ? 0 : 1);
      lineSeg(
        ctx,
        cx,
        cy,
        cx + Math.cos(a - Math.PI / 2) * 22,
        cy + Math.sin(a - Math.PI / 2) * 22,
        "#ffa84a",
        4,
      );
    }
    ctx.restore();
  }
  // EQ plugin (Fourier): a spectrum with a boosted band.
  const eq = clamp(since(ts("fourier"), t) / 0.5 + 1);
  if (eq > 0) {
    ctx.save();
    ctx.globalAlpha = smooth(eq);
    const y0 = WIN.y + 278;
    paperRect(ctx, RIGHT.x, y0, RIGHT.w, 160, 12, PANEL, { dx: 3, dy: 6 });
    text(ctx, "EQ", RIGHT.x + 18, y0 + 28, {
      font: `600 13px ${FONT.mono}`,
      color: INK,
      tracking: 3,
      opacity: 0.7,
    });
    for (let i = 0; i < 40; i++) {
      const h =
        (0.12 +
          0.55 * Math.exp(-((i - 10) ** 2) / 20) +
          0.4 *
            Math.exp(-((i - 24) ** 2) / 30) *
            (0.7 + 0.3 * Math.sin(t * 5 + i))) *
        92 *
        (frozen ? 0.25 : 1);
      paperRect(
        ctx,
        RIGHT.x + 22 + i * 11.6,
        y0 + 140 - h,
        8,
        h,
        3,
        i > 19 && i < 28 ? "#ffb547" : "#4fd1c5",
        { shadow: false },
      );
    }
    ctx.restore();
  }
  // MIDI event list (the 1983 cable, as text).
  const midi = clamp(since(ts("midi"), t) / 0.5 + 1);
  if (midi > 0) {
    ctx.save();
    ctx.globalAlpha = smooth(midi);
    const y0 = WIN.y + 452;
    paperRect(ctx, RIGHT.x, y0, RIGHT.w, 166, 12, PANEL, { dx: 3, dy: 6 });
    text(ctx, "MIDI EVENTS", RIGHT.x + 18, y0 + 28, {
      font: `600 13px ${FONT.mono}`,
      color: INK,
      tracking: 3,
      opacity: 0.7,
    });
    const base = Math.floor(t * 6);
    for (let r = 0; r < 5; r++) {
      const k = base - r;
      const pitch = [69, 72, 76, 74, 72, 69, 67][((k % 7) + 7) % 7];
      text(ctx, `NOTE ON   ${pitch}   100`, RIGHT.x + 22, y0 + 56 + r * 21, {
        font: `500 15px ${FONT.mono}`,
        color: "#b9a7ff",
        opacity: (frozen ? 0.3 : 0.9) - r * 0.14,
      });
    }
    ctx.restore();
  }
}

function pieces(ctx, t) {
  PIECES.forEach((p, index) => {
    const age = since(p, t);
    // Flight: from offscreen toward the DAW, landing on the layer's bar line.
    const flight = seg(age, -0.9, -0.05);
    if (flight > 0 && flight < 1) {
      const e = outCubic(flight);
      const tx = 960;
      const ty = 420;
      const x = lerp(tx + p.from[0], tx, e);
      const y = lerp(ty + p.from[1], ty, e);
      ctx.save();
      ctx.globalAlpha =
        0.95 * Math.min(1, flight * 4) * (1 - smooth(seg(flight, 0.8, 1)));
      ctx.translate(x, y);
      ctx.rotate((1 - e) * ((index % 2 ? 1 : -1) * 0.5));
      paperRect(ctx, -170, -26, 340, 52, 12, "#fbf3dc", { dx: 4, dy: 8 });
      text(ctx, `${p.year}  ·  ${p.name}`, 0, 8, {
        font: `700 20px ${FONT.mono}`,
        color: "#2a1e14",
        align: "center",
        tracking: 2,
      });
      ctx.restore();
      drawCursor(ctx, x + 150, y + 6);
    }
    // After landing, the chip drops to its slot on the string of beads.
    if (age >= -0.05) {
      const x0 = 960;
      const y0 = 420;
      const x = lerp(x0, SLOT_X(p.slot), outCubic(seg(age, 0.15, 0.95)));
      const y = lerp(y0, STRIP_Y, outCubic(seg(age, 0.15, 0.95)));
      ctx.save();
      ctx.globalAlpha = smooth(seg(age, 0, 0.2));
      ctx.translate(x, y);
      const s = lerp(1, 0.8, smooth(seg(age, 0.3, 0.95)));
      ctx.scale(s, s);
      paperRect(ctx, -120, -22, 240, 44, 22, "#fbf3dc", { dx: 3, dy: 6 });
      text(ctx, p.year, -102, 7, {
        font: `700 19px ${FONT.mono}`,
        color: PALETTE.vermilion,
        tracking: 1,
      });
      text(ctx, p.name, 120 - 14, 7, {
        font: `600 15px ${FONT.mono}`,
        color: "#2a1e14",
        align: "right",
        tracking: 1,
      });
      ctx.restore();
    }
  });
}

/** The Line: a string with a bead for every piece; each landing plucks it. */
function beadLine(t) {
  return wave(150, 1790, (u, x) => {
    let y = STRIP_Y;
    for (const p of PIECES) {
      const age = t - (p.at + 0.9);
      if (age < 0 || age > 2.2) continue;
      const bx = SLOT_X(p.slot);
      const dist = Math.abs(x - bx);
      y +=
        9 *
        Math.exp(-age / 0.7) *
        Math.exp(-dist / 220) *
        Math.sin(2 * Math.PI * 3.2 * age - dist / 40);
    }
    return y;
  });
}

export default {
  bg: BG,
  ink: INK,
  lineColor: PALETTE.vermilion,
  captionAt: 2.3,
  ghostAlpha: 0.04,
  ghostY: 640,

  line: beadLine,
  lineStyle: (t) => ({ width: 5, opacity: smooth(seg(t, 1.0, 1.8)) }),

  back(ctx, t) {
    drawWindow(ctx, t);
    plugins(ctx, t);
  },

  front(ctx, t) {
    pieces(ctx, t);
    // The 1989 end of the string: the DAW itself.
    const a = smooth(seg(t, 12.2, 13.2));
    if (a > 0) {
      ctx.save();
      ctx.globalAlpha = a;
      ctx.translate(SLOT_X(7), STRIP_Y);
      paperRect(ctx, -68, -22, 136, 44, 22, PALETTE.vermilion, {
        dx: 3,
        dy: 6,
      });
      text(ctx, "1989 DAW", 0, 7, {
        font: `700 18px ${FONT.mono}`,
        color: "#fff",
        align: "center",
        tracking: 1,
      });
      ctx.restore();
    }
    // The stop: a dimming veil and the transport's stop light.
    const stop = smooth(seg(t, STOP, STOP + 0.4));
    if (stop > 0) {
      ctx.fillStyle = `rgba(10,11,18,${0.45 * stop})`;
      ctx.fillRect(WIN.x - 20, WIN.y - 10, WIN.w + 60, WIN.h + 30);
    }
  },
};
