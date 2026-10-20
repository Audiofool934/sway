// The conductor's gestures as small looping animations (docs/v2-design.md), so that a
// player can see how to move rather than read it. The guide opens over the stage at any
// time, and the music keeps playing while it is open.
const INK = [214, 233, 220];
const DIM = [113, 133, 123]; // The outline of a hand that only keeps time.
const BODY = [27, 39, 36];
const ACCENT = "#b9dccb";
const FAINT = "rgba(185, 220, 203, 0.22)";
const RADIANS = Math.PI / 180;
const rgba = ([r, g, b], alpha = 1) => `rgba(${r}, ${g}, ${b}, ${alpha})`;
const ease = (x) => x * x * (3 - 2 * x);
const clamp = (x, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));
const mix = (a, b, t) => a + (b - a) * t;
const cycle = (t, period) => ((t % period) + period) % period;

// 1 from `on` to `off` seconds into each `period`, else 0, with eased ramps after each.
function hold(t, period, on, off, ramp = 0.4) {
  const into = cycle(t, period);
  return (
    ease(clamp((into - on) / ramp)) * (1 - ease(clamp((into - off) / ramp)))
  );
}

// A hand held up to the screen, seen from behind as the player sees their own: the right
// hand's thumb is on the left. Units are hand heights from the palm's centre, y down.
const PALM = new Path2D(
  "M -0.23 -0.17 Q 0 -0.25 0.23 -0.12 C 0.27 -0.02 0.24 0.16 0.17 0.24 " +
    "Q 0.01 0.3 -0.15 0.25 C -0.24 0.18 -0.27 0 -0.23 -0.17 Z",
);
const WRIST = new Path2D("M -0.15 0.2 L 0.15 0.2 L 0.14 0.5 L -0.14 0.5 Z");
const FINGERS = [
  { base: [-0.2, 0.04], width: 0.115, lengths: [0.2, 0.16] }, // Thumb.
  { base: [-0.165, -0.15], width: 0.1, lengths: [0.21, 0.12, 0.1] },
  { base: [-0.055, -0.175], width: 0.104, lengths: [0.23, 0.135, 0.105] },
  { base: [0.06, -0.16], width: 0.097, lengths: [0.215, 0.125, 0.1] },
  { base: [0.165, -0.115], width: 0.085, lengths: [0.165, 0.1, 0.085] },
];
// Poses give each segment's angle, in degrees from straight up toward the little finger.
const OPEN = [
  [-56, -40],
  [-12, -10, -8],
  [-2, -1, 0],
  [8, 9, 10],
  [18, 20, 22],
];
const PINCH = [
  null, // The thumb reaches the index fingertip; see below.
  [-30, -95, -160],
  [-4, -3, -2],
  [5, 6, 7],
  [14, 16, 18],
];
// In a fist the fingers fold away from the player: only the knuckles show.
const FIST = [
  [-20, 35],
  [-6, -6, -6],
  [-1, -1, -1],
  [5, 5, 5],
  [12, 12, 12],
];
const FOLDED = [[0.85, 0.6], ...Array(4).fill([0.32, 0, 0])];

function joints([x, y], angles, lengths) {
  const points = [[x, y]];
  angles.forEach((angle, i) => {
    x += Math.sin(angle * RADIANS) * lengths[i];
    y -= Math.cos(angle * RADIANS) * lengths[i];
    points.push([x, y]);
  });
  return points;
}

// The thumb's angles that put its tip on `target`, its joint bent away from the palm.
function reach(target) {
  const {
    base,
    lengths: [a, b],
  } = FINGERS[0];
  const [dx, dy] = [target[0] - base[0], target[1] - base[1]];
  const d = clamp(Math.hypot(dx, dy), Math.abs(a - b), a + b);
  const first =
    Math.atan2(dx, -dy) -
    Math.acos(clamp((a * a + d * d - b * b) / (2 * a * d), -1));
  const joint = [base[0] + Math.sin(first) * a, base[1] - Math.cos(first) * a];
  const second = Math.atan2(target[0] - joint[0], joint[1] - target[1]);
  return [first / RADIANS, second / RADIANS];
}
PINCH[0] = reach(joints(FINGERS[1].base, PINCH[1], FINGERS[1].lengths).at(-1));

function stroke(ctx, points) {
  ctx.beginPath();
  ctx.moveTo(...points[0]);
  for (const point of points.slice(1)) ctx.lineTo(...point);
  ctx.stroke();
}

