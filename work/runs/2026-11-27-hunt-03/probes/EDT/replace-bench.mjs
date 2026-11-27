import { bigFile } from '../gen.mjs';
import { planReplace, spanOf, applyPlan } from '../../../../../apps/desktop/src/source/replace.ts';
const ms = (f) => { const s = performance.now(); const r = f(); return [Math.round(performance.now() - s), r]; };
for (const bytes of [1e6, 2e6, 4.9e6]) {
  const { text } = await bigFile('md-prose', bytes);
  for (const q of [{ search: 'the', replace: 'THE' }, { search: 'the', replace: 'THE', wholeWord: true }, { search: '(\\w+) (\\w+)', replace: '$2 $1', regexp: true }, { search: '\\s+$', replace: '', regexp: true }]) {
    const [t, plan] = ms(() => planReplace(text, q));
    if ('error' in plan) { console.log(bytes, JSON.stringify(q), plan.error); continue; }
    const [t2] = ms(() => spanOf(text, plan));
    console.log(bytes, JSON.stringify(q), 'plan ms', t, 'changes', plan.changes.length, 'span ms', t2);
  }
}
