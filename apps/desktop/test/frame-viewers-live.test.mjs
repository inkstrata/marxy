// Slice 2's leftovers on the pages of the app's own: a page that is watched (the file changes on disk and
// the page shows what is there now, at the reader's place, saying nothing of what changed), Export of the file card, the
// image page and the archive page, the created date on the card, and an open at a byte offset landing the hex view
// there. The files are the demo's (fixtures/demo). Playwright WebKit.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test as nodeTest } from 'node:test';
import { closeHarness } from './support/two-pane.mjs';
import { showCardPanel, showPanel, skip, withFrame } from './support/frame.mjs';

const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);
after(() => closeHarness());

const demo = join(fileURLToPath(new URL('../../../', import.meta.url)), 'fixtures', 'demo');
const TMK = '/r/cache/index.tmk';
const PNG = '/r/images/a.png';
const ZIP = '/r/archives/tidemark-0.5.0.zip';
const tmk = readFileSync(join(demo, 'cache', 'index.tmk'));
const icon = readFileSync(join(demo, 'images', 'tidemark-icon.png'));
const chart = readFileSync(join(demo, 'images', 'tide-chart.png'));
const zip = readFileSync(join(demo, 'archives', 'tidemark-0.5.0.zip'));
const FILES = { '/r/README.md': '# Here\n\nA page.\n', [TMK]: tmk, [PNG]: icon, [ZIP]: zip };

const open = async (page, path, at) => {
  await page.evaluate(({ p, at }) => window.__marxyHandle.open(p, at === undefined ? undefined : { at }), { p: path, at });
  await showCardPanel(page, 'facts');
  await page.waitForFunction((p) => document.querySelector('.marxy-drawer .marxy-l-subject')?.textContent === p.slice(p.lastIndexOf('/') + 1), path);
};
// The passing cards (This byte, Cell, Glyph) are the Selection slot's, so Outline's.
const factsOf = async (page, id) => {
  await (id.startsWith('now-') ? showPanel(page, 'metadata') : showCardPanel(page, id));
  return page.evaluate((id) => Object.fromEntries([...document.querySelectorAll(`.marxy-drawer [data-marxy-card="${id}"] .marxy-fact`)].map((e) => [e.children[0].textContent, e.children[1].textContent])), id);
};
const pickedByte = (page) => page.evaluate(() => document.querySelector('.marxy-drawer [data-marxy-transient] .marxy-fact-v')?.textContent ?? null);
const notices = (page) => page.evaluate(() => [...document.querySelectorAll('.marxy-notice-text')].map((n) => n.textContent));
/** Another program writes `bytes` at `path`, and the watch says so. */
const writeOutside = (page, path, bytes) =>
  page.evaluate(({ path, bytes }) => {
    window.__marxyHandle.shell.plant(path, Uint8Array.from(bytes));
    window.__marxyHandle.shell.emit([{ kind: 'modified', path }]);
  }, { path, bytes: [...bytes] });
const openExport = async (page) => {
  await page.evaluate(async () => {
    const command = window.__marxyHandle.commands().find((c) => c.id === 'document.export');
    await command.run({});
  });
  await page.waitForSelector('.marxy-export[role="dialog"]');
  await built(page);
};
/** The dialog reads what it will write before it shows it. */
const built = (page) => page.waitForFunction(() => document.querySelector('.marxy-export-size')?.textContent !== '');
const formats = (page) => page.$$eval('.marxy-export-format b', (els) => els.map((e) => e.textContent));
const writesOf = (page, path) =>
  page.evaluate((p) => window.__marxyHandle.shell.calls.filter((c) => c.method === 'writeFileAtomic' && c.args[0] === p).length, path);
const bytesAt = (page, path) => page.evaluate(async (p) => [...(await window.__marxyHandle.shell.readFile(p))], path);

