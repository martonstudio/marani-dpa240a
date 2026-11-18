import { describe, expect, it } from "vitest";
import { dev } from "./helpers.ts";
import { display, fieldOf, fromPhysical, parseValue, physical, readText } from "../src/devices/logic.ts";
import type { Field } from "../src/devices/types.ts";
import { SIM_DEFAULT_STATE } from "../src/transport/sim.ts";

const out1 = dev.channels.find((c) => c.id === "out1")!;
const F = (k: string) => fieldOf(out1, k);

describe("display / parseValue per scale kind", () => {
  it("linear (gain dB)", () => {
    const g = F("gain");
    expect(display(g, 0x78)).toBe("0.0 dB");
    expect(display(g, 0x78 + 25)).toBe("+2.5 dB");
    expect(display(g, 0)).toBe("-12.0 dB");
    expect(parseValue(g, "-3dB")).toBe(90);
    expect(parseValue(g, "+2.5 dB")).toBe(145);
    expect(parseValue(g, "raw:7")).toBe(7);
    expect(parseValue(g, "100")).toBe(100);
    expect(parseValue(g, "99dB")).toBe(g.max); // clamped
    expect(physical(g, 90)).toBeCloseTo(-3);
  });
  it("linear (threshold dBu, release s, delay ms)", () => {
    expect(display(F("lim.threshold"), 50)).toBe("+0.0 dBu".replace("+", "")); // 0 is not positive
    expect(parseValue(F("lim.threshold"), "-4dBu")).toBe(30);
    expect(display(F("lim.release"), 4)).toBe("0.5 s");
    expect(parseValue(F("lim.release"), "1s")).toBe(9);
    const fine = F("delay.fine");
    expect(parseValue(fine, "0.5ms")).toBe(24);
  });
  it("freq", () => {
    const f = F("peq1.freq");
    expect(display(f, 0)).toBe("20.0 Hz");
    expect(display(f, 24)).toBe("40.0 Hz");
    expect(display(f, 24 * 5 + 16)).toMatch(/kHz$/);
    expect(parseValue(f, "1k")).toBe(Math.round(24 * Math.log2(50)));
    expect(parseValue(f, "40Hz")).toBe(24);
    expect(fromPhysical(f, 20480)).toBe(240);
    expect(physical(f, 48)).toBeCloseTo(80);
  });
  it("enum", () => {
    const s = F("hpf.slope");
    expect(display(s, 7)).toBe("LR 24");
    expect(parseValue(s, "lr24")).toBe(7);
    expect(parseValue(s, "BW 6")).toBe(1);
    expect(display(s, 99)).toBe("#99");
    expect(parseValue(F("source"), "In A+B")).toBe(2);
  });
  it("index", () => {
    const bw = F("peq1.bw");
    expect(display(bw, 9)).toBe("0.30 oct");
    expect(display(bw, 12)).toBe("#12");
    expect(parseValue(bw, "12")).toBe(12);
    expect(() => parseValue(bw, "wide")).toThrow();
  });
  it("bool", () => {
    const p = F("phase"), m = F("mute");
    expect(display(p, 1)).toBe("Invert");
    expect(parseValue(p, "invert")).toBe(1);
    expect(parseValue(p, "normal")).toBe(0);
    expect(parseValue(m, "muted")).toBe(1);
    // "on"/"off" always mean the field's state: mute on = muted
    expect(parseValue(m, "on")).toBe(1);
    expect(parseValue(m, "off")).toBe(0);
    expect(parseValue(m, "live")).toBe(0);
    expect(parseValue(m, "true")).toBe(1);
    expect(display(m, 1)).toBe("Muted");
  });
  it("text", () => {
    expect(readText(dev, SIM_DEFAULT_STATE, F("name"))).toBe("Low-A");
    expect(readText(dev, SIM_DEFAULT_STATE, dev.globals[0])).toBe("Coax8 3emory");
  });
  it("raw", () => {
    const r: Field = { key: "x", label: "X", group: "main", addr: 0, min: 0, max: 10, scale: { kind: "raw" }, verified: false };
    expect(display(r, 7)).toBe("7");
    expect(parseValue(r, "12")).toBe(10);
  });
});
