// The library's evaluator (Q-03): the table is the spec. Every key of the grammar, negation, OR, "any of",
// the flagged terms as the parser says them, the reasons for each hit, the measure for the content keys.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { IndexEntry } from '../contracts/index-entry.ts';
import {
  evaluateQuery,
  indexCandidates,
  measureText,
  parseQuery,
  QUERY_KEYS,
  termNote,
  textTerms,
  usesContentKeys,
  type LineMatches,
  type Measured,
  type QueryContext,
} from './index.ts';

const NOW = new Date(2026, 9, 11, 15, 0, 0).getTime();
const H = 3_600_000;
const D = 24 * H;

const entry = (path: string, over: Partial<IndexEntry> = {}): IndexEntry => ({
  path,
  root: '/r',
  title: path.split('/').pop()!.replace(/\.\w+$/, ''),
  headings: [],
  mtimeMs: NOW - D,
  size: 1000,
  kind: 'markdown',
  readerKind: 'article',
  ...over,
});

const FIXTURE: readonly IndexEntry[] = [
  entry('/r/README.md', { title: 'Marxy', readerKind: 'readme', headings: [{ level: 1, text: 'Marxy', byteOffset: 0 }, { level: 2, text: 'Cache layout', byteOffset: 10 }], mtimeMs: NOW - 3 * H, size: 4_000 }),
  entry('/r/plans/cache.md', { root: '/r/plans', title: 'Cache plan', readerKind: 'report', mtimeMs: NOW - 2 * D, size: 60_000 }),
  entry('/r/plans/archive/old-cache.md', { root: '/r/plans', title: 'Old cache', readerKind: 'report', mtimeMs: NOW - 90 * D }),
  entry('/r/plans/README.md', { root: '/r/plans', title: 'Plans', readerKind: 'readme', mtimeMs: NOW - 40 * D }),
  entry('/r/notes/standup.md', { title: 'Standup', readerKind: 'notes', mtimeMs: NOW - 30 * 60_000, size: 200 }),
  entry('/r/src/app.ts', { title: 'app.ts', kind: 'source', readerKind: 'code', size: 2_000_000 }),
  entry('/s/transcripts/call.txt', { root: '/s', title: 'call.txt', kind: 'text', readerKind: 'transcript' }),
  entry('/s/loose.md', { root: '/s', title: 'Loose', readerKind: undefined }),
];

const ctx = (over: Partial<QueryContext> = {}): QueryContext => ({
  nowMs: NOW,
  pinned: new Set(['/r/notes/standup.md']),
  recent: new Set(['/r/README.md', '/r/notes/standup.md']),
  changed: (e) => e.path === '/r/plans/cache.md',
  collections: (root) => (root === '/r' ? ['repo', 'r'] : root === '/r/plans' ? ['Plans'] : ['Scratch', 's']),
  ...over,
});

const run = (q: string, over: Partial<QueryContext> = {}): string[] =>
  evaluateQuery(parseQuery(q), FIXTURE, ctx(over)).map((h) => h.entry.path);
const hitOf = (q: string, path: string, over: Partial<QueryContext> = {}) =>
  evaluateQuery(parseQuery(q), FIXTURE, ctx(over)).find((h) => h.entry.path === path);

/** The hand-written filter the query stands for. */
const by = (f: (e: IndexEntry) => boolean): string[] => FIXTURE.filter(f).map((e) => e.path);

test('an empty query, or one whose terms are all ignored, is every entry with no reason', () => {
  for (const q of ['', '   ', 'words:>', 'words:>ONE']) {
    const hits = evaluateQuery(parseQuery(q), FIXTURE, ctx());
    assert.equal(hits.length, FIXTURE.length, q);
    assert.ok(hits.every((h) => h.why.length === 0 && !h.unmeasured), q);
  }
});

