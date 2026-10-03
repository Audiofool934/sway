// Optional listening controls for comparing the band's parts. Press M during free play
// to open them; closing the panel restores the full mix and releases the stand-in voices.

import { PALETTES } from "./harmony.js";

const DRUMS = [
  "kick",
  "snare",
  "clap",
  "hat",
  "openhat",
  "shaker",
  "crash",
  "riser",
];

export const GROUPS = [
  {
    kind: "generated",
    title: "Generated",
    note: "MRT2 performs the cycle's chords and answer line",
    parts: [{ id: "harmony", name: "MRT2 harmony", buses: ["harmony"] }],
  },
  {
    kind: "standin",
    title: "Synth stand-ins",
    note: "play MRT2's bars when it is muted or late",
    parts: [
      { id: "pad", name: "Pad", buses: ["pad"] },
      { id: "answer", name: "Answer line", buses: ["answer"] },
    ],
  },
  {
    kind: "band",
    title: "Synth band",
    note: "fixed patterns on the chords",
    parts: [
      { id: "keys", name: "Keys", buses: ["keys"] },
      { id: "arp", name: "Arpeggio", buses: ["arp"] },
      { id: "bass", name: "Bass", buses: ["bass"] },
      { id: "drums", name: "Drums", buses: DRUMS },
    ],
  },
  {
    kind: "you",
    title: "You",
    parts: [
      { id: "lead", name: "Lead", buses: ["lead"] },
      { id: "loops", name: "Loops", buses: ["loop"] },
    ],
  },
];

export const PARTS = GROUPS.flatMap((group) => group.parts);

export const PRESETS = [
  { id: "everything", name: "All", parts: PARTS.map((part) => part.id) },
  { id: "mrt2", name: "MRT2 alone", parts: ["harmony", "lead"] },
  { id: "qwen", name: "Qwen's notes", parts: ["pad", "answer", "lead"] },
];

/** Mutes and restores the synth's buses; muting MRT2 brings in its stand-ins. */
export class Mixer {
  constructor(synth) {
    this.synth = synth;
    this.on = new Set(PRESETS[0].parts);
  }

  has(id) {
    return this.on.has(id);
  }

  set(id, on) {
    if (on) this.on.add(id);
    else this.on.delete(id);
    this.#apply();
  }

  preset(id) {
    this.on = new Set(PRESETS.find((preset) => preset.id === id).parts);
    this.#apply();
  }

  /** The preset the switches match, if any. */
  get current() {
    const match = PRESETS.find(
      (preset) =>
        preset.parts.length === this.on.size &&
        preset.parts.every((id) => this.on.has(id)),
    );
    return match?.id ?? null;
  }

  #apply() {
    const { synth } = this;
    const now = synth.ctx.currentTime;
    const fade = (param, value) => {
      param.cancelScheduledValues(now);
      param.setTargetAtTime(value, now, 0.02);
    };
    for (const part of PARTS)
      for (const name of part.buses)
        fade(
          synth.buses[name].gain,
          this.on.has(part.id) ? synth.levels[name] : 0,
        );
    // With MRT2 muted, the pad and answering line play the bars MRT2 was playing.
    for (const node of Object.values(synth.shadows))
      fade(node.gain, this.on.has("harmony") ? 0 : 1);
    synth.ducking = this.on.has("drums");
    if (!synth.ducking) fade(synth.duck.gain, 1);
  }
}

