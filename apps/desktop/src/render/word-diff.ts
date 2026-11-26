// The words that changed between paired lines of a diff (core's diff/words.ts), marked on lines the highlighter has
// already split. Each line's text is unchanged, so copy, find and the byte map read what they read before.
import { pairChangedLines } from '@marxy/core/src/diff/words.ts';
import { DIFF_LINE_ADD, DIFF_LINE_DEL } from '@marxy/core/src/highlight/line-classes.ts';

export interface DiffRow {
  readonly el: HTMLElement;
  readonly lineClass: string | undefined;
  /** The line's source text, its `+` or `-` first. */
  readonly source: string;
}

const PAIRED = 'marxy-diff-paired';

function paint(row: DiffRow, tokens: readonly string[], changed: readonly boolean[], cls: string): void {
  const marker = row.source[0]!;
  const first = row.el.firstChild;
  const markerNode = first instanceof HTMLElement && first.textContent === marker ? first : document.createTextNode(marker);
  const parts: Node[] = [markerNode];
  let plain = '';
  tokens.forEach((t, k) => {
    if (!changed[k]) {
      plain += t;
      return;
    }
    if (plain) parts.push(document.createTextNode(plain));
    plain = '';
    const word = document.createElement('span');
    word.className = cls;
    word.textContent = t;
    parts.push(word);
  });
  if (plain) parts.push(document.createTextNode(plain));
  row.el.replaceChildren(...parts);
  row.el.classList.add(PAIRED);
}

/** Marks changed words over `rows`, a code block's lines in order; a line cut short for length is left as it is. */
export function markWordChanges(rows: readonly DiffRow[]): void {
  const whole = (r: DiffRow): boolean => r.el.textContent === r.source;
  let k = 0;
  while (k < rows.length) {
    if (rows[k]!.lineClass !== DIFF_LINE_DEL) {
      k++;
      continue;
    }
    const dels: DiffRow[] = [];
    while (k < rows.length && rows[k]!.lineClass === DIFF_LINE_DEL) dels.push(rows[k++]!);
    const adds: DiffRow[] = [];
    while (k < rows.length && rows[k]!.lineClass === DIFF_LINE_ADD) adds.push(rows[k++]!);
    for (const pair of pairChangedLines(dels.map((r) => r.source.slice(1)), adds.map((r) => r.source.slice(1)))) {
      const del = dels[pair.del]!;
      const add = adds[pair.add]!;
      if (!whole(del) || !whole(add)) continue;
      paint(del, pair.delTokens, pair.delChanged, 'marxy-diff-del-word');
      paint(add, pair.addTokens, pair.addChanged, 'marxy-diff-add-word');
    }
  }
}