test('the card: kind:readme in:plans -path:archive equals the hand-written filter, with each reason', () => {
  assert.deepEqual(run('kind:readme in:plans -path:archive'), by((e) => e.readerKind === 'readme' && e.root === '/r/plans' && !e.path.includes('archive')));
  assert.deepEqual(run('kind:readme in:plans -path:archive'), ['/r/plans/README.md']);
  const hit = hitOf('kind:readme in:plans -path:archive', '/r/plans/README.md')!;
  assert.deepEqual(hit.why, [
    { kind: 'field', label: 'kind:readme' },
    { kind: 'field', label: 'in:plans' },
  ], 'a negated term that passes gives no reason: the absence is not a match');
});

test('kind: by id or name prefix, any of, and nothing for an entry whose kind is not decided', () => {
  assert.deepEqual(run('kind:trans'), ['/s/transcripts/call.txt']);
  assert.deepEqual(run('kind:report,transcript'), by((e) => e.readerKind === 'report' || e.readerKind === 'transcript'));
  assert.deepEqual(run('-kind:report'), by((e) => e.readerKind !== 'report'), 'an undecided entry is not a report');
  assert.deepEqual(run('kind:REPORT'), by((e) => e.readerKind === 'report'), 'case does not matter');
});

test('in: names a collection, by any name it answers to', () => {
  assert.deepEqual(run('in:repo'), by((e) => e.root === '/r'));
  assert.deepEqual(run('in:scratch'), by((e) => e.root === '/s'));
  assert.deepEqual(run('in:PLANS'), by((e) => e.root === '/r/plans'));
  assert.deepEqual(run('in:repo,scratch,plans'), FIXTURE.map((e) => e.path));
  assert.deepEqual(run('in:notes'), [], 'a folder inside a collection is not a collection');
  const bare = evaluateQuery(parseQuery('in:plans'), FIXTURE, { ...ctx(), collections: undefined });
  assert.equal(bare.length, 3, 'with no names given a collection answers to its folder name');
});

test('path: is the path under its root, case-insensitive, any of', () => {
  assert.deepEqual(run('path:archive/'), ['/r/plans/archive/old-cache.md']);
  assert.deepEqual(run('path:ARCHIVE'), ['/r/plans/archive/old-cache.md']);
  assert.deepEqual(run('path:plans'), [], 'the root is not part of the path searched');
  assert.deepEqual(run('path:/r/'), [], 'nor is anything above it');
  assert.deepEqual(run('path:notes,src'), ['/r/notes/standup.md', '/r/src/app.ts']);
});

test('modified: ages are younger-than or older-than; today and yesterday are calendar days', () => {
  assert.deepEqual(run('modified:<2h'), ['/r/notes/standup.md']);
  assert.deepEqual(run('modified:<4h'), ['/r/README.md', '/r/notes/standup.md']);
  assert.deepEqual(run('modified:>30d'), ['/r/plans/archive/old-cache.md', '/r/plans/README.md']);
  assert.deepEqual(run('modified:<7d -path:src -path:/s/'), by((e) => NOW - e.mtimeMs < 7 * D && !e.path.includes('src')));
  assert.deepEqual(run('modified:today'), ['/r/README.md', '/r/notes/standup.md'], 'since local midnight');
  assert.ok(run('modified:yesterday').includes('/r/plans/cache.md') === false, 'two days ago is not yesterday');
  assert.ok(run('modified:yesterday').includes('/r/src/app.ts'), 'a day ago, at 15:00, was yesterday');
});

test('size: compares bytes', () => {
  assert.deepEqual(run('size:>1mb'), ['/r/src/app.ts']);
  assert.deepEqual(run('size:<500'), ['/r/notes/standup.md']);
  assert.deepEqual(run('size:>=60kb'), ['/r/src/app.ts']);
  assert.deepEqual(run('size:200'), ['/r/notes/standup.md']);
});

