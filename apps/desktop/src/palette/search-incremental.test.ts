// Typing one letter more rescans only the rows the last keystroke matched, and the answer is the
// one a full scan gives (C-04). Rows can be patched between keystrokes without a rebuild.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { IndexEntry } from '@marxy/core';
import { emptySession, recordOpen } from './session.ts';
import {
  clearCandidateCache,
  hasSubsequence,
  prepareIndex,
  prepareStats,
  removeRows,
  searchPrepared,
  upsertRows,
} from './search.ts';

/** Small seeded generator (mulberry32) so a failure reproduces. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ALPHABET = 'abcdeflmnoprst-_ ./';

function word(rand: () => number, min: number, max: number): string {
  const n = min + Math.floor(rand() * (max - min + 1));
  let out = '';
  for (let i = 0; i < n; i++) out += ALPHABET[Math.floor(rand() * ALPHABET.length)];
  return out;
}

function makeEntry(rand: () => number, i: number): IndexEntry {
  const headings = Array.from({ length: Math.floor(rand() * 3) }, (_, h) => ({
    level: 2,
    text: word(rand, 3, 14),
    byteOffset: h * 16,
  }));
  return {
    path: `/${rand() < 0.2 ? 'other' : 'repo'}/${word(rand, 2, 6)}/${word(rand, 3, 12)}-${i}.md`,
    root: rand() < 0.2 ? '/other' : '/repo',
    // Now and then a long title, so a match can score <= 0 and still be a candidate.
    title: rand() < 0.03 ? word(rand, 200, 260) : word(rand, 3, 16),
    headings,
    mtimeMs: Math.floor(rand() * 5),
    size: 10,
    lastReadMs: rand() < 0.1 ? 1_800_000_000_000 + Math.floor(rand() * 4) : undefined,
    kind: 'markdown',
  };
}

function paths(hits: readonly { entry: IndexEntry }[]): string[] {
  return hits.map((hit) => hit.entry.path);
}

test('hasSubsequence: characters in order, not necessarily together', () => {
  assert.equal(hasSubsequence('detail view', 'dtv'), true);
  assert.equal(hasSubsequence('detail view', 'vd'), false);
  assert.equal(hasSubsequence('ab', 'abc'), false);
  assert.equal(hasSubsequence('anything', ''), true);
});

test('typed-ahead results equal a full scan with the cache cleared, across upserts and removals', () => {
  const rand = rng(0xc04);
  const entries = Array.from({ length: 5_000 }, (_, i) => makeEntry(rand, i));
  let session = emptySession('/repo');
  for (let i = 0; i < 30; i++) session = recordOpen(session, entries[i * 37]!.path);
  const incremental = prepareIndex(entries);
  const fresh = prepareIndex(entries);
  let extending = 0;
  let patched = 0;
  let nextId = 5_000;

  for (let seq = 0; seq < 500; seq++) {
    const pool = incremental.rows;
    const seed = pool[Math.floor(rand() * pool.length)]!.entry;
    const source = rand() < 0.5 ? seed.title : seed.path.slice(1 + Math.floor(rand() * 6));
    const target = source.toLowerCase().slice(0, 1 + Math.floor(rand() * 6));
    for (let len = 1; len <= target.length; len++) {
      if (rand() < 0.25) {
        // Patch between two keystrokes, to both copies the same way.
        const roll = rand();
        if (roll < 0.4) {
          const gone = pool[Math.floor(rand() * pool.length)]!.entry.path;
          removeRows(incremental, [gone]);
          removeRows(fresh, [gone]);
        } else if (roll < 0.7) {
          const changed = { ...pool[Math.floor(rand() * pool.length)]!.entry, title: word(rand, 3, 16) };
          upsertRows(incremental, [changed]);
          upsertRows(fresh, [changed]);
        } else {
          const added = makeEntry(rand, nextId++);
          upsertRows(incremental, [added]);
          upsertRows(fresh, [added]);
        }
        patched++;
      }
      const query = target.slice(0, len);
      const got = searchPrepared(query, incremental, session);
      clearCandidateCache(fresh);
      const want = searchPrepared(query, fresh, session);
      // The two indexes were patched identically, so their rows sit in the same order.
      assert.deepEqual(got, want, `query ${JSON.stringify(query)} (sequence ${seq}) differs from a full scan`);
      if (len > 1) extending++;
    }
  }
  assert.ok(extending > 500, `the run exercised ${extending} extending keystrokes`);
  assert.ok(patched > 100, `the run patched ${patched} times between keystrokes`);
});

test('an extending keystroke scores no more rows than the previous keystroke matched', () => {
  const rand = rng(7);
  const entries = Array.from({ length: 5_000 }, (_, i) => makeEntry(rand, i));
  const prepared = prepareIndex(entries);
  const session = emptySession('/repo');
  let previous = Number.POSITIVE_INFINITY;
  let narrowed = 0;
  for (const query of ['d', 'de', 'det', 'deta', 'detai']) {
    const before = prepareStats.rowsScored;
    searchPrepared(query, prepared, session);
    const scored = prepareStats.rowsScored - before;
    if (query === 'd') assert.equal(scored >= 1, true, 'the first keystroke scans every row');
    else {
      assert.ok(scored <= previous, `${query}: scored ${scored} rows, the previous keystroke matched ${previous}`);
      if (scored < previous) narrowed++;
    }
    previous = scored;
  }
  assert.ok(narrowed > 0, 'at least one keystroke narrowed the candidates');
  // A shorter query (backspace) is a full scan again: more rows than the longer one matched.
  const before = prepareStats.rowsScored;
  searchPrepared('de', prepared, session);
  assert.ok(prepareStats.rowsScored - before > previous);
});

test('upsertRows of one entry into a 50,000-row index prepares exactly one row', () => {
  const rand = rng(11);
  const entries = Array.from({ length: 50_000 }, (_, i) => makeEntry(rand, i));
  const prepared = prepareIndex(entries);
  assert.equal(prepared.rows.length, 50_000);
  const versionBefore = prepared.version;
  const calls = prepareStats.prepareRow;
  upsertRows(prepared, [{ ...entries[123]!, title: 'Renamed' }]);
  assert.equal(prepareStats.prepareRow - calls, 1);
  assert.equal(prepared.rows.length, 50_000);
  assert.ok(prepared.version > versionBefore);
  const hits = searchPrepared('renamed', prepared, emptySession('/repo'));
  assert.equal(hits[0]?.entry.path, entries[123]!.path);
  removeRows(prepared, [entries[123]!.path, '/not/in/the/index.md']);
  assert.equal(prepared.rows.length, 49_999);
  assert.equal(paths(searchPrepared('renamed', prepared, emptySession('/repo'))).includes(entries[123]!.path), false);
});

// A match can score zero or less (the score subtracts the length gap), yet it still counts for the
// next keystroke: "score > 0" is not monotone in the query, candidacy is.
test('a long title that scores <= 0 for "ac" is still a candidate, so "acd" finds it', () => {
  const title = 'a' + 'b'.repeat(200) + 'cd' + 'b'.repeat(47);
  assert.equal(title.length, 250);
  const entry: IndexEntry = { path: '/r/x.md', root: '/r', title, headings: [], mtimeMs: 1, size: 1, kind: 'markdown' };
  const prepared = prepareIndex([entry]);
  const session = emptySession('/r');
  assert.equal(searchPrepared('ac', prepared, session).length, 0);
  assert.equal(searchPrepared('acd', prepared, session).length, 1);
});
