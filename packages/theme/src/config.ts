// Config.toml parsing and byte-preserving top-level edits (docs/design/11-config-and-storage.md). MARXY-47 adds setTopLevelKey.

import { parse } from 'smol-toml';

/**
 * A reader's `[[kind]]` rule (ADR-0060 item 9, K-04). Structurally the same as core's `KindRule`
 * (theme imports nothing from another package, so the shape is restated, not imported): `glob` is
 * absolute (or opens with `**`), `~` expanded and lexically resolved, and `is` is one of the kinds.
 */
export interface KindRule {
  readonly glob: string;
  readonly is: string;
  readonly read?: boolean;
}

/**
 * The fourteen kinds of ADR-0060, in `KINDS`' order. Restated because theme cannot import core;
 * `config.test.ts` reads `packages/core/src/contracts/kinds.ts` and holds the two equal.
 */
export const KIND_NAMES: readonly string[] = [
  'article', 'report', 'book', 'readme', 'docs', 'code', 'transcript',
  'data', 'notes', 'changelog', 'log', 'terminal', 'diff', 'html',
];

/** A placeholder ceiling on `[[kind]]` rules; more warn and are dropped. */
export const MAX_KIND_RULES = 200;

const KIND_KEYS = new Set(['glob', 'is', 'read']);

/** Most tools a kind's strip shows (K-07, mock-v2 03-content-modes). */
export const MAX_STRIP_TOOLS = 4;

/**
 * Every tool id a `[strip]` list may name: the ids of `STRIP_TOOLS` in `apps/desktop/src/workspace/strip.ts`, restated
 * because theme cannot import the app (`strip.test.ts` holds the two equal). A tool whose command is not built yet is
 * still a known id; the strip draws it only once the command is registered.
 */
export const STRIP_TOOL_IDS: readonly string[] = [
  'focus', 'highlight', 'margin-notes', 'read-aloud',
  'paths', 'changes', 'split-by-h2',
  'paged', 'contents', 'justify', 'bookmark',
  'outline', 'config-table', 'open-repo',
  'examples-only', 'search-docs', 'prev-next',
  'line-numbers', 'wrap', 'symbols', 'go-to-line',
  'collapse-tools', 'only-you', 'only-assistant',
  'table', 'column-stats', 'filter', 'transpose',
  'backlinks', 'append-clipboard', 'daily',
  'versions',
  'filter-by-level', 'jump-to-first-error', 'follow-tail',
  'copy-commands', 'copy-output',
];

/** What a config.toml created by the first appended rule starts with. */
export const CONFIG_TEMPLATE = '# Marxy configuration. Edit freely; Marxy re-reads this file when it changes.\n';

export interface Config {
  readonly theme: string | null;
  readonly variant: 'dark' | 'light' | 'auto';
  readonly size: number;
  /** The reader's chrome size in px (ADR-0059 item 6), 11–26; `null` when unset or refused: the theme's value stands. */
  readonly chromeSize: number | null;
  /** More contrast (W-22): `system` follows the system's Increase contrast, `more` and `normal` set it whatever the system says. */
  readonly contrast: 'system' | 'more' | 'normal';
  /** `true` draws the little translucency there is (find fills, the toolbar and tab fades) solid, on its own (W-22). */
  readonly reduceTransparency: boolean;
  readonly measure: number;
  readonly typeset: boolean;
  /** `undefined` when the key is absent or invalid: the per-path default stands (numbers on for code files). */
  readonly lineNumbers: boolean | undefined;
  /** `undefined` when the key is absent or invalid: whitespace marks are off (V-08). */
  readonly showWhitespace: boolean | undefined;
  /** `undefined` when the key is absent or invalid: the guide is on for code and off for prose (V-08). */
  readonly columnGuide: boolean | undefined;
  readonly externalEditor: string | null;
  readonly resident: boolean;
  /** The Copy as row that is first and chosen by Enter (J-04): one of `COPY_FORMATS`. A target not built yet still parses; the menu falls back to Markdown. */
  readonly copyFormat: string;
  /** Local versions (ADR-0072, V-06): copies of the files you read and save, kept in Marxy's data folder. `false` keeps no new ones. */
  readonly versions: boolean;
  readonly linuxWeightOffset: number | null;
  /** Valid `[[kind]]` rules in file order; the first that matches a path wins (detectKind's job). */
  readonly kindRules: readonly KindRule[];
  /** `[strip]` (K-07): per kind, the tool ids to show in the strip, in order; a kind not named keeps its own row. Ids are known and at most four. */
  readonly strip: Readonly<Record<string, readonly string[]>>;
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
  chromeSize: null,
  contrast: 'system',
  reduceTransparency: false,
  measure: 66,
  typeset: true,
  lineNumbers: undefined,
  showWhitespace: undefined,
  columnGuide: undefined,
  externalEditor: null,
  resident: false,
  copyFormat: 'markdown',
  versions: true,
  linuxWeightOffset: null,
  kindRules: [],
  strip: {},
};

