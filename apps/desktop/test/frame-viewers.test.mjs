// Pages of the app's own: the file card with the bytes beside it for a file with no reading, the
// hex view a window at a time (a 2 GB file to its last byte), and the image page: fit, zoom, square pixels, the grid and
// the readout, transparency over checks with grounds, EXIF with its location only on request, stepping through the folder
// in the same tab with Back, the strip, a guess from the bytes, an SVG whose script never runs, HEIC falling to the card.
// A folder of images as rows is folder-page.test.mjs.
// The files are the demo's (fixtures/demo, constructed samples). Playwright WebKit.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test as nodeTest } from 'node:test';
import { closeHarness } from './support/two-pane.mjs';
import { cardText, cardsOf, rowOf, showCardPanel, showPanel, skip, withFrame } from './support/frame.mjs';

const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);
after(() => closeHarness());

const demo = join(fileURLToPath(new URL('../../../', import.meta.url)), 'fixtures', 'demo');
const IMAGES = ['tidemark-icon.png', 'tide-chart.png', 'harbour-at-low-water.jpg', 'boat-ribs.jpg', 'buoy.gif', 'ferry.webp', 'sketch.svg', 'IMG_0417.heic'];
const FILES = {
  '/r/README.md': '# Here\n\nA page.\n',
  '/r/cache/index.tmk': readFileSync(join(demo, 'cache', 'index.tmk')),
  '/r/downloads/IMG_2231': readFileSync(join(demo, 'downloads', 'IMG_2231')),
  '/r/two/a.png': readFileSync(join(demo, 'images', 'tidemark-icon.png')),
  '/r/two/b.png': readFileSync(join(demo, 'images', 'tide-chart.png')),
  ...Object.fromEntries(IMAGES.map((n) => [`/r/images/${n}`, readFileSync(join(demo, 'images', n))])),
};
const DISK = '/r/lab/disk.img';
const DISK_SIZE = 2 ** 31;

const open = async (page, path) => {
  await page.evaluate((p) => window.__marxyHandle.open(p), path);
  await showCardPanel(page, 'facts');
  await page.waitForFunction((p) => document.querySelector('.marxy-drawer .marxy-l-subject')?.textContent === p.slice(p.lastIndexOf('/') + 1), path);
};
const readsOf = (page, path) => page.evaluate((p) => window.__marxyHandle.shell.calls.filter((c) => c.method === 'readFile' && c.args[0] === p).length, path);
// The passing cards (This byte, Cell, Glyph) are the Selection slot's, so Outline's.
const factsOf = async (page, id) => {
  await (id.startsWith('now-') ? showPanel(page, 'metadata') : showCardPanel(page, id));
  return page.evaluate((id) => Object.fromEntries([...document.querySelectorAll(`.marxy-drawer [data-marxy-card="${id}"] .marxy-fact`)].map((e) => [e.children[0].textContent, e.children[1].textContent])), id);
};
const zoomShown = (page) => page.textContent('.marxy-imgbar-zoom');
const imageReady = (page) => page.waitForFunction(() => document.querySelector('.marxy-imgpic')?.complete && document.querySelector('.marxy-imgpic').naturalWidth > 0 && document.querySelector('.marxy-imgbar-zoom')?.textContent);

