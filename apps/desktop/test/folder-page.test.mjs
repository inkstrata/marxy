// A folder's page as the reader meets it: rows only, a folder of images with a small picture at each row's start and its
// facts under the name, what search leaves out folded to one line at the foot, the rows reached by keyboard, and a folder
// of 2,000 photos that lists at once and draws only the pictures near the view. Playwright WebKit over the memory shell.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test as nodeTest } from 'node:test';
import { closeHarness } from './support/two-pane.mjs';
import { showCardPanel, skip, withFrame } from './support/frame.mjs';

const test = (name, fn) => nodeTest(name, { skip, timeout: 180_000 }, fn);
after(() => closeHarness());

const demo = join(fileURLToPath(new URL('../../../', import.meta.url)), 'fixtures', 'demo', 'images');
const IMAGES = ['tidemark-icon.png', 'tide-chart.png', 'harbour-at-low-water.jpg', 'boat-ribs.jpg', 'buoy.gif', 'ferry.webp', 'sketch.svg', 'IMG_0417.heic'];
const ICON = readFileSync(join(demo, 'tidemark-icon.png'));
/** A PNG's header alone, saying 30,000 by 30,000 pixels: a few bytes on disk, gigabytes if decoded. */
const BOMB = (() => {
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write('IHDR', 4, 'ascii');
  ihdr.writeUInt32BE(30000, 8);
  ihdr.writeUInt32BE(30000, 12);
  ihdr[16] = 8;
  ihdr[17] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), ihdr, Buffer.from([0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130])]);
})();
const FILES = {
  '/r/README.md': '# Here\n\nA page.\n',
  '/r/two/a.png': ICON,
  ...Object.fromEntries(IMAGES.map((n) => [`/r/images/${n}`, readFileSync(join(demo, n))])),
  '/r/images/notes.md': '# Shot list\n',
  '/r/images/vast.png': BOMB,
  '/w/README.md': '# webapp\n',
  '/w/package.json': '{"name":"webapp"}\n',
  '/w/.env.example': 'API_URL=\n',
  '/w/src/main.ts': 'export {};\n',
  '/w/.cache/x': 'x',
  '/w/.github/ci.yml': 'x',
  '/w/docs/a.md': '# A\n',
};

/** Counts what the page asks the shell for pictures: `window.__loads.url` and `.facts`, and each URL's path. */
const countLoads = (page) =>
  page.evaluate(() => {
    const sh = window.__marxyHandle.shell;
    window.__loads = { url: 0, facts: 0, paths: [] };
    const url = sh.fileUrl.bind(sh);
    const facts = sh.imageFacts.bind(sh);
    sh.fileUrl = (p) => (window.__loads.url++, window.__loads.paths.push(p), url(p));
    sh.imageFacts = (p) => (window.__loads.facts++, facts(p));
  });
const folder = (page, dir) => page.evaluate((d) => import('/src/frame/folder-page.ts').then((m) => m.openFolderPage(window.__marxyHandle, d)), dir);
/** Each row as the reader sees it: its name, the line under it, and what its first cell shows. */
const rows = (page) =>
  page.$$eval('.marxy-folderpage-row', (trs) =>
    trs.map((tr) => {
      const box = tr.querySelector('.marxy-folderpage-pic');
      return {
        name: tr.querySelector('.marxy-folderpage-name').firstChild.textContent,
        facts: tr.querySelector('.marxy-folderpage-why')?.textContent ?? null,
        pic: !box ? '' : box.querySelector('canvas, img') ? 'picture' : (box.querySelector('.marxy-folderpage-ext')?.textContent ?? 'empty'),
        dim: tr.classList.contains('marxy-dim'),
      };
    }),
  );

