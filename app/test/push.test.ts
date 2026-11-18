import { describe, expect, it } from "vitest";
import { dev, openModel } from "./helpers.ts";
import { fieldOf, writeField } from "../src/devices/logic.ts";
import { diffImages, pushImage } from "../src/presets/push.ts";
import { snapshot, presetMemory, validatePreset } from "../src/presets/types.ts";

describe("pushImage against SimTransport", () => {
  it("pushes a modified image; nothing settable remains different; names are reported not pushed", async () => {
    const { model, sim } = await openModel();
    const target = model.mem!.slice();
    const ch = (id: string) => dev.channels.find((c) => c.id === id)!;
    const set = (id: string, key: string, v: number) => writeField(dev, target, fieldOf(ch(id), key), v);
    set("out1", "gain", 90);
    set("out1", "phase", 1);
    set("out1", "mute", 0);
    set("out2", "delay.coarse", 300);
    set("out2", "delay.fine", 17);
    set("out3", "peq4.freq", 150);
    set("out3", "peq4.gain", 40);
    set("out4", "lpf.slope", 7);
    set("out4", "lim.threshold", 120);
    set("inA", "peq2.bw", 33);
    set("inB", "gain", 100);
    // a name byte: not settable by command
    const nm = fieldOf(ch("out1"), "name");
    target[nm.addr - dev.liveFrom] = "X".charCodeAt(0);

    const before = diffImages(dev, model.mem!, target);
    expect(before.filter((d) => d.settable).length).toBeGreaterThanOrEqual(10);
    expect(before.filter((d) => !d.settable).map((d) => d.key)).toEqual(["name"]);
    const progress: string[] = [];
    const rep = await pushImage(model, target, { onProgress: (_d, _t, l) => progress.push(l) });
    expect(rep.remaining).toEqual([]);
    expect(rep.notPushed.map((d) => `${d.channel}.${d.key}`)).toEqual(["out1.name"]);
    expect(rep.sent.every((r) => r.ok)).toBe(true);
    expect(progress.at(-1)).toBe("reading back");
    // the unit (sim) now holds the target everywhere except the name
    expect(diffImages(dev, sim.mem, target).map((d) => d.key)).toEqual(["name"]);
  });

  it("snapshot -> JSON -> validatePreset -> presetMemory round-trips", async () => {
    const { model } = await openModel();
    const p = snapshot(dev, model.mem!, "test");
    const back = validatePreset(dev, JSON.parse(JSON.stringify(p)));
    expect(Array.from(presetMemory(back))).toEqual(Array.from(model.mem!));
    expect(back.values.out1.name).toBe("Low-A");
    expect(() => validatePreset(dev, { ...p, device: "X" })).toThrow();
    expect(() => validatePreset(dev, { ...p, memory: "00 01" })).toThrow();
  });
});