test('a file with no reading: the card of facts with the bytes beside it, a quiet head, a byte named in the panel', async () => {
  await withFrame({ files: FILES, open: ['/r/cache/index.tmk'] }, async (page) => {
    await page.waitForSelector('.marxy-fcard');
    assert.equal(await page.textContent('.marxy-fcard-kicker'), 'No reading for this file');
    assert.equal(await page.textContent('.marxy-fcard-name'), 'index.tmk');
    const card = await page.innerText('.marxy-fcard');
    assert.match(card, /48\.0 KB · 49,152 bytes/);
    assert.match(card, /binary data the app has no reading for/);
    assert.match(card, /54 4D 4B 31 02 00 00 00 \(“TMK1····”\), match no format the app knows/);
    assert.match(card, /NUL bytes/);
    for (const b of ['Open in default app', 'Show in folder', 'Copy path']) assert.ok(await page.$(`.marxy-fcard-acts button:has-text("${b}")`), b);
    assert.equal(await page.isHidden('.marxy-guess'), true, 'finding no reading is not a guess');
    assert.equal(await page.getAttribute('.marxy-rs-read', 'aria-pressed'), 'true');
    assert.equal(await readsOf(page, '/r/cache/index.tmk'), 0, 'never read whole');
    // The hex view: offsets, sixteen bytes and their text.
    await page.waitForFunction(() => document.querySelector('.marxy-hexrow .marxy-hex-o')?.textContent === '00000000');
    const first = await page.$$eval('.marxy-hexrow:first-child .marxy-hex-b i', (els) => els.slice(0, 4).map((e) => e.textContent));
    assert.deepEqual(first, ['54', '4D', '4B', '31']);
    assert.deepEqual((await cardsOf(page)).map((c) => c.title), ['Reading', 'Facts']);
    assert.match(await cardText(page, 'reading'), /Shown as no reading · a file card and the bytes/);
    // A byte picked is a passing card; arrows move it.
    await page.click('.marxy-hexrow:first-child .marxy-hex-b i:nth-child(13)');
    await showPanel(page, 'metadata');
    await page.waitForFunction(() => document.querySelector('.marxy-drawer [data-marxy-transient] .marxy-card-head span')?.textContent === 'This byte');
    let byte = await factsOf(page, 'now-this byte');
    assert.equal(byte.offset, '0xC · 12');
    assert.equal(byte.value, '21 · 33 · 00100001');
    assert.equal(byte['as text'], '“!”');
    assert.equal(byte['2 bytes'], '33 little-endian · 8,448 big');
    await page.keyboard.press('ArrowRight');
    await showPanel(page, 'metadata');
    await page.waitForFunction(() => /^0xD/.test(document.querySelector('.marxy-drawer [data-marxy-transient] .marxy-fact-v')?.textContent ?? ''));
    byte = await factsOf(page, 'now-this byte');
    assert.equal(byte.offset, '0xD · 13');
    // Source is the bytes alone.
    await page.click('.marxy-rs-source');
    await page.waitForSelector('.marxy-hexpage');
    assert.equal(await page.$('.marxy-fcard'), null);
    assert.equal(await page.getAttribute('.marxy-rs-source', 'aria-pressed'), 'true');
  });
});

test('a 2 GB file opens at once and its last byte is one key away; only ranges are read', async () => {
  await withFrame({ files: FILES, sparse: { [DISK]: DISK_SIZE }, open: ['/r/README.md'] }, async (page) => {
    await open(page, DISK);
    await page.waitForSelector('.marxy-fcard');
    assert.match(await page.innerText('.marxy-fcard'), /2\.0 GB · 2,147,483,648 bytes/);
    await page.waitForFunction(() => document.querySelector('.marxy-hexrow .marxy-hex-b i')?.textContent !== '··');
    await page.focus('.marxy-hexscroll');
    await page.keyboard.press('Control+End');
    await page.waitForFunction(() => [...document.querySelectorAll('.marxy-hexrow .marxy-hex-o')].some((e) => e.textContent === '7FFFFFF0'));
    const last = (DISK_SIZE - 1) % 251;
    await page.waitForFunction((v) => document.querySelector('.marxy-hexrow i[data-marxy-on]')?.textContent === v, last.toString(16).toUpperCase().padStart(2, '0'));
    const byte = await factsOf(page, 'now-this byte');
    assert.equal(byte.offset, '0x7FFFFFFF · 2,147,483,647');
    assert.equal(await readsOf(page, DISK), 0, 'the file is never read whole');
    // Go to takes hex and decimal.
    await page.fill('.marxy-hexbar-input', '0x100');
    await page.press('.marxy-hexbar-input', 'Enter');
    await showPanel(page, 'metadata');
    await page.waitForFunction(() => document.querySelector('.marxy-drawer [data-marxy-transient] .marxy-fact-v')?.textContent === '0x100 · 256');
  });
});

