// Builds the archive page's two sample archives from files the demo already holds:
// harbour-survey-2026.zip, an archive of every kind the page reads, and vendor-drop.zip, an archive of every warning.
// Run from anywhere: node fixtures/demo/archives/make-archives.mjs. Node only; the bytes are the same on every run.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateRawSync, gzipSync, inflateRawSync } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const demo = join(here, '..');
const rd = (p) => readFileSync(join(demo, p));

/** A DOS date and time in October 2026. */
const dos = (day, hh, mm) => ({ date: ((2026 - 1980) << 9) | (10 << 5) | day, time: (hh << 11) | (mm << 5) });

/**
 * A zip of `entries`: { name, data, store, when: [day, hour, minute], mode, enc, comment }. Written on Unix (mode kept).
 * An encrypted entry's data is stand-in noise behind the encrypted flag: nothing reads it, and nothing should.
 */
function zip(entries, comment) {
  const locals = [];
  const central = [];
  let at = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const dir = e.name.endsWith('/');
    const data = e.data ?? Buffer.alloc(0);
    const packed = dir ? Buffer.alloc(0) : e.enc ? Buffer.from(Array.from({ length: data.length + 12 }, (_, i) => (i * 73 + 41) & 255)) : e.store ? data : deflateRawSync(data, { level: 9 });
    const method = dir || e.store || e.enc ? 0 : 8;
    const flags = 0x800 | (e.enc ? 1 : 0);
    const w = dos(...(e.when ?? [14, 16, 0]));
    const crc = dir ? 0 : crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(flags, 6);
    lh.writeUInt16LE(method, 8);
    lh.writeUInt16LE(w.time, 10);
    lh.writeUInt16LE(w.date, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(packed.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(name.length, 26);
    const cm = Buffer.from(e.comment ?? '', 'utf8');
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE((3 << 8) | 30, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(flags, 8);
    ch.writeUInt16LE(method, 10);
    ch.writeUInt16LE(w.time, 12);
    ch.writeUInt16LE(w.date, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(packed.length, 20);
    ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt16LE(cm.length, 32);
    ch.writeUInt32LE(((dir ? 0o40755 : (e.mode ?? 0o100644)) << 16) >>> 0, 38);
    ch.writeUInt32LE(at, 42);
    locals.push(lh, name, packed);
    central.push(ch, name, cm);
    at += 30 + name.length + packed.length;
  }
  const cd = Buffer.concat(central);
  const cmt = Buffer.from(comment ?? '', 'utf8');
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(at, 16);
  end.writeUInt16LE(cmt.length, 20);
  return Buffer.concat([...locals, cd, end, cmt]);
}

/** The constructed program in the release archive (MZ, and nothing a reader knows), read through its local header. */
const exe = (() => {
  const rel = rd('archives/tidemark-0.5.0.zip');
  const nm = 'tidemark-0.5.0/bin/tidemark.exe';
  const i = rel.indexOf(Buffer.from(nm));
  const raw = rel.subarray(i + nm.length, i + nm.length + rel.readUInt32LE(i - 12));
  return rel.readUInt16LE(i - 22) === 8 ? inflateRawSync(raw) : raw;
})();

const readme = `# Harbour survey, autumn 2026

Everything gathered at the east quay between 12 and 14 October: the gauge readings, the photographs, two recordings and
the notice that went to the harbour office.

## What is here

- \`pictures/\`: the quay at low water, the ribs of the old ferry, the tide chart as drawn.
- \`data/\`: the gauge database, the tide log, the latency table and the release.
- \`recordings/\`: the bell buoy, and the ferry leaving at 16:10.
- \`reading/\`: the essay the plates are set from, the tide table, the notice and the notebook.
- \`src/\`: the [indexer](src/indexer.rs) and the [script that published the table](src/publish.sh).

The crew list is packed with a password; the harbour office holds it.
`;

const publish = `#!/bin/sh
# Publishes the tide table to the harbour office's share.
set -eu
cp reading/tide-table.txt /srv/harbour/tide-table.txt
`;

const R = 'harbour-survey-2026/';
const survey = zip(
  [
    { name: R },
    { name: `${R}README.md`, data: Buffer.from(readme), when: [14, 18, 2] },
    { name: `${R}pictures/` },
    { name: `${R}pictures/harbour-at-low-water.jpg`, data: rd('images/harbour-at-low-water.jpg'), store: true, when: [13, 6, 40] },
    { name: `${R}pictures/boat-ribs.jpg`, data: rd('images/boat-ribs.jpg'), store: true, when: [13, 6, 52] },
    { name: `${R}pictures/tide-chart.png`, data: rd('images/tide-chart.png'), store: true, when: [14, 9, 15] },
    { name: `${R}pictures/buoy.gif`, data: rd('images/buoy.gif'), store: true, when: [12, 15, 3] },
    { name: `${R}pictures/ferry.webp`, data: rd('images/ferry.webp'), store: true, when: [14, 16, 11] },
    { name: `${R}pictures/sketch.svg`, data: rd('images/sketch.svg'), when: [12, 11, 30] },
    { name: `${R}data/` },
    { name: `${R}data/gauges.sqlite`, data: rd('data/gauges.sqlite'), when: [14, 17, 30] },
    { name: `${R}data/tide-log-2026.xlsx`, data: rd('sheets/tide-log-2026.xlsx'), store: true, when: [14, 17, 12] },
    { name: `${R}data/p95-latency.csv`, data: rd('data/p95-latency.csv'), when: [14, 12, 0] },
    { name: `${R}data/release.json`, data: rd('data/release.json'), when: [14, 12, 0] },
    { name: `${R}recordings/` },
    { name: `${R}recordings/bell-buoy.wav`, data: rd('media/bell-buoy.wav'), when: [12, 15, 20] },
    { name: `${R}recordings/ferry-leaving.mp4`, data: rd('media/ferry-leaving.mp4'), store: true, when: [14, 16, 10] },
    { name: `${R}reading/` },
    { name: `${R}reading/the-case-for-ragged-lines.pdf`, data: rd('reading/the-case-for-ragged-lines.pdf'), when: [10, 9, 0] },
    { name: `${R}reading/tide-table.txt`, data: rd('reading/tide-table.txt'), when: [14, 17, 40] },
    { name: `${R}reading/low-water-notice.eml`, data: rd('mail/low-water-notice.eml'), when: [14, 17, 55] },
    { name: `${R}reading/tide-heights.ipynb`, data: rd('notebooks/tide-heights.ipynb'), when: [14, 13, 20] },
    { name: `${R}src/` },
    { name: `${R}src/indexer.rs`, data: rd('src/indexer.rs'), when: [13, 20, 14] },
    { name: `${R}src/publish.sh`, data: Buffer.from(publish), mode: 0o100755, when: [13, 21, 2] },
    { name: `${R}src/tidemark.toml`, data: rd('tidemark/tidemark.toml'), when: [13, 21, 5] },
    { name: `${R}logs/` },
    { name: `${R}logs/build-2026-10-14.log`, data: rd('logs/build-2026-10-14.log'), when: [14, 17, 58] },
    { name: `${R}fonts/` },
    { name: `${R}fonts/TidemarkSans-Regular.ttf`, data: rd('fonts/TidemarkSans-Regular.ttf'), when: [1, 10, 0] },
    { name: `${R}backups/` },
    { name: `${R}backups/notes-backup.tar.gz`, data: rd('archives/notes-backup.tar.gz'), store: true, when: [14, 18, 0] },
    { name: `${R}tools/` },
    { name: `${R}tools/tidemark.exe`, data: exe, mode: 0o100755, when: [14, 16, 20] },
    { name: `${R}crew-list.xlsx`, data: Buffer.alloc(9200, 7), enc: true, when: [14, 18, 1], comment: 'ask the harbour office' },
  ],
  'Harbour survey, 12 to 14 October 2026. Packed on the quay laptop.',
);
writeFileSync(join(here, 'harbour-survey-2026.zip'), survey);

/* Every warning the page says: a program under a picture's name, a name that reorders itself, a path named twice, two that
   climb out or start at the root, an encrypted key, and a file that swells from kilobytes to 48 MB. */
const drop = zip([
  { name: 'install-notes.txt', data: Buffer.from('Unpack into the plugin folder and run setup.cmd.\nSupport: vendor desk, weekdays.\n'), when: [9, 10, 0] },
  { name: 'setup.cmd', data: Buffer.from('@echo off\r\ncopy /y plugin.dll "%APPDATA%\\Tidemark\\plugins\\"\r\n'), when: [9, 10, 0] },
  { name: 'plugin.dll', data: exe, when: [9, 10, 1] },
  { name: 'docs/receipt.jpg', data: exe, when: [9, 10, 2] },
  { name: 'docs/invoice‮fdp.exe', data: exe, when: [9, 10, 2] },
  { name: 'docs/licence.txt', data: rd('encodings/harbourmaster-1998.txt'), when: [9, 10, 3] },
  { name: 'docs/licence.txt', data: Buffer.from('This copy replaces the one above when some tools unpack it.\n'), when: [9, 10, 4] },
  { name: '../../Start Menu/Programs/Startup/tide.cmd', data: Buffer.from('@start plugin.dll\r\n'), when: [9, 10, 5] },
  { name: '/etc/cron.d/tide', data: Buffer.from('* * * * * root /tmp/tide\n'), when: [9, 10, 5] },
  { name: 'keys/licence.key', data: Buffer.alloc(1800, 3), enc: true, when: [9, 10, 6] },
  { name: 'cache/fill.bin', data: Buffer.alloc(48 * 1024 * 1024), when: [9, 10, 7] },
]);
writeFileSync(join(here, 'vendor-drop.zip'), drop);

/* A gzip of one file: the page reads it as that file. Node writes no name and a zero time into its header, so the bytes
   are the same on every run and the file is named by the archive's own name. */
const tide = gzipSync(rd('reading/tide-table.txt'), { level: 9 });
writeFileSync(join(here, 'tide-table.txt.gz'), tide);

console.log(`harbour-survey-2026.zip ${survey.length} bytes, vendor-drop.zip ${drop.length} bytes, tide-table.txt.gz ${tide.length} bytes`);
