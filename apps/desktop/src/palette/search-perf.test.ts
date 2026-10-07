// Search over a 20k index runs and finds what it should. The time it takes is recorded, never
// asserted (ADR-0032): `pnpm perf --palette` measures p50 and p95 at 5k, 20k and 50k entries, and
// the nightly perf-harness job keeps the numbers (A-03).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { IndexEntry } from '@marxy/core';
import { emptySession, recordOpen } from './session.ts';
import { prepareIndex, searchPrepared } from './search.ts';

const TREE = 20_000;
const SAMPLES = 80;

function makeEntry(i: number): IndexEntry {
  const dir = i % 200;
  return {
    path: `/repo/d${dir}/file-${i}.md`,
    root: i % 19 === 0 ? '/other' : '/repo',
    title: `Title ${i % 97} document ${i}`,
    headings: [
      { level: 2, text: `Heading ${i % 53} section`, byteOffset: 16 },
      { level: 3, text: `Detail ${i % 31}`, byteOffset: 48 },
    ],
    mtimeMs: 1_700_000_000_000 + i,
    size: 200 + (i % 500),
    lastReadMs: i % 20 === 0 ? 1_800_000_000_000 + i : undefined,
    kind: 'markdown',
  };
}

test('search on a 20,000-entry index runs every query and finds what is there', { timeout: 60_000 }, () => {
  const entries = Array.from({ length: TREE }, (_, i) => makeEntry(i));
  let session = emptySession('/repo');
  for (let i = 0; i < 40; i++) session = recordOpen(session, entries[i * 17]!.path);
  const prepared = prepareIndex(entries);
  const queries = [
    'title 1',
    'file-300',
    'heading 12',
    'detail',
    'document 99',
    'section',
    'xyz-no-such',
    't',
    'md',
    'd3/file',
  ];

  for (let i = 0; i < SAMPLES; i++) {
    const hits = searchPrepared(queries[i % queries.length]!, prepared, session);
    assert.ok(Array.isArray(hits));
  }

  // A query that names one file finds it.
  const named = searchPrepared('file-300', prepared, session);
  assert.ok(
    named.some((hit) => hit.entry.path === '/repo/d100/file-300.md'),
    `file-300 is in the index; got ${named.slice(0, 5).map((hit) => hit.entry.path).join(', ')}`,
  );
  assert.equal(searchPrepared('xyz-no-such', prepared, session).length, 0);
});
