import type { ChannelDef, Field } from "../devices/types.ts";
import { clamp, display, parseValue } from "../devices/logic.ts";
import { h } from "./dom.ts";
import { tid, type Ctx } from "./ctx.ts";

/** Field label with "unverified" marker (tooltip = note) and the warning badge. */
export function label(ctx: Ctx, ch: ChannelDef, fl: Field, text = fl.label, extra?: string): HTMLElement {
  return h(
    "span",
    { class: "flabel" },
    text,
    extra ? h("small", { class: "units" }, extra) : null,
    !fl.verified ? h("span", { class: "unverified", title: "unverified on the real unit" + (fl.note ? ": " + fl.note : "") }, "unverified") : null,
    fl.verified && fl.note ? h("span", { class: "note-dot", title: fl.note }, "i") : null,
    ctx.badge(ch, fl.key),
  );
}

/** [-] value [+]; the text accepts "1k", "-3dB", "raw:12"; stepping uses latest-wins. */
export function valueBox(ctx: Ctx, ch: ChannelDef, fl: Field, prefix: string, opts: { unitsNote?: string; steppers?: boolean; hint?: (raw: number) => string } = {}): HTMLElement {
  const id = tid(prefix, fl.key);
  let current = 0;
  let pending: number | null = null;
  const input = h("input", { type: "text", class: "vb-input", inputmode: "decimal", testid: id, "aria-label": `${ch.name} ${fl.label}` });
  const step = (d: number) => {
    const base = pending ?? current;
    const v = clamp(fl, base + d);
    if (v === base) return;
    pending = v;
    input.value = display(fl, v);
    ctx.editLatest(ch, fl.key, v);
  };
  const commit = () => {
    try {
      const v = parseValue(fl, input.value);
      if (v !== current) void ctx.edit(ch, fl.key, v);
      else input.value = display(fl, current);
    } catch {
      input.classList.add("bad");
      setTimeout(() => input.classList.remove("bad"), 800);
      input.value = display(fl, current);
    }
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
    else if (e.key === "ArrowUp") (e.preventDefault(), step(1));
    else if (e.key === "ArrowDown") (e.preventDefault(), step(-1));
  });
  input.addEventListener("change", commit);
  const hintEl = opts.hint ? h("small", { class: "hint", testid: id + "-hint" }) : null;
  ctx.bind(ch, fl, (raw, text) => {
    current = raw;
    pending = null;
    if (document.activeElement !== input) input.value = text;
    if (hintEl) hintEl.textContent = opts.hint!(raw);
  });
  return h(
    "div",
    { class: "field" },
    h("div", { class: "flabel-row" }, label(ctx, ch, fl, fl.label, opts.unitsNote), hintEl),
    opts.steppers === false
      ? h("div", { class: "vb compact" }, input)
      : h(
          "div",
          { class: "vb" },
          h("button", { class: "vb-step", testid: id + "-dec", "aria-label": "decrease", onclick: () => step(-1) }, "\u2212"),
          input,
          h("button", { class: "vb-step", testid: id + "-inc", "aria-label": "increase", onclick: () => step(1) }, "+"),
        ),
  );
}

export function enumSelect(ctx: Ctx, ch: ChannelDef, fl: Field, prefix: string): HTMLElement {
  const sel = h("select", { testid: tid(prefix, fl.key), "aria-label": `${ch.name} ${fl.label}` });
  const opts = fl.scale.kind === "enum" ? fl.scale.options : [];
  for (const o of opts) sel.append(h("option", { value: o.raw }, o.label));
  sel.addEventListener("change", () => void ctx.edit(ch, fl.key, Number(sel.value)));
  ctx.bind(ch, fl, (raw) => {
    if (![...sel.options].some((o) => Number(o.value) === raw)) sel.append(h("option", { value: raw }, `#${raw}`));
    sel.value = String(raw);
  });
  return h("label", { class: "field" }, label(ctx, ch, fl), sel);
}

