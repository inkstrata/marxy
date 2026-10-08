// Content search in the palette (C-17): which queries are content queries, the three notices, the pause
// before a search, and that an answer arriving after a newer query is dropped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ContentHit, ContentSearchOptions, ContentSearchResult } from '@marxy/shell-api';
import { invisibleSegments, type InvisibleSegment } from '@marxy/core/src/render/index.ts';
import {
  contentQuery,
  createContentSearch,
  HINT_NOTICE,
  splitSegments,
  type ContentShell,
  type ContentState,
} from './content.ts';

const hit = (path: string): ContentHit => ({ path, line: 1, byteOffset: 0, preview: 'x', matchStart: 0, matchEnd: 1 });
const result = (hits: ContentHit[], truncated = false): ContentSearchResult => ({ hits, scannedFiles: 3, truncated });

interface Pending {
  readonly query: string;
  readonly opts: ContentSearchOptions;
  resolve(r: ContentSearchResult): void;
  reject(e: Error): void;
}

function fake() {
  const pending: Pending[] = [];
  const marks: string[] = [];
  const states: ContentState[] = [];
  const shell: ContentShell = {
    searchContent: (_paths, query, opts) =>
      new Promise((resolve, reject) => pending.push({ query, opts, resolve, reject })),
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

test('more than 20,000 files in scope: only the first 20,000 are searched, and the notice says so', async () => {
  const sent: number[] = [];
  const pending: Array<(r: ContentSearchResult) => void> = [];
  const states: ContentState[] = [];
  const shell: ContentShell = {
    searchContent: (paths) => {
      sent.push(paths.length);
      return new Promise((resolve) => pending.push(resolve));
    },
    mark: async () => {},
  };
  const paths = Array.from({ length: 20_001 }, (_, i) => `/r/${i}.md`);
  const search = createContentSearch(shell, () => ({ paths, roots: ['/r'] }), (s) => states.push(s), { debounceMs: 1, now: () => 0 });
  search.update('foo');
  await wait(30);
  assert.deepEqual(sent, [20_000]);
  pending[0]!(result([hit('/r/0.md')]));
  await wait(5);
  assert.equal(states.at(-1)!.notice, '1 match in 1 file. Searched the first 20,000 files in scope.');
});

test('the same phrase again keeps the rows and starts no second search; after a cancel it is searched afresh', async () => {
  const { pending, states, search } = fake();
  search.update('foo');
  await wait(80);
  pending[0]!.resolve(result([hit('/r/a.md')]));
  await wait(5);
  const seen = states.length;
  search.update('foo');
  await wait(80);
  assert.equal(states.length, seen, 'no "Searching…" flicker');
  assert.equal(pending.length, 1);
  search.cancel();
  search.update('foo');
  await wait(80);
  assert.equal(pending.length, 2, 'after a cancel the phrase is searched afresh');
});

test('after a failed search the same phrase is tried again', async () => {
  const { pending, states, search } = fake();
  search.update('foo');
  await wait(80);
  pending[0]!.reject(new Error('disk on fire'));
  await wait(5);
  assert.equal(states.at(-1)!.notice, 'Search failed: disk on fire');
  search.update('foo');
  await wait(80);
  assert.equal(pending.length, 2, 'the failure is not remembered as an answer');
  pending[1]!.resolve(result([hit('/r/a.md')]));
  await wait(5);
  assert.equal(states.at(-1)!.notice, '1 match in 1 file');
});

// What each slice shows: text as is, a flagged character as `<hex>`.
const shown = (segs: readonly InvisibleSegment[]): string =>
  segs.map((seg) => (seg.kind === 'text' ? seg.value : seg.kind === 'marker' ? `<${seg.cp.toString(16)}>` : '<tags>')).join('');
const cut = (text: string, match: string) => {
  const start = text.indexOf(match);
  return splitSegments(invisibleSegments(text, { inCode: false, sourceStart: 1 }), start, start + match.length).map(shown);
};

test('a preview is segmented whole, then cut into before, match and after', () => {
  assert.deepEqual(cut('a \u202ex zebra\u200bcrossing y', 'zebra\u200bcrossing'), ['a <202e>x ', 'zebra<200b>crossing', ' y']);
  assert.deepEqual(cut('plain text here', 'text'), ['plain ', 'text', ' here']);
  // An empty match leaves the middle empty.
  assert.deepEqual(splitSegments([{ kind: 'text', value: 'abc' }], 1, 1).map(shown), ['a', '', 'bc']);
});

test('a joiner at the edge of the match is judged with its neighbours, as Rendered judges it', () => {
  // The ZWJ after the man is inside an emoji sequence: no marker, though the match ends just before it.
  const family = 'family \u{1F468}\u200d\u{1F469}\u200d\u{1F467}';
  const slices = cut(family, 'ly \u{1F468}');
  assert.equal(slices.join(''), family, 'nothing is marked');
  assert.equal(slices[1], 'ly \u{1F468}');
  // A Persian ZWNJ between two Arabic-script letters, with the match ending at it.
  const persian = 'x \u0645\u06cc\u200c\u062e\u0648\u0627\u0647\u0645';
  assert.equal(cut(persian, 'x \u0645\u06cc').join(''), persian);
  // A ZWJ between plain letters is still flagged, in the slice it starts in.
  assert.deepEqual(cut('ab\u200dcd', 'ab'), ['', 'ab', '<200d>cd']);
});
