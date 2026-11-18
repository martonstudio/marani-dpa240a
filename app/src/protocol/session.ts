import { encode, frameHex, FrameParser, type Frame } from "./frame.ts";
import { assertAllowed, type GuardPolicy } from "./guard.ts";
import type { Transport } from "../transport/types.ts";

export type LogFn = (kind: "tx" | "rx" | "info" | "error", text: string) => void;

export interface SessionOptions {
  timeoutMs?: number;
  retries?: number;
  log?: LogFn;
}

export interface Reply {
  frame: Frame;
  /** Reply identical to what was sent. */
  echo: boolean;
}

interface Pending {
  match: (f: Frame) => boolean;
  resolve: (f: Frame) => void;
}

/**
 * One request in flight, replies matched to requests, timeout and retry, connect/disconnect.
 * Every frame passes the guard before it is written.
 */
export class Session {
  private parser = new FrameParser();
  private pending: Pending | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private timeoutMs: number;
  private retries: number;
  connected = false;
  log: LogFn;

  constructor(readonly transport: Transport, private policy: GuardPolicy & { dev: number }, opts: SessionOptions = {}) {
    this.timeoutMs = opts.timeoutMs ?? 400;
    this.retries = opts.retries ?? 1;
    this.log = opts.log ?? (() => {});
    transport.onData((b) => this.onBytes(b));
  }

  private onBytes(b: Uint8Array): void {
    for (const f of this.parser.push(b)) {
      this.log("rx", frameHex(f));
      if (this.pending && this.pending.match(f)) {
        const p = this.pending;
        this.pending = null;
        p.resolve(f);
      }
    }
  }

  frame(cmd: number, data: number[]): Frame {
    return { id: this.policy.modelId, dev: this.policy.dev, cmd, data };
  }

  /** Queue one request; resolves with the matched reply or rejects after the retries time out. */
  request(cmd: number, data: number[], match?: (f: Frame) => boolean): Promise<Reply> {
    const f = this.frame(cmd, data);
    assertAllowed(f, this.policy); // throw synchronously-ish, before queueing
    const m = match ?? ((r: Frame) => r.cmd === cmd && r.data[0] === data[0]);
    const run = () => this.exchange(f, m);
    const p = this.chain.then(run, run);
    this.chain = p.catch(() => {});
    return p;
  }

  private async exchange(f: Frame, match: (f: Frame) => boolean): Promise<Reply> {
    const bytes = encode(f);
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      const got = new Promise<Frame | null>((resolve) => {
        const t = setTimeout(() => {
          if (this.pending?.resolve === done) this.pending = null;
          resolve(null);
        }, this.timeoutMs);
        const done = (r: Frame) => {
          clearTimeout(t);
          resolve(r);
        };
        this.pending = { match, resolve: done };
      });
      this.log("tx", frameHex(f) + (attempt ? " (retry)" : ""));
      await this.transport.write(bytes);
      const r = await got;
      if (r) return { frame: r, echo: frameHex(r) === frameHex(f) };
    }
    throw new Error(`no reply to ${frameHex(f)}`);
  }

  async connect(): Promise<number> {
    const r = await this.request(0x00, [0, 0, 0, 0, 0, 0, 0, 0], (f) => f.cmd === 0x00);
    this.connected = true;
    const model = r.frame.data[0];
    if (model !== this.policy.modelId) {
      await this.disconnect().catch(() => {});
      throw new Error(`connect reply names model 0x${model.toString(16)}, expected 0x${this.policy.modelId.toString(16)}`);
    }
    this.log("info", "connected");
    return model;
  }

  async disconnect(): Promise<void> {
    try {
      await this.request(0x0f, [0, 0, 0, 0, 0, 0, 0, 0], (f) => f.cmd === 0x0f);
      this.log("info", "disconnected");
    } finally {
      this.connected = false;
    }
  }

  /** Read memory [from, to) with 0x17, 4 bytes per frame. */
  async readMemory(from: number, to: number, onProgress?: (done: number, total: number) => void): Promise<Uint8Array> {
    const out = new Uint8Array(to - from);
    const total = Math.ceil((to - from) / 4);
    let n = 0;
    for (let a = from; a < to; a += 4) {
      const hi = a >> 8,
        lo = a & 0xff;
      const r = await this.request(0x17, [hi, lo, 0, 0, 0, 0, 0, 0], (f) => f.cmd === 0x17 && f.data[0] === hi && f.data[1] === lo);
      const chunk = r.frame.data.slice(2, 6).slice(0, to - a);
      out.set(chunk, a - from);
      onProgress?.(++n, total);
    }
    return out;
  }

  /** Disconnect if connected (errors ignored), then close the transport. */
  async close(): Promise<void> {
    if (this.connected) await this.disconnect().catch((e) => this.log("error", "disconnect failed: " + e));
    await this.transport.close();
  }
}
