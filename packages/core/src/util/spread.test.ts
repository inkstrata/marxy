// Lists past the engine's argument limit: a call that spreads one throws "Maximum call stack size exceeded". Each
// path below is fed a list of 300,000 and must come out whole.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { writeMarkdown } from '../office/markdown.ts';
import { readOffice } from '../office/index.ts';
import { run } from '../office/model.ts';
import { partsReader, wordParts } from '../office/testing/samples.ts';
import { appendAll, maxOf, minOf, pushAll } from './spread.ts';

const BIG = 300_000;
const ids = Array.from({ length: BIG }, (_, i) => i);

test('pushAll, maxOf and minOf take any length', () => {
  const into: number[] = [-1];
  assert.equal(pushAll(into, ids), BIG + 1);
  assert.equal(into[BIG], BIG - 1);
  assert.equal(pushAll([], new Set(ids)), BIG);
  assert.equal(maxOf(ids), BIG - 1);
  assert.equal(minOf(ids), 0);
  assert.equal(maxOf([], 0), 0);
  assert.equal(minOf([]), Infinity);
});

test('pushAll of an array onto itself doubles it once, and maxOf and minOf skip NaN', () => {
  const a = [1, 2, 3];
  pushAll(a, a);
  assert.deepEqual(a, [1, 2, 3, 1, 2, 3]);
  assert.equal(maxOf([1, NaN, 3]), 3);
  assert.equal(minOf([4, NaN, 2]), 2);
});

test('appendAll moves every node, in order, from a live list', () => {
  const kids: unknown[] = [];
  const parent = { append: (...nodes: unknown[]) => { assert.ok(nodes.length <= 5000); kids.push(...nodes); } };
  appendAll(parent as unknown as ParentNode, ids as unknown as ArrayLike<Node>);
  assert.equal(kids.length, BIG);
  assert.equal(kids[BIG - 1], BIG - 1);
});

test('a Word document of 300,000 paragraphs reads whole', async () => {
  const parts = wordParts();
  const doc = String(parts['word/document.xml']);
  const head = doc.slice(0, doc.indexOf('<w:body>') + 8);
  parts['word/document.xml'] = `${head}${'<w:p><w:r><w:t>hi</w:t></w:r></w:p>'.repeat(BIG)}</w:body></w:document>`;
  const r = await readOffice('docx', partsReader(parts));
  assert.equal(r.doc.blocks.length, BIG);
  // The page shows a capped reading; the whole document is still written uncapped (export, Copy as).
  assert.equal(writeMarkdown(r.doc).markdown.split('\n\n').length >= BIG, true);
});

test('Markdown is written for a code paragraph with 300,000 backtick runs and a table 300,000 rows long', () => {
  const code = Array.from({ length: BIG }, () => 'a`b').join(' ');
  const rows = Array.from({ length: BIG }, () => [[run('x')]]);
  const out = writeMarkdown({
    blocks: [{ t: 'code', text: code }, { t: 'table', rows }] as never,
    notes: [], images: [],
  } as never);
  assert.ok(out.markdown.length > BIG);
});
