// The one parse: source bytes → one AST with byte provenance (ADR-0003, ADR-0021).
// CommonMark by micromark, GFM/frontmatter/math by extension, offsets converted to bytes once.

import { fromMarkdown } from 'mdast-util-from-markdown';
import type { Extension as MdastExtension, Options as FromMarkdownOptions } from 'mdast-util-from-markdown';
import { gfm } from 'micromark-extension-gfm';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { frontmatter } from 'micromark-extension-frontmatter';
import { frontmatterFromMarkdown } from 'mdast-util-frontmatter';
import { mathFromMarkdown } from 'mdast-util-math';
import { math } from './math-syntax.ts';
import type { Document } from '../contracts/ast.ts';
import { byteOffsets, decodeWithOffsets, type ByteOffsets } from './byte-offsets.ts';
import { documentFromMdast, fencedCodeMarker, holdsDefinitions } from './from-mdast.ts';

export interface ParseOptions {
  /** Absolute path, or a stable identifier for an untitled buffer. Defaults to `untitled`. */
  readonly file?: string;
  /** GFM: tables, strikethrough, task items, autolinks, footnotes. On by default. */
  readonly gfm?: boolean;
  /** YAML/TOML frontmatter. On by default. */
  readonly frontmatter?: boolean;
  /** `$…$` and `$$…$$` math. On by default. */
  readonly math?: boolean;
}

/** Parse a document's bytes. Accepts a string for callers that already hold the buffer decoded. */
export function parseMarkdown(source: string | Uint8Array, options: ParseOptions = {}): Document {
  const file = options.file ?? 'untitled';
  const { body, offsets } = typeof source === 'string' ? fromString(source) : fromBytes(source);
  const { extensions, mdastExtensions } = syntax(options);
  const tree = fromMarkdown(body, { extensions, mdastExtensions });
  return documentFromMdast(tree, { file, text: body, offsets });
}

/**
 * The top-level blocks of `bytes[start, end)` parsed on their own, with offsets into the whole of
 * `bytes`, and whether that parse held a link reference or footnote definition. For the reparse
 * (reparse.ts), which proves the result equals the whole file's parse there before using it. A region
 * after the first byte never holds frontmatter, which only the top of a file can. `null` when the
 * region opens with U+FEFF, which micromark would drop and so shift every offset.
 */
export function parseBlocksIn(
  bytes: Uint8Array,
  start: number,
  end: number,
  options: ParseOptions = {},
): { readonly blocks: Document['children']; readonly definitions: boolean } | null {
  const file = options.file ?? 'untitled';
  const view = end === bytes.length ? bytes : bytes.subarray(0, end);
  const { body: text, offsets } = start === 0 ? fromBytes(view) : fromRegion(view, start);
  if (start > 0 && text.charCodeAt(0) === 0xfeff) return null;
  const { extensions, mdastExtensions } = syntax(start === 0 ? options : { ...options, frontmatter: false });
  const tree = fromMarkdown(text, { extensions, mdastExtensions });
  const document = documentFromMdast(tree, { file, text, offsets });
  return { blocks: document.children, definitions: holdsDefinitions(document) === true };
}

// A byte-order mark is bytes of the file but not markdown: leaving it in would make the first line
// start with U+FEFF and stop being a heading. It is skipped for parsing and paid for in `base`.
function fromString(text: string): { body: string; offsets: ByteOffsets } {
  // Every leading U+FEFF is stripped here, not just the first: micromark drops one more on its own,
  // which would shift every offset by its three bytes.
  let boms = 0;
  while (text.charCodeAt(boms) === 0xfeff) boms += 1;
  const body = boms > 0 ? text.slice(boms) : text;
  return { body, offsets: byteOffsets(body, boms * 3) };
}

/** Offsets come from the bytes, so a file that is not valid UTF-8 still gets offsets into itself. */
function fromBytes(bytes: Uint8Array): { body: string; offsets: ByteOffsets } {
  let skipped = 0;
  while (bytes[skipped] === 0xef && bytes[skipped + 1] === 0xbb && bytes[skipped + 2] === 0xbf) skipped += 3;
  const { text, offsets } = decodeWithOffsets(bytes, skipped);
  return { body: text, offsets };
}

function fromRegion(bytes: Uint8Array, start: number): { body: string; offsets: ByteOffsets } {
  const { text, offsets } = decodeWithOffsets(bytes, start);
  return { body: text, offsets };
}

interface Syntax {
  extensions: NonNullable<FromMarkdownOptions['extensions']>;
  mdastExtensions: NonNullable<FromMarkdownOptions['mdastExtensions']>;
}

// Building the extension objects is a measurable share of a small parse, and they are stateless, so
// each combination is built once. Cold start is a budget (ADR-0013).
const syntaxCache = new Map<string, Syntax>();

function syntax(options: ParseOptions): Syntax {
  const key = `${options.gfm !== false}:${options.frontmatter !== false}:${options.math !== false}`;
  const cached = syntaxCache.get(key);
  if (cached) return cached;
  const built: Syntax = { extensions: [], mdastExtensions: [fencedCodeMarker] };
  if (options.gfm !== false) {
    built.extensions.push(gfm());
    built.mdastExtensions.push(withoutTransforms(gfmFromMarkdown()));
  }
  if (options.frontmatter !== false) {
    built.extensions.push(frontmatter(['yaml', 'toml']));
    built.mdastExtensions.push(frontmatterFromMarkdown(['yaml', 'toml']));
  }
  if (options.math !== false) {
    built.extensions.push(math());
    built.mdastExtensions.push(mathFromMarkdown());
  }
  syntaxCache.set(key, built);
  return built;
}

/**
 * Drops the tree transforms from a set of mdast extensions, keeping their token handlers.
 *
 * GFM's autolink-literal extension carries one: a `findAndReplace` pass that rewrites a paragraph's
 * inline children to linkify candidates micromark's own scanner could not match — `x <a\.b@c.example>
 * y`. That pass rebuilds the children *without* position data, so every inline node in the paragraph
 * loses its provenance, and a parser that filled the gap with a default would point them at the top
 * of the file. ADR-0003 makes provenance structural, so the pass has to go rather than be compensated
 * for.
 *
 * What this costs was measured by diffing the link nodes of 39 autolink inputs parsed both ways
 * (ADR-0021): a candidate stops linkifying only when an escape or a character reference falls in the
 * part that identifies it to the scanner, which is a bare email's address or a `www.` host. Escapes
 * and references in a path or query are unaffected, and every `http(s)://` form is unaffected because
 * the scheme anchors the scan. What it buys is that no node reaches `from-mdast.ts` without offsets.
 */
function withoutTransforms(extensions: MdastExtension[]): MdastExtension[] {
  return extensions.map((extension) => {
    if (extension.transforms === undefined) return extension;
    const { transforms: _dropped, ...rest } = extension;
    return rest;
  });
}
