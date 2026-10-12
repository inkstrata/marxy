// The sidebar's lists (W-07): order, the cap of eight, a pinned file not repeated, an unwatched folder not "changed".
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { IndexEntry } from '@marxy/core';
import { SIDEBAR_SECTION_IDS } from '@marxy/core/src/layout/workspace-storage.ts';
import { emptySession, type PaletteSession } from '../palette/session.ts';
import { indexOnlyCount, SIDEBAR_RECENT_LIMIT, SIDEBAR_SECTIONS, sidebarSections, smartRows } from './sidebar.ts';

const NOW = 1_000_000_000;
const HOUR = 3_600_000;
const entry = (path: string, root: string, mtimeMs: number, lastReadMs?: number): IndexEntry => ({
  path, root, title: path.slice(path.lastIndexOf('/') + 1), headings: [], mtimeMs, size: 1, kind: 'markdown', ...(lastReadMs === undefined ? {} : { lastReadMs }),
});
const sessionOf = (over: Partial<PaletteSession>): PaletteSession => ({ ...emptySession('/w'), ...over });
const input = (entries: IndexEntry[], session: PaletteSession, over: { watched?: (r: string) => boolean; baseline?: number } = {}) => ({
  entriesByPath: new Map(entries.map((e) => [e.path, e])),
  session,
  nowMs: NOW,
  watched: over.watched ?? ((root: string) => root === '/w'),
  baselineMs: () => over.baseline ?? NOW - 100 * HOUR,
});
const shape = (sections: ReturnType<typeof sidebarSections>) => sections.map((s) => [s.id, s.rows.map((r) => `${r.mark}:${r.entry.path}`)]);

test('the section ids the file remembers are the ones the sidebar draws, in the same order', () => {
  assert.deepEqual(SIDEBAR_SECTIONS.map((s) => s.id), [...SIDEBAR_SECTION_IDS]);
});

test('ten files opened: Recent shows eight, newest first', () => {
  const files = Array.from({ length: 10 }, (_, i) => `/w/f${i}.md`);
  const entries = files.map((p) => entry(p, '/w', NOW - 50 * HOUR, NOW - 40 * HOUR));
  // mru is newest first: f9 was opened last.
  const session = sessionOf({ mru: [...files].reverse(), readAt: Object.fromEntries(files.map((p) => [p, NOW - 40 * HOUR])) });
  const out = sidebarSections(input(entries, session));
  assert.equal(out.length, 1);
  assert.equal(out[0]!.id, 'recent');
  assert.equal(SIDEBAR_RECENT_LIMIT, 8);
  assert.deepEqual(out[0]!.rows.map((r) => r.entry.path), files.slice(2).reverse());
});

test('a pinned file is under Pinned and not repeated in Recent; Changed follows the pinned', () => {
  const a = entry('/w/a.md', '/w', NOW - 50 * HOUR, NOW - 40 * HOUR);
  const b = entry('/w/b.md', '/w', NOW - 50 * HOUR, NOW - 40 * HOUR);
  const edited = entry('/w/edited.md', '/w', NOW - HOUR, NOW - 40 * HOUR);
  const session = sessionOf({ pinned: ['/w/a.md'], mru: ['/w/b.md', '/w/a.md', '/w/edited.md'], readAt: { '/w/a.md': NOW - 40 * HOUR, '/w/b.md': NOW - 40 * HOUR, '/w/edited.md': NOW - 40 * HOUR } });
  assert.deepEqual(shape(sidebarSections(input([a, b, edited], session))), [
    ['recent', ['recent:/w/b.md']],
    ['pinned', ['pinned:/w/a.md', 'changed:/w/edited.md']],
  ]);
});

test('a file modified after it was read is Changed; one in a folder that is not watched is not', () => {
  const inWatched = entry('/w/new.md', '/w', NOW - HOUR, NOW - 40 * HOUR);
  const inOther = entry('/o/new.md', '/o', NOW - HOUR, NOW - 40 * HOUR);
  const session = sessionOf({ readAt: { '/w/new.md': NOW - 40 * HOUR, '/o/new.md': NOW - 40 * HOUR } });
  assert.deepEqual(shape(sidebarSections(input([inWatched, inOther], session))), [['pinned', ['changed:/w/new.md']]]);
});

test('a section with nothing in it is not in the list', () => {
  assert.deepEqual(sidebarSections(input([], emptySession('/w'))), []);
});

// --- Smart collections (Q-07) ---------------------------------------------------------------------------------------

const scope = (entries: IndexEntry[], session: PaletteSession = emptySession('/w')) => ({
  entries,
  declared: [] as string[],
  session,
  nowMs: NOW,
  watched: (r: string) => r === '/w',
  baselineMs: () => NOW - 100 * HOUR,
});
const report = (path: string, extra: Partial<IndexEntry> = {}): IndexEntry => ({ ...entry(path, '/w', NOW - HOUR), readerKind: 'report', ...extra });

test('Smart collections is the last section, and sidebarSections never fills it (the rows come from collection.toml)', () => {
  assert.equal(SIDEBAR_SECTIONS.at(-1)?.id, 'smart');
  assert.equal(SIDEBAR_SECTIONS.at(-1)?.title, 'Smart collections');
  const out = sidebarSections(input([entry('/w/a.md', '/w', NOW, NOW)], sessionOf({ mru: ['/w/a.md'], readAt: { '/w/a.md': NOW } })));
  assert.ok(!out.some((s) => s.id === 'smart'));
});

test('a count is the number of files the index keys match among all the files', () => {
  const all = [report('/w/a.md'), report('/w/b.md'), entry('/w/c.md', '/w', NOW - HOUR), report('/w/d.md', { readerKind: 'notes' })];
  assert.equal(indexOnlyCount('kind:report', scope(all)), 2);
  assert.equal(indexOnlyCount('kind:report OR kind:notes', scope(all)), 3);
  assert.equal(indexOnlyCount('-kind:report', scope(all)), 2);
  assert.equal(indexOnlyCount('is:pinned', scope(all, sessionOf({ pinned: ['/w/c.md'] }))), 1);
  assert.equal(indexOnlyCount('modified:<30m', scope(all)), 0);
  assert.equal(indexOnlyCount('modified:<2h', scope(all)), 4);
  assert.equal(indexOnlyCount('kind:', scope(all)), 4, 'a term the parser ignores filters nothing');
});

test('a query that needs files read has no count here: a word of two letters or more, words:, has:, tasks:', () => {
  const all = [report('/w/a.md')];
  for (const q of ['cache', 'kind:report cache', '"a phrase"', 'words:>2000', 'kind:report words:>2000', 'has:code', 'tasks:>0']) {
    assert.equal(indexOnlyCount(q, scope(all)), null, q);
  }
  assert.equal(indexOnlyCount('a kind:report', scope(all)), 1, 'a one-letter word is matched on the index alone, as the library does');
});

test('rows come in file order; nothing is evaluated while the section is folded', () => {
  const queries = [{ name: 'One', q: 'kind:report' }, { name: 'Two', q: 'cache' }];
  const poisoned = new Proxy(scope([]), { get: (_t, key) => { throw new Error(`touched ${String(key)}`); } });
  assert.deepEqual(smartRows(queries, poisoned, false), [{ name: 'One', q: 'kind:report', count: null }, { name: 'Two', q: 'cache', count: null }]);
  assert.deepEqual(smartRows(queries, scope([report('/w/a.md')]), true), [{ name: 'One', q: 'kind:report', count: 1 }, { name: 'Two', q: 'cache', count: null }]);
  assert.deepEqual(smartRows([], scope([]), true), []);
});
