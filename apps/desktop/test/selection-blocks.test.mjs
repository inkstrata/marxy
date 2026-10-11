// A run of sibling blocks (E-05): the pure half. Which blocks a gesture reaches, the exact bytes the run resolves to,
// and what an operation is handed for it. The browser half is multi-block.test.mjs.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { createBuffer, parseMarkdown, textOf } from '../../../packages/core/src/index.ts';
import { dedupeLines } from '../../../packages/core/src/operations/dedupe-lines.ts';
import { extendRun, extendRunTo, runBlocks, runRange, runTo } from '../src/selection/selection.ts';
import { operationInputFor, operationInputsFor } from '../src/selection/input.ts';

const parse = (text) => parseMarkdown(Buffer.from(text, 'utf8'), { file: 't.md' });
const node = (block, el = null) => ({ kind: 'node', node: block, el });
const find = (root, type, nth = 0) => {
  const out = [];
  const walk = (n) => {
    if (n.type === type) out.push(n);
    for (const c of n.children ?? []) walk(c);
  };
  walk(root);
  return out[nth];
};

test('runTo: siblings under one parent make a run, in either order', () => {
  const doc = parse('one\n\ntwo\n\nthree\n\nfour\n');
  const [a, , c] = doc.children;
  assert.deepEqual(runTo(doc, a, c), { first: a, last: c });
  assert.deepEqual(runTo(doc, c, a), { first: a, last: c });
  assert.deepEqual(runTo(doc, a, a), { first: a, last: a });
});

test('runTo: a target under another parent climbs to the sibling of the anchor that holds it', () => {
  const doc = parse('intro\n\n- one\n- two\n\noutro\n');
  const [intro, list] = doc.children;
  const item = find(doc, 'listItem', 1);
  const run = runTo(doc, intro, item);
  assert.equal(run.first, intro);
  assert.equal(run.last, list, 'the enclosing list, not the list item, and never across the container');
  assert.equal(runTo(doc, intro, doc.children[2]).last, doc.children[2], 'a sibling at the top level is itself');
});

test('runTo: a target outside the anchor\'s container is ignored', () => {
  const doc = parse('top\n\n- one\n- two\n');
  const item = find(doc, 'listItem', 0);
  const top = doc.children[0];
  assert.equal(runTo(doc, item, top), null, 'from inside a list to the top level');
  const quote = parse('> a\n>\n> b\n\nafter\n');
  assert.equal(runTo(quote, quote.children[0].children[0], quote.children[1]), null);
  const nested = runTo(quote, quote.children[0].children[0], quote.children[0].children[1]);
  assert.deepEqual(nested, { first: quote.children[0].children[0], last: quote.children[0].children[1] });
});

test('a run\'s range is first.start to last.end: exact bytes at the block edges, with a BOM, CRLF and astral text', () => {
  const body = '🙂 one\r\n🙂 two\r\n\r\n猫 three 🎉\r\n\r\nfour\r\n';
  for (const text of [body, `﻿${body}`, body.replace(/\r\n/g, '\n')]) {
    const bytes = Buffer.from(text, 'utf8');
    const doc = parseMarkdown(bytes, { file: 't.md' });
    const [a, b, c] = doc.children;
    const range = runRange(a, b);
    assert.equal(range.start, a.src.start);
    assert.equal(range.end, b.src.end);
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const slice = textOf(createBuffer('t.md', bytes), range);
    assert.equal(slice, `🙂 one${eol}🙂 two${eol}${eol}猫 three 🎉`, 'no byte of the next block, none of the end line break');
    assert.equal(bytes.subarray(range.start, range.end).toString('utf8'), slice);
    assert.deepEqual(runBlocks(doc, a, c), [a, b, c]);
    assert.equal(textOf(createBuffer('t.md', bytes), runRange(b, b)), '猫 three 🎉');
    assert.equal(textOf(createBuffer('t.md', bytes), runRange(a, c)).endsWith('four'), true);
  }
});

test('extendRunTo: a click inside the run changes nothing; a click before or after grows it to a hull', () => {
  const doc = parse('a\n\nb\n\nc\n\nd\n\ne\n');
  const [a, b, c, d, e] = doc.children;
  assert.deepEqual(extendRunTo(doc, node(c), e), { first: c, last: e });
  assert.deepEqual(extendRunTo(doc, node(c), a), { first: a, last: c });
  const run = { kind: 'blocks', first: b, last: d, range: runRange(b, d), els: [] };
  assert.deepEqual(extendRunTo(doc, run, c), { first: b, last: d });
  assert.deepEqual(extendRunTo(doc, run, e), { first: b, last: e });
  assert.deepEqual(extendRunTo(doc, run, a), { first: a, last: d });
  assert.equal(extendRunTo(doc, { kind: 'none' }, a), null);
  assert.equal(extendRunTo(doc, { kind: 'document' }, a), null);
});

test('extendRunTo: an inline selection grows from its block; a list item target stays inside its list', () => {
  const doc = parse('see *this* now\n\n- one\n- two\n- three\n');
  const em = find(doc, 'emphasis');
  const run = extendRunTo(doc, node(em), find(doc, 'listItem', 1));
  assert.equal(run.first, doc.children[0]);
  assert.equal(run.last, doc.children[1], 'the whole list');
  const items = parse('- one\n- two\n- three\n');
  const [i1, , i3] = find(items, 'list').children;
  assert.deepEqual(extendRunTo(items, node(i1), i3), { first: i1, last: i3 }, 'items of one list are siblings');
});

test('extendRun: the next sibling joins; a run grows from its last block; nothing past the end', () => {
  const doc = parse('a\n\nb\n\nc\n');
  const [a, b, c] = doc.children;
  assert.deepEqual(extendRun(doc, node(a), 1), { first: a, last: b });
  assert.deepEqual(extendRun(doc, { kind: 'blocks', first: a, last: b, range: runRange(a, b), els: [] }, 1), { first: a, last: c });
  assert.equal(extendRun(doc, node(c), 1), null);
  assert.deepEqual(extendRun(doc, node(c), -1), { first: b, last: c });
  assert.equal(extendRun(doc, { kind: 'none' }, 1), null);
});

test('a run hands operations one input: the range and its bytes, no node', () => {
  const text = 'one\ntwo\none\n\n- a\n- a\n';
  const bytes = Buffer.from(text, 'utf8');
  const doc = parseMarkdown(bytes, { file: 't.md' });
  const buffer = createBuffer('t.md', bytes);
  const [p, list] = doc.children;
  const sel = { kind: 'blocks', first: p, last: list, range: runRange(p, list), els: [] };
  const input = operationInputFor(sel, doc, buffer);
  assert.equal(input.node, undefined);
  assert.deepEqual(input.range, sel.range);
  assert.equal(input.text, 'one\ntwo\none\n\n- a\n- a');
  assert.deepEqual(operationInputsFor(sel, doc, buffer), [input]);
  assert.equal(dedupeLines.canApply(input), true);
  assert.equal(dedupeLines.canApply(operationInputFor(node(p), doc, buffer)), false, 'a single block is not a span');
});
