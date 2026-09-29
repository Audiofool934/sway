// A quiet tracking accent over the mirrored camera image. The live hand gives
// the shape and depth; thin bones and a few dots make its tracked role visible.

const FINGERS = [
  [0, 1, 2, 3, 4],
  [5, 6, 7, 8],
  [9, 10, 11, 12],
  [13, 14, 15, 16],
  [17, 18, 19, 20],
];
const BONES = [
  ...FINGERS.flatMap((finger) => finger.slice(1).map((b, i) => [finger[i], b])),
  [0, 5],
  [5, 9],
  [9, 13],
  [13, 17],
  [17, 0],
];
const MARKERS = [0, 4, 8, 12, 16, 20];
const rgba = (color, alpha) => `rgba(${color.join(",")},${alpha})`;

export class HandVisuals {
  constructor(colors) {
    this.colors = colors;
  }

  draw(ctx, scene, view) {
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const role of ["band", "lead"]) {
      const hand = scene[role].hand;
      if (hand?.landmarks?.length !== 21) continue;
      const color = this.colors[role];
      const points = hand.landmarks.map((p) => ({
        x: view.x(p.x),
        y: view.y(p.y),
      }));
      ctx.strokeStyle = rgba(color, 0.45);
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const [a, b] of BONES) {
        ctx.moveTo(points[a].x, points[a].y);
        ctx.lineTo(points[b].x, points[b].y);
      }
      ctx.stroke();
      ctx.fillStyle = rgba(color, 0.8);
      ctx.beginPath();
      for (const index of MARKERS) {
        const { x, y } = points[index];
        ctx.moveTo(x + 2, y);
        ctx.arc(x, y, 2, 0, Math.PI * 2);
      }
      ctx.fill();
    }
    ctx.restore();
  }
}
