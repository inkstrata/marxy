// What the page needs of highlighting: the language table, the runs of the readings that have no grammar (a log, a
// terminal session), line classes and the token shape. Reading a grammar's tokens is grammar.ts, which reaches Shiki and
// every grammar's loader; nothing here may import it, or the page ships the grammars a second time.
import { ansiClasses, ansiEscClasses, ansiRuns } from '../log/ansi.ts';
import {
  LOG_ERROR_LINE_CLASS,
  LOG_INLINE_CLASS,
  LOG_LEVEL_CLASS,
  LOG_SPACE_CLASS,
  LOG_TIME_CLASS,
  lineClassForFenceLine,
  logHeadParts,
  logRanks,
} from './line-classes.ts';
import type { MarxyTokenScope } from './scopes.ts';
import { diffFileLineClasses, type DiffState } from './diff-lines.ts';
import { LANGUAGE_TO_GRAMMAR } from './languages.generated.ts';
import { TERM_COMMAND_CLASS, TERM_PROMPT_CLASS, TERM_START_CLASS, isTerminalLang, terminalLines } from './terminal-lines.ts';

export type { MarxyTokenScope } from './scopes.ts';
export { marxyScopeForTextMateScope, marxyScopeForTokenColor } from './scopes.ts';
export { LANGUAGE_TO_GRAMMAR } from './languages.generated.ts';
export { lineCapFor } from './line-cap.ts';
export { DIFF_OUTSIDE, diffFileRead, hunkWords, type DiffState } from './diff-lines.ts';
export {
  TERM_COMMAND_CLASS,
  TERM_PROMPT_CLASS,
  TERM_START_CLASS,
  copyCommands,
  copyOutput,
  isTerminalLang,
  terminalGroups,
  terminalLines,
  textLines,
  type TerminalGroup,
  type TerminalLine,
} from './terminal-lines.ts';
export {
  DIFF_LINE_ADD,
  DIFF_LINE_DEL,
  LOG_ERROR_LINE_CLASS,
  LOG_ESC_CLASS,
  LOG_INLINE_CLASS,
  LOG_LEVEL_CLASS,
  LOG_ORPHAN_RANK,
  LOG_SPACE_CLASS,
  LOG_TIME_CLASS,
  diffMarkerIndentCh,
  lineClassForFenceLine,
  logHead,
  logHeadParts,
  logLevelClassForToken,
  logRankOf,
  logRanks,
  type LogHead,
  type LogRank,
} from './line-classes.ts';
import { own } from '../util/text.ts';
import { pushAll } from '../util/spread.ts';

/** One highlighted run; `scope` is omitted for unclassified text. */
export interface HighlightToken {
  readonly text: string;
  readonly scope?: MarxyTokenScope;
  /** Non-syntax class (log level weight); never carries a token hue. */
  readonly className?: string;
}

/** Per-source-line decoration applied on `.marxy-line` in the renderer. */
export interface HighlightLineMeta {
  readonly lineClass?: string;
}

/** `text` as runs: escape sequences (hidden by the page), the text they style with its tone and weight, and plain text. */
function escapeRuns(text: string): HighlightToken[] {
  if (text === '') return [];
  if (!text.includes('\u001b')) return [{ text }];
  return ansiRuns(text).map((r): HighlightToken => {
    if (r.esc !== null) return { text: r.text, className: ansiEscClasses(r.esc) };
    return r.style === null ? { text: r.text } : { text: r.text, className: ansiClasses(r.style) };
  });
}

/**
 * A log's runs: the timestamp and the level of a line that opens as a log's do, the brackets and spaces around them, and
 * the escape sequences anywhere. No grammar: a level word in the middle of a message is not a level, a number is not a
 * colour, and the same text is the same runs on any machine. Every line is whole in its runs, so the text is the text.
 * Fields between the timestamp and the level (a `[thread]`, a `logger.`) stay plain: only spacing is marked.
 */
