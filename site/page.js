// The project page's behavior: the theme toggle, the audio clips, and two small charts.
// Each chart's values are also in a table under it, so the hover layer only adds detail.

const SVG = "http://www.w3.org/2000/svg";
const PLAY = '<svg viewBox="0 0 16 16"><path d="M4 2.5v11l9.5-5.5z"/></svg>';
const PAUSE =
  '<svg viewBox="0 0 16 16"><path d="M3.5 2.5h3v11h-3zM9.5 2.5h3v11h-3z"/></svg>';

// Theme: Auto follows the system; Light and Dark are kept for the next visit.

const THEMES = ["auto", "light", "dark"];
const toggle = document.querySelector(".theme-toggle");

function storedTheme() {
  try {
    return localStorage.getItem("sway-theme") ?? "auto";
  } catch {
    return "auto";
  }
}

function applyTheme(theme) {
  if (theme === "auto") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  toggle.textContent = theme[0].toUpperCase() + theme.slice(1);
  toggle.setAttribute("aria-label", `Color theme: ${theme}`);
  try {
    if (theme === "auto") localStorage.removeItem("sway-theme");
    else localStorage.setItem("sway-theme", theme);
  } catch {}
}

applyTheme(THEMES.includes(storedTheme()) ? storedTheme() : "auto");
toggle.addEventListener("click", () => {
  const now = THEMES.indexOf(storedTheme());
  applyTheme(THEMES[(now + 1) % THEMES.length]);
});

// Clips: one plays at a time, and each loads only when it is first played.