test('a file with no reading is watched: written outside, its card and bytes are what is there now, at the byte picked', async () => {
  await withFrame({ files: FILES, open: [TMK] }, async (page) => {
    await page.waitForSelector('.marxy-fcard');
    await page.fill('.marxy-hexbar-input', '0x100');
    await page.press('.marxy-hexbar-input', 'Enter');
    await showPanel(page, 'metadata');
    await page.waitForFunction(() => document.querySelector('.marxy-drawer [data-marxy-transient] .marxy-fact-v')?.textContent === '0x100 · 256');
    const grown = Buffer.concat([tmk, Buffer.alloc(4096, 0x41)]);
    grown.write('NEW!', 0x100);
    await writeOutside(page, TMK, grown);
    await page.waitForFunction(() => /53,248 bytes/.test(document.querySelector('.marxy-fcard')?.innerText ?? ''));
    // The byte picked shows its new value, on the screen it was on.
    await page.waitForFunction(() => document.querySelector('.marxy-hex-b [data-marxy-byte="256"]')?.textContent === '4E');
    assert.equal(await page.getAttribute('.marxy-hex-b [data-marxy-byte="256"]', 'data-marxy-on'), '');
    assert.match((await factsOf(page, 'now-this byte')).value, /^4E · 78/);
    assert.equal(await pickedByte(page), '0x100 · 256', 'the byte picked is still picked');
    assert.deepEqual(await notices(page), [], 'nothing says what changed');
    // Removed, the page stays and says so, as a text file's does.
    await page.evaluate((p) => {
      window.__marxyHandle.shell.remove(p);
      window.__marxyHandle.shell.emit([{ kind: 'removed', path: p }]);
    }, TMK);
    await page.waitForFunction(() => document.querySelectorAll('.marxy-notice-text').length > 0);
    assert.ok(await page.$('.marxy-fcard'), 'the page stays');
  });
});

test('the image page is watched: a new picture at the same name is drawn at the same size of view', async () => {
  await withFrame({ files: FILES, open: [PNG] }, async (page) => {
    await page.waitForFunction(() => document.querySelector('.marxy-imgpic')?.complete && document.querySelector('.marxy-imgpic').naturalWidth > 0);
    const before = await page.evaluate(() => document.querySelector('.marxy-imgpic').naturalWidth);
    await page.keyboard.press('1');
    await page.waitForFunction(() => document.querySelector('.marxy-imgbar-zoom')?.textContent === '100 %');
    await writeOutside(page, PNG, chart);
    await page.waitForFunction((w) => {
      const img = document.querySelector('.marxy-imgpic');
      return img?.complete && img.naturalWidth > 0 && img.naturalWidth !== w;
    }, before);
    assert.equal(await page.textContent('.marxy-imgbar-zoom'), '100 %', 'the zoom the reader chose is kept');
    assert.deepEqual(await notices(page), []);
  });
});

test('the archive page is watched: a new listing at the same name, the page kept', async () => {
  await withFrame({ files: FILES, open: [ZIP] }, async (page) => {
    await page.waitForSelector('.marxy-archpage');
    const rows = await page.$$eval('.marxy-archpage .marxy-arow', (r) => r.length);
    // A zip of one entry, stored: the same name, other bytes.
    const name = Buffer.from('only.txt');
    const data = Buffer.from('one entry\n');
    const { crc32 } = await import('node:zlib');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(data.length, 20); cd.writeUInt32LE(data.length, 24); cd.writeUInt16LE(name.length, 28);
    const body = Buffer.concat([local, name, data]);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
    end.writeUInt32LE(46 + name.length, 12); end.writeUInt32LE(body.length, 16);
    await writeOutside(page, ZIP, Buffer.concat([body, cd, name, end]));
    await page.waitForFunction((n) => document.querySelectorAll('.marxy-archpage .marxy-arow').length !== n, rows);
    assert.match(await page.innerText('.marxy-archpage'), /only\.txt/);
    assert.deepEqual(await notices(page), []);
  });
});

test('Export of the file card: the file as it is, every byte, under a name chosen', async () => {
  await withFrame({ files: FILES, open: [TMK] }, async (page) => {
    await page.waitForSelector('.marxy-fcard');
    await openExport(page);
    assert.equal(await page.getAttribute('.marxy-export', 'aria-label'), 'Export index.tmk');
    assert.deepEqual(await formats(page), ['The file, as it is']);
    assert.match(await page.textContent('.marxy-export-pre'), /^index\.tmk: 48\.0 KB · 49,152 bytes, starting 54 4D 4B 31/);
    assert.equal(await page.textContent('.marxy-export-size'), '49,152 bytes');
    await page.evaluate(() => window.__marxyHandle.shell.queueSaveDialog('/r/copy.tmk'));
    await page.click('.marxy-export-go');
    await page.waitForSelector('.marxy-export-scrim', { state: 'detached' });
    assert.equal(await writesOf(page, '/r/copy.tmk'), 1);
    assert.deepEqual(await bytesAt(page, '/r/copy.tmk'), [...tmk]);
    // Never over an open file.
    await openExport(page);
    await page.evaluate((p) => window.__marxyHandle.shell.queueSaveDialog(p), TMK);
    await page.click('.marxy-export-go');
    await page.waitForFunction(() => [...document.querySelectorAll('.marxy-notice-text')].some((n) => /never writes over an open file/.test(n.textContent)));
    assert.equal(await writesOf(page, TMK), 0);
  });
});

