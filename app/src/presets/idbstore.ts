import type { Preset, PresetStore } from "./types.ts";

/** Browser preset store: IndexedDB, one record per preset name. */
export class IdbPresetStore implements PresetStore {
  private db: Promise<IDBDatabase>;
  constructor(dbName = "dpa-presets") {
    this.db = new Promise((resolve, reject) => {
      const r = indexedDB.open(dbName, 1);
      r.onupgradeneeded = () => r.result.createObjectStore("presets", { keyPath: "name" });
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  private async tx<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.db;
    return new Promise((resolve, reject) => {
      const req = f(db.transaction("presets", mode).objectStore("presets"));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async list() {
    return ((await this.tx("readonly", (s) => s.getAllKeys())) as string[]).sort();
  }
  async load(name: string) {
    const p = await this.tx<Preset>("readonly", (s) => s.get(name));
    if (!p) throw new Error("no preset " + name);
    return p;
  }
  async save(p: Preset) {
    await this.tx("readwrite", (s) => s.put(p));
  }
  async remove(name: string) {
    await this.tx("readwrite", (s) => s.delete(name));
  }
}
