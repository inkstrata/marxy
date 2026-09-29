// Title is the first h1, otherwise the filename. Headings carry byte offsets, not contents.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMarkdown } from '../parse/parse.ts';
import { classify, entryFromCandidate, headingsFromMarkdown } from './index.ts';

test('the first ATX h1 becomes the title; other headings are recorded with byte offsets', () => {
  const text = '# Title\n\n## Section\n';
  const bytes = new TextEncoder().encode(text);
  const headings = headingsFromMarkdown(bytes);
  assert.deepEqual(
    headings.map((h) => ({ level: h.level, text: h.text })),
    [
      { level: 1, text: 'Title' },
      { level: 2, text: 'Section' },
    ],
  );
  assert.equal(headings[0]?.byteOffset, 0);
  assert.equal(headings[1]?.byteOffset, text.indexOf('## Section'));
  const entry = entryFromCandidate('/repo', {
    path: '/repo/doc.md',
    relativePath: 'doc.md',
    mtimeMs: 1,
    size: bytes.byteLength,
    bytes,
  });
  assert.equal(entry.title, 'Title');
  assert.equal(entry.kind, 'markdown');
});

test('without bytes, the title is the filename and headings stay empty', () => {
  const entry = entryFromCandidate('/repo', {
    path: '/repo/plain.md',
    relativePath: 'plain.md',
    mtimeMs: 1,
    size: 0,
  });
  assert.equal(entry.title, 'plain.md');
  assert.deepEqual(entry.headings, []);
});

test('a binary extension is not an index kind', () => {
  assert.equal(classify('photo.png'), undefined);
  assert.equal(classify('blob'), undefined);
  assert.equal(classify('notes.md'), 'markdown');
});

test('frontmatter and fenced code do not contribute headings', () => {
  const text = '---\ntitle: x\n---\n\n```\n# not a heading\n```\n\n# Real\n';
  const headings = headingsFromMarkdown(new TextEncoder().encode(text));
  assert.deepEqual(
    headings.map((h) => h.text),
    ['Real'],
  );
});

test('a fence closes only on a matching marker, not the other fence character', () => {
  const backtickFence = '````\n~~~\n# still inside\n````\n\n# Outside\n';
  assert.deepEqual(
    headingsFromMarkdown(new TextEncoder().encode(backtickFence)).map((h) => h.text),
    ['Outside'],
  );
  const tildeFence = '~~~\n```\n# still inside\n~~~\n\n# Outside\n';
  assert.deepEqual(
    headingsFromMarkdown(new TextEncoder().encode(tildeFence)).map((h) => h.text),
    ['Outside'],
  );
});

// The index scan must agree with the parser about where each heading starts.
const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
function astHeadingStarts(bytes: Uint8Array): number[] {
  const out: number[] = [];
  const doc = parseMarkdown(bytes, { file: 't.md' });
  const walk = (nodes: readonly { type: string; src?: { start: number }; children?: unknown }[]): void => {
    for (const n of nodes) {
      if (n.type === 'heading' && n.src && bytes[n.src.start] === 0x23) out.push(n.src.start); // ATX only
      if (Array.isArray(n.children)) walk(n.children);
    }
  };
  walk(doc.children as never);
  return out;
}
function assertAgrees(source: string, texts: string[]): void {
  const bytes = enc(source);
  const found = headingsFromMarkdown(bytes);
  assert.deepEqual(
    found.map((h) => h.text),
    texts,
    source,
  );
  assert.deepEqual(
    found.map((h) => h.byteOffset),
    astHeadingStarts(bytes),
    `offsets: ${source}`,
  );
}

test('a --- setext underline or unclosed rule in the first bytes is not front matter', () => {
  assertAgrees('ab\n---\n# x\n\n# y\n---\n', ['x', 'y']);
  assertAgrees('---\n# a\n\nno closer\n# b\n', ['a', 'b']);
  assertAgrees('---\ntitle: t\n---\n# real\n', ['real']);
  assertAgrees('\ufeff---\na: b\n---\n# real\n', ['real']);
});

test('a closing # run needs a space before it; up to three leading spaces are allowed', () => {
  assertAgrees('# C#\n', ['C#']);
  assertAgrees('# foo \\#\n', ['foo \\#']);
  assertAgrees('# foo ##  \n', ['foo']);
  assertAgrees('   # Indented\n', ['Indented']);
  assertAgrees('    # code\n', []);
});

test('a backtick fence info string cannot hold a backtick', () => {
  assertAgrees('```x``` y\n# h\n', ['h']);
  assertAgrees('``` a`b\n# h\n', ['h']);
  assertAgrees('```js\n# not\n```\n# h\n', ['h']);
  assertAgrees('~~~ a`b\n# not\n~~~\n# h\n', ['h']);
});

test('headings inside an HTML comment block are skipped', () => {
  assertAgrees('<!--\n# hidden\n-->\n# shown\n', ['shown']);
  assertAgrees('<!-- one line -->\n# shown\n', ['shown']);
});

test('CRLF and bare CR files keep byte offsets correct', () => {
  assertAgrees('# a\r\n\r\n## b\r\n', ['a', 'b']);
  assertAgrees('# a\r\r## b\r', ['a', 'b']);
  assertAgrees('---\r\nt: 1\r\n---\r\n# a\r\n', ['a']);
});
