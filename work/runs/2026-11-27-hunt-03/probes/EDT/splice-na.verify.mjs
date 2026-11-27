import { bigFile } from '../gen.mjs';
import { createBuffer, splice } from '../../../../../packages/core/src/buffer/index.ts';
const cpu = () => { const u = process.threadCpuUsage(); return (u.user + u.system) / 1000; };
for (const bytes of [1e6, 2e6, 4.9e6]) {
  const { text } = await bigFile('md-prose', bytes);
  let b = createBuffer('/a.md', new TextEncoder().encode(text + '\né\n'));
  const ts = [];
  for (let i = 0; i < 7; i++) { const c = cpu(); b = splice(b, { file: '/a.md', start: 5000, end: 5000 }, new Uint8Array([120])); ts.push(cpu() - c); }
  ts.sort((a,b)=>a-b);
  console.log('non-ascii', bytes, 'splice cpu ms median', ts[3].toFixed(1), 'offsets', b.offsets?.constructor?.name);
}
