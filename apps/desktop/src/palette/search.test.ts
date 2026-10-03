// Fuzzy covers path, title and headings; a heading hit jumps to its byte offset (ADR-0012).

import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { IndexEntry } from '@marxy/core';
import { emptySession } from './session.ts';
import { jumpForHit, paletteResults, SEARCH_PREPARED_BODY_MUTATION } from './search.ts';
import { judge, MUTATIONS } from '../../scripts/mutations.mjs';

const MODEL_FILES = ['session.ts', 'search.ts', 'keys.ts'] as const;
const MODEL_FORBIDDEN = [/MiniNode/i, /\bview\.ts\b/, /querySelector\s*\(/, /createElement\s*\(/];

// The mutation run left `test` for `test:mutations` (A-10): `test` only runs the suite, and
// scripts/mutations.mjs passes only when the named tests fail and nothing else does. Status 1 alone, the
// old `test $? -eq 1`, was also what a crash or an unrelated failure gave.
test('desktop test scripts run the palette model tests and the named mutation', () => {
  const pkg = JSON.parse(
    readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
  ) as { scripts: Record<string, string> };
  const script = pkg.scripts.test;
  assert.match(script, /node --test/, 'test script must invoke node --test');
  assert.match(script, /--experimental-strip-types/, 'palette tests are TypeScript');
  assert.match(
    script,
    /src\/palette\/\*\.test\.ts|src\/\*\*\/\*\.test\.ts/,
    'test script must include palette model tests',
  );
  assert.doesNotMatch(script, /MARXY_86_MUTATION/, 'the mutation run belongs to test:mutations, not test');
  assert.equal(pkg.scripts['test:mutations'], 'node scripts/mutations.mjs');
  const runner = readFileSync(new URL('../../scripts/mutations.mjs', import.meta.url), 'utf8');
  assert.match(runner, /\bSEARCH_PREPARED_BODY_MUTATION\b/, 'mutations.mjs must name the mutation constant');
  const spec = MUTATIONS.find((m) => m.name === SEARCH_PREPARED_BODY_MUTATION);
  assert.ok(spec, 'mutations.mjs must run the searchPrepared body mutation');
  assert.equal(spec.env.MARXY_86_MUTATION, SEARCH_PREPARED_BODY_MUTATION);
  assert.ok(spec.mustFail.length > 0, 'the mutation must name the tests it turns red');
});

test('the mutation verdict fails on a weakened named test, an unnamed failure and a crash', () => {
  const spec = { mustFail: ['caught'], mustSkip: ['live'] };
  const tap = (lines: string[]) => `TAP version 13\n${lines.join('\n')}\n# tests ${lines.length}\n# fail 1\n`;
  const green = tap(['not ok 1 - caught', 'ok 2 - live # SKIP', 'ok 3 - other']);
  assert.deepEqual(judge({ tap: green, status: 1 }, spec), { ok: true, errors: [] });
  const weakened = judge({ tap: tap(['ok 1 - caught', 'ok 2 - live # SKIP', 'ok 3 - other']), status: 0 }, spec);
  assert.equal(weakened.ok, false);
  assert.match(weakened.errors.join('; '), /named test did not fail under the mutation \(pass\): caught/);
  const unrelated = judge({ tap: tap(['not ok 1 - caught', 'ok 2 - live # SKIP', 'not ok 3 - other']), status: 1 }, spec);
  assert.match(unrelated.errors.join('; '), /unnamed test failed under the mutation: other/);
  const syntax = judge({ tap: tap(['not ok 1 - /repo/src/palette/search.test.ts', 'ok 2 - live # SKIP']), status: 1 }, spec);
  assert.match(syntax.errors.join('; '), /named test did not run: caught/);
  assert.match(syntax.errors.join('; '), /unnamed test failed under the mutation: \/repo\/src\/palette\/search\.test\.ts/);
  const crashed = judge({ tap: 'TAP version 13\nnot ok 1 - caught\n', status: null }, spec);
  assert.match(crashed.errors.join('; '), /killed by a signal/);
  assert.match(crashed.errors.join('; '), /printed no summary/);
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

test('a heading match beats a lower-quality title match even when the title score is high', () => {
  // A late, unbounded substring match in a long title scores 4*(10000 - 250*8 - 250) = 31000.
  // A heading that IS the needle, matched at its very start, scores 3*(10000 + 500) = 31500 —
  // genuinely higher, so headingCouldBeat's cutoff must not skip heading scoring at 31000.
  const session = emptySession('/repo');
  const entries = [
    doc({
      path: '/repo/long-title.md',
      title: `${'a'.repeat(250)}cat`,
      headings: [{ level: 2, text: 'cat', byteOffset: 40 }],
    }),
  ];
  const hits = paletteResults('cat', entries, session);
  assert.equal(hits[0]?.heading, 0, 'the heading match should win, not be skipped');
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

test('a decomposed (NFD) file name matches a composed (NFC) query and the reverse', () => {
  const entry = (title: string): IndexEntry => ({
    path: `/repo/${title}.md`,
    root: '/repo',
    title,
    headings: [],
    mtimeMs: 1,
    size: 1,
    kind: 'markdown',
  });
  const nfd = 'café notes'.normalize('NFD');
  const nfc = 'café notes'.normalize('NFC');
  assert.notEqual(nfd, nfc);
  const session = emptySession('/repo');
  assert.equal(paletteResults(nfc, [entry(nfd)], session).length, 1);
  assert.equal(paletteResults(nfd, [entry(nfc)], session).length, 1);
});