function logTokens(line: string): HighlightToken[] {
  if (line === '') return [];
  const parts = logHeadParts(line);
  if (parts === null) return escapeRuns(line);
  const { head, columns } = parts;
  const runs: HighlightToken[] = [];
  const space = (text: string): void => {
    if (text !== '') runs.push({ text, className: LOG_SPACE_CLASS });
  };
  if (columns) {
    const [timeStart, timeEnd] = head.time!;
    const [levelStart, levelEnd] = head.level!;
    space(line.slice(0, timeStart));
    runs.push({ text: line.slice(timeStart, timeEnd), className: LOG_TIME_CLASS });
    const between = line.slice(timeEnd, levelStart);
    const lead = /^\]?[\s|,-]*/.exec(between)![0];
    const fields = between.slice(lead.length);
    // A `[` just before the level word opens it (`[INFO]`): it and the `]` after the word are spacing too.
    const opens = fields.endsWith('[');
    space(lead);
    if (fields.length > (opens ? 1 : 0)) pushAll(runs, escapeRuns(fields.slice(0, opens ? -1 : undefined)));
    if (opens) space('[');
    runs.push({ text: line.slice(levelStart, levelEnd), className: LOG_LEVEL_CLASS });
    const rest = line.slice(levelEnd);
    const after = /^\]?:?\s*(?:-\s+)?/.exec(rest)![0];
    space(after);
    pushAll(runs, escapeRuns(rest.slice(after.length)));
    return runs;
  }
  // The time or the level elsewhere in the line: each is marked where it stands. A time in brackets loses them, and what
  // follows a mark that opens the line is spacing, as the page sets that mark in a column of its own.
  const marks: { at: readonly [number, number]; className: string; time: boolean }[] = [];
  if (head.time) marks.push({ at: head.time, className: LOG_TIME_CLASS, time: true });
  if (head.level) marks.push({ at: head.level, className: head.level[0] === 0 ? LOG_LEVEL_CLASS : `${LOG_LEVEL_CLASS} ${LOG_INLINE_CLASS}`, time: false });
  marks.sort((a, b) => a.at[0] - b.at[0]);
  let at = 0;
  for (const m of marks) {
    const [start, end] = m.at;
    const bracketed = m.time && line[start - 1] === '[' && line[end] === ']';
    pushAll(runs, escapeRuns(line.slice(at, bracketed ? start - 1 : start)));
    if (bracketed) space('[');
    runs.push({ text: line.slice(start, end), className: m.className });
    at = end;
    const follow = bracketed ? /^\]\s*/ : start === 0 ? /^:?\s*/ : /^/;
    const taken = follow.exec(line.slice(at))![0];
    space(taken);
    at += taken.length;
  }
  pushAll(runs, escapeRuns(line.slice(at)));
  return runs;
}

/** One line of a log as `highlight` runs it, without waiting: a log has no grammar to load. */
export const logLineTokens = logTokens;

/**
 * A terminal session's runs: a prompt, its command, and the output as it is. No grammar: a word in output is not a
 * command, an escape is not interpreted (it is shown as ESC's picture by the page), and the runs are whole lines, so the text
 * is the text.
 */
export function terminalTokens(lines: readonly string[]): HighlightToken[][] {
  const read = terminalLines(lines);
  return lines.map((line, i) => {
    const r = read[i]!;
    if (line === '' || r.role === 'output') return line === '' ? [] : [{ text: line }];
    const runs: HighlightToken[] = [];
    if (r.commandAt > 0) runs.push({ text: line.slice(0, r.commandAt), className: TERM_PROMPT_CLASS });
    if (r.commandAt < line.length) runs.push({ text: line.slice(r.commandAt), className: TERM_COMMAND_CLASS });
    return runs;
  });
}

/** Whether Source colours `lang` from grammar runs: Read's own readings (a log, a session) are runs of classes, not roles. */
export function hasGrammarRuns(lang: string): boolean {
  return own(LANGUAGE_TO_GRAMMAR, lang) !== undefined && lang !== 'log' && !isTerminalLang(lang);
}

/** Line-level classes (diff tints) keyed by source line index. */
export function lineMetaForHighlight(
  lang: string,
  tokenLines: readonly (readonly HighlightToken[])[],
  /** `file`: the lines are pieces of a whole diff file, read hunk by hunk, not a fence's snippet. */
  opts?: { readonly file?: boolean; readonly diffStart?: DiffState },
): readonly HighlightLineMeta[] {
  const normalized = lang.trim().toLowerCase();
  if (opts?.file === true && normalized === 'diff') {
    return diffFileLineClasses(tokenLines.map((line) => line.map((t) => t.text).join('')), opts.diffStart).map((lineClass) => (lineClass ? { lineClass } : {}));
  }
  if (normalized === 'log') {
    // A line at ERROR or above, and the lines that continue it, carry the rule.
    const ranks = logRanks(tokenLines.map((line) => line.map((t) => t.text).join('')));
    return tokenLines.map((_, i) => (ranks[i] === 3 ? { lineClass: LOG_ERROR_LINE_CLASS } : {}));
  }
  if (isTerminalLang(normalized)) {
    // A command after the first line of the block opens with half a line above it.
    const read = terminalLines(tokenLines.map((line) => line.map((t) => t.text).join('')));
    return tokenLines.map((_, i) => (i > 0 && read[i]!.start ? { lineClass: TERM_START_CLASS } : {}));
  }
  return tokenLines.map((line) => {
    const text = line.map((t) => t.text).join('');
    const lineClass = lineClassForFenceLine(normalized, text);
    return lineClass ? { lineClass } : {};
  });
}

/** Plain source text from token runs (clipboard / copy-code-clean; no class markup). */
export function plainTextFromTokens(lines: readonly (readonly HighlightToken[])[]): string {
  return lines.map((line) => line.map((t) => t.text).join('')).join('\n');
}
