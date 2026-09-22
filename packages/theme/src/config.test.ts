// setTopLevelKey byte preservation (MARXY-47, docs/design/11-config-and-storage.md).

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { setTopLevelKey } from './config.ts';

function outsideBytes(before: Uint8Array, after: Uint8Array, editedLineStart: number, editedLineEnd: number): boolean {
  const dec = new TextDecoder();
  const a = dec.decode(before);
  const b = dec.decode(after);
  if (a.slice(0, editedLineStart) !== b.slice(0, editedLineStart)) return false;
  if (a.slice(editedLineEnd) !== b.slice(editedLineEnd)) return false;
  return true;
}

test('appends theme before the first table with CRLF endings', () => {
  const before = new TextEncoder().encode('size = 17\r\n\r\n[linux]\r\nweight_offset = 75\r\n');
  const after = setTopLevelKey(before, 'theme', '"/t/quiet"');
  const text = new TextDecoder().decode(after);
  assert.match(text, /theme = "\/t\/quiet"/);
  assert.match(text, /size = 17\r\n/);
  assert.ok(text.indexOf('theme =') < text.indexOf('[linux]'));
  assert.match(text, /\r\n/);
});

test('replaces an existing top-level key in place', () => {
  const before = new TextEncoder().encode('theme = "/old"\nsize = 17\n');
  const after = setTopLevelKey(before, 'theme', '"/new"');
  assert.equal(new TextDecoder().decode(after), 'theme = "/new"\nsize = 17\n');
});

test('does not edit a key inside a table section', () => {
  const before = new TextEncoder().encode('[linux]\ntheme = "inside"\n');
  const after = setTopLevelKey(before, 'theme', '"/top"');
  const text = new TextDecoder().decode(after);
  assert.match(text, /\[linux\]\ntheme = "inside"/);
  assert.match(text, /^theme = "\/top"/m);
});

test('preserves bytes outside the edited line when replacing', () => {
  const before = new TextEncoder().encode('variant = dark\ntheme = "/a"\nmeasure = 68\n');
  const after = setTopLevelKey(before, 'theme', '"/b"');
  const textBefore = new TextDecoder().decode(before);
  const textAfter = new TextDecoder().decode(after);
  const lineStart = textBefore.indexOf('theme =');
  const lineEnd = textBefore.indexOf('\n', lineStart) + 1;
  assert.equal(textBefore.slice(0, lineStart), textAfter.slice(0, lineStart));
  assert.equal(textBefore.slice(lineEnd), textAfter.slice(lineEnd));
});
