import { readFileSync, writeFileSync } from 'node:fs';
const p = 'C:/Dev/reader/worktrees/perf-record/scripts/measure-interactions.test.mjs';
let s = readFileSync(p, 'utf8');
const rep = (a, b) => { if (!s.includes(a)) throw new Error('missing: ' + a.slice(0, 60)); s = s.replace(a, b); };
rep("import { DOCUMENTS, parseArgs }", "import { readFileSync } from 'node:fs';\nimport { DOCUMENTS, documentsFor, parseArgs }");
rep("formatTable, median, medians }", "formatTable, median, medians, neutraliseDefinitions }");
rep("const o = parseArgs(['--runs', '5', '--keys=10', '--docs', 'long', '--record', 'a.json', '--compare', 'b.json']);\n  assert.deepEqual([o.runs, o.keys, o.docs, o.record, o.compare], [5, 10, ['long'], 'a.json', 'b.json']);",
"const o = parseArgs(['--runs', '5', '--keys=10', '--docs', 'long-reference', '--record', 'a.json', '--compare', 'b.json']);\n  assert.deepEqual([o.runs, o.keys, o.docs, o.record, o.compare], [5, 10, ['long-reference'], 'a.json', 'b.json']);");
s += `
test('a file given with --doc stands alone, under its own name, and cannot take a built-in name', () => {
  assert.deepEqual(parseArgs(['--doc', 'x/notes.md']).docs, []);
  const docs = documentsFor(parseArgs(['--doc', 'x/notes.md']));
  assert.deepEqual(Object.keys(docs), ['notes.md']);
  assert.equal(docs['notes.md'].path, '/demo/reading/notes.md');
  assert.equal(docs['notes.md'].steps, undefined);
  assert.deepEqual(Object.keys(documentsFor(parseArgs(['--docs', 'short-document', '--doc', 'n.md']))), ['short-document', 'n.md']);
  assert.throws(() => documentsFor(parseArgs(['--doc', 'a/short-document'])), /already/);
  assert.throws(() => parseArgs(['--docs', 'long']), /--docs/);
});

test('the plain long document is the long one with every definition escaped, and is measured on the edit steps only', () => {
  const text = readFileSync(new URL('../fixtures/corpus/32-long-reference.md', import.meta.url), 'utf8');
  const definition = /^ {0,3}\[[^\]\n]+\]:/gm;
  assert.equal(text.match(definition).length, 30);
  const plain = DOCUMENTS['long-reference-plain'].transform(text);
  assert.equal(plain.match(definition), null);
  assert.equal(plain.length, text.length + 30);
  assert.equal(plain.replaceAll('\\[', '['), text);
  assert.deepEqual(DOCUMENTS['long-reference-plain'].steps, ['open', 'undo', 'reload']);
});

test('neutraliseDefinitions escapes footnote and link definitions and nothing else', () => {
  const text = '[^1]: note\n   [ref]: https://x.invalid\ntext [^1] and [a]: inline\n    [indented]: code\n[plain] line\n';
  assert.equal(neutraliseDefinitions(text), '\\[^1]: note\n   \\[ref]: https://x.invalid\ntext [^1] and [a]: inline\n    [indented]: code\n[plain] line\n');
});

test('buildRecord takes the steps run on each document', () => {
  const r = buildRecord({ meta, documents: { a: { open: { taskMs: 1 } }, b: { open: { taskMs: 1 } } }, steps: { a: ['open'], b: ['open', 'undo'] } });
  assert.deepEqual(r.missing, ['b/undo']);
});
`;
writeFileSync(p, s);
