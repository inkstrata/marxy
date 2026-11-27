// The archive page's preview: the entry under the cursor
// read as itself by the pane's own functions (viewers/embed.ts), following the cursor once it rests; with no cursor the
// README. Each kind's own markup in the body; a 20 MB entry's first 256 KB and the sentence; l into the preview and h out,
// the address grown by the inner part's, c copying from inside; o opening the previewed entry without reading it again; a
// gzip of one file read as that file; a relative link in the README putting the cursor on its entry.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateRawSync } from 'node:zlib';
import { after, test as nodeTest } from 'node:test';
import { closeHarness } from './support/two-pane.mjs';
import { skip, withFrame } from './support/frame.mjs';

const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);
after(() => closeHarness());

const demo = join(fileURLToPath(new URL('../../../', import.meta.url)), 'fixtures', 'demo', 'archives');
const SURVEY = '/r/archives/harbour-survey-2026.zip';
const GZ = '/r/archives/tide-table.txt.gz';
const R = 'harbour-survey-2026/';
const FILES = {
  '/r/README.md': '# Here\n',
  [SURVEY]: readFileSync(join(demo, 'harbour-survey-2026.zip')),
  [GZ]: readFileSync(join(demo, 'tide-table.txt.gz')),
};

/** A zip of `[name, bytes]` entries, deflated, with the directory a reader lists from and each entry's checksum. */
function deflatedZip(entries) {
  const locals = [];
  const central = [];
  let at = 0;
  for (const [name, data] of entries) {
    const raw = Buffer.from(data);
    const packed = deflateRawSync(raw);
    const n = Buffer.from(name);
    const crc = crc32(raw);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(8, 8);
    head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(packed.length, 18);
    head.writeUInt32LE(raw.length, 22);
    head.writeUInt16LE(n.length, 26);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(8, 10);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(packed.length, 20);
    cd.writeUInt32LE(raw.length, 24);
    cd.writeUInt16LE(n.length, 28);
    cd.writeUInt32LE(at, 42);
    locals.push(head, n, packed);
    central.push(cd, n);
    at += 30 + n.length + packed.length;
  }
  const cdBytes = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cdBytes.length, 12);
  end.writeUInt32LE(at, 16);
  return new Uint8Array(Buffer.concat([...locals, cdBytes, end]));
}

const blur = (page) => page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
const keys = async (page, ...list) => {
  for (const k of list) await page.keyboard.press(k);
};
const where = (page) => page.evaluate(() => document.querySelector('.marxy-verb-bar:not([hidden]) .marxy-verb-bar-where')?.textContent ?? null);
const waitWhere = (page, text) => page.waitForFunction((t) => document.querySelector('.marxy-verb-bar:not([hidden]) .marxy-verb-bar-where')?.textContent === t, text);
const calls = (page, method) => page.evaluate((m) => window.__marxyHandle.shell.calls.filter((c) => c.method === m).map((c) => c.args.slice(1)), method);
const clipboard = (page) =>
  page.evaluate(() => {
    const last = window.__marxyHandle.shell.calls.filter((c) => c.method === 'clipboardWriteItem').at(-1);
    const rep = last?.args[0].find((r) => r.type === 'public.utf8-plain-text');
    return rep ? new TextDecoder().decode(rep.bytes) : null;
  });
/** The cursor put on the entry `id` (its path in the archive), as the Line's `@` does; the pane is focused first. */
const goTo = async (page, id) => {
  await page.waitForSelector('.marxy-arow');
  await blur(page);
  await page.evaluate(async (id) => {
    const { partsGoTo } = await import('/src/parts/cursor.ts');
    if (!partsGoTo(id)) throw new Error(`no part ${id}`);
  }, id);
};
const body = '.marxy-arch-pbody';

