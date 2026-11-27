// Every single-character insertion (from a set aimed at definitions) and every 1- and 2-byte deletion, at every
// position, of hand-built documents that sit on the seams; each edit also chained once more from the reparse.
// node --experimental-strip-types exhaustive.mts
const W = 'file:///C:/Dev/reader/worktrees/definitions-index/packages/core/src/parse/';
const { parseMarkdown } = await import(W + 'parse.ts');
const { reparseMarkdown, lastReparse } = await import(W + 'reparse.ts');

const BASES = [
  '[ẞ]: /a\n\nsee [ss] and [SS] and [ß]\n\npara\n\n[^ß]: note\n\nref [^SS] [^ss]\n',
  '\ufeff[a]: /u\r\n\r\n[a] x\r\n\r\npara [b]\r\n\r\n[b]: /v "t"\r\n',
  '> [a]: /u\n\n- [b]: /v\n\n  [c]: /w\n\n[^n]: x\n    [d]: /z\n\n[a] [b] [c] [d] [^n]\n\ntext\n',
  "[a]: /u 'one\ntwo'\n\n[a]\n\npara\n\n[b]:\n/v\n\"t\"\n\n[b]\n",
  '[a]: /u\n===\n\n[a]\n\nx\n---\n\n[a]: /v\n\n[a]\n',
  '> q\n[a]: /u\n\n[a]\n\n> [b]: /v\nlazy [b]\n\n[b]: /w\n',
  '[a]: /1\n\n[A]: /2\n\n[a] [A]\n\n[ a ]: /3\n\n[a  b]: /4\n\n[A\tB]\n',
  '\t[a]: /u\n\n>\t[b]: /v\n\n-\t[c]: /w\n\n[a][b][c]\n\n   [d]: /x\n\n[d]\n',
  '[^a]: one\n\n    two [b]\n\n[b]: /u\n\nx [^a]\n\n[^a]: dup\n',
  '[a] first\n\n[a]: /u\n\n[a] after\n\npara\n\n[b]: /v\n\n[b]\n\n# [b] head\n',
  '| [a] | b |\n|---|---|\n| [^n] | c |\n\n[a]: /u\n\n[^n]: x\n',
  '# H\n[a]: /u\n\n[a]\n\n```\n[b]: /v\n```\n\n[b]\n\n    [c]: /w\n\n[c]\n',
  'p\n\n[a]: /u\n[b]: /v\n    [c]: /w\n\n[a][b][c]\n\nq\n',
  '[foo]: /url "title"\n\n[foo]\n\n[Foo][] [bar][foo] ![foo]\n\n[^foo]\n\n[^foo]: n\n',
];
const INS = ['\n', ' ', '[', ']', ':', 'x', '>', '-', '"', '\t', '^', '=', '\r', '\\', '!', 'S'];
const enc = new TextEncoder();
let cases = 0, region = 0, fails = 0;
function run(prev: object, before: Uint8Array, after: Uint8Array, tag: string): object {
  const got = reparseMarkdown(prev, before, after, { file: 'e.md' });
  const kind = lastReparse().kind;
  const want = parseMarkdown(after, { file: 'e.md' });
  cases++;
  if (kind === 'region') region++;
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    fails++;
    if (fails <= 10) console.log('MISMATCH', tag, kind, JSON.stringify(new TextDecoder().decode(before)), '=>', JSON.stringify(new TextDecoder().decode(after)));
    return want;
  }
  return got;
}
const PAD = 'filler para\n\n'.repeat(12);
for (const raw of BASES) for (const [pre, post] of [[PAD, PAD], ['', PAD], [PAD, '']]) {
  const base = raw;
  const head = enc.encode(pre).length;
  const b = enc.encode(pre + raw + post);
  const prev = parseMarkdown(b, { file: 'e.md' });
  const edits: Uint8Array[] = [];
  for (let i = head; i <= head + enc.encode(raw).length; i++) {
    for (const c of INS) edits.push(new Uint8Array([...b.subarray(0, i), ...enc.encode(c), ...b.subarray(i)]));
    if (i < b.length) edits.push(new Uint8Array([...b.subarray(0, i), ...b.subarray(i + 1)]));
    if (i + 1 < b.length) edits.push(new Uint8Array([...b.subarray(0, i), ...b.subarray(i + 2)]));
  }
  for (const [n, a] of edits.entries()) {
    const got = run(prev, b, a, `base${BASES.indexOf(base)}#${n}`);
    // chain: undo the edit from the reparse
    run(got, a, b, `base${BASES.indexOf(base)}#${n}-undo`);
  }
}
console.log(JSON.stringify({ cases, region, fails }));
