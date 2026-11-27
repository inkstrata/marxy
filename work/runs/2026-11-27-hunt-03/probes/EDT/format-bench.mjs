import { wrapSelection } from '../../../../../apps/desktop/src/source/format-ops.ts';
for (const n of [20000, 60000, 130000, 300000]) {
  const text = 'a `b` '.repeat(n);   // one paragraph, n inline code runs, ~6n chars
  const s = performance.now();
  try { wrapSelection(text, { from: 0, to: text.length }, 'code'); console.log(n, 'runs', text.length, 'chars ok ms', Math.round(performance.now() - s)); }
  catch (e) { console.log(n, 'runs', text.length, 'chars', String(e).slice(0, 60), Math.round(performance.now() - s), 'ms'); }
}
