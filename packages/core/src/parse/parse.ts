// The one parse: source bytes → one AST with byte provenance.
// CommonMark by micromark, GFM/frontmatter/math by extension, offsets converted to bytes once.

import { fromMarkdown } from 'mdast-util-from-markdown';
import type { Extension as MdastExtension, Options as FromMarkdownOptions } from 'mdast-util-from-markdown';
import { boundedAttention } from './bounded-attention.ts';
import { boundedGfm } from './bounded-gfm.ts';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { frontmatter } from 'micromark-extension-frontmatter';
import { frontmatterFromMarkdown } from 'mdast-util-frontmatter';
import { mathFromMarkdown } from 'mdast-util-math';
import { math } from './math-syntax.ts';
import type { Document } from '../contracts/ast.ts';
import { byteOffsets, decodedFrom, decodeWithOffsets, type ByteOffsets, type Decoded } from './byte-offsets.ts';
import { opensWithTooManyMarkers } from './nesting-scan.ts';
import {
  definitionEntries, type DefinitionEntry, type DefinitionIndex, documentFromMdast, fencedCodeMarker, NO_DEFINITIONS, nestedTooDeepDocument,
  nestedTooDeepText, setDefinitionIndex, targetsOf,
} from './from-mdast.ts';

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

// How many times `parseMarkdown` has been called, for a test to read and nothing to act on, as
// `lastChunkedParse` is. It shows that a caller handed a parse used it rather than made another.
let parses = 0;
export const parseCount = (): number => parses;

/**
 * Parse a document's bytes. Accepts a string for callers that already hold the buffer decoded. `decoded` is the bytes'
 * own decode (`decodeWithOffsets(source)`, a store Buffer's `text` and `offsets`): the parse uses it, not a second copy.
 */
export function parseMarkdown(source: string | Uint8Array, options: ParseOptions = {}, decoded?: Decoded): Document {
  parses += 1;
  const file = options.file ?? 'untitled';
  const { body, offsets } = typeof source === 'string' ? fromString(source) : fromBytes(source, decoded);
  if (opensWithTooManyMarkers(body)) return nestedTooDeepDocument({ file, text: body, offsets });
  const { extensions, mdastExtensions } = syntax(options);
  const probe = definitionsProbe(undefined, options.gfm !== false);
  const tree = fromMarkdown(body, { extensions: [...extensions, probe.extension], mdastExtensions });
  const document = documentFromMdast(tree, { file, text: body, offsets });
  const entries = definitionEntries(document);
  if (entries !== undefined) setDefinitionIndex(document, indexOf(entries, probe.lists()));
  return document;
}

/** What `parseBlocksIn` gives: a region's blocks and what its parse found of definitions. */
export interface Region {
  readonly blocks: Document['children'];
  /** Whether the region's own parse held a link reference or footnote definition. */
  readonly definitions: boolean;
  /** The definitions the region's own parse held, in document order, with offsets into the whole of `bytes`. */
  readonly entries: readonly DefinitionEntry[];
  /**
   * With `known`: whether every label the region's parse added to micromark's lists came from a definition in
   * its tree. When not, the region may hold a definition the tree does not show, and is not to be used.
   */
  readonly agrees: boolean;
}

/**
 * The top-level blocks of `bytes[start, end)` parsed on their own, with offsets into the whole of
 * `bytes`, and whether that parse held a link reference or footnote definition. For the reparse
 * (reparse.ts), which proves the result equals the whole file's parse there before using it. A region
 * after the first byte never holds frontmatter, which only the top of a file can. `null` when the
 * region opens with U+FEFF, which micromark would drop and so shift every offset.
 *
 * `known` are the file's definitions: micromark is told their labels before it tokenises the region, so a
 * reference in it is taken as one exactly when the whole file's parse would take it, and link references
 * resolve to the file's targets rather than the region's.
 */
export function parseBlocksIn(bytes: Uint8Array, start: number, end: number, options: ParseOptions = {}, known?: DefinitionIndex): Region | null {
  const file = options.file ?? 'untitled';
  const view = end === bytes.length ? bytes : bytes.subarray(0, end);
  const { body: text, offsets } = start === 0 ? fromBytes(view) : fromRegion(view, start);
  if (start > 0 && text.charCodeAt(0) === 0xfeff) return null;
  // A region nested too deep is no region: the caller parses the whole file, which is then shown as its source.
  if (opensWithTooManyMarkers(text)) return null;
  const { extensions, mdastExtensions } = syntax(start === 0 ? options : { ...options, frontmatter: false });
  const gfm = options.gfm !== false;
  const probe = known === undefined ? undefined : definitionsProbe(known, gfm);
  const tree = fromMarkdown(text, { extensions: probe ? [...extensions, probe.extension] : extensions, mdastExtensions });
  const document = documentFromMdast(tree, { file, text, offsets }, known?.targets);
  if (nestedTooDeepText(document) !== undefined) return null;
  const entries = definitionEntries(document) ?? [];
  return {
    blocks: document.children,
    definitions: entries.length > 0,
    entries,
    agrees: known === undefined || probe === undefined || regionAgrees(known, entries, probe.lists(), gfm),
  };
}

// --- definitions -------------------------------------------------------------------------------

/** micromark's lists of the labels defined so far: `defined` for links, `gfmFootnotes` for footnotes. */
interface Lists {
  readonly links: readonly string[];
  readonly footnotes: readonly string[];
}

interface MicromarkParser {
  defined: string[];
  gfmFootnotes?: string[];
}

