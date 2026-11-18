import type { ChannelDef, Field } from "../devices/types.ts";
import { physical, readField } from "../devices/logic.ts";
import { h } from "./dom.ts";
import type { Ctx } from "./ctx.ts";
import { enumSelect, fader, textField, toggle, valueBox } from "./controls.ts";


/** One channel strip, built from the channel's "main" and "delay" groups. */
export function channelStrip(ctx: Ctx, ch: ChannelDef, onSelect: (ch: ChannelDef) => void): HTMLElement {
  const by = (k: string) => ch.fields.find((x) => x.key === k);
  const p = `strip-${ch.id}`;
  const settable = (fl: Field) => !fl.readOnly && ch.commands.some((c) => c.sets.includes(fl.key));
  const parts: (HTMLElement | null)[] = [];

  const name = ch.fields.find((x) => x.scale.kind === "text");
  const head = h(
    "button",
    { class: "strip-head", testid: `${p}-select`, onclick: () => onSelect(ch), title: "Show EQ and details" },
    h("span", { class: "strip-id" }, h("span", { class: "strip-title" }, ch.name), name ? textField(ctx, ch, name, p) : h("span", { class: "name-field" }, ch.kind === "input" ? "input" : "\u00a0")),
    h("span", { class: "strip-kind" }, ch.kind === "input" ? "IN" : "OUT"),
  );
  parts.push(head);

  const mute = by("mute");
  if (mute && settable(mute)) parts.push(toggle(ctx, ch, mute, p, "mute"));
  const src = by("source");
  if (src && settable(src)) parts.push(enumSelect(ctx, ch, src, p));
  else parts.push(h("div", { class: "field src-placeholder" }));
  const gain = by("gain");
  if (gain && settable(gain)) parts.push(fader(ctx, ch, gain, p));
  const phase = by("phase");
  if (phase && settable(phase)) parts.push(toggle(ctx, ch, phase, p, "phase"));
  else parts.push(h("div", { class: "field phase-placeholder" }));

  // any other settable main-group field the definition adds later
  for (const fl of ch.fields)
    if (fl.group === "main" && settable(fl) && !["mute", "source", "gain", "phase"].includes(fl.key))
      parts.push(fl.scale.kind === "enum" ? enumSelect(ctx, ch, fl, p) : valueBox(ctx, ch, fl, p));

  const delay = ch.fields.filter((x) => x.group === "delay" && settable(x));
  if (delay.length) {
    // Total = sum of the delay fields in their physical unit (ms). The ms scale is derived, not panel-confirmed.
    const total = h("span", { class: "delay-total", testid: `${p}-delay-total` }, "--");
    const unit = delay[0].scale.kind === "linear" ? delay[0].scale.unit : "steps";
    ctx.onMem((mem) => {
      const v = delay.reduce((a, fl) => a + physical(fl, readField(ctx.dev, mem, fl)), 0);
      total.textContent = `${v.toFixed(3)} ${unit}`;
    });
    parts.push(
      h(
        "div",
        { class: "delay-box" },
        h("div", { class: "box-title" }, "Delay", h("span", { class: "derived", title: "ms scale derived from clamp limits and one panel reading; not yet confirmed on the panel" }, "derived")),
        total,
        h("div", { class: "delay-inputs" }, ...delay.map((fl) => valueBox(ctx, ch, { ...fl, label: fl.label.replace(/^Delay\s*/i, "") } as Field, p, { steppers: false }))),
      ),
    );
  }

  const el = h("section", { class: `strip strip-${ch.kind}`, "data-ch": ch.id, testid: p }, ...parts);
  return el;
}
