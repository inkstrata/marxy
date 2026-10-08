// Content search in the memory shell (C-16): the shared cases Rust also runs, so the two
// implementations cannot drift, and the privacy rules the index walk applies.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { searchContent } from '@marxy/core/src/index-model/content-search.ts';
import { createMemoryShell } from './memory.ts';

interface FileSpec {
  readonly text?: string;
  readonly hex?: string;
  readonly padTo?: number;
}

interface Case {
  readonly name: string;
  readonly files: Record<string, FileSpec>;
  readonly roots: readonly string[];
  readonly paths: readonly string[];
  readonly query: string;
  readonly opts: { readonly limit?: number; readonly perFile?: number };
  readonly expect: unknown;
}

const cases: readonly Case[] = JSON.parse(
  readFileSync(new URL('../../../../fixtures/content-search/cases.json', import.meta.url), 'utf8'),
).cases;

function bytesOf(spec: FileSpec): Uint8Array {
  const base = spec.text !== undefined ? Buffer.from(spec.text, 'utf8') : Buffer.from(spec.hex ?? '', 'hex');
  if (spec.padTo === undefined || spec.padTo <= base.length) return new Uint8Array(base);
  const out = new Uint8Array(spec.padTo).fill(0x78);
  out.set(base, 0);
  return out;
}

const utf8 = (text: string): Uint8Array => new Uint8Array(Buffer.from(text, 'utf8'));

test('the shared cases hold a dozen or more', () => {
  assert.ok(cases.length >= 12);
});

for (const c of cases) {
  test(`shared case: ${c.name}`, async () => {
    const files: Record<string, Uint8Array> = {};
    for (const [path, spec] of Object.entries(c.files)) files[path] = bytesOf(spec);
    const shell = createMemoryShell(files);
    const got = await shell.searchContent(c.paths, c.query, { roots: c.roots, ...c.opts });
    assert.deepEqual(got, c.expect);
  });
}

test('a file matched by a deny glob from collection.toml never matches', async () => {
  const shell = createMemoryShell({
    '/notes/drafts/plan.md': utf8('secret plan'),
    '/notes/private.md': utf8('secret'),
    '/notes/ok.md': utf8('secret'),
  });
  const got = await shell.searchContent(['/notes/drafts/plan.md', '/notes/private.md', '/notes/ok.md'], 'secret', {
    roots: ['/notes'],
    denyGlobs: ['**/drafts/**', 'private.md'],
  });
  assert.deepEqual(
    got.hits.map((h) => h.path),
    ['/notes/ok.md'],
  );
  assert.equal(got.scannedFiles, 1);
});

test('a deny glob applies relative to every root a file lies under', async () => {
  const shell = createMemoryShell({ '/a/b/drafts/x.md': utf8('secret') });
  const got = await shell.searchContent(['/a/b/drafts/x.md'], 'secret', { roots: ['/a', '/a/b'], denyGlobs: ['/drafts/'] });
  assert.equal(got.hits.length, 0);
});

test('an aborted signal rejects with AbortError and reads nothing', async () => {
  const shell = createMemoryShell({ '/r/a.md': utf8('needle') });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    shell.searchContent(['/r/a.md'], 'needle', { roots: ['/r'], signal: controller.signal }),
    (err: Error) => err.name === 'AbortError',
  );
});

test('a cancellation stops the search before the next file, and says truncated', () => {
  let reads = 0;
  let cancelled = false;
  const got = searchContent(
    ['/r/a.md', '/r/b.md', '/r/c.md'],
    'needle',
    () => {
      reads++;
      if (reads === 2) cancelled = true;
      const bytes = utf8('needle');
      return { size: bytes.length, read: () => bytes };
    },
    { cancelled: () => cancelled },
  );
  assert.equal(reads, 2);
  assert.equal(got.hits.length, 2);
  assert.equal(got.truncated, true);
});
