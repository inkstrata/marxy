// The empty palette's sections (C-12): what is Pinned, Changed since you read and Recent, in what order.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { IndexEntry } from '@marxy/core';
import {
  changedSinceRead,
  emptyStateSections,
  relativeAge,
  type EmptyStateInput,
} from './empty-state.ts';
import { emptySession, recordOpen, togglePin, type PaletteSession } from './session.ts';

const NOW = 1_800_000_000_000;
const HOUR = 3_600_000;
const BASELINE = NOW - 100 * HOUR;

function entry(path: string, root: string, mtimeMs: number, lastReadMs?: number): IndexEntry {
  return { path, root, title: path, headings: [], mtimeMs, size: 1, kind: 'markdown', ...(lastReadMs === undefined ? {} : { lastReadMs }) };
}

function input(entries: readonly IndexEntry[], session: PaletteSession, extra?: Partial<EmptyStateInput>): EmptyStateInput {
  return {
    entriesByPath: new Map(entries.map((e) => [e.path, e])),
    session,
    nowMs: NOW,
    watched: (root) => root === '/w',
    baselineMs: (root) => (root === '/w' || root === '/u' ? BASELINE : undefined),
    ...extra,
  };
}

const paths = (sections: ReturnType<typeof emptyStateSections>) =>
  sections.map((s) => [s.kind, s.hits.map((h) => h.entry.path)] as const);

function opened(...list: [string, number][]): PaletteSession {
  let session = emptySession('/w');
  for (const [path, at] of list) session = recordOpen(session, path, undefined, at);
  return session;
}

test('read then modified is changed; read after modified is not', () => {
  const session = opened(['/w/stale.md', NOW - 5 * HOUR], ['/w/fresh.md', NOW - 5 * HOUR]);
  const entries = [entry('/w/stale.md', '/w', NOW - HOUR), entry('/w/fresh.md', '/w', NOW - 6 * HOUR)];
  assert.deepEqual(paths(emptyStateSections(input(entries, session))), [
    ['changed', ['/w/stale.md']],
    ['recent', ['/w/fresh.md']],
  ]);
});

test('never read: changed after the baseline, not before it', () => {
  const entries = [entry('/w/after.md', '/w', BASELINE + HOUR), entry('/w/before.md', '/w', BASELINE - HOUR)];
  assert.deepEqual(paths(emptyStateSections(input(entries, emptySession('/w')))), [['changed', ['/w/after.md']]]);
});

test('never read in a root with no baseline yet is not changed', () => {
  const entries = [entry('/w/a.md', '/w', NOW)];
  const sections = emptyStateSections(input(entries, emptySession('/w'), { baselineMs: () => undefined }));
  assert.deepEqual(sections, []);
});

test('a file in an unwatched root is never changed, however new', () => {
  const session = opened(['/u/new.md', NOW - 9 * HOUR]);
  const entries = [entry('/u/new.md', '/u', NOW - HOUR)];
  assert.deepEqual(paths(emptyStateSections(input(entries, session))), [['recent', ['/u/new.md']]]);
});

test('a pinned and changed file sits in Pinned only, with its changed state intact', () => {
  let session = opened(['/w/p.md', NOW - 5 * HOUR]);
  session = togglePin(session, '/w/p.md');
  const sections = emptyStateSections(input([entry('/w/p.md', '/w', NOW - HOUR)], session));
  assert.deepEqual(paths(sections), [['pinned', ['/w/p.md']]]);
  const only = sections[0]!.hits[0]!.entry;
  assert.equal(changedSinceRead(only, BASELINE), true, 'the entry carries the session read time, so the view can mark it');
});

test('Changed is newest first and capped at five; the overflow is left out of it', () => {
  const entries = Array.from({ length: 8 }, (_, i) => entry(`/w/c${i}.md`, '/w', BASELINE + (i + 1) * HOUR));
  const sections = emptyStateSections(input(entries, emptySession('/w')));
  assert.deepEqual(paths(sections), [['changed', ['/w/c7.md', '/w/c6.md', '/w/c5.md', '/w/c4.md', '/w/c3.md']]]);
});

test('twelve rows in all: pinned first, changed next, recent fills the rest, each path once', () => {
  let session = emptySession('/w');
  const entries: IndexEntry[] = [];
  for (let i = 0; i < 20; i++) {
    const path = `/u/r${i}.md`;
    entries.push(entry(path, '/u', 1));
    session = recordOpen(session, path, undefined, NOW - i * 1000);
  }
  for (let i = 0; i < 2; i++) {
    entries.push(entry(`/u/pin${i}.md`, '/u', 1));
    session = togglePin(recordOpen(session, `/u/pin${i}.md`, undefined, NOW - 9 * HOUR), `/u/pin${i}.md`);
  }
  for (let i = 0; i < 7; i++) entries.push(entry(`/w/c${i}.md`, '/w', BASELINE + (i + 1) * HOUR));
  const sections = emptyStateSections(input(entries, session));
  assert.deepEqual(sections.map((s) => [s.kind, s.hits.length]), [['pinned', 2], ['changed', 5], ['recent', 5]]);
  const all = sections.flatMap((s) => s.hits.map((h) => h.entry.path));
  assert.equal(all.length, 12);
  assert.equal(new Set(all).size, 12);
});

test('a path the index no longer holds is left out; empty sections are omitted', () => {
  const session = opened(['/w/gone.md', NOW]);
  assert.deepEqual(emptyStateSections(input([], session)), []);
});

test('changedSinceRead: a read time wins over the baseline', () => {
  assert.equal(changedSinceRead(entry('/a', '/w', 10, 20), 1), false);
  assert.equal(changedSinceRead(entry('/a', '/w', 30, 20), 99), true);
  assert.equal(changedSinceRead(entry('/a', '/w', 10), 5), true);
  assert.equal(changedSinceRead(entry('/a', '/w', 5), 5), false);
  assert.equal(changedSinceRead(entry('/a', '/w', 10), undefined), false);
});

test('relativeAge at each unit boundary', () => {
  const m = 60_000;
  const h = 60 * m;
  const d = 24 * h;
  const age = (delta: number) => relativeAge(NOW, NOW - delta);
  const table: [number, string][] = [
    [0, 'now'], [59_999, 'now'], [m, '1m'], [59 * m + 59_999, '59m'], [h, '1h'], [23 * h + 59 * m, '23h'],
    [d, '1d'], [13 * d + 23 * h, '13d'], [14 * d, '2w'], [51 * 7 * d + 6 * d, '51w'], [52 * 7 * d, '1y'], [800 * d, '2y'],
  ];
  for (const [delta, expected] of table) assert.equal(age(delta), expected, `${delta} ms`);
  assert.equal(relativeAge(NOW, NOW + 5 * h), 'now', 'a future time is now');
});
