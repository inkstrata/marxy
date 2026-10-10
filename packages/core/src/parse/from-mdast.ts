// Converts one mdast tree into the marxy AST, giving every node byte provenance (ADR-0003).
// mdast is the shape micromark hands us; the AST in ../contracts/ast.ts is what the rest of marxy
// reads. Nothing here re-scans or re-parses source text: positions come from mdast, offsets from
// the one byte-offset table built for the document.

import type {
  Block, Document, Inline, Source, Heading, List, ListItem, TableCell, TableRow,
} from '../contracts/ast.ts';
import type { ByteOffsets } from './byte-offsets.ts';
import { registerLineStarts } from '../sourcemap/line-starts.ts';
import { LINE_ENDING, LINE_ENDINGS, nextLineEnding, splitLines } from './line-endings.ts';
import type * as md from 'mdast';
import type { CompileContext, Extension as MdastExtension } from 'mdast-util-from-markdown';
import { decodeString } from 'micromark-util-decode-string';

export interface ConvertContext {
  /** Absolute path, or a stable identifier for an untitled buffer. */
  readonly file: string;
  /** The text handed to micromark: the file's UTF-8 decoding, minus a byte-order mark. */
  readonly text: string;
  readonly offsets: ByteOffsets;
}

interface Ctx extends ConvertContext {
  /** Link/image reference definitions, by normalised identifier. */
  readonly definitions: Map<string, md.Definition>;
  /** Whether the tree was built with `fencedCodeMarker`, without which no code block can be read. */
  readonly marked: boolean;
}

/**
 * Whether a document's parse held a link reference definition or a footnote definition: the
 * constructs whose effect reaches across the whole file (a reference anywhere resolves against them).
 * Recorded for the reparse (reparse.ts), since the AST keeps no node for a link reference definition.
 * `undefined` for a document this module did not build and nobody marked.
 */
const crossFile = new WeakMap<Document, boolean>();
export const holdsDefinitions = (document: Document): boolean | undefined => crossFile.get(document);
export const markDefinitions = (document: Document, holds: boolean): void => {
  crossFile.set(document, holds);
};

/**
 * The AST for an mdast tree. The tree must be built with `fencedCodeMarker` among its mdast
 * extensions (parse.ts always passes it): a tree that holds a code block but was built without it
 * is refused with an error.
 */
export function documentFromMdast(root: md.Root, context: ConvertContext): Document {
  const { definitions, footnotes } = collectDefinitions(root);
  const ctx: Ctx = { ...context, definitions, marked: markedTrees.has(root) };
  const document: Document = {
    type: 'document',
    src: { file: ctx.file, start: 0, end: ctx.offsets.byteLength },
    path: ctx.file,
    children: blocks(root.children, ctx),
  };
  registerLineStarts(document, () => lineStarts(ctx));
  crossFile.set(document, definitions.size > 0 || footnotes);
  return document;
}

/** Byte offset of the start of every line, for `sectionRange`; computed on first use. */
function lineStarts(ctx: Ctx): number[] {
  const starts = [ctx.offsets.at(0)];
  let cursor = 0;
  for (let ending = nextLineEnding(ctx.text, cursor); ending !== undefined; ending = nextLineEnding(ctx.text, cursor)) {
    cursor = ending.end;
    starts.push(ctx.offsets.at(cursor));
  }
  return starts;
}

/** The link reference definitions by identifier, and whether any footnote definition is there. */
function collectDefinitions(root: md.Root): { definitions: Map<string, md.Definition>; footnotes: boolean } {
  const found = new Map<string, md.Definition>();
  let footnotes = false;
  const walk = (node: md.Nodes): void => {
    if (node.type === 'definition' && !found.has(node.identifier)) found.set(node.identifier, node);
    if (node.type === 'footnoteDefinition') footnotes = true;
    if ('children' in node) for (const child of node.children) walk(child);
  };
  walk(root);
  return { definitions: found, footnotes };
}

// --- source ranges -----------------------------------------------------------------------------

/** The part of unist's `Position` this module uses; mdast's own type comes from a package we do not depend on. */
interface Positioned {
  position?: { start: { offset?: number | undefined }; end: { offset?: number | undefined } } | undefined;
}

