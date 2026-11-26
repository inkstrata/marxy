// Transforms' model: the groups (Space, Lines, Markdown, JSON, Bytes), each item a
// function from a file's text, or the lines of a selection in it, to the text it would leave, with the lines it changes.
// Core's transforms and operations do the work where they have it; the few it adds that core has no form of
// (trailing spaces, tabs, ticks, sorted keys, line ends, the final newline, invisible characters) are here. Pure.
import { parseMarkdown, unifiedDiff, type Document, type Node } from '@marxy/core';
import { alignTablePipes } from '@marxy/core/src/operations/align-table-pipes.ts';
import { renumberList } from '@marxy/core/src/operations/list-markers.ts';
import { runTransform } from '@marxy/core/src/transforms/registry.ts';
import { joinLines, splitLines } from './search-model.ts';

/** Lines `[a, b)`, 0-based: the selection a transform runs on. */
export interface LineSel {
  readonly a: number;
  readonly b: number;
}

/** What a transform would do: the text it leaves, how many lines it changes, and by how many the count of lines moves. */
export interface Effect {
  readonly text: string;
  readonly c: number;
  readonly d: number;
}

export type TxGroup = 'Space' | 'Lines' | 'Markdown' | 'JSON' | 'Bytes';

export interface TxItem {
  readonly id: string;
  readonly label: string;
  readonly group: TxGroup;
  /** Asks which before it stages (Remove invisible characters…). */
  readonly ask?: boolean;
  fx(text: string, sel: LineSel | null): Effect;
}

/** Lines with their endings; a final ending leaves no empty last piece. */
const pieces = (text: string): string[] => {
  const sp = splitLines(text);
  return sp.lines.map((l, i) => l + sp.eols[i]!).filter((p, i, all) => p !== '' || all.length === 1);
};

/** The character offsets of lines `[a, b)`, endings included. */
function region(text: string, sel: LineSel | null): { readonly from: number; readonly to: number } {
  if (!sel) return { from: 0, to: text.length };
  const ps = pieces(text);
  let from = 0;
  for (let i = 0; i < sel.a && i < ps.length; i++) from += ps[i]!.length;
  let to = from;
  for (let i = sel.a; i < sel.b && i < ps.length; i++) to += ps[i]!.length;
  return { from, to };
}

/** How many lines of `a` change or go in `b`, and the move in the count of lines. */
export function measure(a: string, b: string): Effect {
  if (a === b) return { text: b, c: 0, d: 0 };
  const pa = pieces(a);
  const pb = pieces(b);
  if (pa.length === pb.length) {
    let c = 0;
    for (let i = 0; i < pa.length; i++) if (pa[i] !== pb[i]) c++;
    return { text: b, c, d: 0 };
  }
  const diff = unifiedDiff(a, b, { context: 0 });
  // Lines changed or taken away; a change that only adds lines counts what it adds.
  const c = diff ? diff.removed || diff.added : Math.max(pa.length, pb.length);
  return { text: b, c, d: pb.length - pa.length };
}

/** The lines (0-based) of `a` that a change to `b` alters or removes; where it only adds, the lines it adds before. */
export function changedOld(a: string, b: string): number[] {
  if (a === b) return [];
  const pa = pieces(a);
  const pb = pieces(b);
  if (pa.length === pb.length) {
    const out: number[] = [];
    for (let i = 0; i < pa.length; i++) if (pa[i] !== pb[i]) out.push(i);
    return out;
  }
  const diff = unifiedDiff(a, b, { context: 0 });
  if (!diff) return pa.map((_, i) => i);
  const out: number[] = [];
  let at = 0;
  let hunk = false;
  for (const line of diff.text.split('\n')) {
    const h = /^@@ -(\d+)(?:,(\d+))? \+/.exec(line);
    if (h) {
      at = Number(h[1]) - (h[2] === '0' ? 0 : 1);
      if (h[2] === '0') out.push(Math.min(at, pa.length - 1));
      hunk = true;
      continue;
    }
    // `---` is the header only before the first @@; after it, a struck line that began `--`.
    if (hunk && line.startsWith('-')) out.push(at++);
  }
  return [...new Set(out)].filter((l) => l >= 0).sort((x, y) => x - y);
}

