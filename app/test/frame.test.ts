import { describe, expect, it } from "vitest";
import { decode, encode, FrameParser, hex } from "../src/protocol/frame.ts";

describe("frame codec", () => {
  it("encodes and decodes a 13-byte frame", () => {
    const f = { id: 0xc1, dev: 0, cmd: 0x22, data: [1, 2, 3, 4, 5, 6, 7, 8] };
    const b = encode(f);
    expect(b.length).toBe(13);
    expect(hex(b)).toBe("f0 c1 00 22 01 02 03 04 05 06 07 08 f7");
    expect(decode(b)).toEqual(f);
  });
  it("rejects wrong data length and out-of-range bytes", () => {
    expect(() => encode({ id: 0xc1, dev: 0, cmd: 1, data: [0] })).toThrow();
    expect(() => encode({ id: 0xc1, dev: 0, cmd: 1, data: [0, 0, 0, 0, 0, 0, 0, 256] })).toThrow();
    expect(() => encode({ id: 0xc1, dev: 0, cmd: 1, data: [0, 0, 0, 0, 0, 0, 0, 1.5] })).toThrow();
  });
});

describe("FrameParser", () => {
  const a = encode({ id: 0xc1, dev: 0, cmd: 0x01, data: [2, 0, 0, 0, 0, 0, 0, 0x78] });
  const b = encode({ id: 0xc1, dev: 0, cmd: 0x17, data: [0, 0x40, 1, 2, 3, 4, 0, 0] });
  it("reassembles frames split across chunks", () => {
    const p = new FrameParser();
    expect(p.push(a.slice(0, 5))).toEqual([]);
    expect(p.push(a.slice(5, 12))).toEqual([]);
    const out = p.push([...a.slice(12), ...b]);
    expect(out.map((f) => f.cmd)).toEqual([0x01, 0x17]);
  });
  it("drops leading garbage and resyncs after a broken frame", () => {
    const p = new FrameParser();
    // garbage, then a truncated frame (STX + 5 bytes), then two good frames
    const broken = [0x00, 0x55, 0xf0, 0xc1, 0x00, 0x01, 0x02, 0x03];
    const out = p.push([...broken, ...a, ...b]);
    expect(out.map((f) => hex(encode(f)))).toEqual([hex(a), hex(b)]);
  });
  it("discards bytes with no STX", () => {
    const p = new FrameParser();
    expect(p.push([1, 2, 3, 0xf7])).toEqual([]);
    expect(p.push(a)).toHaveLength(1);
  });
});
