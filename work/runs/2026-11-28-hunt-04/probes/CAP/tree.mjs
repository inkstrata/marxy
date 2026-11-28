import { readingOf } from '../../../../../packages/core/src/reading/index.ts';
const enc = (s) => new TextEncoder().encode(s);
const opens = (h) => (h.match(/<details class="marxy-tree-branch" open/g) ?? []).length;
const all = (h) => (h.match(/<details class="marxy-tree-branch"/g) ?? []).length;
// a list of maps, each with a nested map: 2 branches per item
for (const n of [100, 149, 150, 151, 400]) {
  const j = JSON.stringify({ items: Array.from({ length: n }, (_, i) => ({ id: i, meta: { a: 1, b: [1, 2] } })) });
  const r = readingOf('/d/a.json', enc(j));
  console.log('items', n, 'branches', all(r.html), 'open', opens(r.html), 'head', (/marxy-reading-head">(.*?)<\/span>/.exec(r.html)?.[1] ?? '').replace(/<[^>]+>/g, ''), 'foldNote', /folded|closed|click/i.test(r.html.replace(/<[^>]+>/g, ' ')));
}
// an XML tree and a stop inside a folded branch
const big = JSON.stringify({ a: Array.from({ length: 400 }, (_, i) => ({ k: i, v: { x: 1 } })), z: Array.from({ length: 6000 }, (_, i) => i) });
const r = readingOf('/d/b.json', enc(big));
console.log('big', 'branches', all(r.html), 'open', opens(r.html), 'stops', (r.html.match(/marxy-tree-stop/g) ?? []).length);
const stop = r.html.indexOf('marxy-tree-stop');
const before = r.html.lastIndexOf('<details', stop);
console.log('stop branch open?', r.html.slice(before, before + 60));
