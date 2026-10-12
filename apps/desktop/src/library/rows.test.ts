// The library's rows (Q-03): the reasons as lines, the marks as words, and the sort.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { IndexEntry } from '@marxy/core';
import type { QueryHit, Reason } from '@marxy/core/src/index-model/query-eval.ts';
import { foldCopies, libraryRow, MAX_WHY, reasonLine, sortChoices, sortHits, whyCount, whyLines } from './rows.ts';

const NOW = 100 * 86_400_000;
const entry = (path: string, over: Partial<IndexEntry> = {}): IndexEntry => ({
  path, root: '/r', title: path.split('/').pop()!, headings: [], mtimeMs: NOW - 3 * 3_600_000, size: 10, kind: 'markdown', readerKind: 'report', ...over,
});
const hit = (e: IndexEntry, why: Reason[] = [], score = 0): QueryHit => ({ entry: e, why, score, unmeasured: false });

test('each reason is one short line', () => {
  const lines = whyLines([
    { kind: 'title' },
    { kind: 'path' },
    { kind: 'heading', text: 'Cache', level: 2 },
  ]);
  assert.deepEqual(lines, ['title', 'path', 'heading "Cache"']);
  assert.equal(reasonLine({ kind: 'line', line: 12, preview: '  the cache is warm ', matchStart: 6, matchEnd: 11 }), 'line 12: the cache is warm');
  assert.equal(reasonLine({ kind: 'field', label: 'kind:report' }), 'kind:report');
  assert.equal(reasonLine({ kind: 'field', label: 'changed since you read' }), 'changed since you read');
  assert.equal(reasonLine({ kind: 'field', label: 'words:>500', detail: '≥1,203 words' }), 'words:>500 (≥1,203 words)');
});

test('over four reasons, the last line counts the rest rather than dropping them', () => {
  const many: Reason[] = ['a', 'b', 'c', 'd', 'e', 'f'].map((label) => ({ kind: 'field', label }));
  assert.equal(MAX_WHY, 4);
  assert.deepEqual(whyLines(many), ['a', 'b', 'c', '3 more reasons']);
  assert.deepEqual(whyLines(many, 6), ['a', 'b', 'c', 'd', 'e', 'f']);
  assert.deepEqual(whyLines([{ kind: 'title' }, { kind: 'title' }]), ['title'], 'a repeat is one line');
  assert.equal(whyCount(hit(entry('/r/x.md'), many)), 4);
  assert.equal(whyCount(hit(entry('/r/x.md'))), 0);
});

test('a row: relative path, kind, age and marks with words', () => {
  const ctx = { nowMs: NOW, pinned: new Set(['/r/docs/a.md']), changed: (e: IndexEntry) => e.path === '/r/docs/a.md' };
  const row = libraryRow(hit(entry('/r/docs/a.md', { title: 'Alpha' }), [{ kind: 'title' }]), ctx);
  assert.equal(row.rel, 'docs/a.md');
  assert.equal(row.kind, 'report');
  assert.equal(row.kindLabel, 'report');
  assert.equal(row.age, '3h');
  assert.equal(row.spokenAge, '3 hours ago');
  assert.deepEqual(row.marks.map((m) => [m.name, m.label]), [['changed', 'Changed since you read'], ['pinned', 'Pinned']]);
  assert.deepEqual(row.why, ['title']);
  const plain = libraryRow(hit(entry('/r/b.md', { readerKind: undefined, kind: 'text' })), ctx);
  assert.deepEqual([plain.kind, plain.kindLabel, plain.marks.length], [null, 'text', 0], 'a file whose kind is not decided shows its file class');
});

test('sorts: relevance, modified, name, path, and last opened keeps the scope\'s order', () => {
  const a = hit(entry('/r/b/zeta.md', { title: 'Zeta', mtimeMs: 3 }), [], 1);
  const b = hit(entry('/r/a/alpha.md', { title: 'alpha 10', mtimeMs: 1 }), [], 5);
  const c = hit(entry('/r/c/alpha.md', { title: 'alpha 9', mtimeMs: 2 }), [], 5);
  const all = [a, b, c];
  const order = (key: Parameters<typeof sortHits>[1]) => sortHits(all, key).map((h) => h.entry.title);
  assert.deepEqual(order('relevance'), ['alpha 9', 'alpha 10', 'Zeta'], 'score, then newest');
  assert.deepEqual(order('modified'), ['Zeta', 'alpha 9', 'alpha 10']);
  assert.deepEqual(order('name'), ['alpha 9', 'alpha 10', 'Zeta'], 'numbers sort as numbers, case does not matter');
  assert.deepEqual(order('path'), ['alpha 10', 'Zeta', 'alpha 9']);
  assert.deepEqual(order('opened'), ['Zeta', 'alpha 10', 'alpha 9']);
  assert.deepEqual(all.map((h) => h.entry.title), ['Zeta', 'alpha 10', 'alpha 9'], 'the input is left alone');
});

test('the sort control offers relevance only while words are typed and last opened only where a scope has an order', () => {
  assert.deepEqual(sortChoices(false, false), ['modified', 'name', 'path']);
  assert.deepEqual(sortChoices(true, false), ['relevance', 'modified', 'name', 'path']);
  assert.deepEqual(sortChoices(false, true), ['opened', 'modified', 'name', 'path']);
});

test('a missing path and a near copy are one line each (Q-06)', () => {
  assert.equal(reasonLine({ kind: 'missing', path: 'src/gone.ts' }), 'missing: src/gone.ts');
  assert.equal(reasonLine({ kind: 'copy', path: '/r/plans/plan v2.md', rel: 'plans/plan v2.md', similarity: 91 }), 'near copy: plans/plan v2.md (91% of words alike)');
  assert.equal(reasonLine({ kind: 'copy', path: '/r/a.md', rel: 'a.md', similarity: null }), 'near copy: a.md');
  // Read in part: a floor, of the first 256 KB, never a bare "100%" (commitment 4).
  assert.equal(reasonLine({ kind: 'copy', path: '/r/a.md', rel: 'a.md', similarity: 100, partial: true }), 'near copy: a.md (≥100% of words alike in the first 256 KB)');
  assert.equal(reasonLine({ kind: 'partial' }), 'checked the first 256 KB only');
});

test('foldCopies keeps the newest hit of each group, in place, and every hit in no group', () => {
  const a = entry('/r/plan.md', { mtimeMs: NOW - 3_000 });
  const b = entry('/r/plan v2.md', { mtimeMs: NOW - 1_000 });
  const c = entry('/r/plan (copy).md', { mtimeMs: NOW - 2_000 });
  const lone = entry('/r/lone.md');
  const dups = new Map([
    [a.path, { group: b.path, copies: [] }],
    [b.path, { group: b.path, copies: [] }],
    [c.path, { group: b.path, copies: [] }],
  ]);
  assert.deepEqual(foldCopies([hit(a), hit(lone), hit(c), hit(b)], dups).map((h) => h.entry.path), ['/r/lone.md', '/r/plan v2.md']);
  // With the newest left out by another term, the newest of those left is the row.
  assert.deepEqual(foldCopies([hit(a), hit(c)], dups).map((h) => h.entry.path), ['/r/plan (copy).md']);
  assert.deepEqual(foldCopies([hit(lone)], new Map()).map((h) => h.entry.path), ['/r/lone.md']);
});
