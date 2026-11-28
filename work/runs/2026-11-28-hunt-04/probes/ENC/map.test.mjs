import { decodeBytes } from '../../../../../packages/core/src/encoding/decode.ts';
import { fileOffsetOf, bufferOffsetOf } from '../../../../../packages/core/src/encoding/byte-map.ts';
const td = new TextDecoder();
function show(name, bytes, label) {
  const d = decodeBytes(Uint8Array.from(bytes), label);
  const t = td.decode(d.text);
  console.log(name, d.found.label, JSON.stringify(t), 'map', d.map.kind);
  // for each char boundary in text, print utf8 offset -> file offset
  let u = 0; const out = [];
  for (const ch of t) { out.push(`${JSON.stringify(ch)}@${u}->${fileOffsetOf(d.found, d.map, d.text, u)}`); u += new TextEncoder().encode(ch).length; }
  out.push(`end@${u}->${fileOffsetOf(d.found, d.map, d.text, u)}`);
  console.log('  ', out.join(' '));
}
// SJIS: lead 0x81 then space; then 'a'; then kanji
show('sjis lead+ascii', [0x61, 0x81, 0x20, 0x62, 0x88, 0xea, 0x63], 'shift_jis');
show('sjis lead+lead', [0x61, 0x81, 0x81, 0x40, 0x62], 'shift_jis');
show('sjis trailing lead', [0x61, 0x88, 0xea, 0x81], 'shift_jis');
show('gbk', [0x61, 0xb0, 0xa1, 0x62, 0x81, 0x20, 0x63, 0x81, 0x30, 0x81, 0x30, 0x64], 'gbk');
show('sjis kana', [0xb1, 0xb2, 0x61, 0x82, 0xa0], 'shift_jis');
