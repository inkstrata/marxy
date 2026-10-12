// The bounded reader behind the content keys (Q-03): only the files the index keys left are read, each at most
// once, none past the shell's cap, and a file read in part says so.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { IndexEntry } from '@marxy/core';
import { evaluateQuery, indexCandidates, parseQuery } from '@marxy/core/src/index-model/index.ts';
import { MEASURE_READ_BYTES, MeasureCache, measureBytes, measureFiles } from './measure.ts';

const enc = new TextEncoder();
const words = (n: number): string => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');

const entry = (path: string, size: number, kind: IndexEntry['readerKind'] = 'report', mtimeMs = 1): IndexEntry => ({
  path, root: '/r', title: path, headings: [], mtimeMs, size, kind: 'markdown', readerKind: kind,
});

/** A reader over fixed texts that counts what it was asked and how much it returned, and honours the cap as the shell does. */
function reader(files: Record<string, string | Uint8Array>) {
  const log: { path: string; max: number }[] = [];
  let returned = 0;
  const read = async (path: string, max: number): Promise<Uint8Array> => {
    log.push({ path, max });
    const f = files[path];
    if (f === undefined) throw Object.assign(new Error('not found'), { code: 'not-found' });
    const bytes = typeof f === 'string' ? enc.encode(f) : f;
    const head = bytes.slice(0, Math.min(max, MEASURE_READ_BYTES));
    returned += head.length;
    return head;
  };
  return { read, log, returned: () => returned };
}

const ctx = () => ({ nowMs: 10, pinned: new Set<string>(), recent: new Set<string>(), changed: () => false });

test('words:>500 reads only the files the other terms left, each once, and none past the cap', async () => {
  const entries = [
    entry('/r/big.md', 3000), entry('/r/small.md', 300), entry('/r/notes.md', 3000, 'notes'), entry('/r/huge.md', 300 * 1024),
  ];
  const files = { '/r/big.md': words(800), '/r/small.md': words(40), '/r/notes.md': words(900), '/r/huge.md': words(60_000).slice(0, 300 * 1024) };
  const r = reader(files);
  const cache = new MeasureCache();
  const q = parseQuery('kind:report words:>500');
  const candidates = indexCandidates(q, entries, ctx());
  assert.deepEqual(candidates.map((e) => e.path), ['/r/big.md', '/r/small.md', '/r/huge.md'], 'kind:notes is left unread');
  const result = await measureFiles(candidates, r.read, cache);
  assert.deepEqual(result, { measured: 3, of: 3, overBudget: false, reads: 3 });
  assert.deepEqual(r.log.map((l) => l.path).sort(), ['/r/big.md', '/r/huge.md', '/r/small.md']);
  assert.ok(r.log.every((l) => l.max <= MEASURE_READ_BYTES), 'no read asks for more than the cap');
  const hits = evaluateQuery(q, entries, { ...ctx(), measures: cache.forEntries(entries) });
  assert.deepEqual(hits.map((h) => h.entry.path), ['/r/big.md', '/r/huge.md']);
  assert.ok(hits.every((h) => !h.unmeasured));

  // Typing on: the same query again, and one more word of it, read nothing new.
  await measureFiles(candidates, r.read, cache);
  await measureFiles(indexCandidates(parseQuery('kind:report words:>50'), entries, ctx()), r.read, cache);
  assert.equal(r.log.length, 3, 'each file is read at most once');
});

test('a 300 KB file is measured on its first 256 KB and its reason reads "≥"', async () => {
  const text = words(80_000);
  assert.ok(text.length > 300 * 1024);
  const e = entry('/r/long.md', 300 * 1024);
  const r = reader({ '/r/long.md': text.slice(0, 300 * 1024) });
  const cache = new MeasureCache();
  await measureFiles([e], r.read, cache);
  assert.equal(r.returned(), MEASURE_READ_BYTES);
  const m = cache.get(e)!;
  assert.equal(m.truncated, true);
  const full = measureBytes(enc.encode(text.slice(0, 300 * 1024)), 300 * 1024);
  assert.ok(m.words < full.words && m.words > 0, 'a floor, not the whole count');
  const hit = evaluateQuery(parseQuery('words:>500'), [e], { ...ctx(), measures: cache.forEntries([e]) })[0]!;
  const reason = hit.why[0]!;
  assert.ok(reason.kind === 'field' && reason.detail!.startsWith('≥'), 'the row says "at least"');
});

test('a changed file is measured again; an unchanged one is not', async () => {
  const r = reader({ '/r/a.md': words(10) });
  const cache = new MeasureCache();
  const a = entry('/r/a.md', 60, 'report', 1);
  await measureFiles([a], r.read, cache);
  await measureFiles([a], r.read, cache);
  assert.equal(r.log.length, 1);
  await measureFiles([{ ...a, mtimeMs: 2 }], r.read, cache);
  assert.equal(r.log.length, 2, 'a new modification time means a new read');
  assert.equal(cache.forEntries([a]).size, 0, 'a measure of the old file is not offered for the new one');
});

test('the budget stops the reads and says so; unreachable and binary files do not stop anything', async () => {
  const names = Array.from({ length: 10 }, (_, i) => `/r/f${i}.md`);
  const files: Record<string, string | Uint8Array> = {};
  for (const n of names) files[n] = words(100);
  files['/r/f3.md'] = new Uint8Array([104, 105, 0, 1, 2]);
  delete files['/r/f4.md'];
  const r = reader(files);
  const cache = new MeasureCache();
  const entries = names.map((n) => entry(n, 600));
  const progress: number[] = [];
  const result = await measureFiles(entries, r.read, cache, { budgetBytes: 700, onProgress: (m) => progress.push(m) });
  assert.equal(result.overBudget, true);
  assert.ok(result.measured < 10 && result.measured >= 3, String(result.measured));
  assert.equal(progress[progress.length - 1], result.measured);
  assert.deepEqual(cache.get(entries[3]!), { words: 0, hasCode: false, hasPaths: false, hasLinks: false, openTasks: 0 }, 'binary: no words');
  const done = await measureFiles(entries, r.read, new MeasureCache());
  assert.equal(done.overBudget, false);
  assert.equal(done.measured, 10, 'a file that cannot be read is measured empty, not asked again');
});

test('an aborted measure stops reading', async () => {
  const names = Array.from({ length: 30 }, (_, i) => `/r/f${i}.md`);
  const files = Object.fromEntries(names.map((n) => [n, words(5)]));
  const r = reader(files);
  const ac = new AbortController();
  const cache = new MeasureCache();
  const entries = names.map((n) => entry(n, 30));
  const run = measureFiles(entries, async (p, m) => {
    const b = await r.read(p, m);
    if (r.log.length >= 4) ac.abort();
    return b;
  }, cache, { signal: ac.signal });
  await run;
  assert.ok(r.log.length < 15, `stopped early (${r.log.length} reads)`);
});
