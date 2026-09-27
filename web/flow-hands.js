const roles = {
  intensity: { side: "Left", coordinate: "y", scale: 2 },
  morph: { side: "Right", coordinate: "x", scale: 2.5 },
};

// MediaPipe receives unmirrored video; these roles match the mirrored preview.
// Each hand picks up the current musical value where it enters the frame.
export class FlowHands {
  constructor() {
    this.references = {};
    this.lastSeen = {};
    this.visible = {};
    this.manual = new Set();
  }
  recenter(axes = Object.keys(roles)) {
    for (const axis of axes) delete this.references[axis];
  }
  hold(axis, active) {
    if (active) this.manual.add(axis);
    else this.manual.delete(axis);
    this.recenter([axis]);
  }
  update(hands, values, now) {
    const controls = {};
    for (const [axis, role] of Object.entries(roles)) {
      const hand = hands.find(
        (h) =>
          h.side === role.side &&
          Number.isFinite(h.points?.[0]?.[role.coordinate]),
      );
      const wasVisible = this.visible[axis];
      this.visible[axis] = Boolean(hand);
      if (!hand) continue;
      const position = hand.points[0][role.coordinate];
      if (
        !this.references[axis] ||
        (!wasVisible && now - (this.lastSeen[axis] ?? -Infinity) > 350) ||
        this.manual.has(axis)
      )
        this.references[axis] = { position, value: values[axis] };
      this.lastSeen[axis] = now;
      if (this.manual.has(axis)) continue;
      const reference = this.references[axis];
      controls[axis] = Math.max(
        0,
        Math.min(
          1,
          reference.value + (reference.position - position) * role.scale,
        ),
      );
    }
    return controls;
  }
}
