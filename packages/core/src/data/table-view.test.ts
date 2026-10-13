// The table lens's view work (K-10b): a sliced, stable sort that matches a plain one; column types read from flags; the
// stats of a column from decoded values; keys with missing fields last either way.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createScan, scanAll } from './delimited.ts';
import { columnStatsSliced, columnType, compareByKeys, profileRecord, sortKeysSliced, sortSliced, type ColumnProfile } from './table-view.ts';

const enc = new TextEncoder();
const yieldNow = (): Promise<void> => new Promise((r) => setImmediate(r));

test('sortSliced orders as a plain stable sort does, in many slices, and stops when aborted', async () => {
  const n = 20_000;
  const keys = Int32Array.from({ length: n }, (_, i) => (i * 7919) % 97);
  const order = Int32Array.from({ length: n }, (_, i) => i);
  let slices = 0;
  let t = 0;
  // A clock that moves 1 ms a reading, so the budget of 2 ms is spent often and the work is cut into many slices.
  const sorted = await sortSliced(order, (a, b) => keys[a]! - keys[b]!, { yieldNow, now: () => t++, budgetMs: 2, onSlice: () => slices++ });
  const expected = [...order].sort((a, b) => keys[a]! - keys[b]! || a - b);
  assert.deepEqual([...sorted!], expected);
  assert.ok(slices > 20, `${slices} slices`);
  const stopped = await sortSliced(order, (a, b) => keys[a]! - keys[b]!, { yieldNow, now: () => t++, budgetMs: 2, aborted: () => true });
  assert.equal(stopped, null);
});

const scanOf = (text: string) => scanAll(createScan(enc.encode(text), ','));

test('a column\'s type is read from its fields\' flags: numbers, identifiers, text; the header is the caller\'s to leave out', () => {
  const scan = scanOf('corpus,files,note\nnotes,932,a b\nrust-book,"112",\nx,,"say ""hi"""\n');
  const profiles: ColumnProfile[] = [];
  for (let r = 1; r < 4; r++) profileRecord(scan, r, profiles);
  assert.deepEqual(profiles.map(columnType), ['ident', 'number', 'text']);
});

test('column stats: min, max, mean over the numbers, count and empty over the fields, absent for short and unreadable rows', async () => {
  const scan = scanOf('h,v\na,3\nb,-1.5\nc,\nd\ne,"10"\n"bad\nf,x\n');
  const rows = Int32Array.from({ length: scan.records.start.length - 1 }, (_, i) => i + 1);
  const stats = await columnStatsSliced(scan, rows, 1, { yieldNow });
  assert.deepEqual(stats, { count: 4, empty: 1, absent: 2, numbers: 3, min: -1.5, max: 10, mean: 11.5 / 3 });
});

test('sort keys: numbers compare as numbers, text case-insensitively, and empty or absent fields sort last in either direction', async () => {
  const scan = scanOf('n,t\n10,b\n9,A\n,c\n100\n');
  const rows = Int32Array.from([1, 2, 3, 4]);
  const num = (await sortKeysSliced(scan, rows, 0, true, { yieldNow }))!;
  const asc = [...rows].sort(compareByKeys(num, false));
  const desc = [...rows].sort(compareByKeys(num, true));
  assert.deepEqual(asc, [2, 1, 4, 3]);
  assert.deepEqual(desc, [4, 1, 2, 3]);
  const text = (await sortKeysSliced(scan, rows, 1, false, { yieldNow }))!;
  assert.deepEqual([...rows].sort(compareByKeys(text, false)), [2, 1, 3, 4]);
});
