import { readRtfOffice, RTF_LIMITS } from '../../../../../packages/core/src/office/index.ts';
const enc = (s) => new TextEncoder().encode(s);
const lim = RTF_LIMITS.chars;
const MB = 1024 * 1024;
// 1 MB paragraphs, the text running to limit - 1, limit and limit + 1 characters, then LASTWORD in its own paragraph
for (const extra of [1, 100, 1000000, 3000000]) {
  const total = lim + extra;
  const paras = [];
  let left = total;
  let i = 0;
  while (left > 0) { const k = Math.min(left, MB); paras.push(`P${i++} ` + 'b'.repeat(Math.max(1, k - 3 - String(i - 1).length))); left -= k; }
  const r = readRtfOffice(enc('{\\rtf1\\ansi ' + paras.join('\\par ') + '\\par LASTWORD\\par}'));
  console.log('extra', extra, 'paras', paras.length, 'cut', JSON.stringify(r.doc.cut ?? []), 'md', r.markdown.length, 'hasLast', r.markdown.includes('LASTWORD'), 'P15', r.markdown.includes('P15 '), 'P16', r.markdown.includes('P16 '));
}
