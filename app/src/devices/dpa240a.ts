import type { ChannelDef, CommandDef, DeviceDefinition, Field, Scale } from "./types.ts";

/**
 * DPA240A (early dialect, firmware V1.05). Every fact here comes from PLAN.md's command table and value scales;
 * `verified` marks what has been set and read back on the real unit.
 */

const FREQ: Scale = { kind: "freq", base: 20, perOctave: 24 };
const GAIN: Scale = { kind: "linear", mul: 0.1, add: -12, unit: "dB", digits: 1 }; // 0x78 = 0.0 dB; unit takes 0..180 (-12..+6 dB, clamps above)
const PEQ_GAIN: Scale = { kind: "linear", mul: 0.5, add: -15, unit: "dB", digits: 1 }; // 30 = 0 dB
const BW: Scale = { kind: "index", known: { 9: "0.30", 20: "0.85" }, unit: "oct" };
const SLOPE: Scale = {
  kind: "enum",
  options: [
    { raw: 0, label: "Off" },
    { raw: 1, label: "BW 6" },
    { raw: 2, label: "BW 12" },
    { raw: 3, label: "LR 12" },
    { raw: 4, label: "BS 12" },
    { raw: 5, label: "BW 18" },
    { raw: 6, label: "BW 24" },
    { raw: 7, label: "LR 24" },
    { raw: 8, label: "Slope 8" }, // accepted by the unit (clamps above 8); name unknown
  ],
};
const SOURCE: Scale = {
  kind: "enum",
  options: [
    { raw: 0, label: "In A" },
    { raw: 1, label: "In B" },
    { raw: 2, label: "In A+B" },
  ],
};
const ATTACK: Scale = { kind: "index", known: { 5: "10 ms", 19: "50 ms" } };
const RELEASE: Scale = { kind: "linear", mul: 0.1, add: 0.1, unit: "s", digits: 1 }; // 0.1 s * (raw+1)
const THRESH: Scale = { kind: "linear", mul: 0.2, add: -10, unit: "dBu", digits: 1 };
// Delay: coarse = 1 ms, fine = 1/48 ms (one sample at 48 kHz). Derived from the unit clamping fine at 48 and one panel
// reading (coarse 1 + fine 5 = 0.375 m = 1.104 ms at 340 m/s); not yet checked on the panel in ms.
const DELAY_COARSE: Scale = { kind: "linear", mul: 1, add: 0, unit: "ms", digits: 0 };
const DELAY_FINE: Scale = { kind: "linear", mul: 1 / 48, add: 0, unit: "ms", digits: 3 };

const f = (key: string, label: string, group: string, addr: number, min: number, max: number, scale: Scale, verified: boolean, extra: Partial<Field> = {}): Field => ({
  key, label, group, addr, min, max, scale, verified, ...extra,
});
const cmd = (key: string, c: number, data: CommandDef["data"], sets: string[]): CommandDef => ({ key, cmd: c, data, sets });

function peqFields(base: number, bands: number, verified: boolean): { fields: Field[]; commands: CommandDef[] } {
  const fields: Field[] = [];
  const commands: CommandDef[] = [];
  for (let b = 0; b < bands; b++) {
    const g = `peq${b + 1}`;
    const a = base + 3 * b;
    fields.push(
      f(`${g}.freq`, "Freq", g, a, 0, 240, FREQ, verified),
      f(`${g}.bw`, "BW", g, a + 1, 0, 63, BW, verified, { note: "bandwidth index 0..63 (unit clamps at 63); only 9 = 0.30 and 20 = 0.85 measured" }),
      f(`${g}.gain`, "Gain", g, a + 2, 0, 60, PEQ_GAIN, verified),
    );
    commands.push(cmd(g, 0x05, ["chn", b, 0, 0, 0, { field: `${g}.freq` }, { field: `${g}.bw` }, { field: `${g}.gain` }], [`${g}.freq`, `${g}.bw`, `${g}.gain`]));
  }
  return { fields, commands };
}

function muteField(chn: number, verified: boolean): Field {
  return f("mute", "Mute", "main", 0x158, 0, 1, { kind: "bool", off: "Live", on: "Muted" }, verified, { bit: chn });
}
const muteCmd = cmd("mute", 0x09, ["chn", 0, 0, 0, 0, 0, 0, { field: "mute" }], ["mute"]);

