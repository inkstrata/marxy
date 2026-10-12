// The sidebar's lists (W-07): order, the cap of eight, a pinned file not repeated, an unwatched folder not "changed".
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { IndexEntry } from '@marxy/core';
import { SIDEBAR_SECTION_IDS } from '@marxy/core/src/layout/workspace-storage.ts';
import { emptySession, type PaletteSession } from '../palette/session.ts';
import { indexOnlyCount, SIDEBAR_RECENT_LIMIT, SIDEBAR_SECTIONS, sidebarSections, SmartCounts, smartRows } from './sidebar.ts';

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

test('rows come in file order with the counts held for them; one not made yet has none', () => {
  const queries = [{ name: 'One', q: 'kind:report' }, { name: 'Two', q: 'cache' }, { name: 'Three', q: 'is:pinned' }];
  const held = new Map<string, number | null>([['kind:report', 3], ['cache', null]]);
  assert.deepEqual(smartRows(queries, (q) => held.get(q)), [
    { name: 'One', q: 'kind:report', count: 3 },
    { name: 'Two', q: 'cache', count: null },
    { name: 'Three', q: 'is:pinned', count: null },
  ]);
  assert.deepEqual(smartRows([], () => 1), []);
});

const many = (n: number, path = '/w'): IndexEntry[] =>
  Array.from({ length: n }, (_, i) => ({ ...entry(`${path}/f${i}.md`, '/w', NOW - (i % 50) * HOUR), readerKind: i % 3 === 0 ? 'report' : 'notes', size: i % 5000 }));

test('asking for counts costs a patch almost nothing: 200 queries over 100,000 entries return at once and count nothing on the spot', async () => {
  const entries = many(100_000);
  const queries = Array.from({ length: 200 }, (_, i) => `kind:report size:>${i * 10} modified:<${(i % 40) + 1}h`);
  let ready = 0;
  const counts = new SmartCounts(() => ready++);
  const input = scope(entries);
  counts.request(queries, input, 'k');
  await new Promise((r) => setTimeout(r, 30)); // the first run begins at once; let it count its first slice
  // A patch: a new feed array each time. Many of them in a row, as a walk makes.
  const worst: number[] = [];
  for (let i = 0; i < 20; i++) {
    const patched = [...entries];
    const t = performance.now();
    counts.request(queries, scope(patched), 'k');
    worst.push(performance.now() - t);
  }
  counts.cancel();
  assert.ok(Math.max(...worst) < 25, `a request took ${Math.max(...worst).toFixed(1)} ms (budget 8 ms; generous margin for a loaded machine)`);
  assert.equal(counts.get(queries[199]!), undefined, 'the last query was not counted on the patch path');
});

test('a request that changes nothing starts no run; a patch starts one after a quiet moment, and its counts equal the library\'s rule', async () => {
  const entries = many(3000);
  const queries = ['kind:report', 'kind:notes size:>100', 'is:pinned', 'cache', 'words:>5', 'modified:<5h'];
  const counts = new SmartCounts(() => {});
  const input = scope(entries, sessionOf({ pinned: ['/w/f1.md'] }));
  counts.request(queries, input, 'k');
  await counts.settled();
  assert.equal(counts.runs, 1);
  for (const q of queries) assert.equal(counts.get(q), indexOnlyCount(q, input), q);
  assert.equal(counts.get('cache'), null);
  counts.request(queries, input, 'k');
  counts.request(queries, input, 'k');
  await counts.settled();
  assert.equal(counts.runs, 1, 'the same entries, session and clock: nothing to count again');
  // A patch: one entry gone. The old counts stand until the new ones land, then equal the rule.
  const patched = entries.filter((e) => e.path !== '/w/f0.md');
  counts.request(queries, scope(patched, sessionOf({ pinned: ['/w/f1.md'] })), 'k');
  assert.equal(counts.get('kind:report'), indexOnlyCount('kind:report', input), 'the old count shows until the new one lands');
  await counts.settled();
  assert.equal(counts.runs, 2);
  assert.equal(counts.get('kind:report'), indexOnlyCount('kind:report', scope(patched)));
  assert.equal(counts.get('kind:report'), indexOnlyCount('kind:report', input)! - 1);
});

test('a newer request replaces a run under way, a pin or a changed key counts again, and a folded section (no input) drops what waits', async () => {
  const entries = many(20_000);
  const queries = ['kind:report', 'kind:notes'];
  const counts = new SmartCounts(() => {});
  counts.request(queries, scope(entries), 'k');
  await new Promise((r) => setTimeout(r, 5));
  const fewer = entries.slice(0, 1000);
  counts.request(queries, scope(fewer), 'k');
  await counts.settled();
  assert.equal(counts.get('kind:report'), indexOnlyCount('kind:report', scope(fewer)), 'the counts are the newer request\'s');
  const runs = counts.runs;
  counts.request(queries, scope(fewer, sessionOf({ pinned: ['/w/f2.md'] })), 'k');
  await counts.settled();
  assert.equal(counts.runs, runs + 1, 'a pin changes what is:pinned means');
  counts.request(queries, scope(fewer, sessionOf({ pinned: ['/w/f2.md'] })), 'other watched roots');
  await counts.settled();
  assert.equal(counts.runs, runs + 2);
  counts.request(queries, null, 'k');
  counts.request(queries, scope(entries.slice(0, 5)), 'k');
  counts.request(queries, null, 'k');
  await counts.settled();
  assert.equal(counts.runs, runs + 2, 'folded: nothing counted');
  assert.equal(counts.get('kind:report'), indexOnlyCount('kind:report', scope(fewer)), 'the counts stand as they were');
});

test('a count stored by a run that was replaced is still announced: the next run, finding it equal, tells the view', async () => {
  // Large enough that B is still counting when C's quiet moment ends and C replaces it.
  const entries = (reports: number): IndexEntry[] => many(300_000).map((e, i) => ({ ...e, readerKind: i < reports ? ('report' as const) : ('notes' as const) }));
  const queries = ['kind:report', 'path:f size:>=0', 'path:f size:>=0 modified:<30d', 'size:>=0'];
  let shown: number | null | undefined;
  const counts = new SmartCounts(() => { shown = counts.get('kind:report'); });
  counts.request(queries, scope(entries(5)), 'k');
  await counts.settled();
  assert.equal(shown, 5);
  counts.request(queries, scope(entries(6)), 'k'); // B
  while (counts.get('kind:report') !== 6) await new Promise((r) => setTimeout(r, 2)); // B has stored its first count
  counts.request(queries, scope(entries(6)), 'k'); // C replaces B: every count equals what B stored
  await counts.settled();
  assert.equal(counts.get('kind:report'), 6);
  assert.equal(shown, 6, 'the view was told, though C changed nothing it had stored');
});
