// The empty palette's sections: what is Pinned, Changed since you read and Recent, in what order.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { IndexEntry } from '@marxy/core';
import { emptyStateSections, relativeAge, spokenAge, suggestedCommands, SUGGESTED_COMMAND_IDS, type EmptyStateInput } from './empty-state.ts';
import type { AppContext, Command } from '../commands/registry.ts';
import { emptySession, recordOpen, type PaletteSession } from './session.ts';

const NOW = 1_800_000_000_000;

function entry(path: string, root: string, mtimeMs: number, lastReadMs?: number): IndexEntry {
  return { path, root, title: path, headings: [], mtimeMs, size: 1, kind: 'markdown', ...(lastReadMs === undefined ? {} : { lastReadMs }) };
}

function input(entries: readonly IndexEntry[], session: PaletteSession, extra?: Partial<EmptyStateInput>): EmptyStateInput {
  return {
    entriesByPath: new Map(entries.map((e) => [e.path, e])),
    session,
    nowMs: NOW,
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

test('a path the index no longer holds is left out; empty sections are omitted', () => {
  const session = opened(['/w/gone.md', NOW]);
  assert.deepEqual(emptyStateSections(input([], session)), []);
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

test('spokenAge says the units in words', () => {
  assert.deepEqual(['now', '1m', '4m', '3h', '1d', '5w', '1y'].map(spokenAge), [
    'just now', '1 minute ago', '4 minutes ago', '3 hours ago', '1 day ago', '5 weeks ago', '1 year ago',
  ]);
});

test('relativeAge: a zero, negative or missing time has no age', () => {
  const now = 1_800_000_000_000;
  assert.equal(relativeAge(now, now - 3_600_000), '1h');
  assert.equal(relativeAge(now, 0), '');
  assert.equal(relativeAge(now, -5), '');
  assert.equal(relativeAge(now, undefined), '');
  assert.equal(relativeAge(now, Number.NaN), '');
});

test('suggestedCommands lists the named commands that apply, in the written order, and no others', () => {
  const c = (id: string, ok = true): Command => ({ id, title: id, group: 'view', when: () => ok, run: async () => {} });
  const all = [c('x.other'), ...[...SUGGESTED_COMMAND_IDS].reverse().map((id) => c(id))];
  const ctx = {} as AppContext;
  assert.deepEqual(suggestedCommands(all, ctx).map((cmd) => cmd.id), [...SUGGESTED_COMMAND_IDS]);
  const none = [c(SUGGESTED_COMMAND_IDS[0]!, false)];
  assert.deepEqual(suggestedCommands(none, ctx), []);
});
