import type { ChannelDef, DeviceDefinition, Field } from "../devices/types.ts";
import { physical, readField } from "../devices/logic.ts";

/**
 * Display-only frequency response. Approximate: the unit's exact filter shapes and the BW index scale are not
 * measured beyond two points (9 = 0.30 oct, 20 = 0.85 oct), so this is a guide, not a measurement.
 */

/** BW index -> bandwidth in octaves (linear fit through the two measured points), floor 0.02. */
export function bwOctaves(idx: number): number {
  return Math.max(0.02, 0.05 * (idx - 3));
}

/** Peaking (bell) filter magnitude in dB, analog prototype (RBJ form), gain dB, centre f0, bandwidth in octaves. */
export function peakingDb(f: number, f0: number, gainDb: number, bwOct: number): number {
  if (gainDb === 0) return 0;
  const A = Math.pow(10, gainDb / 40);
  const p = Math.pow(2, bwOct);
  const Q = Math.sqrt(p) / (p - 1);
  const w = f / f0;
  // H(jw) = (1 - w^2 + j w A/Q) / (1 - w^2 + j w /(A Q))
  const re = 1 - w * w;
  const num = re * re + (w * A / Q) ** 2;
  const den = re * re + (w / (A * Q)) ** 2;
  return 10 * Math.log10(num / den);
}

export interface Slope {
  family: "off" | "BW" | "LR" | "BS";
  order: number; // overall order (dB/oct / 6)
  /** Shape not known (e.g. "Slope 8", unnamed option): drawn as LR 24. */
  unknown?: boolean;
}

/** From an enum label like "LR 24", "BW 6", "Off". BS (Bessel) is drawn as Butterworth of the same order. */
export function parseSlope(label: string): Slope {
  const t = label.trim();
  const m = /^(BW|LR|BS)\s*(\d+)/i.exec(t);
  if (m) return { family: m[1].toUpperCase() as Slope["family"], order: Math.round(Number(m[2]) / 6) };
  if (t === "" || /^off$/i.test(t)) return { family: "off", order: 0 };
  return { family: "LR", order: 4, unknown: true };
}

function butterDb(ratio: number, n: number): number {
  // ratio = f/fc for low-pass, fc/f for high-pass
  return -10 * Math.log10(1 + Math.pow(ratio, 2 * n));
}

/** HPF/LPF magnitude in dB. LR of order 2m = Butterworth m squared. */
export function passDb(f: number, fc: number, s: Slope, kind: "hpf" | "lpf"): number {
  if (s.family === "off" || s.order === 0) return 0;
  const ratio = kind === "lpf" ? f / fc : fc / f;
  if (s.family === "LR") return 2 * butterDb(ratio, Math.max(1, s.order / 2));
  return butterDb(ratio, s.order);
}

export interface Band {
  group: string; // "peq1"
  freqField: Field;
  bwField: Field;
  gainField: Field;
}

export interface EqShape {
  bands: Band[];
  hpf?: { freq: Field; slope: Field };
  lpf?: { freq: Field; slope: Field };
}

/** Find PEQ bands and crossover filters in a channel by field keys (definition-driven). */
export function eqShape(ch: ChannelDef): EqShape {
  const by = (k: string) => ch.fields.find((x) => x.key === k);
  const groups = [...new Set(ch.fields.filter((x) => /^peq\d+$/.test(x.group)).map((x) => x.group))];
  const bands: Band[] = [];
  for (const g of groups) {
    const fr = by(`${g}.freq`), bw = by(`${g}.bw`), ga = by(`${g}.gain`);
    if (fr && bw && ga) bands.push({ group: g, freqField: fr, bwField: bw, gainField: ga });
  }
  const pair = (p: string) => {
    const fr = by(`${p}.freq`), sl = by(`${p}.slope`);
    return fr && sl ? { freq: fr, slope: sl } : undefined;
  };
  return { bands, hpf: pair("hpf"), lpf: pair("lpf") };
}

function enumLabel(fl: Field, raw: number): string {
  return fl.scale.kind === "enum" ? fl.scale.options.find((o) => o.raw === raw)?.label ?? "" : "";
}

export interface ResolvedEq {
  bands: { f0: number; gain: number; bwOct: number }[];
  hpf?: { fc: number; slope: Slope };
  lpf?: { fc: number; slope: Slope };
}

export function resolveEq(dev: DeviceDefinition, mem: Uint8Array, shape: EqShape): ResolvedEq {
  const rd = (fl: Field) => readField(dev, mem, fl);
  return {
    bands: shape.bands.map((b) => ({ f0: physical(b.freqField, rd(b.freqField)), gain: physical(b.gainField, rd(b.gainField)), bwOct: bwOctaves(rd(b.bwField)) })),
    hpf: shape.hpf && { fc: physical(shape.hpf.freq, rd(shape.hpf.freq)), slope: parseSlope(enumLabel(shape.hpf.slope, rd(shape.hpf.slope))) },
    lpf: shape.lpf && { fc: physical(shape.lpf.freq, rd(shape.lpf.freq)), slope: parseSlope(enumLabel(shape.lpf.slope, rd(shape.lpf.slope))) },
  };
}

/** Combined response in dB at f. */
export function responseDb(eq: ResolvedEq, f: number): number {
  let db = 0;
  for (const b of eq.bands) db += peakingDb(f, b.f0, b.gain, b.bwOct);
  if (eq.hpf) db += passDb(f, eq.hpf.fc, eq.hpf.slope, "hpf");
  if (eq.lpf) db += passDb(f, eq.lpf.fc, eq.lpf.slope, "lpf");
  return db;
}
