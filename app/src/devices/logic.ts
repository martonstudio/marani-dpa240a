import type { ChannelDef, CommandDef, DeviceDefinition, Field } from "./types.ts";

/** Pure helpers over a device definition and a live-memory image (index 0 = dev.liveFrom). */

export function fieldOf(ch: ChannelDef, key: string): Field {
  const fl = ch.fields.find((x) => x.key === key);
  if (!fl) throw new Error(`${ch.name} has no field ${key}`);
  return fl;
}

export function channelOf(dev: DeviceDefinition, id: string): ChannelDef {
  const ch = dev.channels.find((c) => c.id === id || c.name.toLowerCase().replace(/\s/g, "") === id.toLowerCase().replace(/\s/g, ""));
  if (!ch) throw new Error(`no channel ${id} (have ${dev.channels.map((c) => c.id).join(", ")})`);
  return ch;
}

export function readField(dev: DeviceDefinition, mem: Uint8Array, fl: Field): number {
  const i = fl.addr - dev.liveFrom;
  if (fl.bit !== undefined) return (mem[i] >> fl.bit) & 1;
  if (fl.scale.kind === "text") return 0;
  let v = 0;
  for (let k = 0; k < (fl.size ?? 1); k++) v = (v << 8) | mem[i + k];
  return v;
}

export function readText(dev: DeviceDefinition, mem: Uint8Array, fl: Field): string {
  const i = fl.addr - dev.liveFrom;
  return Array.from(mem.slice(i, i + (fl.size ?? 1)), (b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : " ")).join("").trimEnd();
}

export function writeField(dev: DeviceDefinition, mem: Uint8Array, fl: Field, v: number): void {
  const i = fl.addr - dev.liveFrom;
  if (fl.bit !== undefined) {
    mem[i] = v ? mem[i] | (1 << fl.bit) : mem[i] & ~(1 << fl.bit);
    return;
  }
  const n = fl.size ?? 1;
  for (let k = n - 1; k >= 0; k--) {
    mem[i + k] = v & 0xff;
    v >>= 8;
  }
}

export function commandFor(ch: ChannelDef, key: string): CommandDef {
  const c = ch.commands.find((x) => x.sets.includes(key));
  if (!c) throw new Error(`${ch.name}.${key} has no command (read-only)`);
  return c;
}

/** The 8 data bytes for a command, taking every field value from `mem`. */
export function buildData(dev: DeviceDefinition, ch: ChannelDef, c: CommandDef, mem: Uint8Array): number[] {
  return c.data.map((s) => {
    if (s === "chn") return ch.chn;
    if (typeof s === "number") return s;
    const fl = fieldOf(ch, s.field);
    const v = readField(dev, mem, fl);
    const n = fl.size ?? 1;
    const byte = s.byte ?? n - 1;
    return (v >> (8 * (n - 1 - byte))) & 0xff;
  });
}

/** Every memory address a command touches (for read-back). */
export function commandAddrs(ch: ChannelDef, c: CommandDef): number[] {
  const out = new Set<number>();
  for (const s of c.data) {
    if (typeof s === "object") {
      const fl = fieldOf(ch, s.field);
      for (let k = 0; k < (fl.size ?? 1); k++) out.add(fl.addr + k);
    }
  }
  return [...out].sort((a, b) => a - b);
}

export function clamp(fl: Field, v: number): number {
  return Math.max(fl.min, Math.min(fl.max, Math.round(v)));
}

/** Human-readable value. */
export function display(fl: Field, raw: number): string {
  const s = fl.scale;
  switch (s.kind) {
    case "linear": {
      const v = raw * s.mul + s.add;
      return `${v > 0 && s.unit.startsWith("dB") ? "+" : ""}${v.toFixed(s.digits)} ${s.unit}`;
    }
    case "freq": {
      const hz = s.base * 2 ** (raw / s.perOctave);
      return hz >= 1000 ? `${(hz / 1000).toFixed(hz >= 10000 ? 1 : 2)} kHz` : `${hz.toFixed(hz < 100 ? 1 : 0)} Hz`;
    }
    case "enum":
      return s.options.find((o) => o.raw === raw)?.label ?? `#${raw}`;
    case "index":
      return s.known[raw] ? `${s.known[raw]}${s.unit ? " " + s.unit : ""}` : `#${raw}`;
    case "bool":
      return raw ? s.on : s.off;
    default:
      return String(raw);
  }
}

/** Numeric value in the display unit, where one exists (for graphs). */
export function physical(fl: Field, raw: number): number {
  const s = fl.scale;
  if (s.kind === "linear") return raw * s.mul + s.add;
  if (s.kind === "freq") return s.base * 2 ** (raw / s.perOctave);
  return raw;
}

/** Inverse of `physical` for linear/freq scales (rounded, clamped). */
export function fromPhysical(fl: Field, v: number): number {
  const s = fl.scale;
  if (s.kind === "linear") return clamp(fl, (v - s.add) / s.mul);
  if (s.kind === "freq") return clamp(fl, s.perOctave * Math.log2(v / s.base));
  return clamp(fl, v);
}

/** Parse a CLI/UI value: "raw:120" or "120" = raw, "-3dB", "1k", "1000Hz", enum label. */
export function parseValue(fl: Field, text: string): number {
  const t = text.trim();
  if (/^raw:/i.test(t)) return clamp(fl, Number(t.slice(4)));
  const s = fl.scale;
  if (s.kind === "enum" || s.kind === "bool") {
    const opts = s.kind === "enum" ? s.options : [{ raw: 0, label: s.off }, { raw: 1, label: s.on }];
    if (s.kind === "bool" && /^(on|true|yes)$/i.test(t)) return 1;
    if (s.kind === "bool" && /^(off|false|no)$/i.test(t)) return 0;
    const o = opts.find((x) => x.label.toLowerCase().replace(/\s/g, "") === t.toLowerCase().replace(/\s/g, ""));
    if (o) return o.raw;
    // for bools "on"/"off" always mean the field's state (mute on = muted, phase on = inverted)
    if (/^(on|true|yes)$/i.test(t) && s.kind === "bool") return 1;
    if (/^(off|false|no)$/i.test(t) && s.kind === "bool") return 0;
  }
  const m = /^([-+]?\d*\.?\d+)\s*(k?)(hz|db|dbu|s|ms)?$/i.exec(t);
  if (m && (m[2] || m[3]) && (s.kind === "linear" || s.kind === "freq")) {
    const v = Number(m[1]) * (m[2] ? 1000 : 1);
    return fromPhysical(fl, v);
  }
  if (/^[-+]?\d+$/.test(t)) return clamp(fl, Number(t));
  throw new Error(`cannot parse "${text}" for ${fl.key}`);
}
