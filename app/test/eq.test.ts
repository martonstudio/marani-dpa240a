import { describe, expect, it } from "vitest";
import { bwOctaves, eqShape, parseSlope, passDb, peakingDb, resolveEq, responseDb } from "../src/ui/eq.ts";
import { dev } from "./helpers.ts";
import { SIM_DEFAULT_STATE } from "../src/transport/sim.ts";

describe("EQ display maths", () => {
  it("BW index mapping goes through the two measured points", () => {
    expect(bwOctaves(9)).toBeCloseTo(0.3);
    expect(bwOctaves(20)).toBeCloseTo(0.85);
    expect(bwOctaves(0)).toBe(0.02);
  });
  it("peaking filter: full gain at f0, ~0 far away", () => {
    expect(peakingDb(1000, 1000, 6, 1)).toBeCloseTo(6, 5);
    expect(peakingDb(1000, 1000, -9, 0.3)).toBeCloseTo(-9, 5);
    expect(Math.abs(peakingDb(20, 1000, 6, 0.5))).toBeLessThan(0.05);
  });
  it("slopes: Butterworth -3 dB, LR -6 dB at fc; Off flat; unknown drawn as LR 24", () => {
    expect(passDb(100, 100, parseSlope("BW 12"), "hpf")).toBeCloseTo(-3.01, 1);
    expect(passDb(100, 100, parseSlope("LR 24"), "lpf")).toBeCloseTo(-6.02, 1);
    expect(passDb(50, 100, parseSlope("BW 24"), "hpf")).toBeCloseTo(-24.1, 0);
    expect(passDb(10, 100, parseSlope("Off"), "hpf")).toBe(0);
    expect(parseSlope("Slope 8")).toEqual({ family: "LR", order: 4, unknown: true });
    expect(parseSlope("BW 18").order).toBe(3);
  });
  it("shapes come from the definition: inputs 5 bands no crossover, outputs 7 bands + HPF/LPF", () => {
    const inA = eqShape(dev.channels[0]);
    const out1 = eqShape(dev.channels[2]);
    expect(inA.bands).toHaveLength(5);
    expect(inA.hpf).toBeUndefined();
    expect(out1.bands).toHaveLength(7);
    expect(out1.hpf && out1.lpf).toBeTruthy();
    const r = resolveEq(dev, SIM_DEFAULT_STATE, out1);
    expect(Number.isFinite(responseDb(r, 1000))).toBe(true);
  });
});