test('the image page: fit, zoom by keys, square pixels from 300 %, the grid past 800 %, the readout from 400 %', async () => {
  await withFrame({ files: FILES, open: ['/r/images/tidemark-icon.png'] }, async (page) => {
    await imageReady(page);
    assert.equal(await zoomShown(page), '100 %', 'fit never enlarges a 32 px icon');
    assert.equal(await page.getAttribute('.marxy-imgbar .marxy-seg button[data-marxy-zoom="fit"]', 'aria-checked'), 'true');
    assert.deepEqual((await cardsOf(page)).map((c) => c.title), ['Reading', 'Facts', 'Image'], 'no camera notes: no EXIF card');
    const image = await factsOf(page, 'contents');
    assert.equal(image.size, '32 × 32 pixels');
    assert.equal(image.format, 'PNG');
    assert.match(image.depth, /8 bits a channel · 4 channels with alpha/);
    assert.equal(image.transparent, 'yes, shown over checks');
    assert.equal(await page.getAttribute('.marxy-imgbox', 'data-marxy-ground'), 'checks');
    await page.click('.marxy-imgstage');
    const steps = ['150 %', '200 %', '300 %', '400 %', '600 %', '800 %', '1200 %', '1600 %'];
    const seen = [];
    for (const want of steps) {
      await page.keyboard.press('+');
      await page.waitForFunction((w) => document.querySelector('.marxy-imgbar-zoom')?.textContent === w, want);
      seen.push({
        z: want,
        square: await page.$eval('.marxy-imgpic', (e) => e.hasAttribute('data-marxy-square')),
        grid: await page.$eval('.marxy-imggrid', (e) => !e.hidden),
      });
    }
    assert.deepEqual(seen.filter((s) => s.square).map((s) => s.z), ['300 %', '400 %', '600 %', '800 %', '1200 %', '1600 %']);
    assert.deepEqual(seen.filter((s) => s.grid).map((s) => s.z), ['1200 %', '1600 %']);
    assert.equal(await page.$eval('.marxy-imgbox', (e) => e.getBoundingClientRect().width), 512);
    // The readout names the pixel under the pointer.
    const box = await page.$eval('.marxy-imgbox', (e) => e.getBoundingClientRect().toJSON());
    await page.mouse.move(box.x + 16 * 14 + 8, box.y + 16 * 10 + 8);
    await page.mouse.move(box.x + 16 * 14 + 9, box.y + 16 * 10 + 9);
    await page.waitForFunction(() => /^x 14 · y 10 · #[0-9A-F]{6}/.test(document.querySelector('.marxy-imgbar-px')?.textContent ?? ''));
    assert.match(await cardText(page, 'contents'), /shown at\s+1600 %/);
    await page.keyboard.press('0');
    await page.waitForFunction(() => document.querySelector('.marxy-imgbar-zoom')?.textContent === '100 %');
    assert.equal(await page.$eval('.marxy-imggrid', (e) => e.hidden), true);
    assert.equal(await page.$eval('.marxy-imgpic', (e) => e.hasAttribute('data-marxy-square')), false);
    // Ctrl and the wheel zoom too.
    await page.mouse.move(box.x + 10, box.y + 10);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -100);
    await page.keyboard.up('Control');
    await page.waitForFunction(() => document.querySelector('.marxy-imgbar-zoom')?.textContent === '150 %');
  });
});

test('transparency over checks, with Light and Dark grounds for the tab; a large image fits without enlarging', async () => {
  await withFrame({ files: FILES, open: ['/r/images/tide-chart.png'] }, async (page) => {
    await imageReady(page);
    const ground = (g) => page.click(`.marxy-imgbar-ground button:has-text("${g}")`);
    await ground('Dark');
    assert.equal(await page.getAttribute('.marxy-imgbox', 'data-marxy-ground'), 'dark');
    await ground('Light');
    assert.equal(await page.getAttribute('.marxy-imgbox', 'data-marxy-ground'), 'light');
    // A ground is the tab's: kept while the tab is open, and the same image in a new tab starts on the checks.
    await page.evaluate(() => window.__marxyHandle.open('/r/README.md'));
    await page.waitForSelector('#doc h1');
    await page.click('.marxy-tabbar .marxy-tab:has-text("tide-chart.png") .marxy-tab-open');
    await imageReady(page);
    assert.equal(await page.getAttribute('.marxy-imgbox', 'data-marxy-ground'), 'light', 'the tab keeps its ground');
    await page.evaluate(() => window.__marxyHandle.panes().openIn('other', '/r/images/tide-chart.png'));
    await page.waitForFunction(() => document.querySelector('[data-marxy-pane="1"] .marxy-imgbox'));
    assert.equal(await page.getAttribute('[data-marxy-pane="1"] .marxy-imgbox', 'data-marxy-ground'), 'checks', 'another tab has its own');
  });
});

