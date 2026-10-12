// Near-duplicates (Q-06): which files are paired from the index alone, how alike two texts are, and how pairs make groups.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { IndexEntry } from '../contracts/index-entry.ts';
import {
  candidatePairs,
  DEFAULT_DUP_THRESHOLD,
  groupDuplicates,
  MAX_PAIRS_PER_FILE,
  nameStem,
  nearDuplicates,
  shingles,
  similarity,
} from './near-dup.ts';

const D = 86_400_000;
const NOW = Date.UTC(2026, 9, 12);
const enc = new TextEncoder();

const entry = (path: string, text: string, over: Partial<IndexEntry> = {}): IndexEntry => ({
  path,
  root: '/r',
  title: text.match(/^# (.*)$/m)?.[1] ?? path.split('/').pop()!,
  headings: [],
  mtimeMs: NOW - D,
  size: enc.encode(text).length,
  kind: 'markdown',
  readerKind: 'report',
  ...over,
});

/** A paragraph of `n` words drawn from a seed, so two paragraphs with different seeds share no run of three words. */
const paragraph = (seed: string, n = 45): string => Array.from({ length: n }, (_, i) => `${seed}${(i * 7) % 97}w${i}`).join(' ');
const plan = (changed: string | null): string =>
  ['# Plan', ...Array.from({ length: 12 }, (_, i) => paragraph(i === 5 && changed !== null ? changed : `p${i}`))].join('\n\n');

test('nameStem takes off the extension and the marks of a copy', () => {
  for (const name of ['plan.md', 'Plan v2.md', 'plan (copy).md', 'plan copy 2.md', 'plan.v2.md', 'plan-v1.3.md', 'plan (1).md', 'plan-2.md', 'plan_final.md', 'plan.md.bak']) {
    assert.equal(nameStem(`/r/docs/${name}`), 'plan', name);
  }
  assert.equal(nameStem('/r/nav2.md'), 'nav2', 'a v and a digit inside a word are the word');
  assert.equal(nameStem('/r/2.md'), '2', 'a name that is only a mark keeps it');
  assert.equal(nameStem('/r/report-2026.md'), 'report-2026', 'a year is not a copy number');
});

test('plan.md and plan v2.md, differing in one paragraph, group at the default threshold, newest first', () => {
  const older = entry('/r/plans/plan.md', plan(null), { mtimeMs: NOW - 3 * D });
  const newer = entry('/r/plans/plan v2.md', plan('changed'), { mtimeMs: NOW - D });
  const texts = new Map([[older.path, plan(null)], [newer.path, plan('changed')]]);
  const score = similarity(shingles(plan(null)), shingles(plan('changed')));
  assert.ok(score >= DEFAULT_DUP_THRESHOLD && score < 100, `one paragraph of twelve changed scores ${score}`);
  const groups = nearDuplicates([older, newer], texts);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0]!.members.map((m) => m.entry.path), ['/r/plans/plan v2.md', '/r/plans/plan.md'], "a group's newest is first");
  assert.equal(groups[0]!.members[0]!.similarity, null, 'the newest is what the others are measured against');
  assert.equal(groups[0]!.members[1]!.similarity, score);
  assert.equal(groups[0]!.lowest, score);
  // Above the score, the same two are not a group: the threshold is honoured.
  assert.equal(nearDuplicates([older, newer], texts, score + 1).length, 0);
});

test('two unrelated files of equal size do not group: not paired from the index, and not alike if they were', () => {
  const a = paragraph('alpha', 200);
  const b = paragraph('bravo', 200);
  const ea = entry('/r/notes/alpha.md', a);
  const eb = entry('/r/notes/bravo.md', b);
  assert.equal(ea.size, eb.size, 'the fixture is two files of one size');
  assert.deepEqual(candidatePairs([ea, eb]), [], 'equal size alone pairs nothing');
  assert.ok(similarity(shingles(a), shingles(b)) < 10);
  // The same name, so paired; unrelated texts, so no group.
  const sameName = [entry('/r/a/notes.md', a), entry('/r/b/notes.md', b)];
  assert.equal(candidatePairs(sameName).length, 1);
  assert.equal(nearDuplicates(sameName, new Map([[sameName[0]!.path, a], [sameName[1]!.path, b]])).length, 0);
});

