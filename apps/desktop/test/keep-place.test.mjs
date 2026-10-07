// The reader's place when a paragraph above reflows (B-02.5). At 1 MB, scrolled deep, a paragraph far
// above the screen grows (invisible-character markers, a line more of text, a re-set from idle,
// chunks adopted late) and the block at the top of the screen must not move by more than a pixel.
// While the reader's own input drives the scroll nothing is compensated. WebKit, through startApp and
// the memory shell on the Vite dev server, as test/progressive.test.mjs runs it.
import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { createServer } from 'vite';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { generateLarge } from '../../../scripts/perf-harness.mjs';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip, timeout: 180_000 }, fn);

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const BIG = Buffer.from(generateLarge(1024 * 1024));
const SMALL = Buffer.from('# Small\n\nA short document.\n');
const b64 = (bytes) => Buffer.from(bytes).toString('base64');

let harnessPromise;
let closeHarness = () => {};
function harnessBase() {
  harnessPromise ??= (async () => {
    const desktopRoot = join(repoRoot, 'apps', 'desktop');
    const server = await createServer({
      root: desktopRoot,
      configFile: join(desktopRoot, 'vite.config.ts'),
      logLevel: 'silent',
      server: { port: 0, strictPort: false, host: '127.0.0.1' },
    });
    await server.listen();
    closeHarness = () => server.close();
    return `http://127.0.0.1:${server.config.server.port}/`;
  })();
  return harnessPromise;
}
after(() => closeHarness());

async function boot(page, files, argv) {
  const base = await harnessBase();
  await page.goto(`${base}app.html`);
  await page.waitForFunction(() => typeof window.marxyApp?.start === 'function');
  await page.evaluate(
    async ({ files, argv }) => {
      const bytes = {};
      for (const [path, data] of Object.entries(files)) {
        const raw = atob(data);
        const out = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
        bytes[path] = out;
      }
      const { createMemoryShell } = await import('/src/shell/memory.ts');
      const { startApp } = await import('/src/app.ts');
      const handle = await startApp(createMemoryShell(bytes), { argv });
      await handle.ready;
      window.__h = handle;
    },
    { files, argv },
  );
}

/** Waits until the page stops changing height for a second: chunks, typesetting and grid passes done. */
async function settle(page) {
  await page.evaluate(async () => {
    let last = -1;
    let still = 0;
    while (still < 10) {
      await new Promise((r) => setTimeout(r, 100));
      const h = document.documentElement.scrollHeight;
      if (h === last) still++;
      else { still = 0; last = h; }
    }
  });
}

/**
 * Installs `window.__place`: the top-level block under the reading line (the first that ends below
 * 100 px), and `window.__drift()`, how far its top has moved since it was picked.
 */
const pickPlace = (page) =>
  page.evaluate(() => {
    const article = document.getElementById('doc');
    const el = [...article.children].find((c) => c.getBoundingClientRect().bottom > 100);
    const top = el.getBoundingClientRect().top;
    window.__place = { el, top };
    window.__drift = () => window.__place.el.getBoundingClientRect().top - window.__place.top;
    return { top, index: [...article.children].indexOf(el) };
  });

/** A set paragraph at least `screens` screens above the reading line, with room to grow. */
const farAbove = (page, screens, where = 0.5) =>
  page.evaluate(({ screens, where }) => {
    const limit = -window.innerHeight * screens;
    const found = [...document.querySelectorAll('#doc p.marxy-set')].filter((p) => p.getBoundingClientRect().bottom < limit && p.getBoundingClientRect().top > limit - 8 * window.innerHeight);
    const p = found[Math.floor(found.length * where)];
    window.__far = p;
    return { n: found.length, height: p.getBoundingClientRect().height };
  }, { screens, where });

async function deepAt1Mb(page, fraction) {
  await boot(page, { '/docs/big.md': b64(BIG) }, ['/docs/big.md']);
  await page.evaluate(() => window.__h.contentComplete());
  await settle(page);
  await page.evaluate((f) => window.scrollTo(0, document.documentElement.scrollHeight * f), fraction);
  await page.waitForFunction(() => window.scrollY > 5000);
  await settle(page);
}

/** Markers wide enough to push a line past the measure: what the invisible-character pass writes. */
const growByMarkers = (page) =>
  page.evaluate(() => {
    const p = window.__far;
    const before = p.getBoundingClientRect().height;
    for (let i = 0; i < 24; i++) {
      const m = document.createElement('span');
      m.className = 'marxy-invisible';
      m.style.cssText = 'display:inline-block;width:3.2em;';
      m.textContent = '·';
      p.insertBefore(m, p.firstChild ? p.firstChild.nextSibling : null);
    }
    return before;
  });

