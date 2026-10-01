// The compositor. Each chapter is a scene drawn in layers (paper, back art, the Line, front
// art) as a pure function of its own time; this file picks the chapter for a film time,
// slides the next chapter in as a sheet of paper while the Line morphs from one scene's
// shape to the next, and lays the typography over it.

import { clamp, inOutCubic, seg, smooth } from "./core/ease.js";
import { finish, mix, rgba } from "./core/draw.js";
import { drawLine, morph } from "./core/line.js";
import { drawCaption, drawGhost, drawMark, drawRibbon } from "./hud.js";
import { scenes } from "./scenes/index.js";
import { BAR, BEAT, DURATION, H, W, chapters } from "./timeline.js";

// A transition spans the boundary: PRE seconds before the next chapter's first bar line
// and POST seconds after it.
const PRE = 0.55;
const POST = 0.75;

const envFor = (chapter, T) => ({
  chapter,
  T,
  t: T - chapter.start,
  W,
  H,
  beat: (T - chapter.start) / BEAT,
  bar: (T - chapter.start) / BAR,
});

function paperLayer(ctx, index, T, { withLine = true } = {}) {
  const scene = scenes[index];
  const chapter = chapters[index];
  const env = envFor(chapter, T);
  ctx.fillStyle = scene.bg;
  ctx.fillRect(0, 0, W, H);
  drawGhost(ctx, chapter, scene, env.t);
  scene.back?.(ctx, env.t, env);
  if (withLine && scene.line)
    drawLine(ctx, scene.line(env.t, env), {
      color: scene.lineColor,
      ...scene.lineStyle?.(env.t, env),
    });
  scene.front?.(ctx, env.t, env);
}

let scratch = null;
const layerCanvas = () => {
  if (!scratch) {
    scratch = document.createElement("canvas");
    scratch.width = W;
    scratch.height = H;
  }
  return scratch;
};

const DIRECTIONS = { right: [1, 0], left: [-1, 0], up: [0, -1], down: [0, 1] };

export function drawFilm(ctx, T) {
  const index = chapters.findIndex((c) => T < c.end);
  const current = index < 0 ? chapters.length - 1 : index;
  const next = chapters[current + 1];
  const previous = chapters[current - 1];

  // The transition window around the start of the incoming chapter.
  let incoming = null;
  if (next && T > next.start - PRE) incoming = next.index;
  else if (previous && T < current_start(current) + POST) incoming = current;
  const progress =
    incoming === null
      ? 0
      : (T - (chapters[incoming].start - PRE)) / (PRE + POST);

  if (incoming === null || progress >= 1) {
    const active = incoming === null ? current : incoming;
    paperLayer(ctx, active, T);
    hud(ctx, active, T);
  } else {
    const e = inOutCubic(clamp(progress));
    const outIndex = incoming - 1;
    const inScene = scenes[incoming];
    const outScene = scenes[outIndex];
    const [dx, dy] = DIRECTIONS[inScene.from ?? "right"];

    // The outgoing sheet drifts away slowly and dims.
    ctx.save();
    ctx.translate(-dx * e * W * 0.2, -dy * e * H * 0.2);
    paperLayer(ctx, outIndex, T, { withLine: false });
    ctx.restore();
    ctx.fillStyle = `rgba(0,0,0,${0.35 * e})`;
    ctx.fillRect(0, 0, W, H);

    // The incoming sheet slides in with a hard shadow along its leading edge.
    const ox = dx * (1 - e) * W;
    const oy = dy * (1 - e) * H;
    const sheet = layerCanvas();
    const sctx = sheet.getContext("2d");
    sctx.setTransform(1, 0, 0, 1, 0, 0);
    sctx.clearRect(0, 0, W, H);
    paperLayer(sctx, incoming, T, { withLine: false });
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.45)";
    ctx.shadowBlur = 40;
    ctx.shadowOffsetX = -dx * 14;
    ctx.shadowOffsetY = -dy * 14;
    ctx.drawImage(sheet, ox, oy);
    ctx.restore();

    // The Line carries one chapter's shape into the next.
    const outLine = outScene.line?.(
      T - chapters[outIndex].start,
      envFor(chapters[outIndex], T),
    );
    const inLine = inScene.line?.(
      Math.max(0, T - chapters[incoming].start),
      envFor(chapters[incoming], T),
    );
    if (outLine && inLine) {
      const u = smooth(clamp((progress - 0.1) / 0.8));
      drawLine(ctx, morph(outLine, inLine, u), {
        color: mix(outScene.lineColor, inScene.lineColor, u),
        width: 8,
      });
    } else if (inLine)
      drawLine(ctx, inLine, {
        color: inScene.lineColor,
        ...inScene.lineStyle?.(0, {}),
      });

    hud(ctx, outIndex, T, 1 - smooth(clamp(progress / 0.45)));
    hud(ctx, incoming, T, smooth(clamp((progress - 0.5) / 0.5)));
  }

  ribbon(ctx, T);
  finish(ctx, W, H, { grainAmount: 0.1, vignette: 0.2 });
}

function current_start(index) {
  return chapters[index].start;
}

function hud(ctx, index, T, alpha = 1) {
  const chapter = chapters[index];
  const scene = scenes[index];
  drawCaption(ctx, chapter, scene, Math.max(0, T - chapter.start), alpha);
  scene.overlay?.(
    ctx,
    Math.max(0, T - chapter.start),
    envFor(chapter, T),
    alpha,
  );
}

function ribbon(ctx, T) {
  const index = Math.min(
    chapters.length - 1,
    chapters.findIndex((c) => T < c.end) < 0
      ? chapters.length - 1
      : chapters.findIndex((c) => T < c.end),
  );
  const chapter = chapters[index];
  if (!chapter.verb) return;
  const scene = scenes[index];
  const progress = index + seg(T, chapter.start, chapter.end);
  const fade =
    1 - smooth(seg(T, chapters.at(-2).end - 0.6, chapters.at(-2).end));
  drawRibbon(ctx, progress, {
    ink: scene.ink,
    accent: scene.lineColor,
    opacity: fade,
  });
  drawMark(ctx, scene.ink, fade);
}

export { DURATION, rgba };
