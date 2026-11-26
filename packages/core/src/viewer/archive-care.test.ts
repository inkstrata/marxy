// Readings and care: what each entry of the two samples reads as, and every warning, from the
// listing and the first bytes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inflateRawSync, gunzipSync } from 'node:zlib';
import { archiveLede, archiveTree, careSentence } from './archive.ts';
import { careOf, climbsOut, fromRoot, misleadingName, swellsBy } from './archive-care.ts';
import { listArchiveBytes, readArchiveHeadsBytes, type ArchiveListingLike } from './archive-read.ts';
import { ENCRYPTED_READING, readingByName, readingOfHead, READING_HEAD_BYTES, type EntryReading } from './archive-reading.ts';

const demo = (p: string): Uint8Array => new Uint8Array(readFileSync(new URL(`../../../../fixtures/demo/archives/${p}`, import.meta.url)));
const inflate = async (u: Uint8Array, f: 'deflate-raw' | 'gzip', limit?: number): Promise<Uint8Array> => {
  const out = new Uint8Array(f === 'gzip' ? gunzipSync(u) : inflateRawSync(u, limit ? { maxOutputLength: Math.max(limit, 1) } : {}));
  return limit ? out.subarray(0, limit) : out;
};

async function read(name: string): Promise<{ listing: ArchiveListingLike; readings: Map<number, EntryReading> }> {
  const bytes = demo(name);
  const listing = (await listArchiveBytes(bytes, name, inflate))!;
  const files = listing.entries.filter((e) => e.kind === 'file');
  const heads = await readArchiveHeadsBytes(bytes, name, files.map((e) => ({ index: e.index, name: e.path })), READING_HEAD_BYTES, inflate);
  const readings = new Map<number, EntryReading>();
  for (const h of heads) {
    const e = listing.entries[h.index]!;
    readings.set(h.index, e.encrypted ? ENCRYPTED_READING : h.refused ? readingByName(e.path) : readingOfHead(e.path, h.bytes));
  }
  return { listing, readings };
}

test('every entry of the harbour survey reads as what it is, from its bytes', async () => {
  const { listing, readings } = await read('harbour-survey-2026.zip');
  const said = Object.fromEntries(listing.entries.filter((e) => e.kind === 'file').map((e) => [e.path.split('/').pop(), readings.get(e.index)?.label]));
  assert.deepEqual(said, {
    'README.md': 'Markdown',
    'harbour-at-low-water.jpg': 'an image',
    'boat-ribs.jpg': 'an image',
    'tide-chart.png': 'an image',
    'buoy.gif': 'an image',
    'ferry.webp': 'an image',
    'sketch.svg': 'an SVG drawing',
    'gauges.sqlite': 'a database',
    'tide-log-2026.xlsx': 'a workbook',
    'p95-latency.csv': 'a table',
    'release.json': 'a tree',
    'bell-buoy.wav': 'a recording',
    'ferry-leaving.mp4': 'a recording',
    'the-case-for-ragged-lines.pdf': 'a PDF',
    'tide-table.txt': 'plain text',
    'low-water-notice.eml': 'a mail message',
    'tide-heights.ipynb': 'a notebook',
    'indexer.rs': 'Rust',
    'publish.sh': 'a shell script',
    'tidemark.toml': 'a tree',
    'build-2026-10-14.log': 'a log',
    'TidemarkSans-Regular.ttf': 'a font',
    'notes-backup.tar.gz': 'an archive',
    'tidemark.exe': 'a Windows program',
    'crew-list.xlsx': 'encrypted',
  });
  const pictures = [...readings.entries()].filter(([, r]) => r.picture).map(([i]) => listing.entries[i]!.path.split('/').pop()).sort();
  assert.deepEqual(pictures, ['boat-ribs.jpg', 'buoy.gif', 'ferry.webp', 'harbour-at-low-water.jpg', 'sketch.svg', 'tide-chart.png']);
  assert.ok(![...readings.values()].some((r) => r.disagrees), 'no name disagrees with its bytes');
});