/**
 * A node arrived without the offsets the AST is built on. This is never recoverable here: any range
 * we invented would be a guess that later resolves a selection to bytes the reader did not point at,
 * and defaulting to zero would point every such node at the top of the file. The parser refuses the
 * document instead, loudly, so the cause gets fixed where it happens (see `parse.ts`, which removes
 * the one mdast extension known to drop positions).
 */
export class ParseProvenanceError extends Error {
  readonly nodeType: string;
  readonly file: string;

  constructor(nodeType: string, file: string) {
    super(`parse: a ${nodeType} node in ${file} has no source position, so it can carry no byte provenance (ADR-0003)`);
    this.name = 'ParseProvenanceError';
    this.nodeType = nodeType;
    this.file = file;
  }
}

function offsets(node: Positioned, type: string, ctx: Ctx): [number, number] {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (start === undefined || end === undefined) throw new ParseProvenanceError(type, ctx.file);
  return [start, end];
}

function range(node: Positioned & { type: string }, ctx: Ctx): Source {
  const [start, end] = offsets(node, node.type, ctx);
  return { file: ctx.file, start: ctx.offsets.at(start), end: ctx.offsets.at(end) };
}

function span(startUtf16: number, endUtf16: number, ctx: Ctx): Source {
  return { file: ctx.file, start: ctx.offsets.at(startUtf16), end: ctx.offsets.at(endUtf16) };
}

function utf16Range(node: Positioned & { type: string }, ctx: Ctx): [number, number] {
  return offsets(node, node.type, ctx);
}

// --- blocks ------------------------------------------------------------------------------------

/**
 * What holds a run of blocks, as far as code cares: a list item eats the whole of a blank line, so a
 * line of spaces alone in its code is an empty line (CommonMark's list-item continuation), while the
 * document and a block quote leave a blank line's indentation to the code (F-20.2).
 */
type Container = 'root' | 'item' | 'other';

function blocks(nodes: readonly md.RootContent[], ctx: Ctx, container: Container = 'root'): Block[] {
  const out: Block[] = [];
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index]!;
    // micromark ends indented code at a blank line when the code follows a block quote's last line
    // (`>`, then `    x`, a blank line, `    y`), though a blank line never ends indented code: the
    // run is one block, as CommonMark reads it (F-20.2).
    let last = index;
    while (container !== 'other' && isIndentedCode(nodes[last]) && isIndentedCode(nodes[last + 1])
      && blankBetween(nodes[last]!, nodes[last + 1]!, ctx) !== undefined) last++;
    const converted = last > index
      ? mergedCode(nodes.slice(index, last + 1) as md.Code[], ctx, container)
      : block(node, ctx, container);
    index = last;
    if (converted) out.push(converted);
  }
  return out;
}

const isIndentedCode = (node: md.RootContent | undefined): node is md.Code =>
  node?.type === 'code' && !fencedCode.has(node);

/**
 * The lines between two blocks when only blank lines are there: their text and the line endings that
 * end the first block's line and each of them. The text after the last ending is the next block's
 * indentation, not a line.
 */
function blankBetween(before: md.RootContent, after: md.RootContent, ctx: Ctx): CodeLines | undefined {
  const between = ctx.text.slice(utf16Range(before, ctx)[1], utf16Range(after, ctx)[0]);
  if (!/^(?:\r\n|\r|\n)[ \t\r\n]*$/.test(between)) return undefined;
  const lines: string[] = [];
  const endings: string[] = [];
  for (let at = 0, ending = nextLineEnding(between, 0); ending !== undefined; ending = nextLineEnding(between, at)) {
    if (at > 0) lines.push(between.slice(at, ending.start));
    endings.push(between.slice(ending.start, ending.end));
    at = ending.end;
  }
  return { lines, endings };
}

