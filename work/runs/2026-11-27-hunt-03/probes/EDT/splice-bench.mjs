import { bigFile } from '../gen.mjs';
import { createBuffer, splice } from '../../../../../packages/core/src/buffer/index.ts';
const med = (a) => a.sort((x, y) => x - y)[a.length >> 1];
for (const kind of ['md-prose', 'txt']) for (const bytes of [1e6, 2e6, 4.9e6]) {
  const { text } = await bigFile(kind, bytes);
  let b = createBuffer('/a.md', new TextEncoder().encode(text));
  const ts = [];
  for (let i = 0; i < 12; i++) { const s = performance.now(); b = splice(b, { file: '/a.md', start: 5000, end: 5000 }, new Uint8Array([120])); ts.push(performance.now() - s); }
  console.log(kind, bytes, 'one-byte splice median ms', med(ts).toFixed(1), 'max', Math.max(...ts).toFixed(1));
}
console.log('heap MB', (process.memoryUsage().heapUsed / 1e6).toFixed(0));
