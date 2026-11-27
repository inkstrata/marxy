import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { ArchiveEntry } from '@marxy/shell-api';
import { csvExport } from './table-cards.ts';
import { asItIs, EXPORT_BYTES_MAX, listingText } from './exports.ts';
import type { ViewedFile } from './file.ts';

const entry = (path: string, kind: ArchiveEntry['kind'], size: number | null, mtime: string | null): ArchiveEntry => ({
  index: 0, path, kind, size, packed: null, mtime, encrypted: false, method: null, rawName: null, link: null,
  offset: null, crc: null, host: null, mode: null, flags: null, comment: null,
});

test('an archive listing is one entry a line: folders end in a slash, files carry their size, dates their minute', () => {
  const text = listingText({
    entries: [entry('pkg', 'dir', null, '2026-10-14T16:16:00Z'), entry('pkg/README.md', 'file', 1234, '2026-10-14T16:18:30'), entry('pkg/raw.bz2', 'file', null, null)],
    truncated: null,
  });
  const lines = text.split('\n');
  assert.match(lines[0]!, /^pkg\/\s+2026-10-14 16:16$/);
  assert.match(lines[1]!, /^pkg\/README\.md\s+1234  2026-10-14 16:18$/);
  assert.equal(lines[2], 'pkg/raw.bz2');
  assert.equal(text.endsWith('\n'), true);
});

test('a listing cut at a cap says so at its end', () => {
  const text = listingText({ entries: [entry('a', 'file', 1, null)], truncated: 'Listed up to 100,000 entries.' });
  assert.match(text, /\n\nListed up to 100,000 entries\.\n$/);
});

const fileOf = (size: number): ViewedFile =>
  ({ path: '/r/x.bin', size, mtimeMs: 1, createdMs: null, head: new Uint8Array([1, 2, 3]), signals: null, magic: null }) as unknown as ViewedFile;

test('the file as it is: every byte, read in ranges, never past the read cap', async () => {
  const bytes = Uint8Array.from({ length: 40 }, (_, i) => i);
  const reads: number[][] = [];
  const shell = { readRange: async (_p: string, offset: number, length: number) => (reads.push([offset, length]), bytes.slice(offset, offset + length)) };
  const out = asItIs(shell, fileOf(40), 'file');
  assert.equal(out.name, 'The file, as it is');
  assert.equal(out.extension, 'bin');
  const built = await out.build();
  assert.deepEqual([...built.bytes], [...bytes]);
  assert.match(built.preview, /^x\.bin: 40 bytes, starting 01 02 03/);
  // Shorter on disk than the page says: refused, nothing written.
  await assert.rejects(asItIs(shell, fileOf(80), 'file').build(), /changed while it was read/);
  await assert.rejects(asItIs(shell, fileOf(EXPORT_BYTES_MAX + 1), 'image').build(), /past the 256\.0 MB/);
  assert.equal(reads.some(([, l]) => l! > 16 * 1024 * 1024), false);
});

test('a CSV export of a view stopped at the time cap says rows are missing', async () => {
  const stopped = csvExport({
    id: 'csv', name: 'v as CSV', sub: '',
    async build(keep, stop) {
      keep('a,b\r\n1,2\r\n');
      stop('stopped after 2 s');
    },
  });
  const built = await stopped.build();
  assert.match(built.preview, /The query was stopped after 2 s: the rows after it are not in this file\./);
  const whole = await csvExport({ id: 'csv', name: 'v', sub: '', async build(keep) { keep('a\r\n'); } }).build();
  assert.doesNotMatch(whole.preview, /The query was/);
});
