// J-04: the Copy as targets. The list is whatever the transform registry can run; each target's bytes are checked.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBuffer, textOf } from '../buffer/buffer.ts';
import type { OperationInput } from '../contracts/operation.ts';
import { parseMarkdown } from '../parse/parse.ts';
import { NOT_YET, runTransform } from '../transforms/registry.ts';
import { COPY_TARGETS, copyAsFromOperation, copyAsFromText, copyTargets, type CopyAsRegistry } from './copy-as.ts';
import { copyRich } from './copy-rich.ts';

const enc = new TextEncoder();
const SRC = '# Title\r\n\r\nA *word* and `code`.\r\n\r\n| a | b |\r\n| - | - |\r\n| 1 | 2 |\r\n';

function wholeDocument(source: string): OperationInput {
  const document = parseMarkdown(enc.encode(source), { file: 'doc.md' });
  return { document, range: document.src, text: textOf(createBuffer('doc.md', enc.encode(source)), document.src) };
}

const byId = (targets = COPY_TARGETS) => new Map(targets.map((t) => [t.id, t]));

test('the targets are the eight the registry can run, in menu order (Slack and Jira since J-03.1)', () => {
  assert.deepEqual(COPY_TARGETS.map((t) => t.id), ['markdown', 'plain', 'rich', 'html', 'slack', 'jira', 'json-string', 'quote']);
  assert.deepEqual(Object.keys(NOT_YET), []);
});

test('a seventh transform appears with no change here', () => {
  const calls: string[] = [];
  const registry: CopyAsRegistry = {
    has: (id) => id !== 'to-jira',
    run(id, text) {
      calls.push(id);
      return `<${id}>${text}`;
    },
  };
  const targets = copyTargets(registry);
  assert.deepEqual(targets.map((t) => t.id), ['markdown', 'plain', 'rich', 'html', 'slack', 'json-string', 'quote']);
  assert.equal(copyTargets({ has: () => true, run: registry.run }).length, 8);
  const input = copyAsFromText('hello\n', { title: 'T', path: '/a.md' });
  byId(targets).get('slack')!.build(input);
  byId(targets).get('json-string')!.build(input);
  byId(targets).get('quote')!.build(input);
  assert.deepEqual(calls, ['to-slack', 'json-string', 'quote']);
});

test('markdown copies the selected bytes; the byte-order mark is never in the copy', () => {
  const input = copyAsFromText(`﻿${SRC}`, { title: 'T' });
  assert.equal(byId().get('markdown')!.build(input).text, SRC);
  const whole = copyAsFromOperation(wholeDocument(SRC));
  assert.equal(byId().get('markdown')!.build(whole).text, SRC);
});

test('rich writes the html copy-rich makes, byte for byte; no other target has html', () => {
  const op = wholeDocument(SRC);
  const input = copyAsFromOperation(op);
  const expected = copyRich.run(op).clipboard!;
  for (const target of COPY_TARGETS) {
    const out = target.build(input);
    if (target.id === 'rich') {
      assert.equal(out.html, expected.html);
      assert.equal(out.text, expected.text);
    } else {
      assert.equal(out.html, undefined, target.id);
    }
  }
  assert.equal(byId().get('html')!.build(input).text, expected.html);
});

test('plain is copy-plain, the words without markup', () => {
  const out = byId().get('plain')!.build(copyAsFromOperation(wholeDocument(SRC)));
  assert.ok(out.text.includes('A word and code.'));
  assert.ok(!out.text.includes('*'));
});

test('JSON string keeps CRLF as escapes and drops a BOM; it is the registry result', () => {
  const out = byId().get('json-string')!.build(copyAsFromText(`﻿${SRC}`, { title: 'T' })).text;
  assert.equal(out, runTransform('json-string', SRC));
  assert.ok(out.includes('\\r\\n'));
  assert.ok(!out.includes('\r'));
});

test('quote with source quotes the markdown and ends in a link to the document', () => {
  const quote = byId().get('quote')!;
  const linked = quote.build(copyAsFromOperation(wholeDocument(SRC), { path: '/notes/my doc.md' })).text;
  assert.equal(linked, `${runTransform('quote', SRC).replace(/\s+$/, '')}\r\n\r\n— [Title](/notes/my%20doc.md)\r\n`);
  // A scratch document has nothing to link to; a file with no heading is named by its file.
  const scratch = quote.build(copyAsFromText('plain words\n', { title: 'Untitled' })).text;
  assert.equal(scratch, '> plain words\n\n— Untitled\n');
  assert.equal(copyAsFromOperation(wholeDocument('no heading\n'), { path: '/x/readme.md' }).title, 'readme.md');
});

test('plain and rich of a Source selection read the selected text as a document', () => {
  const input = copyAsFromText('## Part\n\n- one\n- two\n', { path: '/a.md' });
  assert.equal(input.title, 'Part');
  assert.equal(byId().get('plain')!.build(input).text, 'Part\n\n- one\n- two');
  assert.ok(byId().get('rich')!.build(input).html!.includes('<li>'));
});
