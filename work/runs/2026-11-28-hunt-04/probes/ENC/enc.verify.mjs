import { decodeBytes } from '../../../../../packages/core/src/encoding/decode.ts';
import { fileOffsetOf, bufferOffsetOf } from '../../../../../packages/core/src/encoding/byte-map.ts';
// ENC-01: 3000 lines of "é\n" in windows-1252
const n = 3000, b = new Uint8Array(n * 2);
for (let i = 0; i < n; i++) { b[2*i] = 0xe9; b[2*i+1] = 0x0a; }
const d = decodeBytes(b, 'windows-1252');
let wrong = 0, first = -1;
for (let i = 0; i < n; i++) {
  const f = 2 * i; const u = bufferOffsetOf(d.found, d.map, d.text, f);
  const back = fileOffsetOf(d.found, d.map, d.text, u);
  const expU = 3 * i; // é = 2 utf8 bytes + \n
  if (u !== expU || back !== f) { wrong++; if (first < 0) first = i; }
}
console.log('ENC-01 cp1252 lookups wrong', wrong, 'of', n, 'first line', first, 'text bytes', d.text.length);
// ENC-02: random-ish lead+ascii in shift_jis, small file
const sj = Uint8Array.from([0x61,0x81,0x20,0x62,0x88,0xea,0x63]);
const e = decodeBytes(sj, 'shift_jis');
console.log('ENC-02 space: fileOffsetOf(4) =', fileOffsetOf(e.found, e.map, e.text, 4), 'want 2; bufferOffsetOf(2) =', bufferOffsetOf(e.found, e.map, e.text, 2), 'want 4');
console.log('ENC-02 text', JSON.stringify(new TextDecoder().decode(e.text)));
