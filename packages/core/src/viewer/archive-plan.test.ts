// The plan: a squarified treemap of an archive's contents, folders as frames, small things gathered.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { archivePlan, innerOf, type PlanCell, type PlanInput } from './archive-plan.ts';
import { cpuNow } from '../testing/cpu-clock.ts';

const file = (path: string, size: number, index: number, packed = size): PlanInput => ({ path, size, packed, isDir: false, index });
const area = (c: { w: number; h: number }): number => c.w * c.h;
const BOX = { w: 1000, h: 140 };

const sample: PlanInput[] = [
  { path: 'data/', size: 0, packed: 0, isDir: true, index: 0 },
  file('data/gauges.sqlite', 307_200, 1, 60_000),
  file('data/tide-log.xlsx', 82_639, 2, 82_639),
  file('pictures/boat-ribs.jpg', 24_719, 3),
  file('pictures/tide-chart.png', 37_311, 4),
  file('pictures/deep/deeper/note.txt', 3_000, 5, 900),
  file('recordings/bell-buoy.wav', 220_672, 6, 30_000),
  file('README.md', 896, 7, 491),
];

/** The cells drawn directly in `parent` (null: the box). */
const childrenOf = (cells: readonly PlanCell[], parent: PlanCell | null): PlanCell[] => {
  if (!parent) return cells.filter((c) => c.depth === 0);
  const inner = innerOf(parent);
  return cells.filter((c) => c.depth === parent.depth + 1 && c.x >= inner.x - 1e-6 && c.y >= inner.y - 1e-6 && c.x + c.w <= inner.x + inner.w + 1e-6 && c.y + c.h <= inner.y + inner.h + 1e-6);
};

test('the cells of each level fill their parent within a pixel', () => {
  const cells = archivePlan(sample, BOX, { scale: 'unpacked' });
  const top = childrenOf(cells, null);
  assert.ok(Math.abs(top.reduce((s, c) => s + area(c), 0) - area(BOX)) < 1, 'the top level fills the box');
  const frames = cells.filter((c) => c.frame);
  assert.ok(frames.length > 0, 'a folder is drawn as a frame');
  for (const f of frames) {
    const kids = childrenOf(cells, f);
    assert.ok(Math.abs(kids.reduce((s, c) => s + area(c), 0) - area(innerOf(f))) < 1, `${f.path} is filled`);
  }
  for (const c of cells) assert.ok(c.x >= -1e-6 && c.y >= -1e-6 && c.x + c.w <= BOX.w + 1e-6 && c.y + c.h <= BOX.h + 1e-6, `${c.path} is inside the box`);
});

