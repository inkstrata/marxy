// How Read sets a file that is not Markdown or code: a data file as a tree you fold, JSON Lines as a table of records,
// a CSV as a table, verse with every line kept, plain prose as paragraphs. Each block carries the bytes it was made from
// (`data-marxy-s`, `data-marxy-e`), so the reading line, find and the panel work as they do for a page. Source still
// shows the bytes; nothing here writes. Pure.
import { byteOffsets, decodeWithOffsets, type ByteOffsets } from '../parse/byte-offsets.ts';
import { decodeBytes, sniff } from '../encoding/decode.ts';
import { fileOffsetOf } from '../encoding/byte-map.ts';
import { delimiterFor } from '../data/delimited.ts';
import { isTreeTop, parseJson, parseToml, parseXml, parseYaml, TreeError, treeFromCode, type TreeFrom, type TreeNode } from './tree.ts';
import { parseJsonc } from './tree-jsonc.ts';
import { lineOfByte, parseJsonFrom, scanJson, type Cut, type JsonStream } from './tree-stream.ts';
import { fileTypeFor, guessedFromBytes } from '../kind/registry.ts';
import { NOTEBOOK_MAX_BYTES, notebookReading } from './notebook.ts';
import { accountHtml } from './account.ts';
import { indexLines, isUtf8, linesAccount, linesTier, renderedChosen, type LinesTier, type ReadingLines } from './lines.ts';
import {
  drawnColumns,
  columnTotal,
  FIRST_ROWS,
  headHtml,
  indexSome,
  parseSome,
  READING_MAX_COLUMNS,
  READING_MAX_ROWS,
  recordRows,
  recordsHeadText,
  rowCells,
  rowCount,
  rowRange,
  rowsHtml,
  rowsSettled,
  tableRows,
  type ReadingRows,
} from './rows.ts';

export { TreeError, treeFromCode, treeFromOf, type TreeFrom, type TreeNode } from './tree.ts';
export { READING_MAX_COLUMNS, READING_MAX_ROWS, type ReadingRows } from './rows.ts';
export type { ReadingLines } from './lines.ts';

export type ReadingId = 'tree' | 'records' | 'table' | 'verse' | 'prose' | 'written' | 'notebook' | 'lines';

/** What the panel's contents card lists for a reading. */
export interface ReadingItem {
  readonly text: string;
  readonly sub: string;
  readonly byte: number;
  /** How the row is set: a heading in the strong weight, a line of code in the code face (a notebook's Cells). */
  readonly tone?: 'heading' | 'code';
  /** A tree drawn in part: the way to draw it from this entry (`treeFromCode`). */
  readonly from?: string;
}

