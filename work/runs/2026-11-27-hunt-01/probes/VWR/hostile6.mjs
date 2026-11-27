import { deflateRawSync } from 'node:zlib';
const crcT = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc = (b) => { let c = ~0; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return ~c >>> 0; };
function zip(files, deflate = false) {
  const loc = [], cen = []; let off = 0;
  for (const [name, data] of files) {
    const n = Buffer.from(name); const d = Buffer.from(data); const p = deflate ? deflateRawSync(d) : d;
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(deflate ? 8 : 0, 8); h.writeUInt32LE(crc(d), 14); h.writeUInt32LE(p.length, 18); h.writeUInt32LE(d.length, 22); h.writeUInt16LE(n.length, 26);
    loc.push(h, n, p);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(deflate ? 8 : 0, 10); c.writeUInt32LE(crc(d), 16); c.writeUInt32LE(p.length, 20); c.writeUInt32LE(d.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(off, 42);
    cen.push(c, n); off += 30 + n.length + p.length;
  }
  const cd = Buffer.concat(cen); const e = Buffer.alloc(22); e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(files.length, 8); e.writeUInt16LE(files.length, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
  return Buffer.concat([...loc, cd, e]);
}
const png = (w, h) => { const b = Buffer.alloc(33 + 12); Buffer.from([0x89,0x50,0x4e,0x47,13,10,26,10]).copy(b); b.writeUInt32BE(13, 8); b.write('IHDR', 12); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); b[24] = 8; b[25] = 2; b.write('IEND', 37); return b; };
import { gzipSync } from 'node:zlib';
const tarHdr = (name, size) => { const h = Buffer.alloc(512); h.write(name); h.write('0000644\0', 100); h.write('0000000\0', 108); h.write('0000000\0', 116); h.write(size.toString(8).padStart(11, '0') + '\0', 124); h.write('00000000000\0', 136); h.write('        ', 148); h[156] = 0x30; h.write('ustar\0', 257); h.write('00', 263); let sum = 0; for (const b of h) sum += b; h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148); return h; };
const big = (n) => { const body = Buffer.alloc(n); const pad = Buffer.alloc((512 - (n % 512)) % 512); return Buffer.concat([tarHdr('big.bin', n), body, pad, Buffer.alloc(1024)]); };
const files = {
  '/h/b250.tar.gz': gzipSync(big(250 * 1024 * 1024), { level: 9 }),
  '/h/b900.tar.gz': gzipSync(big(900 * 1024 * 1024), { level: 9 }),
  '/h/bz.zip': zip([['a.txt', Buffer.alloc(200e6)]], true),
  '/h/bz.gz': gzipSync(Buffer.alloc(900e6), { level: 9 }),
};
export default async ({ boot, plantBytes, open }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror ' + e.message.slice(0, 150)));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console ' + m.text().slice(0, 150)); });
  const race = (p, ms, label) => Promise.race([p, new Promise((r) => setTimeout(() => r('TIMEOUT ' + label), ms))]);
  for (const [path, bytes] of Object.entries(files)) {
    const t = Date.now(); errs.length = 0;
    await race(plantBytes(page, path, bytes), 10000, 'plant');
    const r1 = await race(page.evaluate((p) => window.marxy.handle.open(p), path).then(() => 'opened'), 10000, 'open');
    await page.waitForTimeout(700);
    const r2 = await race(page.evaluate(() => document.title + '|' + (document.querySelector('section.marxy-pane [class*=marxy-]')?.className ?? '')).then(() => 'alive'), 10000, 'alive');
    const txt = await race(page.evaluate(() => (document.querySelector('main, .marxy-pane')?.innerText ?? '').slice(0, 90).replace(/\s+/g, ' ')), 5000, 'text');
    console.log(path.padEnd(18), r1, r2, (Date.now() - t) + 'ms', JSON.stringify(txt), errs.slice(0, 2).join(' ; '));
  }
};