test('a folder of images lists rows, each with its picture and facts; no tiles and no Grid or List; HEIC shows its extension', async () => {
  await withFrame({ files: FILES, open: ['/r/README.md'] }, async (page) => {
    await countLoads(page);
    await folder(page, '/r/images');
    await page.waitForSelector('.marxy-folderpage-row');
    assert.equal(await page.$('.marxy-foldergrid, .marxy-foldergrid-tiles, .marxy-apppage .marxy-seg'), null, 'no grid of tiles and no switch');
    assert.equal(await page.$('.marxy-apppage button:has-text("Grid"), .marxy-apppage button:has-text("List")'), null);
    assert.deepEqual(await page.$$eval('.marxy-folderpage-table th', (ths) => ths.map((t) => t.textContent)), ['', 'Name', 'Modified']);
    assert.equal(await page.getAttribute('.marxy-folderpage-table th:first-child', 'aria-label'), 'Picture');
    await page.waitForFunction(() => document.querySelectorAll('.marxy-folderpage-pic :is(canvas, img)').length === 7);
    await page.waitForFunction(() => [...document.querySelectorAll('.marxy-folderpage-why')].some((e) => e.textContent === '960 × 640 · JPEG · 32.3 KB'));
    const seen = Object.fromEntries((await rows(page)).map((r) => [r.name, r]));
    assert.equal(Object.keys(seen).length, 10);
    // An image whose header says more pixels than the page decodes keeps its extension, and its bytes are never asked for.
    await page.waitForFunction(() => [...document.querySelectorAll('.marxy-folderpage-why')].some((e) => e.textContent.startsWith('30,000 × 30,000')));
    assert.deepEqual((await rows(page)).find((r) => r.name === 'vast.png'), { name: 'vast.png', facts: '30,000 × 30,000 · PNG · 45 bytes', pic: 'PNG', dim: false });
    assert.equal(await page.evaluate(() => window.__loads.paths.includes('/r/images/vast.png')), false);
    assert.deepEqual(seen['harbour-at-low-water.jpg'], { name: 'harbour-at-low-water.jpg', facts: '960 × 640 · JPEG · 32.3 KB', pic: 'picture', dim: false });
    assert.equal(seen['IMG_0417.heic'].pic, 'HEIC', 'an image this system cannot draw shows its extension');
    assert.match(seen['IMG_0417.heic'].facts, /^HEIC · 2\.0 KB$/);
    assert.deepEqual(seen['notes.md'], { name: 'notes.md', facts: 'Markdown · 12 bytes', pic: '', dim: false }, 'a file that is no image keeps an empty cell');
    for (const r of Object.values(seen)) assert.ok(r.facts, `${r.name} has its facts line`);
    assert.ok(Object.values(seen).every((r) => !r.dim), 'rows are not dimmed');
    // Each picture is held at its box's size, not the photo's.
    const sizes = await page.$$eval('.marxy-folderpage-pic canvas', (cs) => cs.map((c) => [c.width, c.height]));
    assert.ok(sizes.length > 0 && sizes.every(([w, h]) => w <= 96 && h <= 72), JSON.stringify(sizes));
    const painted = await page.$eval('.marxy-folderpage-row:has-text("harbour-at-low-water.jpg") canvas', (c) => {
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i]) n++;
      return n;
    });
    assert.ok(painted > 0, 'the photo is drawn into its picture');
    // A drawing keeps its own element, drawn by the webview at the box's size.
    assert.equal(await page.$eval('.marxy-folderpage-row:has-text("sketch.svg") .marxy-folderpage-pic img', (i) => i.complete && i.naturalWidth > 0), true);
    const box = await page.$eval('.marxy-folderpage-pic', (b) => [b.offsetWidth, b.offsetHeight]);
    assert.deepEqual(box, [48, 36]);
    // A row opens its file.
    await page.click('.marxy-folderpage-row:has-text("ferry.webp")');
    await showCardPanel(page, 'facts');
    await page.waitForFunction(() => document.querySelector('.marxy-drawer .marxy-l-subject')?.textContent === 'ferry.webp' && !document.querySelector('.marxy-apppage'));
    // A folder of few images keeps Read as and Size, and no pictures.
    await folder(page, '/r');
    await page.waitForSelector('.marxy-folderpage-row');
    assert.deepEqual(await page.$$eval('.marxy-folderpage-table th', (ths) => ths.map((t) => t.textContent)), ['Name', 'Read as', 'Size', 'Modified']);
    assert.equal(await page.$('.marxy-folderpage-pic'), null);
  });
});