export interface Reading {
  readonly id: ReadingId;
  /** "a data tree", "a table of records"…: how the Reading card says it. */
  readonly name: string;
  /** The format it was read from: "JSON", "YAML"… */
  readonly format: string;
  readonly html: string;
  /** The contents card's name and rows: Keys, Columns, Stanzas. */
  readonly contents: { readonly title: string; readonly items: readonly ReadingItem[]; readonly detail?: string } | null;
  /** Why it is set as written instead of as the format says, with the line; null when it read. */
  readonly failed: { readonly line: number; readonly why: string } | null;
  /** The panel's metadata slot (Front matter for Markdown): a notebook's kernel, language and format. */
  readonly meta?: { readonly title: string; readonly rows: readonly { readonly key: string; readonly value: string }[] };
  /** A data tree's values in all, whether it is drawn in part (past TREE_MAX_VALUES), and whether from the top. */
  readonly tree?: { readonly total: number; readonly capped: boolean; readonly top: boolean };
  /** A table's or records' rows, for the page to draw every one of them from as it scrolls (`rows.ts`). */
  readonly rows?: ReadingRows;
  /** A big file's lines, for the page to draw the ones on screen from as it scrolls (`lines.ts`). */
  readonly lines?: ReadingLines;
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const plural = (n: number, one: string, many = `${one}s`): string => `${n.toLocaleString('en-GB')} ${n === 1 ? one : many}`;

interface Text {
  readonly text: string;
  readonly offsets: ByteOffsets;
  /** UTF-16 offset of each line's start. */
  readonly starts: readonly number[];
  /** UTF-16 offset of each line's end, before its line ending. */
  readonly ends: readonly number[];
}

/** A line ending as the parse reads one (`parse/line-endings.ts`): CRLF, a CR alone or an LF alone. */
const LINE_BREAK = /\r\n|\r|\n/;

/**
 * Text that is not UTF-8 (a byte-order mark says UTF-16 or UTF-32, or the bytes read as a legacy encoding), decoded as the
 * memory shell decodes a file (`decodeBytes`), with every code unit mapped back to the bytes it was read from. Null for
 * UTF-8, which the app's own pages already hold: the store keeps a file's text as UTF-8.
 */
function decodedText(bytes: Uint8Array): { text: string; offsets: ByteOffsets } | null {
  if (sniff(bytes).label === 'utf-8') return null;
  const d = decodeBytes(bytes);
  const text = new TextDecoder().decode(d.text);
  const table = new Uint32Array(text.length + 1);
  const { map } = d;
  if (map.kind === 'units') {
    // Each code unit (UTF-16) or each character (a single-byte encoding, UTF-32) is `unit` bytes of the file.
    let units = 0;
    for (let i = 0; i < text.length; i++) {
      table[i] = Math.min(d.found.bom + units * map.unit, bytes.length);
      const c = text.charCodeAt(i);
      if (map.count === 'utf16' || c < 0xd800 || c > 0xdbff) units++;
    }
  } else {
    const utf8 = byteOffsets(text);
    for (let i = 0; i < text.length; i++) table[i] = fileOffsetOf(d.found, map, d.text, utf8.at(i));
  }
  table[text.length] = bytes.length;
  return { text, offsets: { at: (o) => table[o < 0 ? 0 : o > text.length ? text.length : o]!, byteLength: bytes.length } };
}

function textOf(bytes: Uint8Array): Text {
  const decoded = decodedText(bytes);
  const bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
  const { text, offsets } = decoded ?? decodeWithOffsets(bytes, bom);
  const starts = [0];
  const ends: number[] = [];
  const breaks = new RegExp(LINE_BREAK.source, 'g');
  for (let m = breaks.exec(text); m !== null; m = breaks.exec(text)) {
    ends.push(m.index);
    starts.push(m.index + m[0].length);
  }
  ends.push(text.length);
  return { text, offsets, starts, ends };
}

function lineAt(t: Text, cu: number): number {
  let lo = 0;
  let hi = t.starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (t.starts[mid]! <= cu) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

const span = (t: Text, start: number, end: number): string => ` data-marxy-s="${t.offsets.at(start)}" data-marxy-e="${t.offsets.at(end)}"`;

/** One block of a reading set in runs: its html and the byte its text ends at. */
interface Run {
  readonly html: string;
  readonly end: number;
}

/**
 * Past this many blocks a reading goes in runs. A long row of sibling blocks is restyled whole when one of them changes (the
 * typesetter sets a paragraph), in time that grows with its length: seconds a paragraph at ten thousand.
 */
export const RUNS_FROM = 512;
/** Blocks per run: few enough that the first screens are a run or two, not a thousand paragraphs. */
export const RUN_BLOCKS = 16;

/**
 * The reading's html: `open` (its root's opening tag), `head`, then its blocks. Past RUNS_FROM the blocks go in runs, a
 * `div` each that carries the byte its last block ends at, and the root says so (`marxy-reading-runs`): the page mounts such
 * a reading a run at a time (render/progressive.ts), as it does a Markdown page's blocks, not all at once.
 */
function inRuns(open: string, head: string, blocks: readonly Run[]): string {
  if (blocks.length <= RUNS_FROM) return `${open}${head}${blocks.map((b) => b.html).join('')}</div>`;
  const out: string[] = [`${open.replace('class="marxy-reading ', 'class="marxy-reading marxy-reading-runs ')}${head}`];
  for (let i = 0; i < blocks.length; i += RUN_BLOCKS) {
    const run = blocks.slice(i, i + RUN_BLOCKS);
    out.push(`<div class="marxy-reading-run" data-marxy-e="${run[run.length - 1]!.end}">${run.map((b) => b.html).join('')}</div>`);
  }
  out.push('</div>');
  return out.join('');
}

// ---- as written: a file that does not read as its format says --------------------------------------------------

function written(t: Text, format: string, failed: Reading['failed'], note: string, account: readonly string[]): Reading {
  const rows: Run[] = [];
  for (let n = 0; n < t.starts.length; n++) {
    const s = t.starts[n]!;
    const e = t.ends[n]!;
    if (s === e && n === t.starts.length - 1) break;
    const line = t.text.slice(s, e);
    rows.push({ html: `<div class="marxy-written-line"${span(t, s, e)}><span class="marxy-written-no" aria-hidden="true">${n + 1}</span><span class="marxy-written-text">${esc(line)}</span></div>`, end: t.offsets.at(e) });
  }
  const head = accountHtml(account, esc(note));
  return { id: 'written', name: 'written', format, html: inRuns('<div class="marxy-reading marxy-written" data-marxy-reading="written">', head, rows), contents: null, failed };
}

// ---- lines: a big log, text or code file ----------------------------------------------------------------------

/**
 * From this size a data file that does not parse is shown through the lines page (windowed, as a big text file is) and
 * not as every line drawn at once: its text drawn whole is some thirty elements a line, a minute or more for a megabyte
 * of pretty-printed JSON the moment an edit leaves it unreadable.
 */
export const WRITTEN_LINES_FROM = 256 * 1024;

/** A data file that did not parse: its lines as written, drawn all at once when short and windowed when long. */
function unreadable(t: Text, path: string, bytes: Uint8Array, format: string, failed: NonNullable<Reading['failed']>, note: string, account: readonly string[]): Reading {
  if (bytes.length < WRITTEN_LINES_FROM || bytes.length >= 0xffffffff || !isUtf8(bytes)) return written(t, format, failed, note, account);
  const made = linesReading(path, bytes, 'text');
  const html = `<div class="marxy-reading marxy-lines" data-marxy-reading="lines">${accountHtml(account, esc(note))}<div class="marxy-lines-body" data-marxy-lines></div></div>`;
  return { ...made, html, format, failed };
}

/** The last lines indexed for each path, held weakly: a log that grew is indexed from where the last index ended. */
const lastLines = new Map<string, WeakRef<ReadingLines>>();

/** The page holds its account and an empty body: the lines are drawn into it as they come on screen (`view/reading-lines.ts`). */
function linesReading(path: string, bytes: Uint8Array, tier: LinesTier): Reading {
  for (const [held, ref] of lastLines) if (ref.deref() === undefined) lastLines.delete(held);
  const prev = lastLines.get(path)?.deref() ?? null;
  const lines = indexLines(bytes, tier === 'log', prev, tier === 'markdown');
  if (lines !== prev) lastLines.set(path, new WeakRef(lines));
  const html =
    `<div class="marxy-reading marxy-lines" data-marxy-reading="lines">${accountHtml(linesAccount(lines), 'Lines')}` +
    `<div class="marxy-lines-body" data-marxy-lines></div></div>`;
  return { id: 'lines', name: 'lines', format: tier, html, contents: null, failed: null, lines };
}

// ---- the data tree ------------------------------------------------------------------------------------------------

const FOLD_DEPTH = 2;
/**
 * Branches drawn open, in all. A list of a thousand maps opens each to its fields and draws the whole of it before the first
 * paint, and an open branch is most of what the page spends on a tree; the first of them fill the screen, and the rest are
 * one click each. A tree small enough to read at a glance is unchanged.
 */
const OPEN_BRANCHES_MAX = 300;
const TABLE_MIN = 3;

/** Where a tree's offsets fall in the file: a byte, and the line it is on. */
interface Place {
  byte(o: number): number;
  line(o: number): number;
}

const textPlace = (t: Text): Place => ({ byte: (o) => t.offsets.at(o), line: (o) => lineAt(t, o) });
const spanAt = (p: Place, start: number, end: number): string => ` data-marxy-s="${p.byte(start)}" data-marxy-e="${p.byte(end)}"`;

function count(node: TreeNode, n = node.children?.length ?? 0): string {
  if (node.kind === 'list') return plural(n, 'item');
  if (node.kind === 'element') return n === 0 ? 'empty' : plural(n, 'child', 'children');
  return plural(n, 'key');
}

function scalarHtml(node: TreeNode): string {
  const v = node.value ?? '';
  switch (node.type) {
    case 'string':
      return `<span class="marxy-tree-string">“${esc(v)}”</span>`;
    case 'number':
      return `<span class="marxy-tree-number">${esc(v)}</span>`;
    case 'date':
      return `<span class="marxy-tree-number">${esc(v)}</span>`;
    case 'bool':
    case 'null':
      return `<span class="marxy-tree-literal">${esc(v)}</span>`;
    case 'block':
      return `<span class="marxy-tree-block">${esc(v)}</span>`;
    default:
      return `<span class="marxy-tree-text">${esc(v)}</span>`;
  }
}

/**
 * Values a tree draws: every value is one, a map or a list as much as a number, and a table's row is its
 * map and each of its cells. The cost is in the markup each one is, not in the bytes; past it the tree stops between
 * entries and says how many more there are and where Source has them. Chosen from the page's own timing
 * (Readings).
 */
export const TREE_MAX_VALUES = 5000;
/** A map being drawn keeps its plain values past the budget, up to this many, so a record is not cut between its fields. */
const RECORD_SLACK = 64;
/** A streamed file is built this far past the budget, so the draw stops by its own rules before the parse does. */
const STREAM_LIMIT = TREE_MAX_VALUES + 4 * RECORD_SLACK;
/** Top-level keys or items the Keys card lists, and the keys not reached the page names. */
const KEYS_MAX = 200;
const MAX_WORDS = TREE_MAX_VALUES.toLocaleString('en-GB');

/** How the head says a tree drawn in part, in grey, as a tier. */
export const TREE_TIER_WORDS = `The first ${MAX_WORDS} values`;

/** The four tiers a data tree is drawn in, as the Reading card lists them; the second is a tree drawn in part. */
export function treeTierList(format: string): readonly { readonly name: string; readonly words: string }[] {
  return [
    { name: 'The whole tree', words: `up to ${MAX_WORDS} values` },
    { name: TREE_TIER_WORDS, words: 'past that; Source has the rest' },
    { name: 'As written', words: format === 'JSON' ? 'when it does not read as JSON: every line, no tree' : `past 1.5 MB, or when it does not read as ${format}: every line, no tree` },
    { name: 'The bytes', words: 'when it is not text' },
  ];
}

/** An entry at the top of the file: a root map's key or a root list's item. */
interface TopEntry {
  readonly key: string | null;
  readonly index: number;
  readonly kind: 'map' | 'list' | 'scalar' | 'element';
  readonly size: number;
  readonly start: number;
  /** A value's type, for the Keys card of a tree drawn whole. */
  readonly type?: string;
}

/** What a tree is drawn from: the whole parse, or what the stream built. */
interface TreeInput {
  readonly format: string;
  readonly name: string;
  readonly p: Place;
  readonly rootKind: TreeNode['kind'];
  /** The element itself, when the root is one (XML). */
  readonly rootNode: TreeNode | null;
  readonly entries: readonly TopEntry[];
  readonly entryCount: number;
  readonly total: number;
  /** The value drawn from, the steps to it with their keys, and its entries from `start` on (array offset `offset`). */
  readonly base: TreeNode;
  readonly from: TreeFrom;
  readonly trail: readonly { readonly key: string | null; readonly index: number }[];
  readonly start: number;
  readonly offset: number;
  readonly cut: ReadonlyMap<TreeNode, Cut>;
  /** Whether everything under the root is folded past two levels, asked only of a tree drawn whole. */
  readonly folded: () => boolean;
  /** Lines the account adds: how the kind was found, what the tree leaves out of the file. */
  readonly notes?: readonly string[];
}

/** What a tree has drawn so far, and how much it may still draw. */
interface Draw {
  readonly p: Place;
  left: number;
  /** Branches that may still be drawn open. */
  openLeft: number;
  shown: number;
  readonly cut: ReadonlyMap<TreeNode, Cut>;
  readonly base: TreeNode;
  readonly start: number;
  readonly offset: number;
  stopped: boolean;
}

const take = (d: Draw, n: number): void => {
  d.left -= n;
  d.shown += n;
};

/** The nodes in `node`'s subtree, itself included. */
function sizeOf(node: TreeNode): number {
  let n = 0;
  const stack: TreeNode[] = [node];
  while (stack.length > 0) {
    const at = stack.pop()!;
    n++;
    for (const c of at.children ?? []) stack.push(c);
  }
  return n;
}

/** A table row's column names when `item` can be one (a map, or an element of text children), else null. */
function rowKeys(item: TreeNode): string[] | null {
  if (item.kind !== 'map' && item.kind !== 'element') return null;
  if (item.kind === 'element' && (item.attrs?.length ?? 0) > 0) return null;
  const kids = item.children ?? [];
  if (!kids.every((k) => k.kind === 'scalar' || (k.kind === 'element' && (k.children ?? []).every((c) => c.kind === 'scalar')))) return null;
  return kids.map((k) => k.key ?? '');
}

const sameKeys = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((k, i) => k === b[i]);

/** A list of three or more maps that each hold the same scalar keys: a table. */
function tableKeys(node: TreeNode): string[] | null {
  if (node.kind !== 'list' || (node.children?.length ?? 0) < TABLE_MIN) return null;
  let keys: string[] | null = null;
  for (const item of node.children!) {
    const these = rowKeys(item);
    if (these === null || (keys !== null && !sameKeys(these, keys))) return null;
    keys ??= these;
  }
  return keys && keys.length > 0 ? keys : null;
}

type Part = { readonly i: number; readonly node: TreeNode } | { readonly i: number; readonly run: readonly TreeNode[]; readonly keys: string[] };

/**
 * Siblings of one element name, run together: three or more like elements read as a table. Of a run, the longest tail
 * whose elements share their keys is the table, the ones before it drawn one by one; found in one pass from the end.
 */
function runsOf(children: readonly TreeNode[], first: number): Part[] {
  const out: Part[] = [];
  let i = first;
  while (i < children.length) {
    const c = children[i]!;
    let j = i + 1;
    if (c.kind === 'element') while (j < children.length && children[j]!.kind === 'element' && children[j]!.key === c.key) j++;
    let from = j;
    const keys = j - i >= TABLE_MIN ? rowKeys(children[j - 1]!) : null;
    if (keys !== null && keys.length > 0) {
      while (from > i) {
        const these = rowKeys(children[from - 1]!);
        if (these === null || !sameKeys(these, keys)) break;
        from--;
      }
      if (j - from < TABLE_MIN) from = j;
    }
    for (let k = i; k < from; k++) out.push({ i: k, node: children[k]! });
    if (from < j) out.push({ i: from, run: children.slice(from, j), keys: keys! });
    i = j;
  }
  return out;
}

function cellOf(node: TreeNode): string {
  if (node.kind === 'scalar') return scalarHtml(node);
  const text = node.children?.find((c) => c.kind === 'scalar');
  if (text) return scalarHtml(text);
  // An element that is all attributes (Atom's <link href>): its first attribute is what it says.
  const attr = node.attrs?.[0];
  return attr ? `<span class="marxy-tree-attrs">${esc(attr.value)}</span>` : '';
}

/** A table's rows from `items[first]` on, while the budget lasts; which row it stopped before, if it did. */
function tableHtml(d: Draw, items: readonly TreeNode[], first: number, keys: readonly string[]): { html: string; stoppedAt: number | null } {
  const head = keys.map((k) => `<th>${esc(k)}</th>`).join('');
  const rows: string[] = [];
  let stoppedAt: number | null = null;
  for (let j = first; j < items.length; j++) {
    if (d.left <= 0) {
      stoppedAt = j;
      break;
    }
    const item = items[j]!;
    take(d, sizeOf(item));
    rows.push(`<tr${spanAt(d.p, item.start, item.end)}>${(item.children ?? []).map((c) => `<td>${cellOf(c)}</td>`).join('')}</tr>`);
  }
  return { html: `<table class="marxy-tree-table"><thead><tr>${head}</tr></thead><tbody>${rows.join('')}</tbody></table>`, stoppedAt };
}

function keyHtml(node: TreeNode, index: number | null): string {
  if (node.key !== null) return `<span class="marxy-tree-key">${esc(node.key)}</span>`;
  return index === null ? '' : `<span class="marxy-tree-index">${index}</span>`;
}

function attrsHtml(node: TreeNode): string {
  if (!node.attrs || node.attrs.length === 0) return '';
  return ` <span class="marxy-tree-attrs">${node.attrs.map((a) => `<span class="marxy-tree-attr">${esc(a.name)}</span>=<span class="marxy-tree-string">“${esc(a.value)}”</span>`).join(' ')}</span>`;
}

const isTextElement = (node: TreeNode): boolean => node.kind === 'element' && (node.children ?? []).length === 1 && node.children![0]!.kind === 'scalar';
/** Drawn on one line: a value, an element holding only text, an empty element. */
const isLeaf = (node: TreeNode): boolean => node.kind === 'scalar' || isTextElement(node) || (node.kind === 'element' && (node.children ?? []).length === 0);

/** A list's, map's or element's entries in all, the ones not built included. */
const entriesOf = (d: Draw, node: TreeNode): number => (node === d.base ? d.offset : 0) + (node.children?.length ?? 0) + (d.cut.get(node)?.more ?? 0);

const ENTRY_WORDS: Readonly<Record<TreeNode['kind'], readonly [string, string]>> = {
  list: ['item', 'items'],
  map: ['key', 'keys'],
  element: ['child', 'children'],
  scalar: ['value', 'values'],
};

/** The line where a tree stops: how many more entries this one has, where Source has them, and the two ways on. */
function stopHtml(d: Draw, node: TreeNode, path: readonly number[], index: number, more: number, at: number): string {
  d.stopped = true;
  const [one, many] = ENTRY_WORDS[node.kind];
  const line = d.p.line(at).toLocaleString('en-GB');
  return `<div class="marxy-tree-stop"${spanAt(d.p, at, at)}><p><b>${more.toLocaleString('en-GB')} more ${more === 1 ? one : many} here, not drawn.</b> The tree draws the first ${MAX_WORDS} values; Source has the rest, from line ${line}.</p><div class="marxy-tree-ways"><button type="button" class="marxy-btn" data-marxy-tree-source="${d.p.byte(at)}">Go on in Source, at line ${line}</button><button type="button" class="marxy-btn" data-marxy-tree-from="${treeFromCode({ path, from: index })}">Draw from here</button></div></div>`;
}

/** `node`'s entries from array index `first` on: each drawn, or the stop line where the budget ends, or where the build was cut. */
function entriesHtml(d: Draw, node: TreeNode, depth: number, path: readonly number[], first: number, tables = true): string {
  const kids = node.children ?? [];
  const off = node === d.base ? d.offset : 0;
  const cut = d.cut.get(node);
  const left = (j: number): number => kids.length - j + (cut?.more ?? 0);
  const keys = tables ? tableKeys(node) : null;
  if (keys) {
    const { html, stoppedAt } = tableHtml(d, kids, first, keys);
    if (stoppedAt !== null) return html + stopHtml(d, node, path, off + stoppedAt, left(stoppedAt), kids[stoppedAt]!.start);
    return html + (cut ? stopHtml(d, node, path, off + kids.length, cut.more, cut.at) : '');
  }
  const parts: Part[] = node.kind === 'element' ? runsOf(kids, first) : kids.slice(first).map((c, k) => ({ i: first + k, node: c }));
  const out: string[] = [];
  for (const p of parts) {
    if ('run' in p) {
      const lead = p.run[0]!;
      const head = `<div class="marxy-tree-leaf"${spanAt(d.p, lead.start, lead.start)}><span class="marxy-tree-key">${esc(lead.key ?? '')}</span> <span class="marxy-tree-meta">${plural(p.run.length, 'of them', 'of them')} · as a table</span></div>`;
      if (d.left <= 0) {
        out.push(stopHtml(d, node, path, off + p.i, left(p.i), lead.start));
        return out.join('');
      }
      const { html, stoppedAt } = tableHtml(d, p.run, 0, p.keys);
      out.push(`<div class="marxy-tree-run">${head}${html}</div>`);
      if (stoppedAt !== null) {
        out.push(stopHtml(d, node, path, off + p.i + stoppedAt, left(p.i + stoppedAt), p.run[stoppedAt]!.start));
        return out.join('');
      }
      continue;
    }
    const c = p.node;
    // A stop falls between entries, never inside one: before a map or a list, or an item of a long list; a record's
    // plain values, and the items of a short list of them, are drawn with it, up to the slack.
    if (d.left <= 0 && (!isLeaf(c) || d.left <= -RECORD_SLACK || (node.kind === 'list' && entriesOf(d, node) > RECORD_SLACK))) {
      out.push(stopHtml(d, node, path, off + p.i, left(p.i), c.start));
      return out.join('');
    }
    out.push(nodeHtml(d, c, depth + 1, node.kind === 'list' ? off + p.i : null, [...path, off + p.i]));
  }
  if (cut) out.push(stopHtml(d, node, path, off + kids.length, cut.more, cut.at));
  return out.join('');
}

function nodeHtml(d: Draw, node: TreeNode, depth: number, index: number | null, path: readonly number[]): string {
  const p = d.p;
  if (isLeaf(node)) {
    const text = isTextElement(node);
    take(d, text ? 2 : 1);
    const value = node.kind === 'scalar' ? scalarHtml(node) : text ? scalarHtml(node.children![0]!) : '';
    return `<div class="marxy-tree-leaf"${spanAt(p, node.start, node.end)}>${keyHtml(node, index)}${attrsHtml(node)} ${value}</div>`;
  }
  take(d, 1);
  const kind = node.kind === 'list' ? '[ ]' : node.kind === 'element' ? '' : '{ }';
  const table = tableKeys(node) !== null;
  const meta = `<span class="marxy-tree-meta">${kind ? `${kind} ` : ''}${count(node, entriesOf(d, node))}${table ? ' · as a table' : ''}</span>`;
  const early = depth < FOLD_DEPTH && d.openLeft-- > 0;
  const stoppedBefore = d.stopped;
  const body = entriesHtml(d, node, depth, path, node === d.base ? d.start : 0);
  // The branch the tree stops in stays open past the limit: its stop line and the ways on from it are not to be folded away.
  const open = early || (depth < FOLD_DEPTH && d.stopped && !stoppedBefore) ? ' open' : '';
  return `<details class="marxy-tree-branch"${open}${spanAt(p, node.start, node.end)}><summary>${keyHtml(node, index)}${attrsHtml(node)} ${meta}</summary><div class="marxy-tree-kids">${body}</div></details>`;
}

/** The root element's children by name, in first-seen order: an Atom feed's `entry` once, with how many there are. */
function elementItems(p: Place, root: TreeNode): ReadingItem[] {
  const seen = new Map<string, { first: TreeNode; n: number }>();
  for (const c of root.children ?? []) {
    if (c.kind !== 'element' && c.key === null) continue;
    const name = c.key ?? '';
    const held = seen.get(name);
    if (held) held.n++;
    else seen.set(name, { first: c, n: 1 });
  }
  return [...seen].map(([name, { first, n }]) => ({
    text: name,
    sub:
      n > 1
        ? `${n} of them`
        : first.kind === 'scalar' || ((first.children?.length ?? 0) > 0 && first.children!.every((c) => c.kind === 'scalar'))
          ? 'text'
          : (first.children?.length ?? 0) === 0 && (first.attrs?.length ?? 0) > 0
            ? plural(first.attrs!.length, 'attribute')
            : count(first),
    byte: p.byte(first.start),
  }));
}

const ENTRY_COUNT: Readonly<Record<TopEntry['kind'], (n: number) => string>> = {
  map: (n) => plural(n, 'key'),
  list: (n) => plural(n, 'item'),
  element: (n) => plural(n, 'child', 'children'),
  scalar: () => '',
};

function treeReading(input: TreeInput): Reading {
  const { p, rootKind, total, from, entries, entryCount } = input;
  const capped = total > TREE_MAX_VALUES;
  const top = from.path.length === 0 && rootKind !== 'element' && rootKind !== 'scalar';
  const d: Draw = { p, left: TREE_MAX_VALUES, openLeft: OPEN_BRANCHES_MAX, shown: 0, cut: input.cut, base: input.base, start: input.start, offset: input.offset, stopped: false };
  const drawn: string[] = [];
  if (top) {
    // The root map or list is the page itself, not a node on it: its entries are drawn at the top, and a root map's
    // keys not reached are named after the stop, each a way to draw from there.
    const root = input.base;
    if (rootKind === 'list') drawn.push(entriesHtml(d, root, -1, [], input.start, false));
    else {
      const kids = root.children ?? [];
      let next = input.start;
      for (; next < kids.length && d.left > 0; next++) drawn.push(nodeHtml(d, kids[next]!, 0, null, [input.offset + next]));
      const reached = input.offset + next;
      if (reached < entryCount) {
        d.stopped = true;
        const named = entries.filter((e) => e.index >= reached).slice(0, KEYS_MAX);
        for (const e of named) {
          drawn.push(
            `<div class="marxy-tree-leaf marxy-tree-undrawn"${spanAt(p, e.start, e.start)}><span class="marxy-tree-key">${esc(e.key ?? '')}</span> <span class="marxy-tree-meta">not drawn · <button type="button" class="marxy-linkish" data-marxy-tree-from="${treeFromCode({ path: [e.index], from: 0 })}">draw from here</button></span></div>`,
          );
        }
        const after = named.length > 0 ? named[named.length - 1]!.index + 1 : reached;
        const atNext = entries.find((e) => e.index === after);
        if (after < entryCount && atNext) drawn.push(stopHtml(d, root, [], after, entryCount - after, atNext.start));
      }
    }
  } else if (input.base.kind === 'scalar') {
    drawn.push(nodeHtml(d, input.base, 0, null, from.path));
  } else {
    const last = input.trail[input.trail.length - 1];
    drawn.push(nodeHtml(d, input.base, 0, last && last.key === null ? last.index : null, from.path));
  }
  const what = rootKind === 'list' ? plural(entryCount, 'item') : rootKind === 'element' ? `&lt;${esc(input.rootNode?.key ?? '')}&gt;` : plural(entryCount, 'key');
  const all = total.toLocaleString('en-GB');
  const fromTop = from.path.length === 0 && from.from === 0;
  const cap = !capped ? '' : fromTop ? ` · the first ${MAX_WORDS} of ${all} values drawn; Source has the rest` : ` · ${Math.min(d.shown, TREE_MAX_VALUES).toLocaleString('en-GB')} of ${all} values drawn from here; Source has the rest`;
  const caption = `${esc(input.format)}${input.notes?.some((n) => n.startsWith('Read as ')) ? ', read from its text' : ''} · ${what} at the top${cap || (input.folded() ? ' · folded past two levels' : '')}`;
  let crumb = '';
  if (!fromTop) {
    const steps = input.trail.map((s) => ` › ${esc(s.key ?? String(s.index))}`).join('');
    const firstKid = input.base.children?.[input.start];
    const at = from.from === 0 ? '' : input.base.kind === 'list' || input.base.kind === 'element' || !firstKid?.key ? ` › from ${input.base.kind === 'element' ? 'child' : 'item'} ${from.from.toLocaleString('en-GB')}` : ` › from ${esc(firstKid.key)}`;
    crumb = `<div class="marxy-tree-crumb"><button type="button" class="marxy-linkish" data-marxy-tree-from="@0">${esc(input.name)}</button>${steps}${at}</div>`;
  }
  const account = accountHtml(
    [
    ...(input.notes ?? []),
    `Keys are in the order the file writes them. Folding changes only the view; Source has the file as written.`,
    capped
      ? `A tree is drawn up to ${MAX_WORDS} values so a large file stays quick to open. Draw from here starts the tree at any part of it. Find in the page searches what is drawn; find in Source searches everything.`
      : '',
    ],
    caption,
  );
  let contents: Reading['contents'];
  if (rootKind === 'element') contents = { title: 'Elements', items: input.rootNode ? elementItems(p, input.rootNode) : [] };
  else if (capped) {
    // Each top-level key with its size and line, each a way to draw the tree from there.
    const items = entries.slice(0, KEYS_MAX).map((e) => {
      const line = `line ${p.line(e.start).toLocaleString('en-GB')}`;
      return { text: e.key ?? `[${e.index}]`, sub: e.kind === 'scalar' ? line : `${ENTRY_COUNT[e.kind](e.size)} · ${line}`, byte: p.byte(e.start), from: treeFromCode({ path: [e.index], from: 0 }) };
    });
    contents = { title: 'Keys', items, detail: entryCount > items.length ? `the first ${items.length} of ${entryCount.toLocaleString('en-GB')} · draw from any` : 'draw from any' };
  } else {
    const items = entries.map((e, i) => ({ text: e.key ?? `[${i}]`, sub: e.kind === 'scalar' ? (e.type ?? 'value') : e.kind === 'element' && e.size === 0 ? 'empty' : ENTRY_COUNT[e.kind](e.size), byte: p.byte(e.start) }));
    contents = { title: 'Keys', items };
  }
  return {
    id: 'tree',
    name: 'a data tree',
    format: input.format,
    html: `<div class="marxy-reading marxy-tree" data-marxy-reading="tree">${crumb}${account}${drawn.join('')}</div>`,
    contents,
    failed: null,
    tree: { total, capped, top: fromTop },
  };
}

/** The node `path` leads to from `root`, with the keys on the way; null when it leads nowhere. */
function walkTo(root: TreeNode, path: readonly number[]): { node: TreeNode; trail: { key: string | null; index: number }[] } | null {
  let node = root;
  const trail: { key: string | null; index: number }[] = [];
  for (const step of path) {
    const next = node.children?.[step];
    if (!next) return null;
    trail.push({ key: next.key, index: step });
    node = next;
  }
  return { node, trail };
}

const nameOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

/** A file parsed whole (up to 1.5 MB): drawn from `from` when that leads somewhere, else from the top. */
function wholeTree(t: Text, root: TreeNode, format: string, path: string, from: TreeFrom | null, notes: readonly string[] = []): Reading {
  const p = textPlace(t);
  const top = root.kind === 'element' ? [] : (root.children ?? []);
  const reached = from && !isTreeTop(from) ? walkTo(root, from.path) : null;
  const at = reached && (from!.from === 0 || reached.node.kind !== 'scalar') ? { from: from!, ...reached } : { from: { path: [], from: 0 }, node: root, trail: [] };
  return treeReading({
    format,
    name: nameOf(path),
    p,
    rootKind: root.kind,
    rootNode: root.kind === 'element' ? root : null,
    entries: top.map((c, index) => ({ key: c.key, index, kind: c.kind, size: c.children?.length ?? 0, start: c.start, ...(c.type ? { type: c.type } : {}) })),
    entryCount: top.length,
    total: sizeOf(root),
    base: at.node,
    from: at.from,
    trail: at.trail,
    start: at.from.from,
    offset: 0,
    cut: new Map(),
    notes,
    folded: () =>
      (function deep(n: TreeNode, depth: number): boolean {
        return (n.children ?? []).some((c) => (c.children?.length ?? 0) > 0 && (depth + 1 >= FOLD_DEPTH || deep(c, depth + 1)));
      })(root, 0),
  });
}

/**
 * A JSON file past what is parsed whole: the count from a fast scan, the first values from
 * a streaming parse. Null when its brackets or strings do not close, or the part drawn does not read: then it is set as
 * written, every line and no tree, as it was.
 */
function streamedTree(bytes: Uint8Array, path: string, from: TreeFrom | null): Reading | null {
  const scan = scanJson(bytes);
  if (scan.broken || scan.root === null) return null;
  let stream: JsonStream | null = null;
  let drawnFrom: TreeFrom = { path: [], from: 0 };
  try {
    if (from && !isTreeTop(from)) {
      stream = parseJsonFrom(bytes, STREAM_LIMIT, from, scan);
      if (stream) drawnFrom = from;
    }
    stream ??= parseJsonFrom(bytes, STREAM_LIMIT, drawnFrom, scan);
  } catch (error) {
    if (error instanceof TreeError) return null;
    throw error;
  }
  if (!stream) return null;
  return treeReading({
    format: 'JSON',
    name: nameOf(path),
    p: { byte: (o) => o, line: (o) => lineOfByte(bytes, o) },
    rootKind: scan.root,
    rootNode: null,
    entries: scan.entries,
    entryCount: scan.entryCount,
    total: scan.values,
    base: stream.base,
    from: drawnFrom,
    trail: stream.trail,
    // The stream builds a list or map from its entry `from` on: its first built entry is that one.
    start: 0,
    offset: drawnFrom.from,
    cut: stream.cut,
    folded: () => false,
  });
}

// ---- JSON Lines and CSV: every row, drawn as the table scrolls (rows.ts) --------------------------------------------

/** The line under a table drawn in part, for a page with no table of its own to scroll (a preview): where the rest are. */
const moreRows = (shown: number, all: number | null): string =>
  all === null || all > shown
    ? `<div class="marxy-reading-foot" data-marxy-rows-more>The first ${plural(shown, 'row')}${all === null ? '' : ` of ${all.toLocaleString('en-GB')}`}; the file open in Read has them all.</div>`
    : '';
const moreColumns = (rows: ReadingRows, shown: number): string =>
  rows.columns.length > shown ? `<div class="marxy-reading-foot">The first ${plural(shown, 'column')} of ${columnTotal(rows)}; ${allColumnsIn(rows)} has them all.</div>` : '';
/** Where every column is: a CSV's Table view, else the file as written. */
const allColumnsIn = (rows: ReadingRows): string => (rows.form === 'table' ? 'Table view' : 'Source');

/** What the account says of the rows, for both readings. */
const ROWS_ACCOUNT = [
  'Every row is in the table. A long file’s rows are read from its bytes as the table scrolls to them, so the first rows show at once and the last are as near as the scrollbar’s end.',
  'Click a column’s name to sort the rows; the row filter (=) and find look through every row. In a long file they work in the background, and the line under the table says how far they have got. Sorting and filtering change only the view, never the file.',
];
const columnsAccount = (rows: ReadingRows): string[] =>
  rows.columns.length > READING_MAX_COLUMNS ? [`Only the first ${READING_MAX_COLUMNS} columns are drawn, to keep each row light; ${allColumnsIn(rows)} has every column.`] : [];

/**
 * The table's markup: the rows drawn now (every row up to READING_MAX_ROWS, else the first screens), the line that says
 * where the rest are, and the reading's rows for the page to draw the rest from.
 */
function rowsTable(rows: ReadingRows, open: string, tableStart: number): { readonly html: string; readonly drawn: number } {
  const all = rowsSettled(rows) || rows.indexed ? rowCount(rows) : null;
  const drawn = all !== null && all <= READING_MAX_ROWS ? all : Math.min(FIRST_ROWS, rowCount(rows));
  const last = rowCount(rows) > 0 ? rowRange(rows, drawn > 0 ? drawn - 1 : 0).end : (rows.header?.end ?? 0);
  const th = headHtml(rows);
  const body = rowsHtml(rows, null, 0, drawn);
  return {
    html: `${open}<div class="marxy-reading-scroll"><table class="marxy-reading-table" data-marxy-s="${tableStart}" data-marxy-e="${last}"><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table></div>${moreRows(drawn, all)}${moreColumns(rows, drawnColumns(rows).length)}`,
    drawn,
  };
}

function recordsReading(bytes: Uint8Array): Reading | null {
  const rows = recordRows(bytes);
  // The first rows' keys say whether this is JSON Lines at all; the rest are read by the page as it shows them.
  indexSome(rows, { rows: READING_MAX_ROWS });
  parseSome(rows);
  if (rows.parsed - rows.badRows < 2) return null;
  // A file of no more lines than the page draws whole is read through now, so its counts are of every line.
  if (indexSome(rows, { rows: 1 }) && rowCount(rows) <= READING_MAX_ROWS) parseSome(rows);
  const good = rows.parsed - rows.badRows;
  const account = accountHtml(
    [
      'One record per line, with its keys as columns in the order they first appear in the file. An empty cell means that record has no such key.',
      ...ROWS_ACCOUNT,
      ...columnsAccount(rows),
    ],
    esc(recordsHeadText(rows)),
    ' data-marxy-rows-head',
  );
  const foot = '<div class="marxy-reading-foot" data-marxy-sort-note></div>';
  const table = rowsTable(rows, `<div class="marxy-reading marxy-records" data-marxy-reading="records">${account}`, rows.starts.data[0]!);
  const shown = drawnColumns(rows);
  const items = shown.map((c) => ({ text: c.name, sub: c.has === good ? 'every record' : `in ${c.has} of ${good}`, byte: c.first }));
  const detail = [
    ...(shown.length < rows.columns.length ? [`the first ${shown.length} of ${columnTotal(rows)}`] : []),
    ...(rowsSettled(rows) ? [] : [`from the first ${plural(rows.parsed, 'record')}`]),
  ];
  return {
    id: 'records',
    name: 'records',
    format: 'JSON Lines',
    html: `${table.html}${foot}</div>`,
    contents: { title: 'Columns', items, ...(detail.length > 0 ? { detail: detail.join(', ') } : {}) },
    failed: null,
    rows,
  };
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}(?:$|[T ])/;

/** A column in a few words, as the Columns card says it: a range for numbers and dates, the values when there are few. */
export function describeColumn(cells: readonly string[]): string {
  const values = cells.map((v) => v.trim()).filter((v) => v !== '');
  if (values.length === 0) return 'empty';
  const nums = values.map((v) => Number(v.replace(/[,%]/g, '')));
  if (nums.every((n) => Number.isFinite(n))) {
    // A loop, not Math.min(...nums): a column of a few hundred thousand rows is past the engine's argument limit.
    let lo = nums[0]!;
    let hi = lo;
    for (const n of nums) {
      if (n < lo) lo = n;
      if (n > hi) hi = n;
    }
    return lo === hi ? String(lo) : `${lo} to ${hi}`;
  }
  const distinct = [...new Set(values)];
  if (values.every((v) => ISO_DAY.test(v))) {
    const days = [...new Set(values.map((v) => v.slice(0, 10)))].sort();
    const sameYear = days[0]!.slice(0, 4) === days[days.length - 1]!.slice(0, 4);
    const short = (d: string): string => (sameYear ? d.slice(5) : d);
    return days.length === 1 ? days[0]! : `${plural(days.length, 'date')}, ${short(days[0]!)} to ${short(days[days.length - 1]!)}`;
  }
  if (distinct.length <= 4 && distinct.every((v) => v.length <= 24)) return distinct.join(', ');
  return distinct.length === values.length ? plural(values.length, 'value') : `${plural(distinct.length, 'value')} in ${plural(values.length, 'row')}`;
}

/**
 * Up to this, a table is indexed whole as it opens, so its Columns card is of every row. Past it the card is of the
 * first rows, and the page indexes the rest a slice at a time.
 */
const TABLE_WHOLE_BYTES = 2 * 1024 * 1024;

const NUMBER_CELL = /^\s*-?[\d.,]+%?\s*$/;

function tableReading(bytes: Uint8Array, path: string): Reading | null {
  const rows = tableRows(bytes, delimiterFor(path) ?? ',');
  if (!rows) return null;
  indexSome(rows, bytes.length <= TABLE_WHOLE_BYTES ? {} : { rows: READING_MAX_ROWS });
  const sample = Math.min(rowCount(rows), rows.indexed ? rowCount(rows) : READING_MAX_ROWS);
  const shown = drawnColumns(rows);
  const values: string[][] = shown.map(() => []);
  let anyRow = false;
  for (let r = 0; r < sample; r++) {
    const cells = rowCells(rows, r);
    if (cells.bad) continue;
    anyRow = true;
    shown.forEach((_, i) => values[i]!.push(cells.values[i] ?? ''));
  }
  // Numbers set to the right, judged by the rows the Columns card reads.
  shown.forEach((c, i) => {
    c.numeric = anyRow && values[i]!.every((v) => NUMBER_CELL.test(v) || v === '');
  });
  const format = rows.delimiter === '\t' ? 'TSV' : 'CSV';
  const foot = '<div class="marxy-reading-foot" data-marxy-sort-note></div>';
  const account = accountHtml([
    `The first row is read as the columns’ names. Each cell is the field as the file writes it, quotes removed.`,
    ...ROWS_ACCOUNT,
    ...columnsAccount(rows),
  ]);
  const items = shown.map((c, i) => ({ text: c.name, sub: describeColumn(values[i]!), byte: c.first }));
  const detail = [
    ...(shown.length < rows.columns.length ? [`the first ${shown.length} of ${columnTotal(rows)}`] : []),
    ...(rows.indexed ? [] : [`from the first ${plural(READING_MAX_ROWS, 'row')}`]),
  ];
  const table = rowsTable(rows, `<div class="marxy-reading marxy-records" data-marxy-reading="table">${account}`, rows.header!.start);
  return {
    id: 'table',
    name: 'a table',
    format,
    html: `${table.html}${foot}</div>`,
    contents: { title: 'Columns', items, ...(detail.length > 0 ? { detail: detail.join(', ') } : {}) },
    failed: null,
    rows,
  };
}

// ---- verse and plain prose ------------------------------------------------------------------------------------------

/** Verse, guessed from the shape: eight lines or more, short, in groups of three or more set apart by blank lines. */
export function looksLikeVerse(text: string): boolean {
  const lines = text.split(LINE_BREAK);
  const full = lines.filter((l) => l.trim() !== '');
  if (full.length < 8) return false;
  const lengths = full.map((l) => l.trim().length).sort((a, b) => a - b);
  if (lengths[Math.floor(lengths.length / 2)]! > 42 || lengths[lengths.length - 1]! > 64) return false;
  const stanzas: number[] = [];
  let run = 0;
  for (const l of lines) {
    if (l.trim() === '') {
      if (run > 0) stanzas.push(run);
      run = 0;
    } else run++;
  }
  if (run > 0) stanzas.push(run);
  return stanzas.filter((n) => n >= 3).length >= 2;
}

function verseReading(t: Text): Reading {
  const out: Run[] = [];
  const stanzas: { first: string; lines: number; byte: number }[] = [];
  let n = 0;
  let stanza: string[] | null = null;
  let stanzaEnd = 0;
  const close = (): void => {
    if (stanza) out.push({ html: `<div class="marxy-stanza">${stanza.join('')}</div>`, end: t.offsets.at(stanzaEnd) });
    stanza = null;
  };
  const lineOf = (i: number): string => t.text.slice(t.starts[i]!, t.ends[i]!);
  let title: string | null = null;
  let first = -1;
  for (let i = 0; i < t.starts.length && first < 0; i++) if (lineOf(i).trim() !== '') first = i;
  const singleTitle = first >= 0 && (first + 1 >= t.starts.length || lineOf(first + 1).trim() === '');
  for (let i = 0; i < t.starts.length; i++) {
    const raw = lineOf(i);
    const s = t.starts[i]!;
    if (raw.trim() === '') {
      close();
      continue;
    }
    if (i === first && singleTitle) {
      title = raw.trim();
      out.push({ html: `<h1 class="marxy-verse-title"${span(t, s, s + raw.length)}>${esc(title)}</h1>`, end: t.offsets.at(s + raw.length) });
      continue;
    }
    if (!stanza) {
      stanza = [];
      stanzas.push({ first: raw.trim(), lines: 0, byte: t.offsets.at(s) });
    }
    n++;
    stanzas[stanzas.length - 1]!.lines++;
    const lead = raw.length - raw.trimStart().length;
    stanza.push(`<div class="marxy-verse-line"${span(t, s, s + raw.length)}${lead > 0 ? ` style="--marxy-verse-indent:${lead}"` : ''}>${n % 5 === 0 ? `<span class="marxy-verse-no" aria-hidden="true">${n}</span>` : ''}${esc(raw.trimStart())}</div>`);
    stanzaEnd = s + raw.length;
  }
  close();
  return {
    id: 'verse',
    name: 'verse',
    format: 'plain text',
    html: inRuns('<div class="marxy-reading marxy-verse" data-marxy-reading="verse">', accountHtml(['Read as verse: every line and stanza break is kept where the file has it, with its indent, and every fifth line is numbered. Source shows the file as written.']), out),
    contents: { title: 'Stanzas', items: stanzas.map((s) => ({ text: s.first, sub: plural(s.lines, 'line'), byte: s.byte })) },
    failed: null,
  };
}

function proseReading(t: Text): Reading {
  const paras: Run[] = [];
  let start = -1;
  let buf: string[] = [];
  const flush = (end: number): void => {
    if (buf.length > 0) paras.push({ html: `<p${span(t, start, end)}>${esc(buf.join(' '))}</p>`, end: t.offsets.at(end) });
    buf = [];
    start = -1;
  };
  for (let i = 0; i < t.starts.length; i++) {
    const s = t.starts[i]!;
    const raw = t.text.slice(s, t.ends[i]!);
    if (raw.trim() === '') {
      flush(s);
      continue;
    }
    if (start < 0) start = s;
    buf.push(raw.trim());
  }
  flush(t.text.length);
  return {
    id: 'prose',
    name: 'plain prose',
    format: 'plain text',
    html: inRuns(
      '<div class="marxy-reading marxy-prose" data-marxy-reading="prose">',
      accountHtml(
        ['Every break inside a paragraph is where its lines were wrapped to fit, so they are joined for reading; a blank line starts a new one. The file keeps its own line breaks, and Source shows them as written.'],
        'Plain text, set as paragraphs',
      ),
      paras,
    ),
    contents: null,
    failed: null,
  };
}

// ---- choosing -------------------------------------------------------------------------------------------------------

/** Names read by their shape, as `.txt` is; a changelog's (CHANGES, NEWS) and CONTRIBUTING are their Markdown page. */
const PLAIN_NAMES = new Set([
  'notes', 'license', 'licence', 'copying', 'authors', 'todo', 'install', 'hacking', 'contributors', 'readme',
  'security', 'code_of_conduct', 'governance', 'support', 'faq', 'bugs', 'roadmap',
  'notice', 'copyright', 'unlicense', 'patents', 'thanks', 'credits', 'maintainers', 'acknowledgments', 'acknowledgements',
  'license-mit', 'license-apache', 'license-apache-2.0', 'license-bsd', 'license-gpl', 'license-lgpl', 'license-mpl', 'license-isc',
  'license-zlib', 'license-cc0', 'license.mit', 'license.apache', 'license.bsd', 'licence-mit', 'licence-apache',
  'copying.lesser', 'copying.lib', 'copying.gpl', 'copying.lgpl',
]);
/** Kinds whose plain text is read as prose or verse; any other kind keeps its own reading. */
const PROSE_KINDS = new Set(['article', 'notes', 'book', 'report', 'readme', 'docs', 'changelog', null]);
/** Past this, a tree is not made: the file is shown as Source has it. */
const TREE_MAX_BYTES = 1536 * 1024;

function extOf(path: string): { ext: string; name: string } {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return { ext: dot > 0 ? name.slice(dot + 1).toLowerCase() : '', name: name.toLowerCase() };
}

const cache = new WeakMap<Uint8Array, Map<string, Reading | null>>();

/**
 * How Read sets `path`, or null when its page is the Markdown or code page. `kind` is the kind it was decided to be.
 * A file whose bytes do not read as its format says is set as written, with the line and what was expected there.
 */
export function readingOf(path: string, bytes: Uint8Array, kind: string | null = null, from: TreeFrom | null = null): Reading | null {
  // Show rendered changes what Markdown past the lines tier reads as, with the same bytes.
  const key = `${path}\0${kind}\0${isTreeTop(from) ? '' : treeFromCode(from!)}\0${renderedChosen(path) ? 'r' : ''}`;
  const held = cache.get(bytes)?.get(key);
  if (held !== undefined) return held;
  const made = choose(path, bytes, kind, isTreeTop(from) ? null : from);
  let byPath = cache.get(bytes);
  if (!byPath) cache.set(bytes, (byPath = new Map()));
  byPath.set(key, made);
  return made;
}

const TREE_PARSERS: Readonly<Record<string, readonly [string, (s: string) => TreeNode]>> = {
  json: ['JSON', parseJson],
  yaml: ['YAML', parseYaml],
  toml: ['TOML', parseToml],
  xml: ['XML', parseXml],
  jsonc: ['JSON with comments', (s) => parseJsonc(s)],
  json5: ['JSON5', (s) => parseJsonc(s, true)],
};

/** Whether `choose` reaches its plain-text branch for `path` as `kind`: verse, prose, as written, or the Markdown page. */
function plainPath(path: string, kind: string | null): boolean {
  const type = fileTypeFor(path);
  if (type.reading === 'tree' && type.lang !== undefined && TREE_PARSERS[type.lang]) return false;
  if (type.reading === 'records' || type.reading === 'table' || type.reading === 'notebook') return false;
  return (type.id === 'text' || PLAIN_NAMES.has(extOf(path).name)) && PROSE_KINDS.has(kind);
}

/**
 * Whether Read sets `path` as verse, plain prose or as written (`readingOf`), without making the reading: none of the
 * three reads a Markdown parse of the file, so an open can leave that parse until something asks for it.
 */
export function setsPlainReading(path: string, bytes: Uint8Array, kind: string | null = null): boolean {
  if (linesTier(path, bytes, kind) !== null) return true;
  if (!plainPath(path, kind)) return false;
  const text = new TextDecoder().decode(bytes);
  return looksLikeVerse(text) || !carriesMarkdown(text);
}

function choose(path: string, bytes: Uint8Array, kind: string | null, from: TreeFrom | null): Reading | null {
  const tier = linesTier(path, bytes, kind);
  if (tier !== null) return linesReading(path, bytes, tier);
  const type = fileTypeFor(path);
  // A data file you chose to read as something else (code, say) is set as that kind's page, not as data.
  const asData = kind === null || kind === 'data';
  const tree = type.reading === 'tree' && type.lang !== undefined ? TREE_PARSERS[type.lang] : undefined;
  if (tree) {
    if (!asData) return null;
    if (type.lang === 'json' && bytes.length > TREE_MAX_BYTES) return streamedTree(bytes, path, from);
    if (bytes.length > TREE_MAX_BYTES) return null;
    const t = textOf(bytes);
    let [format, parse] = tree;
    const notes: string[] = [];
    if (guessedFromBytes(path) && (type.lang === 'xml' || type.lang === 'json')) {
      notes.push(`Read as ${format} from its text: the name does not say what the file is, and its text is ${format}.`);
    }
    try {
      let root: TreeNode;
      try {
        root = parse(t.text);
      } catch (error) {
        // Comments and trailing commas are what tsconfig.json and .vscode files carry; the tree skips them in place.
        if (!(error instanceof TreeError) || type.lang !== 'json') throw error;
        root = parseJsonc(t.text);
        format = 'JSON with comments';
        notes.push('This file has comments or trailing commas, which JSON does not. The tree skips them; Source keeps every byte of them.');
      }
      return wholeTree(t, root, format, path, from, notes);
    } catch (error) {
      if (!(error instanceof TreeError)) throw error;
      const line = lineAt(t, error.at);
      return unreadable(t, path, bytes, format, { line, why: error.message }, `${format} that Marxy cannot draw as a tree: at line ${line}, ${error.message}. Shown line by line, as written.`, ['Nothing in the file was changed. The line named above is where reading stopped; Source shows it with the rest.']);
    }
  }
  if (type.reading === 'records') {
    if (!asData && kind !== 'log') return null;
    return recordsReading(bytes) ?? written(textOf(bytes), 'JSON Lines', null, 'JSON Lines with fewer than two records · shown line by line, as written', [
      'A table needs at least two records, one JSON value per line. Nothing in the file was changed.',
    ]);
  }
  if (type.reading === 'table') return asData ? tableReading(bytes, path) : null;
  if (type.reading === 'notebook') {
    if (!asData || bytes.length > NOTEBOOK_MAX_BYTES) return null;
    const t = textOf(bytes);
    const read = notebookReading(path, t.text, t.offsets, (cu) => lineAt(t, cu));
    if ('id' in read) return read;
    const { line, why } = read.failed;
    return unreadable(t, path, bytes, 'Jupyter notebook', read.failed, `A notebook Marxy cannot read: at line ${line}, ${why}. Shown line by line, as written.`, ['Nothing in the file was changed. The line named above is where reading stopped; Source shows it with the rest.']);
  }
  if (plainPath(path, kind)) {
    const t = textOf(bytes);
    if (looksLikeVerse(t.text)) return verseReading(t);
    if (carriesMarkdown(t.text)) return null;
    if (looksLikeProse(t.text)) return proseReading(t);
    return written(t, 'plain text', null, 'Plain text', ['Every line is shown as the file writes it, numbered, with nothing joined or left out. Long lines wrap on screen only.']);
  }
  return null;
}

/** A heading: `#` to `######`, a space, then text. A `#hashtag` with no space is none. */
const MARK_HEADING = /^ {0,3}#{1,6}[ \t]+\S/;
/** A line plain text does not write: a fence, a table's rule, a link's definition, a task. */
const MARK_LINE = /^(?: {0,3}(?:```|~~~)|\s*(?:\|\s*)?:?-{3,}:?\s*\|[\s|:-]*$| {0,3}\[[^\]\n]+\]:[ \t]+\S|\s*[-*+][ \t]+\[[ xX]\][ \t])/;
/** A mark inside a line: a link, code in backticks, emphasis opened and closed. A lone `*` or a snake_case name is none. */
const MARK_INLINE = /!?\[[^\]\n]+\]\([^)\s]+\)|`[^`\n]+`|\*\*\S[^*\n]*\*\*|__\S[^_\n]*__|(?<![\w*])\*[^*\s][^*\n]*?(?<=\S)\*(?![\w*])|(?<![\w_])_[^_\s][^_\n]*?(?<=\S)_(?![\w_])/;
/** How much of a line the marks are looked for in: enough for any heading, rule or link, and no long line costs more. */
const MARK_CHARS = 1000;

/**
 * Whether plain text carries Markdown marks: a heading counts as two, and any other line holding a mark (`MARK_LINE`,
 * `MARK_INLINE`) as one; two make it Markdown. Lists, numbered lines, quoted lines and an underlined title are not counted:
 * plain text writes them too, and read as Markdown their lines would be joined. So a note with one `*`, a tide table or a
 * list of dated lines stays plain, and a `.txt` with a `# ` heading is its Markdown page.
 */
export function carriesMarkdown(text: string): boolean {
  let marked = 0;
  for (const whole of text.split(LINE_BREAK)) {
    const line = whole.length > MARK_CHARS ? whole.slice(0, MARK_CHARS) : whole;
    if (MARK_HEADING.test(line)) marked += 2;
    else if (MARK_LINE.test(line) || MARK_INLINE.test(line)) marked++;
    if (marked >= 2) return true;
  }
  return false;
}

/**
 * Prose whose lines may be joined: most lines that are not blank hold five words or more, and every break inside a
 * paragraph is a wrap, where the next line's first word would not have fitted on the line before it (the file's longest
 * line is the width it was wrapped to). Any other break was the writer's, and the file is set as written.
 */
function looksLikeProse(text: string): boolean {
  const lines = text.split(LINE_BREAK);
  const full = lines.filter((l) => l.trim() !== '');
  if (full.length === 0) return false;
  const wordy = full.filter((l) => (l.match(/\p{L}{2,}/gu)?.length ?? 0) >= 5).length;
  if (wordy / full.length < 0.6) return false;
  const width = full.reduce((most, l) => Math.max(most, l.trimEnd().length), 0);
  for (let i = 0; i + 1 < lines.length; i++) {
    const line = lines[i]!.trimEnd();
    const next = lines[i + 1]!;
    if (line.trim() === '' || next.trim() === '') continue;
    if (/^\s/.test(next)) return false;
    const word = /^\S+/.exec(next)![0].length;
    if (line.length + 1 + word <= width) return false;
  }
  return true;
}
