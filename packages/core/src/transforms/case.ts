// The Case group (J-03). `lower`, `upper` and `slug` take the whole text, as the catalogue says; the two heading
// transforms rewrite only the words of ATX headings outside code.
import { applyEdits, atxHeadings, mapInline } from './prose.ts';
import type { TransformDef } from './types.ts';

// Bytes a case change must not reach: a link destination, an autolink or tag, a reference definition's target, a bare
// URL. (Code spans, fenced code, math and front matter are stepped around by `mapInline`.)
const LOCATOR = /(\]\([^)\n]*\))|(<[^<>\s]+>)|(^[ \t]{0,3}\[[^\]\n]+\]:[ \t]*\S+)|((?:https?:\/\/|www\.)[^\s<>)\]]+)/gm;

/** `f` on the prose text between locators, code and the other protected bytes. */
function proseOnly(lf: string, f: (text: string) => string): string {
  return mapInline(lf, (piece) => {
    let out = '';
    let at = 0;
    for (const m of piece.matchAll(LOCATOR)) {
      out += f(piece.slice(at, m.index)) + m[0];
      at = m.index + m[0].length;
    }
    return out + f(piece.slice(at));
  });
}

export const lower: TransformDef = { id: 'lower', kind: 'edit', outsideCode: true, idempotent: true, run: (lf) => proseOnly(lf, (t) => t.toLowerCase()) };
export const upper: TransformDef = { id: 'upper', kind: 'edit', outsideCode: true, idempotent: true, run: (lf) => proseOnly(lf, (t) => t.toUpperCase()) };

export const slug: TransformDef = {
  id: 'slug',
  kind: 'derive',
  idempotent: true,
  run: (lf) =>
    lf
      .normalize('NFKD')
      .replace(/\p{M}+/gu, '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s_-]/gu, '')
      .replace(/[\s_-]+/g, '-')
      .replace(/^-+|-+$/g, ''),
};

const MINOR = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'if', 'in', 'nor', 'of', 'on', 'or', 'per', 'so', 'the', 'to', 'up', 'via', 'vs', 'yet']);

/** A word the case rules leave alone: code, a path or URL, an identifier, an acronym or a mixed-case name (iOS, GitHub). */
const KEEP = /[`_\\/@<>=]|:\/\/|\]\(|\w\.\w|\p{Lu}.*\p{Lu}|\p{Ll}.*\p{Lu}|\d/u;

function words(text: string, f: (word: string, first: boolean, last: boolean, afterColon: boolean) => string): string {
  const parts = text.split(/(\s+)/);
  const idx = parts.map((p, i) => (i % 2 === 0 && p !== '' ? i : -1)).filter((i) => i >= 0);
  let afterColon = false;
  return parts
    .map((p, i) => {
      const at = idx.indexOf(i);
      if (at < 0) return p;
      const out = f(p, at === 0, at === idx.length - 1, afterColon);
      afterColon = /:$/.test(p);
      return out;
    })
    .join('');
}

const capital = (w: string): string => w.replace(/^(\P{L}*)(\p{L})(.*)$/su, (_m, pre: string, a: string, rest: string) => pre + a.toUpperCase() + rest.toLowerCase());

export function titleCase(text: string): string {
  return words(text, (w, first, last, afterColon) => {
    if (KEEP.test(w)) return w;
    const bare = w.toLowerCase().replace(/[^\p{L}]/gu, '');
    return MINOR.has(bare) && !first && !last && !afterColon ? w.toLowerCase() : capital(w);
  });
}

export function sentenceCase(text: string): string {
  return words(text, (w, first) => {
    if (KEEP.test(w)) return w;
    return first ? capital(w) : w.toLowerCase();
  });
}

function headingText(map: (text: string) => string): (lf: string) => string {
  return (lf) => {
    const edits: { start: number; end: number; text: string }[] = [];
    for (const { span } of atxHeadings(lf)) {
      const line = lf.slice(span.start, span.end).replace(/\n+$/, '');
      const m = /^(#{1,6}[ \t]+)(.*?)([ \t]+#+[ \t]*)?$/s.exec(line);
      if (!m) continue;
      const next = map(m[2]!);
      if (next !== m[2]) edits.push({ start: span.start + m[1]!.length, end: span.start + m[1]!.length + m[2]!.length, text: next });
    }
    return applyEdits(lf, edits);
  };
}

export const titleHeadings: TransformDef = { id: 'title-headings', kind: 'edit', outsideCode: true, idempotent: true, run: headingText(titleCase) };
export const sentenceHeadings: TransformDef = { id: 'sentence-headings', kind: 'edit', outsideCode: true, idempotent: true, run: headingText(sentenceCase) };

export const CASE: readonly TransformDef[] = [titleHeadings, sentenceHeadings, lower, upper, slug];