test('is: statuses; the unavailable ones parse and match nothing', () => {
  assert.deepEqual(run('is:changed'), ['/r/plans/cache.md']);
  assert.deepEqual(run('is:pinned'), ['/r/notes/standup.md']);
  assert.deepEqual(run('is:recent'), ['/r/README.md', '/r/notes/standup.md']);
  assert.deepEqual(run('is:pinned,changed'), ['/r/plans/cache.md', '/r/notes/standup.md']);
  for (const v of ['dup', 'broken', 'archived', 'error', 'captured']) {
    assert.deepEqual(run(`is:${v}`), [], `is:${v} matches nothing`);
    assert.equal(run(`-is:${v}`).length, FIXTURE.length, `-is:${v} excludes nothing`);
    assert.equal(termNote(parseQuery(`is:${v}`).groups[0]![0]!), 'not available yet');
  }
  assert.equal(termNote(parseQuery('is:changed').groups[0]![0]!), null);
});

test('is:read and is:unread follow the read time against the modification time', () => {
  const read = new Map([['/r/README.md', NOW], ['/r/plans/cache.md', NOW - 5 * D]]);
  const readAt = (e: IndexEntry) => read.get(e.path);
  assert.deepEqual(run('is:read', { readAt }), ['/r/README.md']);
  assert.equal(run('is:unread', { readAt }).length, FIXTURE.length - 1, 'a file changed after it was read is unread again');
  assert.ok(run('is:unread', { readAt }).includes('/r/plans/cache.md'));
});

test('the reason of is:changed says what the reader knows it as', () => {
  assert.deepEqual(hitOf('is:changed', '/r/plans/cache.md')!.why, [{ kind: 'field', label: 'changed since you read' }]);
  assert.deepEqual(hitOf('is:pinned', '/r/notes/standup.md')!.why, [{ kind: 'field', label: 'is:pinned' }]);
});

test('text: title, path and heading, each with its reason; smart case', () => {
  assert.deepEqual(run('cache'), ['/r/README.md', '/r/plans/cache.md', '/r/plans/archive/old-cache.md']);
  assert.deepEqual(hitOf('cache', '/r/plans/cache.md')!.why, [{ kind: 'title' }, { kind: 'path' }]);
  assert.deepEqual(hitOf('cache', '/r/README.md')!.why, [{ kind: 'heading', text: 'Cache layout', level: 2 }]);
  assert.deepEqual(run('Cache'), ['/r/README.md', '/r/plans/cache.md'], 'an uppercase letter means exact case: the path "cache.md" no longer matches');
  assert.deepEqual(hitOf('Cache', '/r/plans/cache.md')!.why, [{ kind: 'title' }]);
  assert.deepEqual(run('"Cache layout"'), ['/r/README.md']);
  assert.deepEqual(run('cache -old'), ['/r/README.md', '/r/plans/cache.md']);
  assert.deepEqual(run('plan cache'), ['/r/plans/cache.md'], 'words combine with AND');
});

test('relevance: a title that starts with the word outranks a path that contains it', () => {
  const hits = evaluateQuery(parseQuery('cache'), FIXTURE, ctx());
  const score = (p: string) => hits.find((h) => h.entry.path === p)!.score;
  assert.ok(score('/r/plans/cache.md') > score('/r/plans/archive/old-cache.md'));
  assert.ok(score('/r/plans/archive/old-cache.md') > score('/r/README.md'));
  assert.equal(evaluateQuery(parseQuery('kind:report'), FIXTURE, ctx())[0]!.score, 0, 'no text, no relevance');
});

test('text: lines the caller has searched are reasons, and make a file match', () => {
  const lines: LineMatches = new Map([
    ['needle', new Map([['/r/notes/standup.md', [{ line: 12, preview: 'the needle in it', matchStart: 4, matchEnd: 10 }, { line: 20, preview: 'needle again', matchStart: 0, matchEnd: 6 }, { line: 30, preview: 'third needle', matchStart: 6, matchEnd: 12 }]]])],
  ]);
  assert.deepEqual(run('needle'), [], 'without a search of the files, nothing');
  assert.deepEqual(run('needle', { lines }), ['/r/notes/standup.md']);
  const why = hitOf('needle', '/r/notes/standup.md', { lines })!.why;
  assert.deepEqual(why, [
    { kind: 'line', line: 12, preview: 'the needle in it', matchStart: 4, matchEnd: 10 },
  ], 'one line per term: the preview lists the rest');
  assert.deepEqual(run('-needle kind:notes', { lines }), [], 'a negated term excludes a file with a matching line');
});

