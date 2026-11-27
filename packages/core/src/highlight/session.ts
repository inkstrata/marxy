// One text's runs, a piece at a time: what Source's colour, and Read's for a whole file, is made from, in the
// highlight worker. The text is read in pieces, each begun in the grammar state the last one ended in, so the runs are the
// ones the whole text would give at once (`grammarTokens`); an edit is read again from the piece it falls in.
//
// What is in view is read first: the page says which lines it shows (`setView`), and the next piece is those lines,
// begun from the nearest state known. When that is far above the view, the lines are begun from a state near them that
// may be wrong (where an earlier read of the view ended, else the grammar's start): coloured at once, and wrongly only
// where a comment or a string opened above them; the reading top down then reaches them and sends them again, right. A
// file in the plain-text tier coloured anyway is read only where it is in view (`whole: false`).
import type { GrammarState } from '@shikijs/core';
import { grammarTokens } from './grammar.ts';
import { runsFromTokens } from './runs.ts';

/** One piece's runs: `from` and `to` bound the text they cover, the runs are absolute offsets into the whole text. */
export interface RunChunk {
  readonly from: number;
  readonly to: number;
  readonly runs: Uint32Array;
  /** No text is left to read after this piece; never said of a read of the view alone (`whole: false`). */
  readonly done: boolean;
}

/**
 * The first piece after the text arrives or changes is about a screen, so what is in view is coloured at once: a
 * grammar's first use compiles each rule the text reaches, and that, not the reading, is most of its cost. Later pieces
 * are larger, so fewer messages, but small enough that a view that moves waits little behind one: Shiki reads
 * JavaScript at about 0.13 MB/s, so 16,000 characters is at most about 120 ms.
 */
const FIRST_PIECE_LINES = 60;
const FIRST_PIECE_CHARS = 6_000;
const PIECE_CHARS = 16_000;
/** The view is read on from a right state when it is at most this far below one, else from one near it. */
const CATCH_UP_CHARS = 24_000;
/** States kept from reads of the view, for its next move; the oldest go first. */
const LOOSE_MAX = 64;

interface Mark {
  /** The line this piece starts at. */
  readonly line: number;
  /** The grammar state after every line before `line`; none at the text's start. */
  readonly state?: GrammarState;
}

export interface RunSessionOptions {
  /** Read every line, the view first (the full page); false reads only what is in view (colour anyway). Default true. */
  readonly whole?: boolean;
  /** The lines a piece may begin at (Read draws a file in pieces, each painted whole); none given: any line. */
  readonly cuts?: readonly number[];
}

/** Lines, `from` inclusive and `to` exclusive. */
export type LineRange = readonly [from: number, to: number];

export class RunSession {
  readonly lang: string;
  readonly whole: boolean;
  private readonly cuts: readonly number[] | null;
  private lines: string[] = [''];
  /** Each line's offset in the text, then one past the last line's newline. */
  private starts: number[] = [0, 1];
  /** The states read top down from the start: each is right. */
  private marks: Mark[] = [{ line: 0 }];
  /** States from reads of the view: maybe wrong, until the reading top down passes them. */
  private loose: Mark[] = [];
  /** Lines read for the view, not top down, since the text changed. */
  private delivered: [number, number][] = [];
  /** The lines in view, then those near it. */
  private view: LineRange[] = [];
  /** What of the view is still to read, in order. */
  private wanted: [number, number][] = [];
  private generation = 0;
  /** The next piece is the first since the text arrived or changed. */
  private first = true;

  constructor(lang: string, text = '', options: RunSessionOptions = {}) {
    this.lang = lang;
    this.whole = options.whole ?? true;
    this.cuts = options.cuts && options.cuts.length > 0 ? [...options.cuts].sort((a, b) => a - b) : null;
    this.update(text);
  }

  /** The text is now `text` (lines joined by `\n`). Pieces before the first line that changed are kept. */
  update(text: string): void {
    const next = text.split('\n');
    const prev = this.lines;
    const n = Math.min(prev.length, next.length);
    let same = 0;
    while (same < n && prev[same] === next[same]) same++;
    // A kept state depends only on the lines above its mark, so a mark at or above the first changed line still holds.
    while (this.marks.length > 1 && this.frontier.line > same) this.marks.pop();
    this.loose = this.loose.filter((m) => m.line <= same);
    this.delivered = this.delivered.filter(([from]) => from < same).map(([from, to]) => [from, Math.min(to, same)]);
    this.lines = next;
    const starts = new Array<number>(next.length + 1);
    let at = 0;
    for (let i = 0; i < next.length; i++) {
      starts[i] = at;
      at += next[i]!.length + 1;
    }
    starts[next.length] = at;
    this.starts = starts;
    this.generation++;
    this.first = true;
    // What was in view lost its colour past the change: it is read again first.
    this.want();
  }

