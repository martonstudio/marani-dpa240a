import type { ChannelDef, Field } from "../devices/types.ts";
import { fromPhysical, physical, readField } from "../devices/logic.ts";
import { clear, h, s } from "./dom.ts";
import type { Ctx } from "./ctx.ts";
import { eqShape, passDb, peakingDb, resolveEq, responseDb } from "./eq.ts";

const F_MIN = 20, F_MAX = 20000, DB = 15;
const M = { l: 34, r: 10, t: 10, b: 20 };
export const BAND_COLORS = ["#ff6b6b", "#ffa94d", "#ffd43b", "#69db7c", "#38d9a9", "#4dabf7", "#b197fc", "#f783ac"];
export const XOVER_COLOR = "#9aa7b8";

/** Which band (group key: "peq3", "hpf", "lpf") is selected in a channel view; shared by graph and table. */
export class BandSel {
  private cbs: ((g: string | null) => void)[] = [];
  value: string | null = null;
  set(g: string | null) {
    this.value = g;
    for (const c of this.cbs) c(g);
  }
  on(cb: (g: string | null) => void) {
    this.cbs.push(cb);
  }
}

interface HandleDef {
  group: string;
  label: string;
  color: string;
  freq: Field;
  gain?: Field; // absent for HPF/LPF (drag moves frequency only)
}

/**
 * Response graph: combined curve, each PEQ band as its own translucent filled area, HPF/LPF skirts, numbered handles.
 * Handles sitting on the same spot are fanned out so each can be grabbed. Tap selects, drag moves (relative, no jump).
 * Everything drawn at rest comes from the read-back image.
 */
