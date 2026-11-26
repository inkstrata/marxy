// Runs (the one role table): what Read paints as spans and Source applies as marks, in a form that crosses
// the worker boundary as one transferable buffer. A run is three numbers: its start and end in the text (UTF-16 code
// units, lines joined by one `\n`, so CodeMirror positions) and its role's index in RUN_ROLES.
import type { HighlightToken } from './index.ts';
import type { MarxyTokenScope } from './scopes.ts';
import { RENDERED_ROLES } from './roles.ts';

/** The roles a run can carry, in the role table's order: a run's third number indexes this. */
export const RUN_ROLES = RENDERED_ROLES as readonly MarxyTokenScope[];

const INDEX: ReadonlyMap<MarxyTokenScope, number> = new Map(RUN_ROLES.map((role, i) => [role, i]));

/**
 * The runs of token lines whose first line starts at `base`. Only a token with a role makes a run (a log's level word
 * carries a class Read paints, not a role); neighbours of one role are one run, which leaves every character's role as
 * it was.
 */
export function runsFromTokens(lines: readonly (readonly HighlightToken[])[], base = 0): Uint32Array {
  const out: number[] = [];
  let at = base;
  for (let li = 0; li < lines.length; li++) {
    if (li > 0) at += 1;
    for (const token of lines[li]!) {
      const end = at + token.text.length;
      const role = token.scope === undefined ? undefined : INDEX.get(token.scope);
      if (role !== undefined && token.text.length > 0) {
        const n = out.length;
        if (n > 0 && out[n - 1] === role && out[n - 2] === at) out[n - 2] = end;
        else out.push(at, end, role);
      }
      at = end;
    }
  }
  return Uint32Array.from(out);
}

/** Each run as `[from, role]`. */
export function* eachRun(runs: Uint32Array): Generator<readonly [number, number, MarxyTokenScope]> {
  for (let i = 0; i + 2 < runs.length; i += 3) yield [runs[i]!, runs[i + 1]!, RUN_ROLES[runs[i + 2]!]!];
}