function block(node: md.RootContent, ctx: Ctx, container: Container): Block | undefined {
  const src = range(node, ctx);
  // TOML frontmatter is a node type mdast-util-frontmatter adds without a type declaration.
  if ((node.type as string) === 'toml') return { type: 'frontmatter', src, value: (node as md.Yaml).value };
  switch (node.type) {
    case 'paragraph':
      return { type: 'paragraph', src, children: inlines(node.children, ctx) };
    case 'heading':
      return { type: 'heading', src, level: node.depth as Heading['level'], children: inlines(node.children, ctx) };
    case 'blockquote':
      return { type: 'blockquote', src, children: blocks(node.children, ctx, 'other') };
    case 'thematicBreak':
      return { type: 'thematicBreak', src };
    case 'list':
      return list(node, src, ctx);
    case 'listItem':
      return listItem(node, src, ctx);
    case 'code':
      return codeBlock(node, src, ctx, container);
    case 'html':
      return { type: 'htmlBlock', src, value: node.value };
    case 'math':
      return { type: 'mathBlock', src, value: node.value };
    case 'yaml':
      return { type: 'frontmatter', src, value: node.value };
    case 'footnoteDefinition':
      return { type: 'footnoteDefinition', src, label: node.label ?? node.identifier, children: blocks(node.children, ctx, 'other') };
    case 'table':
      return {
        type: 'table', src,
        align: (node.align ?? []).map((a) => a ?? null),
        children: node.children.map((row, index) => tableRow(row, index === 0, ctx)),
      };
    case 'definition':
      // The AST has no node for a link reference definition: it renders nothing and the links that
      // use it carry the resolved url. Its bytes stay in the buffer, unclaimed by any node.
      return undefined;
    default:
      return undefined;
  }
}

function list(node: md.List, src: Source, ctx: Ctx): List {
  const loose = node.spread === true || node.children.some((item) => item.spread === true);
  const children = node.children.map((item, index) => {
    const own = range(item, ctx);
    // An item whose last line opens a fence that never closes reports an end past the next item's
    // start (`* ```js` then `* x`); siblings may not overlap (AST_INVARIANTS), so it stops there.
    const nextItem = node.children[index + 1];
    const nextStart = nextItem === undefined ? undefined : range(nextItem, ctx).start;
    const end = nextStart !== undefined && own.end > nextStart ? Math.max(own.start, nextStart) : own.end;
    return listItem(item, end === own.end ? own : { ...own, end }, ctx);
  });
  const base = { type: 'list' as const, src, ordered: node.ordered === true, tight: !loose, children };
  return node.start === null || node.start === undefined ? base : { ...base, start: node.start };
}

function listItem(node: md.ListItem, src: Source, ctx: Ctx): ListItem {
  const children = blocks(node.children, ctx, 'item');
  if (node.checked === null || node.checked === undefined) return { type: 'listItem', src, children };
  const task = node.checked ? 'checked' as const : 'unchecked' as const;
  const withMarker = attachTaskMarker(children, node, ctx);
  return { type: 'listItem', src, task, children: withMarker };
}

/**
 * GFM strips `[x] ` from the item's first paragraph, so the marker's bytes belong to no node. The
 * contract makes the marker an inline node of its own so toggling it is a splice of exactly those
 * bytes, so it joins the first paragraph — and that paragraph's range widens to contain it.
 */
function attachTaskMarker(children: Block[], node: md.ListItem, ctx: Ctx): Block[] {
  const first = children[0];
  if (!first || first.type !== 'paragraph') return children;
  const [itemStart, itemEnd] = utf16Range(node, ctx);
  const itemText = ctx.text.slice(itemStart, itemEnd);
  const lineBreak = itemText.search(/\r\n|\n|\r/);
  const head = lineBreak === -1 ? itemText : itemText.slice(0, lineBreak);
  const match = head.match(/\[[ \txX]\]/);
  if (!match || match.index === undefined) return children;
  const markerStart = itemStart + match.index;
  const markerEnd = markerStart + match[0].length;
  const marker: Inline = {
    type: 'taskMarker',
    src: span(markerStart, markerEnd, ctx),
    checked: node.checked === true,
  };
  const widened: Block = {
    ...first,
    src: { ...first.src, start: marker.src.start },
    children: [marker, ...first.children],
  };
  return [widened, ...children.slice(1)];
}

/**
 * The code nodes micromark opened with a fence. mdast gives a fenced and an indented block the same
 * shape, and the source cannot always tell them apart: after `>` and a tab, micromark starts the
 * block's range past the tab, whose leftover columns still count as indentation, so `>\t   ```` is
 * an indented block whose range reads `   ````. The parser knows which it opened, so it says.
 */
