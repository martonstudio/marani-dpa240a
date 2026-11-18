import type { ChannelDef, Field } from "../devices/types.ts";
import { clamp, display, parseValue } from "../devices/logic.ts";
import { h } from "./dom.ts";
import { tid, type Ctx } from "./ctx.ts";

/** Small label line: text, "unverified" marker (tooltip = note), note dot, warning badge. */
export function label(ctx: Ctx, ch: ChannelDef, fl: Field, text = fl.label, extra?: HTMLElement | null): HTMLElement {
  return h(
    "span",
    { class: "flabel" },
    h("span", { class: "flabel-text" }, text),
    !fl.verified ? h("span", { class: "unverified", title: "Unverified on the real unit" + (fl.note ? ": " + fl.note : "") }, "?") : null,
    fl.verified && fl.note ? h("span", { class: "note-dot", title: fl.note }, "i") : null,
    ctx.badge(ch, fl.key),
    extra ?? null,
  );
}

const PX_PER_STEP = 4;

/**
 * Drag field: drag up/down to change (one step per ~4 px, Shift = fine), wheel and arrow keys step,
 * tap/click without dragging (or Enter, or double-click) opens inline typing ("1k", "-3dB", "raw:12"),
 * Enter commits, Esc cancels. Continuous changes use latest-wins; typed values use a single set.
 * The value shown is the read-back, except while the user is dragging.
 */
export function dragField(ctx: Ctx, ch: ChannelDef, fl: Field, prefix: string, opts: { hint?: (raw: number) => string; text?: string; format?: (raw: number) => string } = {}): HTMLElement {
  const id = tid(prefix, fl.key);
  const fmt = opts.format ?? ((raw: number) => display(fl, raw));
  let current = 0;
  let pending: number | null = null;
  let held = false;
  let editing = false;
  const valueEl = h("span", { class: "df-value", testid: id + "-value" }, "--");
  const hintEl = opts.hint ? h("span", { class: "df-hint", testid: id + "-hint" }) : null;
  const el = h(
    "div",
    { class: "df", testid: id, role: "spinbutton", tabindex: 0, "aria-label": `${ch.name} ${fl.label}`, "aria-valuemin": fl.min, "aria-valuemax": fl.max, title: "Drag up/down, wheel or arrow keys to change; tap to type" },
    label(ctx, ch, fl, opts.text ?? fl.label, hintEl),
    valueEl,
  );
  const show = (raw: number) => {
    valueEl.textContent = fmt(raw);
    if (hintEl) hintEl.textContent = opts.hint!(raw);
    el.setAttribute("aria-valuenow", String(raw));
  };
  const nudge = (v: number) => {
    v = clamp(fl, v);
    if (v === (pending ?? current)) return;
    pending = v;
    show(v);
    ctx.editLatest(ch, fl.key, v);
  };
  const settle = () => setTimeout(() => {
    if (!held && pending !== null) {
      pending = null;
      show(current);
    }
  }, 1500);

  let startY = 0, startV = 0, moved = false;
  el.addEventListener("pointerdown", (e) => {
    if (editing || e.button > 0) return;
    held = true;
    moved = false;
    startY = e.clientY;
    startV = pending ?? current;
    el.setPointerCapture(e.pointerId);
    el.classList.add("dragging");
  });
  el.addEventListener("pointermove", (e) => {
    if (!held) return;
    const dy = startY - e.clientY;
    if (Math.abs(dy) > 3) moved = true;
    if (moved) nudge(startV + Math.trunc(dy / (PX_PER_STEP * (e.shiftKey ? 4 : 1))));
  });
  const up = () => {
    if (!held) return;
    held = false;
    el.classList.remove("dragging");
    if (!moved) openEdit();
    else settle();
  };
  el.addEventListener("pointerup", up);
  el.addEventListener("pointercancel", up);
  el.addEventListener("wheel", (e) => {
    if (editing || !ctx.model) return;
    e.preventDefault();
    nudge((pending ?? current) + (e.deltaY < 0 ? 1 : -1));
    settle();
  }, { passive: false });
  el.addEventListener("keydown", (e) => {
    if (editing) return;
    const d = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 10, PageDown: -10 }[e.key];
    if (d) {
      e.preventDefault();
      e.stopPropagation();
      nudge((pending ?? current) + d);
      settle();
    } else if (e.key === "Enter" || e.key === "F2") {
      e.preventDefault();
      openEdit();
    }
  });

  function openEdit() {
    if (editing || !ctx.model) return;
    editing = true;
    el.classList.add("editing");
    const input = h("input", { class: "df-input", type: "text", inputmode: "decimal", testid: id + "-input", value: fl.scale.kind === "index" ? String(pending ?? current) : display(fl, pending ?? current), "aria-label": `${ch.name} ${fl.label} value` });
    valueEl.replaceWith(input);
    let done = false;
    const close = (commit: boolean) => {
      if (done) return;
      done = true;
      editing = false;
      el.classList.remove("editing");
      const text = input.value;
      input.replaceWith(valueEl);
      el.focus();
      if (!commit) return show(pending ?? current);
      try {
        const v = parseValue(fl, text);
        if (v !== current) {
          show(v);
          void ctx.edit(ch, fl.key, v);
        } else show(current);
      } catch {
        el.classList.add("bad");
        setTimeout(() => el.classList.remove("bad"), 900);
        show(current);
      }
    };
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") (e.preventDefault(), close(true));
      else if (e.key === "Escape") (e.preventDefault(), close(false));
    });
    input.addEventListener("blur", () => close(true));
    input.addEventListener("pointerdown", (e) => e.stopPropagation());
    input.focus();
    input.select();
  }

  ctx.bind(ch, fl, (raw) => {
    current = raw;
    if (pending === raw) pending = null;
    if (!held && pending === null) show(raw);
  });
  return el;
}