function make(tag, className = "", text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(className, text, onclick) {
  const node = make("button", className, text);
  node.type = "button";
  node.onclick = onclick;
  return node;
}

export class ListeningPanel {
  constructor(root, { mixer, onComposing, onActive, onChange = () => {} }) {
    this.root = root;
    this.mixer = mixer;
    this.onComposing = onComposing;
    this.onActive = onActive;
    this.onChange = onChange;
    this.composing = true;
    this.shown = false;
    this.active = false;
    this.key = "";
    this.#build();
    this.#sync();
  }

  toggle() {
    this.shown = !this.shown;
  }

  /** A new piece and every lesson start with the complete band. */
  reset() {
    this.shown = false;
    this.#activate(false);
    this.root.hidden = true;
  }

  #activate(on) {
    if (this.active === on) return;
    this.active = on;
    this.onActive(on);
    if (!on) {
      this.mixer.preset("everything");
      if (!this.composing) {
        this.composing = true;
        this.onComposing(true);
      }
      this.#sync();
    }
  }

  #build() {
    const head = make("header");
    head.append(make("h2", "", "Mixer"), make("span", "", "M hides"));
    const presets = make("div", "presets");
    this.presets = PRESETS.map((preset) => {
      const node = button("preset", preset.name, () => {
        this.mixer.preset(preset.id);
        this.#sync();
      });
      node.dataset.preset = preset.id;
      presets.append(node);
      return node;
    });
    this.parts = [];
    const heading = (title, note) => {
      const node = make("h3", "", title);
      if (note) node.append(make("span", "", note));
      return node;
    };
    const groups = GROUPS.map((group) => {
      const section = make("section", `group ${group.kind}`);
      section.append(heading(group.title, group.note));
      const row = make("div", "parts");
      for (const part of group.parts) {
        const node = button("part", part.name, () => {
          this.mixer.set(part.id, !this.mixer.has(part.id));
          this.#sync();
        });
        node.dataset.part = part.id;
        row.append(node);
        this.parts.push(node);
      }
      section.append(row);
      return section;
    });
    const composer = make("section", "group composer");
    composer.append(
      heading("Composer", "off: built-in chords from the next open cycle"),
    );
    this.qwen = button("part", "Qwen composes", () => {
      this.composing = !this.composing;
      this.onComposing(this.composing);
      this.#sync();
    });
    const row = make("div", "parts");
    row.append(this.qwen);
    composer.append(row);
    const readout = make("dl");
    this.rows = {};
    for (const [key, label] of [
      ["now", "Harmony now"],
      ["cycle", "This cycle"],
      ["next", "Next cycle"],
    ]) {
      this.rows[key] = make("dd");
      readout.append(make("dt", "", label), this.rows[key]);
    }
    this.root.replaceChildren(head, readout, presets, ...groups, composer);
  }

  #sync() {
    for (const node of this.parts)
      node.setAttribute("aria-pressed", this.mixer.has(node.dataset.part));
    const current = this.mixer.current;
    for (const node of this.presets)
      node.classList.toggle("current", node.dataset.preset === current);
    this.qwen.setAttribute("aria-pressed", this.composing);
    this.key = ""; // The readout depends on the switches too.
    this.onChange({ parts: [...this.mixer.on], composing: this.composing });
  }

  /** Called every frame; touches the page only when what it shows changes. */
  render({ visible, engine, harmony, composer, bar, side }) {
    this.root.hidden = !(visible && this.shown && engine);
    this.#activate(!this.root.hidden);
    if (this.root.hidden) return;
    const { cycleBars } = engine.world;
    const cycle = Math.floor(bar / cycleBars);
    const plan = engine.plans.get(cycle);
    const next = engine.plans.get(cycle + 1);
    const now = this.#harmonyNow(harmony);
    const view = {
      side,
      now,
      sounding: now.startsWith("MRT2"),
      cycle: plan && this.#describe(plan),
      at: bar % cycleBars,
      next: next
        ? this.#describe(next)
        : this.#pending(engine, composer, cycle + 1),
      qwen: Boolean(composer),
    };
    const key = JSON.stringify(view);
    if (key === this.key) return;
    this.key = key;
    this.root.dataset.side = side;
    this.qwen.disabled = !composer;
    this.qwen.title = composer
      ? ""
      : "Qwen is off for this piece: choose Composed by Qwen before starting.";
    this.parts
      .find((node) => node.dataset.part === "harmony")
      .classList.toggle("sounding", view.sounding);
    this.rows.now.textContent = now;
    this.#plan(this.rows.cycle, view.cycle, view.at);
    if (typeof view.next === "string") this.rows.next.textContent = view.next;
    else this.#plan(this.rows.next, view.next, null);
  }

  #harmonyNow(harmony) {
    if (!harmony) return "Synth pad: generated harmony is off for this piece";
    if (harmony.state === "failed")
      return `Synth pad: MRT2 stopped (${harmony.error})`;
    if (harmony.last === null) return "Starting";
    const pad = this.mixer.has("pad");
    if (harmony.last === "fallback")
      return pad
        ? "Synth pad, until MRT2's next bar is ready"
        : "Silent until MRT2's next bar is ready";
    if (!this.mixer.has("harmony"))
      return pad ? "Synth pad, in place of MRT2" : "Muted";
    return `MRT2 ${PALETTES[harmony.palette].toLowerCase()}`;
  }

  #describe(plan) {
    const notes = plan.answer.length;
    return {
      by: plan.composed ? "Qwen" : "Built-in",
      chords: plan.names,
      detail: `${plan.texture} · ${notes ? `${notes}-note answer` : "no answer line"}`,
    };
  }

  #pending(engine, composer, cycle) {
    if (!composer) return "Built-in: Qwen is off for this piece";
    if (!engine.composing) return "Built-in: Qwen is switched off";
    if (composer.state !== "ready")
      return `Built-in: Qwen stopped (${composer.error})`;
    if (composer.requests.has(cycle)) return "Qwen is writing it";
    if (composer.plans.has(cycle)) return "Qwen's plan has arrived";
    return "Waiting to ask Qwen";
  }

  #plan(row, plan, at) {
    if (!plan) {
      row.textContent = "-";
      return;
    }
    const by = make("span", `by ${plan.by === "Qwen" ? "qwen" : ""}`, plan.by);
    const chords = make("span", "chords");
    plan.chords.forEach((name, i) => {
      if (i) chords.append(" ");
      chords.append(i === at ? make("b", "", name) : name);
    });
    row.replaceChildren(by, " ", chords, make("span", "detail", plan.detail));
  }
}