test('1. with no cursor the README is shown, read as Markdown, and its checksum agrees', async () => {
  await withFrame({ files: FILES, open: [SURVEY] }, async (page) => {
    await page.waitForSelector(`${body} article.marxy-article h1`);
    assert.equal(await page.textContent(`${body} h1`), 'Harbour survey, autumn 2026');
    assert.equal(await page.textContent('.marxy-arch-pname'), 'README.md');
    assert.match(await page.textContent('.marxy-arch-pfacts'), / · checksum agrees$/);
    // Read by its beginning, which held all of it: never unpacked a second time.
    const heads = await calls(page, 'readArchiveHeads');
    assert.ok(heads.some(([wants, max]) => max === 256 * 1024 && wants.length === 1 && wants[0].name === `${R}README.md`), JSON.stringify(heads.map(([w, m]) => [w.length, m])));
    assert.equal(await page.$(`${body} .marxy-embed-note`), null, 'all of it was read: nothing to say of how far');
  });
});

test('2. j moves the preview once the cursor has rested, and not before', async () => {
  await withFrame({ files: FILES, open: [SURVEY] }, async (page) => {
    await goTo(page, `${R}data/p95-latency.csv`);
    await page.waitForSelector(`${body} [data-marxy-reading="table"]`);
    await page.evaluate((body) => {
      const st = (window.__pause = { moved: 0, drawn: 0, treeWhenMoved: null, tableWhenMoved: null });
      const bar = document.querySelector('.marxy-verb-bar');
      new MutationObserver(() => {
        if (!st.moved && /release\.json$/.test(bar.querySelector('.marxy-verb-bar-where')?.textContent ?? '')) {
          st.moved = performance.now();
          st.treeWhenMoved = document.querySelector(`${body} [data-marxy-reading="tree"]`) !== null;
          st.tableWhenMoved = document.querySelector(`${body} [data-marxy-reading="table"]`) !== null;
        }
      }).observe(bar, { subtree: true, childList: true, characterData: true });
      new MutationObserver(() => {
        if (!st.drawn && document.querySelector(`${body} [data-marxy-reading="tree"]`)) st.drawn = performance.now();
      }).observe(document.querySelector(body), { subtree: true, childList: true });
    }, body);
    await keys(page, 'j');
    await page.waitForFunction(() => window.__pause.drawn > 0);
    const st = await page.evaluate(() => window.__pause);
    assert.equal(st.tableWhenMoved, true, 'the table was still shown when the cursor moved');
    assert.equal(st.treeWhenMoved, false);
    assert.ok(st.drawn - st.moved >= 115, `drawn ${Math.round(st.drawn - st.moved)} ms after the move`);
  });
});