const clock = (seconds) => {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

let playing = null;

for (const clip of document.querySelectorAll(".clip")) {
  const button = clip.querySelector(".clip-play");
  const seek = clip.querySelector(".clip-seek");
  const time = clip.querySelector(".clip-time");
  const label = clip.querySelector(".clip-label").textContent.trim();
  const words = label.replace(/\s+/g, " ");
  const total = time?.textContent;
  let audio = null;

  button.innerHTML = PLAY;
  button.setAttribute("aria-label", `Play: ${words}`);
  seek.setAttribute("aria-label", `Position: ${words}`);

  const show = () => {
    const done = audio?.duration ? audio.currentTime / audio.duration : 0;
    seek.value = Math.round(done * 1000);
    seek.style.setProperty("--done", `${done * 100}%`);
    if (time && audio?.duration) {
      time.textContent =
        audio.currentTime > 0 && !audio.ended
          ? `${clock(audio.currentTime)} / ${clock(audio.duration)}`
          : total;
    }
  };

  const setState = (on) => {
    clip.classList.toggle("playing", on);
    button.innerHTML = on ? PAUSE : PLAY;
    button.setAttribute("aria-label", `${on ? "Pause" : "Play"}: ${words}`);
  };

  const load = () => {
    if (audio) return audio;
    audio = new Audio(clip.dataset.src);
    audio.preload = "auto";
    audio.addEventListener("timeupdate", show);
    audio.addEventListener("play", () => setState(true));
    audio.addEventListener("pause", () => setState(false));
    audio.addEventListener("ended", () => {
      audio.currentTime = 0;
      show();
    });
    return audio;
  };

  button.addEventListener("click", () => {
    const a = load();
    if (!a.paused) {
      a.pause();
      return;
    }
    if (playing && playing !== a) playing.pause();
    playing = a;
    a.play().catch(() => setState(false));
  });

  seek.addEventListener("input", () => {
    const a = load();
    const go = () => {
      a.currentTime = (seek.value / 1000) * a.duration;
      show();
    };
    if (a.duration) go();
    else a.addEventListener("loadedmetadata", go, { once: true });
  });
}

// Charts: drawn at the container's own width, so their text stays readable.

const tip = document.createElement("div");
tip.className = "tip";
tip.hidden = true;

function el(name, attrs = {}, parent) {
  const node = document.createElementNS(SVG, name);
  for (const [key, value] of Object.entries(attrs))
    node.setAttribute(key, value);
  parent?.append(node);
  return node;
}

function text(parent, content, attrs) {
  const node = el("text", attrs, parent);
  node.textContent = content;
  return node;
}

// The tooltip: the value leads, the series and category follow.
function hover(root, mark, hit, rows, title) {
  const showTip = () => {
    tip.replaceChildren();
    const head = document.createElement("span");
    head.textContent = title;
    tip.append(head);
    for (const row of rows) {
      const line = document.createElement("strong");
      const key = document.createElement("i");
      key.style.background = `var(--series-${row.series})`;
      line.append(key, `${row.value}%`);
      const name = document.createElement("span");
      name.textContent = ` ${row.name}`;
      line.append(name);
      tip.append(line);
    }
    // Above the marks of this category, centred on them.
    const boxes = mark.map((m) => m.getBoundingClientRect());
    const left = Math.min(...boxes.map((b) => b.left));
    const right = Math.max(...boxes.map((b) => b.right));
    const top = Math.min(...boxes.map((b) => b.top));
    const frame = root.getBoundingClientRect();
    tip.hidden = false;
    root.append(tip);
    // Kept inside the chart, so that it never widens the page on a phone.
    const half = tip.offsetWidth / 2;
    const center = (left + right) / 2 - frame.left;
    tip.style.left = `${Math.max(half, Math.min(frame.width - half, center))}px`;
    tip.style.top = `${top - frame.top}px`;
    mark.forEach((m) => m.classList.add("on"));
  };
  const hideTip = () => {
    tip.hidden = true;
    mark.forEach((m) => m.classList.remove("on"));
  };
  // The chart's label and the table under it carry the values for keyboards and readers.
  hit.addEventListener("pointerenter", showTip);
  hit.addEventListener("pointerleave", hideTip);
}

// A bar with a 4 px rounded end and a square base.
function bar(parent, x, y, w, h, cls) {
  const r = Math.min(4, h, w / 2);
  const d = `M${x} ${y + h}V${y + r}Q${x} ${y} ${x + r} ${y}H${x + w - r}Q${x + w} ${y} ${x + w} ${y + r}V${y + h}Z`;
  return el("path", { d, class: `mark ${cls}` }, parent);
}

function columns(root, { categories, series, pick }) {
  const width = root.clientWidth;
  const height = 240;
  const m = { top: 22, right: 4, bottom: 34, left: 36 };
  const plotW = width - m.left - m.right;
  const plotH = height - m.top - m.bottom;
  const svg = el("svg", {
    viewBox: `0 0 ${width} ${height}`,
    height,
    "aria-hidden": "true",
  });
  const y = (v) => m.top + plotH * (1 - v / 100);

  for (const v of [0, 25, 50, 75, 100]) {
    el(
      "line",
      {
        x1: m.left,
        x2: width - m.right,
        y1: y(v),
        y2: y(v),
        class: v ? "grid" : "base",
      },
      svg,
    );
    text(svg, `${v}%`, {
      x: m.left - 8,
      y: y(v) + 4,
      "text-anchor": "end",
      class: "tick",
    });
  }

  const band = plotW / categories.length;
  const barW = Math.min(24, (band * 0.6) / series.length);
  const gap = 2;
  categories.forEach((name, i) => {
    const center = m.left + band * (i + 0.5);
    const groupW = series.length * barW + (series.length - 1) * gap;
    const marks = series.map((s, j) => {
      const x = center - groupW / 2 + j * (barW + gap);
      const v = s.values[i];
      const mark = bar(svg, x, y(v), barW, y(0) - y(v), `s${j + 1}`);
      if (i === pick) {
        text(svg, `${v}%`, {
          x: x + barW / 2,
          y: y(v) - 6,
          "text-anchor": "middle",
          class: "val",
        });
      }
      return mark;
    });
    text(svg, name, {
      x: center,
      y: height - 12,
      "text-anchor": "middle",
      class: i === pick ? "cat pick" : "cat",
    });
    const hit = el(
      "rect",
      {
        x: center - band / 2,
        y: m.top,
        width: band,
        height: plotH,
        class: "hit",
      },
      svg,
    );
    svg.append(hit);
    hover(
      root,
      marks,
      hit,
      series.map((s, j) => ({
        series: j + 1,
        name: s.name,
        value: s.values[i],
      })),
      name,
    );
  });
  root.replaceChildren(svg);
}

function dumbbell(root, { rows, series }) {
  const width = root.clientWidth;
  const rowH = 34;
  const m = { top: 8, right: 16, bottom: 30, left: 70 };
  const height = m.top + rows.length * rowH + m.bottom;
  const plotW = width - m.left - m.right;
  const svg = el("svg", {
    viewBox: `0 0 ${width} ${height}`,
    height,
    "aria-hidden": "true",
  });
  const x = (v) => m.left + (plotW * v) / 100;
  const bottom = m.top + rows.length * rowH;

  for (const v of [0, 25, 50, 75, 100]) {
    el(
      "line",
      { x1: x(v), x2: x(v), y1: m.top, y2: bottom, class: v ? "grid" : "base" },
      svg,
    );
    text(svg, `${v}%`, {
      x: x(v),
      y: height - 10,
      "text-anchor": "middle",
      class: "tick",
    });
  }

  rows.forEach((row, i) => {
    const cy = m.top + rowH * (i + 0.5);
    const [a, b] = series.map((s) => s.values[i]);
    text(svg, row, {
      x: m.left - 12,
      y: cy + 4,
      "text-anchor": "end",
      class: "cat",
    });
    el("line", { x1: x(b), x2: x(a), y1: cy, y2: cy, class: "link" }, svg);
    const marks = series.map((s, j) =>
      el(
        "circle",
        { cx: x(s.values[i]), cy, r: 5, class: `mark dot s${j + 1}` },
        svg,
      ),
    );
    if (i === 0) {
      text(svg, `${a}%`, { x: x(a) + 10, y: cy + 4, class: "val" });
      // Above its dot, where it cannot meet the axis on a narrow screen.
      text(svg, `${b}%`, {
        x: x(b),
        y: cy - 10,
        "text-anchor": "middle",
        class: "val",
      });
    }
    const hit = el(
      "rect",
      { x: m.left, y: cy - rowH / 2, width: plotW, height: rowH, class: "hit" },
      svg,
    );
    hover(
      root,
      marks,
      hit,
      series.map((s, j) => ({
        series: j + 1,
        name: s.name,
        value: s.values[i],
      })),
      row,
    );
  });
  root.replaceChildren(svg);
}

const charts = [
  [
    document.getElementById("chart-ahead"),
    (root) =>
      columns(root, {
        categories: ["On the bar line", "0.8 s", "1.2 s", "1.6 s"],
        series: [
          { name: "early in the bar", values: [26, 48, 60, 82] },
          { name: "late in the bar", values: [55, 74, 98, 48] },
        ],
        pick: 2,
      }),
  ],
  [
    document.getElementById("chart-theme"),
    (root) =>
      dumbbell(root, {
        rows: [
          "Seed 100",
          "Seed 101",
          "Seed 102",
          "Seed 103",
          "Seed 104",
          "Seed 105",
        ],
        series: [
          { name: "with the theme", values: [90, 89, 88, 82, 86, 81] },
          { name: "without it", values: [12, 21, 12, 22, 18, 27] },
        ],
      }),
  ],
];

for (const [root, draw] of charts) {
  if (!root) continue;
  let width = 0;
  new ResizeObserver(() => {
    if (root.clientWidth === width) return;
    width = root.clientWidth;
    draw(root);
  }).observe(root);
}
