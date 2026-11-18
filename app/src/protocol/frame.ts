/** Marani early dialect: 13-byte frames  f0 <id> <dev> <cmd> D0..D7 f7. */
export const STX = 0xf0;
export const ETX = 0xf7;
export const FRAME_LEN = 13;

export interface Frame {
  id: number;
  dev: number;
  cmd: number;
  data: number[]; // exactly 8
}

export function encode(f: Frame): Uint8Array {
  if (f.data.length !== 8) throw new Error("frame needs 8 data bytes");
  const out = new Uint8Array(FRAME_LEN);
  out[0] = STX;
  out[1] = f.id;
  out[2] = f.dev;
  out[3] = f.cmd;
  f.data.forEach((b, i) => {
    if (!Number.isInteger(b) || b < 0 || b > 255) throw new Error(`data byte ${i} out of range: ${b}`);
    out[4 + i] = b;
  });
  out[12] = ETX;
  return out;
}

export function decode(b: ArrayLike<number>): Frame {
  return { id: b[1], dev: b[2], cmd: b[3], data: Array.from({ length: 8 }, (_, i) => b[4 + i]) };
}

/** Reassembles frames from an arbitrary byte stream; drops bytes that do not form a frame. */
export class FrameParser {
  private buf: number[] = [];
  push(bytes: ArrayLike<number>): Frame[] {
    for (let i = 0; i < bytes.length; i++) this.buf.push(bytes[i]);
    const out: Frame[] = [];
    for (;;) {
      const s = this.buf.indexOf(STX);
      if (s < 0) {
        this.buf.length = 0;
        break;
      }
      if (s > 0) this.buf.splice(0, s);
      if (this.buf.length < FRAME_LEN) break;
      if (this.buf[FRAME_LEN - 1] === ETX) {
        out.push(decode(this.buf.splice(0, FRAME_LEN)));
      } else {
        this.buf.splice(0, 1);
      }
    }
    return out;
  }
  reset(): void {
    this.buf.length = 0;
  }
}

export const hex = (b: ArrayLike<number>): string => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join(" ");
export const frameHex = (f: Frame): string => hex(encode(f));
