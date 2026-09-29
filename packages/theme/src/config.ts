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
  if (typeof raw.size === 'number' && Number.isFinite(raw.size)) size = clamp(Math.round(raw.size), 15, 50);
  else if (raw.size !== undefined) warnings.push('size was invalid; using 20');

  let measure = DEFAULTS.measure;
  if (typeof raw.measure === 'number' && Number.isFinite(raw.measure)) measure = clamp(Math.round(raw.measure), 45, 80);
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
    if (typeof wo === 'number' && Number.isFinite(wo)) linuxWeightOffset = wo;
    else if (wo !== undefined) warnings.push('linux.weight_offset was invalid; ignored');
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

function bytesToLatin1(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode(...b.subarray(i, i + 8192));
  return s;
}

function latin1ToBytes(s: string): Uint8Array {
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i += 1) b[i] = s.charCodeAt(i);
  return b;
}

function detectEol(bytes: Uint8Array): '\n' | '\r\n' {
  for (let i = 0; i < bytes.length - 1; i += 1) {
    if (bytes[i] === 0x0d && bytes[i + 1] === 0x0a) return '\r\n';
  }
  return '\n';
}

type Line = { content: string; ending: string };

/** Lines with their own endings, so a file with mixed endings is written back with the same ones. */
function splitLines(text: string): Line[] {
  const lines: Line[] = [];
  const re = /\r\n|\n|\r/g;
  let from = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    lines.push({ content: text.slice(from, m.index), ending: m[0] });
    from = m.index + m[0].length;
  }
  if (from < text.length || lines.length === 0) lines.push({ content: text.slice(from), ending: '' });
  return lines;
}

/** `[table]` or `[[array.of.tables]]`, with an optional trailing comment. */
function isTableHeader(line: string): boolean {
  return /^[ \t]*\[\[?[^\]]*\]\]?[ \t]*(#.*)?$/.test(line);
}

/** Where a trailing comment starts on a `key = value` line, outside any string; -1 for none. */
function commentStart(line: string, from: number): number {
  let quote: string | null = null;
  for (let i = from; i < line.length; i += 1) {
    const c = line[i];
    if (quote) {
      if (c === '\\' && quote === '"') i += 1;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '#') return i;
  }
  return -1;
}

/** `[`/`]` depth change from `from` to the line's end (or its comment), outside any string. A TOML
 *  array value can span lines; this is how far past `found` the value actually runs. */
function bracketDepthDelta(line: string, from: number): number {
  let quote: string | null = null;
  let depth = 0;
  for (let i = from; i < line.length; i += 1) {
    const c = line[i];
    if (quote) {
      if (c === '\\' && quote === '"') i += 1;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '#') break;
    else if (c === '[') depth += 1;
    else if (c === ']') depth -= 1;
  }
  return depth;
}

const MULTILINE = ['"""', "'''"];

/**
 * Replaces or appends one top-level `key = value` line without touching any other byte: every other
 * line keeps its bytes and its own ending, the edited line keeps its indentation, key spelling and
 * trailing comment, and a key inside a table or a multi-line string is never taken for it.
 */
export function setTopLevelKey(bytes: Uint8Array, key: string, tomlValue: string): Uint8Array {
  const eol = detectEol(bytes);
  // Each byte becomes one char (latin1), so lines the edit never touches are written back with
  // exactly their bytes: no BOM stripped, no invalid UTF-8 turned into U+FFFD.
  const hasBom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  const body = hasBom ? bytes.subarray(3) : bytes;
  const text = bytesToLatin1(body);
  const lines = splitLines(text);
  const value = bytesToLatin1(new TextEncoder().encode(tomlValue));
  const k = escapeRegExp(key);
  const keyLine = new RegExp(`^([ \\t]*(?:${k}|"${k}"|'${k}')[ \\t]*=[ \\t]*)`);
  const dottedLine = new RegExp(`^[ \\t]*(?:${k}|"${k}"|'${k}')[ \\t]*\\.`);

  let firstTable = -1;
  let found = -1;
  let open: string | null = null;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!.content;
    if (open) {
      // An odd count of the delimiter on a line closes the string it opened.
      if (line.split(open).length % 2 === 0) open = null;
      continue;
    }
    if (isTableHeader(line)) {
      firstTable = i;
      break;
    }
    if (dottedLine.test(line)) {
      throw new Error(`config.toml already defines a dotted key under '${key}'; edit it by hand`);
    }
    if (found < 0 && keyLine.test(line)) found = i;
    for (const delim of MULTILINE) if (line.split(delim).length % 2 === 0) open = delim;
  }

  if (found >= 0) {
    const line = lines[found]!.content;
    const head = keyLine.exec(line)![1]!;
    // The old value may be a TOML array spanning several lines; every line it occupies is replaced
    // together, or the array's own lines would be left behind as orphaned, syntactically broken text.
    let depth = bracketDepthDelta(line, head.length);
    let last = found;
    while (depth > 0 && last + 1 < lines.length) {
      last += 1;
      depth += bracketDepthDelta(lines[last]!.content, 0);
    }
    const lastLine = lines[last]!.content;
    const hash = commentStart(lastLine, last === found ? head.length : 0);
    const comment = hash < 0 ? '' : ` ${lastLine.slice(hash)}`;
    lines.splice(found, last - found + 1, { content: `${head}${value}${comment}`, ending: lines[last]!.ending });
  } else {
    const entry: Line = { content: `${key} = ${value}`, ending: eol };
    if (firstTable >= 0) lines.splice(firstTable, 0, entry);
    else {
      const last = lines[lines.length - 1]!;
      if (last.content === '' && last.ending === '') lines[lines.length - 1] = entry;
      else {
        if (last.ending === '') last.ending = eol;
        lines.push(entry);
      }
    }
  }
  const out = latin1ToBytes(lines.map((l) => l.content + l.ending).join(''));
  if (!hasBom) return out;
  const withBom = new Uint8Array(out.length + 3);
  withBom.set([0xef, 0xbb, 0xbf]);
  withBom.set(out, 3);
  return withBom;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
