// The level filter's table (K-08): which lines each level keeps in the corpus log, how the hidden lines group into runs,
// what a run says, the count the notice gives, and where the first error is. Pure: no DOM.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { countHidden, firstErrorOffset, hiddenRuns, keptLines, LEVELS, levelOf, runWords } from './log-filter.ts';
import { logRanks } from '@marxy/core/src/highlight/line-classes.ts';

const text = readFileSync(new URL('../../../../fixtures/corpus/35-build.log', import.meta.url), 'utf8');
const lines = text.replace(/\n$/, '').split('\n');
const range = (from: number, to: number): number[] => Array.from({ length: to - from }, (_, i) => from + i);

// The fixture, by line (0-based): DEBUG at 1, 2, 11, 12, 17, 28, 35; WARN heads at 7, 18, 32, 40; ERROR heads at 20, 37; FATAL at 45.
test('All keeps every line; Info drops only DEBUG; Warn keeps WARN and above with their frames; Error keeps ERROR and FATAL with theirs', () => {
  assert.equal(lines.length, 49);
  assert.deepEqual(keptLines(lines, 0), range(0, 49));
  assert.deepEqual(keptLines(lines, 1), range(0, 49).filter((i) => ![1, 2, 11, 12, 17, 28, 35].includes(i)));
  assert.deepEqual(keptLines(lines, 2), [7, 8, 18, ...range(20, 27), 32, 37, 38, 39, 40, 45, 46, 47], 'the hint under the first WARN and every frame stay with their heads, the blank line inside the error stays too');
  assert.deepEqual(keptLines(lines, 3), [...range(20, 27), 37, 38, 39, 45, 46, 47]);
});

test('the hidden lines are runs, and a level names how many it hides and below what', () => {
  const ranks = logRanks(lines);
  assert.deepEqual(hiddenRuns(ranks, 0), []);
  assert.deepEqual(hiddenRuns(ranks, 1).map((r) => r.end - r.start), [2, 2, 1, 1, 1]);
  const warn = hiddenRuns(ranks, 2);
  assert.deepEqual(warn.map((r) => [r.start, r.end]), [[0, 7], [9, 18], [19, 20], [27, 32], [33, 37], [41, 45], [48, 49]]);
  assert.equal(warn.reduce((n, r) => n + r.end - r.start, 0), 31, 'the runs sum to the hidden lines');
  assert.equal(lines.length - keptLines(lines, 2).length, 31);
  assert.equal(runWords(14, levelOf('warn')), '14 lines below Warn');
  assert.equal(runWords(1, levelOf('error')), '1 line below Error');
  assert.equal(runWords(1234, levelOf('info')), '1,234 lines below Info');
  assert.deepEqual(LEVELS.map((l) => [l.id, l.min]), [['all', 0], ['info', 1], ['warn', 2], ['error', 3]]);
});

test('a run of hidden lines at either end, a single line, and a log with nothing to hide', () => {
  assert.deepEqual(hiddenRuns([0, 0, 3, 0], 3), [{ start: 0, end: 2 }, { start: 3, end: 4 }]);
  assert.deepEqual(hiddenRuns([3, 3], 3), []);
  assert.deepEqual(hiddenRuns([], 3), []);
  assert.deepEqual(hiddenRuns([1], 2), [{ start: 0, end: 1 }]);
});

test('the count the notice gives is the lines the level hides, counted from the top of the file with its own line endings', async () => {
  const now = (): Promise<void> => Promise.resolve();
  assert.deepEqual(await countHidden(text, 0, now), { hidden: 0, total: 49 });
  assert.deepEqual(await countHidden(text, 2, now), { hidden: 31, total: 49 });
  assert.deepEqual(await countHidden(text, 3, now), { hidden: 36, total: 49 });
  // CRLF, a lone CR and no final newline count the same lines.
  assert.deepEqual(await countHidden(text.replaceAll('\n', '\r\n'), 2, now), { hidden: 31, total: 49 });
  assert.deepEqual(await countHidden(text.replaceAll('\n', '\r'), 2, now), { hidden: 31, total: 49 });
  assert.deepEqual(await countHidden(text.replace(/\n$/, ''), 2, now), { hidden: 31, total: 49 });
  assert.deepEqual(await countHidden('', 2, now), { hidden: 0, total: 0 });
  // A long file is counted in slices, and a count can be given up.
  const long = text.repeat(400);
  let yields = 0;
  const counted = await countHidden(long, 2, async () => { yields++; }, { budgetMs: 0 });
  assert.deepEqual(counted, { hidden: 31 * 400, total: 49 * 400 });
  assert.ok(yields > 10, `the event loop was given back ${yields} times`);
  assert.equal(await countHidden(long, 2, now, { aborted: () => true }), null);
});

test('the first error is the first head at ERROR or above; a frame, a message that says ERROR and an earlier WARN are not one', () => {
  assert.equal(firstErrorOffset(text), text.indexOf('2026-10-12T09:30:09.870Z ERROR'));
  assert.equal(firstErrorOffset('2026-10-12T09:30:00Z WARN a\n    ERROR in a frame\n2026-10-12T09:30:01Z INFO the ERROR word\n'), -1);
  assert.equal(firstErrorOffset('2026-10-12T09:30:00Z INFO a\n2026-10-12T09:30:01Z FATAL b\n'), 28);
  assert.equal(firstErrorOffset(''), -1);
  assert.equal(firstErrorOffset('2026-10-12T09:30:00Z INFO a\r\n2026-10-12T09:30:01Z critical b'), 29);
});
