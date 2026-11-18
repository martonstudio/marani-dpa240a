#!/usr/bin/env -S npx tsx
/**
 * dpa — command-line driver for the DPA app layers (same protocol/model/preset code as the browser app).
 * Talks to the unit through the bridge WebSocket (default ws://localhost:8240/ws; tools/app.sh opens the tunnel).
 *
 *   state [--json]                 read live state, print decoded values
 *   raw [--out file.bin]           read live state, print hex (or save)
 *   fields [channel]               list channels/fields from the device definition (no unit needed)
 *   get <ch> <field>               read one value
 *   set <ch> <field> <value> ...   set values (raw number, "raw:N", "-3dB", "1k", "LR 24", "on"), show read-back
 *   try <ch> <field> <value>       set, show read-back, restore, confirm restored
 *   selftest [ch ...] [--fields a,b] change and restore every settable field, check read-back and final state
 *   preset list | save <name> | show <name> | diff <name> | push <name> [--all] | export <name> <file> | import <file> | rm <name>
 * Options: --url <ws url>  --log (print frames)  --presets <dir>
 */
import WebSocket from "ws";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { DPA240A } from "../src/devices/dpa240a.ts";
import { channelOf, display, fieldOf, parseValue, readField, readText } from "../src/devices/logic.ts";
import { WebSocketTransport } from "../src/transport/websocket.ts";
import { openDevice } from "../src/core.ts";
import type { DeviceModel, SetResult } from "../src/model/store.ts";
import { FilePresetStore } from "../src/presets/filestore.ts";
import { presetMemory, snapshot, validatePreset } from "../src/presets/types.ts";
import { diffImages, pushImage } from "../src/presets/push.ts";
import { hex } from "../src/protocol/frame.ts";
import type { ChannelDef, Field } from "../src/devices/types.ts";

const dev = DPA240A;
const argv = process.argv.slice(2);
const opt = (name: string, def?: string) => {
  const i = argv.indexOf("--" + name);
  if (i < 0) return def;
  const v = argv[i + 1];
  argv.splice(i, 2);
  return v;
};
const flag = (name: string) => {
  const i = argv.indexOf("--" + name);
  if (i >= 0) argv.splice(i, 1);
  return i >= 0;
};
const here = path.dirname(fileURLToPath(import.meta.url));
const URL_ = opt("url", process.env.DPA_URL ?? "ws://localhost:8240/ws")!;
const store = new FilePresetStore(opt("presets", path.join(here, "..", "presets-local"))!);
const LOG = flag("log");
const JSON_OUT = flag("json");

let model: DeviceModel | null = null;
async function open(): Promise<DeviceModel> {
  const t = new WebSocketTransport(URL_, WebSocket as unknown as new (u: string) => globalThis.WebSocket);
  model = await openDevice(dev, t, LOG ? (k, s) => console.error(`${k.padEnd(5)} ${s}`) : undefined);
  return model;
}
async function shutdown() {
  if (model) {
    const m = model;
    model = null;
    await m.session.close();
  }
}
for (const sig of ["SIGINT", "SIGTERM"] as const)
  process.on(sig, () => {
    console.error("interrupted: disconnecting");
    shutdown().finally(() => process.exit(130));
  });

const fmtField = (ch: ChannelDef, fl: Field, mem: Uint8Array) =>
  fl.scale.kind === "text" ? JSON.stringify(readText(dev, mem, fl)) : `${display(fl, readField(dev, mem, fl))}${fl.scale.kind === "linear" || fl.scale.kind === "freq" ? ` (${readField(dev, mem, fl)})` : ""}`;

function describe(mem: Uint8Array): string {
  const lines = [`preset name: ${readText(dev, mem, dev.globals[0])}`];
  for (const ch of dev.channels) {
    const groups = new Map<string, string[]>();
    for (const fl of ch.fields) {
      const g = fl.group.startsWith("peq") ? "peq" : fl.group;
      if (!groups.has(g)) groups.set(g, []);
      if (g === "peq") continue;
      groups.get(g)!.push(`${fl.label} ${fmtField(ch, fl, mem)}`);
    }
    const bands = ch.fields.filter((f) => f.key.endsWith(".freq") && f.group.startsWith("peq")).map((f) => {
      const g = f.group;
      const v = (k: string) => display(fieldOf(ch, `${g}.${k}`), readField(dev, mem, fieldOf(ch, `${g}.${k}`)));
      return `${g.slice(3)}:${v("freq")}/${v("bw")}/${v("gain")}`;
    });
    groups.set("peq", bands);
    lines.push(`${ch.name} [${ch.id}, chn ${ch.chn}]`);
    for (const [g, items] of groups) lines.push(`  ${g.padEnd(8)} ${items.join("  |  ")}`);
  }
  return lines.join("\n");
}