const fencedCode = new WeakSet<object>();

/** The trees built with `fencedCodeMarker`, so `documentFromMdast` can refuse one built without it. */
const markedTrees = new WeakSet<object>();

/**
 * The mdast extension that records `fencedCode`; parse.ts passes it with every parse, and
 * `documentFromMdast` throws on a tree that holds code but was built without it, because every
 * fence would otherwise silently become indented code.
 */
export const fencedCodeMarker: MdastExtension = {
  transforms: [(tree) => { markedTrees.add(tree); }],
  enter: {
    // A token no other handler takes, and one only a fence has. At the opening fence the code node is
    // on top of the stack; at the closing one, the buffer its value is read into is, above it.
    codeFencedFenceSequence(this: CompileContext) {
      const top = this.stack[this.stack.length - 1];
      const node = top?.type === 'fragment' ? this.stack[this.stack.length - 2] : top;
      if (node?.type !== 'code') return;
      fencedCode.add(node);
      fences.set(node, (fences.get(node) ?? 0) + 1);
    },
    // No other handler takes a line ending on entry; mdast appends it to the code's buffer on exit.
    lineEnding(this: CompileContext, token) {
      const top = this.stack[this.stack.length - 1];
      const node = this.stack[this.stack.length - 2];
      if (top?.type !== 'fragment' || node?.type !== 'code') return;
      const tail = top.children[top.children.length - 1];
      const endings = codeEndings.get(node) ?? [];
      const text = this.sliceSerialize(token);
      // The token's own end can reach over the next line's indentation; the ending is its first characters.
      endings.push({ at: tail?.type === 'text' ? tail.value.length : 0, text, end: token.start.offset + text.length });
      codeEndings.set(node, endings);
    },
  },
};

/** How many fences each fenced code node has: two when it is closed, one when its container or the file ends it. */
const fences = new WeakMap<object, number>();

/**
 * Where each line ending of a code block sits in the text mdast builds its value from (`at`), and
 * where it ends in the document's text (`end`), recorded by `fencedCodeMarker`. That text is every
 * line's code with the line endings between, the opening fence's ending first; mdast trims it with
 * `/^(\r?\n|\r)|(\r?\n|\r)$/`, meaning to drop the opening fence's ending and the last line's.
 */
const codeEndings = new WeakMap<object, { at: number; text: string; end: number }[]>();

/** A code block's value and how many lines it has, since an empty value can be no line or one empty line. */
interface CodeText { readonly value: string; readonly lines: number }

/** A code block's lines, and the line endings between them (one fewer). */
interface CodeLines { readonly lines: string[]; readonly endings: string[] }

/**
 * The lines of a code node as micromark read them, before CommonMark's rules for the first and last
 * are applied: the text mdast trimmed is rebuilt from its value and the recorded endings, then cut at
 * those endings. Undefined when no ending was recorded (one line, or an mdast whose buffer this module
 * cannot read).
 *
 * The value cannot simply be split: a CR, a line of indentation alone (which leaves no text) and an
 * LF read as one CRLF there, so the trim takes a blank line with it (F-20.1), and the line count is lost.
 */
function readCodeLines(node: md.Code): CodeLines | undefined {
  const recorded = codeEndings.get(node);
  if (!recorded || recorded.length === 0) return undefined;
  const charAt = (index: number): string => {
    const ending = recorded.find((candidate) => index >= candidate.at && index < candidate.at + candidate.text.length);
    return ending ? ending.text[index - ending.at]! : '';
  };
  // What mdast's trim took from the front: an ending there, CR and LF together if both are there.
  const lead = recorded[0]!.at !== 0 ? 0 : charAt(0) === '\r' && charAt(1) === '\n' ? 2 : 1;
  const last = recorded[recorded.length - 1]!;
  // The trim takes from the back only when the text ends in an ending, which then reaches past the value.
  const length = Math.max(lead + node.value.length, last.at + last.text.length);
  let text = '';
  for (let index = 0; index < lead; index++) text += charAt(index);
  text += node.value;
  for (let index = text.length; index < length; index++) text += charAt(index);
  const lines: string[] = [];
  let at = 0;
  for (const ending of recorded) {
    lines.push(text.slice(at, ending.at));
    at = ending.at + ending.text.length;
  }
  lines.push(text.slice(at));
  return { lines, endings: recorded.map((ending) => ending.text) };
}