export function toggle(ctx: Ctx, ch: ChannelDef, fl: Field, prefix: string, cls: string): HTMLElement {
  const btn = h("button", { class: `toggle ${cls}`, testid: tid(prefix, fl.key), "aria-pressed": "false" });
  let cur = 0;
  btn.addEventListener("click", () => void ctx.edit(ch, fl.key, cur ? 0 : 1));
  ctx.bind(ch, fl, (raw, text) => {
    cur = raw;
    btn.setAttribute("aria-pressed", raw ? "true" : "false");
    btn.textContent = fl.key === "mute" ? (raw ? "MUTED" : "MUTE") : fl.key === "phase" ? `\u00d8 ${text}` : text;
  });
  return h("div", { class: "field toggle-wrap" }, btn, fl.verified ? ctx.badge(ch, fl.key) : label(ctx, ch, fl, ""));
}

/** Vertical fader (custom: pointer + keyboard). Thumb follows the read-back except while held. */
export function fader(ctx: Ctx, ch: ChannelDef, fl: Field, prefix: string): HTMLElement {
  const id = tid(prefix, fl.key);
  const readout = h("div", { class: "fader-readout", testid: id + "-value" }, "--");
  const thumb = h("div", { class: "fader-thumb" });
  const fill = h("div", { class: "fader-fill" });
  const zeroLine = h("div", { class: "fader-zero" });
  const track = h("div", { class: "fader-track" }, fill, zeroLine, thumb);
  const el = h("div", { class: "fader", testid: id, role: "slider", tabindex: 0, "aria-label": `${ch.name} ${fl.label}`, "aria-valuemin": fl.min, "aria-valuemax": fl.max }, track);
  let current = fl.min;
  let held = false;
  let pending: number | null = null;
  const frac = (v: number) => (v - fl.min) / (fl.max - fl.min);
  const place = (v: number) => {
    const p = frac(v) * 100;
    thumb.style.bottom = `calc(${p}% - 14px)`;
    fill.style.height = `${p}%`;
  };
  // 0 dB reference line if the scale crosses 0
  if (fl.scale.kind === "linear") {
    const z = (0 - fl.scale.add) / fl.scale.mul;
    if (z > fl.min && z < fl.max) zeroLine.style.bottom = `${frac(z) * 100}%`;
    else zeroLine.hidden = true;
  }
  const send = (v: number) => {
    v = clamp(fl, v);
    if (v === (pending ?? current)) return;
    pending = v;
    place(v);
    ctx.editLatest(ch, fl.key, v);
  };
  // relative drag: grabbing the fader never jumps the value; Shift = fine (1/4 speed)
  let startY = 0, startV = 0;
  el.addEventListener("pointerdown", (e) => {
    held = true;
    el.setPointerCapture(e.pointerId);
    startY = e.clientY;
    startV = pending ?? current;
  });
  el.addEventListener("pointermove", (e) => {
    if (!held) return;
    const h = track.getBoundingClientRect().height || 1;
    send(startV + ((startY - e.clientY) / h) * (fl.max - fl.min) * (e.shiftKey ? 0.25 : 1));
  });
  const release = () => {
    held = false;
    if (pending === null) place(current);
    // give the last value time to come back from the unit, then show whatever it holds
    else setTimeout(() => ((pending = null), !held && place(current)), 1500);
  };
  el.addEventListener("pointerup", release);
  el.addEventListener("pointercancel", release);
  el.addEventListener("keydown", (e) => {
    const big = Math.max(1, Math.round((fl.max - fl.min) / 24));
    const d = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: big, PageDown: -big }[e.key];
    if (d) {
      e.preventDefault();
      send((pending ?? current) + d);
    }
  });
  el.addEventListener("dblclick", () => {
    if (fl.scale.kind === "linear") void ctx.edit(ch, fl.key, clamp(fl, -fl.scale.add / fl.scale.mul)); // to 0
  });
  ctx.bind(ch, fl, (raw, text) => {
    current = raw;
    if (pending === raw) pending = null;
    readout.textContent = text;
    el.setAttribute("aria-valuenow", String(raw));
    el.setAttribute("aria-valuetext", text);
    if (!held && pending === null) place(raw);
  });
  return h("div", { class: "fader-wrap" }, h("div", { class: "fader-head" }, label(ctx, ch, fl)), readout, el);
}

/** Read-only text (channel names are set on the unit, not by command). */
export function textField(ctx: Ctx, ch: ChannelDef, fl: Field, prefix: string): HTMLElement {
  const el = h("span", { class: "name-field", testid: tid(prefix, fl.key), title: `${fl.label} (read-only: set on the unit)` });
  ctx.bind(ch, fl, (_r, text) => (el.textContent = text || "\u2014"));
  return el;
}