test('flagged terms are what the parser says: unknown is text, incomplete is ignored', () => {
  assert.equal(run('model:x').length, 0, 'searched as text: nothing is called that');
  const odd = [entry('/r/model:x.md', { title: 'Odd' })];
  assert.equal(evaluateQuery(parseQuery('model:x'), odd, ctx()).length, 1);
  assert.deepEqual(evaluateQuery(parseQuery('-model:x'), odd, ctx()), []);
  assert.equal(run('kind:report words:>').length, 2, 'the incomplete value filters nothing');
  assert.equal(termNote(parseQuery('model:x').groups[0]![0]!), 'unknown key: searched as text');
  assert.equal(termNote(parseQuery('words:>').groups[0]![0]!), 'incomplete: ignored');
});

test('OR joins groups; a hit explains itself by the first group it satisfies', () => {
  assert.deepEqual(run('is:pinned OR kind:transcript'), ['/r/notes/standup.md', '/s/transcripts/call.txt']);
  assert.deepEqual(run('is:pinned OR is:pinned'), ['/r/notes/standup.md'], 'one hit, not two');
  assert.deepEqual(hitOf('kind:notes OR is:pinned', '/r/notes/standup.md')!.why, [{ kind: 'field', label: 'kind:notes' }]);
  assert.deepEqual(run('kind:readme OR cache -kind:readme'), ['/r/README.md', '/r/plans/cache.md', '/r/plans/archive/old-cache.md', '/r/plans/README.md']);
});

test('the grammar: every key of the parser is evaluated, and a key added later fails here first', () => {
  const sample: Record<string, string> = {
    kind: 'kind:report', is: 'is:pinned', has: 'has:code', modified: 'modified:<2h', words: 'words:>5', tasks: 'tasks:>0', size: 'size:>1kb', path: 'path:cache', in: 'in:repo',
  };
  assert.deepEqual(Object.keys(sample).sort(), [...QUERY_KEYS].sort());
  const all: Record<string, Measured> = {};
  for (const e of FIXTURE) all[e.path] = { words: 50, hasCode: true, hasPaths: false, hasLinks: false, openTasks: 1 };
  for (const q of Object.values(sample)) {
    const hits = evaluateQuery(parseQuery(q), FIXTURE, ctx({ measures: new Map(Object.entries(all)) }));
    assert.ok(hits.length > 0, q);
    assert.ok(hits.every((h) => h.why.length === 1 && !h.unmeasured), q);
  }
});

// The content keys.
const measures = (m: Record<string, Partial<Measured>>): ReadonlyMap<string, Measured> =>
  new Map(Object.entries(m).map(([p, v]) => [p, { words: 0, hasCode: false, hasPaths: false, hasLinks: false, openTasks: 0, ...v }]));

test('content keys: a hit that passes the rest but is not measured says so, and is not dropped', () => {
  const hits = evaluateQuery(parseQuery('kind:report words:>500'), FIXTURE, ctx());
  assert.deepEqual(hits.map((h) => [h.entry.path, h.unmeasured]), [['/r/plans/cache.md', true], ['/r/plans/archive/old-cache.md', true]]);
  assert.ok(usesContentKeys(parseQuery('words:>500')) && !usesContentKeys(parseQuery('kind:report cache')));
});

