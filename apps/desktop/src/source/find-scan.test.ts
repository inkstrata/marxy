// Source's find marks are found a stretch at a time, and are the matches a whole scan finds.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { SearchQuery } from '@codemirror/search';
import { EditorState } from '@codemirror/state';
import { scanFindInSlices } from './find-scan.ts';
import { cpuNow } from '../testing/cpu-clock.ts';

const whole = (state: EditorState, query: SearchQuery): { from: number; to: number }[] => {
  const out: { from: number; to: number }[] = [];
  const cursor = query.getCursor(state);
  for (let next = cursor.next(); !next.done; next = cursor.next()) if (next.value.to > next.value.from) out.push({ from: next.value.from, to: next.value.to });
  return out;
};

/** The scan run to its end, the stretches given back through a queue, with the longest stretch timed. */
function sliced(state: EditorState, query: SearchQuery, first?: number, cap = 1_000_000): { found: { from: number; to: number }[]; longest: number; stretches: number } {
  const queue: (() => void)[] = [];
  let found: { from: number; to: number }[] | null = null;
  let longest = 0;
  let stretches = 0;
  const timed = (fn: () => void): void => {
    const t0 = cpuNow();
    fn();
    longest = Math.max(longest, cpuNow() - t0);
    stretches++;
  };
  timed(() => scanFindInSlices(state, query, { cap, first, cancelled: () => false, later: (next) => queue.push(next), done: (f) => { found = [...f]; } }));
  while (queue.length > 0) timed(queue.shift()!);
  assert.ok(found, 'the scan finished');
  return { found, longest, stretches };
}

test('an absent literal query over a 50 MB document is found in stretches, none of them long', () => {
  const line = 'the reader keeps a place in a long text and the page holds it while the window moves\n';
  const state = EditorState.create({ doc: line.repeat(Math.ceil((50 * 1024 * 1024) / line.length)) });
  const r = sliced(state, new SearchQuery({ search: 'absent words' }));
  assert.deepEqual(r.found, []);
  assert.ok(r.stretches > 10, `${r.stretches} stretches`);
  // CPU time comes in scheduler ticks of about 15.6 ms on Windows, so a stretch under 50 ms can read one tick over.
  assert.ok(r.longest < 50 + 16, `the longest stretch took ${r.longest.toFixed(1)} ms`);
});

test('the stretches find what one whole scan finds, across their edges', () => {
  const words = ['alpha', 'beta', 'gamma', 'delta', 'alphabet', 'the end', ' ', '\n', 'x\ny', 'Alpha'];
  let seed = 7;
  const next = (): number => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  let doc = '';
  while (doc.length < 200_000) doc += words[Math.floor(next() * words.length)];
  const state = EditorState.create({ doc });
  for (const spec of [
    { search: 'alpha' },
    { search: 'alpha', caseSensitive: true },
    { search: 'alpha', wholeWord: true },
    { search: 'x\\ny' },
    { search: '^beta', regexp: true },
    { search: 'a$', regexp: true },
    { search: 'g[a-z]+a', regexp: true },
    { search: 'end\\nal', regexp: true },
  ]) {
    const query = new SearchQuery(spec);
    for (const first of [1, 4096]) assert.deepEqual(sliced(state, query, first).found, whole(state, query), `${JSON.stringify(spec)} from ${first}`);
  }
  const capped = sliced(state, new SearchQuery({ search: 'a' }), 100, 50).found;
  assert.deepEqual(capped, whole(state, new SearchQuery({ search: 'a' })).slice(0, 50));
});

test('a cancelled scan stops and says nothing', () => {
  const state = EditorState.create({ doc: 'abc\n'.repeat(100_000) });
  const queue: (() => void)[] = [];
  let cancelled = false;
  let done = false;
  scanFindInSlices(state, new SearchQuery({ search: 'b' }), { cap: 1_000_000, first: 1000, cancelled: () => cancelled, later: (n) => queue.push(n), done: () => { done = true; } });
  cancelled = true;
  while (queue.length > 0) queue.shift()!();
  assert.equal(done, false);
});
