import type { Session } from "../protocol/session.ts";
import type { ChannelDef, CommandDef, DeviceDefinition } from "../devices/types.ts";
import { buildData, clamp, commandAddrs, commandFor, fieldOf, readField, writeField } from "../devices/logic.ts";

export interface SetResult {
  channel: string;
  command: string;
  sent: number[];
  echo: boolean;
  /** Every field the command sets: wanted vs read back from the unit. */
  fields: { key: string; wanted: number; readBack: number }[];
  ok: boolean;
}

type Listener = (changedAddrs: number[] | "all") => void;

/**
 * Device model: holds the live-memory image, applies edits by sending one command and
 * re-reading the bytes it touches, so what is shown is what the unit holds.
 */
export class DeviceModel {
  mem: Uint8Array | null = null;
  private listeners: Listener[] = [];
  private latest = new Map<string, Map<string, number>>(); // throttle: pending values per channel/command
  private running = new Set<string>();
  /** load/refresh/apply run one at a time: apply copies memory, sends, and re-reads as one step. */
  private lock: Promise<unknown> = Promise.resolve();
  private locked<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.lock.then(fn, fn);
    this.lock = p.catch(() => {});
    return p;
  }

  constructor(readonly dev: DeviceDefinition, readonly session: Session) {}

  onChange(cb: Listener): () => void {
    this.listeners.push(cb);
    return () => (this.listeners = this.listeners.filter((x) => x !== cb));
  }
  private emit(c: number[] | "all") {
    for (const l of this.listeners) l(c);
  }

  /** 4-byte blocks that disagreed between the two passes of the last verified load (should stay 0). */
  lastDisagreements: number[] = [];

  /**
   * Read the whole live state. With verify, read it twice and re-read every 4-byte block that differs until
   * two reads of it agree (one unreproduced bad read was seen on 18 Nov: whole blocks of zeros).
   */
  load(onProgress?: (done: number, total: number) => void, opts: { verify?: boolean } = {}): Promise<Uint8Array> {
    return this.locked(() => this.loadUnlocked(onProgress, opts));
  }

  private async loadUnlocked(onProgress?: (done: number, total: number) => void, opts: { verify?: boolean } = {}): Promise<Uint8Array> {
    const { liveFrom: from, liveTo: to } = this.dev;
    const total = Math.ceil((to - from) / 4) * (opts.verify ? 2 : 1);
    const a = await this.session.readMemory(from, to, (d) => onProgress?.(d, total));
    if (opts.verify) {
      const b = await this.session.readMemory(from, to, (d) => onProgress?.(d + total / 2, total));
      this.lastDisagreements = [];
      for (let i = 0; i < a.length; i += 4) {
        if (a.slice(i, i + 4).join() === b.slice(i, i + 4).join()) continue;
        this.lastDisagreements.push(from + i);
        this.session.log("error", `read disagreement at 0x${(from + i).toString(16)}: ${a.slice(i, i + 4).join(",")} vs ${b.slice(i, i + 4).join(",")}`);
        let prev = b.slice(i, i + 4).join();
        let settled = false;
        for (let k = 0; k < 4 && !settled; k++) {
          const c = await this.session.readMemory(from + i, Math.min(from + i + 4, to));
          if (c.join() === prev) {
            a.set(c, i);
            settled = true;
          }
          prev = c.join();
        }
        if (!settled) throw new Error(`memory at 0x${(from + i).toString(16)} reads differently every time`);
      }
    }
    this.mem = a;
    this.emit("all");
    return this.mem;
  }

  get(ch: ChannelDef, key: string): number {
    if (!this.mem) throw new Error("state not loaded");
    return readField(this.dev, this.mem, fieldOf(ch, key));
  }

  /** Re-read the 4-byte blocks covering addrs and update the image. */
  refresh(addrs: number[]): Promise<void> {
    return this.locked(() => this.refreshUnlocked(addrs));
  }

  private async refreshUnlocked(addrs: number[]): Promise<void> {
    if (!this.mem) throw new Error("state not loaded");
    const blocks = [...new Set(addrs.map((a) => a & ~3))];
    for (const b of blocks) {
      const end = Math.min(b + 4, this.dev.liveTo);
      const bytes = await this.session.readMemory(b, end);
      this.mem.set(bytes, b - this.dev.liveFrom);
    }
    this.emit(addrs);
  }

  /** Send one command with the given field values (others carried from current memory), then read back. */
  apply(ch: ChannelDef, c: CommandDef, values: Record<string, number>): Promise<SetResult> {
    return this.locked(() => this.applyUnlocked(ch, c, values));
  }

  private async applyUnlocked(ch: ChannelDef, c: CommandDef, values: Record<string, number>): Promise<SetResult> {
    if (!this.mem) throw new Error("state not loaded");
    const img = this.mem.slice();
    const wanted: Record<string, number> = {};
    for (const key of c.sets) {
      const fl = fieldOf(ch, key);
      const v = key in values ? clamp(fl, values[key]) : readField(this.dev, img, fl);
      wanted[key] = v;
      writeField(this.dev, img, fl, v);
    }
    const data = buildData(this.dev, ch, c, img);
    const r = await this.session.request(c.cmd, data);
    await this.refreshUnlocked(commandAddrs(ch, c));
    const fields = c.sets.map((key) => ({ key, wanted: wanted[key], readBack: this.get(ch, key) }));
    return { channel: ch.id, command: c.key, sent: data, echo: r.echo, fields, ok: fields.every((x) => x.wanted === x.readBack) };
  }

  /** Set one field; returns read-back result. */
  set(ch: ChannelDef, key: string, raw: number): Promise<SetResult> {
    const fl = fieldOf(ch, key);
    if (fl.readOnly) throw new Error(`${ch.name} ${fl.label} is read-only`);
    return this.apply(ch, commandFor(ch, key), { [key]: raw });
  }

  /**
   * For slider drags: latest value wins. While a command for this channel+command is in flight,
   * newer values replace the queued one; only the last is sent after it.
   */
  setLatest(ch: ChannelDef, key: string, raw: number, done?: (r: SetResult | Error) => void): void {
    const c = commandFor(ch, key);
    const id = ch.id + "/" + c.key;
    const q = this.latest.get(id) ?? new Map<string, number>();
    q.set(key, raw);
    this.latest.set(id, q);
    if (this.running.has(id)) return;
    this.running.add(id);
    const pump = async () => {
      while (this.latest.get(id)?.size) {
        const vals = Object.fromEntries(this.latest.get(id)!);
        this.latest.delete(id);
        try {
          done?.(await this.apply(ch, c, vals));
        } catch (e) {
          done?.(e as Error);
        }
      }
      this.running.delete(id);
    };
    void pump();
  }
}
