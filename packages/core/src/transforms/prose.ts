// Shared helpers for the transform library (J-03). Pure: no DOM, no Node built-ins.
//
// Every transform body works on LF text (the registry's wrapper normalises line endings in and restores
// them out), and reads structure from the parser, never from a regex over the whole text, so a fenced
// block, a math block or front matter is a span the transform steps around.
import type { Document, Heading, Node, Source } from '../contracts/ast.ts';
import type { Operation } from '../contracts/operation.ts';
import { parseMarkdown } from '../parse/parse.ts';
import { textIndex, type TextIndex } from '../operations/text-helpers.ts';
import type { ParsedText } from './types.ts';

const enc = new TextEncoder();

/** A half-open range of UTF-16 indices into the text a transform is given. */
export interface Span {
  readonly start: number;
  readonly end: number;
}

// The last parse is kept: a transform asks for the document more than once (the spans, then the nodes), and a
// pipeline runs several steps over one text. The AST is read-only (ADR-0001), so sharing it is safe.
let last: { text: string; doc: Document } | undefined;

export function parseText(lf: string): Document {
  if (last?.text === lf) return last.doc;
  const doc = parseMarkdown(enc.encode(lf), { file: 'transform' });
  last = { text: lf, doc };
  return doc;
}

/**
 * Runs `fn` with `parsed` standing in for the parse of `lf`, when `parsed` is a parse of exactly `lf` (F-60). The
 * cache the call found is put back afterwards, so what a caller holds never changes what a later call without
 * `parsed` reads. A `parsed` of any other text, or with a CR in it, is ignored and `fn` parses as it always did.
 */
export function withParse<T>(lf: string, parsed: ParsedText | undefined, fn: () => T): T {
  if (parsed === undefined || parsed.text !== lf || lf.includes('\r')) return fn();
  const before = last;
  last = { text: lf, doc: parsed.doc };
  try {
    return fn();
  } finally {
    last = before;
  }
}

/** Forgets the cached parse and index, for a test that must see a body parse for itself. */
export function resetProseCaches(): void {
  last = undefined;
  lastIndex = undefined;
}

// The byte-to-index map of the last text, kept for the same reason: building it is a scan of the whole text, so a
// transform that maps one node at a time (a table, a list, a code block) must not build it once per node.
let lastIndex: { text: string; index: TextIndex } | undefined;

/** `textIndex(lf)`, built once per text. */
export function indexOf(lf: string): TextIndex {
  if (lastIndex?.text === lf) return lastIndex.index;
  const index = textIndex(lf);
  lastIndex = { text: lf, index };
  return index;
}

/** Depth-first, document order. */
export function walk(node: Node, visit: (n: Node) => void): void {
  visit(node);
  for (const child of node.children ?? []) walk(child as Node, visit);
}

/** The spans (UTF-16) of every node whose type is in `types`, in document order, plus the node. */
export function nodesOf<T extends Node = Node>(lf: string, doc: Document, types: readonly string[]): { node: T; span: Span }[] {
  const index = indexOf(lf);
  const out: { node: T; span: Span }[] = [];
  walk(doc, (n) => {
    if (n !== doc && types.includes(n.type)) {
      out.push({ node: n as T, span: { start: index.toIndex(n.src.start), end: index.toIndex(n.src.end) } });
    }
  });
  return out;
}

/** Code blocks, math blocks and front matter: the bytes a prose transform never touches. Sorted, merged. */
export function protectedSpans(lf: string, doc: Document = parseText(lf)): Span[] {
  const spans = nodesOf(lf, doc, ['codeBlock', 'mathBlock', 'frontmatter']).map((s) => s.span).sort((a, b) => a.start - b.start);
  const merged: Span[] = [];
  for (const s of spans) {
    const last = merged[merged.length - 1];
    if (last && s.start <= last.end) merged[merged.length - 1] = { start: last.start, end: Math.max(last.end, s.end) };
    else merged.push(s);
  }
  return merged;
}

/**
 * The text between protected spans, with `tail`: the bytes of the next protected block's own line that come before
 * the block (its container's indent and markers; empty when the block starts its line, or no block follows).
 * LF text only (the transform wrapper guarantees it).
 */
