// Converts one mdast tree into the frozen marxy AST, giving every node byte provenance (ADR-0003).
// mdast is the shape micromark hands us; the AST in ../contracts/ast.ts is what the rest of marxy
// reads. Nothing here re-scans or re-parses source text: positions come from mdast, offsets from
// the one byte-offset table built for the document.

import type {
  Block, Document, Inline, Source, Heading, List, ListItem, TableCell, TableRow,
} from '../contracts/ast.ts';
import type { ByteOffsets } from './byte-offsets.ts';
import { LINE_ENDING, LINE_ENDINGS, nextLineEnding, splitLines } from './line-endings.ts';
import type * as md from 'mdast';
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
}

export function documentFromMdast(root: md.Root, context: ConvertContext): Document {
  const ctx: Ctx = { ...context, definitions: collectDefinitions(root) };
  return {
    type: 'document',
    src: { file: ctx.file, start: 0, end: ctx.offsets.byteLength },
    path: ctx.file,
    children: blocks(root.children, ctx),
  };
}

function collectDefinitions(root: md.Root): Map<string, md.Definition> {
  const found = new Map<string, md.Definition>();
  const walk = (node: md.Nodes): void => {
    if (node.type === 'definition' && !found.has(node.identifier)) found.set(node.identifier, node);
    if ('children' in node) for (const child of node.children) walk(child);
  };
  walk(root);
  return found;
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
  const children = node.children.map((item) => listItem(item, range(item, ctx), ctx));
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
  const [itemStart] = utf16Range(node, ctx);
  const paragraphStartUtf16 = node.children[0]?.position?.start.offset ?? itemStart;
  const prefix = ctx.text.slice(itemStart, paragraphStartUtf16);
  const markerIndex = prefix.search(/\[[ \txX]\]/);
  if (markerIndex < 0) return children;
  const markerStart = itemStart + markerIndex;
  const marker: Inline = {
    type: 'taskMarker',
    src: span(markerStart, markerStart + 3, ctx),
    checked: node.checked === true,
  };
  const widened: Block = {
    ...first,
    src: { ...first.src, start: marker.src.start },
    children: [marker, ...first.children],
  };
  return [widened, ...children.slice(1)];
}

function codeBlock(node: md.Code, src: Source, ctx: Ctx): Block {
  const [start, end] = utf16Range(node, ctx);
  const raw = ctx.text.slice(start, end);
  const base = {
    type: 'codeBlock' as const, src, value: node.value,
    content: contentRange(raw, node.value, start, end, ctx),
  };
  const info = infoString(raw);
  return {
    ...base,
    ...(node.lang ? { lang: node.lang } : {}),
    ...(info ? { info } : {}),
  };
}

// Up to three *spaces* of indentation, per CommonMark: a leading tab is four columns, so a line that
// starts with one opens an indented code block whose content may well look like a fence.
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;

/**
 * The bytes of a code block's content: everything but its fence lines (AST_INVARIANTS). The number of
 * lines comes from the value micromark produced rather than from guessing where the closing fence is,
 * because a fence may be indented by its container and an indented code block's source may trail
 * blank lines its value does not keep.
 */
function contentRange(raw: string, value: string, start: number, end: number, ctx: Ctx): Source {
  const fenced = FENCE_OPEN.test(raw);
  const openEnding = fenced ? nextLineEnding(raw, 0) : undefined;
  if (fenced && openEnding === undefined) return span(end, end, ctx); // An unterminated, empty fenced block.
  const offset = openEnding === undefined ? 0 : openEnding.end;
  if (value.length === 0) return span(start + offset, start + offset, ctx);
  let cursor = offset;
  // value keeps the document's own endings (CR, CRLF or LF); counting on a bare LF would
  // collapse a multi-line Classic Mac block to a single line.
  for (let line = splitLines(value).length; line > 0; line--) {
    const ending = nextLineEnding(raw, cursor);
    if (ending === undefined) return span(start + offset, end, ctx);
    cursor = ending.end;
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
 * mdast keeps a soft line break inside a text node's value; the AST gives it a node, because a line
 * break is a typesetting decision and because the bytes between two lines can carry block markers
 * (`> `, list indentation) that belong to neither line's text.
 */
function textAndSoftBreaks(node: md.Text, ctx: Ctx): Inline[] {
  const [start, end] = utf16Range(node, ctx);
  const raw = ctx.text.slice(start, end);
  if (!LINE_ENDING.test(raw)) {
    return [{ type: 'text', src: span(start, end, ctx), value: node.value }];
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
        out.push({ type: 'text', src: span(start + cursor, start + raw.length, ctx), value });
      }
      break;
    }
    let textEnd = ending.start;
    while (textEnd > cursor && (raw[textEnd - 1] === ' ' || raw[textEnd - 1] === '\t')) textEnd--;
    const value = valueOf(line, cursor, textEnd);
    if (textEnd > cursor && value.length > 0) {
      out.push({ type: 'text', src: span(start + cursor, start + textEnd, ctx), value });
    }
    // The break owns the line ending and whatever block markers continue the container.
    let next = ending.end;
    while (next < raw.length && (raw[next] === ' ' || raw[next] === '\t' || raw[next] === '>')) next++;
    out.push({ type: 'softBreak', src: span(start + textEnd, start + next, ctx) });
    cursor = next;
  }
  return out;
}

