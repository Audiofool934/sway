// Placeholder film for pipeline testing; replaced by the real compositor.
import { SANS, SERIF, MONO } from "./core/fonts.js";
import { DURATION, H, W } from "./timeline.js";

export function drawFilm(ctx, time) {
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, "#17203d");
  g.addColorStop(1, "#3a4a8c");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#ff5b3a";
  ctx.beginPath();
  ctx.arc(200 + (time / DURATION) * (W - 400), H / 2 + Math.sin(time * 3) * 200, 60, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#f4f1ea";
  ctx.font = `600 96px ${SERIF}`;
  ctx.fillText("Between Hand and Sound", 120, 220);
  ctx.font = `italic 400 48px ${SERIF}`;
  ctx.fillText("Pitch is a ratio.", 120, 300);
  ctx.font = `400 32px ${SANS}`;
  ctx.fillText("A singer can learn a song they have never heard.", 120, 360);
  ctx.font = `500 24px ${MONO}`;
  ctx.fillText(`c. 500 BCE · t=${time.toFixed(2)}s  ½ × – — …`, 120, 420);
}
