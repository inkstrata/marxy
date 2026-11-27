import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { cpuNow } from '../testing/cpu-clock.ts';
import { PASTE_LOOK_CHARS, classifyClipboard, fenceFor, looksLikeMarkdown } from './classify.ts';

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

// The patterns as they were before the one-pass reader, kept as the reference the reader must agree with.
const OLD_FENCE = /^ {0,3}(?:`{3,}|~{3,})/m;
const OLD_ATX = /^ {0,3}#{1,6}[ \t]+\S/m;
const OLD_LIST = /^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+\S/gm;
const OLD_TABLE = /^[ \t]*\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)+\|?[ \t]*$|^[ \t]*\|[ \t]*:?-+:?[ \t]*\|?[ \t]*$/m;
const OLD_MARKS = [/\*\*[^*\n]+\*\*/g, /`[^`\n]+`/g, /\[[^\]\n]+\]\([^)\n]+\)/g];
function oldLooksLikeMarkdown(text: string): boolean {
  if (OLD_FENCE.test(text) || OLD_ATX.test(text) || OLD_TABLE.test(text)) return true;
  if ((text.match(OLD_LIST) ?? []).length >= 2) return true;
  let marks = 0;
  for (const re of OLD_MARKS) marks += (text.match(re) ?? []).length;
  return marks >= 2;
}

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

// Pieces that sit on the edges of every pattern. Links, bold and code are given in halves that a line break can split.
const PIECES = [
  ' ', '  ', '\t', '\n', '\r', '\r\n', ' ', ' ', '\u0085', ' ', 'a', 'word', '1', '12', '1234567890', '.', ')',
  '-', '--', '---', ':', ':-', '-:', '|', '||', '| ', ' |', '#', '##', '#######', '```', '``', '`', '~~~', '~', '*', '**', '+',
  '[', ']', '[x]', '](', '(', ')', '[a](b)', '[a]()', '[](b)', '[a]', '(b)', '[a\n](b)', '[a](\nb)', '[a]\n(b)', '**b**', '**', '`c`',
  'x**', '**y', '\\','\u{1F600}', '\ud800',
];

test('the one-pass reader agrees with the patterns it replaced on 100,000 seeded pastes', () => {
  const rand = seeded(20261127);
  let markdown = 0;
  for (let n = 0; n < 100_000; n++) {
    let text = '';
    for (let k = 1 + Math.floor(rand() * 12); k > 0; k--) text += PIECES[Math.floor(rand() * PIECES.length)];
    const want = oldLooksLikeMarkdown(text);
    if (want) markdown++;
    assert.equal(looksLikeMarkdown(text), want, JSON.stringify(text));
  }
  assert.ok(markdown > 10_000 && markdown < 90_000, `both answers are common (${markdown})`);
});

test('links, bold and code split across lines, and several in a row, are counted as before', () => {
  for (const text of [
    '[a](b', '[a](b\n)', '[a]\n(b) [c](d)', '[a](b)\n[c](d)', '[a](b)[c](d)', '[a]([b](c)', '[[a](b)](c)', '[a](b)(c) [d](e)',
    '**a\nb** **c**', '**a** **b', '`a\nb` `c`', '`a``b``c`', '****', '** **', '**a****b**', '[a]()[b](c)[d](e)', '[](x)[](y)',
    '[a](b)\r[c](d)', '[a\r](b) [c](d)',
  ]) assert.equal(looksLikeMarkdown(text), oldLooksLikeMarkdown(text), JSON.stringify(text));
});

test('a paste past the characters looked at is read to that point, and is never fenced as JSON', () => {
  const rest = ' '.repeat(PASTE_LOOK_CHARS);
  const late = `${rest}\n# Heading\n`;
  assert.equal(classifyClipboard({ text: late }).kind, 'text');
  assert.equal(classifyClipboard({ text: `# Heading\n${rest}` }).kind, 'markdown');
  const big = `[${'1,'.repeat(PASTE_LOOK_CHARS / 2)}1]`;
  assert.equal(classifyClipboard({ text: big }).kind, 'text');
  assert.equal(classifyClipboard({ text: '[1,2]' }).kind, 'json');
});

test('hostile pastes are classified in bounded time', () => {
  const within = (ms: number, what: string, text: string, kind: string): void => {
    const t = cpuNow();
    const got = classifyClipboard({ text });
    const took = cpuNow() - t;
    assert.ok(took < ms, `${what}: ${Math.round(took)} ms, the bound is ${ms}`);
    assert.equal(got.kind, kind, what);
  };
  within(500, 'one line of spaces', `${' '.repeat(1_000_000)}x`, 'text');
  within(500, 'one line of spaces and a pipe', `|${' '.repeat(1_000_000)}`, 'text');
  within(500, 'one line of [', '['.repeat(1_000_000), 'text');
  within(500, 'one line of [a](', '[a]('.repeat(250_000), 'text');
  within(500, 'one line of *', '*'.repeat(1_000_000), 'text');
  within(1500, 'a hundred thousand lines of spaces', `${' '.repeat(40)}x\n`.repeat(100_000), 'text');
  within(1500, 'a paste past the limit', `${'['.repeat(PASTE_LOOK_CHARS)}${' '.repeat(5_000_000)}`, 'text');
});
