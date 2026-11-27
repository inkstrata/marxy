import { bigFile } from '../gen.mjs';
import { COPY_TARGETS, copyAsFromText } from '../../../../../packages/core/src/operations/copy-as.ts';
const cpu = (f) => { const a = process.threadCpuUsage(); const s = performance.now(); const r = f(); const c = process.threadCpuUsage(a); return [Math.round((c.user + c.system) / 1000), Math.round(performance.now() - s), r]; };
for (const bytes of [5e5, 1e6, 2e6]) {
  const { text } = await bigFile('md-prose', bytes);
  const [c, w, input] = cpu(() => copyAsFromText(text, { path: '/a.md' }));
  const row = [];
  for (const id of ['slack', 'html', 'rich']) { const t = COPY_TARGETS.find((x) => x.id === id); if (!t) continue; const [c2, w2] = cpu(() => t.build(input)); row.push(`${id}:cpu${c2}/wall${w2}`); }
  console.log('md-prose', bytes, 'title/parse cpu', c, 'wall', w, row.join(' '));
}