const KINDS = [
  ['Markdown', 'README.md', `article.marxy-article h2`],
  ['code', 'src/indexer.rs', `pre.marxy-run code[data-marxy-done="highlight"] .marxy-line`],
  ['a tree', 'data/release.json', `[data-marxy-reading="tree"] .marxy-tree-branch`],
  ['a table', 'data/p95-latency.csv', `[data-marxy-reading="table"] table.marxy-reading-table tbody tr`],
  ['a log', 'logs/build-2026-10-14.log', `pre.language-log.marxy-run .marxy-line`],
  ['a picture', 'pictures/boat-ribs.jpg', `.marxy-imgpage img.marxy-imgpic`],
  ['a PDF', 'reading/the-case-for-ragged-lines.pdf', `.marxy-pdfpage .marxy-pdf-page canvas.marxy-pdf-canvas`],
  ['mail', 'reading/low-water-notice.eml', `.marxy-mailpage .marxy-mail-subject`],
  ['bytes', 'tools/tidemark.exe', `.marxy-fcpage .marxy-fcard`],
  // Read by the shell's readers from the archive, through a viewer that wraps the preview's shell again. No
  // workbook: the memory shell's stand-in tables know the demo's only at `sheets/`, and the survey keeps it in `data/`.
  ['a database', 'data/gauges.sqlite', `[data-marxy-viewer="sqlite"] .marxy-tbl-grid tbody tr`],
  ['a font', 'fonts/TidemarkSans-Regular.ttf', `[data-marxy-viewer="font"] .marxy-font-spec`],
  ['a recording', 'recordings/bell-buoy.wav', `[data-marxy-viewer="media"] .marxy-media-wave canvas`],
];
let n = 3;
for (const [kind, entry, sel] of KINDS) {
  test(`3.${n++ - 2}. ${kind} previews as its own page: ${sel}`, async () => {
    await withFrame({ files: FILES, open: [SURVEY] }, async (page) => {
      await page.waitForSelector(`${body} h1`);
      // This WebKit build plays no WAV, and a player that errs is the facts page with no waveform: its error is hidden, as
      // archive-held-kinds and frame-media do. A webview that plays it (WebView2) draws the player and the wave.
      if (kind === 'a recording') await page.evaluate(() => Object.defineProperty(HTMLMediaElement.prototype, 'error', { configurable: true, get: () => null }));
      if (entry !== 'README.md') await goTo(page, `${R}${entry}`);
      await page.waitForSelector(`${body} ${sel}`, { timeout: 30_000 });
      if (kind === 'a picture') await page.waitForFunction((s) => document.querySelector(s)?.naturalWidth > 0, `${body} ${sel}`);
      if (kind === 'bytes') await page.waitForSelector(`${body} .marxy-hexrow .marxy-hex-b i`);
      // A text kind wears its own look: the kind is on the page, as on a pane.
      if (['code', 'a log', 'Markdown'].includes(kind)) assert.ok(await page.$(`${body} .marxy-embed-text[data-marxy-kind]`));
      assert.equal(await page.$$eval(`${body} .marxy-embed`, (e) => e.length), 1, 'one entry shown');
    });
  });
}

test('4. a 20 MB entry shows its first 256 KB and says so', async () => {
  const huge = Buffer.alloc(20 * 1024 * 1024);
  const line = Buffer.from('tick ok\n');
  for (let i = 0; i < huge.length; i += line.length) line.copy(huge, i);
  const BIG = '/r/archives/bench.zip';
  await withFrame({ files: { ...FILES, [BIG]: deflatedZip([['bench/fixtures/huge.log', huge]]) }, open: [BIG] }, async (page) => {
    await page.waitForSelector(`${body} .marxy-embed-note`, { timeout: 30_000 });
    assert.equal(await page.textContent(`${body} .marxy-embed-note`), 'The first 256 KB of 20.0 MB. It is over 16.0 MB, so it does not open in a tab: this is how far it is read.');
    await page.waitForSelector(`${body} pre.marxy-run .marxy-line`);
    assert.doesNotMatch(await page.textContent('.marxy-arch-pfacts'), /checksum/, 'a beginning says nothing of the checksum');
    assert.equal((await calls(page, 'readArchiveEntry')).length, 0, 'never unpacked whole');
    assert.ok((await calls(page, 'readArchiveHeads')).some(([wants, max]) => max === 256 * 1024 && wants[0].name === 'bench/fixtures/huge.log'));
  });
});

