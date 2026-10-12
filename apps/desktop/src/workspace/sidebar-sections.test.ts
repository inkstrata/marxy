// The sidebar's lists (W-07): order, the cap of eight, a pinned file not repeated, an unwatched folder not "changed".
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { IndexEntry } from '@marxy/core';
import { SIDEBAR_SECTION_IDS } from '@marxy/core/src/layout/workspace-storage.ts';
import { emptySession, type PaletteSession } from '../palette/session.ts';
import { SIDEBAR_RECENT_LIMIT, SIDEBAR_SECTIONS, sidebarSections } from './sidebar.ts';

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
