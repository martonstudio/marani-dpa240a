import type { Frame } from "./frame.ts";

/** Never sent, whatever the device definition says (unknown or store/firmware-class commands). */
export const FORBIDDEN = new Set([0x28, 0x18, 0x10, 0x24]);
/** 0x17 reads at or above this address hang the unit. */
export const MEMORY_LIMIT = 0x2000;

export interface GuardPolicy {
  modelId: number;
  allowedCommands: number[];
  /** Highest channel byte (D0) allowed for parameter commands; 6..11 on 0x09 mute everything on this unit. */
  maxChannel: number;
}

export class GuardError extends Error {}

export function assertAllowed(f: Frame, p: GuardPolicy): void {
  const c = f.cmd;
  if (FORBIDDEN.has(c)) throw new GuardError(`command 0x${c.toString(16)} is forbidden`);
  if (!p.allowedCommands.includes(c)) throw new GuardError(`command 0x${c.toString(16)} is not on the allowed list`);
  if (f.id !== p.modelId) throw new GuardError(`model id 0x${f.id.toString(16)} is not this unit's`);
  if (c === 0x17) {
    const addr = (f.data[0] << 8) | f.data[1];
    if (addr >= MEMORY_LIMIT) throw new GuardError(`read at 0x${addr.toString(16)} is at or above 0x2000`);
  } else if (c !== 0x00 && c !== 0x0f) {
    if (f.data[0] > p.maxChannel) throw new GuardError(`channel byte ${f.data[0]} out of range`);
  }
}
