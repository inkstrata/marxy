// Keystroke to results p95 stays under 16 ms on a 20k index (ADR-0013).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { IndexEntry } from '@marxy/core';
import { emptySession, recordOpen } from './session.ts';
import { prepareIndex, searchPrepared } from './search.ts';

const TREE = 20_000;
const BUDGET_MS = 16;
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

function percentile(samples: number[], p: number): number {
  const sorted = samples.slice().sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index]!;
}

test('p95 keystroke-to-results is under 16 ms on a 20,000-entry index', { timeout: 60_000 }, () => {
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

  for (let round = 0; round < 3; round++) {
    for (const query of queries) searchPrepared(query, prepared, session);
  }

  const samples: number[] = [];
  for (let i = 0; i < SAMPLES; i++) {
    const query = queries[i % queries.length]!;
    const started = performance.now();
    const hits = searchPrepared(query, prepared, session);
    samples.push(performance.now() - started);
    assert.ok(hits.length >= 0);
  }

  const p95 = percentile(samples, 95);
  assert.ok(
    p95 < BUDGET_MS,
    `p95 keystroke-to-results ${p95.toFixed(2)} ms on ${TREE} entries; budget ${BUDGET_MS} ms`,
  );
});
