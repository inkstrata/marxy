// Config.toml parsing and byte-preserving top-level edits (docs/design/11-config-and-storage.md). MARXY-47 adds setTopLevelKey.

import { parse } from 'smol-toml';

export interface Config {
  readonly theme: string | null;
  readonly variant: 'dark' | 'light' | 'auto';
  readonly size: number;
  readonly measure: number;
  readonly typeset: boolean;
  readonly lineNumbers: boolean;
  readonly externalEditor: string | null;
  readonly resident: boolean;
  readonly linuxWeightOffset: number | null;
}

export interface ParseConfigResult {
  readonly config: Config;
  readonly unknownKeys: readonly string[];
  readonly warnings: readonly string[];
}

const DEFAULTS: Config = {
  theme: null,
  variant: 'dark',
  size: 20,
  measure: 66,
  typeset: true,
  lineNumbers: false,
  externalEditor: null,
  resident: false,
  linuxWeightOffset: null,
};

const KNOWN = new Set([
  'theme',
  'variant',
  'size',
  'measure',
  'typeset',
  'line_numbers',
  'external_editor',
  'resident',
  'linux',
]);

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/** Parses config.toml bytes; unknown keys are listed, invalid values fall back with warnings. */
export function parseConfig(bytes: Uint8Array): ParseConfigResult {
  const text = new TextDecoder().decode(bytes);
  const warnings: string[] = [];
  let raw: Record<string, unknown> = {};
  if (text.trim() !== '') {
    try {
      raw = parse(text) as Record<string, unknown>;
    } catch {
      warnings.push('config.toml could not be parsed; using defaults');
      return { config: DEFAULTS, unknownKeys: [], warnings };
    }
  }
  const unknownKeys = Object.keys(raw).filter((k) => !KNOWN.has(k));
  let theme: string | null = DEFAULTS.theme;
  if (typeof raw.theme === 'string') theme = raw.theme;

  let variant: Config['variant'] = DEFAULTS.variant;
  if (raw.variant === 'light' || raw.variant === 'dark' || raw.variant === 'auto') variant = raw.variant;
  else if (raw.variant !== undefined) warnings.push('variant was invalid; using dark');

  let size = DEFAULTS.size;
  if (typeof raw.size === 'number') size = clamp(Math.round(raw.size), 15, 50);
  else if (raw.size !== undefined) warnings.push('size was invalid; using 20');

  let measure = DEFAULTS.measure;
  if (typeof raw.measure === 'number') measure = clamp(Math.round(raw.measure), 45, 80);
  else if (raw.measure !== undefined) warnings.push('measure was invalid; using 66');

  let typeset = DEFAULTS.typeset;
  if (typeof raw.typeset === 'boolean') typeset = raw.typeset;
  else if (raw.typeset !== undefined) warnings.push('typeset was invalid; using true');

  let lineNumbers = DEFAULTS.lineNumbers;
  if (typeof raw.line_numbers === 'boolean') lineNumbers = raw.line_numbers;
  else if (raw.line_numbers !== undefined) warnings.push('line_numbers was invalid; using false');

  let externalEditor: string | null = DEFAULTS.externalEditor;
  if (typeof raw.external_editor === 'string') externalEditor = raw.external_editor;
  else if (raw.external_editor !== undefined) warnings.push('external_editor was invalid; ignored');

  let resident = DEFAULTS.resident;
  if (typeof raw.resident === 'boolean') resident = raw.resident;
  else if (raw.resident !== undefined) warnings.push('resident was invalid; using false');

  let linuxWeightOffset: number | null = null;
  const linux = raw.linux;
  if (linux !== null && typeof linux === 'object' && !Array.isArray(linux)) {
    const wo = (linux as Record<string, unknown>).weight_offset;
    if (typeof wo === 'number') linuxWeightOffset = wo;
  }

  return {
    config: {
      theme,
      variant,
      size,
      measure,
      typeset,
      lineNumbers,
      externalEditor,
      resident,
      linuxWeightOffset,
    },
    unknownKeys,
    warnings,
  };
}

function detectEol(bytes: Uint8Array): '\n' | '\r\n' {
  for (let i = 0; i < bytes.length - 1; i += 1) {
    if (bytes[i] === 0x0d && bytes[i + 1] === 0x0a) return '\r\n';
  }
  return '\n';
}

function isTableHeader(line: string): boolean {
  const t = line.trim();
  return t.startsWith('[') && t.endsWith(']') && !t.startsWith('[[');
}

/** Replaces or appends one top-level `key = value` line without touching any other byte. */
export function setTopLevelKey(bytes: Uint8Array, key: string, tomlValue: string): Uint8Array {
  const eol = detectEol(bytes);
  const text = new TextDecoder().decode(bytes);
  const lineEnding = eol === '\r\n' ? '\r\n' : '\n';
  const lines = text.split(/\r\n|\n|\r(?!\n)/);

  let inTable = false;
  let keyLine = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (isTableHeader(line)) {
      inTable = true;
      continue;
    }
    if (inTable) continue;
    const m = new RegExp(`^\\s*${escapeRegExp(key)}\\s*=`).exec(line);
    if (m) keyLine = i;
  }

  const newLine = `${key} = ${tomlValue}`;

  if (keyLine >= 0) {
    const before = lines.slice(0, keyLine).join(lineEnding);
    const after = lines.slice(keyLine + 1).join(lineEnding);
    const mid = newLine;
    const parts = [before, mid, after].filter((p, idx) => p !== '' || idx === 1);
    let joined = parts.join(lineEnding);
    if (text.endsWith(lineEnding) && !joined.endsWith(lineEnding)) joined += lineEnding;
    return new TextEncoder().encode(joined);
  }

  let insertAt = lines.length;
  for (let i = 0; i < lines.length; i += 1) {
    if (isTableHeader(lines[i])) {
      insertAt = i;
      break;
    }
  }

  const before = lines.slice(0, insertAt).join(lineEnding);
  const after = lines.slice(insertAt).join(lineEnding);
  const prefix = before === '' ? '' : before.endsWith(lineEnding) ? before : `${before}${lineEnding}`;
  const suffix = after === '' ? '' : `${lineEnding}${after}`;
  const out = `${prefix}${newLine}${suffix}`;
  const finalText = text.endsWith(lineEnding) && !out.endsWith(lineEnding) ? `${out}${lineEnding}` : out;
  return new TextEncoder().encode(finalText);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
