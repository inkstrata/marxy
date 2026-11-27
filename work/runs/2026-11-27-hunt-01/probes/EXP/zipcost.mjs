import { zipStore } from '/Users/<user>/Dev/marxy-wt/hunt-01/apps/desktop/src/export/zip.ts';
const big = new Uint8Array(200 * 1024 * 1024);
for (let i = 0; i < big.length; i += 4096) big[i] = i & 255;
const t = performance.now();
const z = zipStore([{ path: 'a/big.bin', bytes: big }]);
console.log('zipStore of 200 MB: ', Math.round(performance.now() - t), 'ms, synchronous; output', z.length);