test('5. l goes into the preview, the address grows to the line, c copies it from inside, h comes back to the entry', async () => {
  await withFrame({ files: FILES, open: [SURVEY] }, async (page) => {
    await goTo(page, `${R}src/publish.sh`);
    await page.waitForSelector(`${body} pre.marxy-run code[data-marxy-done="highlight"] .marxy-line`);
    await waitWhere(page, `harbour-survey-2026.zip!/${R}src/publish.sh`);
    await keys(page, 'l');
    await waitWhere(page, `harbour-survey-2026.zip!/${R}src/publish.sh:1`);
    await keys(page, 'j', 'j');
    await waitWhere(page, `harbour-survey-2026.zip!/${R}src/publish.sh:3`);
    assert.equal(await page.textContent(`${body} .marxy-cursor`), 'set -eu');
    assert.equal(await page.textContent('.marxy-verb-bar-what'), 'line');
    await keys(page, 'c');
    await page.waitForFunction(() => window.__marxyHandle.shell.calls.some((c) => c.method === 'clipboardWriteItem'));
    assert.equal(await clipboard(page), 'set -eu');
    await keys(page, 'h');
    await waitWhere(page, `harbour-survey-2026.zip!/${R}src/publish.sh`);
    assert.equal(await page.$(`${body} .marxy-cursor`), null, 'out of the preview');
    assert.equal(await page.textContent('.marxy-arow.marxy-cursor .marxy-arch-name'), 'publish.sh');
    // A Markdown entry's parts are its blocks, addressed by their lines.
    await goTo(page, `${R}README.md`);
    await page.waitForFunction((b) => document.querySelector(`${b} h2`) && document.querySelectorAll(`${b} .marxy-embed`).length === 1, body);
    await keys(page, 'l', 'j');
    await waitWhere(page, `harbour-survey-2026.zip!/${R}README.md:3–4`);
    assert.match(await page.textContent(`${body} .marxy-cursor`), /^Everything gathered at the east quay/);
  });
});

