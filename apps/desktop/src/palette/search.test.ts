// Fuzzy covers path, title and headings; a heading hit jumps to its byte offset (ADR-0012).

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { IndexEntry } from '@marxy/core';
import { emptySession } from './session.ts';
import {
  jumpForHit,
  paletteResults,
  SEARCH_PREPARED_EMPTY_BODY_MUTATION,
} from './search.ts';

const desktopRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const modelSources = ['session.ts', 'search.ts', 'keys.ts'] as const;
const forbiddenInModel = [
  'MiniNode',
  'createPaletteDocument',
  'mountPalette',
  'querySelector',
  'CSS selector',
] as const;

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

test('desktop test script runs palette model tests in CI', () => {
  const pkg = JSON.parse(readFileSync(join(desktopRoot, 'package.json'), 'utf8')) as {
    scripts: { test: string };
  };
  assert.match(pkg.scripts.test, /node --test/);
  assert.match(pkg.scripts.test, /--experimental-strip-types/);
  assert.match(pkg.scripts.test, /src\/palette\/\*\.test\.ts/);
});

test('palette model sources do not ship a view, MiniNode, or a CSS-selector engine', () => {
  assert.equal(existsSync(join(desktopRoot, 'src/palette/view.ts')), false);
  for (const file of modelSources) {
    const source = readFileSync(join(desktopRoot, 'src/palette', file), 'utf8');
    for (const name of forbiddenInModel) {
      assert.ok(!source.includes(name), `${file} must not reference ${name}`);
    }
  }
});

test(`mutation ${SEARCH_PREPARED_EMPTY_BODY_MUTATION}: an emptied searchPrepared fails fuzzy search tests`, () => {
  const probe = `
    import assert from 'node:assert/strict';
    import { emptySession } from './src/palette/session.ts';
    import { paletteResults } from './src/palette/search.ts';
    const session = emptySession('/repo');
    const entry = {
      path: '/repo/notes/alpha.md',
      root: '/repo',
      title: 'Alpha notes',
      headings: [],
      mtimeMs: 1,
      size: 1,
      kind: 'markdown',
    };
    const hits = paletteResults('alpha notes', [entry], session);
    assert.equal(hits[0]?.entry.path, '/repo/notes/alpha.md');
  `;
  const result = spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--input-type=module', '-e', probe],
    {
      cwd: desktopRoot,
      encoding: 'utf8',
      env: { ...process.env, MARXY_86_MUTATION: SEARCH_PREPARED_EMPTY_BODY_MUTATION },
    },
  );
  const combined = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  assert.notEqual(result.status, 0, 'mutation must break palette fuzzy search assertions');
  assert.match(combined, /AssertionError|ERR_ASSERTION/);
});
