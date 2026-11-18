/** A unit described as data: channels, fields (where each value lives in live memory) and the commands that set them. */

export type Scale =
  | { kind: "linear"; mul: number; add: number; unit: string; digits: number } // value = raw*mul + add
  | { kind: "freq"; base: number; perOctave: number } // Hz = base * 2^(raw/perOctave)
  | { kind: "enum"; options: { raw: number; label: string }[] }
  | { kind: "index"; known: Record<number, string>; unit?: string } // raw index; known display values where measured
  | { kind: "bool"; off: string; on: string }
  | { kind: "text" } // ASCII, read-only
  | { kind: "raw" };

export interface Field {
  key: string; // e.g. "gain", "peq3.freq"
  label: string;
  group: string; // UI grouping: "main", "delay", "limiter", "xover", "peq1"...
  addr: number; // absolute live-memory address
  size?: number; // bytes, big-endian (default 1); for text: length
  bit?: number; // value is this bit of the byte at addr (0/1)
  min: number;
  max: number;
  scale: Scale;
  readOnly?: boolean;
  /** Set + read-back seen on the real unit. */
  verified: boolean;
  note?: string;
}

/** One data byte of a command: a constant, the channel byte, or (one byte of) a field's current value. */
export type ByteSource = number | "chn" | { field: string; byte?: number }; // byte: 0 = most significant

export interface CommandDef {
  key: string;
  cmd: number;
  data: ByteSource[]; // 8 entries
  /** Fields this command is meant to set (others in data are carried along with their current value). */
  sets: string[];
}

export interface ChannelDef {
  chn: number; // channel byte D0
  id: string; // "inA", "out1"
  name: string; // "In A", "Out 1"
  kind: "input" | "output";
  fields: Field[];
  commands: CommandDef[];
}

export interface DeviceDefinition {
  name: string;
  modelId: number;
  dev: number;
  baudRate: number;
  liveFrom: number;
  liveTo: number;
  allowedCommands: number[];
  maxChannel: number;
  globals: Field[]; // read-only unit-wide fields (current preset name...)
  channels: ChannelDef[];
}