test('6. o still opens a read-only tab of the previewed entry, from the preview\'s bytes', async () => {
  await withFrame({ files: FILES, open: [SURVEY] }, async (page) => {
    await goTo(page, `${R}pictures/boat-ribs.jpg`);
    await page.waitForSelector(`${body} img.marxy-imgpic`);
    const before = (await calls(page, 'readArchiveEntry')).filter(([i, name]) => name === `${R}pictures/boat-ribs.jpg`).length;
    await keys(page, 'o');
    await page.waitForFunction(() => /boat-ribs\.jpg$/.test(window.__marxyHandle.panes().panes[0].path() ?? ''));
    await page.waitForSelector('[data-marxy-pane="0"] .marxy-imgpage img.marxy-imgpic');
    const afterReads = (await calls(page, 'readArchiveEntry')).filter(([i, name]) => name === `${R}pictures/boat-ribs.jpg`).length;
    assert.equal(afterReads, before, 'the entry was not read again');
    // Read-only: an entry held in memory names no place on disk.
    assert.match(await page.evaluate(() => window.__marxyHandle.panes().panes[0].path()), /^archive-entry:\d+\//);
  });
});

test('7. a gzip of one file reads as that file: one sentence, no plan, no list', async () => {
  await withFrame({ files: FILES, open: [GZ] }, async (page) => {
    await page.waitForSelector(`${body} [data-marxy-reading]`, { timeout: 30_000 });
    assert.equal(await page.textContent('.marxy-arch-lede'), 'A gzip stream of one file: tide-table.txt. 318 bytes in the file, 502 bytes unpacked. It is read below as what it is.');
    assert.equal(await page.$('.marxy-arch-plan'), null);
    assert.equal(await page.$('.marxy-arow'), null);
    assert.equal(await page.$('.marxy-arch-phead'), null);
    assert.match(await page.textContent(body), /Low water at six\. The harbour/);
    // Its parts are the file's: the cursor walks them from the top.
    await blur(page);
    await keys(page, 'j');
    await page.waitForFunction(() => /^tide-table\.txt\.gz!\/tide-table\.txt:\d/.test(document.querySelector('.marxy-verb-bar:not([hidden]) .marxy-verb-bar-where')?.textContent ?? ''));
  });
});

test('8. a relative link in the README\'s preview puts the cursor on that entry; nothing else is followed', async () => {
  await withFrame({ files: FILES, open: [SURVEY] }, async (page) => {
    await page.waitForSelector(`${body} .marxy-arch-link`);
    const links = await page.$$eval(`${body} a`, (as) => as.map((a) => [a.textContent, a.getAttribute('href'), a.getAttribute('data-marxy-arch-to')]));
    assert.deepEqual(links, [
      ['indexer', null, `${R}src/indexer.rs`],
      ['script that published the table', null, `${R}src/publish.sh`],
    ]);
    await page.locator(`${body} .marxy-arch-link`).first().scrollIntoViewIfNeeded();
    const box = await page.locator(`${body} .marxy-arch-link`).first().boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await waitWhere(page, `harbour-survey-2026.zip!/${R}src/indexer.rs`);
    await page.waitForSelector(`${body} pre.marxy-run code.language-rust`);
  });
});

test('an image in a README preview is its alt text and is never asked for', async () => {
  const PICS = '/r/archives/pics.zip';
  const readme = '# Pics\n\nThe chart: ![tide chart](./chart.png) and the logo <img src="logo.png" alt="logo">.\n';
  const zip = deflatedZip([['pics/README.md', readme], ['pics/chart.png', 'not a png'], ['pics/logo.png', 'not a png']]);
  await withFrame({ files: { ...FILES, [PICS]: zip }, open: [PICS] }, async (page) => {
    await page.waitForSelector(`${body} h1`);
    await page.waitForTimeout(300);
    const got = await page.evaluate((sel) => ({
      imgs: document.querySelectorAll(`${sel} img`).length,
      notes: [...document.querySelectorAll(`${sel} .marxy-palette-prev-image`)].map((n) => n.textContent),
      asked: performance.getEntriesByType('resource').map((e) => e.name).filter((n) => /chart\.png|logo\.png/.test(n)),
    }), body);
    assert.deepEqual(got, { imgs: 0, notes: ['tide chart', 'logo'], asked: [] });
  });
});

test('an embed whose entry is let go while it is made (its page went) says so and raises nothing', async () => {
  await withFrame({ files: FILES, open: [SURVEY] }, async (page) => {
    await page.waitForSelector(`${body} h1`);
    const said = await page.evaluate(async ([zip, name]) => {
      const { holdPreview, releasePreviews } = await import('/src/document/entries.ts');
      const { createEmbed } = await import('/src/viewers/embed.ts');
      const { entryShell } = await import('/src/viewers/archive-entries.ts');
      const shell = window.__marxyHandle.shell;
      const listing = await shell.listArchive(zip);
      const e = listing.entries.find((x) => x.path === name);
      const bytes = await shell.readArchiveEntry(zip, e.index, e.path);
      const held = holdPreview({ archive: '/r/gone.zip', name, index: e.index, bytes, mtimeMs: null });
      const host = document.createElement('div');
      document.body.append(host);
      const making = createEmbed({ shell: entryShell(shell), path: held.path, whole: true, host, size: 'page', open: () => {} });
      releasePreviews({ archive: '/r/gone.zip' });
      const embed = await making;
      const text = host.textContent;
      embed.destroy();
      host.remove();
      return text;
    }, [SURVEY, `${R}fonts/TidemarkSans-Regular.ttf`]);
    // The page error check of withFrame is the other half: nothing went unheard.
    assert.match(said, /TidemarkSans-Regular\.ttf is no longer held in memory/);
  });
});

test('mini: an embed for a tile is inert and has no parts', async () => {
  await withFrame({ files: FILES, open: [SURVEY] }, async (page) => {
    await page.waitForSelector(`${body} h1`);
    const got = await page.evaluate(async () => {
      const { holdPreview } = await import('/src/document/entries.ts');
      const { createEmbed } = await import('/src/viewers/embed.ts');
      const host = document.createElement('div');
      document.body.append(host);
      const held = holdPreview({ archive: '/r/x.zip', name: 'x/notes.md', index: 0, bytes: new TextEncoder().encode('# Tile\n\nA small page.\n'), mtimeMs: null });
      const embed = await createEmbed({ shell: window.__marxyHandle.shell, path: held.path, whole: true, host, size: 'mini', open: () => {} });
      const out = { inert: embed.el.inert, h1: host.querySelector('h1')?.textContent ?? null, parts: embed.parts().length };
      embed.destroy();
      out.left = host.children.length;
      host.remove();
      return out;
    });
    assert.deepEqual(got, { inert: true, h1: 'Tile', parts: 0, left: 0 });
  });
});