const isBlank = (line: string): boolean => /^[ \t]*$/.test(line);

/**
 * The value CommonMark gives a code block from its lines, joined by the document's own endings. A
 * blank line in a list item is empty, since the item's continuation takes all of its whitespace
 * (`- ```` then `    ` keeps no spaces); indented code drops its trailing blank lines, endings and
 * all, which micromark's range holds (`    a` then ` ` gives `a`, not `a\n`) (F-20.2).
 */
function joinCode({ lines, endings }: CodeLines, indented: boolean, container: Container): CodeText {
  const kept = container === 'item' ? lines.map((line) => (isBlank(line) ? '' : line)) : [...lines];
  let count = kept.length;
  if (indented) while (count > 1 && isBlank(kept[count - 1]!)) count--;
  let value = kept[0] ?? '';
  for (let index = 1; index < count; index++) value += endings[index - 1]! + kept[index]!;
  return { value, lines: count };
}

/**
 * A code block's value: its lines between the fences, or all of an indented block's lines. A fence's
 * text holds the opening fence's ending first, which is dropped with the empty line before it, and a
 * closed block's last ending, after which nothing is left. A block its container or the file ends
 * keeps its last line, empty or not, unless its range stops just past that line's ending (F-20.2:
 * `- ~~~` then four lines of spaces alone has five lines; mdast's trim took the last one).
 */
function codeValue(node: md.Code, fenced: boolean, container: Container, end: number): CodeText {
  const read = readCodeLines(node);
  if (read === undefined) {
    const value = container === 'item' && isBlank(node.value) ? '' : node.value;
    return { value, lines: !fenced || value !== '' ? 1 : 0 };
  }
  const { lines, endings } = read;
  if (fenced) {
    lines.shift();
    endings.shift();
    const last = codeEndings.get(node)!.at(-1)!;
    if ((fences.get(node) ?? 0) > 1 || last.end === end) {
      lines.pop();
      endings.pop();
    }
  }
  return joinCode({ lines, endings }, !fenced, container);
}

function codeBlock(node: md.Code, src: Source, ctx: Ctx, container: Container): Block {
  const [start, end] = utf16Range(node, ctx);
  const raw = ctx.text.slice(start, end);
  if (!ctx.marked) {
    throw new Error(`parse: ${ctx.file} was built without fencedCodeMarker, so its code blocks cannot tell a fence from indentation`);
  }
  const fenced = fencedCode.has(node);
  const code = codeValue(node, fenced, container, end);
  const base = {
    type: 'codeBlock' as const, src, value: code.value,
    content: contentRange(raw, code, fenced, start, end, ctx),
  };
  const info = fenced ? infoString(raw) : undefined;
  return {
    ...base,
    ...(node.lang ? { lang: node.lang } : {}),
    ...(info ? { info } : {}),
  };
}

/**
 * Indented code blocks micromark split at a blank line, as one block: the lines of each, with the
 * blank lines between, an indented block's four columns of indentation taken from each (F-20.2).
 */
function mergedCode(nodes: readonly md.Code[], ctx: Ctx, container: Container): Block {
  if (!ctx.marked) {
    throw new Error(`parse: ${ctx.file} was built without fencedCodeMarker, so its code blocks cannot tell a fence from indentation`);
  }
  const lines: string[] = [];
  const endings: string[] = [];
  nodes.forEach((node, index) => {
    if (index > 0) {
      const between = blankBetween(nodes[index - 1]!, node, ctx)!;
      endings.push(between.endings[0]!);
      between.lines.forEach((line, at) => {
        lines.push(line.slice(indentEnd(line, 4)));
        endings.push(between.endings[at + 1]!);
      });
    }
    const read = readCodeLines(node) ?? { lines: [node.value], endings: [] };
    lines.push(...read.lines);
    endings.push(...read.endings);
  });
  const start = utf16Range(nodes[0]!, ctx)[0];
  const end = utf16Range(nodes[nodes.length - 1]!, ctx)[1];
  const code = joinCode({ lines, endings }, true, container);
  return {
    type: 'codeBlock', src: span(start, end, ctx), value: code.value,
    content: contentRange(ctx.text.slice(start, end), code, false, start, end, ctx),
  };
}

