// Allow-listed hyphenation (ADR-0006, docs/design/04-typeset.md §Hyphenation): TeX patterns for
// en-us and en-gb only, chosen by the nearest lang, and never inside code, URLs, or digit-words.

import type { Piece, Token } from './runs.ts';

export type PatternId = 'en-us' | 'en-gb';
export type Hyphenator = (word: string) => readonly string[];

const MIN_LETTERS = 6;
const URL = /:\/\//i;
const WWW = /^www\./i;
const LETTER = /\p{L}/u;
const DIGIT = /\d/;
const WORD = /\p{L}[\p{L}\p{M}'’]*/u;

/** The allow-listed pattern for `lang`, or null when this paragraph must not hyphenate. */
export function resolvePattern(lang: string): PatternId | null {
  const tag = lang.trim().toLowerCase().replaceAll('_', '-');
  if (tag === 'en' || tag === 'en-us' || tag.startsWith('en-us-')) return 'en-us';
  if (tag === 'en-gb' || tag.startsWith('en-gb-')) return 'en-gb';
  return null;
}

/**
 * Words the hyphenator must not see: too short, carrying digits, or a URL. A code span is already
 * one unbreakable piece (runs.ts); this is the rest of §Hyphenation.
 */
export function skipHyphenation(word: string): boolean {
  if (URL.test(word) || WWW.test(word)) return true;
  if (DIGIT.test(word)) return true;
  let letters = 0;
  for (const ch of word) if (LETTER.test(ch)) letters++;
  return letters < MIN_LETTERS;
}

/** Character offsets inside `word` at which a hyphen may be inserted; empty when the word is skipped. */
export function hyphenOffsets(word: string, hyphenate: Hyphenator): number[] {
  if (skipHyphenation(word)) return [];
  const parts = hyphenate(word);
  if (parts.length < 2) return [];
  const offsets: number[] = [];
  let at = 0;
  for (const part of parts.slice(0, -1)) {
    at += part.length;
    if (at > 0 && at < word.length) offsets.push(at);
  }
  return offsets;
}

let loaded: Promise<Record<PatternId, Hyphenator>> | null = null;

/** Loads both allow-listed patterns once; compile cost is justif's, on first use of each. */
export function loadHyphenators(): Promise<Record<PatternId, Hyphenator>> {
  loaded ??= Promise.all([
    import('justif/hyphenate/en-us'),
    import('justif/hyphenate/en-gb'),
  ]).then(([us, gb]) => ({ 'en-us': us.hyphenateEnUS, 'en-gb': gb.hyphenateEnGB }));
  return loaded;
}

function letterRun(text: string): { start: number; word: string } | null {
  const match = WORD.exec(text);
  if (match === null || match.index === undefined) return null;
  return { start: match.index, word: match[0]! };
}

function atOffset(piece: Piece, charOffset: number): { node: Text; offset: number } {
  let seen = 0;
  for (const segment of piece.segments) {
    const len = segment.end - segment.start;
    if (charOffset < seen + len) {
      return { node: segment.node, offset: segment.start + (charOffset - seen) };
    }
    seen += len;
  }
  const last = piece.segments[piece.segments.length - 1]!;
  return { node: last.node, offset: last.end };
}

function slicePiece(piece: Piece, from: number, to: number): Piece {
  const segments = [];
  let seen = 0;
  for (const segment of piece.segments) {
    const len = segment.end - segment.start;
    const start = Math.max(from, seen);
    const end = Math.min(to, seen + len);
    if (end > start) {
      segments.push({
        node: segment.node,
        start: segment.start + (start - seen),
        end: segment.start + (end - seen),
      });
    }
    seen += len;
  }
  return { kind: 'piece', segments, text: piece.text.slice(from, to) };
}

function insideCode(piece: Piece): boolean {
  const node = piece.segments[0]?.node;
  return node?.parentElement?.closest('code, kbd, .marxy-math-inline') !== null;
}

/**
 * Splits hyphenatable pieces at the hyphenator's points. Code, URLs, digit-words and short words
 * stay whole. The new hyphen tokens sit at the (node, offset) applyBreaks will split.
 */
export function insertHyphens(tokens: readonly Token[], hyphenate: Hyphenator): Token[] {
  const out: Token[] = [];
  for (const token of tokens) {
    if (token.kind !== 'piece' || insideCode(token)) {
      out.push(token);
      continue;
    }
    const run = letterRun(token.text);
    if (run === null) {
      out.push(token);
      continue;
    }
    const splits = hyphenOffsets(run.word, hyphenate).map((offset) => run.start + offset);
    if (splits.length === 0) {
      out.push(token);
      continue;
    }
    let from = 0;
    for (const split of splits) {
      if (split > from) out.push(slicePiece(token, from, split));
      const at = atOffset(token, split);
      out.push({ kind: 'hyphen', node: at.node, offset: at.offset });
      from = split;
    }
    if (from < token.text.length) out.push(slicePiece(token, from, token.text.length));
  }
  return out;
}
