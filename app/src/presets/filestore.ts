import { promises as fs } from "node:fs";
import * as path from "node:path";
import type { Preset, PresetStore } from "./types.ts";

/** Node preset store: one JSON file per preset in a folder (CLI). */
export class FilePresetStore implements PresetStore {
  constructor(private dir: string) {}
  private file(name: string) {
    return path.join(this.dir, name.replace(/[^\w.-]+/g, "_") + ".json");
  }
  async list() {
    try {
      return (await fs.readdir(this.dir)).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)).sort();
    } catch {
      return [];
    }
  }
  async load(name: string): Promise<Preset> {
    return JSON.parse(await fs.readFile(this.file(name), "utf8"));
  }
  async save(p: Preset) {
    await fs.mkdir(this.dir, { recursive: true });
    await fs.writeFile(this.file(p.name), JSON.stringify(p, null, 2));
  }
  async remove(name: string) {
    await fs.unlink(this.file(name));
  }
}