const KNOWN = new Set([
  'theme',
  'variant',
  'size',
  'chrome_size',
  'contrast',
  'reduce_transparency',
  'measure',
  'typeset',
  'line_numbers',
  'show_whitespace',
  'column_guide',
  'external_editor',
  'resident',
  'copy_format',
  'versions',
  'linux',
  'kind',
  'strip',
]);

/** The ids `copy_format` takes: the Copy as targets of ADR-0065 item 1 (`apps/desktop/test/copy-as.test.mjs` holds this list equal to core's). */
export const COPY_FORMATS: readonly string[] = ['markdown', 'plain', 'rich', 'html', 'slack', 'jira', 'json-string', 'quote'];

/** The reader's chrome size range in px: 200 % of 13 at most (WCAG 1.4.4), ADR-0059 item 6. */
export const CHROME_SIZE_MIN = 11;
export const CHROME_SIZE_MAX = 26;

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

const UNPARSEABLE = 'config.toml could not be parsed; using defaults';
const KIND_NOT_LIST = 'kind must be a list of [[kind]] tables; ignored';

/** Parses config.toml bytes; unknown keys are listed, invalid values fall back with warnings. */
export function parseConfig(bytes: Uint8Array, ctx: { readonly home?: string } = {}): ParseConfigResult {
  const text = new TextDecoder().decode(bytes);
  const warnings: string[] = [];
  let raw: Record<string, unknown> = {};
  if (text.trim() !== '') {
    try {
      raw = parse(text) as Record<string, unknown>;
    } catch {
      warnings.push(UNPARSEABLE);
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

  let chromeSize: number | null = DEFAULTS.chromeSize;
  if (typeof raw.chrome_size === 'number' && Number.isFinite(raw.chrome_size)) {
    chromeSize = clamp(raw.chrome_size, CHROME_SIZE_MIN, CHROME_SIZE_MAX);
    if (chromeSize !== raw.chrome_size) {
      warnings.push(`chrome_size ${raw.chrome_size} is outside ${CHROME_SIZE_MIN}–${CHROME_SIZE_MAX} px; using ${chromeSize}`);
    }
  } else if (raw.chrome_size !== undefined) {
    warnings.push(`chrome_size ${String(raw.chrome_size)} was invalid; using the theme's chrome size`);
  }

  let contrast = DEFAULTS.contrast;
  if (raw.contrast === 'system' || raw.contrast === 'more' || raw.contrast === 'normal') contrast = raw.contrast;
  else if (raw.contrast !== undefined) warnings.push('contrast was invalid; using system');

  let reduceTransparency = DEFAULTS.reduceTransparency;
  if (typeof raw.reduce_transparency === 'boolean') reduceTransparency = raw.reduce_transparency;
  else if (raw.reduce_transparency !== undefined) warnings.push('reduce_transparency was invalid; using false');

  let measure = DEFAULTS.measure;
  if (typeof raw.measure === 'number' && Number.isFinite(raw.measure)) measure = clamp(Math.round(raw.measure), 45, 80);
  else if (raw.measure !== undefined) warnings.push('measure was invalid; using 66');

  let typeset = DEFAULTS.typeset;
  if (typeof raw.typeset === 'boolean') typeset = raw.typeset;
  else if (raw.typeset !== undefined) warnings.push('typeset was invalid; using true');

  let lineNumbers = DEFAULTS.lineNumbers;
  if (typeof raw.line_numbers === 'boolean') lineNumbers = raw.line_numbers;
  else if (raw.line_numbers !== undefined) warnings.push('line_numbers was invalid; using the default for the file');
  let showWhitespace = DEFAULTS.showWhitespace;
  if (typeof raw.show_whitespace === 'boolean') showWhitespace = raw.show_whitespace;
  else if (raw.show_whitespace !== undefined) warnings.push('show_whitespace was invalid; whitespace marks stay off');
  let columnGuide = DEFAULTS.columnGuide;
  if (typeof raw.column_guide === 'boolean') columnGuide = raw.column_guide;
  else if (raw.column_guide !== undefined) warnings.push('column_guide was invalid; using the default for the file');

  let externalEditor: string | null = DEFAULTS.externalEditor;
  if (typeof raw.external_editor === 'string') externalEditor = raw.external_editor;
  else if (raw.external_editor !== undefined) warnings.push('external_editor was invalid; ignored');

  let resident = DEFAULTS.resident;
  if (typeof raw.resident === 'boolean') resident = raw.resident;
  else if (raw.resident !== undefined) warnings.push('resident was invalid; using false');

  let copyFormat = DEFAULTS.copyFormat;
  if (typeof raw.copy_format === 'string' && COPY_FORMATS.includes(raw.copy_format)) copyFormat = raw.copy_format;
  else if (raw.copy_format !== undefined) warnings.push(`copy_format was invalid; using ${DEFAULTS.copyFormat}`);

  let versions = DEFAULTS.versions;
  if (typeof raw.versions === 'boolean') versions = raw.versions;
  else if (raw.versions !== undefined) warnings.push('versions was invalid; versions stay on');

  let linuxWeightOffset: number | null = null;
  const linux = raw.linux;
  if (linux !== null && typeof linux === 'object' && !Array.isArray(linux)) {
    const wo = (linux as Record<string, unknown>).weight_offset;
    if (typeof wo === 'number' && Number.isFinite(wo)) linuxWeightOffset = wo;
    else if (wo !== undefined) warnings.push('linux.weight_offset was invalid; ignored');
  }

  const unknown = new Set(unknownKeys);
  const kindRules = parseKindRules(raw.kind, ctx.home, warnings, unknown);
  const strip = parseStrip(raw.strip, warnings);

  return {
    config: {
      theme,
      variant,
      size,
      chromeSize,
      contrast,
      reduceTransparency,
      measure,
      typeset,
      lineNumbers,
      showWhitespace,
      columnGuide,
      externalEditor,
      resident,
      copyFormat,
      versions,
      linuxWeightOffset,
      kindRules,
      strip,
    },
    unknownKeys: [...unknown],
    warnings,
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * A `[[kind]]` glob as detection will match it: `~` expanded, `.`, `..` and empty segments resolved
 * lexically, Unicode composed (NFC). The way a `[[capture]]` path is resolved (P-02): null when it
 * is not absolute (nor opens with `**`, which matches under any folder), a `..` would climb above
 * its root or follows a segment holding a glob character (a textual collapse would change what the
 * glob means), or it is a UNC share. Case is not folded here; matching folds it (core `show-as.ts`).
 */
export function resolveKindGlob(raw: string, home: string | undefined): string | null {
  let glob = raw.normalize('NFC');
  if (glob.startsWith('\\\\')) return null;
  if (/^[A-Za-z]:[\\/]/.test(glob)) glob = glob.replace(/\\/g, '/');
  if (glob === '~' || glob.startsWith('~/')) {
    if (home === undefined || home === '') return null;
    glob = `${home.replace(/\\/g, '/').replace(/\/+$/, '')}${glob.slice(1)}`;
  } else if (glob.startsWith('~')) return null;
  const drive = /^[A-Za-z]:/.exec(glob)?.[0] ?? '';
  const rest = glob.slice(drive.length);
  const anchored = rest.startsWith('/');
  if (!anchored && !rest.startsWith('**')) return null;
  const out: string[] = [];
  let globSeen = false;
  for (const seg of rest.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (globSeen) return null;
      if (out.pop() === undefined) return null;
      continue;
    }
    if (/[*?]/.test(seg)) globSeen = true;
    out.push(seg);
  }
  return `${drive}${anchored ? '/' : ''}${out.join('/')}`;
}

function parseKindRules(
  rawKind: unknown,
  home: string | undefined,
  warnings: string[],
  unknown: Set<string>,
): KindRule[] {
  const rules: KindRule[] = [];
  if (rawKind === undefined) return rules;
  if (!Array.isArray(rawKind)) {
    warnings.push(KIND_NOT_LIST);
    return rules;
  }
  for (const [i, entry] of rawKind.entries()) {
    const label = `kind ${i + 1}`;
    if (!isRecord(entry)) {
      warnings.push(`${label} is not a table; skipped`);
      continue;
    }
    for (const k of Object.keys(entry)) if (!KIND_KEYS.has(k)) unknown.add(`kind.${k}`);
    if (typeof entry.glob !== 'string' || entry.glob === '') {
      warnings.push(`${label} has no glob; skipped`);
      continue;
    }
    if (typeof entry.is !== 'string' || !KIND_NAMES.includes(entry.is)) {
      const named = typeof entry.is === 'string' ? ` "${entry.is}"` : '';
      warnings.push(`${label} (glob "${entry.glob}") is${named} not one of the kinds; skipped`);
      continue;
    }
    const glob = resolveKindGlob(entry.glob, home);
    if (glob === null) {
      warnings.push(
        `${label} glob "${entry.glob}" is not an absolute path (or one opening with **), or a .. climbs above its root or follows a glob character; skipped`,
      );
      continue;
    }
    if (rules.length >= MAX_KIND_RULES) {
      warnings.push(`more than ${MAX_KIND_RULES} kind rules; ${label} dropped`);
      continue;
    }
    let read: boolean | undefined;
    if (typeof entry.read === 'boolean') read = entry.read;
    else if (entry.read !== undefined) warnings.push(`${label} read was not true or false; ignored`);
    rules.push(read === undefined ? { glob, is: entry.is } : { glob, is: entry.is, read });
  }
  return rules;
}

/**
 * `[strip]` (K-07): `report = ["changes", "paths"]`. A key that is not a kind, a value that is not a list of strings, an
 * unknown tool id and a repeat warn and are skipped; more than `MAX_STRIP_TOOLS` warns and truncates. An empty list is
 * kept: the reader chose no tools for that kind.
 */
function parseStrip(rawStrip: unknown, warnings: string[]): Record<string, readonly string[]> {
  const strip: Record<string, readonly string[]> = {};
  if (rawStrip === undefined) return strip;
  if (!isRecord(rawStrip)) {
    warnings.push('strip must be a table of kind = [tools]; ignored');
    return strip;
  }
  for (const [kind, value] of Object.entries(rawStrip)) {
    if (!KIND_NAMES.includes(kind)) {
      warnings.push(`strip.${kind} is not one of the kinds; skipped`);
      continue;
    }
    if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
      warnings.push(`strip.${kind} must be a list of tool names; skipped`);
      continue;
    }
    const tools: string[] = [];
    for (const id of value as string[]) {
      if (!STRIP_TOOL_IDS.includes(id)) warnings.push(`strip.${kind}: "${id}" is not a tool; skipped`);
      else if (tools.includes(id)) warnings.push(`strip.${kind}: "${id}" is listed twice; the second skipped`);
      else tools.push(id);
    }
    if (tools.length > MAX_STRIP_TOOLS) {
      warnings.push(`strip.${kind} lists more than ${MAX_STRIP_TOOLS} tools; the rest dropped`);
      tools.length = MAX_STRIP_TOOLS;
    }
    strip[kind] = tools;
  }
  return strip;
}

function tomlString(s: string): string {
  // eslint-disable-next-line no-control-regex
  if (!s.includes("'") && !/[\u0000-\u001f\u007f]/.test(s)) return `'${s}'`;
  const escaped = s
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
  return `"${escaped}"`;
}

/**
 * Appends one `[[kind]]` table (ADR-0060 item 9, "Always open this folder as"). Every byte of the input
 * survives as a prefix of the output; only text is added at the end: the file's own line ending where
 * its last line lacks one, a blank line to set the table apart, then the table. An empty input becomes
 * the template first. `rule.glob` is written as given, so a caller collapses the home folder to `~`.
 * A rule whose resolved glob and kind are already present returns the input unchanged; one whose glob is
 * present with another kind throws (the older rule would win, so the new one could never take effect).
 * Throws on an unreadable file, an invalid rule, or a file whose `kind` is not a list of tables.
 */
export function appendKindRule(bytes: Uint8Array, rule: KindRule, ctx: { readonly home?: string } = {}): Uint8Array {
  if (!KIND_NAMES.includes(rule.is)) throw new RangeError(`"${rule.is}" is not one of the kinds`);
  const resolved = resolveKindGlob(rule.glob, ctx.home);
  if (resolved === null) throw new RangeError(`not a usable kind glob: ${rule.glob}`);
  const before = parseConfig(bytes, ctx);
  if (before.warnings.includes(UNPARSEABLE)) throw new Error('config.toml cannot be read as TOML; edit it by hand');
  if (before.warnings.includes(KIND_NOT_LIST)) {
    throw new Error('config.toml has a `kind` that is not a list of [[kind]] tables; edit it by hand');
  }
  const same = before.config.kindRules.find((r) => r.glob.toLowerCase() === resolved.toLowerCase());
  if (same !== undefined) {
    if (same.is === rule.is && same.read === rule.read) return bytes;
    throw new RangeError(`a rule for ${rule.glob} already says ${same.is}; edit it by hand`);
  }

  const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  let addition = '';
  if (bytes.length === 0) addition = CONFIG_TEMPLATE.replace(/\n/g, eol) + eol;
  else {
    if (!text.endsWith('\n') && !text.endsWith('\r')) addition = eol;
    if (!/(?:\r\n|\n|\r(?!\n))[ \t]*(?:\r\n|\n|\r(?!\n))$/.test(text + addition)) addition += eol;
  }
  addition += `[[kind]]${eol}glob = ${tomlString(rule.glob)}${eol}is = ${tomlString(rule.is)}${eol}`;
  if (rule.read !== undefined) addition += `read = ${rule.read}${eol}`;

  const tail = new TextEncoder().encode(addition);
  const out = new Uint8Array(bytes.length + tail.length);
  out.set(bytes, 0);
  out.set(tail, bytes.length);
  const after = parseConfig(out, ctx);
  const last = after.config.kindRules.at(-1);
  if (
    after.warnings.includes(UNPARSEABLE) ||
    after.warnings.includes(KIND_NOT_LIST) ||
    last?.glob !== resolved ||
    last.is !== rule.is ||
    last.read !== rule.read
  ) {
    throw new Error('config.toml could not take the new rule; edit it by hand');
  }
  return out;
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
    // Everything after the old value (the spaces or tabs, the comment) is kept byte for byte.
    const floor = last === found ? head.length : 0;
    let valueEnd = hash < 0 ? lastLine.length : hash;
    while (valueEnd > floor && /[ \t]/.test(lastLine[valueEnd - 1]!)) valueEnd -= 1;
    const tail = lastLine.slice(valueEnd);
    lines.splice(found, last - found + 1, { content: `${head}${value}${tail}`, ending: lines[last]!.ending });
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