test('← and → step through the folder in the same tab, with Back; the strip from three images', async () => {
  await withFrame({ files: FILES, open: ['/r/images/tide-chart.png'] }, async (page) => {
    await imageReady(page);
    await page.waitForFunction(() => document.querySelector('.marxy-imgbar-pos')?.textContent === '7 of 8 in images/');
    assert.equal(await page.$$eval('.marxy-imgstrip .marxy-imgthumb', (els) => els.length), 8, 'eight images: the strip shows');
    await page.click('.marxy-imgstage');
    await page.keyboard.press('ArrowRight');
    await showCardPanel(page, 'facts');
    await page.waitForFunction(() => document.querySelector('.marxy-drawer .marxy-l-subject')?.textContent === 'tidemark-icon.png');
    assert.deepEqual(await rowOf(page), ['tidemark-icon.png*'], 'the image is replaced in its tab');
    await page.keyboard.press('ArrowLeft');
    await showCardPanel(page, 'facts');
    await page.waitForFunction(() => document.querySelector('.marxy-drawer .marxy-l-subject')?.textContent === 'tide-chart.png');
    await page.keyboard.press('ArrowLeft');
    await showCardPanel(page, 'facts');
    await page.waitForFunction(() => document.querySelector('.marxy-drawer .marxy-l-subject')?.textContent === 'sketch.svg');
    await page.click('[data-marxy-head="0"] .marxy-head-step[aria-label="Back"]');
    await showCardPanel(page, 'facts');
    await page.waitForFunction(() => document.querySelector('.marxy-drawer .marxy-l-subject')?.textContent === 'tide-chart.png');
    assert.deepEqual(await rowOf(page), ['tide-chart.png*']);
    // The strip toggles; a folder of two has none until asked.
    await page.click('.marxy-imgbar-strip');
    await page.waitForFunction(() => !document.querySelector('.marxy-imgstrip'));
    await open(page, '/r/two/a.png');
    await imageReady(page);
    await page.waitForFunction(() => document.querySelector('.marxy-imgbar-pos')?.textContent === '1 of 2 in two/');
    assert.equal(await page.$('.marxy-imgstrip'), null, 'two images: no strip');
  });
});

test('→ pressed faster than the pages open steps once per press, in one tab with Back; the HEIC card steps on too', async () => {
  await withFrame({ files: FILES, open: ['/r/images/boat-ribs.jpg'] }, async (page) => {
    await imageReady(page);
    await page.waitForFunction(() => document.querySelector('.marxy-imgbar-pos')?.textContent === '1 of 8 in images/');
    await page.click('.marxy-imgstage');
    for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() => window.__marxyHandle.panes().focused.path() === '/r/images/IMG_0417.heic');
    await page.waitForSelector('.marxy-fcard');
    assert.deepEqual(await rowOf(page), ['IMG_0417.heic*'], 'every step in the one tab');
    // The card of an image this system cannot draw is one of the folder's images: → goes on to the next.
    await page.evaluate(() => window.__marxyHandle.panes().focused.host.focus());
    await page.keyboard.press('ArrowRight');
    await showCardPanel(page, 'facts');
    await page.waitForFunction(() => document.querySelector('.marxy-drawer .marxy-l-subject')?.textContent === 'sketch.svg');
    await page.keyboard.press('ArrowLeft');
    await showCardPanel(page, 'facts');
    await page.waitForFunction(() => document.querySelector('.marxy-drawer .marxy-l-subject')?.textContent === 'IMG_0417.heic');
    await page.click('[data-marxy-head="0"] .marxy-head-step[aria-label="Back"]');
    await showCardPanel(page, 'facts');
    await page.waitForFunction(() => document.querySelector('.marxy-drawer .marxy-l-subject')?.textContent === 'sketch.svg');
  });
});