/** Where `columns` columns of a line's leading spaces and tabs end, a tab reaching the next stop of four. */
function indentEnd(line: string, columns: number): number {
  let column = 0;
  let index = 0;
  while (index < line.length && column < columns && (line[index] === ' ' || line[index] === '\t')) {
    column = line[index] === '\t' ? column + 4 - (column % 4) : column + 1;
    index++;
  }
  return column < columns ? line.length : index;
}

// Up to three *spaces* of indentation, per CommonMark: a leading tab is four columns. Used only on a
// block micromark says is fenced, to find where its fence ends.
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;

/**
 * The bytes of a code block's content: everything but its fence lines (AST_INVARIANTS). The number of
 * lines comes from the value micromark produced rather than from guessing where the closing fence is,
 * because a fence may be indented by its container and an indented code block's source may trail
 * blank lines its value does not keep.
 */
function contentRange(raw: string, { value, lines }: CodeText, fenced: boolean, start: number, end: number, ctx: Ctx): Source {
  const openEnding = fenced ? nextLineEnding(raw, 0) : undefined;
  if (fenced && openEnding === undefined) return span(end, end, ctx); // An unterminated, empty fenced block.
  const offset = openEnding === undefined ? 0 : openEnding.end;
  // An empty value is no line at all (```` ``` ```` twice) or one empty line (with a blank line between).
  if (lines === 0) return span(start + offset, start + offset, ctx);
  let cursor = offset;
  // value keeps the document's own endings (CR, CRLF or LF), one for each of the source's, so the two
  // are walked side by side. Counting on a bare LF would collapse a multi-line Classic Mac block to a
  // single line, and splitting the value on its own would read a CR, then a line of indentation
  // alone, then an LF as one CRLF (F-20.1).
  for (let index = 0; ; ) {
    const ending = nextLineEnding(raw, cursor);
    if (ending === undefined) return span(start + offset, end, ctx);
    cursor = ending.end;
    const next = nextLineEnding(value, index);
    if (next === undefined) break;
    index = next.start + ending.end - ending.start;
  }
  return span(start + offset, start + cursor, ctx);
}

/** The raw info string of a fenced block: what follows the fence on the opening line. */
function infoString(raw: string): string | undefined {
  const fence = FENCE_OPEN.exec(raw);
  if (!fence) return undefined;
  const ending = nextLineEnding(raw, 0);
  const firstLine = raw.slice(fence[0].length, ending === undefined ? raw.length : ending.start);
  const info = firstLine.trim();
  return info.length > 0 ? info : undefined;
}

function tableRow(node: md.TableRow, header: boolean, ctx: Ctx): TableRow {
  return {
    type: 'tableRow', src: range(node, ctx), header,
    children: node.children.map((cell) => tableCell(cell, ctx)),
  };
}

function tableCell(node: md.TableCell, ctx: Ctx): TableCell {
  return { type: 'tableCell', src: range(node, ctx), children: inlines(node.children, ctx) };
}

// --- inlines -----------------------------------------------------------------------------------

function inlines(nodes: readonly md.PhrasingContent[], ctx: Ctx): Inline[] {
  const out: Inline[] = [];
  for (const node of nodes) out.push(...inline(node, ctx));
  return out;
}

