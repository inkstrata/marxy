// An archive's page from its listing: the tree, its sums, the row's words and its date.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inflateRawSync, gunzipSync } from 'node:zlib';
import { archiveSums, archiveTree, entryBar, entryDate, initialFolds, ratioWords, shortSize, visibleRows } from './archive.ts';
import { listArchiveBytes, type ArchiveEntryLike } from './archive-read.ts';

const demo = (p: string): Uint8Array => new Uint8Array(readFileSync(new URL(`../../../../fixtures/demo/archives/${p}`, import.meta.url)));
const inflate = async (u: Uint8Array, f: 'deflate-raw' | 'gzip'): Promise<Uint8Array> => new Uint8Array(f === 'gzip' ? gunzipSync(u) : inflateRawSync(u));
const entry = (path: string, o: Partial<ArchiveEntryLike> = {}): ArchiveEntryLike => ({
  index: 0, path, kind: path.endsWith('/') ? 'dir' : 'file', size: 10, packed: null, mtime: null, encrypted: false, method: null, rawName: null, link: null,
  offset: null, crc: null, host: null, mode: null, flags: null, comment: null, ...o,
});

test('the demo zip reads as 11 files in 7 folders, 20.0 MB unpacked from 39.1 KB', async () => {
  const listing = (await listArchiveBytes(demo('tidemark-0.5.0.zip'), 'tidemark-0.5.0.zip', inflate))!;
  const sums = archiveSums(listing);
  assert.deepEqual([sums.files, sums.folders, shortSize(listing.size), shortSize(sums.unpacked)], [11, 7, '39.1 KB', '20.0 MB']);
  assert.equal(ratioWords(sums.unpacked, listing.size), '524 : 1 on 39.1 KB');
  const tree = archiveTree(listing.entries);
  const top = [...tree.kids.values()][0]!;
  assert.equal(top.path, 'tidemark-0.5.0/');
  assert.equal(top.files, 11);
  const rows = visibleRows(tree, new Set());
  assert.deepEqual(rows.slice(0, 3).map((r) => [r.node.name, r.depth]), [['tidemark-0.5.0', 0], ['assets', 1], ['tidemark-icon.png', 2]]);
  assert.equal(rows.at(-1)!.node.name, 'README.md', 'folders first, then files by name');
  assert.equal(visibleRows(tree, new Set(['tidemark-0.5.0/'])).length, 1, 'a folded folder hides what it holds');
  const huge = listing.entries.find((e) => e.path.endsWith('huge.log'))!;
  assert.equal(entryBar(huge), 'over the 16.0 MB an entry opens with');
});

test('a tar.gz sums the same way; folders an archive never names are made from paths', async () => {
  const listing = (await listArchiveBytes(demo('notes-backup.tar.gz'), 'notes-backup.tar.gz', inflate))!;
  assert.equal(listing.format, 'tar.gz');
  const sums = archiveSums(listing);
  assert.deepEqual([sums.files, sums.folders, shortSize(listing.size), shortSize(sums.unpacked)], [5, 3, '811 bytes', '969 bytes']);
  const tree = archiveTree([entry('a/b/c.txt'), entry('a/d.txt', { size: 5 })]);
  const a = tree.kids.get('a/')!;
  assert.equal(a.dir, true);
  assert.equal(a.files, 2);
  assert.equal(a.size, 15);
});

test('a file and a folder of one name stay apart; a large archive starts with its folders folded but a lone top one', () => {
  const tree = archiveTree([entry('x'), entry('x/'), entry('x/y')]);
  assert.deepEqual([...tree.kids.keys()].sort(), ['x', 'x/']);
  const many = Array.from({ length: 2_500 }, (_, i) => entry(`top/d${i % 50}/f${i}.txt`));
  const big = archiveTree(many);
  const folds = initialFolds(big, many.length);
  assert.ok(!folds.has('top/'), 'the lone top folder stays open');
  assert.ok(folds.has('top/d0/'));
  assert.equal(visibleRows(big, folds).length, 51);
  assert.equal(initialFolds(big, 100).size, 0, 'a small archive shows everything');
});

test('each row says why it cannot open, and its date as the archive gave it', () => {
  assert.equal(entryBar(entry('a.txt')), null);
  assert.equal(entryBar(entry('a.txt', { encrypted: true })), 'encrypted: the app does not ask for archive passwords');
  assert.equal(entryBar(entry('a.txt', { method: 'zstd' })), 'compressed with zstd, which the app does not read');
  assert.equal(entryBar(entry('a', { kind: 'link', link: '../b' })), 'a link to ../b: not followed');
  assert.equal(entryBar(entry('a.txt', { size: 16 * 1024 * 1024 + 1 })), 'over the 16.0 MB an entry opens with');
  assert.equal(entryBar(entry('a.txt', { size: 16 * 1024 * 1024 })), null, 'exactly the cap opens');
  assert.equal(entryDate('2026-10-14T16:12:00'), '14 Oct 2026, 16:12', 'a clock time is shown as written');
  assert.equal(entryDate(null), '');
  const zoned = entryDate('2026-10-14T21:00:00Z');
  assert.match(zoned, /^1[45] Oct 2026, \d\d:00$/);
  assert.equal(shortSize(418), '418 bytes');
  assert.equal(shortSize(1), '1 byte');
  assert.equal(shortSize(20 * 1024 * 1024), '20.0 MB');
});