/** Enum as a field box with a native select filling it. */
export function enumField(ctx: Ctx, ch: ChannelDef, fl: Field, prefix: string, opts: { bare?: boolean } = {}): HTMLElement {
  const sel = h("select", { class: "df-select", testid: tid(prefix, fl.key), "aria-label": `${ch.name} ${fl.label}` });
  const opts_ = fl.scale.kind === "enum" ? fl.scale.options : [];
  for (const o of opts_) sel.append(h("option", { value: o.raw }, o.label));
  sel.addEventListener("change", () => void ctx.edit(ch, fl.key, Number(sel.value)));
  ctx.bind(ch, fl, (raw) => {
    if (![...sel.options].some((o) => Number(o.value) === raw)) sel.append(h("option", { value: raw }, `#${raw}`));
    sel.value = String(raw);
  });
  if (opts.bare) return h("div", { class: "sel-wrap" }, sel, ctx.badge(ch, fl.key));
  return h("label", { class: "df df-enum" }, label(ctx, ch, fl), sel);
}

/** Read-only computed value in the same box style. */
export function readout(labelText: string, testid: string, marker?: HTMLElement): { el: HTMLElement; set(text: string): void } {
  const v = h("span", { class: "df-value", testid }, "--");
  const el = h("div", { class: "df df-readout" }, h("span", { class: "flabel" }, h("span", { class: "flabel-text" }, labelText), marker ?? null), v);
  return { el, set: (t) => (v.textContent = t) };
}

export function toggle(ctx: Ctx, ch: ChannelDef, fl: Field, prefix: string, cls: string): HTMLElement {
  const btn = h("button", { class: `toggle ${cls}`, testid: tid(prefix, fl.key), "aria-pressed": "false", title: fl.verified ? fl.label : `${fl.label} (unverified on the real unit)` });
  let cur = 0;
  btn.addEventListener("click", () => void ctx.edit(ch, fl.key, cur ? 0 : 1));
  ctx.bind(ch, fl, (raw, text) => {
    cur = raw;
    btn.setAttribute("aria-pressed", raw ? "true" : "false");
    btn.textContent = fl.key === "mute" ? (raw ? "MUTED" : "MUTE") : fl.key === "phase" ? `Ø ${raw ? "INV" : "0°"}` : text;
    btn.title = fl.key === "phase" ? `Phase: ${text}` : fl.label;
  });
  const badge = ctx.badge(ch, fl.key);
  badge.classList.add("corner");
  return h("div", { class: `toggle-wrap ${cls}-wrap` }, btn, badge);
}

/** Segmented buttons for a small enum (e.g. source In A / In B / A+B). */
export function segmented(ctx: Ctx, ch: ChannelDef, fl: Field, prefix: string, short?: (label: string) => string): HTMLElement {
  const id = tid(prefix, fl.key);
  const opts = fl.scale.kind === "enum" ? fl.scale.options : [];
  const btns = opts.map((o) => h("button", { class: "seg-btn", testid: `${id}-${o.raw}`, "aria-pressed": "false", title: o.label, onclick: () => void ctx.edit(ch, fl.key, o.raw) }, short ? short(o.label) : o.label));
  ctx.bind(ch, fl, (raw) => btns.forEach((b, i) => b.setAttribute("aria-pressed", String(opts[i].raw === raw))));
  return h("div", { class: "seg-field" }, label(ctx, ch, fl), h("div", { class: "seg", testid: id, role: "group", "aria-label": `${ch.name} ${fl.label}` }, ...btns));
}

