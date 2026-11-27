import { bigFile } from '../gen.mjs';
import { createBuffer, splice } from '../../../../../packages/core/src/buffer/index.ts';
const med = (a) => a.sort((x, y) => x - y)[a.length >> 1];
const mk = (kind, bytes, mode) => { 
  return bigFile(kind, bytes).then(({ text }) => {
    let u = new TextEncoder().encode(text.replace('the', 'thé'));
    if (mode === 'stray') { u = u.slice(); u[100] = 0xe9; }
    return u; }); };
for (const mode of ['ascii', 'nonascii', 'stray']) for (const bytes of [1e6, 2e6, 4e6, 4.9e6]) {
  const u = await mk('txt', bytes, mode === 'ascii' ? 'a' : mode);
  const src = mode === 'ascii' ? new TextEncoder().encode(new TextDecoder().decode(u).replace('thé', 'the')) : u;
  let b = createBuffer('/a.txt', src);
  const ts = [];
  for (let i = 0; i < 9; i++) { const s = performance.now(); b = splice(b, { file: '/a.txt', start: 5000, end: 5000 }, new Uint8Array([120])); ts.push(performance.now() - s); }
  console.log(mode, bytes, 'one-byte splice median ms', med(ts).toFixed(1), 'heap MB', (process.memoryUsage().heapUsed / 1e6).toFixed(0));
}
