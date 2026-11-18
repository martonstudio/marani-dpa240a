import type { Transport } from "./types.ts";
import { encode, FrameParser, type Frame } from "../protocol/frame.ts";
import type { ChannelDef, CommandDef, DeviceDefinition } from "../devices/types.ts";
import { fieldOf, readField, writeField } from "../devices/logic.ts";

/** Live state read from the real DPA240A (0x0000..0x015F), 18 Nov. */
const SIM_DEFAULT_HEX =
  "436f6178382033656d6f727920202020000101000101000001010101010120ff555555555555555500000000000000000000000000000000ffffffffffffffff7800000088091e88091e88091e88091e88091e7800000088091e88091e88091e88091e88091e0078130496000000000000f00088091e88091e88091e88091e88091e88091e88091e4c6f772d41200178130496000000000000f00088091e88091e88091e88091e88091e88091e88091e4c6f772d42200078130496000000000000f00088091e88091e88091e88091e88091e88091e88091e486967682d410178130496000000000000f00088091e88091e88091e88091e88091e88091e88091e486967682d420078130496000000000000f00088091e88091e88091e88091e88091e88091e88091e2020202020200178130496000000000000f00088091e88091e88091e88091e88091e88091e88091e2020202020200001fc010a00010a0000";

export const SIM_DEFAULT_STATE: Uint8Array = Uint8Array.from(SIM_DEFAULT_HEX.match(/../g)!, (h) => parseInt(h, 16));

export interface SimOptions {
  /** Reply delay in ms (default 15). */
  delayMs?: number;
  /** When true, frames are swallowed (no replies): for timeout tests. */
  silent?: boolean;
}

/**
 * Simulated unit. Parses 13-byte frames, answers connect/disconnect/read, echoes parameter commands and applies
 * them to its memory image by matching the device definition's command layouts. Unknown frames get no reply.
 */
export class SimTransport implements Transport {
  readonly name = "sim";
  readonly mem: Uint8Array;
  /** Every frame received, in order (for tests). */
  readonly received: Frame[] = [];
  private parser = new FrameParser();
  private dataCbs: ((b: Uint8Array) => void)[] = [];
  private lostCbs: ((r: string) => void)[] = [];
  private isOpen = false;
  delayMs: number;
  silent: boolean;

  constructor(private dev: DeviceDefinition, initial: Uint8Array = SIM_DEFAULT_STATE, opts: SimOptions = {}) {
    this.mem = new Uint8Array(dev.liveTo - dev.liveFrom);
    this.mem.set(initial.subarray(0, this.mem.length));
    this.delayMs = opts.delayMs ?? 15;
    this.silent = opts.silent ?? false;
  }

  async open(): Promise<void> {
    this.isOpen = true;
    this.parser.reset();
  }
  async close(): Promise<void> {
    this.isOpen = false;
  }
  onData(cb: (b: Uint8Array) => void): void {
    this.dataCbs.push(cb);
  }
  onLost(cb: (r: string) => void): void {
    this.lostCbs.push(cb);
  }
  /** Simulate the link dropping (tests / UI). */
  drop(reason = "simulated link loss"): void {
    this.isOpen = false;
    for (const cb of this.lostCbs) cb(reason);
  }

  async write(bytes: Uint8Array): Promise<void> {
    if (!this.isOpen) throw new Error("sim not open");
    for (const f of this.parser.push(bytes)) {
      this.received.push(f);
      const reply = this.handle(f);
      if (reply && !this.silent) {
        const out = encode(reply);
        setTimeout(() => {
          if (this.isOpen) for (const cb of this.dataCbs) cb(out);
        }, this.delayMs);
      }
    }
  }

  private handle(f: Frame): Frame | null {
    if (f.id !== this.dev.modelId) return null;
    const d = f.data;
    switch (f.cmd) {
      case 0x00:
        return { id: f.id, dev: f.dev, cmd: 0x00, data: [this.dev.modelId, 0, 0, 0, 0, 0, 0, 0] };
      case 0x0f:
        return f;
      case 0x17: {
        const addr = (d[0] << 8) | d[1];
        const bytes = [0, 1, 2, 3].map((k) => {
          const i = addr + k - this.dev.liveFrom;
          return i >= 0 && i < this.mem.length ? this.mem[i] : 0;
        });
        return { id: f.id, dev: f.dev, cmd: 0x17, data: [d[0], d[1], ...bytes, 0, 0] };
      }
    }
    const ch = this.dev.channels.find((c) => c.chn === d[0]);
    if (!ch) return null;
    const c = ch.commands.find((x) => x.cmd === f.cmd && x.data.every((s, i) => (typeof s === "number" ? d[i] === s : s === "chn" ? d[i] === ch.chn : true)));
    if (!c) return null;
    this.apply(ch, c, d);
    return f;
  }

  private apply(ch: ChannelDef, c: CommandDef, d: number[]): void {
    const vals = new Map<string, number>();
    c.data.forEach((s, i) => {
      if (typeof s !== "object") return;
      const fl = fieldOf(ch, s.field);
      const n = fl.size ?? 1;
      const byte = s.byte ?? n - 1;
      const shift = 8 * (n - 1 - byte);
      const cur = vals.get(s.field) ?? readField(this.dev, this.mem, fl);
      vals.set(s.field, (cur & ~(0xff << shift)) | (d[i] << shift));
    });
    for (const [key, v] of vals) writeField(this.dev, this.mem, fieldOf(ch, key), v);
  }
}
