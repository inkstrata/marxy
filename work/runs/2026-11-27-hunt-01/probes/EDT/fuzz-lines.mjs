import * as L from '../../../../../packages/core/src/source-edit/lines.ts';
import * as S from '../../../../../packages/core/src/source-edit/select.ts';
let seed = 12345; const rnd = (n) => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n;
const alphabet = ['a', 'b', ' ', '\n', '\n', '- ', '> ', '[x] ', '1. ', '\r', '\t', '*', '#'];
const bad = new Map();
const note = (k, d) => { if (!bad.has(k)) bad.set(k, d); };
for (let it = 0; it < 30000; it++) {
  let text = ''; for (let i = rnd(30); i > 0; i--) text += alphabet[rnd(alphabet.length)];
  const ranges = []; for (let r = 1 + rnd(3); r > 0; r--) { const a = rnd(text.length + 1), b = rnd(text.length + 1); ranges.push({ from: Math.min(a, b), to: Math.max(a, b) }); }
  for (const [name, fn] of [['join', L.joinLines], ['delete', L.deleteLines], ['dupUp', (t, r) => L.duplicateLines(t, r, 'up')], ['dupDown', (t, r) => L.duplicateLines(t, r, 'down')], ['sort', L.sortLines], ['task', L.toggleTaskLines], ['quote', L.toggleQuoteLines]]) {
    let out; try { out = fn(text, ranges); } catch (e) { note(name + ':throw', { text, ranges, e: String(e) }); continue; }
    if (!out) continue;
    let prev = -1;
    for (const c of out.changes) { if (c.from < prev || c.to < c.from || c.to > text.length) note(name + ':overlap', { text, ranges, changes: out.changes }); prev = c.to; }
    if (out.selection) { let nt = ''; let at = 0; for (const c of out.changes) { nt += text.slice(at, c.from) + c.insert; at = c.to; } nt += text.slice(at); for (const s of out.selection) if (s.from < 0 || s.to > nt.length || s.from > s.to) note(name + ':selection', { text, ranges, out, nt }); }
  }
  for (const r of ranges) { try { S.expandSelection(text, r, 'markdown'); S.selectBlock(text, r); S.selectSection(text, r); } catch (e) { note('select:throw', { text, r, e: String(e) }); } }
}
for (const [k, d] of bad) console.log(k, JSON.stringify(d));
console.log('done; distinct problems:', bad.size);
