import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { IndexEntry } from '@marxy/core';
import { activeItem, chooseFacet, facetMenus } from './facets.ts';

const NOW = 1_000_000_000_000;
const DAY = 86_400_000;
const e = (path: string, readerKind: string | undefined, ageDays: number): IndexEntry =>
  ({ path, root: '/r', title: path, headings: [], mtimeMs: NOW - ageDays * DAY, size: 1, kind: 'markdown', readerKind }) as unknown as IndexEntry;
const input = (entries: IndexEntry[], extra: Partial<Parameters<typeof facetMenus>[0]> = {}) =>
  ({ entries, nowMs: NOW, pinned: new Set<string>(), recent: new Set<string>(), changed: () => false, ...extra });

test('a menu with nothing behind it is not offered', () => {
  assert.deepEqual(facetMenus(input([])), []);
  const menus = facetMenus(input([e('/r/a.md', undefined, 100)]));
  assert.deepEqual(menus, [], 'no kind known, nothing pinned, nothing recent, nothing in the last month');
});

test('kinds are the ones the scope holds, commonest first; statuses and ages only with a count', () => {
  const entries = [e('/r/a.md', 'report', 0.5), e('/r/b.md', 'notes', 3), e('/r/c.md', 'report', 40)];
  const menus = facetMenus(input(entries, { pinned: new Set(['/r/b.md']) }));
  assert.deepEqual(menus.map((m) => m.id), ['kind', 'status', 'modified']);
  assert.deepEqual(menus[0]!.items.map((i) => [i.term, i.count]), [['kind:report', 2], ['kind:notes', 1]]);
  assert.deepEqual(menus[1]!.items.map((i) => [i.term, i.count]), [['is:pinned', 1]]);
  assert.deepEqual(menus[2]!.items.map((i) => [i.term, i.count]), [['modified:<1d', 1], ['modified:<7d', 2], ['modified:<30d', 2]]);
});

test('choosing writes a term into the text, replaces the menu\'s other term, and choosing again takes it out', () => {
  const entries = [e('/r/a.md', 'report', 0.5), e('/r/b.md', 'notes', 3), e('/r/c.md', 'report', 3)];
  const [kind] = facetMenus(input(entries));
  const [report, notes] = kind!.items;
  assert.equal(chooseFacet('cache', kind!, report!), 'cache kind:report');
  assert.equal(chooseFacet('cache kind:report', kind!, notes!), 'cache kind:notes');
  assert.equal(chooseFacet('cache kind:report', kind!, report!), 'cache');
  assert.equal(chooseFacet('', kind!, report!), 'kind:report');
  assert.equal(chooseFacet('-kind:notes', kind!, report!), '-kind:notes kind:report', 'a negated term is the reader\'s own');
  assert.equal(activeItem('kind:report cache', kind!)?.term, 'kind:report');
  assert.equal(activeItem('cache', kind!), undefined);
});

test('Status replaces only status values of is:', () => {
  const entries = [e('/r/a.md', 'report', 0.5)];
  const status = facetMenus(input(entries, { pinned: new Set(['/r/a.md']), recent: new Set(['/r/a.md']) })).find((m) => m.id === 'status');
  const [pinned, recent] = status!.items;
  assert.equal(pinned!.term, 'is:pinned');
  assert.equal(chooseFacet('is:unread is:pinned', status!, recent!), 'is:unread is:recent');
});
