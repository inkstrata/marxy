// The inspector's Outline tab: the focused document's headings, indented by level, each with the quiet count of the words
// in its section; the section under the reading line (Read) or the caret (Source) is marked; a row jumps there. A row also moves
// its whole section: up or down past its sibling (⌥↑ and ⌥↓), or a level shallower or deeper (Promote, Demote).
// Pure parts first (`outlineModelOf`, `applyOutlineAction`), then `mountOutlineTab`.
//
// A move is a rewrite of the buffer and is held to commitment 3: it changes the bytes of the two sections it trades and nothing
// outside them (`core/operations/move-section.ts`), as one splice and so one undo step; and before it is written the result is
// parsed, and if its blocks are not the blocks of the two sections in their new order (a last section with no blank line after
// it, run into a setext heading below it, would turn a paragraph into a heading) it is refused and the file is left as it was.
// Bytes that are not text in the range are refused too: the splice would write a replacement character over them.
//
// The words are the status bar's (`createWordCounter`), counted in one pass over the text. A section's words include its
// sub-sections', which is what moves with it. A table is listed under its section as "Table: its first header cells".
import { type Buffer, byteToUtf16, type Document, type Heading, parseMarkdown, sectionRange, type Node, type Table } from '@marxy/core';
import { headingsOf, OUTLINE_MAX, outlineOf } from '@marxy/core/src/outline/outline.ts';
import { demoteHeading, promoteHeading } from '@marxy/core/src/operations/heading-level.ts';
import { blockKeys, keysAfterSwap, moveSectionDown, moveSectionUp, sectionSwapOf, swapRange, type MoveDirection } from '@marxy/core/src/operations/move-section.ts';
import type { Operation } from '@marxy/core';
import { walk } from '@marxy/core/src/transforms/prose.ts';
import type { AppHandle } from '../../app.ts';
import type { DocumentStore } from '../../document/store.ts';
import { notify } from '../../notices/index.ts';
import { headingAt } from './outline-move.ts';
import { countsAsMarkdown, createWordCounter } from './facts.ts';
import { pushAll } from '@marxy/core/src/util/spread.ts';

// Both are in outline-move.ts, which the registry's commands read at start; the names stay exported from here.
export { canMoveSection, focusedOutlineHeading } from './outline-move.ts';

// ---- the model ---------------------------------------------------------------------------------------------------------

/** A heading of the document, with the words of its section and where it starts (the heading's own first byte). */
export interface HeadingRow {
  readonly kind: 'heading';
  readonly level: 1 | 2 | 3 | 4 | 5 | 6;
  /** How far in the row is drawn: the heading's level less the shallowest level in the document. */
  readonly depth: number;
  readonly text: string;
  readonly start: number;
  /** Where its section ends: the next heading of the same or a higher level, else the end of the file. */
  readonly end: number;
  readonly words: number;
}

/** A table, listed under the section that holds it. */
export interface TableRow {
  readonly kind: 'table';
  readonly depth: number;
  readonly label: string;
  readonly start: number;
}

/** A title that only front matter holds (and no h1 does): the top row, as the folded outline and the status bar's "where you are" name it. It is a name, not a section. */
export interface TitleRow {
  readonly kind: 'title';
  readonly depth: number;
  readonly text: string;
  readonly start: number;
}

export type OutlineRow = HeadingRow | TableRow | TitleRow;

export interface OutlineModel {
  readonly rows: readonly OutlineRow[];
  /** How many of the rows are headings. */
  readonly headings: number;
  /** More headings than OUTLINE_MAX: the rows are the first ones. */
  readonly capped: boolean;
}