/**
 * A micromark extension that reaches the parser's lists of defined labels, and with `seed` fills them first.
 *
 * micromark settles whether `[x]`, `[x][]`, `[a][x]` or `[^x]` is a reference while it tokenises the
 * text, by looking the label up in `parser.defined` (link-reference definitions, pushed as each is
 * tokenised) and `parser.gfmFootnotes` (the footnote extension's own list). Every definition is tokenised
 * with the flow, before any text is, so the lookups see the file's whole set; a region parsed alone would
 * see only its own. The hook is a construct that matches nothing, put first where a definition can start
 * (a `[` opening a container or content) and where a reference is decided (a `[` or `]` in text), so it runs
 * before any label is pushed or looked up: the seed is in place before the first lookup, and the labels the
 * region pushes come after it.
 */
function definitionsProbe(seed: DefinitionIndex | undefined, gfm: boolean): { extension: MicromarkExtension; lists: () => Lists | undefined } {
  let parser: MicromarkParser | undefined;
  const hook = {
    name: 'marxyDefinitionLabels',
    partial: true,
    tokenize(this: { parser: MicromarkParser }, _effects: unknown, _ok: unknown, nok: unknown): unknown {
      if (parser === undefined) {
        parser = this.parser;
        if (seed !== undefined) {
          for (const label of seed.links) parser.defined.push(label);
          if (gfm) {
            parser.gfmFootnotes ??= [];
            for (const label of seed.footnotes) parser.gfmFootnotes.push(label);
          }
        }
      }
      return nok;
    },
  };
  const extension = { document: { 91: hook }, contentInitial: { 91: hook }, text: { 91: hook, 93: hook } } as unknown as MicromarkExtension;
  // `undefined` when the hook never ran: then nothing was defined and nothing looked up.
  const lists = (): Lists | undefined => (parser === undefined ? undefined : { links: parser.defined, footnotes: parser.gfmFootnotes ?? [] });
  return { extension, lists };
}

type MicromarkExtension = NonNullable<FromMarkdownOptions['extensions']>[number];

/**
 * The index of a whole file's definitions, or `'unknown'` when micromark's lists and the tree disagree: a link
 * label pushed once per definition tokenised, a footnote label once per label. They agree for every input tried;
 * the check keeps a disagreement (a definition tokenised and then undone) from passing for an index.
 */
function indexOf(entries: readonly DefinitionEntry[], reached: Lists | undefined): DefinitionIndex | 'unknown' {
  const lists = reached ?? { links: [], footnotes: [] };
  if (entries.length === 0 && lists.links.length === 0 && lists.footnotes.length === 0) return NO_DEFINITIONS;
  const links = entries.filter((e) => e.kind === 'link').map((e) => e.identifier);
  const footnotes = entries.filter((e) => e.kind === 'footnote').map((e) => e.identifier);
  if (!sameMultiset(lists.links.map(lower), links) || !sameSet(lists.footnotes.map(lower), footnotes)) return 'unknown';
  return { entries, targets: targetsOf(entries), links: lists.links.slice(), footnotes: lists.footnotes.slice() };
}

/** The labels a seeded region's parse pushed beyond its seed are exactly its tree's definitions. */
function regionAgrees(known: DefinitionIndex, entries: readonly DefinitionEntry[], lists: Lists | undefined, gfm: boolean): boolean {
  if (lists === undefined) return entries.length === 0;
  const pushed = lists.links.slice(known.links.length).map(lower);
  const links = entries.filter((e) => e.kind === 'link').map((e) => e.identifier);
  if (!sameMultiset(pushed, links)) return false;
  const footnotes = entries.filter((e) => e.kind === 'footnote').map((e) => e.identifier);
  return sameSet(lists.footnotes.map(lower), [...(gfm ? known.footnotes : []).map(lower), ...footnotes]);
}

const lower = (label: string): string => label.toLowerCase();

function sameMultiset(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const counts = new Map<string, number>();
  for (const x of a) counts.set(x, (counts.get(x) ?? 0) + 1);
  for (const x of b) {
    const n = counts.get(x);
    if (!n) return false;
    counts.set(x, n - 1);
  }
  return true;
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  const x = new Set(a);
  const y = new Set(b);
  if (x.size !== y.size) return false;
  for (const v of x) if (!y.has(v)) return false;
  return true;
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
function fromBytes(bytes: Uint8Array, decoded?: Decoded): { body: string; offsets: ByteOffsets } {
  let skipped = 0;
  while (bytes[skipped] === 0xef && bytes[skipped + 1] === 0xbb && bytes[skipped + 2] === 0xbf) skipped += 3;
  // Each byte-order mark is one U+FEFF in a whole decode.
  const { text, offsets } = decoded ? decodedFrom(decoded, skipped / 3) : decodeWithOffsets(bytes, skipped);
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
// each combination is built once. Cold start is a budget.
const syntaxCache = new Map<string, Syntax>();

function syntax(options: ParseOptions): Syntax {
  const key = `${options.gfm !== false}:${options.frontmatter !== false}:${options.math !== false}`;
  const cached = syntaxCache.get(key);
  if (cached) return cached;
  const built: Syntax = { extensions: [boundedAttention()], mdastExtensions: [fencedCodeMarker] };
  if (options.gfm !== false) {
    built.extensions.push(boundedGfm());
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
 * of the file. Provenance is structural, so the pass has to go rather than be compensated
 * for.
 *
 * What this costs was measured by diffing the link nodes of 39 autolink inputs parsed both ways:
 * a candidate stops linkifying only when an escape or a character reference falls in the
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