function inline(node: md.PhrasingContent, ctx: Ctx): Inline[] {
  const src = range(node, ctx);
  switch (node.type) {
    case 'text':
      return textAndSoftBreaks(node, ctx);
    case 'emphasis':
      return [{ type: 'emphasis', src, children: inlines(node.children, ctx) }];
    case 'strong':
      return [{ type: 'strong', src, children: inlines(node.children, ctx) }];
    case 'delete':
      return [{ type: 'strikethrough', src, children: inlines(node.children, ctx) }];
    case 'inlineCode':
      return [{ type: 'code', src, value: node.value }];
    case 'inlineMath':
      return [{ type: 'mathInline', src, value: node.value }];
    case 'link':
      return [{ type: 'link', src, url: node.url, ...(node.title ? { title: node.title } : {}), children: inlines(node.children, ctx) }];
    case 'image':
      return [{ type: 'image', src, url: node.url, alt: node.alt ?? '', ...(node.title ? { title: node.title } : {}) }];
    case 'linkReference': {
      const definition = ctx.definitions.get(node.identifier);
      if (!definition) return [rawText(node, ctx)];
      return [{
        type: 'link', src, url: definition.url,
        ...(definition.title ? { title: definition.title } : {}),
        children: inlines(node.children, ctx),
      }];
    }
    case 'imageReference': {
      const definition = ctx.definitions.get(node.identifier);
      if (!definition) return [rawText(node, ctx)];
      return [{
        type: 'image', src, url: definition.url, alt: node.alt ?? '',
        ...(definition.title ? { title: definition.title } : {}),
      }];
    }
    case 'html':
      return [{ type: 'html', src, value: node.value }];
    case 'break':
      return [{ type: 'hardBreak', src }];
    case 'footnoteReference':
      return [{ type: 'footnoteReference', src, label: node.label ?? node.identifier }];
    default:
      return [rawText(node, ctx)];
  }
}

/** A construct the AST has no node for, kept as the source text it was written as. */
function rawText(node: md.PhrasingContent, ctx: Ctx): Inline {
  const [start, end] = utf16Range(node, ctx);
  return { type: 'text', src: span(start, end, ctx), value: ctx.text.slice(start, end) };
}

/**
 * Where the next line's own text begins: past the container's continuation markers (`> `, list
 * indentation) but not past a `>` that is text. The text of the line is known — it is the next
 * value of the node — so the prefix is the shortest run of spaces, tabs and `>` after which the rest
 * of the line decodes to that value. Without a usable value, every leading space, tab and `>` counts.
 *
 * The line's trailing spaces and tabs are part of its value when the node ends on that line (a link
 * or an HTML tag follows them), and not when a line ending does, so both readings are tried.
 */
function containerPrefixEnd(raw: string, from: number, value: string | undefined): number {
  let limit = from;
  while (limit < raw.length && (raw[limit] === ' ' || raw[limit] === '\t' || raw[limit] === '>')) limit++;
  if (value === undefined || value.length === 0) return limit;
  const lineEnd = nextLineEnding(raw, from)?.start ?? raw.length;
  let textEnd = lineEnd;
  while (textEnd > from && (raw[textEnd - 1] === ' ' || raw[textEnd - 1] === '\t')) textEnd--;
  for (let candidate = from; candidate <= limit && candidate < lineEnd; candidate++) {
    if (decodesTo(raw.slice(candidate, lineEnd), value)) return candidate;
    if (candidate < textEnd && decodesTo(raw.slice(candidate, textEnd), value)) return candidate;
  }
  return limit;
}

/**
 * Whether source text is the markdown for `value`: as written, with its escapes and character
 * references decoded, and with a NUL read as the replacement character CommonMark makes of it.
 * The same reading as the text-decoding invariant (invariants.ts).
 */
function decodesTo(source: string, value: string): boolean {
  if (source === value) return true;
  const sanitised = source.includes('\u0000') ? source.replace(/\u0000/g, '\ufffd') : source;
  return sanitised === value || decodeString(sanitised) === value;
}

/**
 * How many leading spaces, tabs and line endings of a text node's source its value does not hold.
 * GFM's task-list handling drops the first character of an item's first text (the space after
 * `[x]`) and moves the node's start one code unit on. When the marker ends its line, that character
 * was the line ending, so the start lands on the next line's indentation (or between CR and LF),
 * which the value never had: `1. [x] \r -` would give the text ` -` for the value `-`. Inside a block
 * quote that next line also opens with the quote's `>`, which is skipped the same way. Paragraph text
 * never starts with whitespace micromark kept, so only a run the value lacks is skipped.
 */
