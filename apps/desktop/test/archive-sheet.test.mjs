// The archive page's sheet: every entry a tile that
// is its own page drawn small (the preview's embed, mini), filled only as it nears the view; an archive of mostly
// pictures opening as a sheet; the choice kept across a tab switch; j walking the tiles with the preview following; a
// folder under the cursor previewed as its files' tiles; 2,000 entries opened and scrolled as a sheet without a block.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32 } from 'node:zlib';
import { after, test as nodeTest } from 'node:test';
import { closeHarness } from './support/two-pane.mjs';
import { skip, withFrame } from './support/frame.mjs';

const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);
after(() => closeHarness());

const root = join(fileURLToPath(new URL('../../../', import.meta.url)), 'fixtures', 'demo');
const SURVEY = '/r/archives/harbour-survey-2026.zip';
const R = 'harbour-survey-2026/';
const picture = (name) => readFileSync(join(root, 'images', name));

/** A zip of `[name, bytes]` entries, stored, with the directory a reader lists from and each entry's checksum. */
function storedZip(entries) {
  const locals = [];
  const central = [];
  let at = 0;
  for (const [name, data] of entries) {
    const raw = Buffer.from(data);
    const n = Buffer.from(name);
    const crc = crc32(raw);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(raw.length, 18);
    head.writeUInt32LE(raw.length, 22);
    head.writeUInt16LE(n.length, 26);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(raw.length, 20);
    cd.writeUInt32LE(raw.length, 24);
    cd.writeUInt16LE(n.length, 28);
    cd.writeUInt32LE(at, 42);
    locals.push(head, n, raw);
    central.push(cd, n);
    at += 30 + n.length + raw.length;
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

const PICS = '/r/archives/quay-pictures.zip';
const PICS_ZIP = storedZip([
  ['quay/boat-ribs.jpg', picture('boat-ribs.jpg')],
  ['quay/buoy.gif', picture('buoy.gif')],
  ['quay/ferry.webp', picture('ferry.webp')],
  ['quay/harbour-at-low-water.jpg', picture('harbour-at-low-water.jpg')],
  ['quay/tide-chart.png', picture('tide-chart.png')],
  ['quay/notes.md', '# Notes\n\nTaken at the quay.\n'],
]);

const FILES = {
  '/r/README.md': '# Here\n',
  [SURVEY]: readFileSync(join(root, 'archives', 'harbour-survey-2026.zip')),
  [PICS]: PICS_ZIP,
};

const blur = (page) => page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
const waitWhere = (page, text) => page.waitForFunction((t) => document.querySelector('.marxy-verb-bar:not([hidden]) .marxy-verb-bar-where')?.textContent === t, text);
const tile = (name) => `.marxy-arch-sheet .marxy-arch-tile:has(.marxy-arch-tile-name:text-is("${name}"))`;
const opt = (words) => `.marxy-arch-under .marxy-arch-opt:text-is("${words}")`;
const body = '.marxy-arch-pbody';
/** The cursor put on the entry `id` (its path in the archive), as the Line's `@` does; the pane is focused first. */
const goTo = async (page, id) => {
  await blur(page);
  await page.evaluate(async (id) => {
    const { partsGoTo } = await import('/src/parts/cursor.ts');
    if (!partsGoTo(id)) throw new Error(`no part ${id}`);
  }, id);
};
/** Clicks the middle of `sel` with the mouse, as a reader does: nothing is scrolled first. */
const clickAt = async (page, sel) => {
  const box = await page.locator(sel).first().boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
};
const asSheet = async (page) => {
  await page.waitForSelector(opt('a sheet'));
  await page.click(opt('a sheet'));
  await page.waitForSelector('.marxy-arch-sheet .marxy-arch-tile');
};

test('1. a tile is the entry\'s own page, small: Markdown, a picture and bytes each in their own markup', async () => {
  await withFrame({ files: FILES, open: [SURVEY] }, async (page) => {
    await asSheet(page);
    assert.equal(await page.getAttribute(opt('a sheet'), 'aria-pressed'), 'true');
    assert.equal(await page.$('.marxy-atree'), null, 'the sheet replaces the list');
    // The plan and the preview stay.
    assert.ok(await page.$('.marxy-arch-plan .marxy-arch-cell'));
    await page.waitForSelector(`${body} h1`);
    const cases = [
      ['README.md', 'README.md', 'article.marxy-article h1'],
      ['pictures/boat-ribs.jpg', 'boat-ribs.jpg', '.marxy-imgpage img.marxy-imgpic'],
      ['tools/tidemark.exe', 'tidemark.exe', '.marxy-fcpage .marxy-fcard'],
    ];
    for (const [id, name, sel] of cases) {
      await goTo(page, `${R}${id}`);
      await page.waitForSelector(`${tile(name)} .marxy-embed-mini ${sel}`, { timeout: 30_000 });
      if (name === 'boat-ribs.jpg') await page.waitForFunction((img) => img.naturalWidth > 0, await page.$(`${tile(name)} img.marxy-imgpic`));
      // Inert, drawn small: its own page at a third of its size, under the entry's name and what it reads as.
      const t = await page.$eval(tile(name), (t) => ({
        inert: t.querySelector('.marxy-embed').inert,
        w: Math.round(t.querySelector('.marxy-arch-tile-pic').getBoundingClientRect().width),
        says: t.querySelector('.marxy-arch-tile-says').textContent,
      }));
      assert.equal(t.inert, true);
      assert.equal(t.w, 132);
      assert.match(t.says, / · /);
    }
    // An encrypted entry is a tile that says so, with nothing drawn in it.
    const locked = await page.evaluate(async (p) => (await window.__marxyHandle.shell.listArchive(p)).entries.find((e) => e.encrypted), SURVEY);
    const lockedName = locked.path.split('/').pop();
    await goTo(page, locked.path);
    await page.waitForSelector(`${tile(lockedName)} .marxy-arch-tile-note`);
    assert.match(await page.textContent(`${tile(lockedName)} .marxy-arch-tile-note`), /^Encrypted/);
    assert.equal(await page.$(`${tile(lockedName)} .marxy-embed`), null);
  });
});

test('2. tiles out of view are not filled; scrolled, the new ones are and the old ones let go', async () => {
  const many = [];
  for (let i = 0; i < 240; i++) many.push([`notes/n-${String(i).padStart(3, '0')}.md`, `# Note ${i}\n\nWritten at the quay, ${i}.\n`]);
  const NOTES = '/r/archives/notes.zip';
  await withFrame({ files: { ...FILES, [NOTES]: storedZip(many) }, open: [NOTES] }, async (page) => {
    await asSheet(page);
    await page.waitForSelector(`${tile('n-000.md')} .marxy-embed h1`);
    await page.waitForTimeout(400);
    const count = () =>
      page.evaluate(() => {
        const s = document.querySelector('.marxy-arch-sheet');
        const view = s.getBoundingClientRect();
        const tiles = [...s.querySelectorAll('.marxy-arch-tile')];
        const filled = tiles.filter((t) => t.querySelector('.marxy-embed'));
        // How far below the view's bottom, or above its top, the furthest filled tile lies.
        const out = Math.max(0, ...filled.map((t) => { const b = t.getBoundingClientRect(); return Math.max(b.top - view.bottom, view.top - b.bottom); }));
        return { tiles: tiles.length, filled: filled.length, out, names: filled.map((t) => t.querySelector('.marxy-arch-tile-name').textContent) };
      });
    const before = await count();
    assert.ok(before.filled > 0 && before.filled < before.tiles, `${before.filled} filled of ${before.tiles} drawn`);
    assert.ok(before.out <= 300, `a filled tile ${Math.round(before.out)} px out of view`);
    assert.ok(before.tiles < 240, 'the sheet draws only what is near the view');
    await page.evaluate(() => {
      const s = document.querySelector('.marxy-arch-sheet');
      s.scrollTop = s.scrollHeight;
    });
    await page.waitForSelector(`${tile('n-239.md')} .marxy-embed h1`);
    await page.waitForTimeout(400);
    const afterward = await count();
    assert.ok(afterward.filled > 0 && afterward.filled <= 48, `${afterward.filled} filled`);
    assert.ok(afterward.out <= 300, `a filled tile ${Math.round(afterward.out)} px out of view`);
    assert.ok(!afterward.names.includes('n-000.md'), 'the first tile was let go');
    // A tile's entry is let go a moment after its tile, so a read on its way never finds it gone.
    let held = Infinity;
    for (let i = 0; i < 30 && held > 48; i++) {
      await page.waitForTimeout(100);
      held = await page.evaluate(async () => (await import('/src/document/entries.ts')).tilesHeld());
    }
    assert.ok(held <= 48, `${held} entries held for tiles`);
  });
});

test('3. an archive of pictures opens as a sheet; the survey opens as a list', async () => {
  await withFrame({ files: FILES, open: [PICS] }, async (page) => {
    await page.waitForSelector('.marxy-arch-sheet .marxy-arch-tile');
    assert.equal(await page.getAttribute(opt('a sheet'), 'aria-pressed'), 'true');
    assert.equal(await page.getAttribute(opt('a list'), 'aria-pressed'), 'false');
    await page.waitForSelector(`${tile('ferry.webp')} .marxy-imgpage img.marxy-imgpic`);
    await page.evaluate((p) => window.__marxyHandle.open(p), SURVEY);
    await page.waitForSelector('.marxy-atree .marxy-arow');
    assert.equal(await page.getAttribute(opt('a list'), 'aria-pressed'), 'true');
    assert.equal(await page.$('.marxy-arch-sheet'), null);
  });
});

test('4. the choice survives a tab switch, and is never written', async () => {
  await withFrame({ files: FILES, open: [PICS] }, async (page) => {
    await page.waitForSelector('.marxy-arch-sheet .marxy-arch-tile');
    await page.click(opt('a list'));
    await page.waitForSelector('.marxy-atree .marxy-arow');
    await page.evaluate(() => window.__marxyHandle.open('/r/README.md'));
    await page.waitForFunction(() => !document.querySelector('.marxy-archpage'));
    await page.evaluate((p) => window.__marxyHandle.open(p), PICS);
    await page.waitForSelector('.marxy-archpage .marxy-arch-under');
    await page.waitForSelector('.marxy-atree .marxy-arow');
    assert.equal(await page.$('.marxy-arch-sheet'), null, 'still a list');
    assert.equal(await page.getAttribute(opt('a list'), 'aria-pressed'), 'true');
    // Back to a sheet, and kept the same way.
    await page.click(opt('a sheet'));
    await page.waitForSelector('.marxy-arch-sheet .marxy-arch-tile');
    await page.evaluate(() => window.__marxyHandle.open('/r/README.md'));
    await page.waitForFunction(() => !document.querySelector('.marxy-archpage'));
    await page.evaluate((p) => window.__marxyHandle.open(p), PICS);
    await page.waitForSelector('.marxy-arch-sheet .marxy-arch-tile');
    // Kept in memory only: no write the app made says how the entries are shown.
    const writes = await page.evaluate(() =>
      window.__marxyHandle.shell.calls.filter((c) => /^write|save|Write/.test(c.method)).map((c) => JSON.stringify(c.args.map((a) => (a instanceof Uint8Array ? new TextDecoder().decode(a) : a)))),
    );
    assert.ok(!writes.some((w) => /sheet/.test(w)), 'nothing written names the sheet');
  });
});

test('5. j walks the tiles and the preview follows; a click on a tile moves the cursor', async () => {
  await withFrame({ files: FILES, open: [PICS] }, async (page) => {
    await page.waitForSelector('.marxy-arch-sheet .marxy-arch-tile');
    await goTo(page, 'quay/boat-ribs.jpg');
    await waitWhere(page, 'quay-pictures.zip!/quay/boat-ribs.jpg');
    await page.waitForSelector(`${tile('boat-ribs.jpg')}.marxy-cursor`);
    await page.keyboard.press('j');
    await waitWhere(page, 'quay-pictures.zip!/quay/buoy.gif');
    await page.waitForSelector(`${tile('buoy.gif')}.marxy-cursor`);
    assert.equal(await page.$(`${tile('boat-ribs.jpg')}.marxy-cursor`), null, 'one tile lit');
    await page.waitForFunction(() => document.querySelector('.marxy-arch-pname')?.textContent === 'buoy.gif');
    await page.waitForSelector(`${body} .marxy-imgpage img.marxy-imgpic`);
    // The plan follows too.
    const lit = await page.$eval('.marxy-arch-cell-on', (c) => c.title);
    assert.match(lit, /buoy\.gif/);
    await clickAt(page, tile('tide-chart.png'));
    await waitWhere(page, 'quay-pictures.zip!/quay/tide-chart.png');
    await page.waitForSelector(`${tile('tide-chart.png')}.marxy-cursor`);
    await page.waitForFunction(() => document.querySelector('.marxy-arch-pname')?.textContent === 'tide-chart.png');
    // o opens the tile's entry, as from the list.
    await page.keyboard.press('o');
    await page.waitForFunction(() => window.__marxyHandle.panes().panes.some((p) => /^archive-entry:\d+\/quay\/tide-chart\.png$/.test(p.path() ?? '')));
  });
});

test('6. a folder under the cursor previews as its files\' tiles', async () => {
  await withFrame({ files: FILES, open: [SURVEY] }, async (page) => {
    await page.waitForSelector('.marxy-atree .marxy-arow');
    await goTo(page, `${R}pictures/`);
    await page.waitForFunction(() => document.querySelector('.marxy-arch-pname')?.textContent === 'pictures/');
    await page.waitForSelector(`${body} .marxy-arch-ftiles .marxy-arch-tile`);
    const listing = await page.evaluate((p) => window.__marxyHandle.shell.listArchive(p), SURVEY);
    const files = listing.entries.filter((e) => e.kind === 'file' && /^harbour-survey-2026\/pictures\/[^/]+$/.test(e.path)).map((e) => e.path.split('/').pop()).sort();
    const shown = (await page.$$eval(`${body} .marxy-arch-tile-name`, (n) => n.map((x) => x.textContent))).sort();
    assert.deepEqual(shown, files);
    await page.waitForSelector(`${body} .marxy-arch-tile:has(.marxy-arch-tile-name:text-is("boat-ribs.jpg")) .marxy-imgpage img.marxy-imgpic`);
    // Off the folder, the tiles go and the entry's own page is shown.
    await goTo(page, `${R}README.md`);
    await page.waitForSelector(`${body} article.marxy-article h1`);
    assert.equal(await page.$(`${body} .marxy-arch-ftiles`), null);
  });
});

test('7. 2,000 entries as a sheet open and scroll with no block of the main thread over 400 ms', async () => {
  const icon = picture('tidemark-icon.png');
  const many = [];
  for (let i = 0; i < 2_000; i++) many.push(i % 5 < 3 ? [`big/p-${String(i).padStart(4, '0')}.png`, icon] : [`big/t-${String(i).padStart(4, '0')}.md`, `# Page ${i}\n\nA line.\n`]);
  const BIG = '/r/archives/many.zip';
  await withFrame({ files: { ...FILES, [BIG]: storedZip(many) }, open: ['/r/README.md'] }, async (page) => {
    await page.evaluate(() => {
      window.__gaps = { max: 0, last: performance.now(), on: true };
      const tick = () => {
        const now = performance.now();
        window.__gaps.max = Math.max(window.__gaps.max, now - window.__gaps.last);
        window.__gaps.last = now;
        if (window.__gaps.on) setTimeout(tick, 10);
      };
      setTimeout(tick, 10);
    });
    await page.evaluate((p) => window.__marxyHandle.open(p), BIG);
    // Mostly pictures: it opens as a sheet.
    await page.waitForSelector('.marxy-arch-sheet .marxy-arch-tile .marxy-embed');
    const drawn = await page.$$eval('.marxy-arch-tile', (t) => t.length);
    assert.ok(drawn < 300, `${drawn} tiles in the page, not 2,000`);
    for (let i = 1; i <= 20; i++) {
      await page.evaluate((f) => {
        const s = document.querySelector('.marxy-arch-sheet');
        s.scrollTop = (s.scrollHeight - s.clientHeight) * f;
      }, i / 20);
      await page.waitForTimeout(60);
    }
    await page.waitForSelector(`${tile('t-1999.md')} .marxy-embed h1`);
    const max = await page.evaluate(() => {
      window.__gaps.on = false;
      return window.__gaps.max;
    });
    assert.ok(max < 400, `the longest block was ${Math.round(max)} ms`);
    assert.ok((await page.$$eval('.marxy-arch-tile .marxy-embed', (e) => e.length)) <= 48);
  });
});
