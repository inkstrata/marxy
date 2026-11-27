import { bigFile } from '../gen.mjs';
import { COPY_TARGETS, copyAsFromText } from '../../../../../packages/core/src/operations/copy-as.ts';
const ms = (f) => { const s = performance.now(); const r = f(); return [Math.round(performance.now() - s), r]; };
for (const kind of ['md-prose', 'md-technical']) for (const bytes of [1e6, 2e6, 4.9e6]) {
  const { text } = await bigFile(kind, bytes);
  const [ti, input] = ms(() => copyAsFromText(text, { path: '/a.md' }));
  const row = [];
  for (const t of COPY_TARGETS) { try { const [d, o] = ms(() => t.build(input)); row.push(`${t.id}:${d}ms/${(o.html?.length ?? o.text.length) >> 10}K`); } catch (e) { row.push(`${t.id}:ERR ${String(e).slice(0, 40)}`); } }
  console.log(kind, bytes, 'input ms', ti, row.join(' '));
}
