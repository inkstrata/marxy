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
const files = {
  '/h/deep.zip': zip([[Array.from({ length: 60 }, (_, i) => 'a' + i).join('/') + '/x.txt', 'hello']]),
  '/h/huge.png': png(60000, 60000),
  '/h/zero.png': png(0, 0),
  '/h/junk.pdf': Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF'),
  '/h/empty.pdf': Buffer.alloc(0),
  '/h/junk.ttf': Buffer.concat([Buffer.from([0,1,0,0,0xff,0xff,0,0,0,0,0,0]), Buffer.alloc(300, 0xff)]),
  '/h/junk.woff2': Buffer.concat([Buffer.from('wOF2'), Buffer.alloc(200, 0xff)]),
  '/h/junk.wav': Buffer.concat([Buffer.from('RIFF\xff\xff\xff\xffWAVEfmt '), Buffer.alloc(60, 0xff)]),
  '/h/empty.mp3': Buffer.alloc(0),
  '/h/junk.sqlite': Buffer.concat([Buffer.from('SQLite format 3\0'), Buffer.alloc(200, 0)]),
  '/h/junk.docx': zip([['word/document.xml', '<w:document xmlns:w="x"><w:body>' + '<w:p>'.repeat(30000) + '</w:body></w:document>'], ['[Content_Types].xml', '<Types/>']], true),
  '/h/bomb.docx': zip([['word/document.xml', '<w:document xmlns:w="x"><w:body><w:p><w:r><w:t>' + 'a'.repeat(40e6) + '</w:t></w:r></w:p></w:body></w:document>']], true),
  '/h/junk.xlsx': zip([['xl/workbook.xml', '<workbook/>']], true),
  '/h/junk.pptx': zip([['ppt/presentation.xml', '<p:presentation/>']], true),
  '/h/junk.msg': Buffer.concat([Buffer.from([0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1]), Buffer.alloc(600, 0xff)]),
  '/h/junk.ico': Buffer.from([0,0,1,0,255,255,0,0,0,0,0,0,0xff,0xff,0xff,0xff,0xff,0xff]),
  '/h/junk.gif': Buffer.from('GIF89a\xff\xff\xff\xff\x00'),
  '/h/junk.jpg': Buffer.from([0xff,0xd8,0xff,0xe1,0xff,0xff,0x45,0x78,0x69,0x66,0,0,0x49,0x49,0x2a,0,0xff,0xff,0xff,0x7f]),
  '/h/junk.tar': Buffer.alloc(512 * 4, 0x30),
  '/h/junk.gz': Buffer.from([0x1f,0x8b,8,0,0,0,0,0,0,3,1,2,3]),
  '/h/junk.rtf': Buffer.from('{\\rtf1' + '{\\pard '.repeat(100000)),
  '/h/junk.epub': zip([['mimetype', 'application/epub+zip']]),
  '/h/junk.ods': zip([['content.xml', '<office:document-content/>']], true),
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
