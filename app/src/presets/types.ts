import type { DeviceDefinition } from "../devices/types.ts";
import { readField, readText } from "../devices/logic.ts";
import { hex } from "../protocol/frame.ts";

/** An app preset: a snapshot of the unit's live state, plus readable values for people and diffs. */
export interface Preset {
  format: "dpa-app-preset/1";
  name: string;
  device: string;
  created: string;
  /** Live memory image, hex, from dev.liveFrom. The source of truth when pushing. */
  memory: string;
  /** channel id -> field key -> raw value (informational). */
  values: Record<string, Record<string, number | string>>;
}

export interface PresetStore {
  list(): Promise<string[]>;
  load(name: string): Promise<Preset>;
  save(p: Preset): Promise<void>;
  remove(name: string): Promise<void>;
}

export function snapshot(dev: DeviceDefinition, mem: Uint8Array, name: string): Preset {
  const values: Preset["values"] = {};
  for (const ch of dev.channels) {
    values[ch.id] = {};
    for (const fl of ch.fields) values[ch.id][fl.key] = fl.scale.kind === "text" ? readText(dev, mem, fl) : readField(dev, mem, fl);
  }
  return { format: "dpa-app-preset/1", name, device: dev.name, created: new Date().toISOString(), memory: hex(mem), values };
}

export function presetMemory(p: Preset): Uint8Array {
  const parts = p.memory.trim().split(/\s+/);
  const bad = parts.findIndex((h) => !/^[0-9a-f]{2}$/i.test(h));
  if (bad >= 0) throw new Error(`preset memory has a bad byte at offset ${bad}: "${parts[bad]}"`);
  return Uint8Array.from(parts, (h) => parseInt(h, 16));
}

export function validatePreset(dev: DeviceDefinition, p: unknown): Preset {
  const q = p as Preset;
  if (!q || q.format !== "dpa-app-preset/1") throw new Error("not a DPA app preset file");
  if (q.device !== dev.name) throw new Error(`preset is for ${q.device}, not ${dev.name}`);
  if (presetMemory(q).length !== dev.liveTo - dev.liveFrom) throw new Error("preset memory size does not match the device");
  return q;
}
