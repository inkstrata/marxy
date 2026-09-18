// Fuzzy covers path, title and headings; a heading hit jumps to its byte offset (ADR-0012).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { IndexEntry } from '@marxy/core';
import { emptySession } from './session.ts';
import { jumpForHit, paletteResults } from './search.ts';

function doc(partial: Partial<IndexEntry> & Pick<IndexEntry, 'path' | 'title'>): IndexEntry {
  return {
    root: '/repo',
    headings: [],
    mtimeMs: 1,
    size: 1,
    kind: 'markdown',
    ...partial,
  };
}

test('a query matches title, path and headings', () => {
  const session = emptySession('/repo');
  const entries = [
    doc({ path: '/repo/notes/alpha.md', title: 'Alpha notes' }),
    doc({
      path: '/repo/guide.md',
      title: 'Guide',
      headings: [{ level: 2, text: 'Installation', byteOffset: 80 }],
    }),
    doc({ path: '/repo/src/install.ts', title: 'install.ts' }),
  ];
  const byTitle = paletteResults('alpha notes', entries, session);
  assert.equal(byTitle[0]?.entry.path, '/repo/notes/alpha.md');
  const byPath = paletteResults('src/install', entries, session);
  assert.equal(byPath[0]?.entry.path, '/repo/src/install.ts');
  const byHeading = paletteResults('installation', entries, session);
  assert.equal(byHeading[0]?.entry.path, '/repo/guide.md');
  assert.equal(byHeading[0]?.heading, 0);
});

test('heading hits jump to the heading byte offset', () => {
  const session = emptySession('/repo');
  const entries = [
    doc({
      path: '/repo/long.md',
      title: 'Long agent log',
      headings: [
        { level: 2, text: 'Plan', byteOffset: 12 },
        { level: 2, text: 'Acceptance', byteOffset: 240 },
      ],
    }),
  ];
  const hits = paletteResults('acceptance', entries, session);
  assert.equal(hits[0]?.heading, 1);
  assert.deepEqual(jumpForHit(hits[0]!), {
    path: '/repo/long.md',
    byteOffset: 240,
    headingText: 'Acceptance',
  });
});

test('current root results come before another root', () => {
  const session = emptySession('/repo');
  const entries = [
    doc({ path: '/other/readme.md', title: 'Readme', root: '/other' }),
    doc({ path: '/repo/readme.md', title: 'Readme', root: '/repo' }),
  ];
  const hits = paletteResults('readme', entries, session);
  assert.equal(hits[0]?.entry.path, '/repo/readme.md');
  assert.equal(hits[1]?.entry.path, '/other/readme.md');
});
