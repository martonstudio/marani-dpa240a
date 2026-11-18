import { describe, expect, it } from "vitest";
import { dev, makeSim } from "./helpers.ts";
import { openDevice } from "../src/core.ts";

/** Regressions from the 18 Nov review: nothing may follow the disconnect; overlapping edits must not undo each other. */
describe("races", () => {
  it("no frame after the disconnect when closing during a load and a fader drag", async () => {
    const t = makeSim();
    const tx: number[] = [];
    const w = t.write.bind(t);
    t.write = async (b: Uint8Array) => {
      tx.push(b[3]);
      return w(b);
    };
    const m = await openDevice(dev, t);
    await m.load();
    const out = dev.channels[2];
    m.setLatest(out, "gain", 100);
    m.setLatest(out, "gain", 110);
    const loading = m.load().catch((e) => e);
    await new Promise((r) => setTimeout(r, 5));
    await m.session.close();
    await loading;
    await new Promise((r) => setTimeout(r, 300));
    expect(tx.slice(tx.lastIndexOf(0x0f) + 1)).toEqual([]);
  });

  it("a phase toggle overlapping a gain change keeps the new gain", async () => {
    const m = await openDevice(dev, makeSim());
    await m.load();
    const out = dev.channels[2];
    const [a, b] = await Promise.all([m.set(out, "gain", 150), m.set(out, "phase", 1)]);
    expect(a.ok && b.ok).toBe(true);
    await m.load();
    expect(m.get(out, "gain")).toBe(150);
    expect(m.get(out, "phase")).toBe(1);
    await m.session.close();
  });

  it("a connect that gets no reply still sends a disconnect", async () => {
    const t = makeSim({ silent: true });
    const tx: number[] = [];
    const w = t.write.bind(t);
    t.write = async (b: Uint8Array) => {
      tx.push(b[3]);
      return w(b);
    };
    await expect(openDevice(dev, t)).rejects.toThrow();
    expect(tx).toContain(0x00);
    expect(tx[tx.length - 1]).toBe(0x0f);
  });
});
