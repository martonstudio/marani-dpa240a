import type { ChannelDef, Field } from "../devices/types.ts";
import { h } from "./dom.ts";
import type { Ctx } from "./ctx.ts";
import { enumSelect, valueBox } from "./controls.ts";
import { eqGraph } from "./eqgraph.ts";
import { bwOctaves, eqShape } from "./eq.ts";

const GROUP_TITLES: Record<string, string> = { xover: "Crossover", limiter: "Limiter", delay: "Delay (ms scale derived)" };

/** Detail panel for one channel: EQ graph, per-band controls, then every other non-strip group (crossover, limiter...). */
export function detailPanel(ctx: Ctx, ch: ChannelDef): HTMLElement {
  const P = "detail";
  const pfx = `${P}-${ch.id}`;
  const settable = (fl: Field) => !fl.readOnly && ch.commands.some((c) => c.sets.includes(fl.key));
  const ctl = (fl: Field) => (fl.scale.kind === "enum" ? enumSelect(ctx, ch, fl, pfx) : valueBox(ctx, ch, fl, pfx));
  const shape = eqShape(ch);
  const cards = new Map<string, HTMLElement>();
  const graph = eqGraph(ctx, ch, (g) => pick(g));
  const pick = (g: string | null) => {
    for (const [k, c] of cards) c.classList.toggle("sel", k === g);
    graph.select(g);
  };
  const bands = h(
    "div",
    { class: "bands" },
    ...shape.bands.map((b, i) => {
      const card = h(
        "div",
        { class: "band", testid: `${pfx}-${b.group}`, onclick: () => pick(b.group) },
        h("div", { class: "box-title" }, `Band ${i + 1}`),
        ctl(b.freqField),
        valueBox(ctx, ch, b.bwField, pfx, { hint: (raw) => `\u2248${bwOctaves(raw).toFixed(2)} oct` }),
        ctl(b.gainField),
      );
      cards.set(b.group, card);
      return card;
    }),
  );
  const used = new Set(["main", ...shape.bands.map((b) => b.group)]);
  const groups = [...new Set(ch.fields.map((f) => f.group))].filter((g) => !used.has(g));
  const extra = groups
    .map((g) => {
      const fields = ch.fields.filter((f) => f.group === g && settable(f));
      if (!fields.length) return null;
      return h("div", { class: "card", testid: `${pfx}-${g}` }, h("div", { class: "box-title" }, GROUP_TITLES[g] ?? g), h("div", { class: "card-fields" }, ...fields.map(ctl)));
    })
    .filter(Boolean) as HTMLElement[];
  return h(
    "section",
    { class: "detail", "data-ch": ch.id, testid: pfx, hidden: true },
    h("h2", { class: "detail-title" }, ch.name, h("small", {}, ch.kind === "input" ? ` input · ${shape.bands.length} PEQ bands` : ` output · ${shape.bands.length} PEQ bands`)),
    graph.el,
    bands,
    extra.length ? h("div", { class: "cards" }, ...extra) : null,
  );
}