const tauriImages = fileURLToPath(new URL('../src-tauri/', import.meta.url));
const AVIF = readFileSync(join(tauriImages, 'tests', 'fixtures', 'images', 'tiny.avif'));
/** A 64 x 32 HEIC written by Windows' own encoder, coded as 68 x 34 and cropped back by its `clap`. */
const HEIC = readFileSync(join(tauriImages, 'src', 'decode', 'probe.heic'));

test('an AVIF and a HEIC in a folder of images show their pixel size from their item boxes; a truncated HEIC its extension', async () => {
  const files = {
    '/r/README.md': '# Here\n',
    '/r/pics/a.png': ICON,
    '/r/pics/b.png': ICON,
    '/r/pics/tiny.avif': AVIF,
    '/r/pics/halves.heic': HEIC,
    '/r/pics/cut.heic': HEIC.subarray(0, 300),
  };
  await withFrame({ files, open: ['/r/README.md'] }, async (page) => {
    await folder(page, '/r/pics');
    await page.waitForFunction(() => [...document.querySelectorAll('.marxy-folderpage-why')].some((e) => e.textContent.startsWith('64 × 32')));
    await page.waitForFunction(() => [...document.querySelectorAll('.marxy-folderpage-why')].some((e) => e.textContent.startsWith('6 × 4')));
    const seen = Object.fromEntries((await rows(page)).map((r) => [r.name, r]));
    assert.equal(seen['tiny.avif'].facts, '6 × 4 · AVIF · 332 bytes');
    assert.deepEqual(seen['halves.heic'], { name: 'halves.heic', facts: '64 × 32 · HEIC · 524 bytes', pic: 'HEIC', dim: false });
    assert.deepEqual(seen['cut.heic'], { name: 'cut.heic', facts: 'HEIC · 300 bytes', pic: 'HEIC', dim: false });
  });
});

test('what search leaves out is one line at the foot that opens to the rules, without opening every page’s account', async () => {
  await withFrame({ files: FILES, open: ['/r/README.md'] }, async (page) => {
    await folder(page, '/w');
    await page.waitForSelector('.marxy-folderpage-fold');
    const foot = await page.evaluate(() => {
      const col = document.querySelector('.marxy-apppage-column');
      return { last: col.lastElementChild.className, folds: col.querySelectorAll('.marxy-account').length, h2: [...col.querySelectorAll('h2')].map((h) => h.textContent) };
    });
    assert.deepEqual(foot, { last: 'marxy-account marxy-account-own marxy-folderpage-fold', folds: 1, h2: [] });
    assert.equal(await page.textContent('.marxy-folderpage-fold .marxy-account-key'), 'Search leaves out 2 folders and 1 file here');
    assert.equal(await page.isVisible('.marxy-folderpage-rules'), false, 'folded at first');
    assert.doesNotMatch(await page.innerText('.marxy-folderpage-table'), /left out of search/, 'the reasons are in the fold, not on the rows');
    assert.deepEqual((await rows(page)).filter((r) => r.dim).map((r) => r.name), ['.cache/', '.github/', '.env.example'], 'left-out rows stay quiet');
    const switchOn = () => page.evaluate(() => document.documentElement.hasAttribute('data-marxy-account-open'));
    const before = await switchOn();
    await page.click('.marxy-folderpage-fold .marxy-account-key');
    assert.equal(await page.isVisible('.marxy-folderpage-rules'), true);
    assert.equal(await page.getAttribute('.marxy-folderpage-fold .marxy-account-key', 'aria-expanded'), 'true');
    const body = await page.innerText('.marxy-folderpage-fold .marxy-account-body');
    assert.match(body, /Dot folders[\s\S]*leaves out \.cache, \.github/);
    assert.match(body, /leaves out \.env\.example/);
    assert.match(body, /1 file not searched: may hold secrets/);
    assert.equal(await switchOn(), before, 'the reading pages’ account switch is untouched');
    // The key is a button: Enter folds it again.
    await page.focus('.marxy-folderpage-fold .marxy-account-key');
    await page.keyboard.press('Enter');
    assert.equal(await page.isVisible('.marxy-folderpage-rules'), false);
  });
});

