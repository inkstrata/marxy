// Source leave / fromText / CRLF preservation (MARXY-37).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createBuffer } from '../../../../packages/core/src/buffer/buffer.ts';
import { leaveSourceMode, everyLineEndingIsCrlf, bytesFingerprint } from './buffer-commit.ts';

const root = new URL('../../../../', import.meta.url);

test('leaveSourceMode keeps buffer when doc unchanged', () => {
  const bytes = readFileSync(new URL('fixtures/corpus/12-crlf-and-bom.md', root));
  const buffer = createBuffer('/tmp/12-crlf-and-bom.md', new Uint8Array(bytes));
  const doc = buffer.bom ? buffer.text.slice(1) : buffer.text;
  const out = leaveSourceMode(buffer, doc);
  assert.equal(out.changed, false);
  assert.equal(out.buffer, buffer);
  assert.equal(bytesFingerprint(out.buffer), bytesFingerprint(buffer));
});

test('one-line CRLF edit keeps CRLF on every line', () => {
  const bytes = readFileSync(new URL('fixtures/corpus/12-crlf-and-bom.md', root));
  const buffer = createBuffer('/tmp/12-crlf-and-bom.md', new Uint8Array(bytes));
  const lines = (buffer.bom ? buffer.text.slice(1) : buffer.text).split(/\r\n|\n/);
  lines[0] = `${lines[0]} edited`;
  const edited = lines.join('\r\n');
  const out = leaveSourceMode(buffer, edited);
  assert.equal(out.changed, true);
  assert.ok(everyLineEndingIsCrlf(out.buffer.bytes), 'expected CRLF throughout after fromText');
});

test('toggle twice without edits leaves bytes identical', () => {
  const bytes = readFileSync(new URL('fixtures/corpus/19-source-file.md', root));
  const buffer = createBuffer('/tmp/19-source-file.md', new Uint8Array(bytes));
  const doc = buffer.bom ? buffer.text.slice(1) : buffer.text;
  const once = leaveSourceMode(buffer, doc);
  const twice = leaveSourceMode(once.buffer, doc);
  assert.equal(twice.changed, false);
  assert.equal(bytesFingerprint(twice.buffer), bytesFingerprint(buffer));
});
