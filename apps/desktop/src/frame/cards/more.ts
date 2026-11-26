// The Comparison card, hosted in Metadata while a comparison the reader asked for is open.
import { comparisonOf } from '../../commands/compare.ts';
import { el, factRow } from '../dom.ts';
import type { CardDef } from './types.ts';

/** The Comparison card: both sides of a comparison the reader asked for, that nothing of it is kept, and its acts. */
export const comparison: CardDef = {
  id: 'comparison',
  title: () => 'Comparison',
  relevant: (ctx) => comparisonOf(ctx.path) !== null,
  render(body, ctx) {
    const c = comparisonOf(ctx.path);
    if (!c) return;
    body.append(factRow(c.before.label, c.before.detail), factRow(c.after.label, c.after.detail), factRow('kept', 'nothing: made when you asked'));
    if (c.actions.length === 0) return;
    const row = el('div', 'marxy-brow');
    for (const act of c.actions) {
      const btn = el('button', 'marxy-btn', act.title);
      btn.type = 'button';
      btn.addEventListener('click', () => act.run(btn));
      row.append(btn);
    }
    body.append(row);
  },
};
