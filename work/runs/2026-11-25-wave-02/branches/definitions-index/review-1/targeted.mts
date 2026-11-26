// Hand-written cases aimed at the weak points. Each pair is before -> after; checks equality, reports the path.
import { pathToFileURL } from 'node:url';
const WT = process.env.WT ?? 'C:/Dev/reader/worktrees/definitions-index';
const base = pathToFileURL(`${WT}/packages/core/src/parse/`).href;
const { parseMarkdown } = await import(`${base}parse.ts`);
const { reparseMarkdown, lastReparse } = await import(`${base}reparse.ts`);
const enc = new TextEncoder();
const PAD = 'padding paragraph.\n\n'.repeat(4);
const cases: [string, string, string][] = [];
const add = (name: string, a: string, b: string) => cases.push([name, a, b]);
const wrap = (mid: string) => `${PAD}${mid}\n\n${PAD}`;
// A. container definitions untouched by the edit
add('quote def, edit beside', wrap('> [a]: /u\n> text [a]'), wrap('> [a]: /u\n> text [a] more'));
add('list def, edit beside', wrap('- [a]: /u\n- text [a]'), wrap('- [a]: /u\n- text [a] more'));
add('def in quote, ref outside edited', `[a]: /one\n\n> [A]: /two\n\n${PAD}See [a].\n`, `[a]: /one\n\n> [A]: /two\n\n${PAD}See [a] again.\n`);
// B. duplicate labels, order unchanged / changed
add('dup swap', `[a]: /1\n\n[a]: /2\n\nSee [a].\n\n${PAD}`, `[a]: /2\n\n[a]: /1\n\nSee [a].\n\n${PAD}`);
add('dup first removed', `[a]: /1\n\n${PAD}[a]: /2\n\nSee [a].\n`, `${PAD}[a]: /2\n\nSee [a].\n`);
add('dup case', `[a]: /1\n\n${PAD}[A]: /2\n\nSee [a][].\n`, `[a]: /1\n\n${PAD}[A]: /2\n\nSee [a][] x.\n`);
// C. label normalisation
for (const [ref, defn] of [['[A]', '[a]'], ['[a  b]', '[a b]'], ['[ß]', '[SS]'], ['[ẞ]', '[ss]'], ['[İ]', '[i̇]'], ['[a\\]]', '[a\\]]'], ['[a\\*]', '[a*]']] as const)
  add(`norm ${ref} ${defn}`, `${PAD}${defn}: /u\n\n${PAD}x ${ref} y\n\n${PAD}`, `${PAD}${defn}: /u\n\n${PAD}x ${ref} yy\n\n${PAD}`);
