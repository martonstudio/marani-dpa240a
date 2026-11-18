import { describe, expect, it } from "vitest";
import { assertAllowed, GuardError } from "../src/protocol/guard.ts";
import { DPA240A } from "../src/devices/dpa240a.ts";

const policy = { modelId: DPA240A.modelId, allowedCommands: DPA240A.allowedCommands, maxChannel: DPA240A.maxChannel };
const fr = (cmd: number, data: number[] = [0, 0, 0, 0, 0, 0, 0, 0], id = 0xc1) => ({ id, dev: 0, cmd, data });

describe("guard", () => {
  it("refuses the forbidden commands even if listed", () => {
    for (const c of [0x28, 0x18, 0x10, 0x24]) {
      expect(() => assertAllowed(fr(c), policy)).toThrow(GuardError);
      expect(() => assertAllowed(fr(c), { ...policy, allowedCommands: [...policy.allowedCommands, c] })).toThrow(/forbidden/);
    }
  });
  it("refuses 0x17 reads at or above 0x2000", () => {
    expect(() => assertAllowed(fr(0x17, [0x1f, 0xfc, 0, 0, 0, 0, 0, 0]), policy)).not.toThrow();
    expect(() => assertAllowed(fr(0x17, [0x20, 0x00, 0, 0, 0, 0, 0, 0]), policy)).toThrow(/0x2000/);
    expect(() => assertAllowed(fr(0x17, [0xff, 0xff, 0, 0, 0, 0, 0, 0]), policy)).toThrow(GuardError);
  });
  it("refuses channel bytes above maxChannel on parameter commands", () => {
    expect(() => assertAllowed(fr(0x09, [5, 0, 0, 0, 0, 0, 0, 1]), policy)).not.toThrow();
    expect(() => assertAllowed(fr(0x09, [6, 0, 0, 0, 0, 0, 0, 1]), policy)).toThrow(/channel/);
    expect(() => assertAllowed(fr(0x01, [11, 0, 0, 0, 0, 0, 0, 0x78]), policy)).toThrow(/channel/);
  });
  it("refuses unknown commands", () => {
    for (const c of [0x06, 0x22, 0x30, 0xff]) expect(() => assertAllowed(fr(c), policy)).toThrow(/allowed/);
  });
  it("refuses a wrong model id", () => {
    expect(() => assertAllowed(fr(0x00, undefined, 0xc2), policy)).toThrow(/model id/);
  });
  it("allows connect/disconnect", () => {
    expect(() => assertAllowed(fr(0x00), policy)).not.toThrow();
    expect(() => assertAllowed(fr(0x0f), policy)).not.toThrow();
  });
});