/** Runs `run` on the selection's lines (or the whole text) and puts the result back in their place. */
function onRegion(text: string, sel: LineSel | null, run: (part: string) => string): Effect {
  const { from, to } = region(text, sel);
  let out: string;
  try {
    out = run(text.slice(from, to));
  } catch {
    return { text, c: 0, d: 0 };
  }
  return measure(text, text.slice(0, from) + out + text.slice(to));
}

/** Each line's own ending kept: `run` sees and gives back the lines alone. */
function eachLine(text: string, sel: LineSel | null, run: (line: string, i: number) => string): Effect {
  const sp = splitLines(text);
  const lines = sp.lines.slice();
  const a = sel?.a ?? 0;
  const b = Math.min(sel?.b ?? lines.length, lines.length);
  for (let i = a; i < b; i++) lines[i] = run(lines[i]!, i);
  return measure(text, joinLines(lines, sp.eols));
}

const core = (id: string) => (text: string, sel: LineSel | null): Effect => onRegion(text, sel, (part) => runTransform(id, part));

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { ignoreBOM: true });

function eachNode(node: Node | Document, visit: (n: Node) => void): void {
  for (const child of ((node as { children?: readonly Node[] }).children ?? [])) {
    visit(child);
    eachNode(child, visit);
  }
}

/** Byte splices on `text`, made from its Markdown parse; only nodes wholly inside the selection's bytes. */
function byNodes(text: string, sel: LineSel | null, pick: (n: Node, doc: Document, bytes: Uint8Array) => { start: number; end: number; replacement: string } | null): Effect {
  const bytes = encoder.encode(text);
  let doc: Document;
  try {
    doc = parseMarkdown(bytes);
  } catch {
    return { text, c: 0, d: 0 };
  }
  const { from, to } = region(text, sel);
  const lo = sel ? encoder.encode(text.slice(0, from)).length : 0;
  const hi = sel ? lo + encoder.encode(text.slice(from, to)).length : bytes.length;
  const splices: { start: number; end: number; replacement: string }[] = [];
  eachNode(doc, (n) => {
    if (n.src.start < lo || n.src.end > hi) return;
    const s = pick(n, doc, bytes);
    if (s) splices.push(s);
  });
  // Nested matches (a list in a list) are made from the same bytes: the outer one is kept.
  splices.sort((x, y) => x.start - y.start || y.end - x.end);
  const kept: typeof splices = [];
  for (const s of splices) if (!kept.length || s.start >= kept.at(-1)!.end) kept.push(s);
  let out = '';
  let at = 0;
  for (const s of kept) {
    out += decoder.decode(bytes.subarray(at, s.start)) + s.replacement;
    at = s.end;
  }
  out += decoder.decode(bytes.subarray(at));
  return measure(text, out);
}

function operation(op: typeof renumberList) {
  return (n: Node, doc: Document, bytes: Uint8Array) => {
    const input = { document: doc, node: n, range: n.src };
    if (!op.canApply(input)) return null;
    const t = decoder.decode(bytes.subarray(n.src.start, n.src.end));
    const r = op.run({ ...input, text: t });
    return r.replacement === t ? null : { start: n.src.start, end: n.src.end, replacement: r.replacement };
  };
}

const ticks = (checked: boolean) => (n: Node) => {
  if (n.type !== 'taskMarker' || (n as { checked?: boolean }).checked === checked) return null;
  return { start: n.src.start, end: n.src.end, replacement: checked ? '[x]' : '[ ]' };
};

/** Each tab to spaces, to the next stop of four columns. */
function untab(line: string): string {
  if (!line.includes('\t')) return line;
  let out = '';
  for (const ch of line) out += ch === '\t' ? ' '.repeat(4 - (out.length % 4)) : ch;
  return out;
}

