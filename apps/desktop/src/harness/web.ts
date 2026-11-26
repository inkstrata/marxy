// The whole app in a plain browser, over a memory shell holding fixtures/demo/ under /demo: in `vite` dev, and in the
// demo build (`pnpm build:demo`, then `pnpm preview:demo`). main.ts reaches it only outside Tauri and only in those two
// modes, so the build Tauri ships has none of it (app-harness.test.mjs walks the shipped graph for `createMemoryShell`).
// Nothing is written to disk: a reload starts the files again.
// The demo holds a notebook too (notebooks/tide-heights.ipynb), read as its cells, and a PDF beside its
// essay (reading/the-case-for-ragged-lines.pdf), read as its pages; and the databases (data/*.sqlite, *.db) and
// workbooks (sheets/), read by the memory shell from what the desktop's readers gave for them (harness/tables-demo.json); a
// Word document and a deck (documents/), read through the memory shell's zip reader; its fonts and media (fonts/, media/).
// Text in another encoding (encodings/) is bytes too: a UTF-16 file and a Windows-1252 one. An Outlook message (mail/*.msg)
// is bytes, read as the mail the desktop's reader made of it (harness/native-facts.ts).
/// <reference types="vite/client" />
import { bootApplication } from '../boot.ts';
import { createMemoryShell, type SparseFile } from '../shell/memory.ts';

const ROOT = '/demo';
// Dotfiles and dot-folders (.env.example, plans/.versions) are part of what a folder holds, so they are globbed too. The
// demo's images and files with no reading are bytes, not text: fetched as they are.
const raw: Record<string, string> = {
  ...import.meta.glob(
    [
      '../../../../fixtures/demo/**/*',
      '!../../../../fixtures/demo/{images,downloads,cache,archives,sheets,documents,fonts,media,encodings}/**',
      '!../../../../fixtures/demo/data/*.{sqlite,sqlite-wal,sqlite-shm,db}',
      '!../../../../fixtures/demo/**/*.pdf',
      '!../../../../fixtures/demo/shortcuts/*.lnk',
      '!../../../../fixtures/demo/mail/*.msg',
    ],
    { query: '?raw', import: 'default', eager: true },
  ),
  ...import.meta.glob('../../../../fixtures/demo/**/.*', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob('../../../../fixtures/demo/**/.*/*', { query: '?raw', import: 'default', eager: true }),
};
// Inlined as data URLs: a file with no extension would be served as a script by its URL (vite.config.ts lists them as assets).
const inlined: Record<string, string> = import.meta.glob(
  [
    '../../../../fixtures/demo/{images,downloads,cache,archives,sheets,documents,fonts,media,encodings}/*',
    '../../../../fixtures/demo/data/*.{sqlite,sqlite-wal,sqlite-shm,db}',
    '../../../../fixtures/demo/**/*.pdf',
    '../../../../fixtures/demo/shortcuts/*.lnk',
    '../../../../fixtures/demo/mail/*.msg',
    // The scripts that build the sample archives and documents sit beside them and are not part of the demo.
    '!../../../../fixtures/demo/archives/make-archives.mjs',
    '!../../../../fixtures/demo/documents/make-documents.mjs',
  ],
  { query: '?inline', import: 'default', eager: true },
);

const encoder = new TextEncoder();
const files: Record<string, Uint8Array> = {};
const demoPath = (key: string): string => `${ROOT}/${key.slice(key.indexOf('fixtures/demo/') + 'fixtures/demo/'.length)}`;
for (const [key, text] of Object.entries(raw)) files[demoPath(key)] = encoder.encode(text);
// A checkout marker, so the whole demo folder is one place (the index roots a repository at its .git).
files[`${ROOT}/.git/HEAD`] = encoder.encode('ref: refs/heads/main\n');

/**
 * A 2 GB disk image made in the page and never held (`disk-2026-10.img`): a protective MBR, a GPT header in
 * the second sector, a few sectors of noise, zeros after. The hex view reads it a window at a time.
 */
const DISK_BYTES = 2 * 1024 * 1024 * 1024;
const noise = (i: number): number => {
  let x = Math.imul(i, 2654435761) >>> 0;
  x ^= x >>> 13;
  x = Math.imul(x, 1274126177) >>> 0;
  return (x ^ (x >>> 16)) & 255;
};
const EFI = [...'EFI PART'].map((c) => c.charCodeAt(0));
const disk: SparseFile = {
  size: DISK_BYTES,
  byteAt(i) {
    if (i < 446) return noise(i);
    if (i === 450) return 0xee;
    if (i === 510) return 0x55;
    if (i === 511) return 0xaa;
    if (i >= 512 && i < 520) return EFI[i - 512]!;
    if (i >= 520 && i < 4096) return i % 7 === 0 ? noise(i) : 0;
    return 0;
  },
};

// `?open=data/release.json` opens that file; the default is the plan the page starts on.
const asked = new URLSearchParams(location.search).get('open');
const first = `${ROOT}/${asked ?? 'plans/pg16-upgrade-plan.md'}`;

for (const [key, url] of Object.entries(inlined)) {
  const body = url.slice(url.indexOf(',') + 1);
  files[demoPath(key)] = url.includes(';base64,') ? Uint8Array.from(atob(body), (c) => c.charCodeAt(0)) : encoder.encode(decodeURIComponent(body));
}

void (async () => {
  const shell = createMemoryShell(files, { scoped: true, sparse: { [`${ROOT}/lab/disk-2026-10.img`]: disk } });
  const handle = await bootApplication(shell, { argv: [first] });
  (window as Window & { marxy?: unknown }).marxy = { handle, shell };
})();
