import type { Transport } from "./types.ts";

/** Web Serial API (Edge/Chrome desktop, Chrome Android). 8N1, no flow control, DTR/RTS off. */
export class WebSerialTransport implements Transport {
  readonly name = "usb";
  private port: SerialPort | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  // one writer for the port's lifetime: writes queue in the stream, so an unload disconnect can't hit a held lock
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private dataCbs: ((b: Uint8Array) => void)[] = [];
  private lostCbs: ((r: string) => void)[] = [];
  private closing = false;
  private loop: Promise<void> | null = null;

  constructor(private baudRate: number, private chosen?: SerialPort) {}

  static supported(): boolean {
    return typeof navigator !== "undefined" && "serial" in navigator;
  }

  /** A port this origin was already granted (no prompt), else null. */
  static async grantedPort(): Promise<SerialPort | null> {
    const ports = await navigator.serial.getPorts();
    return ports[0] ?? null;
  }

  /** Shows the browser's port chooser; must be called from a click. */
  static async choosePort(): Promise<SerialPort> {
    return navigator.serial.requestPort({ filters: [{ usbVendorId: 0x0403 }] }).catch(() => navigator.serial.requestPort());
  }

  async open(): Promise<void> {
    const port = this.chosen ?? (await WebSerialTransport.grantedPort()) ?? (await WebSerialTransport.choosePort());
    try {
      await port.open({ baudRate: this.baudRate, dataBits: 8, stopBits: 1, parity: "none", flowControl: "none" });
    } catch (e) {
      // The port can refuse for a moment after another program released it: retry once after 1 s.
      await new Promise((r) => setTimeout(r, 1000));
      await port.open({ baudRate: this.baudRate, dataBits: 8, stopBits: 1, parity: "none", flowControl: "none" });
    }
    await port.setSignals({ dataTerminalReady: false, requestToSend: false });
    this.port = port;
    this.writer = port.writable!.getWriter();
    this.closing = false;
    this.loop = this.readLoop();
  }

  private async readLoop(): Promise<void> {
    const port = this.port!;
    while (port.readable && !this.closing) {
      this.reader = port.readable.getReader();
      try {
        for (;;) {
          const { value, done } = await this.reader.read();
          if (done) break;
          if (value) for (const cb of this.dataCbs) cb(value);
        }
      } catch (e) {
        // framing/parity/break/overrun errors are recoverable: port.readable is replaced and the loop continues.
        // Only a null readable (device gone) is a lost link.
        if (!this.closing && !port.readable) for (const cb of this.lostCbs) cb(String(e));
      } finally {
        this.reader.releaseLock();
        this.reader = null;
      }
    }
  }

  async write(bytes: Uint8Array): Promise<void> {
    if (!this.writer) throw new Error("port not open");
    await this.writer.write(bytes);
  }

  onData(cb: (b: Uint8Array) => void): void {
    this.dataCbs.push(cb);
  }
  onLost(cb: (r: string) => void): void {
    this.lostCbs.push(cb);
  }

  async close(): Promise<void> {
    this.closing = true;
    try {
      await this.reader?.cancel();
    } catch {}
    await this.loop?.catch(() => {});
    try {
      await this.writer?.close();
    } catch {}
    this.writer = null;
    try {
      await this.port?.close();
    } catch {}
    this.port = null;
  }
}
