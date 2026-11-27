import { bigFile } from '../gen.mjs';
import { createBuffer, splice } from '../../../../../packages/core/src/buffer/index.ts';
const med = (a) => a.sort((x, y) => x - y)[a.length >> 1];
for (const mode of ['valid', 'stray']) for (const bytes of [1e6, 2e6, 4e6]) {
  const { text } = await bigFile('txt', bytes);
  let u = new TextEncoder().encode(text);
  if (mode === 'stray') { u = u.slice(); u[100] = 0xe9; }
  let b = createBuffer('/a.txt', u);
  const ts = [];
  for (let i = 0; i < 7; i++) { const a = process.threadCpuUsage(); b = splice(b, { file: '/a.txt', start: 5000, end: 5000 }, new Uint8Array([120])); const c = process.threadCpuUsage(a); ts.push((c.user + c.system) / 1000); }
  console.log(mode, bytes, 'one-byte splice cpu ms median', med(ts).toFixed(0));
}
