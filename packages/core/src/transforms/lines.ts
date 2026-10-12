// The Lines group (J-03): whole-text line operations. They see the text with its own line endings (`raw`), and a
// line carries its ending with it when it moves, so a file that mixes LF, CRLF and CR keeps each line's own (ADR-0004).
// A blank line is a line like any other (sorted, de-duplicated, reversed) unless said.
import type { TransformDef } from './types.ts';

// A fixed locale: the order must not depend on the machine (the catalogue says "locale-aware", deterministic).
const collator = new Intl.Collator('en', { numeric: true });
const byNatural = (a: string, b: string): number => collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);

interface Line {
  readonly text: string;
  /** Its own ending; `''` only for the file's last line when it has none. */
  readonly eol: string;
}

function split(text: string): Line[] {
  const out: Line[] = [];
  const re = /([^\r\n]*)(\r\n|\r|\n|$)/gy;
  for (let m = re.exec(text); m !== null && m[0] !== ''; m = re.exec(text)) out.push({ text: m[1]!, eol: m[2]! });
  return out;
}

function firstEol(lines: readonly Line[]): string {
  return lines.find((l) => l.eol !== '')?.eol ?? '\n';
}

/**
 * Write `lines` back. Each keeps its own ending; if the input's last line had none, the output's last line has none
 * too, and a line that had none and now sits earlier takes the file's first ending.
 */
function join(lines: readonly Line[], original: readonly Line[]): string {
  if (lines.length === 0) return '';
  const endless = original[original.length - 1]!.eol === '';
  const fallback = firstEol(original);
  return lines
    .map((l, i) => {
      const last = i === lines.length - 1;
      if (endless && last) return l.text;
      return l.text + (l.eol === '' ? fallback : l.eol);
    })
    .join('');
}

function onLines(fn: (lines: Line[]) => Line[]): (text: string) => string {
  return (text) => {
    const lines = split(text);
    return join(fn(lines), lines);
  };
}

const unique = (lines: Line[]): Line[] => {
  const seen = new Set<string>();
  return lines.filter((l) => !seen.has(l.text) && seen.add(l.text));
};
const sorted = (lines: Line[]): Line[] => [...lines].sort((a, b) => byNatural(a.text, b.text));

export const sort: TransformDef = { id: 'sort', kind: 'edit', raw: true, idempotent: true, run: onLines(sorted) };
export const sortUnique: TransformDef = { id: 'sort-unique', kind: 'edit', raw: true, idempotent: true, run: onLines((l) => sorted(unique(l))) };
export const dedupe: TransformDef = { id: 'dedupe', kind: 'edit', raw: true, idempotent: true, run: onLines(unique) };
export const reverse: TransformDef = { id: 'reverse', kind: 'edit', raw: true, run: onLines((l) => [...l].reverse()) };

/** `1. ` prefixes on the non-blank lines, counting only those; an existing bullet is replaced, a blank line stays blank. */
export const number: TransformDef = {
  id: 'number',
  kind: 'edit',
  raw: true,
  run: onLines((lines) => {
    let n = 0;
    return lines.map((l) => (l.text.trim() === '' ? l : { ...l, text: `${++n}. ${l.text.replace(/^[ \t]*[-*+][ \t]+/, '')}` }));
  }),
};

export const unnumber: TransformDef = {
  id: 'unnumber',
  kind: 'edit',
  raw: true,
  // Not idempotent, by design: one marker comes off each line, the outer list first (`- 1. step` gives `1. step`).
  run: onLines((lines) => lines.map((l) => ({ ...l, text: l.text.replace(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?/, '') }))),
};

/** One line: the file's last ending, if it had one, is kept. */
export const joinLines: TransformDef = {
  id: 'join',
  kind: 'edit',
  raw: true,
  idempotent: true,
  run(text) {
    const lines = split(text);
    const kept = lines.map((l) => l.text.trim()).filter((l) => l !== '');
    return kept.length === 0 ? '' : kept.join(' ') + lines[lines.length - 1]!.eol;
  },
};

export const toBullets: TransformDef = {
  id: 'to-bullets',
  kind: 'edit',
  raw: true,
  run: onLines((lines) => lines.filter((l) => l.text.trim() !== '').map((l) => ({ ...l, text: `- ${l.text.trim()}` }))),
};

export const LINES: readonly TransformDef[] = [sort, sortUnique, dedupe, reverse, number, unnumber, joinLines, toBullets];
