// Diff line classes and log-level detection for fenced code (MARXY-235, ADR-0036), and the lines of a log (K-08).

import { TIMESTAMP } from '../kind/detect.ts';

export const DIFF_LINE_ADD = 'marxy-diff-add';
export const DIFF_LINE_DEL = 'marxy-diff-del';
export const LOG_LEVEL_CLASS = 'marxy-log-level';
/** A log line's leading timestamp: the comment colour, no hue of its own (K-08). */
export const LOG_TIME_CLASS = 'marxy-log-time';
/** A line at ERROR or above, and the continuation lines after it: a rule at its left edge (K-08). */
export const LOG_ERROR_LINE_CLASS = 'marxy-log-error';

const LOG_LEVEL_WORD = /^(?:ERROR|FATAL|WARN|WARNING|INFO|DEBUG|TRACE)$/;

/** Line tint for a unified-diff fence; markers and headers stay plain (handbook ch.5). */
export function lineClassForFenceLine(lang: string, lineText: string): string | undefined {
  const id = lang.trim().toLowerCase();
  if (id !== 'diff' && id !== 'patch') return undefined;
  if (lineText.includes('\\ No newline at end of file')) return undefined;
  if (lineText.startsWith('@@') || lineText.startsWith('+++') || lineText.startsWith('---')) return undefined;
  if (lineText.startsWith('+')) return DIFF_LINE_ADD;
  if (lineText.startsWith('-')) return DIFF_LINE_DEL;
  return undefined;
}

/** Strong weight on the level token only; no hue (handbook ch.3, ch.9). */
export function logLevelClassForToken(lang: string, tokenText: string): string | undefined {
  const id = lang.trim().toLowerCase();
  if (id !== 'log') return undefined;
  const word = tokenText.trim();
  return LOG_LEVEL_WORD.test(word) ? LOG_LEVEL_CLASS : undefined;
}

/** Marker column width for diff continuation hang (ADR-0036 clause 10). */
export function diffMarkerIndentCh(lineClass: string | undefined): number | undefined {
  if (lineClass === DIFF_LINE_ADD || lineClass === DIFF_LINE_DEL) return 1;
  return undefined;
}

/** A level's rank: 0 trace and debug, 1 info and notice, 2 warn, 3 error, fatal and critical. */
export type LogRank = 0 | 1 | 2 | 3;

const RANK_OF_WORD: Readonly<Record<string, LogRank>> = {
  trace: 0, debug: 0, info: 1, notice: 1, warn: 2, warning: 2, error: 3, err: 3, fatal: 3, critical: 3, crit: 3,
};

/** A line that opens with a timestamp and a level word: its rank and where the timestamp and the level word sit (UTF-16 offsets). */
export interface LogHead {
  readonly rank: LogRank;
  readonly time: readonly [number, number];
  readonly level: readonly [number, number];
}

/** What a continuation line (a stack frame, a wrapped message, a blank line) before any head belongs to. */
export const LOG_ORPHAN_RANK: LogRank = 1;

/** `line` as a log head, or null for a continuation line. The one pattern is detection's (`TIMESTAMP`, kind/detect.ts). */
export function logHead(line: string): LogHead | null {
  const m = TIMESTAMP.exec(line);
  if (m === null) return null;
  const timeStart = m[1]!.length;
  const timeEnd = timeStart + m[2]!.length;
  const levelStart = timeEnd + m[3]!.length;
  return { rank: RANK_OF_WORD[m[4]!.toLowerCase()]!, time: [timeStart, timeEnd], level: [levelStart, levelStart + m[4]!.length] };
}

/**
 * The rank of every line: a head's own, and a continuation line takes the rank of the head before it (a stack trace
 * stays with its error). A continuation line before any head takes `LOG_ORPHAN_RANK`.
 */
export function logRanks(lines: readonly string[]): Uint8Array {
  const out = new Uint8Array(lines.length);
  let rank: LogRank = LOG_ORPHAN_RANK;
  for (let i = 0; i < lines.length; i++) {
    const head = logHead(lines[i]!);
    if (head !== null) rank = head.rank;
    out[i] = rank;
  }
  return out;
}
