// Hard-wrap at 80 columns (J-03.1). Reflows the paragraphs of the text and nothing else: headings, tables, code and
// math blocks, raw HTML and front matter are not paragraphs, so their bytes pass through. Structure comes from the
// parser. A paragraph in a list item or a quote is wrapped inside its container: the continuation lines carry the
// indent (and `>` markers) the first line's prefix implies.
import type { Node } from '../contracts/ast.ts';
import { displayWidth } from '../operations/display-width.ts';
import { applyEdits, indexOf, parseText, walk } from './prose.ts';
import type { TransformDef } from './types.ts';

export const WRAP_COLUMNS = 80;

// Inline nodes whose bytes are never broken: a code span or math reads its spaces as content, a task box is `[ ]`.
const ATOMS = new Set(['code', 'mathInline', 'html', 'taskMarker']);

// A word that would change what the line is if it began one (a list or quote marker, a rule, a fence, a table row,
// an HTML block, a footnote definition) stays on the line before it. What follows the break is still the same words.
const BLOCK_START = /^(?:[-*_=+>:|]+|#{1,6}|\d{1,9}[.)]|[`~]{3,}|\$\$|<[A-Za-z/!?]|\[\^)/;

const ASCII = /^[\x20-\x7e]*$/;
const widthOf = (s: string): number => (ASCII.test(s) ? s.length : displayWidth(s));

/** Width of a line's leading bytes: a tab counts four. */
const prefixWidth = (s: string): number => widthOf(s.replace(/\t/g, '    '));

interface Piece { readonly word: string; readonly sep: string; readonly newline: boolean }

/** The words of `text` with the whitespace before each; an atom is one word. Container markers after a line break are part of the break. */
function pieces(text: string, atoms: readonly [number, number][]): Piece[] {
  const out: Piece[] = [];
  const space = /(?:[ \t]+|\n(?:[ \t]*>)*[ \t]*)+/y;
  let i = 0;
  let a = 0;
  let sep = '';
  let newline = false;
  while (i < text.length) {
    space.lastIndex = i;
    const m = space.exec(text);
    if (m) {
      sep = m[0];
      newline = sep.includes('\n');
      i += sep.length;
      continue;
    }
    let j = i;
    while (j < text.length) {
      while (a < atoms.length && atoms[a]![1] <= j) a++;
      if (a < atoms.length && atoms[a]![0] <= j) { j = atoms[a]![1]; continue; }
      if (text[j] === ' ' || text[j] === '\t' || text[j] === '\n') break;
      j++;
    }
    out.push({ word: text.slice(i, j), sep, newline });
    sep = '';
    newline = false;
    i = j;
  }
  return out;
}

const endsWithOddBackslashes = (w: string): boolean => /(?<!\\)(?:\\\\)*\\$/.test(w);

/** `text`'s words filled to `columns`; `start` is the column the first word begins at, `cont` the prefix of the other lines. */
function fill(text: string, atoms: readonly [number, number][], start: number, cont: string, columns: number): string {
  const contWidth = prefixWidth(cont);
  const out: string[] = [];
  let col = start;
  let first = true;
  let prev = '';
  for (const p of pieces(text, atoms)) {
    const w = widthOf(p.word);
    if (first) {
      out.push(p.word);
      col += w;
      first = false;
    } else {
      // The decision counts a run of spaces as one, so a line that was a break once is a break again (idempotence).
      const glued = BLOCK_START.test(p.word) || endsWithOddBackslashes(prev);
      if (glued || col + 1 + w <= columns) {
        const sep = p.newline || p.sep === '' ? ' ' : p.sep;
        out.push(sep, p.word);
        col += widthOf(sep) + w;
      } else {
        out.push('\n', cont, p.word);
        col = contWidth + w;
      }
    }
    prev = p.word;
  }
  return out.join('');
}

export const wrap80: TransformDef = {
  id: 'wrap-80',
  kind: 'edit',
  outsideCode: true,
  idempotent: true,
  run(lf) {
    const doc = parseText(lf);
    const index = indexOf(lf);
    const edits: { start: number; end: number; text: string }[] = [];
    walk(doc, (n: Node) => {
      if (n.type !== 'paragraph') return;
      // A hard break is a line ending that means something; the reflow would have to keep each one where it is. Left as written.
      const atoms: [number, number][] = [];
      let skip = false;
      const base = index.toIndex(n.src.start);
      walk(n, (c) => {
        if (c.type === 'hardBreak') skip = true;
        else if (ATOMS.has(c.type)) {
          const range: [number, number] = [index.toIndex(c.src.start) - base, index.toIndex(c.src.end) - base];
          // A line break inside an atom would carry the container's markers with it: wrapping this paragraph is not safe.
          if (lf.slice(base + range[0], base + range[1]).includes('\n')) skip = true;
          atoms.push(range);
        }
      });
      if (skip) return;
      const start = base;
      let end = index.toIndex(n.src.end);
      while (end > start && /[ \t\n]/.test(lf[end - 1]!)) end--;
      const text = lf.slice(start, end);
      if (!text.includes('\n') && widthOf(text) + prefixWidth(lf.slice(lf.lastIndexOf('\n', start - 1) + 1, start)) <= WRAP_COLUMNS) return;
      const lead = lf.slice(lf.lastIndexOf('\n', start - 1) + 1, start);
      const footnote = /\[\^[^\]\n]+\]:[ \t]*$/.exec(lead);
      const cont = footnote ? lead.slice(0, footnote.index).replace(/[^\s>]/g, ' ') + '    ' : lead.replace(/[^\s>]/g, ' ');
      const out = fill(text, atoms, prefixWidth(lead), cont, WRAP_COLUMNS);
      if (out !== text) edits.push({ start, end, text: out });
    });
    return edits.length === 0 ? lf : applyEdits(lf, edits);
  },
};
