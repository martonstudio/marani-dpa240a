import type { Transport } from "./types.ts";

type WSCtor = new (url: string) => WebSocket;

/**
 * Bridge transport: binary WebSocket to a bridge that owns the serial port
 * (tools/../app/bridge on the Surface now, a Raspberry Pi later). The bridge sends the text
 * message "ready" once the serial port is open, "error: ..." if it cannot open it.
 * Works in the browser (native WebSocket) and in Node (pass the `ws` package's class).
 */
export class WebSocketTransport implements Transport {
  readonly name = "bridge";
  private ws: WebSocket | null = null;
  private dataCbs: ((b: Uint8Array) => void)[] = [];
  private lostCbs: ((r: string) => void)[] = [];
  private closing = false;

  constructor(private url: string, private WS: WSCtor = globalThis.WebSocket as unknown as WSCtor) {}

  open(): Promise<void> {
    this.closing = false;
    return new Promise((resolve, reject) => {
      const ws = new this.WS(this.url);
      ws.binaryType = "arraybuffer";
      let ready = false;
      const timer = setTimeout(() => !ready && (reject(new Error("bridge did not answer")), ws.close()), 8000);
      ws.onmessage = (ev: MessageEvent) => {
        if (typeof ev.data === "string") {
          if (ev.data === "ready") {
            ready = true;
            clearTimeout(timer);
            this.ws = ws;
            resolve();
          } else if (!ready) {
            clearTimeout(timer);
            reject(new Error(ev.data));
          }
          return;
        }
        const b = new Uint8Array(ev.data as ArrayBuffer);
        for (const cb of this.dataCbs) cb(b);
      };
      ws.onerror = () => {
        if (!ready) {
          clearTimeout(timer);
          reject(new Error("cannot reach bridge at " + this.url));
        }
      };
      ws.onclose = (ev: CloseEvent) => {
        if (ready && !this.closing) for (const cb of this.lostCbs) cb("bridge closed: " + (ev.reason || ev.code));
        this.ws = null;
      };
    });
  }

  async write(bytes: Uint8Array): Promise<void> {
    if (!this.ws) throw new Error("bridge not open");
    this.ws.send(bytes);
  }
  onData(cb: (b: Uint8Array) => void): void {
    this.dataCbs.push(cb);
  }
  onLost(cb: (r: string) => void): void {
    this.lostCbs.push(cb);
  }

  close(): Promise<void> {
    this.closing = true;
    const ws = this.ws;
    this.ws = null;
    if (!ws) return Promise.resolve();
    return new Promise((resolve) => {
      ws.onclose = () => resolve();
      ws.close();
      setTimeout(resolve, 1500);
    });
  }
}