  /**
   * The page shows `ranges` of lines, the view first and then what is near it: they are read next, before the rest. Lines
   * already read, top down or for an earlier view, are not read again.
   */
  setView(ranges: readonly LineRange[]): void {
    const last = this.lines.length;
    this.view = ranges.map(([from, to]) => [Math.max(0, Math.min(from, last)), Math.max(0, Math.min(to, last))] as const);
    this.want();
  }

  private want(): void {
    const top = this.frontier.line;
    this.wanted = [];
    for (const [from0, to0] of this.view) {
      let from = Math.max(from0, top);
      let to = to0;
      // The ends already read are trimmed; a hole in the middle is read again whole.
      for (let moved = true; moved && from < to; ) {
        moved = false;
        for (const [a, b] of this.delivered) {
          if (a <= from && from < b) {
            from = b;
            moved = true;
          }
          if (a < to && to <= b) {
            to = a;
            moved = true;
          }
        }
      }
      if (from < to) this.wanted.push([from, to]);
    }
  }

  private get frontier(): Mark {
    return this.marks[this.marks.length - 1]!;
  }

  /** Whether some of what is in view is still to read: the next piece is the view's. */
  get viewing(): boolean {
    return this.wanted.length > 0;
  }

  /** Whether nothing is left to read: every line (whole), or what is in view. */
  get done(): boolean {
    return this.whole ? this.frontier.line >= this.lines.length : this.wanted.length === 0;
  }

  /** The line a piece holding `line` begins at. */
  private cutBefore(line: number): number {
    if (!this.cuts) return line;
    let best = 0;
    for (const c of this.cuts) {
      if (c > line) break;
      best = c;
    }
    return best;
  }

  /** The line a piece reaching `line` ends before. */
  private cutAfter(line: number): number {
    const last = this.lines.length;
    if (!this.cuts || line >= last) return Math.min(line, last);
    for (const c of this.cuts) if (c >= line) return Math.min(c, last);
    return last;
  }

  /**
   * Reads the next piece: the view if it is not read yet, else the next piece top down. `null` when the language has
   * no grammar; `stale` when the text changed while the piece was being read (its runs would be for text that is gone),
   * and the caller asks again.
   */
  async next(): Promise<RunChunk | null | 'stale'> {
    const range = this.wanted.shift();
    if (range) return this.readView(range);
    if (!this.whole) return { from: 0, to: 0, runs: new Uint32Array(), done: false };
    const mark = this.frontier;
    const [budget, most] = this.first ? [FIRST_PIECE_CHARS, mark.line + FIRST_PIECE_LINES] : [PIECE_CHARS, Number.POSITIVE_INFINITY];
    let end = mark.line;
    let chars = 0;
    while (end < this.lines.length && (end === mark.line || (chars < budget && end < most))) chars += this.lines[end++]!.length + 1;
    return this.read(mark, this.cutAfter(end), true);
  }

  private readView([from0, to0]: [number, number]): Promise<RunChunk | null | 'stale'> {
    const from = this.cutBefore(from0);
    const to = this.cutAfter(to0);
    const top = this.frontier;
    if (this.starts[from]! - this.starts[top.line]! <= CATCH_UP_CHARS) return this.read(top, to, true);
    let near: Mark | undefined;
    for (const m of this.loose) {
      if (m.line <= from && this.starts[from]! - this.starts[m.line]! <= CATCH_UP_CHARS && (!near || m.line > near.line)) near = m;
    }
    return this.read(near ?? { line: from }, to, false);
  }

  /** Reads from `mark` to line `end`; `exact` when `mark` is the top-down reading's, which then moves on. */
  private async read(mark: Mark, end: number, exact: boolean): Promise<RunChunk | null | 'stale'> {
    const generation = this.generation;
    const read = await grammarTokens(this.lines.slice(mark.line, end), this.lang, mark.state);
    if (generation !== this.generation) return 'stale';
    if (read === null) return null;
    this.first = false;
    if (exact) {
      this.marks.push({ line: end, state: read.state });
      this.loose = this.loose.filter((m) => m.line > end);
      this.delivered = this.delivered.filter(([, to]) => to > end);
    } else {
      this.loose = this.loose.filter((m) => m.line !== end);
      this.loose.push({ line: end, state: read.state });
      if (this.loose.length > LOOSE_MAX) this.loose.shift();
      this.delivered.push([mark.line, end]);
    }
    this.want();
    const at = this.starts[mark.line]!;
    return { from: at, to: this.starts[end]!, runs: runsFromTokens(read.lines, at), done: this.whole && this.done };
  }
}
