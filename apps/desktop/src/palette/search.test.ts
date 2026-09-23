// Fuzzy covers path, title and headings; a heading hit jumps to its byte offset (ADR-0012).

import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { IndexEntry } from '@marxy/core';
import { emptySession } from './session.ts';
import { jumpForHit, paletteResults, SEARCH_PREPARED_BODY_MUTATION } from './search.ts';

const MODEL_FILES = ['session.ts', 'search.ts', 'keys.ts'] as const;
const MODEL_FORBIDDEN = [/MiniNode/i, /\bview\.ts\b/, /querySelector\s*\(/, /createElement\s*\(/];

test('desktop test script runs palette model tests in CI', () => {
  const pkg = JSON.parse(
    readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
  ) as { scripts: { test: string } };
  const script = pkg.scripts.test;
  assert.match(script, /node --test/, 'test script must invoke node --test');
  assert.match(script, /--experimental-strip-types/, 'palette tests are TypeScript');
  assert.match(
    script,
    /src\/palette\/\*\.test\.ts|src\/\*\*\/\*\.test\.ts/,
    'test script must include palette model tests',
  );
  assert.match(
    script,
    new RegExp(`MARXY_86_MUTATION=${SEARCH_PREPARED_BODY_MUTATION}`),
    'test script must prove the searchPrepared body mutation fails the model suite',
  );
  assert.ok(
    script.includes('test $? -eq 1'),
    'mutation coverage expects a failing child exit status',
  );
});

test('palette model files stay DOM-free', () => {
  const dir = new URL('./', import.meta.url);
  for (const name of MODEL_FILES) {
    const src = readFileSync(new URL(name, dir), 'utf8');
    for (const pattern of MODEL_FORBIDDEN) {
      assert.ok(!pattern.test(src), `${name} must not reference ${pattern}`);
    }
  }
});

test(`mutation ${SEARCH_PREPARED_BODY_MUTATION}: searchPrepared is live when the env hook is unset`, {
  skip: process.env.MARXY_86_MUTATION === SEARCH_PREPARED_BODY_MUTATION,
}, () => {
  assert.notEqual(process.env.MARXY_86_MUTATION, SEARCH_PREPARED_BODY_MUTATION);
  const searchSource = readFileSync(new URL('./search.ts', import.meta.url), 'utf8');
  assert.match(
    searchSource,
    new RegExp(`MARXY_86_MUTATION === SEARCH_PREPARED_BODY_MUTATION`),
    'searchPrepared must honor the named body mutation',
  );
});

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

test('a file read yesterday outranks one read months ago on a near-equal match', () => {
  const day = 24 * 60 * 60 * 1000;
  const entry = (path: string, title: string, lastReadMs: number): IndexEntry => ({
    path, root: '/r', title, headings: [], bytes: 1, mtimeMs: 0, kind: 'markdown', lastReadMs,
  } as unknown as IndexEntry);
  // The old file's title matches a hair better (8 points); only recency can put the other first.
  const old = entry('/r/a.md', 'notes', Date.now() - 120 * day);
  const recent = entry('/r/b.md', 'notes x', Date.now() - day);
  const hits = paletteResults('notes', [old, recent], emptySession('/r'));
  assert.deepEqual(hits.map((hit) => hit.entry.path), ['/r/b.md', '/r/a.md']);
});
