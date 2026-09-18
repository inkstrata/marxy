// Title is the first h1, otherwise the filename. Headings carry byte offsets, not contents.

import { test } from 'node:test';
import assert from 'node:assert/strict';
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
