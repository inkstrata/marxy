import { createBuffer, foldText, splice, sourceTextOf, encodeSourceText } from '../../../../../packages/core/src/buffer/index.ts';
let seed = 99; const rnd = (n) => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n;
const pieces = [[0x61], [0x0a], [0x0d, 0x0a], [0x0d], [0xc3, 0xa9], [0xf0, 0x9f, 0x98, 0x80], [0xff], [0x80], [0xe2, 0x82], [0xef, 0xbf, 0xbd], [0x20], [0xed, 0xa0, 0x80]];
const chars = ['a', '\n', '\r\n', '\r', 'é', '😀', '\uDC80', '\uDCFF', '�', ' ', '\uD800'];
const bad = new Map(); const note = (k, d) => { if (!bad.has(k)) bad.set(k, d); };
const hex = (b) => Buffer.from(b).toString('hex');
for (let it = 0; it < 40000; it++) {
  const bytes = []; if (rnd(5) === 0) bytes.push(0xef, 0xbb, 0xbf);
  for (let i = rnd(14); i > 0; i--) bytes.push(...pieces[rnd(pieces.length)]);
  const buf = createBuffer('/x', new Uint8Array(bytes));
  const { text } = sourceTextOf(buf); const skip = buf.bom ? 1 : 0;
  let t = text.slice(skip);
  // random edit in editor text; keep to the file's separator convention
  const a = rnd(t.length + 1), b = Math.min(t.length, a + rnd(4));
  let ins = ''; for (let i = rnd(3); i > 0; i--) ins += chars[rnd(chars.length)];
  if (buf.eol === 'crlf') ins = ins.replace(/\r\n|\r|\n/g, '\r\n'); else if (buf.eol === 'cr') ins = ins.replace(/\r\n|\n/g, '\r'); else if (buf.eol !== 'mixed') ins = ins.replace(/\r\n|\r/g, '\n');
  const next = t.slice(0, a) + ins + t.slice(b);
  let fold; try { fold = foldText(buf, next); } catch (e) { note('throw', { hex: hex(bytes), next: JSON.stringify(next), e: String(e).slice(0, 100) }); continue; }
  const got = fold ? splice(buf, fold.range, fold.replacement).bytes : buf.bytes;
  const want = new Uint8Array([...(buf.bom ? [0xef, 0xbb, 0xbf] : []), ...encodeSourceText(next)]);
  if (hex(got) !== hex(want)) note('mismatch:' + buf.eol, { hex: hex(bytes), next: JSON.stringify(next), got: hex(got), want: hex(want) });
}
for (const [k, d] of bad) console.log(k, JSON.stringify(d));
console.log('problems', bad.size);
