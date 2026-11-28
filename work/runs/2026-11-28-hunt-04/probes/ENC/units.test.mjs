import { decodeBytes } from '../../../../../packages/core/src/encoding/decode.ts';
import { fileOffsetOf, bufferOffsetOf } from '../../../../../packages/core/src/encoding/byte-map.ts';
const enc = new TextEncoder(); let bad = 0;
function check(name, str, le, bom) {
  const u16 = []; if (bom) u16.push(0xfeff);
  for (let i = 0; i < str.length; i++) u16.push(str.charCodeAt(i));
  const bytes = new Uint8Array(u16.length * 2);
  u16.forEach((c, i) => { bytes[i*2] = le ? c & 255 : c >> 8; bytes[i*2+1] = le ? c >> 8 : c & 255; });
  const d = decodeBytes(bytes);
  let u = 0, prefix = '';
  for (const ch of [...str, '']) {
    const want = (bom ? 2 : 0) + prefix.length * 2;
    const got = fileOffsetOf(d.found, d.map, d.text, u);
    const back = bufferOffsetOf(d.found, d.map, d.text, want);
    if (got !== want || back !== u) { if (bad++ < 5) console.log(name, 'u', u, 'want', want, 'got', got, 'back', back); }
    prefix += ch; u += enc.encode(ch).length;
  }
  console.log(name, d.found.label, 'ok-so-far bad=', bad);
}
let s = ''; for (let i = 0; i < 3000; i++) s += i % 7 === 0 ? '😀' : i % 5 === 0 ? 'é' : i % 11 === 0 ? '日' : 'a';
check('le bom', s, true, true); check('be bom', s, false, true);
let t = ''; for (let i = 0; i < 4096; i++) t += '😀'; check('exact step', t, true, true);
