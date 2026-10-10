import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { classifyClipboard, fenceFor, looksLikeMarkdown } from './classify.ts';

test('markdown in text/plain beside a rendered text/html is markdown, returned byte for byte', () => {
  const text = '# Plan\r\n\r\n- one\r\n- two\r\n\r\nSome **bold** and `code`.\r\n';
  const html = '<h1>Plan</h1><ul><li>one</li><li>two</li></ul><p>Some <b>bold</b></p>';
  const got = classifyClipboard({ text, html });
  assert.equal(got.kind, 'markdown');
  assert.equal(got.markdown, text);
});

test('each markdown signal on its own is enough', () => {
  for (const text of [
    '```py\nprint(1)\n```',
    '~~~\nx\n~~~',
    '## Heading\nbody',
    '- a\n- b',
    '1. a\n2) b',
    '| a | b |\n| --- | :-: |\n| 1 | 2 |',
    'a **b** and `c`',
    'see [x](https://example.com) and **y**',
  ]) assert.equal(classifyClipboard({ text }).kind, 'markdown', text);
});

test('one list line, one mark, or a lone hash is not markdown', () => {
  for (const text of ['- just one', 'a **b**', '#hashtag', 'hello', 'cost - 5 - 6', 'a --- b'])
    assert.equal(looksLikeMarkdown(text), false, text);
});

test('HTML only (a block element) is html and carries no markdown yet', () => {
  assert.deepEqual(classifyClipboard({ html: '<div>hi</div>' }), { kind: 'html' });
  assert.deepEqual(classifyClipboard({ text: 'hi', html: '<P>hi</P>' }), { kind: 'html' });
  assert.deepEqual(classifyClipboard({ html: '<table><tr><td>x</td></tr></table>' }), { kind: 'html' });
});

test('inline-only HTML with plain text is text', () => {
  assert.deepEqual(classifyClipboard({ text: 'hello', html: '<span>hello</span>' }), { kind: 'text', markdown: 'hello' });
  assert.deepEqual(classifyClipboard({ text: 'x', html: '<pre-wrapped>x</pre-wrapped>' }), { kind: 'text', markdown: 'x' });
});

test('a JSON object or array is json, fenced, and not reformatted', () => {
  const text = '{"a":1,   "b":[1,2]}';
  assert.deepEqual(classifyClipboard({ text }), { kind: 'json', markdown: '```json\n{"a":1,   "b":[1,2]}\n```\n' });
  assert.equal(classifyClipboard({ text: '[1, 2]\n' }).markdown, '```json\n[1, 2]\n```\n');
  assert.equal(classifyClipboard({ text: '"just a string"' }).kind, 'text');
  assert.equal(classifyClipboard({ text: '{not json}' }).kind, 'text');
  assert.equal(classifyClipboard({ text: '42' }).kind, 'text');
});

test('JSON that contains backticks gets a longer fence', () => {
  const text = '{"c":"```` and ``` inside"}';
  const got = classifyClipboard({ text });
  assert.equal(got.kind, 'json');
  assert.equal(got.markdown, `\`\`\`\`\`json\n${text}\n\`\`\`\`\`\n`);
  assert.equal(fenceFor('``'), '```');
  assert.equal(fenceFor('```'), '````');
});

test('plain text is text, used as is', () => {
  assert.deepEqual(classifyClipboard({ text: 'hello' }), { kind: 'text', markdown: 'hello' });
  const odd = '  two  spaces\r\nand a tab\t\n';
  assert.equal(classifyClipboard({ text: odd }).markdown, odd);
});

test('nothing, or only whitespace, is empty', () => {
  assert.deepEqual(classifyClipboard({}), { kind: 'empty' });
  assert.deepEqual(classifyClipboard({ text: ' \n\t ', html: '  ' }), { kind: 'empty' });
  assert.deepEqual(classifyClipboard({ text: '', html: '<b> </b>' }), { kind: 'empty' });
});

test('the same payload gives the same answer', () => {
  const payload = { text: 'a **b** and `c`', html: '<p>x</p>' };
  assert.deepEqual(classifyClipboard(payload), classifyClipboard({ ...payload }));
});
