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
const W = (body) => '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + body + '</w:body></w:document>';
const CT = ['[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'];

const mk = (n) => zip([CT, ['word/document.xml', W('<w:p><w:r><w:t>hi</w:t></w:r></w:p>'.repeat(n))]], true);
export default async ({ boot, plantBytes }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  const race = (p, ms, l) => Promise.race([p, new Promise((r) => setTimeout(() => r('TIMEOUT ' + l), ms))]);
  const tryN = async (n, i) => {
    const path = '/h/b' + i + '.docx';
    await race(plantBytes(page, path, mk(n)), 10000, 'plant');
    await race(page.evaluate((p) => window.marxy.handle.open(p), path), 15000, 'open');
    await page.waitForTimeout(500);
    const t = await race(page.evaluate(() => (document.querySelector('main, .marxy-pane')?.innerText ?? '').includes('Maximum call stack')), 5000, 'text');
    return t === true;
  };
  let i = 0;
  for (const n of [20000, 60000, 100000, 125000, 150000]) console.log('docx', n, 'fails=', await tryN(n, i++));
  let lo = 20000, hi = 150000;
  while (hi - lo > 2000) { const m = (lo + hi) >> 1; if (await tryN(m, i++)) hi = m; else lo = m; }
  console.log('threshold between', lo, 'ok and', hi, 'fails');
  // a real long Markdown file: 300k paragraphs, and a 300k-row-ish list
  const md = Buffer.from('# Long\n\n' + 'word\n\n'.repeat(300000));
  await plantBytes(page, '/h/long.md', md);
  const t = Date.now();
  await race(page.evaluate(() => window.marxy.handle.open('/h/long.md')), 30000, 'open md');
  await page.waitForTimeout(3000);
  console.log('md', Date.now() - t, 'ms', JSON.stringify(await race(page.evaluate(() => (document.querySelector('main, .marxy-pane')?.innerText ?? '').slice(0, 150).replace(/\s+/g, ' ')), 8000, 'text')));
};