test('closing the left pane keeps the right pane\'s image an image, in Read; a hex view stays a hex view', async () => {
  await withFrame({ files: FILES, open: ['/r/README.md'] }, async (page) => {
    const viewOf = () => page.evaluate(() => {
      const p = window.__marxyHandle.panes().panes[0];
      return { panes: window.__marxyHandle.panes().panes.length, path: p.path(), mode: p.view.mode, img: !!p.host.querySelector('.marxy-imgpage'), hex: !!p.host.querySelector('.marxy-hexpage') };
    });
    for (const source of [false, true]) {
      await page.evaluate(() => window.__marxyHandle.panes().openIn('other', '/r/images/tide-chart.png'));
      await page.waitForFunction(() => window.__marxyHandle.panes().panes[1]?.host.querySelector('.marxy-imgpic')?.complete);
      if (source) await page.evaluate(() => window.__marxyHandle.panes().panes[1].view.setMode('source'));
      await page.evaluate(async () => {
        const set = window.__marxyHandle.panes();
        await set.close(set.panes[0]);
      });
      const want = source ? { mode: 'source', img: false, hex: true } : { mode: 'rendered', img: true, hex: false };
      assert.deepEqual(await viewOf(), { panes: 1, path: '/r/images/tide-chart.png', ...want }, source ? 'from the hex view' : 'from Read');
      await page.evaluate(() => window.__marxyHandle.open('/r/README.md'));
      await page.waitForFunction(() => window.__marxyHandle.panes().panes[0].path() === '/r/README.md');
    }
  });
});