test('Export of the image page and of the archive page: the bytes, and for an archive its listing', async () => {
  await withFrame({ files: FILES, open: [PNG] }, async (page) => {
    await page.waitForSelector('.marxy-imgpage');
    await openExport(page);
    assert.deepEqual(await formats(page), ['The image, as it is']);
    await page.evaluate(() => window.__marxyHandle.shell.queueSaveDialog('/r/out.png'));
    await page.click('.marxy-export-go');
    await page.waitForSelector('.marxy-export-scrim', { state: 'detached' });
    assert.deepEqual(await bytesAt(page, '/r/out.png'), [...icon]);

    await open(page, ZIP);
    await page.waitForSelector('.marxy-archpage');
    await openExport(page);
    assert.deepEqual(await formats(page), ['The archive, as it is', 'The listing']);
    await page.click('.marxy-export-format:has-text("The listing") input');
    await built(page);
    const listing = await page.textContent('.marxy-export-pre');
    assert.match(listing, /^tidemark-0\.5\.0\//m);
    assert.match(listing, /README\.md\s+\d+\s+\d{4}-\d\d-\d\d \d\d:\d\d$/m);
    await page.evaluate(() => window.__marxyHandle.shell.queueSaveDialog('/r/listing.txt'));
    await page.click('.marxy-export-go');
    await page.waitForSelector('.marxy-export-scrim', { state: 'detached' });
    assert.equal(new TextDecoder().decode(Uint8Array.from(await bytesAt(page, '/r/listing.txt'))), listing);
  });
});

test('Save in the viewer export dialog pressed twice opens one save dialog', async () => {
  await withFrame({ files: FILES, open: [TMK] }, async (page) => {
    await page.waitForSelector('.marxy-fcard');
    await openExport(page);
    await page.evaluate(() => {
      const sh = window.__marxyHandle.shell;
      const was = sh.saveDialog.bind(sh);
      sh.saveDialog = async (o) => {
        await new Promise((r) => setTimeout(r, 400));
        return was(o);
      };
      sh.queueSaveDialog(null);
      const b = document.querySelector('.marxy-export-go');
      b.click();
      b.click();
    });
    await page.waitForFunction(() => document.querySelector('.marxy-export-go').textContent === 'Saving…');
    await page.waitForFunction(() => document.querySelector('.marxy-export-go').textContent === 'Save…');
    assert.equal(await page.evaluate(() => window.__marxyHandle.shell.calls.filter((c) => c.method === 'saveDialog').length), 1);
  });
});

test('the card says when the file was made, and an open at a byte offset lands the hex view there', async () => {
  await withFrame({ files: FILES, open: ['/r/README.md'] }, async (page) => {
    await open(page, TMK, 0x2a0);
    await page.waitForSelector('.marxy-fcard');
    assert.match(await page.innerText('.marxy-fcard'), /created\s+\d{1,2} \w{3} \d{4}, \d\d:\d\d/);
    assert.match((await factsOf(page, 'facts')).created ?? '', /^\d{1,2} \w{3} \d{4}, \d\d:\d\d$/);
    await showPanel(page, 'metadata');
    await page.waitForFunction(() => document.querySelector('.marxy-drawer [data-marxy-transient] .marxy-fact-v')?.textContent === '0x2A0 · 672');
    await page.waitForFunction(() => document.querySelector('.marxy-hexrow i[data-marxy-on]') !== null);
    // An image's Read is the picture: the bytes at an offset are its Source.
    await open(page, PNG, 16);
    await page.waitForSelector('.marxy-hexpage');
    assert.equal(await page.getAttribute('.marxy-rs-source', 'aria-pressed'), 'true');
    await showPanel(page, 'metadata');
    await page.waitForFunction(() => document.querySelector('.marxy-drawer [data-marxy-transient] .marxy-fact-v')?.textContent === '0x10 · 16');
    // The same file asked for again at another byte moves there without reading it again.
    await open(page, PNG, 24);
    await showPanel(page, 'metadata');
    await page.waitForFunction(() => document.querySelector('.marxy-drawer [data-marxy-transient] .marxy-fact-v')?.textContent === '0x18 · 24');
  });
});
