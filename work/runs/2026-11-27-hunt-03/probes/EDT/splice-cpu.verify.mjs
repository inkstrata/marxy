import { bigFile } from '../gen.mjs';
import { createBuffer, splice } from '../../../../../packages/core/src/buffer/index.ts';
import { wrapSelection } from '../../../../../apps/desktop/src/source/format-ops.ts';
const med = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
const cpu = () => { const u = process.threadCpuUsage(); return (u.user + u.system) / 1000; };
for (const kind of ['md-prose', 'txt']) for (const bytes of [1e6, 2e6, 4.9e6]) {
  const { text } = await bigFile(kind, bytes);
  let b = createBuffer('/a.md', new TextEncoder().encode(text));
  const ts = [];
  for (let i = 0; i < 9; i++) { const c = cpu(); b = splice(b, { file: '/a.md', start: 5000, end: 5000 }, new Uint8Array([120])); ts.push(cpu() - c); }
  console.log(kind, bytes, 'splice cpu ms median', med(ts).toFixed(1));
}
for (const n of [10000, 20000, 40000, 80000, 120000, 130000, 200000]) {
  const t = 'a `b` '.repeat(n); const c = cpu();
  try { wrapSelection(t, { from: 0, to: t.length }, 'code'); console.log('wrap', n, 'ok cpu ms', (cpu() - c).toFixed(0)); }
  catch (e) { console.log('wrap', n, String(e).slice(0, 50), (cpu() - c).toFixed(0)); }
}
