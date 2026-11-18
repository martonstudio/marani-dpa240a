import { describe, expect, it } from "vitest";
import { dev, makeSession, makeSim } from "./helpers.ts";
import { SIM_DEFAULT_STATE } from "../src/transport/sim.ts";
import { frameHex } from "../src/protocol/frame.ts";

describe("Session against SimTransport", () => {
  it("connects (model id in reply) and disconnects", async () => {
    const sim = makeSim({ delayMs: 15 });
    const s = makeSession(sim);
    await sim.open();
    expect(await s.connect()).toBe(0xc1);
    expect(s.connected).toBe(true);
    await s.close();
    expect(s.connected).toBe(false);
    expect(sim.received.map((f) => f.cmd)).toEqual([0x00, 0x0f]);
  });

  it("readMemory returns the simulator's image", async () => {
    const sim = makeSim();
    const s = makeSession(sim);
    await sim.open();
    await s.connect();
    const progress: number[] = [];
    const mem = await s.readMemory(dev.liveFrom, dev.liveTo, (d, t) => progress.push(d / t));
    expect(mem.length).toBe(0x160);
    expect(Array.from(mem)).toEqual(Array.from(SIM_DEFAULT_STATE));
    expect(progress.at(-1)).toBe(1);
    await s.close();
  });

  it("times out, retries once, then rejects when the unit is silent", async () => {
    const sim = makeSim({ silent: true });
    const s = makeSession(sim, 40, 1);
    await sim.open();
    const t0 = Date.now();
    await expect(s.request(0x17, [0, 0x40, 0, 0, 0, 0, 0, 0])).rejects.toThrow(/no reply/);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(75);
    expect(sim.received).toHaveLength(2);
    expect(frameHex(sim.received[0])).toBe(frameHex(sim.received[1]));
  });

  it("succeeds on the retry when the first reply is lost", async () => {
    const sim = makeSim({ silent: true });
    const s = makeSession(sim, 40, 1);
    await sim.open();
    setTimeout(() => (sim.silent = false), 20);
    const r = await s.request(0x17, [0, 0x40, 0, 0, 0, 0, 0, 0], (f) => f.cmd === 0x17);
    expect(r.frame.data.slice(2, 6)).toEqual(Array.from(SIM_DEFAULT_STATE.slice(0x40, 0x44)));
    expect(sim.received).toHaveLength(2);
  });

  it("guard runs before anything is written", async () => {
    const sim = makeSim();
    const s = makeSession(sim);
    await sim.open();
    expect(() => s.request(0x28, [0, 0, 0, 0, 0, 0, 0, 0])).toThrow();
    expect(() => s.request(0x17, [0x20, 0, 0, 0, 0, 0, 0, 0])).toThrow();
    expect(sim.received).toHaveLength(0);
  });

  it("the simulator ignores unknown frames (no reply)", async () => {
    const sim = makeSim();
    const replies: Uint8Array[] = [];
    sim.onData((b) => replies.push(b));
    await sim.open();
    // 0x05 with D2 != 0 matches no command layout
    await sim.write(Uint8Array.from([0xf0, 0xc1, 0, 0x05, 2, 0, 9, 0, 0, 0, 0, 0, 0xf7]));
    await new Promise((r) => setTimeout(r, 20));
    expect(replies).toHaveLength(0);
  });
});