test('candidates: name or title, sizes within reach, a folded worktree copy skipped, at most a few per file', () => {
  const e = (path: string, size: number, title = path.split('/').pop()!): IndexEntry => ({ ...entry(path, ''), size, title });
  const list = [
    e('/r/plan.md', 1000),
    e('/r/plan (copy).md', 1100),
    e('/r/plan v3.md', 3000), // three times larger: out of reach
    e('/r/notes.md', 1000, 'Quarterly plan'),
    e('/r/q-plan.md', 900, 'Quarterly plan'), // the same title, another name
    e('/r/empty.md', 0),
    e('/r/empty copy.md', 0), // empty files are never compared
  ];
  const pairs = candidatePairs(list).map(([a, b]) => [list[a]!.path, list[b]!.path].sort().join(' + ')).sort();
  assert.deepEqual(pairs, ['/r/notes.md + /r/q-plan.md', '/r/plan (copy).md + /r/plan.md']);
  // Two checkouts holding the same copy (same key) are one file; a drifted copy has another key and is compared.
  const copies = [e('/a/docs/x.md', 500), e('/b/docs/x.md', 500), e('/c/docs/x.md', 520)];
  const key = (x: IndexEntry): string => (x.size === 500 ? 'same' : 'drifted');
  assert.deepEqual(candidatePairs(copies, { copyKey: key }).map(([a, b]) => [a, b]), [[0, 2], [1, 2]]);
  // 5,000 files of one name: each is paired with a few neighbours in size, never with all of them.
  const many = Array.from({ length: 5000 }, (_, i) => e(`/r/d${i}/index.ts`, 1000 + i));
  const pairsOfMany = candidatePairs(many);
  assert.ok(pairsOfMany.length <= 5000 * MAX_PAIRS_PER_FILE, `${pairsOfMany.length} pairs`);
  // 5,000 files of distinct names: no pair at all, so nothing is read.
  assert.equal(candidatePairs(Array.from({ length: 5000 }, (_, i) => e(`/r/f${i}.md`, 1000))).length, 0);
});

test('a chain joins one group, ordered newest first; groups are ordered by their newest', () => {
  const x = (path: string, age: number): IndexEntry => ({ ...entry(path, ''), size: 100, mtimeMs: NOW - age * D });
  const list = [x('/r/a.md', 5), x('/r/b.md', 1), x('/r/c.md', 3), x('/r/d.md', 9), x('/r/e.md', 2)];
  const groups = groupDuplicates(list, [
    { a: 0, b: 1, similarity: 90 },
    { a: 1, b: 2, similarity: 88 },
    { a: 3, b: 4, similarity: 95 },
    { a: 0, b: 3, similarity: 40 }, // under the threshold: joins nothing
  ], 85, (a, b) => (a === 1 && b === 0 ? 90 : 70));
  assert.deepEqual(groups.map((g) => g.members.map((m) => m.entry.path)), [['/r/b.md', '/r/c.md', '/r/a.md'], ['/r/e.md', '/r/d.md']]);
  assert.equal(groups[0]!.lowest, 88);
  assert.deepEqual(groups[0]!.members.map((m) => m.similarity), [null, 88, 90]);
});

test('similarity: identical is 100, disjoint is 0, empty is 0, and order does not matter', () => {
  const a = shingles('one two three four five six');
  assert.equal(similarity(a, a), 100);
  assert.equal(similarity(a, shingles('seven eight nine ten')), 0);
  assert.equal(similarity(shingles(''), shingles('')), 0);
  const b = shingles('one two three four five seven');
  assert.equal(similarity(a, b), similarity(b, a));
  assert.equal(similarity(shingles('Hello, World'), shingles('hello world')), 100, 'case and punctuation are not text');
});
