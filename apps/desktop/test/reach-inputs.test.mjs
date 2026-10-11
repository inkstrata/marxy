// E-02: the inputs a selection reaches (task item, cell) and what the operations do with them on
// CRLF, CR-only, BOM and mixed-ending files. Pure: no browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBuffer, parseMarkdown } from '../../../packages/core/src/index.ts';
import { toggleTask } from '../../../packages/core/src/operations/toggle-task.ts';
import { alignTablePipes } from '../../../packages/core/src/operations/align-table-pipes.ts';
import { operationInputFor, operationInputsFor } from '../src/selection/input.ts';

const enc = new TextEncoder();
const dec = new TextDecoder("utf-8", { ignoreBOM: true });

function walk(node, visit) {
  visit(node);
  for (const c of node.children ?? []) walk(c, visit);
}
function find(doc, pred) {
  let hit;
  walk(doc, (n) => { if (!hit && pred(n)) hit = n; });
  assert.ok(hit, 'node');
  return hit;
}
const sel = (node) => ({ kind: 'node', node, el: null });
function load(text) {
  const bytes = enc.encode(text);
  return { bytes, doc: parseMarkdown(bytes, { file: 'f.md' }), buffer: createBuffer('f.md', bytes) };
}
/** Runs `op` on the first reach input it accepts and returns the file's new text. */
function reach(op, text, node) {
  const { bytes, doc, buffer } = load(text);
  const input = operationInputsFor(sel(node(doc)), doc, buffer).find((i) => op.canApply(i));
  assert.ok(input, 'an input accepts the operation');
  const { replacement } = op.run(input);
  const out = new Uint8Array([
    ...bytes.slice(0, input.range.start),
    ...enc.encode(replacement),
    ...bytes.slice(input.range.end),
  ]);
  return dec.decode(out);
}
const para = (doc) => find(doc, (n) => n.type === 'paragraph' && doc && n.children?.some((c) => c.type === 'taskMarker'));
const cell = (doc) => find(doc, (n) => n.type === 'tableCell');

test('operationInputsFor is exactly [primary] for a heading, a code block and a plain paragraph', () => {
  const { doc, buffer } = load('# H\n\ntext\n\n```js\nx\n```\n');
  for (const type of ['heading', 'codeBlock', 'paragraph']) {
    const node = find(doc, (n) => n.type === type);
    const got = operationInputsFor(sel(node), doc, buffer);
    assert.equal(got.length, 1, type);
    assert.deepEqual(got[0], operationInputFor(sel(node), doc, buffer), type);
  }
});

test('operationInputsFor offers the item for a task paragraph and the table for a cell', () => {
  const { doc, buffer } = load('- [ ] a\n\n| a | b |\n|---|---|\n| 1 | 2 |\n');
  const p = para(doc);
  const got = operationInputsFor(sel(p), doc, buffer);
  assert.equal(got.length, 2);
  assert.equal(got[0].node, p);
  assert.equal(got[1].node.type, 'listItem');
  const cells = operationInputsFor(sel(cell(doc)), doc, buffer);
  assert.equal(cells.length, 2);
  assert.equal(cells[0].node.type, 'table');
});

const TASK_CASES = {
  'LF': ['- [ ] a\n- b\n', '- [x] a\n- b\n'],
  'CRLF': ['- [ ] a\r\n- b\r\n', '- [x] a\r\n- b\r\n'],
  'CR-only': ['- [ ] a\r- b\r', '- [x] a\r- b\r'],
  'BOM': ['﻿- [ ] a\r\n- b\r\n', '﻿- [x] a\r\n- b\r\n'],
  'mixed, first item': ['- [ ] a\r\n- x\n', '- [x] a\r\n- x\n'],
  'mixed, task after other endings': ['intro\n\n- a\r\n- [ ] b\r- c\n', 'intro\n\n- a\r\n- [x] b\r- c\n'],
  'checked back to open': ['- [x] a\r\n- b\n', '- [ ] a\r\n- b\n'],
};
for (const [name, [before, after]] of Object.entries(TASK_CASES)) {
  test(`toggle task from a click on the item's text, ${name}: only the marker bytes change`, () => {
    assert.equal(reach(toggleTask, before, para), after);
  });
}
test('a bare "- [ ]" with mixed endings is not a task: nothing offers Toggle task and nothing changes', () => {
  const { doc, buffer } = load('- [ ]\r\n- x\n');
  const item = find(doc, (n) => n.type === 'listItem');
  assert.equal(operationInputsFor(sel(item), doc, buffer).some((i) => toggleTask.canApply(i)), false);
});

const TABLE = (nl) => ['| a | b |', '|---|---|', '| long cell | 2 |'].join(nl) + nl;
const ALIGNED = (nl) => ['| a         | b |', '| --------- | - |', '| long cell | 2 |'].join(nl) + nl;
for (const [name, nl, bom] of [['LF', '\n', ''], ['CRLF', '\r\n', ''], ['CR-only', '\r', ''], ['BOM + CRLF', '\r\n', '﻿']]) {
  test(`align table pipes from a cell, ${name}: separators kept, rows aligned`, () => {
    const out = reach(alignTablePipes, `${bom}intro${nl}${nl}${TABLE(nl)}`, cell);
    assert.ok(out.startsWith(bom + 'intro' + nl + nl), 'bytes before the table are kept');
    const table = out.slice((bom + 'intro' + nl + nl).length);
    assert.equal(table.split(nl).length, 4, 'row separators unchanged');
    assert.equal(table.replaceAll(nl, '').includes('\n') || table.replaceAll(nl, '').includes('\r'), false, 'no stray separator');
    const rows = table.split(nl).slice(0, 3);
    assert.equal(new Set(rows.map((r) => r.length)).size, 1, 'rows are one width');
  });
}
test('align table pipes with mixed endings keeps each row ending', () => {
  const before = 'x\n\n| a | b |\r|---|---|\r\n| long cell | 2 |\n';
  const out = reach(alignTablePipes, before, cell);
  const endings = (s) => s.match(/\r\n|\r|\n/g);
  assert.deepEqual(endings(out), endings(before));
});
