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

function blocks(nodes: readonly md.RootContent[], ctx: Ctx): Block[] {
  const out: Block[] = [];
  for (const node of nodes) {
    const converted = block(node, ctx);
    if (converted) out.push(converted);
  }
  return out;
}

function block(node: md.RootContent, ctx: Ctx): Block | undefined {
  const src = range(node, ctx);
  // TOML frontmatter is a node type mdast-util-frontmatter adds without a type declaration.
  if ((node.type as string) === 'toml') return { type: 'frontmatter', src, value: (node as md.Yaml).value };
  switch (node.type) {
    case 'paragraph':
      return { type: 'paragraph', src, children: inlines(node.children, ctx) };
    case 'heading':
      return { type: 'heading', src, level: node.depth as Heading['level'], children: inlines(node.children, ctx) };
    case 'blockquote':
      return { type: 'blockquote', src, children: blocks(node.children, ctx) };
    case 'thematicBreak':
      return { type: 'thematicBreak', src };
    case 'list':
      return list(node, src, ctx);
    case 'listItem':
      return listItem(node, src, ctx);
    case 'code':
      return codeBlock(node, src, ctx);
    case 'html':
      return { type: 'htmlBlock', src, value: node.value };
    case 'math':
      return { type: 'mathBlock', src, value: node.value };
    case 'yaml':
      return { type: 'frontmatter', src, value: node.value };
    case 'footnoteDefinition':
      return { type: 'footnoteDefinition', src, label: node.label ?? node.identifier, children: blocks(node.children, ctx) };
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
  const children = blocks(node.children, ctx);
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
    // A token no other handler takes, and one only a fence has; the code node is on top of the stack.
    codeFencedFenceSequence(this: CompileContext) {
      const node = this.stack[this.stack.length - 1];
      if (node?.type === 'code') fencedCode.add(node);
    },
    // No other handler takes a line ending on entry; mdast appends it to the code's buffer on exit.
    lineEnding(this: CompileContext, token) {
      const top = this.stack[this.stack.length - 1];
      const node = this.stack[this.stack.length - 2];
      if (top?.type !== 'fragment' || node?.type !== 'code') return;
      const tail = top.children[top.children.length - 1];
      const endings = codeEndings.get(node) ?? [];
      endings.push({ at: tail?.type === 'text' ? tail.value.length : 0, text: this.sliceSerialize(token) });
      codeEndings.set(node, endings);
    },
  },
};

/**
 * Where each line ending of a code block sits in the text mdast builds its value from, recorded by
 * `fencedCodeMarker`. mdast trims that text with `/^(\r?\n|\r)|(\r?\n|\r)$/`, meaning to drop the
 * opening fence's line ending and the last line's. A CR, a line of indentation alone (which leaves no
 * text) and an LF read as one CRLF there, so the trim takes a blank line with it (F-20.1).
 */
const codeEndings = new WeakMap<object, { at: number; text: string }[]>();

/**
 * The code block's value with one line ending trimmed at each end, as CommonMark has it, whatever
 * mdast's trim took. `value` is mdast's; the text it came from is rebuilt from it and the endings.
 */
function codeValue(node: md.Code, fenced: boolean): string {
  const endings = codeEndings.get(node);
  // Without a lone CR the trim cannot take two endings for one.
  if (!endings || !endings.some((ending) => ending.text === '\r')) return node.value;
  const charAt = (index: number): string => {
    const ending = endings.find((candidate) => index >= candidate.at && index < candidate.at + candidate.text.length);
    return ending ? ending.text[index - ending.at]! : '';
  };
  // What mdast's trim took from the front: only a fenced block's text starts with a line ending.
  const opens = fenced && endings[0]!.at === 0;
  const lead = !opens ? 0 : charAt(0) === '\r' && charAt(1) === '\n' ? 2 : 1;
  const last = endings[endings.length - 1]!;
  const length = Math.max(lead + node.value.length, last.at + last.text.length);
  let head = '';
  for (let index = 0; index < lead; index++) head += charAt(index);
  let tail = '';
  for (let index = lead + node.value.length; index < length; index++) tail += charAt(index);
  const start = opens ? endings[0]!.text.length : 0;
  const end = last.at + last.text.length === length ? last.at : length;
  return (head + node.value + tail).slice(start, Math.max(start, end));
}

function codeBlock(node: md.Code, src: Source, ctx: Ctx): Block {
  const [start, end] = utf16Range(node, ctx);
  const raw = ctx.text.slice(start, end);
  if (!ctx.marked) {
    throw new Error(`parse: ${ctx.file} was built without fencedCodeMarker, so its code blocks cannot tell a fence from indentation`);
  }
  const fenced = fencedCode.has(node);
  const value = codeValue(node, fenced);
  const base = {
    type: 'codeBlock' as const, src, value,
    content: contentRange(raw, value, fenced, start, end, ctx),
  };
  const info = fenced ? infoString(raw) : undefined;
  return {
    ...base,
    ...(node.lang ? { lang: node.lang } : {}),
    ...(info ? { info } : {}),
  };
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
function contentRange(raw: string, value: string, fenced: boolean, start: number, end: number, ctx: Ctx): Source {
  const openEnding = fenced ? nextLineEnding(raw, 0) : undefined;
  if (fenced && openEnding === undefined) return span(end, end, ctx); // An unterminated, empty fenced block.
  const offset = openEnding === undefined ? 0 : openEnding.end;
  if (value.length === 0) return span(start + offset, start + offset, ctx);
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

