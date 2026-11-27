import { contentHash } from '../../../../../packages/core/src/buffer/buffer.ts';
for (const mb of [1, 2, 4.9]) { const u = new Uint8Array(mb * 1e6).map((_, i) => i * 31 & 255); contentHash(u); const s = performance.now(); contentHash(u); console.log(mb, 'MB contentHash ms', (performance.now() - s).toFixed(0)); }
