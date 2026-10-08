// Content search in the palette (C-17): which queries are content queries, the three notices, the pause
// before a search, and that an answer arriving after a newer query is dropped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ContentHit, ContentSearchOptions, ContentSearchResult } from '@marxy/shell-api';
import { contentQuery, createContentSearch, HINT_NOTICE, type ContentShell, type ContentState } from './content.ts';

const hit = (path: string): ContentHit => ({ path, line: 1, byteOffset: 0, preview: 'x', matchStart: 0, matchEnd: 1 });
const result = (hits: ContentHit[], truncated = false): ContentSearchResult => ({ hits, scannedFiles: 3, truncated });

interface Pending {
  readonly query: string;
  readonly opts: ContentSearchOptions;
  resolve(r: ContentSearchResult): void;
}

function fake() {
  const pending: Pending[] = [];
  const marks: string[] = [];
  const states: ContentState[] = [];
  const shell: ContentShell = {
    searchContent: (_paths, query, opts) =>
      new Promise((resolve) => pending.push({ query, opts, resolve })),
    mark: async (name, _t, data) => {
      marks.push(`${name} ${data ?? ''}`);
    },
  };
  const search = createContentSearch(shell, () => ({ paths: ['/r/a.md'], roots: ['/r'] }), (s) => states.push(s), {
    debounceMs: 30,
    now: () => 0,
  });
  return { pending, marks, states, search };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('a query starting with / is a content query; anything else is fuzzy', () => {
  assert.equal(contentQuery('/foo'), 'foo');
  assert.equal(contentQuery('  /baseline grid '), 'baseline grid');
  assert.equal(contentQuery('/'), '');
  assert.equal(contentQuery('foo/bar'), null);
  assert.equal(contentQuery('>foo'), null);
  assert.equal(contentQuery(''), null);
});

test('under two characters the notice is the hint and nothing is searched', async () => {
  const { pending, states, search } = fake();
  search.update('');
  search.update('a');
  await wait(80);
  assert.equal(pending.length, 0);
  assert.deepEqual(states.map((s) => s.notice), [HINT_NOTICE, HINT_NOTICE]);
});

test('a burst of keystrokes starts one search, after the pause', async () => {
  const { pending, search } = fake();
  search.update('ba');
  await wait(5);
  search.update('bas');
  await wait(5);
  search.update('base');
  await wait(5);
  assert.equal(pending.length, 0, 'each keystroke restarts the pause');
  await wait(80);
  assert.equal(pending.length, 1);
  assert.equal(pending[0]!.query, 'base');
});

test('the notices: Searching…, N matches in M files, No matches, Showing the first N matches', async () => {
  const { pending, states, search, marks } = fake();
  search.update('foo');
  assert.equal(states.at(-1)!.notice, 'Searching…');
  await wait(80);
  pending[0]!.resolve(result([hit('/r/a.md'), hit('/r/a.md'), hit('/r/b.md')]));
  await wait(5);
  assert.equal(states.at(-1)!.notice, '3 matches in 2 files');
  assert.match(marks[0]!, /^content_search ms=0\.0 hits=3$/);

  search.update('nothing');
  await wait(80);
  pending[1]!.resolve(result([]));
  await wait(5);
  assert.equal(states.at(-1)!.notice, 'No matches');

  search.update('many');
  await wait(80);
  pending[2]!.resolve(result(Array.from({ length: 200 }, () => hit('/r/a.md')), true));
  await wait(5);
  assert.equal(states.at(-1)!.notice, 'Showing the first 200 matches');
});

test('a slow first response arriving after a second query is dropped, and the first search is aborted', async () => {
  const { pending, states, search } = fake();
  search.update('first');
  await wait(80);
  search.update('second');
  assert.equal(pending[0]!.opts.signal?.aborted, true);
  await wait(80);
  pending[1]!.resolve(result([hit('/r/second.md')]));
  await wait(5);
  assert.equal(states.at(-1)!.hits[0]!.path, '/r/second.md');
  pending[0]!.resolve(result([hit('/r/first.md')]));
  await wait(5);
  assert.equal(states.at(-1)!.hits[0]!.path, '/r/second.md');
});

test('cancel drops an answer still to come', async () => {
  const { pending, states, search } = fake();
  search.update('foo');
  await wait(80);
  search.cancel();
  const before = states.length;
  pending[0]!.resolve(result([hit('/r/a.md')]));
  await wait(5);
  assert.equal(states.length, before);
});
