// Dedupe lines (E-05): inside a run of paragraphs and lists, a line that repeats an earlier one is removed and the first
// occurrence stays. The run arrives as a raw span (no node), the one shape `Applicability` 'span' exists for.
// Pure string to string: every kept line keeps its own ending, and the operation writes no line ending of its own, so LF, CRLF,
// lone CR and mixed files are preserved by construction.
import type { Node, Source } from '../contracts/ast.ts';
import type { Operation, OperationInput, OperationResult } from '../contracts/operation.ts';

/** Block types a duplicate line may live in. Anything else block-level (a fence, a table, a heading, raw HTML, math) holds content, not prose. */
const PROSE_BLOCKS: ReadonlySet<string> = new Set(['paragraph', 'list', 'listItem']);
const OTHER_BLOCKS: ReadonlySet<string> = new Set([
  'heading',
  'blockquote',
  'codeBlock',
  'htmlBlock',
  'thematicBreak',
  'table',
  'tableRow',
  'tableCell',
  'mathBlock',
  'footnoteDefinition',
  'frontmatter',
]);

function onlyProse(node: Node): boolean {
  if (OTHER_BLOCKS.has(node.type)) return false;
  return (node.children ?? []).every((child) => onlyProse(child as Node));
}

function overlaps(node: Node, range: Source): boolean {
  return node.src.start < range.end && node.src.end > range.start;
}

interface Line {
  readonly body: string;
  readonly eol: string;
}

function linesOf(text: string): Line[] {
  const out: Line[] = [];
  const re = /([^\r\n]*)(\r\n|\r|\n|$)/gy;
  while (re.lastIndex < text.length) {
    const m = re.exec(text)!;
    out.push({ body: m[1]!, eol: m[2]! });
  }
  return out;
}

/** Trailing spaces and tabs do not make a line different; leading ones do (indentation is structure). */
const key = (body: string): string => body.replace(/[ \t]+$/, '');

export const dedupeLines: Operation = {
  id: 'dedupe-lines',
  title: 'Dedupe lines',
  appliesTo: ['span'],
  canApply(input: Omit<OperationInput, 'text'>): boolean {
    if (input.node !== undefined || input.range.end <= input.range.start) return false;
    const touched = input.document.children.filter((c) => overlaps(c as Node, input.range));
    return touched.length > 0 && touched.every((c) => PROSE_BLOCKS.has(c.type) && onlyProse(c as Node));
  },
  run(input: OperationInput): OperationResult {
    const text = input.text;
    const lines = linesOf(text);
    const seen = new Set<string>();
    const drop = new Array<boolean>(lines.length).fill(false);
    let removed = 0;
    lines.forEach((line, i) => {
      const k = key(line.body);
      if (k === '') return;
      if (seen.has(k)) {
        drop[i] = true;
        removed++;
      } else seen.add(k);
    });
    if (removed === 0) return { replacement: text, summary: 'No duplicate lines' };

    // A paragraph whose every line was removed takes the blank lines after it too, or, at the end of the run, before it.
    const blank = (i: number): boolean => key(lines[i]!.body) === '';
    for (let i = 0; i < lines.length; ) {
      if (blank(i)) {
        i++;
        continue;
      }
      let j = i;
      while (j < lines.length && !blank(j)) j++;
      if (drop.slice(i, j).every(Boolean)) {
        let k = j;
        while (k < lines.length && blank(k)) drop[k++] = true;
        if (k === j) for (let b = i - 1; b >= 0 && blank(b); b--) drop[b] = true;
      }
      i = j;
    }

    let out = '';
    lines.forEach((line, i) => {
      if (!drop[i]) out += line.body + line.eol;
    });
    // The run did not end in a line ending, so neither does what is left of it (the one that remains belonged to a removed line).
    if (!/[\r\n]$/.test(text)) out = out.replace(/(\r\n|\r|\n)$/, '');
    return { replacement: out, summary: `Removed ${removed} duplicate ${removed === 1 ? 'line' : 'lines'}` };
  },
};