const inlineText = (nodes: readonly Node[]): string =>
  nodes
    .map((n) => {
      if (n.type === 'text' || n.type === 'code' || n.type === 'mathInline') return (n as { value: string }).value;
      if (n.type === 'image') return (n as { alt: string }).alt;
      if (n.type === 'softBreak' || n.type === 'hardBreak') return ' ';
      if (n.type === 'html' || n.type === 'footnoteReference' || n.type === 'taskMarker') return '';
      return inlineText((n.children ?? []) as readonly Node[]);
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();

const MAX_HEADER_CELLS = 4;

/** "Table: Place, Count": the first header cells, as text. */
export function tableLabel(table: Table): string {
  const header = table.children[0];
  const cells = (header?.children ?? []).map((cell) => inlineText(cell.children) || '(empty)');
  if (cells.length === 0) return 'Table';
  const shown = cells.slice(0, MAX_HEADER_CELLS).join(', ');
  return `Table: ${shown}${cells.length > MAX_HEADER_CELLS ? ', …' : ''}`;
}

/**
 * The rows for a parse: every heading of the document in order, to the first OUTLINE_MAX (those in a quote or a list item too, as the folded outline lists
 * them; a title that only front matter holds is not a heading and is not listed), each with the words of its section, and each table
 * under the section it is in. Pure: no DOM, and the text is read once.
 */
export function outlineModelOf(ast: Document, buffer: Buffer): OutlineModel {
  const { headings: nodes, capped, firstLeftOut } = headingsOf(ast, OUTLINE_MAX);
  // Past the cap the tables stop where the headings do, so the rows end in one place.
  const stop = firstLeftOut ?? Number.POSITIVE_INFINITY;
  const tables: Table[] = [];
  walk(ast, (node: Node) => {
    if (node.type === 'table' && node.src.start < stop) tables.push(node as Table);
  });
  const { entries } = outlineOf(ast, OUTLINE_MAX);
  // `outlineOf` puts a front-matter title first when the document has no h1; it is a name, not a heading.
  const titled = entries.length === nodes.length + 1;
  const texts = titled ? entries.slice(1) : entries;
  // Where each section ends. The document's own headings (the long list in a large file) in one pass with a stack: a section ends at
  // the next heading of the same or a higher level, else the end of the file, which is `sectionRange`'s rule for them. The few
  // in a quote or a list item ask `sectionRange`, which bounds them by their container.
  const topEnd = new Map<Heading, number>();
  const open: Heading[] = [];
  for (const block of ast.children) {
    if (block.type !== 'heading') continue;
    while (open.length > 0 && open[open.length - 1]!.level >= block.level) topEnd.set(open.pop()!, block.src.start);
    open.push(block);
  }
  for (const h of open) topEnd.set(h, ast.src.end);
  const ends = nodes.map((h) => topEnd.get(h) ?? sectionRange(ast, h).end);

  // Words by byte offset: one pass over the text, the count read at every place a section begins or ends. Those places follow
  // white space (a heading's `#` run follows its indent, a quote or list marker and a space; a section ends at a line start), so
  // no word is cut and a section's count is the difference of two readings.
  const points = [...new Set([...nodes.map((h) => h.src.start), ...ends])].sort((a, b) => a - b);
  // The status bar's count, Markdown rules included: each reading is `count()`, which leaves the counter able to go on, so the
  // sections add up to the bar's total.
  const counter = createWordCounter({ markdown: countsAsMarkdown(buffer.path) });
  const reading = new Map<number, number>();
  let at = 0;
  for (const point of points) {
    const to = byteToUtf16(buffer, point);
    counter.feed(buffer.text.slice(at, to));
    at = to;
    reading.set(point, counter.count());
  }

  const shallowest = nodes.reduce<number>((least, h) => Math.min(least, h.level), 6);
  const headings: HeadingRow[] = nodes.map((h, i) => ({
    kind: 'heading',
    level: h.level,
    depth: h.level - shallowest,
    text: texts[i]?.text ?? '',
    start: h.src.start,
    end: ends[i]!,
    words: reading.get(ends[i]!)! - reading.get(h.src.start)!,
  }));

  const rows: OutlineRow[] = [];
  let h = 0;
  let under: HeadingRow | null = null;
  for (const table of tables) {
    while (h < headings.length && headings[h]!.start <= table.src.start) {
      rows.push(headings[h]!);
      under = headings[h]!;
      h++;
    }
    rows.push({ kind: 'table', depth: under === null ? 0 : under.depth + 1, label: tableLabel(table), start: table.src.start });
  }
  pushAll(rows, headings.slice(h));
  if (titled) rows.unshift({ kind: 'title', depth: 0, text: entries[0]!.text, start: entries[0]!.src.start });
  return { rows, headings: headings.length, capped };
}

const models = new WeakMap<Buffer, OutlineModel>();
/** `outlineModelOf` once per buffer (one per version of the document): a redraw for the same bytes is not a second walk. */
export function outlineModelFor(ast: Document, buffer: Buffer): OutlineModel {
  let model = models.get(buffer);
  if (model === undefined) {
    model = outlineModelOf(ast, buffer);
    models.set(buffer, model);
  }
  return model;
}

/** The index in `rows` of the heading whose section holds `byte`: the last heading that starts at or before it, else -1. */
export function currentRow(rows: readonly OutlineRow[], byte: number): number {
  let found = -1;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    if (row.kind !== 'table' && row.start <= byte) found = i;
  }
  return found;
}

// ---- the actions -------------------------------------------------------------------------------------------------------

export type OutlineAction = 'move-up' | 'move-down' | 'promote' | 'demote';

/** The whole notice (what happened · what is unchanged · what to do): a refusal that already says so is shown as it is. */
const SHAPE_REFUSAL = 'Not moved · the file is unchanged · moving it would change what is code or a heading here';
const NOT_TEXT = 'Not changed: this part of the file holds bytes that are not text, and Marxy leaves them exactly as they are';

const strict = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const encoder = new TextEncoder();

interface Plan {
  readonly op: Operation;
  readonly heading: Heading;
  readonly range: { readonly file: string; readonly start: number; readonly end: number };
  /** Moves only: where the second section begins. */
  readonly split: number | null;
}

/** What the action would be handed: its operation, the heading and the bytes it covers; or why there is nothing to do. */
function planOf(ast: Document, heading: Heading, action: OutlineAction): Plan | string {
  if (action === 'move-up' || action === 'move-down') {
    const direction: MoveDirection = action === 'move-up' ? 'up' : 'down';
    const swap = sectionSwapOf(ast, heading, direction);
    if (swap === null) {
      if (!ast.children.includes(heading)) return 'Not moved: this heading is inside a quote or a list item, and only the document\'s own sections move';
      return direction === 'up'
        ? 'Not moved: this is the first section at its level, and a section does not move out of the one that holds it'
        : 'Not moved: this is the last section at its level, and a section does not move out of the one that holds it';
    }
    return { op: direction === 'up' ? moveSectionUp : moveSectionDown, heading, range: swap.range, split: swap.split };
  }
  return { op: action === 'promote' ? promoteHeading : demoteHeading, heading, range: sectionRange(ast, heading), split: null };
}

export type ActionResult =
  | { readonly applied: true; /** Where the heading starts now. */ readonly start: number }
  | { readonly applied: false; readonly why: string };

/**
 * Runs `action` on the heading that starts at byte `start`, as one `apply` of `store` (one undo step). Nothing is written to a
 * file. Refused, with the document untouched and the reason in words, when there is nowhere to move, when the bytes are not text,
 * when the document changed since `start` was read, and when a move would change the blocks of the document (see the head of the file).
 */
export async function applyOutlineAction(
  store: DocumentStore,
  start: number,
  action: OutlineAction,
  /** Called with the place the heading will start, just before the write (so a view can look for it when the store tells it). */
  landing?: (start: number) => void,
): Promise<ActionResult> {
  const refuse = (why: string): ActionResult => ({ applied: false, why });
  const snap = store.snapshot();
  if (!store.parsed()) return refuse('The outline is listed for Markdown');
  const ast = snap.ast;
  const heading = headingAt(ast, start);
  if (heading === null) return refuse('Not changed: that heading is no longer there');
  const plan = planOf(ast, heading, action);
  if (typeof plan === 'string') return refuse(plan);
  const bytes = snap.buffer.bytes;
  let text: string;
  try {
    text = strict.decode(bytes.subarray(plan.range.start, plan.range.end));
  } catch {
    return refuse(NOT_TEXT);
  }
  const input = { document: ast, node: heading as Node, range: plan.range, text };
  if (!plan.op.canApply(input)) return refuse('Not changed');
  const result = plan.op.run(input);
  if (result.replacement === text) return refuse(result.summary ?? 'Not changed');
  let landed = heading.src.start;
  if (plan.split !== null) {
    const swapped = swapRange(text, plan.range.start, plan.split);
    // The heading's own first byte is `indent` bytes after its line starts.
    landed = action === 'move-up' ? plan.range.start + (heading.src.start - plan.split) : plan.range.start + swapped.firstAtByte + (heading.src.start - plan.range.start);
    // The write is checked before it is made: the blocks that come out are the blocks that went in, in their new order.
    const middle = encoder.encode(result.replacement);
    const candidate = new Uint8Array(bytes.length - (plan.range.end - plan.range.start) + middle.length);
    candidate.set(bytes.subarray(0, plan.range.start), 0);
    candidate.set(middle, plan.range.start);
    candidate.set(bytes.subarray(plan.range.end), plan.range.start + middle.length);
    const swap = { range: plan.range, split: plan.split };
    // Every top-level block of the result is a block of the document, byte for byte, in the new order (compared as text: the
    // keys hold the blocks' own bytes). A block that is not has changed what it is: a fence that now opens or closes elsewhere
    // turns code into headings and headings into code, a paragraph runs into a setext heading, a reference definition is drawn into one.
    const expected = keysAfterSwap(ast, bytes, swap);
    const made = parseMarkdown(candidate, { file: snap.path });
    const got = blockKeys(made, candidate);
    if (got.length !== expected.length || got.some((key, k) => key !== expected[k])) return refuse(SHAPE_REFUSAL);
  }
  landing?.(landed);
  let applied: boolean;
  try {
    applied = await store.apply({ range: plan.range, replacement: result.replacement, label: plan.op.title, baseVersion: snap.version });
  } catch (error) {
    return refuse(`Not changed: ${error instanceof Error ? error.message : String(error)}`);
  }
  return applied ? { applied: true, start: landed } : refuse('Not changed: the document changed while this was being worked out');
}

/** Runs `action` for the open document the way every route does: Source text typed and not yet folded goes in first, a refusal is said. */
export async function runOutlineAction(handle: AppHandle, store: DocumentStore, start: number, action: OutlineAction, landing?: (start: number) => void): Promise<ActionResult> {
  // Source text typed and not folded is part of the document (as for undo, `edits.ts`): it goes into the store first, for the pane that shows this one.
  if (handle.document() === store) await handle.foldSource();
  const result = await applyOutlineAction(store, start, action, landing);
  if (!result.applied) notify({ kind: 'refused', text: result.why.includes(' · ') ? result.why : `${result.why}. The document is unchanged.` });
  return result;
}