/**
 * Draw a hand `size` pixels tall with its palm's centre at (x, y). `pinch` brings the
 * thumb and index fingertips together, `fist` folds the fingers, `left` mirrors it for the
 * left hand, and `faint` draws a hand that only keeps time.
 */
function drawHand(
  ctx,
  x,
  y,
  size,
  { pinch = 0, fist = 0, left = false, faint = false } = {},
) {
  const fingers = FINGERS.map(({ base, width, lengths }, i) => {
    const angles = lengths.map((_, j) =>
      mix(mix(OPEN[i][j], PINCH[i][j], pinch), FIST[i][j], fist),
    );
    const shown = lengths.map(
      (length, j) => length * mix(1, FOLDED[i][j], fist),
    );
    return { width, points: joints(base, angles, shown) };
  });
  const line = 1.5 / size;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(left ? -size : size, size);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  // Every part first a little wider in ink, then in the hand's colour, so that only the
  // outside edge shows. The wrist fades out below the palm.
  for (const [colour, extra] of [
    [faint ? DIM : INK, 2 * line],
    [BODY, 0],
  ]) {
    const fade = ctx.createLinearGradient(0, 0.3, 0, 0.5);
    fade.addColorStop(0, rgba(colour));
    fade.addColorStop(1, rgba(colour, 0));
    if (extra) {
      ctx.strokeStyle = fade;
      ctx.lineWidth = extra;
      for (const side of [-1, 1])
        stroke(ctx, [
          [side * 0.15, 0.2],
          [side * 0.14, 0.5],
        ]);
    } else {
      ctx.fillStyle = fade;
      ctx.fill(WRIST);
    }
    ctx.fillStyle = ctx.strokeStyle = rgba(colour);
    ctx.fill(PALM);
    if (extra) {
      ctx.lineWidth = extra;
      ctx.stroke(PALM);
    }
    for (const { width, points } of fingers) {
      ctx.lineWidth = width + extra;
      stroke(ctx, points);
    }
  }
  // Where the thumb meets the index finger, a ring marks the pinch.
  const closed = clamp((pinch * (1 - fist) - 0.8) / 0.2);
  if (closed > 0) {
    const [a, b] = [fingers[0].points.at(-1), fingers[1].points.at(-1)];
    ctx.globalAlpha = closed;
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = line;
    ctx.beginPath();
    ctx.arc((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0.09, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

// The path a hand took over the last `seconds`, fading behind it.
function trail(ctx, at, t, seconds = 0.6, steps = 24) {
  ctx.save();
  ctx.strokeStyle = ACCENT;
  ctx.lineWidth = 2; // Butt ends, so that the pieces do not overlap into dots.
  let previous = at(t - seconds);
  for (let i = 1; i <= steps; i++) {
    const point = at(t - seconds * (1 - i / steps));
    ctx.globalAlpha = 0.55 * (i / steps) ** 1.5;
    stroke(ctx, [previous, point]);
    previous = point;
  }
  ctx.restore();
}

const orbit = (cx, cy, rx, ry, phase) => [
  cx + Math.cos(phase) * rx,
  cy + Math.sin(phase) * ry,
];

function label(
  ctx,
  text,
  x,
  y,
  { alpha = 1, color = rgba(INK), size = 11 } = {},
) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.font = `${size}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
  ctx.textAlign = "center";
  ctx.fillText(text, x, y);
  ctx.restore();
}

function meter(ctx, x, y, height, value) {
  ctx.fillStyle = FAINT;
  ctx.beginPath();
  ctx.roundRect(x - 2, y, 4, height, 2);
  ctx.fill();
  ctx.fillStyle = ACCENT;
  ctx.beginPath();
  ctx.roundRect(x - 2, y + height * (1 - value), 4, height * value, 2);
  ctx.fill();
}

// A few notes, as on a piano roll: long lines that nearly touch, or short notes.
function notes(ctx, x, y, width, height, short) {
  const rows = [0.75, 0.35, 0.55, 0.15];
  ctx.fillStyle = FAINT;
  ctx.fillRect(x, y + height + 8, width, 1);
  ctx.fillStyle = ACCENT;
  rows.forEach((row, i) => {
    ctx.beginPath();
    ctx.roundRect(
      x + (i / rows.length) * width,
      y + row * height,
      mix(0.23, 0.05, short) * width,
      5,
      2.5,
    );
    ctx.fill();
  });
}

// Each scene draws one gesture at time `t`, in seconds, in a box `w` by `h`. With reduced
// motion it holds its `pose`, the moment that shows the gesture best.
const SCENES = [
  {
    title: "Louder or softer",
    caption:
      "Bigger motion with your right hand plays louder; smaller, softer.",
    pose: 4,
    draw(ctx, w, h, t) {
      // Small circles, then big ones.
      const big = (time) => hold(time, 6, 2.4, 4.8, 0.6);
      const at = (time) => {
        const radius = mix(0.06, 0.2, big(time)) * h;
        return orbit(w * 0.4, h * 0.56, radius * 1.4, radius, time * 4.2);
      };
      trail(ctx, at, t);
      drawHand(ctx, ...at(t), h * 0.4);
      meter(ctx, w * 0.86, h * 0.18, h * 0.6, mix(0.15, 1, big(t)));
      label(ctx, big(t) > 0.5 ? "loud" : "soft", w * 0.86, h * 0.92);
    },
  },
  {
    title: "Calm or driving",
    caption:
      "Faster motion drives the orchestra harder; slower motion calms it.",
    pose: 4.5,
    draw(ctx, w, h, t) {
      // Slow circles, then fast ones; the hand keeps its place when the speed changes.
      const slow = 1.6,
        quick = 7.5;
      const phase = (time) => {
        const turns = Math.floor(time / 6),
          into = time - turns * 6;
        return (
          turns * 3 * (slow + quick) +
          (into < 3 ? into * slow : 3 * slow + (into - 3) * quick)
        );
      };
      const at = (time) =>
        orbit(w * 0.4, h * 0.56, h * 0.2, h * 0.14, phase(time));
      trail(ctx, at, t, 0.5);
      drawHand(ctx, ...at(t), h * 0.4);
      const fast = cycle(t, 6) >= 3;
      meter(ctx, w * 0.86, h * 0.18, h * 0.6, fast ? 1 : 0.25);
      label(ctx, fast ? "driving" : "calm", w * 0.86, h * 0.92);
    },
  },
  {
    title: "Bring a voice forward",
    caption:
      "Point your left hand toward a voice, and raise it to bring that voice forward.",
    pose: 2.1,
    draw(ctx, w, h, t, voices) {
      // The left hand visits each voice: it arrives low, rises, and lowers again. The
      // right hand keeps conducting on its own side.
      const places = [0.13, 0.4, 0.67];
      const step = cycle(t, 9) / 3;
      const at = Math.floor(step),
        into = step - at;
      const travel = ease(clamp(into / 0.35));
      const raised =
        ease(clamp((into - 0.4) / 0.3)) *
        (1 - ease(clamp((into - 0.85) / 0.15)));
      voices.forEach((name, index) => {
        const lit = index === at ? raised : 0;
        label(ctx, name, places[index] * w, h * 0.14, {
          alpha: 0.35 + 0.65 * lit,
          color: lit > 0.5 ? ACCENT : rgba(INK),
        });
      });
      drawHand(
        ctx,
        ...orbit(w * 0.88, h * 0.62, h * 0.04, h * 0.03, t * 4.2),
        h * 0.3,
        { faint: true },
      );
      const x = mix(places[(at + 2) % 3], places[at], travel) * w;
      drawHand(ctx, x, mix(h * 0.78, h * 0.47, raised), h * 0.34, {
        left: true,
      });
    },
  },
  {
    title: "Long or short notes",
    caption:
      "An open palm plays long lines; a pinch of thumb and index, short notes.",
    pose: 3,
    draw(ctx, w, h, t) {
      const pinch = hold(t, 5, 1.6, 3.8);
      drawHand(ctx, w * 0.33, h * 0.62, h * 0.52, { pinch });
      notes(ctx, w * 0.6, h * 0.24, w * 0.32, h * 0.42, pinch);
      label(
        ctx,
        pinch > 0.5 ? "short notes" : "long lines",
        w * 0.76,
        h * 0.92,
      );
    },
  },
  {
    title: "Hush",
    caption:
      "Make a fist, or hold still, and the music hushes to a quiet chord.",
    pose: 3.2,
    draw(ctx, w, h, t) {
      // Conduct, close a fist, open it and conduct again, then hold still.
      const fist = hold(t, 9, 2, 4.2, 0.35);
      const moving = (time) =>
        hold(time, 9, 0, 1.8, 0.3) + hold(time, 9, 4.6, 6, 0.3);
      const at = (time) => {
        const swing = moving(time) * h;
        return orbit(w * 0.4, h * 0.58, swing * 0.14, swing * 0.1, time * 4.2);
      };
      trail(ctx, at, t, 0.5);
      drawHand(ctx, ...at(t), h * 0.42, { fist });
      // Stillness hushes after 0.65 s, as in conductor-controls.js.
      const hushed =
        fist > 0.5 ? "a fist" : cycle(t, 9) > 6.95 ? "held still" : null;
      meter(ctx, w * 0.86, h * 0.18, h * 0.6, hushed ? 0.15 : 0.8);
      label(ctx, hushed ? "hushed" : "playing", w * 0.86, h * 0.92);
      if (hushed) label(ctx, hushed, w * 0.4, h * 0.94, { color: ACCENT });
    },
  },
  {
    title: "Move on",
    caption:
      "Raise both hands and hold them up, then bring them down: the next section lands on the beat.",
    pose: 2.3,
    draw(ctx, w, h, t) {
      // Rest, rise, hold, drop, land.
      const into = cycle(t, 4.5);
      let lift = 0;
      if (into < 1) lift = 0;
      else if (into < 1.8) lift = ease((into - 1) / 0.8);
      else if (into < 2.8) lift = 1;
      else if (into < 3.1) lift = 1 - ease((into - 2.8) / 0.3);
      const y = mix(h * 0.74, h * 0.4, lift);
      drawHand(ctx, w * 0.33, y, h * 0.32, { left: true });
      drawHand(ctx, w * 0.67, y, h * 0.32);
      if (into >= 1.8 && into < 2.8) label(ctx, "Ready…", w * 0.5, h * 0.12);
      if (into >= 3.1 && into < 3.9)
        label(ctx, "on the beat", w * 0.5, h * 0.12, { color: ACCENT });
    },
  },
];

export class GestureGuide {
  constructor(root, { onToggle } = {}) {
    this.root = root;
    this.onToggle = onToggle;
    this.voices = ["Left voice", "Middle voice", "Right voice"];
    this.still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.frame = null;
    this.close = root.querySelector(".gesture-head button");
    this.close.onclick = () => this.hide();
    const grid = root.querySelector(".gesture-grid");
    this.cards = SCENES.map((scene) => {
      const card = document.createElement("figure");
      card.className = "gesture-card";
      const canvas = document.createElement("canvas");
      canvas.setAttribute("aria-hidden", "true");
      const caption = document.createElement("figcaption");
      const title = document.createElement("b");
      title.textContent = scene.title;
      const words = document.createElement("span");
      words.textContent = scene.caption;
      caption.append(title, words);
      card.append(canvas, caption);
      grid.append(card);
      return { scene, canvas };
    });
    // A held pose is drawn once, so it is drawn again when the cards change size.
    new ResizeObserver(() => {
      if (this.still && this.open) this.#draw(0);
    }).observe(grid);
  }

  get open() {
    return !this.root.hidden;
  }

  /** The world's three voices, left to right, for the voice card. */
  setVoices(voices) {
    if (voices?.length !== 3 || voices.join() === this.voices.join()) return;
    this.voices = voices;
    if (this.still && this.open) this.#draw(0);
  }

  show() {
    if (this.open) return;
    this.returnTo = document.activeElement;
    this.root.hidden = false;
    this.close.focus({ preventScroll: true });
    this.onToggle?.(true);
    const start = performance.now();
    const tick = (now) => {
      this.#draw((now - start) / 1000);
      if (!this.still) this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  hide() {
    if (!this.open) return;
    const inside = this.root.contains(document.activeElement);
    this.root.hidden = true;
    cancelAnimationFrame(this.frame);
    if (inside) this.returnTo?.focus?.({ preventScroll: true });
    this.onToggle?.(false);
  }

  toggle() {
    if (this.open) this.hide();
    else this.show();
  }

  #draw(t) {
    for (const { scene, canvas } of this.cards) {
      const ratio = Math.min(devicePixelRatio, 2);
      const w = canvas.clientWidth,
        h = canvas.clientHeight;
      if (!w || !h) continue;
      if (canvas.width !== Math.round(w * ratio)) {
        canvas.width = Math.round(w * ratio);
        canvas.height = Math.round(h * ratio);
      }
      const ctx = canvas.getContext("2d");
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, w, h);
      scene.draw(ctx, w, h, this.still ? scene.pose : t, this.voices);
    }
  }
}