function fmtSet(r: SetResult): string {
  return `${r.channel} ${r.command}: sent [${hex(r.sent)}] echo ${r.echo ? "ok" : "DIFFERENT"}; ` + r.fields.map((f) => `${f.key} want ${f.wanted} read ${f.readBack}`).join(", ") + ` -> ${r.ok ? "OK" : "MISMATCH"}`;
}

/** A different valid value to test with. */
function testValue(fl: Field, v: number): number {
  const s = fl.scale;
  if (s.kind === "bool") return v ? 0 : 1;
  if (s.kind === "enum") {
    const opts = s.options.map((o) => o.raw).filter((r) => r !== v);
    return opts.includes(v + 1) ? v + 1 : opts[0];
  }
  const step = Math.max(1, Math.round((fl.max - fl.min) / 10));
  return v + step <= fl.max ? v + step : v - step;
}

async function selftest(ids: string[], only?: string[]): Promise<boolean> {
  const m = await open();
  let ok = true;
  try {
    await m.load(undefined, { verify: true });
    const start = m.mem!.slice();
    const chans = ids.length ? ids.map((i) => channelOf(dev, i)) : dev.channels;
    for (const ch of chans) {
      for (const c of ch.commands) {
        for (const key of c.sets) {
          if (only && !only.includes(key)) continue;
          const fl = fieldOf(ch, key);
          const orig = m.get(ch, key);
          const tv = testValue(fl, orig);
          const r1 = await m.set(ch, key, tv);
          const r2 = await m.set(ch, key, orig);
          const pass = r1.ok && r1.echo && r2.ok;
          ok &&= pass;
          console.log(`${pass ? "PASS" : "FAIL"} ${ch.id.padEnd(5)} ${key.padEnd(14)} ${display(fl, orig)} -> ${display(fl, tv)} read ${display(fl, r1.fields.find((x) => x.key === key)!.readBack)} echo ${r1.echo ? "ok" : "NO"}, restored ${r2.ok ? "yes" : "NO"}`);
        }
      }
    }
    await m.load(undefined, { verify: true });
    const d = diffImages(dev, m.mem!, start);
    const sameBytes = hex(m.mem!) === hex(start);
    console.log(`final state identical to start: ${sameBytes}${sameBytes ? "" : " " + JSON.stringify(d)}`);
    ok &&= sameBytes;
    console.log("SELFTEST " + (ok ? "PASS" : "FAIL"));
  } finally {
    await shutdown();
  }
  return ok;
}

