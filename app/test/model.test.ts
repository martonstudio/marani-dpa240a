import { describe, expect, it } from "vitest";
import { dev, openModel } from "./helpers.ts";
import { readField } from "../src/devices/logic.ts";
import type { Field } from "../src/devices/types.ts";
import type { SetResult } from "../src/model/store.ts";

/** A value different from the current one, inside the field's range (crosses a byte boundary for 16-bit fields). */
function testValue(fl: Field, cur: number): number {
  if (fl.max - fl.min === 1) return cur ? 0 : 1;
  const candidates = [fl.max > 300 ? 300 : fl.max - 1, fl.min + 1, Math.floor((fl.min + fl.max) / 2), fl.max];
  return candidates.find((v) => v !== cur && v >= fl.min && v <= fl.max)!;
}

describe("DeviceModel against SimTransport", () => {
  for (const ch of dev.channels) {
    const settable = ch.fields.filter((fl) => !fl.readOnly && ch.commands.some((c) => c.sets.includes(fl.key)));
    it(`${ch.name}: every settable field round-trips through set + read-back (${settable.length} fields)`, async () => {
      const { model, sim, session } = await openModel();
      for (const fl of settable) {
        const cur = model.get(ch, fl.key);
        const v = testValue(fl, cur);
        const r = await model.set(ch, fl.key, v);
        expect(r.echo, `${ch.id}.${fl.key} echo`).toBe(true);
        expect(r.ok, `${ch.id}.${fl.key} ok`).toBe(true);
        expect(r.fields.find((x) => x.key === fl.key)).toEqual({ key: fl.key, wanted: v, readBack: v });
        expect(model.get(ch, fl.key)).toBe(v);
        expect(readField(dev, sim.mem, fl)).toBe(v);
        // restore
        expect((await model.set(ch, fl.key, cur)).ok).toBe(true);
      }
      // nothing else moved
      await model.load();
      expect(Array.from(model.mem!)).toEqual(Array.from(sim.mem));
      await session.close();
    });
  }

  it("mute touches only its own bit", async () => {
    const { model, sim } = await openModel();
    const before = sim.mem[0x158];
    const out1 = dev.channels.find((c) => c.id === "out1")!;
    await model.set(out1, "mute", model.get(out1, "mute") ? 0 : 1);
    expect(sim.mem[0x158] ^ before).toBe(1 << out1.chn);
  });

  it("phase (0x03) carries the current gain", async () => {
    const { model, sim } = await openModel();
    const out2 = dev.channels.find((c) => c.id === "out2")!;
    await model.set(out2, "gain", 100);
    await model.set(out2, "phase", 1);
    expect(model.get(out2, "gain")).toBe(100);
    const f03 = sim.received.filter((f) => f.cmd === 0x03).at(-1)!;
    expect(f03.data[6]).toBe(1);
    expect(f03.data[7]).toBe(100); // D7 carries the gain
  });

  it("setLatest: latest value wins, the last one is what the unit holds", async () => {
    const { model, sim } = await openModel();
    const out1 = dev.channels.find((c) => c.id === "out1")!;
    const results: (SetResult | Error)[] = [];
    for (const v of [10, 20, 30, 40, 50]) model.setLatest(out1, "gain", v, (r) => results.push(r));
    await new Promise((r) => setTimeout(r, 100));
    expect(model.get(out1, "gain")).toBe(50);
    const gainFrames = sim.received.filter((f) => f.cmd === 0x01 && f.data[0] === out1.chn);
    expect(gainFrames.length).toBeLessThan(5);
    expect(gainFrames.at(-1)!.data[7]).toBe(50);
    expect(results.every((r) => !(r instanceof Error) && r.ok)).toBe(true);
  });
});
