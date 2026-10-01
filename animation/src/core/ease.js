// Easing and sequencing helpers. Scenes are pure functions of time, so animation is
// written as "how far along is this move": ease.outCubic(seg(t, 1.0, 1.8)).

export const clamp = (x, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const unlerp = (a, b, x) => (b === a ? 0 : (x - a) / (b - a));

/** Progress (0 to 1) of the stretch of time from `a` to `b`. */
export const seg = (t, a, b) => clamp((t - a) / (b - a));

export const linear = (t) => t;
export const smooth = (t) => t * t * (3 - 2 * t);
export const inQuad = (t) => t * t;
export const outQuad = (t) => 1 - (1 - t) * (1 - t);
export const inOutQuad = (t) =>
  t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
export const inCubic = (t) => t * t * t;
export const outCubic = (t) => 1 - (1 - t) ** 3;
export const inOutCubic = (t) =>
  t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
export const outQuart = (t) => 1 - (1 - t) ** 4;
export const outExpo = (t) => (t >= 1 ? 1 : 1 - 2 ** (-10 * t));
export const inOutSine = (t) => -(Math.cos(Math.PI * t) - 1) / 2;
export const outBack = (t, s = 1.70158) =>
  1 + (s + 1) * (t - 1) ** 3 + s * (t - 1) ** 2;
export const outElastic = (t) => {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return 2 ** (-10 * t) * Math.sin(((t * 10 - 0.75) * (2 * Math.PI)) / 3) + 1;
};

/** A bump that rises and falls over [a, b], peaking at the middle. */
export const bump = (t, a, b) => Math.sin(Math.PI * seg(t, a, b));

/** 1 on [a, b], easing in over `fadeIn` before it and out over `fadeOut` after. */
export const window = (t, a, b, fadeIn = 0.3, fadeOut = 0.3) =>
  smooth(clamp((t - a) / fadeIn)) * (1 - smooth(clamp((t - b) / fadeOut)));

/** Linear map of x from [a, b] to [c, d], optionally eased and clamped. */
export const map = (x, a, b, c, d, ease = linear) =>
  lerp(c, d, ease(seg(x, a, b)));

/** Staggered progress for item `i` of a group: each starts `gap` later and takes `dur`. */
export const stagger = (t, i, start, gap, dur) =>
  seg(t, start + i * gap, start + i * gap + dur);

/** A damped spring displacement, for settling after a pop: starts at 1, rings, decays to 0. */
export const settle = (t, rate = 9, damp = 5) =>
  t < 0 ? 1 : Math.exp(-damp * t) * Math.cos(rate * t);
