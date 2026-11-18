import { Session, type LogFn } from "./protocol/session.ts";
import { DeviceModel } from "./model/store.ts";
import type { DeviceDefinition } from "./devices/types.ts";
import type { Transport } from "./transport/types.ts";

/** Wire transport -> session -> model for a device. Shared by the browser app and the CLI. */
export async function openDevice(dev: DeviceDefinition, transport: Transport, log?: LogFn): Promise<DeviceModel> {
  const session = new Session(transport, { modelId: dev.modelId, dev: dev.dev, allowedCommands: dev.allowedCommands, maxChannel: dev.maxChannel }, { log });
  await transport.open();
  try {
    await session.connect();
  } catch (e) {
    await session.close().catch(() => {});
    throw e;
  }
  return new DeviceModel(dev, session);
}
