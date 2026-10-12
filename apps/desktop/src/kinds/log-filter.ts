// The level filter of a log (K-08), as pure functions: which lines a level keeps, how the lines it hides group into runs,
// and what a run says. No DOM. A level shows itself and everything above it; a continuation line (a stack frame, a
// wrapped message, a blank line) has the rank of the head before it, so an error keeps its frames. The ranks come from
// `logRanks` (core, the one pattern detection uses): this file only decides what to do with them.
import { logHead, logRanks, type LogRank } from '@marxy/core/src/highlight/line-classes.ts';

export type LevelId = 'all' | 'info' | 'warn' | 'error';

export interface Level {
  readonly id: LevelId;
  /** The word the menu and a hidden run use: "14 lines below Warn". */
  readonly label: string;
  /** The lowest rank this level keeps: 0 shows every line. */
  readonly min: LogRank;
}

export const LEVELS: readonly Level[] = [
  { id: 'all', label: 'All', min: 0 },
  { id: 'info', label: 'Info', min: 1 },
  { id: 'warn', label: 'Warn', min: 2 },
  { id: 'error', label: 'Error', min: 3 },
];

export const levelOf = (id: LevelId): Level => LEVELS.find((level) => level.id === id)!;

/** A maximal run of hidden lines, as the half-open range of line indexes [start, end). */
export interface HiddenRun {
  readonly start: number;
  readonly end: number;
}

/** The runs of lines whose rank is below `min`, in order. `min` 0 hides nothing. */
export function hiddenRuns(ranks: ArrayLike<number>, min: number): HiddenRun[] {
  const runs: HiddenRun[] = [];
  let start = -1;
  for (let i = 0; i < ranks.length; i++) {
    if (ranks[i]! < min) {
      if (start < 0) start = i;
    } else if (start >= 0) {
      runs.push({ start, end: i });
      start = -1;
    }
  }
  if (start >= 0) runs.push({ start, end: ranks.length });
  return runs;
}

/** The lines `min` keeps, as indexes into `lines`: the table the tests read. */
export function keptLines(lines: readonly string[], min: number): number[] {
  const ranks = logRanks(lines);
  return lines.flatMap((_, i) => (ranks[i]! >= min ? [i] : []));
}

/** What a hidden run says in the page: "14 lines below Warn". */
export function runWords(count: number, level: Level): string {
  return `${count.toLocaleString('en-US')} ${count === 1 ? 'line' : 'lines'} below ${level.label}`;
}

/** How many of a document's lines a level hides, and how many it has. */
export interface HiddenCount {
  readonly hidden: number;
  readonly total: number;
}

/** A line's end: LF, CRLF or a lone CR (the file's own line endings, as `parseCode` cuts it). */
function eachLine(text: string, visit: (start: number, end: number) => void, from = 0, until = text.length): number {
  let at = from;
  while (at < until) {
    let end = at;
    while (end < text.length && text.charCodeAt(end) !== 10 && text.charCodeAt(end) !== 13) end++;
    visit(at, end);
    at = end < text.length && text.charCodeAt(end) === 13 && text.charCodeAt(end + 1) === 10 ? end + 2 : end + 1;
  }
  return at;
}

/**
 * How many lines `min` hides in the whole of `text`, counting as the log would be read from its top: one pass, a few
 * milliseconds at a time, the event loop given back between slices. A document that ends in a newline has no empty line
 * after it. `aborted` ends the count early (the result is then null).
 */
export async function countHidden(
  text: string,
  min: number,
  yieldNow: () => Promise<void>,
  options: { readonly budgetMs?: number; readonly aborted?: () => boolean } = {},
): Promise<HiddenCount | null> {
  const budget = options.budgetMs ?? 8;
  let rank: number = 1;
  let hidden = 0;
  let total = 0;
  let at = 0;
  const visit = (start: number, end: number): void => {
    const head = logHead(text.slice(start, Math.min(end, start + 160)));
    if (head !== null) rank = head.rank;
    total++;
    if (rank < min) hidden++;
  };
  while (at < text.length) {
    if (options.aborted?.()) return null;
    const sliceStart = performance.now();
    do at = eachLine(text, visit, at, Math.min(text.length, at + 4096));
    while (at < text.length && performance.now() - sliceStart < budget);
    if (at < text.length) await yieldNow();
  }
  return { hidden, total };
}

/** The offset in `text` where the first line at ERROR or above begins, or -1. Only a head line can be one; a frame cannot. */
export function firstErrorOffset(text: string): number {
  let found = -1;
  let at = 0;
  while (at < text.length && found < 0) {
    at = eachLine(text, (start, end) => {
      if (found >= 0) return;
      const first = text.charCodeAt(start);
      if (!(first === 0x5b || (first >= 0x30 && first <= 0x39))) return;
      if (logHead(text.slice(start, Math.min(end, start + 160)))?.rank === 3) found = start;
    }, at, Math.min(text.length, at + 65_536));
  }
  return found;
}
