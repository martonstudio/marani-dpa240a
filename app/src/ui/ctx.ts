import type { ChannelDef, DeviceDefinition, Field } from "../devices/types.ts";
import { display, readField, readText } from "../devices/logic.ts";
import type { DeviceModel, SetResult } from "../model/store.ts";

type Render = (raw: number, text: string) => void;

/**
 * Shared UI context: the device definition, the current model (null when disconnected), the field -> renderer
 * bindings (every displayed value comes from model memory, i.e. the read-back), and per-field warning badges.
 */
export class Ctx {
  model: DeviceModel | null = null;
  private renders: { ch: ChannelDef; fl: Field; fn: Render }[] = [];
  private badges = new Map<string, Set<HTMLElement>>();
  private memListeners: ((mem: Uint8Array) => void)[] = [];
  onError: (msg: string) => void = () => {};

  constructor(readonly dev: DeviceDefinition) {}

  bind(ch: ChannelDef, fl: Field, fn: Render): void {
    this.renders.push({ ch, fl, fn });
  }
  /** Called with the whole image after any change (graphs, summaries). */
  onMem(fn: (mem: Uint8Array) => void): void {
    this.memListeners.push(fn);
  }

  renderAll(): void {
    const mem = this.model?.mem;
    if (!mem) return;
    for (const r of this.renders) {
      if (r.fl.scale.kind === "text") r.fn(0, readText(this.dev, mem, r.fl));
      else {
        const v = readField(this.dev, mem, r.fl);
        r.fn(v, display(r.fl, v));
      }
    }
    for (const l of this.memListeners) l(mem);
  }

  value(ch: ChannelDef, fl: Field): number | null {
    const mem = this.model?.mem;
    return mem ? readField(this.dev, mem, fl) : null;
  }

  badge(ch: ChannelDef, key: string): HTMLElement {
    const el = document.createElement("span");
    el.className = "warn-badge";
    el.textContent = "!";
    el.hidden = true;
    el.setAttribute("data-testid", `warn-${ch.id}-${key.replace(/\./g, "-")}`);
    const id = ch.id + "/" + key;
    if (!this.badges.has(id)) this.badges.set(id, new Set());
    this.badges.get(id)!.add(el);
    return el;
  }

  private setWarn(chId: string, key: string, msg: string | null): void {
    for (const el of this.badges.get(chId + "/" + key) ?? []) {
      el.hidden = msg === null;
      el.title = msg ?? "";
    }
  }

  /** Handle a set result: badge every field whose read-back differs from what was asked. */
  result(ch: ChannelDef, key: string, r: SetResult | Error): void {
    if (r instanceof Error) {
      this.setWarn(ch.id, key, "no confirmation: " + r.message);
      this.onError(`${ch.name} ${key}: ${r.message}`);
      return;
    }
    for (const f of r.fields) this.setWarn(ch.id, f.key, f.wanted === f.readBack ? null : `asked ${f.wanted}, unit holds ${f.readBack}${r.echo ? "" : " (no echo)"}`);
    if (!r.ok) this.onError(`${ch.name} ${r.command}: read-back differs from what was sent`);
  }

  /** Continuous edits (faders, drags): latest value wins. */
  editLatest(ch: ChannelDef, key: string, raw: number): void {
    const m = this.model;
    if (!m?.mem) return;
    try {
      m.setLatest(ch, key, raw, (r) => this.result(ch, key, r));
    } catch (e) {
      this.result(ch, key, e as Error);
    }
  }

  /** Discrete edits (buttons, selects, typed values). */
  async edit(ch: ChannelDef, key: string, raw: number): Promise<void> {
    const m = this.model;
    if (!m?.mem) return;
    try {
      this.result(ch, key, await m.set(ch, key, raw));
    } catch (e) {
      this.result(ch, key, e as Error);
      this.renderAll(); // snap controls back to the unit's value
    }
  }
}

export const tid = (...parts: string[]) => parts.join("-").replace(/\./g, "-");
