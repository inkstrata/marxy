// The Lines group (J-03): whole-text line operations. A final line break is the file's, not a line, so it is set
// aside and put back; a blank line is a line like any other (sorted, de-duplicated, reversed) unless said.
import { joinLinesLf, splitLinesLf } from './prose.ts';
import type { TransformDef } from './types.ts';

// A fixed locale: the order must not depend on the machine (the catalogue says "locale-aware", deterministic).
const collator = new Intl.Collator('en', { numeric: true });
const byNatural = (a: string, b: string): number => collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);

function onLines(fn: (lines: string[]) => string[]): (lf: string) => string {
  return (lf) => {
    const { lines, finalEol } = splitLinesLf(lf);
    return joinLinesLf(fn(lines), finalEol);
  };
}

const unique = (lines: readonly string[]): string[] => [...new Set(lines)];

export const sort: TransformDef = { id: 'sort', kind: 'edit', idempotent: true, run: onLines((l) => [...l].sort(byNatural)) };
export const sortUnique: TransformDef = { id: 'sort-unique', kind: 'edit', idempotent: true, run: onLines((l) => unique(l).sort(byNatural)) };
export const dedupe: TransformDef = { id: 'dedupe', kind: 'edit', idempotent: true, run: onLines(unique) };
export const reverse: TransformDef = { id: 'reverse', kind: 'edit', run: onLines((l) => [...l].reverse()) };

/** `1. ` prefixes on the non-blank lines, counting only those; an existing bullet is replaced, a blank line stays blank. */
export const number: TransformDef = {
  id: 'number',
  kind: 'edit',
  run: onLines((lines) => {
    let n = 0;
    return lines.map((l) => (l.trim() === '' ? l : `${++n}. ${l.replace(/^[ \t]*[-*+][ \t]+/, '')}`));
  }),
};

export const unnumber: TransformDef = {
  id: 'unnumber',
  kind: 'edit',
  idempotent: true,
  run: (lf) => lf.replace(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?/gm, ''),
};

export const join: TransformDef = {
  id: 'join',
  kind: 'edit',
  idempotent: true,
  run(lf) {
    const { lines, finalEol } = splitLinesLf(lf);
    const kept = lines.map((l) => l.trim()).filter((l) => l !== '');
    return kept.length === 0 ? '' : kept.join(' ') + (finalEol ? '\n' : '');
  },
};

export const toBullets: TransformDef = {
  id: 'to-bullets',
  kind: 'edit',
  run(lf) {
    const { lines, finalEol } = splitLinesLf(lf);
    return joinLinesLf(lines.filter((l) => l.trim() !== '').map((l) => `- ${l.trim()}`), finalEol);
  },
};

export const LINES: readonly TransformDef[] = [sort, sortUnique, dedupe, reverse, number, unnumber, join, toBullets];
