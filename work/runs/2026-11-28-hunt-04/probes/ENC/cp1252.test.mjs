import { decodeBytes } from '../../../../../packages/core/src/encoding/decode.ts';
import { fileOffsetOf, bufferOffsetOf } from '../../../../../packages/core/src/encoding/byte-map.ts';
// 5000 x "é\r\n"-ish lines in windows-1252 (byte E9 + CRLF), chosen label
const b = []; for (let i = 0; i < 2000; i++) b.push(0xe9, 0x0a);
const d = decodeBytes(Uint8Array.from(b), 'windows-1252');
console.log(d.found.label, d.map.kind, 'text bytes', d.text.length);
let wrong = 0, first = null;
for (let f = 0; f < b.length; f += 2) { // file offset of each é
  const u = bufferOffsetOf(d.found, d.map, d.text, f);
  const want = (f / 2) * 3; // é=2 bytes + CRLF=2
  if (u !== want) { wrong++; first ??= { file: f, got: u, want }; }
}
console.log('wrong é lookups', wrong, 'first', JSON.stringify(first));
