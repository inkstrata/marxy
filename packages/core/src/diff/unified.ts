// Unified diff in git's shape, over source lines that keep their terminators (see lines.ts).
// Lines are split on \n only, as git does, so a CR stays part of its line's text and the output is
// byte-exact: `-a\r` is the line `a\r\n`. A last line with no terminator is followed by
// `\ No newline at end of file`.

import { diffLinesDetailed, type DiffLinesOptions } from './lines.ts';

export interface UnifiedOptions extends DiffLinesOptions {
  /** Lines of context around each change. Default 3. */
  readonly context?: number;
  readonly aLabel?: string;
  readonly bLabel?: string;
}

export interface UnifiedDiff {
  readonly text: string;
  readonly added: number;
  readonly removed: number;
  /** Some line has the same text on both sides and a different line ending (CRLF <-> LF, newline added or dropped). */
  readonly eolChanged: boolean;
  /** False when the work budget ran out and part of the diff is a coarse replace (still correct, not minimal). */
  readonly exact: boolean;
}

const NO_NEWLINE = '\\ No newline at end of file\n';

/** null when either side has more lines than `maxLines`. Identical inputs give `text === ''`. */
export function unifiedDiff(a: string, b: string, opts: UnifiedOptions = {}): UnifiedDiff | null {
  const diff = diffLinesDetailed(a, b, 'lf', opts);
  if (!diff) return null;
  const { ops, aLines, bLines } = diff;
  const context = Math.max(0, opts.context ?? 3);
  let added = 0;
  let removed = 0;
  for (const op of ops) {
    if (op.kind === 'delete') removed += op.aEnd - op.aStart;
    else if (op.kind === 'insert') added += op.bEnd - op.bStart;
  }
  const base = { added, removed, eolChanged: diff.eolChanged, exact: diff.exact };
  if (added === 0 && removed === 0) return { text: '', ...base };

  const line = (prefix: string, s: string): string => (s.endsWith('\n') ? prefix + s : `${prefix}${s}\n${NO_NEWLINE}`);
  let out = `--- ${opts.aLabel ?? 'a'}\n+++ ${opts.bLabel ?? 'b'}\n`;

  // Group ops into hunks: changes closer together than 2 * context equal lines share a hunk.
  let k = 0;
  while (k < ops.length) {
    while (k < ops.length && (ops[k] as (typeof ops)[number]).kind === 'equal') k++;
    if (k >= ops.length) break;
    let end = k;
    for (let m = k + 1; m < ops.length; m++) {
      const op = ops[m] as (typeof ops)[number];
      if (op.kind === 'equal') {
        const isLast = m === ops.length - 1;
        if (isLast || op.aEnd - op.aStart > 2 * context) break;
      } else end = m;
    }
    const first = ops[k] as (typeof ops)[number];
    const last = ops[end] as (typeof ops)[number];
    const prev = k > 0 ? (ops[k - 1] as (typeof ops)[number]) : undefined;
    const next = end + 1 < ops.length ? (ops[end + 1] as (typeof ops)[number]) : undefined;
    const lead = prev ? Math.min(context, prev.aEnd - prev.aStart) : 0;
    const trail = next ? Math.min(context, next.aEnd - next.aStart) : 0;
    const aFrom = first.aStart - lead;
    const bFrom = first.bStart - lead;
    const aTo = last.aEnd + trail;
    const bTo = last.bEnd + trail;
    const aCount = aTo - aFrom;
    const bCount = bTo - bFrom;
    out += `@@ -${aCount === 0 ? aFrom : aFrom + 1},${aCount} +${bCount === 0 ? bFrom : bFrom + 1},${bCount} @@\n`;
    for (let i = aFrom; i < first.aStart; i++) out += line(' ', aLines[i] as string);
    for (let m = k; m <= end; m++) {
      const op = ops[m] as (typeof ops)[number];
      if (op.kind === 'equal') for (let i = op.aStart; i < op.aEnd; i++) out += line(' ', aLines[i] as string);
      else if (op.kind === 'delete') for (let i = op.aStart; i < op.aEnd; i++) out += line('-', aLines[i] as string);
      else for (let j = op.bStart; j < op.bEnd; j++) out += line('+', bLines[j] as string);
    }
    for (let i = last.aEnd; i < aTo; i++) out += line(' ', aLines[i] as string);
    k = end + 1;
  }
  return { text: out, ...base };
}
