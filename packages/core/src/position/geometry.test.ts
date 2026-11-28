// The geometry table's pure rules: searching records by top and by byte, the window a position is read from, and
// settling the records after blocks changed size or margins moved, counted in reads.

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { recordIndexAtByte, recordIndexAtY, recordWindow, settleRecords, type GeometryBox, type GeometryRecord } from './geometry.ts';

/** A page: blocks of the given heights, `gap` px apart. */
function page(heights: readonly number[], gap = 10): GeometryBox[] {
  const out: GeometryBox[] = [];
  let top = 0;
  for (const height of heights) {
    out.push({ top, height });
    top += height + gap;
  }
  return out;
}

const records = (boxes: readonly GeometryBox[]): GeometryRecord[] => boxes.map((b) => ({ top: b.top, height: b.height, measured: true }));

/** A measure over `live` that counts its reads. */
function measuring(live: readonly (GeometryBox | null)[]): { measure: (i: number) => GeometryBox | null; reads: () => number } {
  let reads = 0;
  return {
    measure: (i) => {
      reads += 1;
      return live[i] ?? null;
    },
    reads: () => reads,
  };
}

const boxesOf = (rs: readonly GeometryRecord[]): GeometryBox[] => rs.map((r) => ({ top: r.top, height: r.height }));

test('the record at a y is the first whose bottom is below it, the gap before a block counting as that block', () => {
  const boxes = page([100, 50, 200]);
  assert.equal(recordIndexAtY(boxes, 0), 0);
  assert.equal(recordIndexAtY(boxes, 100), 0, 'the bottom edge is still inside');
  assert.equal(recordIndexAtY(boxes, 105), 1, 'in the gap: the block below');
  assert.equal(recordIndexAtY(boxes, 170), 2);
  assert.equal(recordIndexAtY(boxes, 10_000), 2, 'past the end: the last');
  assert.equal(recordIndexAtY([], 5), 0);
});

test('the record holding a byte is the last starting at or before it; a rangeless record answers its neighbour', () => {
  const starts = [0, 40, 40, 90, 200];
  const at = (b: number): number => recordIndexAtByte(starts.length, (i) => starts[i]!, b);
  assert.equal(at(0), 0);
  assert.equal(at(39), 0);
  assert.equal(at(40), 2, 'a rangeless record after a ranged one takes its start and is the later of the two');
  assert.equal(at(150), 3);
  assert.equal(at(5000), 4);
  assert.equal(recordIndexAtByte(0, () => 0, 10), 0);
});

test('the window reaches past records with no inner blocks to one that has some on each side', () => {
  const inner = [true, false, false, true, true, false, true];
  assert.deepEqual(recordWindow(inner.length, 3, (i) => inner[i]!), [0, 4]);
  assert.deepEqual(recordWindow(inner.length, 4, (i) => inner[i]!), [3, 6]);
  assert.deepEqual(recordWindow(inner.length, 0, (i) => inner[i]!), [0, 3]);
  assert.deepEqual(recordWindow(inner.length, 3, () => false, 2), [1, 5], 'reach bounds it');
  assert.deepEqual(recordWindow(0, 0, () => true), [0, -1]);
});

test('one block grows: it is read, the run below is read at its two ends and moved, nothing else is read', () => {
  const heights = Array.from({ length: 1000 }, () => 40);
  const before = records(page(heights));
  heights[500] = 90;
  const live = page(heights);
  const m = measuring(live);
  const r = settleRecords(before, (i) => i === 500, m.measure);
  assert.deepEqual(boxesOf(before), live);
  // The run above (2 ends), the block, the run below (2 ends).
  assert.equal(m.reads(), 5);
  assert.equal(r.reads, 5);
  assert.equal(r.moved, 500, 'the block and the 499 below it');
});

test('a margin change with no size change anywhere moves only part of a run, and halving finds where', () => {
  const heights = Array.from({ length: 1000 }, () => 40);
  const before = records(page(heights));
  // A theme rule puts 24 px more above block 731, and 12 px more above block 900: no block changed size.
  const live = page(heights).map((b, i) => ({ top: b.top + (i >= 731 ? 24 : 0) + (i >= 900 ? 12 : 0), height: b.height }));
  const m = measuring(live);
  const r = settleRecords(before, () => false, m.measure);
  assert.deepEqual(boxesOf(before), live);
  assert.ok(m.reads() <= 2 * (2 + Math.ceil(Math.log2(1000))) + 2, `${m.reads()} reads`);
});

test('a margin change inside a run below a changed block is found too', () => {
  const heights = Array.from({ length: 300 }, () => 40);
  const before = records(page(heights));
  heights[10] = 80;
  const live = page(heights).map((b, i) => ({ top: b.top + (i >= 200 ? 30 : 0), height: b.height }));
  settleRecords(before, (i) => i === 10, measuring(live).measure);
  assert.deepEqual(boxesOf(before), live);
});

test('a block taken out above blocks that kept their size: every record below moves up', () => {
  const heights = Array.from({ length: 50 }, () => 40);
  const was = records(page(heights));
  // The table already dropped the record (the article's children changed); the page closed the gap.
  was.splice(20, 1);
  const live = page(heights.slice(1));
  settleRecords(was, () => false, measuring(live).measure);
  assert.deepEqual(boxesOf(was), live);
});

test('new records are estimates until measured, and settling measures them', () => {
  const rs: GeometryRecord[] = [{ top: 0, height: 40, measured: true }, { top: 40, height: 0, measured: false }, { top: 40, height: 0, measured: false }];
  const live = page([40, 60, 20]);
  const r = settleRecords(rs, (i) => !rs[i]!.measured, measuring(live).measure);
  assert.deepEqual(boxesOf(rs), live);
  assert.ok(rs.every((x) => x.measured));
  assert.equal(r.moved, 2);
});

test('a block that is not laid out takes the bottom of the one before it and no height', () => {
  const rs = records(page([40, 30, 40]));
  const live: (GeometryBox | null)[] = [{ top: 0, height: 40 }, null, { top: 50, height: 40 }];
  settleRecords(rs, (i) => i === 1 || i === 2, measuring(live).measure);
  assert.deepEqual(boxesOf(rs), [{ top: 0, height: 40 }, { top: 40, height: 0 }, { top: 50, height: 40 }]);
});

test('nothing changed: two reads, nothing moved', () => {
  const rs = records(page(Array.from({ length: 100 }, () => 30)));
  const live = page(Array.from({ length: 100 }, () => 30));
  const r = settleRecords(rs, () => false, measuring(live).measure);
  assert.equal(r.reads, 2);
  assert.equal(r.moved, 0);
});