function input(chn: number, id: string, name: string): ChannelDef {
  const o = 0x40 + 0x13 * chn;
  const peq = peqFields(o + 4, 5, true);
  return {
    chn, id, name, kind: "input",
    fields: [
      muteField(chn, true),
      f("gain", "Gain", "main", o, 0, 180, GAIN, true),
      f("delay.coarse", "Delay coarse", "delay", o + 1, 0, 848, DELAY_COARSE, true, { size: 2, note: "1 ms per step (derived, see DELAY_COARSE); unit clamps at 848" }),
      f("delay.fine", "Delay fine", "delay", o + 3, 0, 48, DELAY_FINE, true),
      ...peq.fields,
    ],
    commands: [
      muteCmd,
      cmd("gain", 0x01, ["chn", 0, 0, 0, 0, 0, 0, { field: "gain" }], ["gain"]),
      cmd("delay", 0x02, ["chn", 0, 0, 0, 0, { field: "delay.coarse", byte: 0 }, { field: "delay.coarse", byte: 1 }, { field: "delay.fine" }], ["delay.coarse", "delay.fine"]),
      ...peq.commands,
    ],
  };
}

function output(chn: number): ChannelDef {
  const o = 0x66 + 0x28 * (chn - 2);
  const peq = peqFields(o + 13, 7, true);
  return {
    chn, id: `out${chn - 1}`, name: `Out ${chn - 1}`, kind: "output",
    fields: [
      f("name", "Name", "main", o + 34, 0, 0, { kind: "text" }, true, { size: 6, readOnly: true }),
      muteField(chn, true),
      f("source", "Source", "main", o, 0, 2, SOURCE, true),
      f("gain", "Gain", "main", o + 1, 0, 180, GAIN, true),
      f("phase", "Phase", "main", o + 8, 0, 1, { kind: "bool", off: "Normal", on: "Invert" }, true),
      f("delay.coarse", "Delay coarse", "delay", o + 5, 0, 848, DELAY_COARSE, true, { size: 2, note: "1 ms per step (derived, see DELAY_COARSE); unit clamps at 848" }),
      f("delay.fine", "Delay fine", "delay", o + 7, 0, 48, DELAY_FINE, true),
      f("hpf.freq", "HPF freq", "xover", o + 9, 0, 240, FREQ, true),
      f("hpf.slope", "HPF slope", "xover", o + 10, 0, 8, SLOPE, true),
      f("lpf.freq", "LPF freq", "xover", o + 11, 0, 240, FREQ, true),
      f("lpf.slope", "LPF slope", "xover", o + 12, 0, 8, SLOPE, true),
      f("lim.attack", "Attack", "limiter", o + 2, 0, 29, ATTACK, true, { note: "index; 5 = 10 ms, 19 = 50 ms measured" }),
      f("lim.release", "Release", "limiter", o + 3, 0, 29, RELEASE, true),
      f("lim.threshold", "Threshold", "limiter", o + 4, 0, 150, THRESH, true),
      ...peq.fields,
    ],
    commands: [
      muteCmd,
      cmd("source", 0x08, ["chn", 0, 0, 0, 0, 0, 0, { field: "source" }], ["source"]),
      cmd("gain", 0x01, ["chn", 0, 0, 0, 0, 0, 0, { field: "gain" }], ["gain"]),
      // 0x03 writes D7 into the gain byte too: carry the current gain.
      cmd("phase", 0x03, ["chn", 0, 0, 0, 0, 0, { field: "phase" }, { field: "gain" }], ["phase"]),
      cmd("delay", 0x02, ["chn", 0, 0, 0, 0, { field: "delay.coarse", byte: 0 }, { field: "delay.coarse", byte: 1 }, { field: "delay.fine" }], ["delay.coarse", "delay.fine"]),
      cmd("hpf", 0x04, ["chn", 0, 0, 0, 0, 0, { field: "hpf.freq" }, { field: "hpf.slope" }], ["hpf.freq", "hpf.slope"]),
      cmd("lpf", 0x04, ["chn", 1, 0, 0, 0, 0, { field: "lpf.freq" }, { field: "lpf.slope" }], ["lpf.freq", "lpf.slope"]),
      cmd("limiter", 0x07, ["chn", 0, 0, 0, 0, { field: "lim.attack" }, { field: "lim.release" }, { field: "lim.threshold" }], ["lim.attack", "lim.release", "lim.threshold"]),
      ...peq.commands,
    ],
  };
}

export const DPA240A: DeviceDefinition = {
  name: "DPA240A",
  modelId: 0xc1,
  dev: 0,
  baudRate: 9600,
  liveFrom: 0x0000,
  liveTo: 0x0160,
  allowedCommands: [0x00, 0x0f, 0x01, 0x02, 0x03, 0x04, 0x05, 0x07, 0x08, 0x09, 0x17],
  maxChannel: 5,
  globals: [f("presetName", "Preset", "global", 0x0000, 0, 0, { kind: "text" }, true, { size: 16, readOnly: true })],
  channels: [input(0, "inA", "In A"), input(1, "inB", "In B"), output(2), output(3), output(4), output(5)],
};