test('the lede: the form, the counts, the one folder, both sizes and the comment', async () => {
  const { listing, readings } = await read('harbour-survey-2026.zip');
  const lede = archiveLede(listing, archiveTree(listing.entries));
  assert.equal(lede.form, 'A ZIP archive');
  assert.equal(lede.files, 25);
  assert.equal(lede.folders, 9);
  assert.equal(lede.wrap, 'harbour-survey-2026/');
  assert.equal(lede.comment, 'Harbour survey, 12 to 14 October 2026. Packed on the quay laptop.');
  const care = careOf(listing, readings);
  assert.deepEqual([...care.values()].flat().map((c) => c.care), ['encrypted']);
  assert.equal(careSentence(1, 0), '1 entry is encrypted.');
});

test('vendor-drop.zip: each of the seven warnings, on its entry', async () => {
  const { listing, readings } = await read('vendor-drop.zip');
  const care = careOf(listing, readings);
  const by = (path: string): string[] => listing.entries.filter((e) => e.path === path).flatMap((e) => (care.get(e.index) ?? []).map((c) => c.words));
  assert.deepEqual(by('Start Menu/Programs/Startup/tide.cmd'), ['climbs out']);
  assert.deepEqual(by('etc/cron.d/tide'), ['starts at the root']);
  assert.deepEqual(by('docs/invoice\u202Efdp.exe'), ['misleading name']);
  assert.deepEqual(by('docs/receipt.jpg'), ['not a .jpg']);
  assert.deepEqual(by('docs/licence.txt'), ['named twice', 'named twice']);
  assert.deepEqual(by('cache/fill.bin'), [`swells ${Math.round((48 * 1024 * 1024) / listing.entries.find((e) => e.path === 'cache/fill.bin')!.packed!).toLocaleString('en-GB')}×`]);
  assert.deepEqual(by('keys/licence.key'), ['encrypted']);
  assert.deepEqual(by('plugin.dll'), [], 'a program named as one is no warning');
  const receipt = listing.entries.find((e) => e.path === 'docs/receipt.jpg')!;
  assert.equal(care.get(receipt.index)![0]!.sentence, 'Its name says .jpg; its bytes are a Windows program.');
  assert.equal(readings.get(receipt.index)!.label, 'a Windows program');
});

test('the rules on their own: climbing out, the root, hidden characters, swelling', () => {
  assert.equal(climbsOut('../../x'), true);
  assert.equal(climbsOut('a/../b'), false);
  assert.equal(climbsOut('a/../../b'), true);
  assert.equal(climbsOut('a\\..\\..\\b'), true);
  assert.equal(fromRoot('/etc/x'), true);
  assert.equal(fromRoot('C:\\x'), true);
  assert.equal(fromRoot('etc/x'), false);
  assert.equal(misleadingName('invoice\u202Efdp.exe'), true);
  assert.equal(misleadingName('zero\u200Bwidth.txt'), true);
  assert.equal(misleadingName('café.txt'), false);
  assert.equal(swellsBy({ size: 2 * 1024 * 1024, packed: 1024 }), 2048);
  assert.equal(swellsBy({ size: 500_000, packed: 10 }), null, 'under a megabyte is not a bomb');
  assert.equal(swellsBy({ size: 2 * 1024 * 1024, packed: 1024 * 1024 }), null);
  assert.equal(swellsBy({ size: 2 * 1024 * 1024, packed: null }), null);
});

test('a reading by name before the head arrives, and readings that disagree with the name', () => {
  assert.equal(readingByName('a/b.md').label, 'Markdown');
  assert.equal(readingByName('a/b.py').label, 'Python');
  assert.equal(readingByName('a/b.unknownext').label, 'no reading');
  const mz = new TextEncoder().encode('MZ\x90\x00\x03');
  const r = readingOfHead('x/photo.png', mz);
  assert.equal(r.disagrees, true);
  assert.equal(r.label, 'a Windows program');
  assert.equal(readingOfHead('x/report.txt', new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34])).label, 'a PDF');
  assert.equal(readingOfHead('x/report.txt', new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34])).disagrees, true);
  assert.equal(readingOfHead('x/book.xlsx', new Uint8Array([0x50, 0x4b, 3, 4, 0, 0])).disagrees, false, 'a workbook is a zip');
  assert.equal(readingOfHead('x/run', new TextEncoder().encode('#!/usr/bin/env python3\nprint(1)\n')).label, 'Python');
});
