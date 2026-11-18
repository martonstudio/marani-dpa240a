import type { ChannelDef } from "../devices/types.ts";
import { fromPhysical, physical, readField } from "../devices/logic.ts";
import { clear, h, s } from "./dom.ts";
import type { Ctx } from "./ctx.ts";
import { eqShape, peakingDb, resolveEq, responseDb } from "./eq.ts";

const F_MIN = 20, F_MAX = 20000, DB = 15;
const M = { l: 40, r: 12, t: 12, b: 24 };

/**
 * SVG EQ graph for one channel: combined response (PEQ bells + HPF/LPF), draggable band handles
 * (x = frequency, y = gain; wheel = bandwidth). The curve and the handles at rest come from the read-back image.
 */
export function eqGraph(ctx: Ctx, ch: ChannelDef, onPick: (group: string) => void): { el: HTMLElement; select(group: string | null): void } {
  const shape = eqShape(ch);
  const svg = s("svg", { class: "eq-svg", testid: `eq-${ch.id}`, role: "img", "aria-label": `${ch.name} EQ response` });
  const el = h("div", { class: "eq-graph" }, svg, h("div", { class: "eq-note", title: "Filter shapes and the bandwidth scale are approximations (BW index -> 0.05*(idx-3) oct); the unit's exact curves are not measured." }, "approximate"));
  let W = 800, H = 300;
  let selected: string | null = null;
  const drag = new Map<string, { idxF: number; idxG: number; until: number }>(); // pending positions while dragging

  const pw = () => W - M.l - M.r, ph = () => H - M.t - M.b;
  const xOf = (f: number) => M.l + (Math.log10(f / F_MIN) / Math.log10(F_MAX / F_MIN)) * pw();
  const fOf = (x: number) => F_MIN * Math.pow(F_MAX / F_MIN, (x - M.l) / pw());
  const yOf = (db: number) => M.t + ((DB - Math.max(-DB - 3, Math.min(DB + 3, db))) / (2 * DB)) * ph();
  const dbOf = (y: number) => DB - ((y - M.t) / ph()) * 2 * DB;

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
      grid.append(s("text", { x, y: H - 6, "text-anchor": "middle" }, f >= 1000 ? `${f / 1000}k` : String(f)));
    }
    for (let db = -DB; db <= DB; db += 5) {
      const y = yOf(db);
      grid.append(s("line", { x1: M.l, x2: M.l + pw(), y1: y, y2: y, class: db === 0 ? "zero" : "" }));
      grid.append(s("text", { x: M.l - 6, y: y + 4, "text-anchor": "end" }, db > 0 ? `+${db}` : String(db)));
    }
    svg.append(grid);
    if (!mem) return;
    const eq = resolveEq(ctx.dev, mem, shape);
    const N = 240;
    const pts: string[] = [];
    for (let i = 0; i <= N; i++) {
      const f = F_MIN * Math.pow(F_MAX / F_MIN, i / N);
      pts.push(`${xOf(f).toFixed(1)},${yOf(responseDb(eq, f)).toFixed(1)}`);
    }
    const g = s("g", { "clip-path": `url(#${clipId})` });
    // selected band's own curve
    const si = shape.bands.findIndex((b) => b.group === selected);
    if (si >= 0) {
      const b = eq.bands[si];
      const bp: string[] = [];
      for (let i = 0; i <= N; i++) {
        const f = F_MIN * Math.pow(F_MAX / F_MIN, i / N);
        bp.push(`${xOf(f).toFixed(1)},${yOf(peakingDb(f, b.f0, b.gain, b.bwOct)).toFixed(1)}`);
      }
      g.append(s("polyline", { points: bp.join(" "), class: "eq-band-curve" }));
    }
    g.append(s("polygon", { points: `${M.l},${yOf(0)} ${pts.join(" ")} ${M.l + pw()},${yOf(0)}`, class: "eq-fill" }));
    g.append(s("polyline", { points: pts.join(" "), class: "eq-curve", testid: `eq-${ch.id}-curve` }));
    for (const [k, p] of [["HPF", eq.hpf], ["LPF", eq.lpf]] as const)
      if (p && p.slope.family !== "off") {
        const x = xOf(p.fc);
        g.append(s("line", { x1: x, x2: x, y1: M.t, y2: M.t + ph(), class: "eq-xover" }));
        g.append(s("text", { x: x + (k === "HPF" ? 4 : -4), y: M.t + 12, class: "eq-xover-label", "text-anchor": k === "HPF" ? "start" : "end" }, k + (p.slope.unknown ? " (shape unknown)" : "")));
      }
    svg.append(g);
    // handles: band 1 on top when they overlap (all flat bands sit on one spot), the selected band above all
    const order = shape.bands.map((b, i) => [b, i] as const).reverse();
    order.sort((a, b) => Number(a[0].group === selected) - Number(b[0].group === selected));
    order.forEach(([b, i]) => {
      const pend = drag.get(b.group);
      const fi = pend ? pend.idxF : readField(ctx.dev, mem, b.freqField);
      const gi = pend ? pend.idxG : readField(ctx.dev, mem, b.gainField);
      const x = xOf(physical(b.freqField, fi)), y = yOf(physical(b.gainField, gi));
      const hnd = s(
        "g",
        { class: `eq-handle${b.group === selected ? " sel" : ""}${gi !== fromPhysical(b.gainField, 0) ? " active" : ""}`, transform: `translate(${x},${y})`, testid: `eq-handle-${ch.id}-${b.group}`, "data-band": b.group },
        s("circle", { r: 22, class: "hit" }),
        s("circle", { r: 11, class: "dot" }),
        s("text", { y: 4, "text-anchor": "middle" }, String(i + 1)),
      );
      hnd.addEventListener("pointerdown", (e) => startDrag(e as PointerEvent, b));
      hnd.addEventListener("wheel", (e) => {
        e.preventDefault();
        const cur = readField(ctx.dev, mem, b.bwField);
        ctx.editLatest(ch, b.bwField.key, Math.max(b.bwField.min, Math.min(b.bwField.max, cur + ((e as WheelEvent).deltaY > 0 ? 1 : -1))));
      });
      svg.append(hnd);
    });
  }

  function startDrag(e: PointerEvent, b: (typeof shape.bands)[number]) {
    e.preventDefault();
    selected = b.group;
    onPick(b.group);
    // capture on the svg: draw() replaces the handle elements, the svg stays
    svg.setPointerCapture(e.pointerId);
    const toLocal = (ev: PointerEvent) => {
      const r = svg.getBoundingClientRect();
      return { x: ((ev.clientX - r.left) / r.width) * W, y: ((ev.clientY - r.top) / r.height) * H };
    };
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      const p = toLocal(ev);
      const idxF = fromPhysical(b.freqField, Math.max(F_MIN, Math.min(F_MAX * 1.03, fOf(p.x))));
      const idxG = fromPhysical(b.gainField, Math.max(-DB, Math.min(DB, dbOf(p.y))));
      const prev = drag.get(b.group);
      if (prev && prev.idxF === idxF && prev.idxG === idxG) return;
      drag.set(b.group, { idxF, idxG, until: Infinity });
      ctx.editLatest(ch, b.freqField.key, idxF);
      ctx.editLatest(ch, b.gainField.key, idxG);
      draw();
    };
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      svg.removeEventListener("pointermove", move);
      svg.removeEventListener("pointerup", up);
      svg.removeEventListener("pointercancel", up);
      const d = drag.get(b.group);
      if (d) d.until = Date.now() + 1500;
      setTimeout(() => {
        if (drag.get(b.group)?.until !== Infinity) drag.delete(b.group);
        draw();
      }, 1500);
    };
    svg.addEventListener("pointermove", move);
    svg.addEventListener("pointerup", up);
    svg.addEventListener("pointercancel", up);
    draw();
  }

  ctx.onMem(() => {
    // read-back arrived: a pending drag position is dropped once the unit holds it
    const mem = ctx.model?.mem;
    if (mem)
      for (const b of shape.bands) {
        const d = drag.get(b.group);
        if (d && d.until !== Infinity && readField(ctx.dev, mem, b.freqField) === d.idxF && readField(ctx.dev, mem, b.gainField) === d.idxG) drag.delete(b.group);
      }
    draw();
  });
  new ResizeObserver(() => {
    const r = el.getBoundingClientRect();
    if (r.width < 10) return;
    W = Math.round(r.width);
    H = Math.max(200, Math.min(340, Math.round(W * 0.32)));
    draw();
  }).observe(el);
  draw();
  return {
    el,
    select(g) {
      selected = g;
      draw();
    },
  };
}