function unheldLead(text: string, start: number, end: number, value: string): number {
  const raw = text.slice(start, end);
  const run = (line: string): number => {
    let index = 0;
    while (index < line.length && (line[index] === ' ' || line[index] === '\t' || line[index] === '\r' || line[index] === '\n')) index++;
    return index;
  };
  const rawRun = run(raw);
  const valueRun = run(value);
  const skip = rawRun <= valueRun || !raw.slice(0, rawRun).endsWith(value.slice(0, valueRun)) ? 0 : rawRun - valueRun;
  // When the start now sits just past a line ending (GFM dropped it, or the run above crossed it), the
  // line may open with its container's prefix (`> - [ ]\n>   task two`): skip that too, as a soft
  // break does, but not a `>` that is text. The prefix ends where the line decodes to the value's.
  const before = text[start + skip - 1];
  if (valueRun > 0 || (before !== '\n' && before !== '\r')) return skip;
  return containerPrefixEnd(raw, skip, splitLines(value)[0]);
}

/**
 * The value a stretch of text holds: mdast's, except where micromark miscounts what is left of an
 * emphasis run. When a run that opens emphasis ends at a NUL (`**\0*`), the leftover's end moves back
 * from the start of the NUL's chunk to a negative index, and micromark serialises the whole run: the
 * one `*` left at [0,1) carries `**`. Only the end of the value can be too long, by marker characters
 * alone, so those are trimmed until the bytes decode to the value. The render of `**\0*` then matches
 * the one of `**a*` (`*` and an emphasis), as CommonMark reads it.
 */
function heldValue(source: string, value: string): string {
  if (decodesTo(source, value)) return value;
  let trimmed = value;
  while (trimmed.length > 0 && (trimmed.endsWith('*') || trimmed.endsWith('_'))) {
    trimmed = trimmed.slice(0, -1);
    if (decodesTo(source, trimmed)) return trimmed;
  }
  return value;
}

/**
 * mdast keeps a soft line break inside a text node's value; the AST gives it a node, because a line
 * break is a typesetting decision and because the bytes between two lines can carry block markers
 * (`> `, list indentation) that belong to neither line's text.
 */
function textAndSoftBreaks(node: md.Text, ctx: Ctx): Inline[] {
  const [mdastStart, end] = utf16Range(node, ctx);
  const start = mdastStart + unheldLead(ctx.text, mdastStart, end, node.value);
  const raw = ctx.text.slice(start, end);
  if (!LINE_ENDING.test(raw)) {
    return [{ type: 'text', src: span(start, end, ctx), value: heldValue(raw, node.value) }];
  }
  // All three CommonMark line endings split a line: a file written with CR alone gets soft-break nodes
  // like any other, rather than carrying a CR inside a text node's value.
  // The value's lines line up with the source's unless a character reference (`&#10;`) decoded to a
  // line ending that is not one in the source. Then each source line is decoded on its own, rather
  // than handing one line the next line's value and dropping the last.
  const values = node.value.split(LINE_ENDINGS);
  const aligned = values.length === raw.split(LINE_ENDINGS).length;
  const valueOf = (line: number, from: number, to: number): string =>
    aligned ? (values[line] ?? '') : decodeString(raw.slice(from, to));
  const out: Inline[] = [];
  let cursor = 0; // index into `raw`
  for (let line = 0; ; line++) {
    const ending = nextLineEnding(raw, cursor);
    if (ending === undefined) {
      const value = valueOf(line, cursor, raw.length);
      if (raw.length > cursor && value.length > 0) {
        out.push({ type: 'text', src: span(start + cursor, start + raw.length, ctx), value: heldValue(raw.slice(cursor), value) });
      }
      break;
    }
    let textEnd = ending.start;
    while (textEnd > cursor && (raw[textEnd - 1] === ' ' || raw[textEnd - 1] === '\t')) textEnd--;
    const value = valueOf(line, cursor, textEnd);
    if (textEnd > cursor && value.length > 0) {
      out.push({ type: 'text', src: span(start + cursor, start + textEnd, ctx), value: heldValue(raw.slice(cursor, textEnd), value) });
    }
    // The break owns the line ending and whatever block markers continue the container.
    const next = containerPrefixEnd(raw, ending.end, aligned ? values[line + 1] : undefined);
    out.push({ type: 'softBreak', src: span(start + textEnd, start + next, ctx) });
    cursor = next;
  }
  return out;
}

