// Sort list items (E-09): a list's top-level items are reordered A to Z, each carrying its own bytes. The markers and the
// separators between items stay in their places, so the output is a permutation of the input's bytes: no line ending is
// created, none is lost, and a moved last item brings no newline to the end and takes none from it.
import type { Operation, OperationInput, OperationResult } from '../contracts/operation.ts';
import { itemSpans } from './list-item-spans.ts';
export { itemSpans, type ItemSpans } from './list-item-spans.ts';

/** A fixed locale, so the order does not depend on the reader's machine. Digits compare as numbers; case and accents do not break a tie. */
const COLLATOR = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

const FIRST_LINE = /^[^\r\n]*/;

/** Markers keep their place, so content that spans lines can only land under a marker that indents continuations the same way. */
function sameIndent(a: string, b: string): boolean {
  return a === b || (a.length === b.length && !/[\t\r\n]/.test(a + b));
}

function eligible(input: Pick<OperationInput, 'node' | 'range'>): boolean {
  const node = input.node;
  if (!node || node.type !== 'list' || node.children.length < 2) return false;
  return input.range.start === node.src.start && input.range.end === node.src.end;
}

/**
 * Sort list items. Pure. Output = M0 C(s0) S0 M1 C(s1) S1 ... Mn C(sn): marker `i` and separator `i` stay at position `i`,
 * and only the content (`[first child start, item end)`, which carries nested lists, task state and continuation lines) is
 * permuted. The key is the content's first line as written, compared with a fixed-locale natural collator; ties keep their order.
 * A list whose items would need re-indenting (a multi-line item moving under a marker of another width, as `9.` and `10.`, or text moving under an empty item's bare marker)
 * is left unchanged with a summary, because re-indenting is not a marker-only or content-only move.
 */
export const sortListItems: Operation = {
  id: 'sort-list-items',
  title: 'Sort list items',
  appliesTo: ['block'],
  canApply: eligible,
  run(input: OperationInput): OperationResult {
    const node = input.node;
    if (!node || node.type !== 'list') return { replacement: input.text };
    const text = input.text;
    const spans = itemSpans(node, input.range, text);
    if (!spans || spans.length < 2) return { replacement: text };
    const keyed = spans.map((s, i) => ({ i, key: FIRST_LINE.exec(text.slice(s.content.start, s.content.end))![0] }));
    keyed.sort((a, b) => COLLATOR.compare(a.key, b.key) || a.i - b.i);
    if (keyed.every((k, pos) => k.i === pos)) return { replacement: text };
    for (let pos = 0; pos < keyed.length; pos++) {
      const from = spans[keyed[pos]!.i]!;
      const to = spans[pos]!;
      if (from === to) continue;
      const moved = text.slice(from.content.start, from.content.end);
      const slot = text.slice(to.marker.start, to.marker.end);
      // Text cannot land under a bare marker (an empty item's `-`), and a multi-line item needs a marker that indents the same way.
      const needsFix = moved !== '' && !/[ \t\r\n]$/.test(slot);
      if (needsFix || (/[\r\n]/.test(moved) && !sameIndent(text.slice(from.marker.start, from.marker.end), slot))) {
        return { replacement: text, summary: 'Not changed: sorting would re-indent an item' };
      }
    }
    let out = text.slice(0, spans[0]!.marker.start);
    for (let pos = 0; pos < spans.length; pos++) {
      const slot = spans[pos]!;
      const src = spans[keyed[pos]!.i]!;
      out += text.slice(slot.marker.start, slot.marker.end) + text.slice(src.content.start, src.content.end);
      out += text.slice(slot.content.end, pos + 1 < spans.length ? spans[pos + 1]!.marker.start : text.length);
    }
    return { replacement: out, summary: `Sorted ${spans.length} items` };
  },
};