async function main(): Promise<number> {
  const [cmd, ...a] = argv;
  switch (cmd) {
    case "fields": {
      for (const ch of a.length ? [channelOf(dev, a[0])] : dev.channels) {
        console.log(`${ch.name} [${ch.id}] chn ${ch.chn}`);
        for (const fl of ch.fields)
          console.log(`  ${fl.key.padEnd(14)} @0x${fl.addr.toString(16).padStart(4, "0")}${fl.bit !== undefined ? "." + fl.bit : ""} ${fl.min}..${fl.max} ${fl.scale.kind}${fl.readOnly ? " read-only" : ""}${fl.verified ? "" : " UNVERIFIED"}${fl.note ? "  (" + fl.note + ")" : ""}`);
      }
      return 0;
    }
    case "state":
    case "raw": {
      const m = await open();
      try {
        const t0 = Date.now();
        await m.load(process.stderr.isTTY ? (d, t) => process.stderr.write(`\rreading ${d}/${t}`) : undefined, { verify: flag("verify") });
        if (m.lastDisagreements.length) console.error("read disagreements (resolved): " + m.lastDisagreements.map((x) => x.toString(16)).join(" "));
        process.stderr.write(` (${((Date.now() - t0) / 1000).toFixed(1)} s)\n`);
        const mem = m.mem!;
        const out = opt("out");
        if (cmd === "raw") {
          if (out) await fs.writeFile(out, mem);
          else for (let i = 0; i < mem.length; i += 16) console.log(`${(dev.liveFrom + i).toString(16).padStart(4, "0")}: ${hex(mem.slice(i, i + 16))}`);
        } else if (JSON_OUT) console.log(JSON.stringify(snapshot(dev, mem, "state").values, null, 1));
        else console.log(describe(mem));
      } finally {
        await shutdown();
      }
      return 0;
    }
    case "get": {
      const ch = channelOf(dev, a[0]);
      const fl = fieldOf(ch, a[1]);
      const m = await open();
      try {
        await m.load();
        console.log(`${ch.name} ${fl.label}: ${fmtField(ch, fl, m.mem!)}`);
      } finally {
        await shutdown();
      }
      return 0;
    }
    case "set":
    case "try": {
      if (a.length < 3 || a.length % 3) throw new Error("usage: set <ch> <field> <value> [<ch> <field> <value> ...]");
      const m = await open();
      let ok = true;
      try {
        await m.load();
        for (let i = 0; i < a.length; i += 3) {
          const ch = channelOf(dev, a[i]);
          const fl = fieldOf(ch, a[i + 1]);
          const orig = m.get(ch, fl.key);
          const v = parseValue(fl, a[i + 2]);
          const r = await m.set(ch, fl.key, v);
          ok &&= r.ok;
          console.log(`${fmtSet(r)}   (${display(fl, orig)} -> ${display(fl, m.get(ch, fl.key))})`);
          if (cmd === "try") {
            const r2 = await m.set(ch, fl.key, orig);
            ok &&= r2.ok;
            console.log(`  restore: ${fmtSet(r2)}`);
          }
        }
      } finally {
        await shutdown();
      }
      return ok ? 0 : 1;
    }
    case "selftest": {
      const only = opt("fields")?.split(",");
      return (await selftest(a, only)) ? 0 : 1;
    }
    case "preset": {
      const [sub, name, file] = a;
      switch (sub) {
        case "list":
          for (const n of await store.list()) {
            const p = await store.load(n);
            console.log(`${n}  (${p.created})`);
          }
          return 0;
        case "show":
          console.log(describe(presetMemory(validatePreset(dev, await store.load(name)))));
          return 0;
        case "rm":
          await store.remove(name);
          return 0;
        case "export":
          await fs.writeFile(file, JSON.stringify(await store.load(name), null, 2));
          return 0;
        case "import": {
          const p = validatePreset(dev, JSON.parse(await fs.readFile(name, "utf8")));
          await store.save(p);
          console.log("imported " + p.name);
          return 0;
        }
      }
      const m = await open();
      try {
        await m.load(undefined, { verify: true });
        if (m.lastDisagreements.length) console.error("read disagreements (resolved): " + m.lastDisagreements.map((x) => x.toString(16)).join(" "));
        if (sub === "save") {
          await store.save(snapshot(dev, m.mem!, name));
          console.log(`saved ${name}`);
        } else if (sub === "diff") {
          const d = diffImages(dev, m.mem!, presetMemory(validatePreset(dev, await store.load(name))));
          console.log(d.length ? d.map((x) => `${x.channel} ${x.key}: unit ${x.a} preset ${x.b}${x.settable ? "" : " (not settable)"}`).join("\n") : "unit matches preset");
        } else if (sub === "push") {
          const target = presetMemory(validatePreset(dev, await store.load(name)));
          const rep = await pushImage(m, target, { all: flag("all") || a.includes("--all"), onProgress: (d, t, l) => process.stderr.write(`\r${d}/${t} ${l}`.padEnd(50)) });
          process.stderr.write("\n");
          for (const r of rep.sent) if (!r.ok) console.log("MISMATCH " + fmtSet(r));
          console.log(`sent ${rep.sent.length} commands; still different after full read-back: ${rep.remaining.length}; not settable: ${rep.notPushed.length}`);
          for (const x of [...rep.remaining, ...rep.notPushed]) console.log(`  ${x.channel} ${x.key}: unit ${x.a} preset ${x.b}${x.settable ? "" : " (not settable)"}`);
          return rep.remaining.length ? 1 : 0;
        } else throw new Error("unknown preset command " + sub);
      } finally {
        await shutdown();
      }
      return 0;
    }
    default:
      console.log(fs ? (await fs.readFile(fileURLToPath(import.meta.url), "utf8")).split("*/")[0].replace("#!/usr/bin/env -S npx tsx\n", "") : "");
      return cmd ? 2 : 0;
  }
}

main().then(
  (code) => process.exit(code),
  async (e) => {
    console.error("error: " + (e instanceof Error ? e.message : e));
    await shutdown().catch(() => {});
    process.exit(1);
  },
);