// D. refs only earlier / only later
add('ref before def', `See [a].\n\n${PAD}[a]: /u\n`, `See [a] x.\n\n${PAD}[a]: /u\n`);
add('ref after def', `[a]: /u\n\n${PAD}See [a].\n`, `[a]: /u\n\n${PAD}See [a] x.\n`);
add('collapsed/full/image', `[a]: /u\n\n${PAD}![a] [a][] [x][a] ![x][a]\n\n${PAD}`, `[a]: /u\n\n${PAD}![a] [a][] [x][a] ![x][a]!\n\n${PAD}`);
// E. footnotes
add('fn ref, def outside', `[^1]: note\n\n${PAD}See[^1].\n\n${PAD}`, `[^1]: note\n\n${PAD}See[^1] x.\n\n${PAD}`);
add('fn multi body edit', `${PAD}[^1]: one\n\n    two\n\n    three\n\n${PAD}See[^1].`, `${PAD}[^1]: one\n\n    two x\n\n    three\n\n${PAD}See[^1].`);
add('fn ref in fn def', `${PAD}[^1]: one [^2]\n\n[^2]: two [^1]\n\n${PAD}`, `${PAD}[^1]: one [^2] x\n\n[^2]: two [^1]\n\n${PAD}`);
add('fn image-form', `[^1]: n\n\n${PAD}![^1]\n\n${PAD}`, `[^1]: n\n\n${PAD}![^1] y\n\n${PAD}`);
add('fn label case', `[^A]: n\n\n${PAD}x[^a]\n\n${PAD}`, `[^A]: n\n\n${PAD}x[^a]!\n\n${PAD}`);
// F. region begins/ends at a definition
add('edit before def', `${PAD}text\n\n[a]: /u\n\n${PAD}[a]`, `${PAD}text!\n\n[a]: /u\n\n${PAD}[a]`);
add('edit after def', `${PAD}[a]: /u\n\ntext\n\n${PAD}[a]`, `${PAD}[a]: /u\n\ntext!\n\n${PAD}[a]`);
add('def directly after para', `${PAD}text\n[a]: /u\n\n${PAD}[a]`, `${PAD}text\n\n[a]: /u\n\n${PAD}[a]`);
add('blank removed above def', `${PAD}text\n\n[a]: /u\n\n${PAD}[a]`, `${PAD}text\n[a]: /u\n\n${PAD}[a]`);
add('def then para no blank', `${PAD}[a]: /u\ntext [a]\n\n${PAD}`, `${PAD}[a]: /u\ntext [a]!\n\n${PAD}`);
add('def then blank removed', `${PAD}[a]: /u\n\ntext [a]\n\n${PAD}`, `${PAD}[a]: /u\ntext [a]\n\n${PAD}`);
// G. setext / table / titles
add('setext after def', `${PAD}[a]: /u\nHead\n===\n\n${PAD}[a]`, `${PAD}[a]: /u\nHead!\n===\n\n${PAD}[a]`);
add('def setext underline', `${PAD}[a]: /u\n===\n\n${PAD}[a]`, `${PAD}[a]: /u\n====\n\n${PAD}[a]`);
add('table after def', `${PAD}[a]: /u\n| h | h |\n| - | - |\n| [a] | c |\n\n${PAD}`, `${PAD}[a]: /u\n| h | h |\n| - | - |\n| [a] | cc |\n\n${PAD}`);
add('title next line', `${PAD}[a]: /u\n  "title"\n\n${PAD}[a]`, `${PAD}[a]: /u\n  "title"\n\n${PAD}[a]!`);
add('title next line broken', `${PAD}[a]: /u\n"title"\n\n${PAD}[a]`, `${PAD}[a]: /u\n"title\n\n${PAD}[a]`);
add('title edit', `${PAD}[a]: /u\n  "title"\n\n${PAD}[a]`, `${PAD}[a]: /u\n  "titlE"\n\n${PAD}[a]`);
// H. labels too long / bracket
const long = 'x'.repeat(999);
add('label to 1000', `${PAD}[${long}]: /u\n\n${PAD}[${long}]`, `${PAD}[${long}y]: /u\n\n${PAD}[${long}y]`);
add('label with bracket', `${PAD}[ab]: /u\n\n${PAD}[ab]`, `${PAD}[a[b]: /u\n\n${PAD}[ab]`);
add('ref label to 1000', `${PAD}[${long.slice(1)}]: /u\n\n${PAD}[${long.slice(1)}]`, `${PAD}[${long.slice(1)}]: /u\n\n${PAD}[${long}]`);
// I. line endings
for (const [n, f] of [['crlf', (s: string) => s.replace(/\n/g, '\r\n')], ['cr', (s: string) => s.replace(/\n/g, '\r')], ['bom', (s: string) => '\uFEFF' + s]] as const)
  for (const [name, a, b] of [...cases]) if (!name.includes(':')) add(`${n}:${name}`, f(a), f(b));
let bad = 0, regions = 0;
for (const [name, a, b] of cases) {
  const A = enc.encode(a), B = enc.encode(b);
  const re = reparseMarkdown(parseMarkdown(A, { file: '/t.md' }), A, B, { file: '/t.md' });
  const st = lastReparse();
  if (st.kind === 'region') regions++;
  if (JSON.stringify(re) !== JSON.stringify(parseMarkdown(B, { file: '/t.md' }))) { bad++; console.log('DIFF', name); }
}
console.log(JSON.stringify({ cases: cases.length, regions, bad }));
// invalid UTF-8 near a definition
let badU = 0, nU = 0;
for (const bytesBad of [[0xff], [0xc3], [0xe2, 0x82], [0xc3, 0x28]]) for (const [name, a, b] of cases.slice(0, 40)) {
  const mk = (s: string) => { const i = s.indexOf(']:'); const u = enc.encode(s); const o = i < 0 ? 0 : enc.encode(s.slice(0, i)).length; const out = new Uint8Array(u.length + bytesBad.length); out.set(u.subarray(0, o)); out.set(bytesBad, o); out.set(u.subarray(o), o + bytesBad.length); return out; };
  const A = mk(a), B = mk(b); nU++;
  const re = reparseMarkdown(parseMarkdown(A, { file: '/t.md' }), A, B, { file: '/t.md' });
  if (JSON.stringify(re) !== JSON.stringify(parseMarkdown(B, { file: '/t.md' }))) { badU++; console.log('DIFF utf8', name, bytesBad); }
}
console.log(JSON.stringify({ invalidUtf8Cases: nU, bad: badU }));