/** Printed as JSON.stringify(v, null, 2) prints, keys sorted: an object built in order would put integer keys first. */
function printSorted(v: unknown, pad: string): string {
  const inner = `${pad}  `;
  if (Array.isArray(v)) return v.length === 0 ? '[]' : `[\n${v.map((x) => inner + printSorted(x, inner)).join(',\n')}\n${pad}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o).sort();
    return keys.length === 0 ? '{}' : `{\n${keys.map((k) => `${inner}${JSON.stringify(k)}: ${printSorted(o[k], inner)}`).join(',\n')}\n${pad}}`;
  }
  return JSON.stringify(v);
}

const keyCount = (v: unknown): number =>
  Array.isArray(v) ? v.reduce((n: number, x) => n + keyCount(x), 0) : v && typeof v === 'object' ? Object.values(v).reduce((n: number, x) => n + 1 + keyCount(x), 0) : 0;

/** True when parsing loses something of `body` (valid JSON): a number JSON would write otherwise (1.0, 1e2, a big integer), or a key given twice. */
function parseLoses(body: string, v: unknown): boolean {
  let keys = 0;
  for (const m of body.matchAll(/"(?:[^"\\]|\\.)*"(\s*:)?|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g)) {
    if (m[0].startsWith('"')) {
      if (m[1]) keys++;
    } else if (JSON.stringify(Number(m[0])) !== m[0]) return true;
  }
  return keys !== keyCount(v);
}

/** Keys in order at every depth, two spaces; text that is not JSON, or that the sort would change more than the order of, is left as it was. */
function jsonSorted(text: string): string {
  const bom = text.startsWith('﻿') ? '﻿' : '';
  const body = text.slice(bom.length);
  let v: unknown;
  try {
    v = JSON.parse(body);
  } catch {
    return text;
  }
  if (parseLoses(body, v)) return text;
  const eol = /\r\n/.test(body) ? '\r\n' : '\n';
  const out = printSorted(v, '').replace(/\n/g, eol);
  return bom + out + (/(\r\n|\n|\r)$/.test(body) ? eol : '');
}

/** The file's own ending for a new line: the one most of its lines end with, else LF. */
function eolOf(text: string): string {
  const n = new Map<string, number>();
  for (const e of text.match(/\r\n|\n|\r/g) ?? []) n.set(e, (n.get(e) ?? 0) + 1);
  let best = '\n';
  for (const [e, c] of n) if (c > (n.get(best) ?? 0)) best = e;
  return best;
}

export const INVISIBLE: readonly (readonly [id: string, label: string, re: RegExp, to: string])[] = [
  ['zw', 'Zero-width characters', /[​-‍⁠﻿]/g, ''],
  ['bidi', 'Bidirectional controls', /[‪-‮⁦-⁩‎‏]/g, ''],
  ['soft-hyphen', 'Soft hyphens', /­/g, ''],
  ['nbsp', 'No-break spaces, made plain spaces', /[   ]/g, ' '],
];

/** The invisible characters of each kind in the text (or the selection's lines); a byte-order mark is the file's, not one. */
export function invisibleCounts(text: string, sel: LineSel | null): Record<string, number> {
  const { from, to } = region(text, sel);
  const part = text.slice(from, to).slice(from === 0 && text.startsWith('﻿') ? 1 : 0);
  const out: Record<string, number> = {};
  for (const [id, , re] of INVISIBLE) {
    const n = part.match(re)?.length ?? 0;
    if (n > 0) out[id] = n;
  }
  return out;
}

export function removeInvisible(text: string, sel: LineSel | null, kinds: readonly string[]): Effect {
  return eachLine(text, sel, (line, i) => {
    const bom = i === 0 && line.startsWith('﻿');
    let s = bom ? line.slice(1) : line;
    for (const [id, , re, to] of INVISIBLE) if (kinds.includes(id)) s = s.replace(re, to);
    return bom ? `﻿${s}` : s;
  });
}

function allLf(text: string, sel: LineSel | null): Effect {
  const sp = splitLines(text);
  const eols = sp.eols.slice();
  const a = sel?.a ?? 0;
  const b = Math.min(sel?.b ?? eols.length, eols.length);
  for (let i = a; i < b; i++) if (eols[i] !== '' && eols[i] !== '\n') eols[i] = '\n';
  return measure(text, joinLines(sp.lines, eols));
}

function finalNewline(text: string, sel: LineSel | null): Effect {
  const last = splitLines(text).lines.length - 1;
  if (text === '' || /[\r\n]$/.test(text) || (sel && sel.b <= last)) return { text, c: 0, d: 0 };
  return measure(text, text + eolOf(text));
}

const ITEMS: readonly TxItem[] = [
  { id: 'trim-trailing', label: 'Trim trailing spaces', group: 'Space', fx: (t, s) => eachLine(t, s, (l) => l.replace(/[ \t]+$/, '')) },
  { id: 'tabs-to-spaces', label: 'Tabs to spaces', group: 'Space', fx: (t, s) => eachLine(t, s, untab) },
  { id: 'unwrap', label: 'Unwrap paragraphs', group: 'Lines', fx: core('unwrap') },
  { id: 'wrap-80', label: 'Wrap at 80 columns', group: 'Lines', fx: core('wrap-80') },
  { id: 'sort-lines', label: 'Sort lines', group: 'Lines', fx: core('sort') },
  { id: 'dedupe-lines', label: 'Remove duplicate lines', group: 'Lines', fx: core('dedupe') },
  { id: 'promote', label: 'Promote every heading', group: 'Markdown', fx: core('promote') },
  { id: 'demote', label: 'Demote every heading', group: 'Markdown', fx: core('demote') },
  { id: 'renumber-list', label: 'Renumber the lists', group: 'Markdown', fx: (t, s) => byNodes(t, s, operation(renumberList)) },
  { id: 'table-align', label: 'Align the tables', group: 'Markdown', fx: (t, s) => byNodes(t, s, operation(alignTablePipes)) },
  { id: 'tick-all', label: 'Tick every task', group: 'Markdown', fx: (t, s) => byNodes(t, s, ticks(true)) },
  { id: 'untick-all', label: 'Untick every task', group: 'Markdown', fx: (t, s) => byNodes(t, s, ticks(false)) },
  { id: 'json-format', label: 'Format JSON', group: 'JSON', fx: core('json-pretty') },
  { id: 'json-sort-keys', label: 'Sort the keys', group: 'JSON', fx: (t, s) => onRegion(t, s, jsonSorted) },
  { id: 'json-minify', label: 'Minify JSON', group: 'JSON', fx: core('json-min') },
  { id: 'eol-lf', label: 'Line ends, all LF', group: 'Bytes', fx: allLf },
  { id: 'final-newline', label: 'End the file with a newline', group: 'Bytes', fx: finalNewline },
  { id: 'invisible', label: 'Remove invisible characters…', group: 'Bytes', ask: true, fx: (t, s) => removeInvisible(t, s, INVISIBLE.map((k) => k[0])) },
];

export type FileFamily = 'markdown' | 'json' | 'other';

/** The groups a file of `family` is offered, in their order; Markdown and JSON only for their own files. */
export function groupsFor(family: FileFamily): readonly { readonly group: TxGroup; readonly items: readonly TxItem[] }[] {
  const order: TxGroup[] = ['Space', 'Lines', ...(family === 'markdown' ? (['Markdown'] as const) : []), ...(family === 'json' ? (['JSON'] as const) : []), 'Bytes'];
  return order.map((group) => ({ group, items: ITEMS.filter((i) => i.group === group) }));
}

export const txItem = (id: string): TxItem | undefined => ITEMS.find((i) => i.id === id);

/** Core's transform ids (the Line's `!`) that a row here runs under its own id. */
const ROW_OF_CORE: Readonly<Record<string, string>> = { sort: 'sort-lines', dedupe: 'dedupe-lines', 'json-pretty': 'json-format', 'json-min': 'json-minify' };

/** The row for a transform the Line names by core's id, or null where the panel has none. */
export const txRowFor = (coreId: string): TxItem | null => txItem(ROW_OF_CORE[coreId] ?? coreId) ?? null;

/** "4 lines", "2 lines · −1", "nothing to change". */
export function effectWords(e: Pick<Effect, 'c' | 'd'>): string {
  if (e.c === 0) return 'nothing to change';
  return `${e.c} ${e.c === 1 ? 'line' : 'lines'}${e.d ? ` · ${e.d > 0 ? '+' : '−'}${Math.abs(e.d)}` : ''}`;
}
