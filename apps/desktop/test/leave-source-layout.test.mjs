// Leaving Source shows the page that was behind it without laying it out again. The page was hidden with `display: none`,
// which throws away the style and layout of every block, so the way back from Source laid out the whole article from
// nothing, whatever was edited: about 0.6 s of layout for 2 MB of plain text and 500 layouts for a 1 MB JSON tree in
// Chromium, every time. The page is now skipped (`content-visibility: hidden`) while Source shows: it keeps both, and
// coming back costs what changed. Chromium's own count of layout time is what this reads (the Windows WebView), run on the
// system Edge when there is one, else Playwright's Chromium; with Source showing, nothing may read the skipped page's
// geometry (that would lay it out whole). In both engines the page comes back whole, at its place, and while skipped it
// adds no scroll range behind Source.
import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { after, test as nodeTest } from 'node:test';
import { chromium, webkit } from 'playwright';
import { launchOptions, launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { b64, closeHarness, harnessBase, routeSkeleton } from './support/two-pane.mjs';

const noWebkit = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1';
after(() => closeHarness());

/**
 * The most layout time, in ms, the way back from Source may spend on a page nothing was edited in. 2 MB of text took
 * 570-610 ms and the JSON tree 100 ms over 500 layouts before; 1-2 ms after. The bound is a slow runner's allowance.
 */
const LAYOUT_MS = 60;

/** Plain prose: sentences, a blank line every six. */
function plainProse(bytes) {
  const words = 'the reader keeps a place in a long text and the page holds it while the window moves around it quietly'.split(' ');
  const out = [];
  let n = 0;
  for (let i = 0; n < bytes; i++) {
    const w = [];
    for (let k = 0; k < 18; k++) w.push(words[(i * 7 + k * 3) % words.length]);
    const piece = `${w.join(' ')}. ${i % 6 === 5 ? '\n\n' : ''}`;
    out.push(piece);
    n += piece.length;
  }
  return out.join('');
}

/** Pretty-printed JSON of records, as a 1 MB export has it. */
function prettyJson(bytes) {
  const rows = [];
  let n = 0;
  for (let i = 0; n < bytes; i++) {
    const row = { id: i, name: `record ${i}`, tags: ['alpha', 'beta', `t${i % 17}`], nested: { depth: i % 5, ok: i % 3 === 0, note: 'a short note' } };
    rows.push(row);
    n += 190;
  }
  return JSON.stringify(rows, null, 2);
}

const FILES = { '/n/small.md': b64('# Small\n\nShort.\n'), '/n/big.txt': b64(plainProse(2_000_000)), '/n/big.json': b64(prettyJson(1_000_000)) };

async function boot(page) {
  const base = await harnessBase();
  await routeSkeleton(page, base);
  await page.goto(`${base}app.html`);
  await page.waitForFunction(() => typeof window.marxyApp?.start === 'function');
  await page.evaluate(async (files) => {
    const bytes = {};
    for (const [path, b] of Object.entries(files)) bytes[path] = Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
    const { createMemoryShell } = await import('/src/shell/memory.ts');
    const { startApp } = await import('/src/app.ts');
    window.__h = await startApp(createMemoryShell(bytes), { argv: ['/n/small.md'] });
    await window.__h.ready;
  }, FILES);
}

/** `n` animation frames: what is queued for the next frames (a mode's chrome, the editor's first measure) has run. */
const frames = (page, n = 2) => page.evaluate((n) => new Promise((resolve) => {
  const step = (left) => (left === 0 ? resolve() : requestAnimationFrame(() => step(left - 1)));
  step(n);
}), n);

const inSource = () => document.body.dataset.marxyMode === 'source' && document.querySelector('#doc').hidden && document.querySelector('#marxy-source .cm-line') !== null;

/** Opens `path`, waits for the whole page, and goes to Source. */
async function intoSource(page, path) {
  await page.evaluate(async (p) => {
    await window.__h.open(p);
    await window.__h.contentComplete();
  }, path);
  await frames(page);
  await page.evaluate(() => window.__h.toggleMode());
  await page.waitForFunction(inSource);
  await frames(page, 3);
}

/**
 * The window's scroll height with the page skipped behind Source, and with it taken down (`display: none`, as before): the
 * skipped page must add no scroll range. Taking it down drops its layout, so this is read last, on a visit of its own.
 */
async function roomBehindSource(page) {
  await page.evaluate(() => window.__h.toggleMode());
  await page.waitForFunction(inSource);
  await frames(page, 3);
  return page.evaluate(async () => {
    const doc = document.querySelector('#doc');
    const scroller = document.scrollingElement;
    const skipped = scroller.scrollHeight;
    // The skipped page's own box: its height and block margins, all of which a scroller counts.
    const style = getComputedStyle(doc);
    const box = { height: doc.getBoundingClientRect().height, above: parseFloat(style.marginBlockStart), below: parseFloat(style.marginBlockEnd) };
    doc.style.display = 'none';
    const gone = scroller.scrollHeight;
    doc.style.display = '';
    return { skipped, gone, box };
  });
}

/** What the reader sees once back in Read: the mode, and the page shown with text in the window. */
async function shownAgain(page) {
  return page.evaluate(() => {
    const doc = document.querySelector('#doc');
    const first = [...doc.children].find((el) => el.getBoundingClientRect().height > 0);
    const box = first?.getBoundingClientRect();
    return {
      mode: document.body.dataset.marxyMode,
      hidden: doc.hidden,
      height: doc.getBoundingClientRect().height,
      inWindow: box !== undefined && box.bottom > 0 && box.top < window.innerHeight,
      text: (first?.textContent ?? '').trim().length,
    };
  });
}

/** The page skipped behind Source takes no room: no height, no block margins, no scroll range the window would not have without it. */
function checkRoom(file, room) {
  assert.deepEqual(room.box, { height: 0, above: 0, below: 0 }, `${file}: the skipped page's own box behind Source`);
  assert.ok(Math.abs(room.skipped - room.gone) <= 1, `${file}: the skipped page adds scroll range behind Source (${room.skipped} px against ${room.gone} with the page gone)`);
}

function checkShown(file, seen) {
  assert.equal(seen.mode, 'rendered', `${file}: back in Read`);
  assert.equal(seen.hidden, false, `${file}: the page is shown`);
  assert.ok(seen.height > 1_000, `${file}: the page has its height again (${seen.height})`);
  assert.ok(seen.inWindow && seen.text > 0, `${file}: text of the page is in the window`);
}

nodeTest('leaving Source does not lay out the page behind it again (Chromium)', { timeout: 300_000 }, async (t) => {
  let browser;
  try {
    browser = await chromium.launch(launchOptions({ channel: 'msedge' }));
  } catch {
    if (!existsSync(chromium.executablePath())) {
      if (process.env.MARXY_BROWSER_TESTS_REQUIRED === '1') throw new Error('neither a system Edge nor Playwright Chromium is here, and MARXY_BROWSER_TESTS_REQUIRED=1');
      t.skip('neither a system Edge nor Playwright Chromium here to run Chromium on; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure');
      return;
    }
    browser = await chromium.launch(launchOptions());
  }
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await boot(page);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Performance.enable');
    const layout = async () => {
      const { metrics } = await cdp.send('Performance.getMetrics');
      const get = (name) => metrics.find((m) => m.name === name)?.value ?? 0;
      return { ms: get('LayoutDuration') * 1000, count: get('LayoutCount') };
    };
    for (const path of ['/n/big.txt', '/n/big.json']) {
      await intoSource(page, path);
      // While Source shows, nothing reads the geometry of the skipped page: a read would lay it out whole. Scrolling Source
      // runs what follows the scroll (the spine, the parts, the observers).
      const before = await layout();
      await page.evaluate(() => {
        const s = document.querySelector('#marxy-source .cm-scroller');
        s.scrollTop += 4_000;
      });
      await frames(page, 6);
      await page.evaluate(() => {
        document.querySelector('#marxy-source .cm-scroller').scrollTop = 0;
      });
      await frames(page, 6);
      const during = await layout();
      const still = during.ms - before.ms;
      console.log(`${path}: Source shown and scrolled, ${still.toFixed(1)} ms of layout in ${during.count - before.count} layouts`);
      assert.ok(still < LAYOUT_MS, `${path}: with Source showing, ${still.toFixed(1)} ms went to layout: something read the skipped page; the bound is ${LAYOUT_MS} ms`);

      const a = await layout();
      await page.evaluate(() => window.__h.toggleMode());
      const b = await layout();
      const ms = b.ms - a.ms;
      console.log(`${path}: leaving Source laid out for ${ms.toFixed(1)} ms in ${b.count - a.count} layouts`);
      checkShown(path, await shownAgain(page));
      assert.ok(ms < LAYOUT_MS, `${path}: leaving Source spent ${ms.toFixed(1)} ms laying the page out again; the bound is ${LAYOUT_MS} ms`);

      checkRoom(path, await roomBehindSource(page));
    }
  } finally {
    await browser.close();
  }
});

nodeTest('leaving Source shows the page behind it whole, at its place (WebKit)', { skip: noWebkit ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure' : false, timeout: 300_000 }, async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await boot(page);
    for (const path of ['/n/big.txt', '/n/big.json']) {
      await intoSource(page, path);
      const ms = await page.evaluate(async () => {
        const t0 = performance.now();
        await window.__h.toggleMode();
        void document.body.offsetHeight;
        return performance.now() - t0;
      });
      console.log(`${path}: leaving Source took ${ms.toFixed(0)} ms (WebKit)`);
      checkShown(path, await shownAgain(page));
      checkRoom(path, await roomBehindSource(page));
    }
  } finally {
    await browser.close();
  }
});
