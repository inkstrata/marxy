// W-13.1: `@` answers from the heading index in memory. The proof is a count of what was looked at and scored,
// never a time (ADR-0032): 50,000 files, 100,000 headings, and a query that must not score most of them.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { IndexEntry } from '@marxy/core';
import { emptySession } from './session.ts';
import { headingIndexShape, paletteResults, prepareIndex, removeRows, sectionStats, upsertRows } from './search.ts';

const FILES = 50_000;
const TOPICS = ['alpha', 'bravo', 'delta', 'gamma', 'omega', 'kappa', 'sigma', 'theta', 'zeta', 'ruby'];

function make(i: number, heading = `Topic ${TOPICS[i % TOPICS.length]} ${i}`): IndexEntry {
  return {
    path: `/repo/d${i % 200}/file-${i}.md`,
    root: '/repo',
    title: `File ${i}`,
    headings: [
      { level: 2, text: i % 500 === 7 ? 'Installing the tool' : heading, byteOffset: 16 },
      { level: 3, text: `Detail ${i % 31}`, byteOffset: 48 },
    ],
    mtimeMs: 1_700_000_000_000 + i,
    size: 300,
    kind: 'markdown',
  };
}

const session = emptySession('/repo');
const at = (prepared: ReturnType<typeof prepareIndex>, q: string) => paletteResults(q, [], session, { prepared });
const tally = <T>(run: () => T): { out: T; visited: number; scored: number } => {
  sectionStats.visited = 0;
  sectionStats.scored = 0;
  const out = run();
  return { out, visited: sectionStats.visited, scored: sectionStats.scored };
};

test('@ on 100,000 headings scores the few that could match, and a longer query looks only at the last one\'s matches', { timeout: 120_000 }, () => {
  const entries = Array.from({ length: FILES }, (_, i) => make(i));
  const prepared = prepareIndex(entries);
  const total = FILES * 2;

  const first = tally(() => at(prepared, '@insta'));
  assert.equal(first.out[0]?.entry.headings[first.out[0].heading ?? 0]?.text, 'Installing the tool');
  assert.equal(first.visited, total, 'the first keystroke goes through the index once');
  assert.ok(first.scored < total / 10, `scored ${first.scored} of ${total} headings: a heading without the needle's letters is passed by its mask`);

  const second = tally(() => at(prepared, '@instal'));
  assert.ok(second.visited < first.scored + 1, `the next keystroke looked at ${second.visited}, the last query matched ${first.scored}`);
  assert.ok(second.visited < total / 100, 'and that is far fewer than the index');
  assert.equal(second.out[0]?.entry.headings[second.out[0].heading ?? 0]?.text, 'Installing the tool');
});

test('the heading index follows upsertRows and removeRows: it answers as a freshly built index would', () => {
  const entries = Array.from({ length: 3000 }, (_, i) => make(i));
  const live = prepareIndex(entries);
  at(live, '@insta');
  upsertRows(live, [make(1, 'Zebra crossing'), make(9999, 'Zebra herd')]);
  removeRows(live, [entries[507]!.path, entries[2]!.path]);
  const now = entries.filter((e) => e.path !== entries[507]!.path && e.path !== entries[2]!.path);
  now[1] = make(1, 'Zebra crossing');
  now.push(make(9999, 'Zebra herd'));
  const fresh = prepareIndex(now);
  const names = (prepared: typeof live, q: string) => at(prepared, q).map((hit) => `${hit.entry.path}#${hit.heading}`).sort();
  for (const q of ['@zebra', '@insta', '@topic', '@detail 3']) assert.deepEqual(names(live, q), names(fresh, q), q);
  assert.ok(names(live, '@zebra').length === 2, 'a renamed heading and a new file are found');
  assert.equal(names(live, '@insta').some((n) => n.includes('file-507.md')), false, 'a removed file is gone');
});

test('replacing the same files over and over does not grow what @ walks', () => {
  const entries = Array.from({ length: 2000 }, (_, i) => make(i));
  const prepared = prepareIndex(entries);
  for (let round = 0; round < 8; round++) upsertRows(prepared, entries.map((e, i) => make(i, `Round ${round} ${i}`)));
  const { visited } = tally(() => at(prepared, '@round'));
  assert.ok(visited <= 2000 * 2 * 2, `walked ${visited} refs for ${2000 * 2} live headings`);
});

test('the heading index holds flat typed arrays, not an object per heading (W-13.2)', () => {
  const entries = Array.from({ length: 5000 }, (_, i) => make(i));
  const prepared = prepareIndex(entries);
  const shape = headingIndexShape(prepared);
  assert.equal(shape.headings, 10_000);
  assert.ok(shape.masks instanceof Uint32Array && shape.masks.length >= shape.headings, 'one mask per heading, in one array');
  assert.ok(shape.slotStart instanceof Uint32Array && shape.slotStart.length >= shape.slots + 1, 'offsets in one array');
  assert.equal(shape.slots, 5000, 'one slot per row, not per heading');
  // Nothing the index holds is a list with an entry per heading.
  for (const [name, value] of Object.entries(prepared)) {
    if (Array.isArray(value)) assert.ok(value.length <= entries.length, `${name} has ${value.length} entries for ${entries.length} rows`);
  }
});
