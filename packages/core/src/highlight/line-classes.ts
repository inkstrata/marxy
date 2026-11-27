// Diff line classes and log-level detection for fenced code, and the lines of a log.

import { ANSI_ESC_CLASS } from '../log/ansi.ts';
import { logHead, type LogRank } from '../log/head.ts';

export const DIFF_LINE_ADD = 'marxy-diff-add';
export const DIFF_LINE_DEL = 'marxy-diff-del';
export const LOG_LEVEL_CLASS = 'marxy-log-level';
/** A log line's leading timestamp: the comment colour, no hue of its own. */
export const LOG_TIME_CLASS = 'marxy-log-time';
/** A line at ERROR or above, and the continuation lines after it: a rule at its left edge. */
export const LOG_ERROR_LINE_CLASS = 'marxy-log-error';
/** The brackets, spaces and colon around a head's timestamp and level: Read's log page sets the time and the level in
 * columns of their own, so there they take no room. */
export const LOG_SPACE_CLASS = 'marxy-log-space';
/** A level that stands inside its line (an access log's status), not in the level column: drawn in the line's flow. */
export const LOG_INLINE_CLASS = 'marxy-log-inline';
/** An escape sequence (ESC, `[`, its parameters, a final letter): the log page hides it, and draws what it styles in a tone. */
export const LOG_ESC_CLASS = ANSI_ESC_CLASS;

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

/** Marker column width for diff continuation hang. */
export function diffMarkerIndentCh(lineClass: string | undefined): number | undefined {
  if (lineClass === DIFF_LINE_ADD || lineClass === DIFF_LINE_DEL) return 1;
  return undefined;
}

export { logHead, logHeadParts, logRankOf, type LogHead, type LogHeadParts, type LogRank } from '../log/head.ts';

/** What a continuation line (a stack frame, a wrapped message, a blank line) before any head belongs to. */
export const LOG_ORPHAN_RANK: LogRank = 1;

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