export function gapsWithTail(lf: string, doc?: Document): (Span & { tail: string })[] {
  const gaps: (Span & { tail: string })[] = [];
  let at = 0;
  for (const p of protectedSpans(lf, doc)) {
    // A block nested in a list or quote starts after its container's indent and markers; those bytes are on the
    // block's own line, so the protected span is widened back to the line start and no caller can touch them (F-51).
    const start = Math.max(at, lf.lastIndexOf('\n', p.start - 1) + 1);
    if (start > at) gaps.push({ start: at, end: start, tail: lf.slice(start, p.start) });
    at = Math.max(at, p.end);
  }
  if (at < lf.length) gaps.push({ start: at, end: lf.length, tail: '' });
  return gaps;
}

/** The text between protected spans, as `{ span, text }`, in order. Empty gaps are left out. LF text only. */
export function gapsOf(lf: string, doc?: Document): Span[] {
  return gapsWithTail(lf, doc).map(({ start, end }) => ({ start, end }));
}

/** `f` applied to every run of text outside code blocks, math blocks and front matter; the protected bytes pass through. */
export function mapProse(lf: string, f: (prose: string) => string, doc?: Document): string {
  return mapProseWithTail(lf, (prose) => f(prose), doc);
}

/** Like `mapProse`; `f` also gets the `tail` of the gap (see `gapsWithTail`), the start of the line that follows it. */
export function mapProseWithTail(lf: string, f: (prose: string, tail: string) => string, doc?: Document): string {
  let out = '';
  let at = 0;
  for (const g of gapsWithTail(lf, doc)) {
    out += lf.slice(at, g.start) + f(lf.slice(g.start, g.end), g.tail);
    at = g.end;
  }
  return out + lf.slice(at);
}

/** An inline code span (the backtick run opens and closes it); the pieces between spans go to `f`. */
const CODE_SPAN = /(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)/g;

/** `f` applied to the pieces of `prose` between inline code spans; the spans pass through. */
export function mapOutsideCodeSpans(prose: string, f: (piece: string) => string): string {
  let out = '';
  let at = 0;
  for (const m of prose.matchAll(CODE_SPAN)) {
    out += f(prose.slice(at, m.index)) + m[0];
    at = m.index + m[0].length;
  }
  return out + f(prose.slice(at));
}

/** Like `mapProse`, and also steps around inline code spans. For rewrites that do not depend on a line start. */
export function mapInline(lf: string, f: (piece: string) => string, doc?: Document): string {
  return mapProse(lf, (prose) => mapOutsideCodeSpans(prose, f), doc);
}

function isAtxAt(lf: string, at: number, level: number): boolean {
  for (let i = 0; i < level; i++) if (lf[at + i] !== '#') return false;
  const next = lf[at + level];
  return next === undefined || next === ' ' || next === '\t' || next === '\n';
}

/** The ATX headings of the document (setext headings have no `#` run to edit and are left out), with their spans. */
export function atxHeadings(lf: string, doc: Document = parseText(lf)): { heading: Heading; span: Span }[] {
  return nodesOf<Heading>(lf, doc, ['heading'])
    // A setext heading whose text starts with `#` (`#x` over `---`) is not ATX: its level is the underline's, not the run's.
    .filter(({ node, span }) => isAtxAt(lf, span.start, node.level))
    .map(({ node, span }) => ({ heading: node, span }));
}

/** Apply non-overlapping edits to `lf`. */
export function applyEdits(lf: string, edits: readonly { start: number; end: number; text: string }[]): string {
  const sorted = [...edits].sort((a, b) => a.start - b.start);
  let out = '';
  let at = 0;
  for (const e of sorted) {
    out += lf.slice(at, e.start) + e.text;
    at = e.end;
  }
  return out + lf.slice(at);
}

/** Lines of LF text, with the one final line break set aside: `['a', 'b']` and `true` for `'a\nb\n'`. */
export function splitLinesLf(lf: string): { lines: string[]; finalEol: boolean } {
  if (lf === '') return { lines: [], finalEol: false };
  const finalEol = lf.endsWith('\n');
  return { lines: (finalEol ? lf.slice(0, -1) : lf).split('\n'), finalEol };
}

export function joinLinesLf(lines: readonly string[], finalEol: boolean): string {
  return lines.length === 0 ? '' : lines.join('\n') + (finalEol ? '\n' : '');
}

/** What `op` puts on the clipboard for `node`, or `undefined` when it does not apply there (E's operations, reused as text). */
export function clipboardOf(op: Operation, doc: Document, lf: string, node: Node | undefined = undefined, range: Source = node?.src ?? doc.src): string | undefined {
  const base = { document: doc, node, range };
  if (!op.canApply(base)) return undefined;
  const index = indexOf(lf);
  const text = lf.slice(index.toIndex(range.start), index.toIndex(range.end));
  return op.run({ ...base, text }).clipboard?.text;
}
