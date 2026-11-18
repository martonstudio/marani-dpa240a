import type { DeviceDefinition } from "../devices/types.ts";
import { fieldOf, readField } from "../devices/logic.ts";
import type { DeviceModel, SetResult } from "../model/store.ts";

export interface FieldDiff {
  channel: string;
  key: string;
  a: number;
  b: number;
  settable: boolean;
}

/** Field-level differences between two memory images. */
export function diffImages(dev: DeviceDefinition, a: Uint8Array, b: Uint8Array): FieldDiff[] {
  const out: FieldDiff[] = [];
  for (const ch of dev.channels)
    for (const fl of ch.fields) {
      if (fl.scale.kind === "text") {
        const i = fl.addr - dev.liveFrom;
        const sa = a.slice(i, i + (fl.size ?? 1)).join(","), sb = b.slice(i, i + (fl.size ?? 1)).join(",");
        if (sa !== sb) out.push({ channel: ch.id, key: fl.key, a: NaN, b: NaN, settable: false });
        continue;
      }
      const va = readField(dev, a, fl), vb = readField(dev, b, fl);
      if (va !== vb) out.push({ channel: ch.id, key: fl.key, a: va, b: vb, settable: !fl.readOnly && ch.commands.some((c) => c.sets.includes(fl.key)) });
    }
  return out;
}

export interface PushReport {
  sent: SetResult[];
  /** After a full re-read: settable fields still different from the preset (should be empty). */
  remaining: FieldDiff[];
  /** Differences the unit cannot take by command (names...). */
  notPushed: FieldDiff[];
}

/**
 * Send every command whose fields differ from the preset (all commands when `all`), then re-read the whole
 * live state and diff it against the preset. Mute commands go first so outputs stay muted while the rest changes
 * when the preset mutes them, and last when the preset unmutes them.
 */
export async function pushImage(model: DeviceModel, target: Uint8Array, opts: { all?: boolean; onProgress?: (done: number, total: number, label: string) => void } = {}): Promise<PushReport> {
  const dev = model.dev;
  await model.load(undefined, { verify: true }); // decide what to send from a verified image
  const jobs: { ch: (typeof dev.channels)[number]; c: (typeof dev.channels)[number]["commands"][number]; vals: Record<string, number> }[] = [];
  for (const ch of dev.channels)
    for (const c of ch.commands) {
      const vals: Record<string, number> = {};
      let differs = false;
      for (const key of c.sets) {
        const fl = fieldOf(ch, key);
        vals[key] = readField(dev, target, fl);
        if (vals[key] !== readField(dev, model.mem!, fl)) differs = true;
      }
      if (differs || opts.all) jobs.push({ ch, c, vals });
    }
  const isMute = (j: (typeof jobs)[number]) => j.c.key === "mute";
  const ordered = [...jobs.filter((j) => isMute(j) && j.vals.mute === 1), ...jobs.filter((j) => !isMute(j)), ...jobs.filter((j) => isMute(j) && j.vals.mute === 0)];
  // Fields a command only carries (phase carries gain) come from model.mem; the definition lists gain before
  // phase, so by then memory already holds the target gain.
  const sent: SetResult[] = [];
  let n = 0;
  for (const j of ordered) {
    opts.onProgress?.(n, ordered.length, `${j.ch.name} ${j.c.key}`);
    sent.push(await model.apply(j.ch, j.c, j.vals));
    n++;
  }
  opts.onProgress?.(n, ordered.length, "reading back");
  await model.load(undefined, { verify: true });
  const after = diffImages(dev, model.mem!, target);
  return { sent, remaining: after.filter((d) => d.settable), notPushed: after.filter((d) => !d.settable) };
}