test('content keys: words, tasks and has, once measured; the reason carries the number', () => {
  const m = measures({
    '/r/plans/cache.md': { words: 1203, hasCode: true, openTasks: 2 },
    '/r/plans/archive/old-cache.md': { words: 80, hasLinks: true },
  });
  assert.deepEqual(run('kind:report words:>500', { measures: m }), ['/r/plans/cache.md']);
  assert.deepEqual(hitOf('kind:report words:>500', '/r/plans/cache.md', { measures: m })!.why, [
    { kind: 'field', label: 'kind:report' },
    { kind: 'field', label: 'words:>500', detail: '1,203 words' },
  ]);
  assert.deepEqual(run('kind:report words:<=80', { measures: m }), ['/r/plans/archive/old-cache.md']);
  assert.deepEqual(run('kind:report tasks:>0', { measures: m }), ['/r/plans/cache.md']);
  assert.deepEqual(run('kind:report has:code', { measures: m }), ['/r/plans/cache.md']);
  assert.deepEqual(run('kind:report has:links', { measures: m }), ['/r/plans/archive/old-cache.md']);
  assert.deepEqual(run('kind:report has:tasks', { measures: m }), ['/r/plans/cache.md']);
  assert.deepEqual(run('kind:report -has:code', { measures: m }), ['/r/plans/archive/old-cache.md']);
  assert.deepEqual(run('kind:report has:code,links', { measures: m }), ['/r/plans/cache.md', '/r/plans/archive/old-cache.md']);
});

test('content keys: a file read in part counts as "at least"', () => {
  const m = new Map<string, Measured>([['/r/plans/cache.md', { words: 40_000, hasCode: false, hasPaths: false, hasLinks: false, openTasks: 0, truncated: true }]]);
  const why = hitOf('kind:report words:>500', '/r/plans/cache.md', { measures: m })!.why;
  assert.deepEqual(why[1], { kind: 'field', label: 'words:>500', detail: '≥40,000 words' });
});

test('indexCandidates is what the index keys leave: the only files a read may touch', () => {
  const q = parseQuery('kind:report cache words:>500');
  assert.deepEqual(indexCandidates(q, FIXTURE, ctx()).map((e) => e.path), ['/r/plans/cache.md', '/r/plans/archive/old-cache.md']);
  assert.equal(indexCandidates(parseQuery(''), FIXTURE, ctx()).length, FIXTURE.length);
  assert.deepEqual(indexCandidates(parseQuery('kind:notes OR kind:code'), FIXTURE, ctx()).map((e) => e.path), ['/r/notes/standup.md', '/r/src/app.ts']);
  assert.deepEqual(textTerms(parseQuery('cache "a b" -old model:x cache')), [
    { text: 'cache', negated: false }, { text: 'a b', negated: false }, { text: 'old', negated: true }, { text: 'model:x', negated: false },
  ]);
});

test('measureText', () => {
  const m = measureText('# Title\n\nOne two three, four.\n\n- [ ] open\n- [x] done\n- [ ] also open\n\n```ts\nconst a = 1;\n```\n\nSee [the doc](docs/plan.md) and src/app.ts.\n');
  assert.equal(m.openTasks, 2);
  assert.equal(m.hasCode, true);
  assert.equal(m.hasLinks, true);
  assert.equal(m.hasPaths, true);
  assert.equal(m.words, 19, 'every run of text that holds a letter or a number');
  assert.deepEqual(measureText(''), { words: 0, hasCode: false, hasPaths: false, hasLinks: false, openTasks: 0 });
  assert.equal(measureText('one  two\n\tthree --- ***  four-five').words, 4, 'runs of space-separated text that hold a letter or number');
  assert.equal(measureText('see https://example.com/a/b.html now').hasPaths, false, 'a URL is a link, not a path');
  assert.equal(measureText('see https://example.com/a/b.html now').hasLinks, true);
  assert.equal(measureText('1. [ ] numbered task').openTasks, 1);
  assert.equal(measureText('use ~/Dev/marxy/AGENTS.md').hasPaths, true);
  assert.equal(measureText('a plain sentence.\nwith no code or tasks').hasCode, false);
});
