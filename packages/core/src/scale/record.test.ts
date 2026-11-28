import { test } from 'node:test';
import assert from 'node:assert/strict';
import { byteScale, parseScale, scaleRecord } from './record.ts';
import { indexLines } from '../reading/lines.ts';
import { parseMarkdown } from '../parse/parse.ts';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

test('an empty file has one empty line', () => {
  assert.deepEqual(byteScale(new Uint8Array()), { bytes: 0, lines: 1, longestLine: 0 });
});

test('a file with no trailing newline counts its last line; one with a trailing newline does not add an empty one', () => {
  assert.deepEqual(byteScale(enc('ab\ncde')), { bytes: 6, lines: 2, longestLine: 3 });
  assert.deepEqual(byteScale(enc('ab\ncde\n')), { bytes: 7, lines: 2, longestLine: 3 });
  assert.deepEqual(byteScale(enc('\n\n')), { bytes: 2, lines: 2, longestLine: 0 });
});

test('CRLF is one ending, a lone CR is one, and mixed endings count each line once', () => {
  assert.deepEqual(byteScale(enc('a\r\nbb\r\nccc')), { bytes: 10, lines: 3, longestLine: 3 });
  assert.deepEqual(byteScale(enc('a\rbb\rccc\r')), { bytes: 9, lines: 3, longestLine: 3 });
  assert.deepEqual(byteScale(enc('a\r\nbb\nccc\rdddd')), { bytes: 14, lines: 4, longestLine: 4 });
});

test('a byte-order mark is not part of the first line', () => {
  const bom = Uint8Array.from([0xef, 0xbb, 0xbf, ...enc('abc\nd')]);
  assert.deepEqual(byteScale(bom), { bytes: 8, lines: 2, longestLine: 3 });
  assert.deepEqual(byteScale(Uint8Array.from([0xef, 0xbb, 0xbf])), { bytes: 3, lines: 1, longestLine: 0 });
});

test('the longest line is in bytes, not characters', () => {
  assert.equal(byteScale(enc('é\nab')).longestLine, 2);
});

test('a 10 MB single line is one line as long as the file', () => {
  const bytes = new Uint8Array(10 * 1024 * 1024).fill(0x61);
  assert.deepEqual(byteScale(bytes), { bytes: bytes.length, lines: 1, longestLine: bytes.length });
  bytes[bytes.length - 1] = 0x0a;
  assert.deepEqual(byteScale(bytes), { bytes: bytes.length, lines: 1, longestLine: bytes.length - 1 });
});

test('lines and longest line agree with the line index for every ending', () => {
  for (const text of ['', 'a', 'a\n', '\n', 'a\r\nb\r\n', 'a\rb', 'a\r\n\r\nb\n\rc', 'x\n\n\ny\r', '\r\n']) {
    for (const withBom of [false, true]) {
      const bytes = withBom ? Uint8Array.from([0xef, 0xbb, 0xbf, ...enc(text)]) : enc(text);
      const index = indexLines(bytes, false);
      let longest = 0;
      for (let i = 0; i < index.count; i++) longest = Math.max(longest, index.ends[i]! - index.starts[i]!);
      const got = byteScale(bytes);
      assert.equal(got.lines, index.count, JSON.stringify(text));
      assert.equal(got.longestLine, longest, JSON.stringify(text));
    }
  }
});

test('the parse facts count blocks, list items, table rows and nodes', () => {
  const md = '# T\n\npara *em*\n\n- a\n- b\n  - c\n\n| h | h |\n| - | - |\n| 1 | 2 |\n\n> quote\n\n```\ncode\n```\n';
  const bytes = enc(md);
  const got = parseScale(parseMarkdown(bytes, { file: 'a.md' }));
  assert.equal(got.listItems, 3);
  assert.equal(got.tableRows, 2);
  // heading, paragraph, list, nested list, three item paragraphs, table, blockquote, its paragraph, code block
  assert.equal(got.blocks, 11);
  assert.ok(got.nodes > got.blocks + got.listItems + got.tableRows);
  assert.deepEqual(parseScale(parseMarkdown(new Uint8Array(), { file: 'a.md' })), { blocks: 0, listItems: 0, tableRows: 0, nodes: 0 });
});

test('a deeply nested list is counted without recursing', () => {
  const md = Array.from({ length: 2000 }, (_, i) => `${'  '.repeat(Math.min(i, 30))}- item ${i}\n`).join('');
  const got = parseScale(parseMarkdown(enc(md), { file: 'a.md' }));
  assert.equal(got.listItems, 2000);
});

test('the record has the parse facts only when a parse is given', () => {
  const bytes = enc('# a\n');
  assert.equal('blocks' in scaleRecord(bytes), false);
  assert.equal(scaleRecord(bytes, parseMarkdown(bytes, { file: 'a.md' })).blocks, 1);
});