test('a paragraph far above grows by markers: the block at the top of the screen stays within 1 px', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await deepAt1Mb(page, 0.5);
    const far = await farAbove(page, 4);
    assert.ok(far.n > 10, `${far.n} set paragraphs far above`);
    const place = await pickPlace(page);
    const before = await growByMarkers(page);
    await settle(page);
    const grew = await page.evaluate((b) => window.__far.getBoundingClientRect().height - b, before);
    const drift = await page.evaluate(() => window.__drift());
    assert.ok(grew >= 20, `the paragraph grew by ${grew.toFixed(1)} px (block ${place.index})`);
    assert.ok(Math.abs(drift) <= 1, `the reading block moved ${drift.toFixed(2)} px after a ${grew.toFixed(1)} px growth above`);
  } finally {
    await browser.close();
  }
});

test('a paragraph far above is re-set in idle time with a line more: the block at the top stays within 1 px', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await deepAt1Mb(page, 0.6);
    const far = await farAbove(page, 6);
    assert.ok(far.n > 10, `${far.n} set paragraphs far above`);
    await pickPlace(page);
    // A line of text more, written the way a post-pass writes: a text node into a set paragraph.
    const grew = await page.evaluate(async () => {
      const p = window.__far;
      const before = p.getBoundingClientRect().height;
      p.appendChild(document.createTextNode(' ' + 'additional words that fill a whole further line of the measure '.repeat(3)));
      await new Promise((r) => setTimeout(r, 1500));
      return p.getBoundingClientRect().height - before;
    });
    await settle(page);
    const drift = await page.evaluate(() => window.__drift());
    assert.ok(grew >= 20, `grew ${grew.toFixed(1)} px`);
    assert.ok(Math.abs(drift) <= 1, `the reading block moved ${drift.toFixed(2)} px`);
  } finally {
    await browser.close();
  }
});

test('opened deep, once the reader scrolls the chunks and idle passes above leave the reading block within 1 px', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await boot(page, { '/docs/small.md': b64(SMALL), '/docs/big.md': b64(BIG) }, ['/docs/small.md']);
    await page.evaluate((at) => window.__h.open('/docs/big.md', { at }), Math.floor(BIG.length * 0.8));
    // The reader takes over: the open's held position lets go, and the reading block is picked here.
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift' })));
    await page.waitForTimeout(400);
    const place = await pickPlace(page);
    assert.ok(place.index > 100, `block ${place.index}`);
    // Samples every frame until the document is whole and set, then the largest drift seen.
    const worst = await page.evaluate(async () => {
      let worst = 0;
      let complete = false;
      void window.__h.contentComplete().then(() => { complete = true; });
      let still = 0;
      let last = -1;
      while (still < 20) {
        await new Promise((r) => requestAnimationFrame(r));
        worst = Math.max(worst, Math.abs(window.__drift()));
        const h = document.documentElement.scrollHeight;
        if (complete && h === last) still++;
        else { still = 0; last = h; }
      }
      return worst;
    });
    assert.ok(worst <= 1, `the reading block moved up to ${worst.toFixed(2)} px while the document was adopted and set`);
  } finally {
    await browser.close();
  }
});

test('while the reader scrolls, a reflow above is not compensated; once they stop it is', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await deepAt1Mb(page, 0.5);
    await farAbove(page, 4);
    await pickPlace(page);
    const during = await page.evaluate(async () => {
      window.dispatchEvent(new WheelEvent('wheel', { deltaY: 1 }));
      const y = window.scrollY;
      const p = window.__far;
      const h = p.getBoundingClientRect().height;
      for (let i = 0; i < 24; i++) {
        const m = document.createElement('span');
        m.className = 'marxy-invisible';
        m.style.cssText = 'display:inline-block;width:3.2em;';
        p.insertBefore(m, p.firstChild ? p.firstChild.nextSibling : null);
      }
      await Promise.resolve();
      await Promise.resolve();
      return { scrolled: window.scrollY - y, grew: p.getBoundingClientRect().height - h };
    });
    assert.ok(during.grew >= 20, `grew ${during.grew}`);
    assert.equal(during.scrolled, 0, 'the wheel is not fought: the scroll position was not moved');
    await settle(page);
    // The reader has stopped: the same growth, in another paragraph above, is now kept in place.
    await farAbove(page, 4, 0.25);
    await pickPlace(page);
    await growByMarkers(page);
    await settle(page);
    const drift = await page.evaluate(() => window.__drift());
    assert.ok(Math.abs(drift) <= 1, `after the reader stopped, the reading block moved ${drift.toFixed(2)} px`);
  } finally {
    await browser.close();
  }
});
