import { readRtfOffice, RTF_LIMITS } from '../../../../../packages/core/src/office/index.ts';
const enc = (s) => new TextEncoder().encode(s);
const show = (label, s) => {
  try {
    const r = readRtfOffice(enc(s));
    console.log(label, 'cut', JSON.stringify(r.doc.cut ?? []), 'md', r.markdown.length, 'imgs', r.doc.images.length, 'tail', JSON.stringify(r.markdown.slice(-40)));
  } catch (e) {
    console.log(label, 'THROWS', String(e).slice(0, 120));
  }
};
for (const n of [9999, 10000, 10001, 10002]) show('objects ' + n, '{\\rtf1\\ansi ' + '{\\pict\\pngblip 89504e47}'.repeat(n) + ' END}');
for (const d of [255, 256, 257, 258]) show('depth ' + d, '{\\rtf1\\ansi ' + '{'.repeat(d - 2) + 'DEEP' + '}'.repeat(d - 2) + ' END}');
const lim = RTF_LIMITS.chars;
for (const n of [lim - 10, lim, lim + 1]) show('chars ' + n, '{\\rtf1\\ansi ' + 'a'.repeat(n - 4) + ' END}');