export function eqGraph(ctx: Ctx, ch: ChannelDef, sel: BandSel): HTMLElement {
  const shape = eqShape(ch);
  const handles: HandleDef[] = shape.bands.map((b, i) => ({ group: b.group, label: String(i + 1), color: BAND_COLORS[i % BAND_COLORS.length], freq: b.freqField, gain: b.gainField }));
  if (shape.hpf) handles.unshift({ group: "hpf", label: "H", color: XOVER_COLOR, freq: shape.hpf.freq });
  if (shape.lpf) handles.push({ group: "lpf", label: "L", color: XOVER_COLOR, freq: shape.lpf.freq });
  const svg = s("svg", { class: "eq-svg", testid: `eq-${ch.id}`, role: "img", "aria-label": `${ch.name} response` });
  const el = h(
    "div",
    { class: "eq-graph" },
    svg,
    h("div", { class: "eq-note", title: "Filter shapes and the bandwidth scale are approximations (BW index -> 0.05*(idx-3) oct; BS drawn as Butterworth); the unit's exact curves are not measured." }, "approximate"),
  );
  let W = 800, H = 300;
  const drag = new Map<string, { f: number; g: number; until: number }>();

  const pw = () => W - M.l - M.r, ph = () => H - M.t - M.b;
  const xOf = (f: number) => M.l + (Math.log10(f / F_MIN) / Math.log10(F_MAX / F_MIN)) * pw();
  const fOf = (x: number) => F_MIN * Math.pow(F_MAX / F_MIN, (x - M.l) / pw());
  const yOf = (db: number) => M.t + ((DB - Math.max(-DB - 4, Math.min(DB + 4, db))) / (2 * DB)) * ph();
  const dbOf = (y: number) => DB - ((y - M.t) / ph()) * 2 * DB;
  const N = 200;
  const freqs = Array.from({ length: N + 1 }, (_, i) => F_MIN * Math.pow(F_MAX / F_MIN, i / N));
  const path = (fn: (f: number) => number) => freqs.map((f) => `${xOf(f).toFixed(1)},${yOf(fn(f)).toFixed(1)}`).join(" ");
  const area = (fn: (f: number) => number) => `${xOf(F_MIN)},${yOf(0)} ${path(fn)} ${xOf(F_MAX)},${yOf(0)}`;

  /** Field values, or the pending drag position. */
  const valuesOf = (hd: HandleDef, mem: Uint8Array) => {
    const d = drag.get(hd.group);
    return { f: d ? d.f : readField(ctx.dev, mem, hd.freq), g: d ? d.g : hd.gain ? readField(ctx.dev, mem, hd.gain) : fromPhysical(hd.freq, 0) };
  };

  function draw() {
    const mem = ctx.model?.mem;
    clear(svg);
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("width", String(W));
    svg.setAttribute("height", String(H));
    const clipId = `clip-${ch.id}`;
    svg.append(s("defs", {}, s("clipPath", { id: clipId }, s("rect", { x: M.l, y: M.t, width: pw(), height: ph() }))));
    const grid = s("g", { class: "eq-grid" });
    for (const f of [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000]) {
      const x = xOf(f);
      grid.append(s("line", { x1: x, x2: x, y1: M.t, y2: M.t + ph() }));
      grid.append(s("text", { x: Math.min(Math.max(x, M.l + 8), W - M.r - 10), y: H - 5, "text-anchor": "middle" }, f >= 1000 ? `${f / 1000}k` : String(f)));
    }
    for (let db = -DB; db <= DB; db += 5) {
      const y = yOf(db);
      grid.append(s("line", { x1: M.l, x2: M.l + pw(), y1: y, y2: y, class: db === 0 ? "zero" : "" }));
      grid.append(s("text", { x: M.l - 5, y: y + 4, "text-anchor": "end" }, db > 0 ? `+${db}` : String(db)));
    }
    svg.append(grid);
    if (!mem) return;
    const eq = resolveEq(ctx.dev, mem, shape);
    const g = s("g", { "clip-path": `url(#${clipId})` });
    const selected = sel.value;
    // crossover skirts
    for (const [k, p] of [["hpf", eq.hpf], ["lpf", eq.lpf]] as const)
      if (p && p.slope.family !== "off")
        g.append(s("polygon", { points: area((f) => passDb(f, p.fc, p.slope, k)), class: `eq-skirt${selected === k ? " sel" : ""}` }));
    // each PEQ band as its own translucent area
    eq.bands.forEach((b, i) => {
      if (b.gain === 0) return;
      const col = BAND_COLORS[i % BAND_COLORS.length];
      const isSel = selected === shape.bands[i].group;
      g.append(s("polygon", { points: area((f) => peakingDb(f, b.f0, b.gain, b.bwOct)), fill: col, "fill-opacity": isSel ? 0.32 : 0.16, stroke: col, "stroke-opacity": isSel ? 0.9 : 0.45, "stroke-width": isSel ? 1.5 : 1 }));
    });
    g.append(s("polyline", { points: path((f) => responseDb(eq, f)), class: "eq-curve", testid: `eq-${ch.id}-curve` }));
    svg.append(g);

    // handles: true positions, then fan out the ones that sit on the same spot
    const pts = handles.map((hd) => {
      const v = valuesOf(hd, mem);
      return { hd, x: xOf(physical(hd.freq, v.f)), y: hd.gain ? yOf(physical(hd.gain, v.g)) : yOf(0), dx: 0 };
    });
    const groups: (typeof pts)[] = [];
    for (const p of pts) {
      const grp = groups.find((gr) => Math.abs(gr[0].x - p.x) < 16 && Math.abs(gr[0].y - p.y) < 16);
      if (grp) grp.push(p);
      else groups.push([p]);
    }
    for (const grp of groups) if (grp.length > 1) grp.forEach((p, k) => (p.dx = (k - (grp.length - 1) / 2) * 22));
    const order = [...pts].sort((a, b) => Number(a.hd.group === selected) - Number(b.hd.group === selected));
    for (const p of order) {
      const hd = p.hd;
      const isSel = hd.group === selected;
      const node = s(
        "g",
        { class: `eq-handle${isSel ? " sel" : ""}${hd.gain ? "" : " xover"}`, transform: `translate(${(p.x + p.dx).toFixed(1)},${p.y.toFixed(1)})`, testid: `eq-handle-${ch.id}-${hd.group}`, "data-band": hd.group },
        p.dx ? s("line", { x1: 0, y1: 0, x2: -p.dx, y2: 0, class: "eq-leader" }) : null,
        s("circle", { r: 18, class: "hit" }),
        s("circle", { r: isSel ? 12 : 10, class: "dot", fill: isSel ? hd.color : "#141920", stroke: hd.color }),
        s("text", { y: 4, "text-anchor": "middle", fill: isSel ? "#10141a" : hd.color }, hd.label),
      );
      node.addEventListener("pointerdown", (e) => startDrag(e as PointerEvent, hd));
      svg.append(node);
    }
  }

  function startDrag(e: PointerEvent, hd: HandleDef) {
    e.preventDefault();
    e.stopPropagation();
    sel.set(hd.group);
    const mem = ctx.model?.mem;
    if (!mem) return;
    svg.setPointerCapture(e.pointerId);
    const r0 = svg.getBoundingClientRect();
    const sx = (W / r0.width), sy = (H / r0.height);
    const v0 = valuesOf(hd, mem);
    const x0 = xOf(physical(hd.freq, v0.f)), y0 = hd.gain ? yOf(physical(hd.gain, v0.g)) : yOf(0);
    const px0 = e.clientX, py0 = e.clientY;
    let moved = false;
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      const dx = (ev.clientX - px0) * sx, dy = (ev.clientY - py0) * sy;
      if (!moved && Math.hypot(dx, dy) < 4) return;
      moved = true;
      const f = fromPhysical(hd.freq, Math.max(F_MIN, Math.min(F_MAX * 1.03, fOf(x0 + dx))));
      const gv = hd.gain ? fromPhysical(hd.gain, Math.max(-DB, Math.min(DB, dbOf(y0 + dy)))) : v0.g;
      const prev = drag.get(hd.group);
      if (prev && prev.f === f && prev.g === gv) return;
      drag.set(hd.group, { f, g: gv, until: Infinity });
      ctx.editLatest(ch, hd.freq.key, f);
      if (hd.gain) ctx.editLatest(ch, hd.gain.key, gv);
      draw();
    };
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      svg.removeEventListener("pointermove", move);
      svg.removeEventListener("pointerup", up);
      svg.removeEventListener("pointercancel", up);
      const d = drag.get(hd.group);
      if (!d) return;
      d.until = Date.now() + 1500;
      setTimeout(() => {
        if (drag.get(hd.group)?.until !== Infinity) drag.delete(hd.group);
        draw();
      }, 1500);
    };
    svg.addEventListener("pointermove", move);
    svg.addEventListener("pointerup", up);
    svg.addEventListener("pointercancel", up);
  }

  ctx.onMem((mem) => {
    for (const hd of handles) {
      const d = drag.get(hd.group);
      if (d && d.until !== Infinity && readField(ctx.dev, mem, hd.freq) === d.f && (!hd.gain || readField(ctx.dev, mem, hd.gain) === d.g)) drag.delete(hd.group);
    }
    if (el.offsetParent !== null) draw();
  });
  sel.on(() => draw());
  new ResizeObserver(() => {
    const r = el.getBoundingClientRect();
    if (r.width < 10 || r.height < 10) return;
    W = Math.round(r.width);
    H = Math.round(r.height);
    draw();
  }).observe(el);
  draw();
  return el;
}