test('EXIF: the camera’s notes, a stored-sideways photo shown upright, and a location named but shown only on request', async () => {
  await withFrame({ files: FILES, open: ['/r/images/boat-ribs.jpg'] }, async (page) => {
    await imageReady(page);
    const image = await factsOf(page, 'contents');
    assert.match(image.size, /^480 × 640 pixels\s*stored 640 × 480, turned 90° clockwise by its EXIF$/);
    const box = await page.$eval('.marxy-imgbox', (e) => e.getBoundingClientRect().toJSON());
    assert.ok(box.height > box.width, 'drawn upright, taller than wide');
    assert.deepEqual((await cardsOf(page)).map((c) => c.title), ['Reading', 'Facts', 'EXIF', 'Image']);
    assert.match((await factsOf(page, 'frontmatter')).orientation, /turned 90° clockwise: shown upright/);
    await open(page, '/r/images/harbour-at-low-water.jpg');
    await imageReady(page);
    const exif = await factsOf(page, 'frontmatter');
    assert.equal(exif.camera, 'FUJIFILM X-T30 II');
    assert.equal(exif.exposure, '1/250 s · f/5.6 · ISO 200');
    assert.equal(exif['focal length'], '23 mm');
    assert.match(exif.taken, /^12 Oct 2026, 07:41:09, by the camera's clock \(no zone\)$/);
    assert.match(exif.location, /In the file, not shown\./);
    await showCardPanel(page, 'frontmatter');
    assert.doesNotMatch(await page.innerText('.marxy-drawer .marxy-l-body'), /°\s*[NS]/, 'no coordinates until asked');
    await page.click('.marxy-drawer button:has-text("Show where it was taken")');
    await page.waitForFunction(() => /50\.10281° N, 5\.5\d+° W/.test(document.querySelector('.marxy-drawer [data-marxy-card="frontmatter"]')?.innerText ?? ''));
    assert.match(await cardText(page, 'frontmatter'), /Not kept, and no map is fetched/);
    // That tab only: the same image in another pane does not show it.
    await page.evaluate(() => window.__marxyHandle.panes().openIn('other', '/r/images/harbour-at-low-water.jpg'));
    await page.waitForFunction(() => document.querySelector('[data-marxy-head="1"]'));
    // One tab in the window's row, shown in both panes: each pane keeps its own state for it.
    await page.dispatchEvent('[data-marxy-head="1"]', 'mousedown');
    await showCardPanel(page, 'facts');
    await page.waitForFunction(() => document.querySelector('.marxy-drawer .marxy-l-subject')?.textContent?.includes('harbour') && document.querySelector('.marxy-drawer [data-marxy-card="frontmatter"]')?.innerText.includes('In the file, not shown'));
    await page.dispatchEvent('[data-marxy-head="0"]', 'mousedown');
    await page.waitForFunction(() => /50\.10281° N/.test(document.querySelector('.marxy-drawer [data-marxy-card="frontmatter"]')?.innerText ?? ''));
    await page.click('.marxy-drawer button:has-text("Hide it")');
    await page.waitForFunction(() => document.querySelector('.marxy-drawer [data-marxy-card="frontmatter"]')?.innerText.includes('In the file, not shown'));
  });
});

test('a WebP with no extension is read from its bytes and the Reading card says so; a HEIC falls to the card; Source of a PNG is the bytes', async () => {
  await withFrame({ files: FILES, open: ['/r/downloads/IMG_2231'] }, async (page) => {
    await imageReady(page);
    assert.equal(await page.isVisible('.marxy-guess'), false, 'the head draws no reading mark');
    assert.equal(await page.textContent('.marxy-guess'), 'image · guessed');
    assert.match(await cardText(page, 'reading'), /Shown as an image · WebP\s*guessed from its first bytes; the name did not say/);
    assert.equal((await factsOf(page, 'contents')).size, '640 × 400 pixels');
    await open(page, '/r/images/IMG_0417.heic');
    await page.waitForSelector('.marxy-fcard');
    assert.equal(await page.textContent('.marxy-fcard-kicker'), 'An image this system cannot draw');
    assert.match(await page.innerText('.marxy-fcard'), /an image, HEIC/);
    assert.match(await page.innerText('.marxy-fcard'), /cannot draw HEIC/);
    // The memory shell answers as a Windows without the codec does: the card names what would draw it.
    if (await page.evaluate(() => navigator.platform.startsWith('Win'))) {
      assert.match(await page.innerText('.marxy-fcard'), /HEIF Image Extension and the HEVC Video Extension from the Microsoft Store/);
    }
    assert.equal(await page.isHidden('.marxy-guess'), true);
    await page.click('.marxy-rs-source');
    await page.waitForSelector('.marxy-hexpage');
    assert.match(await page.textContent('.marxy-hexbar-what'), /2,048 bytes/);
    await page.click('.marxy-rs-read');
    await page.waitForSelector('.marxy-fcard');
    await open(page, '/r/images/tidemark-icon.png');
    await imageReady(page);
    await page.click('.marxy-rs-source');
    await page.waitForSelector('.marxy-hexpage');
    assert.match(await page.textContent('.marxy-hexbar-what'), /418 bytes · the first 8 bytes are the PNG signature/);
    // The first row is drawn on a frame after the page: wait for it, then count.
    await page.waitForFunction(() => document.querySelectorAll('.marxy-hexrow:first-child i.marxy-hex-magic').length > 0);
    assert.equal(await page.$$eval('.marxy-hexrow:first-child i.marxy-hex-magic', (els) => els.length), 16, 'the signature underlined, in bytes and text');
    assert.deepEqual((await cardsOf(page)).map((c) => c.title), ['Reading', 'Facts']);
    await page.click('.marxy-rs-read');
    await imageReady(page);
    // The card instead, for this tab, and back.
    await showCardPanel(page, 'reading');
    await page.click('.marxy-drawer button:has-text("Show the file card and the bytes instead")');
    await page.waitForSelector('.marxy-fcard');
    await page.click('.marxy-fcard button:has-text("Back to the image")');
    await imageReady(page);
  });
});

test('an SVG is text: Read draws it as an image and its script never runs; Source is its text', async () => {
  await withFrame({ files: FILES, open: ['/r/images/sketch.svg'] }, async (page) => {
    await imageReady(page);
    assert.equal((await factsOf(page, 'contents')).size, '240 × 160 units, from its own size');
    assert.match((await factsOf(page, 'contents')).scripts, /^2 in the file, never run/);
    assert.equal(await page.evaluate(() => window.__svgRan ?? null), null);
    await page.click('.marxy-rs-source');
    await page.waitForFunction(() => document.querySelector('.marxy-source-mount:not([hidden]) .cm-content')?.textContent.includes('<svg'));
    assert.equal(await page.$('.marxy-viewer-mount:not([hidden])'), null);
    await page.click('.marxy-rs-read');
    await imageReady(page);
    assert.equal(await page.evaluate(() => window.__svgRan ?? null), null, 'drawn as an image again, never run');
  });
});
