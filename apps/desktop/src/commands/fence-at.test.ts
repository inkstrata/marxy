import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { fenceAt } from './fence-at.ts';

const doc = 'Prose.\n\n```sh\nb\na\n```\n\nMore.\n~~~~\nx\n~~~\n~~~~\n';

test('the cursor inside a fence gives its content, last line break kept', () => {
  const at = doc.indexOf('b\na');
  const part = fenceAt(doc, at + 2);
  assert.ok(part);
  assert.equal(doc.slice(part.from, part.to), 'b\na\n');
});

test('outside every fence, or on a fence line, there is none', () => {
  assert.equal(fenceAt(doc, 2), null);
  assert.equal(fenceAt(doc, doc.indexOf('More')), null);
  assert.equal(fenceAt(doc, doc.indexOf('```sh') + 1), null);
});

test('a shorter run of the same character does not close the fence', () => {
  const part = fenceAt(doc, doc.indexOf('x\n'));
  assert.ok(part);
  assert.equal(doc.slice(part.from, part.to), 'x\n~~~\n');
});

test('a fence left open runs to the end, and CRLF lines read as lines', () => {
  const open = 'a\n```\none\ntwo';
  const part = fenceAt(open, open.indexOf('two'));
  assert.ok(part);
  assert.equal(open.slice(part.from, part.to), 'one\ntwo');
  const crlf = '```\r\nq\r\n```\r\n';
  const p2 = fenceAt(crlf, 6);
  assert.ok(p2);
  assert.equal(crlf.slice(p2.from, p2.to), 'q\r\n');
});
