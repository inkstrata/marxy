// Diff line classes and log-level detection for fenced code (MARXY-235, ADR-0036).

export const DIFF_LINE_ADD = 'marxy-diff-add';
export const DIFF_LINE_DEL = 'marxy-diff-del';
export const LOG_LEVEL_CLASS = 'marxy-log-level';

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