/** Vertical fader with value box and a dB scale; relative drag (never jumps), arrows/PageUp/PageDown, wheel, double-click = 0 dB. */
export function vFader(ctx: Ctx, ch: ChannelDef, fl: Field, prefix: string): HTMLElement {
  const id = tid(prefix, fl.key);
  const val = h("span", { class: "vf-value", testid: id + "-value" }, "--");
  const thumb = h("div", { class: "vf-thumb" });
  const fill = h("div", { class: "vf-fill" });
  const scale = h("div", { class: "vf-scale" });
  const track = h("div", { class: "vf-track" }, fill, thumb);
  const el = h("div", { class: "vf", testid: id, role: "slider", tabindex: 0, "aria-orientation": "vertical", "aria-label": `${ch.name} ${fl.label}`, "aria-valuemin": fl.min, "aria-valuemax": fl.max, title: `${fl.label}: drag, wheel or arrow keys (Shift = fine); double-click for 0 dB` }, scale, track);
  let current = fl.min, held = false, pending: number | null = null;
  const frac = (v: number) => (v - fl.min) / (fl.max - fl.min);
  const place = (v: number) => {
    const p = frac(v) * 100;
    thumb.style.bottom = `${p}%`;
    fill.style.height = `${p}%`;
  };
  if (fl.scale.kind === "linear") {
    const s = fl.scale;
    const lo = fl.min * s.mul + s.add, hi = fl.max * s.mul + s.add;
    const stepDb = hi - lo > 30 ? 6 : 3;
    for (let db = Math.ceil(lo / stepDb) * stepDb; db <= hi + 1e-9; db += stepDb) {
      const p = frac((db - s.add) / s.mul) * 100;
      scale.append(h("span", { class: `vf-tick${db === 0 ? " zero" : ""}`, style: `bottom:${p}%` }, db > 0 ? `+${db}` : String(db)));
    }
  }
  const send = (v: number) => {
    v = clamp(fl, v);
    if (v === (pending ?? current)) return;
    pending = v;
    place(v);
    val.textContent = display(fl, v);
    ctx.editLatest(ch, fl.key, v);
  };
  const settle = () => setTimeout(() => {
    if (!held && pending !== null) {
      pending = null;
      place(current);
      val.textContent = display(fl, current);
    }
  }, 1500);
  let startY = 0, startV = 0;
  el.addEventListener("pointerdown", (e) => {
    held = true;
    el.setPointerCapture(e.pointerId);
    startY = e.clientY;
    startV = pending ?? current;
  });
  el.addEventListener("pointermove", (e) => {
    if (!held) return;
    const hgt = track.getBoundingClientRect().height || 1;
    send(startV + ((startY - e.clientY) / hgt) * (fl.max - fl.min) * (e.shiftKey ? 0.25 : 1));
  });
  const release = () => {
    if (!held) return;
    held = false;
    settle();
  };
  el.addEventListener("pointerup", release);
  el.addEventListener("pointercancel", release);
  el.addEventListener("wheel", (e) => {
    if (!ctx.model) return;
    e.preventDefault();
    send((pending ?? current) + (e.deltaY < 0 ? 1 : -1));
    settle();
  }, { passive: false });
  el.addEventListener("keydown", (e) => {
    const big = Math.max(1, Math.round((fl.max - fl.min) / 24));
    const d = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: big, PageDown: -big }[e.key];
    if (d) {
      e.preventDefault();
      e.stopPropagation();
      send((pending ?? current) + d);
      settle();
    }
  });
  el.addEventListener("dblclick", () => {
    if (fl.scale.kind === "linear") void ctx.edit(ch, fl.key, clamp(fl, -fl.scale.add / fl.scale.mul));
  });
  ctx.bind(ch, fl, (raw, text) => {
    current = raw;
    if (pending === raw) pending = null;
    el.setAttribute("aria-valuenow", String(raw));
    el.setAttribute("aria-valuetext", text);
    if (!held && pending === null) {
      place(raw);
      val.textContent = text;
    }
  });
  return h("div", { class: "vf-wrap" }, h("div", { class: "vf-head" }, label(ctx, ch, fl), val), el);
}

/** Read-only text (channel names are set on the unit, not by command). */
export function textField(ctx: Ctx, ch: ChannelDef, fl: Field, prefix: string): HTMLElement {
  const el = h("span", { class: "name-field", testid: tid(prefix, fl.key), title: `${fl.label} (read-only: set on the unit)` });
  ctx.bind(ch, fl, (_r, text) => (el.textContent = text || "—"));
  return el;
}
