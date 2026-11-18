import { DPA240A } from "../src/devices/dpa240a.ts";
import { SimTransport, SIM_DEFAULT_STATE } from "../src/transport/sim.ts";
import { Session } from "../src/protocol/session.ts";
import { DeviceModel } from "../src/model/store.ts";

export const dev = DPA240A;

export function makeSim(opts: { delayMs?: number; silent?: boolean } = {}) {
  return new SimTransport(dev, SIM_DEFAULT_STATE, { delayMs: opts.delayMs ?? 0, silent: opts.silent });
}

export function makeSession(t: SimTransport, timeoutMs = 200, retries = 1) {
  return new Session(t, { modelId: dev.modelId, dev: dev.dev, allowedCommands: dev.allowedCommands, maxChannel: dev.maxChannel }, { timeoutMs, retries });
}

export async function openModel(sim = makeSim()) {
  const s = makeSession(sim);
  await sim.open();
  await s.connect();
  const m = new DeviceModel(dev, s);
  await m.load();
  return { sim, session: s, model: m };
}
