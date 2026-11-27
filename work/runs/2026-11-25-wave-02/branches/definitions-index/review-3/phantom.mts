// Looks for a parse where micromark's label lists and the tree's definitions disagree (a pushed label with no
// definition, or the reverse): the only inputs that `agrees` (and the whole parse's 'unknown') can catch.
// node --experimental-strip-types phantom.mts <count> <seed>
const W = 'file:///C:/Dev/reader/worktrees/definitions-index/packages/core/src/parse/';
const { parseMarkdown } = await import(W + 'parse.ts');
const { definitionIndex } = await import(W + 'from-mdast.ts');
let a = Number(process.argv[3] ?? 7) >>> 0;
const r = () => {
  a = (a + 0x6d2b79f5) >>> 0;
  let t = a;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const ATOMS = ['[', ']', '^', ':', ' ', '\n', '\n\n', 'x', 'a', '>', '- ', '1. ', '"', "'", '(', ')', '<', '>', '=', '-', '\t', '    ', '```', '~~~', '|', '\\', '!', '*', '[^a]:', '[a]:', '[^a]', '[a]', ' /u', '$$', '<div>', '<!--', '-->', '#'];
const count = Number(process.argv[2] ?? 100000);
let unknown = 0;
let withDefs = 0;
for (let i = 0; i < count; i++) {
  const n = 2 + Math.floor(r() * 24);
  let s = '';
  for (let j = 0; j < n; j++) s += ATOMS[Math.floor(r() * ATOMS.length)];
  const d = parseMarkdown(s, { file: 'p.md' });
  const idx = definitionIndex(d);
  if (idx === 'unknown') {
    unknown++;
    if (unknown <= 10) console.log('UNKNOWN', JSON.stringify(s));
  } else if (idx && idx.entries.length) withDefs++;
}
console.log(JSON.stringify({ count, withDefs, unknown }));
