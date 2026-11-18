/** Byte pipe to the unit. Implementations: Web Serial (browser, USB), WebSocket (Surface bridge / later Pi bridge). */
export interface Transport {
  readonly name: string;
  open(): Promise<void>;
  close(): Promise<void>;
  write(bytes: Uint8Array): Promise<void>;
  /** Called with every chunk received from the unit. */
  onData(cb: (bytes: Uint8Array) => void): void;
  /** Called once if the link drops without close() being called. */
  onLost(cb: (reason: string) => void): void;
}
