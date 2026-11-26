// What a block's drawing costs is paid once per text: token lines for code, KaTeX's markup for a formula, an SVG for a
// diagram. Each store holds strings and token data, never DOM nodes, and is bounded by entries and by characters.
// Nothing here depends on the theme: tokens carry scope names, and colour, KaTeX's spacing and a diagram's ink are
// all CSS on the classes, so a theme change recolours what a cache served. A diagram's boxes are fitted to the face it
// was measured in, so that face is part of its key.
import type { HighlightToken } from '@marxy/core/src/highlight/index.ts';

/** Least recently used first out, bounded by entry count and by the characters its keys and values stand for. */
export class BoundedCache<V> {
  private readonly map = new Map<string, { value: V; size: number }>();
  private chars = 0;

  private readonly maxEntries: number;
  private readonly maxChars: number;

  constructor(maxEntries: number, maxChars: number) {
    this.maxEntries = maxEntries;
    this.maxChars = maxChars;
  }

  get(key: string): V | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    this.map.delete(key);
    this.map.set(key, hit);
    return hit.value;
  }

  /** One entry over a quarter of the character bound is not kept: it would push out everything else. */
  set(key: string, value: V, size: number): void {
    const cost = size + key.length;
    this.delete(key);
    if (cost > this.maxChars / 4) return;
    this.map.set(key, { value, size: cost });
    this.chars += cost;
    for (const [oldest, entry] of this.map) {
      if (this.map.size <= this.maxEntries && this.chars <= this.maxChars) break;
      this.map.delete(oldest);
      this.chars -= entry.size;
    }
  }

  private delete(key: string): void {
    const had = this.map.get(key);
    if (!had) return;
    this.map.delete(key);
    this.chars -= had.size;
  }

  clear(): void {
    this.map.clear();
    this.chars = 0;
  }

  get size(): number {
    return this.map.size;
  }
}

export type TokenLines = HighlightToken[][];

/** A code text's token lines; `runs` is Source's form of them, made the first time Source asks. */
export interface TokenEntry {
  readonly lines: TokenLines;
  runs?: Uint32Array;
}

const tokens = new BoundedCache<TokenEntry>(512, 1_500_000);
const tokenKey = (lang: string, code: string): string => `${lang}\u0000${code}`;

/** What the worker said for `code` in `lang`, if it has said it. Read and Source share this one store. */
export function peekTokens(lang: string, code: string): TokenEntry | undefined {
  return tokens.get(tokenKey(lang, code));
}

/** Only a real reply is kept: a null stands for a dropped job or a failed worker as much as for a language with no grammar. */
export function rememberTokens(lang: string, code: string, lines: TokenLines): void {
  tokens.set(tokenKey(lang, code), { lines }, code.length);
}

const formulas = new BoundedCache<string>(1024, 1_000_000);
const formulaKey = (display: boolean, src: string): string => `${display ? 'd' : 'i'}\u0000${src}`;

/** The markup KaTeX made for `src`, set as a block (`display`) or inline. */
export function peekFormula(display: boolean, src: string): string | undefined {
  return formulas.get(formulaKey(display, src));
}

export function rememberFormula(display: boolean, src: string, html: string): void {
  formulas.set(formulaKey(display, src), html, html.length);
}

/** The id prefix a cached drawing carries; each drawing on a page swaps it for its own. */
export const DIAGRAM_ID_MARK = 'mmcached0-';

export interface DrawnDiagram {
  readonly svg: string;
  readonly width: number;
  readonly title: string;
  readonly note: string;
}

const diagrams = new BoundedCache<DrawnDiagram>(64, 1_000_000);
const diagramKey = (face: string, src: string): string => `${face}\u0000${src}`;

export function peekDiagram(face: string, src: string): DrawnDiagram | undefined {
  return diagrams.get(diagramKey(face, src));
}

export function rememberDiagram(face: string, src: string, drawn: DrawnDiagram): void {
  diagrams.set(diagramKey(face, src), drawn, drawn.svg.length + drawn.title.length + drawn.note.length);
}