test('the largest file has the largest cell, and the area follows the size', () => {
  const cells = archivePlan(sample, BOX, { scale: 'unpacked' }).filter((c) => c.kind === 'file');
  const largest = cells.reduce((a, b) => (area(b) > area(a) ? b : a));
  assert.equal(largest.path, 'data/gauges.sqlite');
  assert.equal(largest.index, 1);
  assert.equal(largest.count, 1);
  // With no folders, a file's share of the box is its share of the bytes.
  const flat = archivePlan(sample.map((e) => ({ ...e, path: e.path.replace(/\//g, '_') })), BOX, { scale: 'unpacked' });
  const total = sample.reduce((s, e) => s + e.size, 0);
  for (const c of flat) assert.ok(Math.abs(area(c) / area(BOX) - c.bytes / total) < 1e-6, c.path);
});

test('the packed scale draws from packed sizes', () => {
  const unpacked = archivePlan(sample, BOX, { scale: 'unpacked' });
  const packed = archivePlan(sample, BOX, { scale: 'packed' });
  const top = (cells: PlanCell[], path: string): PlanCell => cells.find((c) => c.depth === 0 && c.path === path)!;
  assert.equal(top(unpacked, 'data/').bytes, 307_200 + 82_639);
  assert.equal(top(packed, 'data/').bytes, 60_000 + 82_639);
  assert.ok(area(top(packed, 'data/')) / area(BOX) - (60_000 + 82_639) / sample.reduce((s, e) => s + e.packed, 0) < 1e-6);
  assert.notDeepEqual(unpacked.map((c) => c.w), packed.map((c) => c.w));
});

test('nothing in, or nothing of any size, gives no cells', () => {
  assert.deepEqual(archivePlan([], BOX, { scale: 'unpacked' }), []);
  assert.deepEqual(archivePlan([file('a.txt', 0, 0)], BOX, { scale: 'unpacked' }), []);
  assert.deepEqual(archivePlan(sample, { w: 0, h: 100 }, { scale: 'unpacked' }), []);
});

test('folders frame two levels deep; a deeper folder is one cell', () => {
  const deep = [file('a/b/c/d.txt', 1000, 0), file('a/b/c/e.txt', 1000, 1), file('a/b/f.txt', 1000, 2), file('a/g.txt', 1000, 3)];
  const cells = archivePlan(deep, { w: 1000, h: 400 }, { scale: 'unpacked' });
  const a = cells.find((c) => c.path === 'a/')!;
  const b = cells.find((c) => c.path === 'a/b/')!;
  const c = cells.find((c) => c.path === 'a/b/c/')!;
  assert.equal(a.frame, true);
  assert.equal(b.frame, true);
  assert.equal(c.frame, undefined, 'a third level is one cell');
  assert.equal(c.kind, 'folder');
  assert.equal(c.count, 2);
  assert.equal(c.depth, 2);
  assert.ok(!cells.some((x) => x.path === 'a/b/c/d.txt'));
});

test('more than 400 files gather by folder, and the gathered cells say how many', () => {
  const many: PlanInput[] = [];
  for (let i = 0; i < 2_000; i++) many.push(file(`f${i % 4}/x${i}.bin`, 100 + (i % 37), i));
  const cells = archivePlan(many, BOX, { scale: 'unpacked' });
  assert.ok(cells.length <= 400, `${cells.length} cells`);
  const gathered = cells.filter((c) => c.kind === 'gathered');
  assert.ok(gathered.length > 0);
  for (const g of gathered) assert.match(g.path, /^f\d\/$/, 'gathered by its folder');
  const counted = cells.filter((c) => c.kind === 'file').length + gathered.reduce((s, g) => s + g.count, 0) + cells.filter((c) => c.kind === 'folder' && !c.frame).reduce((s, c) => s + c.count, 0);
  assert.equal(counted, 2_000, 'every file is drawn or gathered once');
});

test('100,000 entries are laid out in well under the page bound', () => {
  const big: PlanInput[] = [];
  for (let i = 0; i < 100_000; i++) big.push(file(`d${i % 50}/e${i % 7}/f${i}.txt`, 1 + ((i * 7919) % 100_000), i));
  const t0 = cpuNow();
  const cells = archivePlan(big, BOX, { scale: 'unpacked' });
  const ms = cpuNow() - t0;
  assert.ok(cells.length > 0 && cells.length <= 400);
  assert.ok(ms < 400, `${ms.toFixed(0)} ms`);
});

test('the same entries laid out in another box are not summed again (a window drag lays out many times)', () => {
  let reads = 0;
  const counted = sample.map((e) => ({
    get path() {
      reads++;
      return e.path;
    },
    size: e.size,
    packed: e.packed,
    isDir: e.isDir,
    index: e.index,
  }));
  const a = archivePlan(counted, BOX, { scale: 'unpacked' });
  const once = reads;
  const b = archivePlan(counted, { w: 700, h: 300 }, { scale: 'unpacked' });
  assert.equal(reads, once, 'the second box read no entry');
  assert.deepEqual(archivePlan(sample, BOX, { scale: 'unpacked' }), a, 'the cache changes no cell');
  assert.deepEqual(archivePlan(sample, { w: 700, h: 300 }, { scale: 'unpacked' }), b);
  archivePlan(counted, BOX, { scale: 'packed' });
  assert.ok(reads > once, 'another scale sums again');
});
