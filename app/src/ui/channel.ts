import type { ChannelDef, Field } from "../devices/types.ts";
import { display, fromPhysical, physical, readField } from "../devices/logic.ts";
import { h } from "./dom.ts";
import type { Ctx } from "./ctx.ts";
import { dragField, enumField, readout, segmented, toggle, vFader } from "./controls.ts";
import { BandSel, BAND_COLORS, XOVER_COLOR, eqGraph } from "./eqgraph.ts";
import { bwOctaves, eqShape } from "./eq.ts";

const SIDE_TITLES: Record<string, string> = { limiter: "Limiter", delay: "Delay" };

/** BW: measured points as the unit labels them, otherwise the approximate octave value. */
function bwFormat(fl: Field) {
  return (raw: number) => {
    const known = fl.scale.kind === "index" ? fl.scale.known[raw] : undefined;
    return known ? `${known} oct` : `≈${bwOctaves(raw).toFixed(2)} oct`;
  };
}

/**
 * One channel's view, built from the definition: `side` = strip (mute, phase, source, gain fader, delay, limiter and
 * any other non-filter group), `center` = title, response graph and the filter table (HPF | PEQ 1..n | LPF).
 */
export function channelView(ctx: Ctx, ch: ChannelDef): { side: HTMLElement; center: HTMLElement } {
  const S = `strip-${ch.id}`, D = `detail-${ch.id}`;
  const by = (k: string) => ch.fields.find((x) => x.key === k);
  const settable = (fl: Field | undefined): fl is Field => !!fl && !fl.readOnly && ch.commands.some((c) => c.sets.includes(fl.key));
  const shape = eqShape(ch);
  const sel = new BandSel();

  // ---- side strip
  const side: (HTMLElement | null)[] = [];
  const mute = by("mute"), phase = by("phase"), source = by("source"), gain = by("gain");
  side.push(h("div", { class: "side-row mute-row" }, settable(mute) ? toggle(ctx, ch, mute, S, "mute") : null, settable(phase) ? toggle(ctx, ch, phase, S, "phase") : null));
  if (settable(source)) side.push(segmented(ctx, ch, source, S, (l) => l.replace(/^In\s+A\+B$/, "A+B")));
  if (settable(gain)) side.push(vFader(ctx, ch, gain, S));
  for (const fl of ch.fields)
    if (fl.group === "main" && settable(fl) && !["mute", "phase", "source", "gain"].includes(fl.key))
      side.push(h("div", { class: "side-block" }, fl.scale.kind === "enum" ? enumField(ctx, ch, fl, D) : dragField(ctx, ch, fl, D)));

  const filterGroups = new Set(["main", "xover", ...shape.bands.map((b) => b.group)]);
  const groups = [...new Set(ch.fields.map((f) => f.group))].filter((g) => !filterGroups.has(g));
  // delay first (every channel has it), then limiter, then anything else
  groups.sort((a, b) => (a === "delay" ? -1 : b === "delay" ? 1 : 0));
  for (const g of groups) {
    const fields = ch.fields.filter((f) => f.group === g && settable(f));
    if (!fields.length) continue;
    const cells: HTMLElement[] = fields.map((fl) => (fl.scale.kind === "enum" ? enumField(ctx, ch, fl, D) : dragField(ctx, ch, fl, D, { text: fl.label.replace(/^Delay\s*/i, "") })));
    let titleExtra: HTMLElement | null = null;
    if (g === "delay") {
      // total = sum in the physical unit; the ms scale is derived, not panel-confirmed
      const derived = h("span", { class: "derived", title: "ms scale derived from clamp limits and one panel reading; not yet confirmed on the panel" }, "derived");
      const tot = readout("Total", `${D}-delay-total`);
      const unit = fields[0].scale.kind === "linear" ? fields[0].scale.unit : "";
      ctx.onMem((mem) => tot.set(`${fields.reduce((a, fl) => a + physical(fl, readField(ctx.dev, mem, fl)), 0).toFixed(3)} ${unit}`));
      cells.push(tot.el);
      titleExtra = derived;
    }
    side.push(h("div", { class: "side-block", testid: `${D}-${g}` }, h("div", { class: "block-title" }, SIDE_TITLES[g] ?? g, titleExtra), h("div", { class: `cells cells-${cells.length}` }, ...cells)));
  }

  // ---- centre: title, graph, filter table
  const nameF = ch.fields.find((x) => x.scale.kind === "text");
  const subName = h("span", { class: "ch-sub" });
  if (nameF) ctx.bind(ch, nameF, (_r, t) => (subName.textContent = t));
  const selInfo = h("span", { class: "sel-info", testid: `${D}-selected` });
  const flatBtn = h("button", { class: "btn small", testid: `${D}-flat`, hidden: true, title: "Set the selected band's gain to 0 dB" }, "Flat");
  flatBtn.addEventListener("click", () => {
    const b = shape.bands.find((x) => x.group === sel.value);
    if (b) void ctx.edit(ch, b.gainField.key, fromPhysical(b.gainField, 0));
  });

  type Col = { group: string; head: string; color: string; cells: (HTMLElement | null)[] };
  const cols: Col[] = [];
  const cell = (fl: Field | undefined, fmt?: (raw: number) => string) => (fl ? (fl.scale.kind === "enum" ? enumField(ctx, ch, fl, D) : dragField(ctx, ch, fl, D, { text: "", format: fmt })) : null);
  if (shape.hpf) cols.push({ group: "hpf", head: "HPF", color: XOVER_COLOR, cells: [cell(shape.hpf.freq), cell(shape.hpf.slope), null] });
  shape.bands.forEach((b, i) => cols.push({ group: b.group, head: String(i + 1), color: BAND_COLORS[i % BAND_COLORS.length], cells: [cell(b.freqField), cell(b.bwField, bwFormat(b.bwField)), cell(b.gainField)] }));
  if (shape.lpf) cols.push({ group: "lpf", head: "LPF", color: XOVER_COLOR, cells: [cell(shape.lpf.freq), cell(shape.lpf.slope), null] });

  const table = h("div", { class: "ftable", style: `--ncols:${cols.length}`, testid: `${D}-table` });
  const hasX = !!(shape.hpf || shape.lpf);
  table.append(h("div", { class: "rowlabel corner" }), ...cols.map((c) => h("button", { class: "col-head", testid: `band-${ch.id}-${c.group}`, "data-group": c.group, style: `--c:${c.color}`, onclick: () => sel.set(c.group) }, h("span", { class: "swatch" }), c.head)));
  const rowNames = ["Freq", hasX ? "BW / Slope" : "BW", "Gain"];
  rowNames.forEach((rn, r) => {
    table.append(h("div", { class: "rowlabel" }, rn));
    for (const c of cols) {
      const x = c.cells[r];
      const wrap = h("div", { class: "tcell", "data-group": c.group }, x ?? h("span", { class: "empty-cell" }, "—"));
      wrap.addEventListener("pointerdown", () => sel.value !== c.group && sel.set(c.group), true);
      wrap.addEventListener("focusin", () => sel.value !== c.group && sel.set(c.group));
      table.append(wrap);
    }
  });

  const describe = () => {
    const g = sel.value;
    const mem = ctx.model?.mem;
    const b = shape.bands.find((x) => x.group === g);
    flatBtn.hidden = !b;
    for (const n of table.querySelectorAll<HTMLElement>("[data-group]")) n.classList.toggle("sel", n.dataset.group === g);
    if (!g || !mem) return void (selInfo.textContent = "");
    if (b) {
      const i = shape.bands.indexOf(b) + 1;
      selInfo.textContent = `Band ${i}: ${display(b.freqField, readField(ctx.dev, mem, b.freqField))}, ${bwFormat(b.bwField)(readField(ctx.dev, mem, b.bwField))}, ${display(b.gainField, readField(ctx.dev, mem, b.gainField))}`;
    } else {
      const x = g === "hpf" ? shape.hpf : shape.lpf;
      if (x) selInfo.textContent = `${g.toUpperCase()}: ${display(x.freq, readField(ctx.dev, mem, x.freq))}, ${display(x.slope, readField(ctx.dev, mem, x.slope))}`;
    }
  };
  sel.on(describe);
  ctx.onMem(describe);

  const center = h(
    "section",
    { class: "center", "data-ch": ch.id, testid: `view-${ch.id}` },
    h("div", { class: "center-title" }, h("h2", {}, ch.name), subName, h("span", { class: "ch-kind" }, `${ch.kind} · ${shape.bands.length} PEQ${hasX ? " + crossover" : ""}`), h("span", { class: "spacer" }), selInfo, flatBtn),
    eqGraph(ctx, ch, sel),
    table,
  );
  return { side: h("aside", { class: "side", "data-ch": ch.id, testid: `side-${ch.id}` }, ...side), center };
}