test('the rows are reached by keyboard: Tab moves row to row past the pictures, Enter opens', async () => {
  await withFrame({ files: FILES, open: ['/r/README.md'] }, async (page) => {
    await folder(page, '/r/images');
    await page.waitForSelector('.marxy-folderpage-row');
    await page.focus('.marxy-folderpage-row');
    const focused = () => page.evaluate(() => document.activeElement?.querySelector?.('.marxy-folderpage-name')?.firstChild.textContent ?? null);
    const names = (await rows(page)).map((r) => r.name);
    assert.equal(await focused(), names[0]);
    await page.keyboard.press('Tab');
    assert.equal(await focused(), names[1]);
    await page.keyboard.press('Tab');
    assert.equal(await focused(), names[2]);
    assert.equal(await page.evaluate(() => document.activeElement.matches(':focus-visible') || document.activeElement.matches(':focus')), true);
    await page.keyboard.press('Enter');
    await showCardPanel(page, 'facts');
    await page.waitForFunction((n) => document.querySelector('.marxy-drawer .marxy-l-subject')?.textContent === n && !document.querySelector('.marxy-apppage'), names[2]);
  });
});

test('a folder of 2,000 photos lists every row at once and loads only the pictures near the view', async () => {
  const big = {};
  for (let i = 1; i <= 2000; i++) big[`/big/photo-${String(i).padStart(4, '0')}.png`] = ICON;
  await withFrame({ files: { '/r/README.md': '# Here\n', ...big }, open: ['/r/README.md'] }, async (page) => {
    await countLoads(page);
    const ms = await page.evaluate(async () => {
      const t0 = performance.now();
      await import('/src/frame/folder-page.ts').then((m) => m.openFolderPage(window.__marxyHandle, '/big'));
      return performance.now() - t0;
    });
    assert.equal(await page.$$eval('.marxy-folderpage-row', (r) => r.length), 2000);
    assert.ok(ms < 5000, `listed in ${Math.round(ms)} ms`);
    await page.waitForFunction(() => document.querySelector('.marxy-folderpage-row .marxy-folderpage-pic canvas'));
    await page.waitForTimeout(500);
    const first = await page.evaluate(() => ({ ...window.__loads }));
    assert.ok(first.url > 0 && first.url < 80, `pictures loaded on opening: ${JSON.stringify(first)}`);
    assert.ok(first.facts < 80);
    // Down to the foot: the last rows draw theirs, and the rows passed over are not all loaded.
    await page.evaluate(() => {
      const s = document.querySelector('.marxy-apppage');
      s.scrollTop = s.scrollHeight;
    });
    await page.waitForFunction(() => [...document.querySelectorAll('.marxy-folderpage-row')].at(-1).querySelector('.marxy-folderpage-pic canvas'));
    const last = await page.evaluate(() => ({ ...window.__loads }));
    assert.ok(last.url > first.url && last.url < 200, `after the jump to the foot: ${JSON.stringify(last)}`);
    // Closed while pictures are still coming: nothing more is asked for or drawn.
    await page.evaluate(() => {
      const s = document.querySelector('.marxy-apppage');
      s.scrollTop = s.scrollHeight / 2;
    });
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.marxy-apppage'));
    const closed = await page.evaluate(() => window.__loads.url);
    await page.waitForTimeout(800);
    assert.equal(await page.evaluate(() => window.__loads.url), closed, 'no picture is loaded after the page closes');
    console.log(`2,000 rows listed in ${Math.round(ms)} ms; pictures loaded: ${first.url} on opening, ${last.url} after the foot`);
  });
});
