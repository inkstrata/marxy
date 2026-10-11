// The AST half of the incremental render (B-24): which blocks a parse shares with the one before it, and
// which raw HTML the sanitiser's stack of open elements cannot be left open by. The page half runs in WebKit
// (apps/desktop/test/live-reload.test.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMarkdown } from '@marxy/core';
import { rawTagsBalanced, sameMoved } from './incremental.ts';

const enc = new TextEncoder();
const parse = (text: string) => parseMarkdown(enc.encode(text), { file: '/t.md' });

test('a paragraph moved by the length of what was written above it is the same block, moved', () => {
  const before = parse('first\n\nsecond **bold** [link](https://example.com)\n');
  const after = parse('a line written above\n\nfirst\n\nsecond **bold** [link](https://example.com)\n');
  const delta = 'a line written above\n\n'.length;
  assert.equal(sameMoved(before.children[1], after.children[2], delta), true);
  assert.equal(sameMoved(before.children[1], after.children[2], delta + 1), false, 'by another number of bytes it is not');
  assert.equal(sameMoved(before.children[1], after.children[2], 0), false, 'and unmoved it is not');
});

test('a block with other words, or another shape, is not the same block', () => {
  const before = parse('a [link](https://example.com)\n');
  assert.equal(sameMoved(before.children[0], parse('a [link](https://example.org)\n').children[0], 0), false);
  assert.equal(sameMoved(before.children[0], parse('# a [link](https://example.com)\n').children[0], 0), false);
  assert.equal(sameMoved(before.children[0], before.children[0], 0), true);
});

test('a table whose columns the parser shares between the two parses is still compared by its ranges', () => {
  const text = '| a | b |\n|---|:-:|\n| 1 | 2 |\n';
  const before = parse(text);
  const after = parse(`written above\n\n${text}`);
  assert.equal(sameMoved(before.children[0], after.children[1], 'written above\n\n'.length), true);
  assert.equal(sameMoved(before.children[0], after.children[1], 0), false);
});

test('raw tags that open and close inside a block leave the sanitiser where it was', () => {
  for (const text of ['plain words', 'a <kbd>K</kbd> and <b>bold <i>both</i></b>', 'a line<br>break', 'a <!-- comment --> here', '- item <span>one</span>\n- two', '*em <b> across* raw</b>']) {
    assert.equal(rawTagsBalanced(parse(text).children[0]!), true, text);
  }
});

test('raw tags that close what the block never opened, or open and do not close, may leave it elsewhere', () => {
  for (const text of ['a stray </b> close', 'an open <div>', '- first </ul> stray\n- second', 'a <script>alert(1)</script> b', 'a <style>p {}</style> b', 'a <svg><g></g></svg> b']) {
    assert.equal(rawTagsBalanced(parse(text).children[0]!), false, text);
  }
});
