// Scrolling in Rendered records the reading position without a flush (A-13 step 6): WebKit fires the
// viewport scroll at the Document, so the listener has to be there.
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { createServer } from 'vite';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip }, fn);

const repoRoot = new URL('../../../', import.meta.url).pathname;
const longMd = readFileSync(join(repoRoot, 'fixtures', 'corpus', '01-long-technical.md'));
let serverPromise;
let closeServer = () => {};
after(() => closeServer());

async function base() {
  serverPromise ??= (async () => {
    const root = join(repoRoot, 'apps', 'desktop');
    const server = await createServer({
      root,
      configFile: join(root, 'vite.config.ts'),
      logLevel: 'silent',
      server: { port: 0, strictPort: false, host: '127.0.0.1' },
    });
    await server.listen();
    closeServer = () => server.close();
    return `http://127.0.0.1:${server.config.server.port}/`;
  })();
  return serverPromise;
}

async function boot(page) {
  await page.addInitScript(() => { globalThis.process = { env: {} }; });
  await page.goto(`${await base()}test/palette-boot.html`);
  await page.waitForFunction(() => typeof window.marxyPaletteBoot?.start === 'function', undefined, { timeout: 15_000 });
  await page.evaluate(async ({ b64 }) => {
    const { handle } = await window.marxyPaletteBoot.start({ '/r/long.md': b64 }, ['/r/long.md']);
    window.__h = handle;
  }, { b64: longMd.toString('base64') });
}

const stored = (page) =>
  page.evaluate(async () => {
    try {
      return new TextDecoder().decode(await window.__h.shell.readFile('/data/positions.json'));
    } catch {
      return null;
    }
  });

test('scrolling records the position and writes it after the debounce, with no quit or document switch', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 800 } });
    await boot(page);
    await page.evaluate(() => window.scrollTo(0, 4000));
    await page.waitForTimeout(1200);
    const offset = await page.evaluate(() => window.__h.sourceHarness().byteOffset);
    assert.ok(offset > 0);
    const text = await stored(page);
    assert.ok(text?.includes(`"byteOffset":${offset}`) || text?.match(new RegExp(`"byteOffset":\\s*${offset}\\b`)), `positions.json: ${text?.slice(0, 300)}`);
  } finally {
    await browser.close();
  }
});

test('a burst of scroll events in one frame is sampled once', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 800 } });
    await boot(page);
    const frames = await page.evaluate(async () => {
      let n = 0;
      const raf = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = (cb) => { n += 1; return raf(cb); };
      for (let i = 0; i < 50; i++) document.dispatchEvent(new Event('scroll'));
      await new Promise((r) => setTimeout(r, 100));
      window.requestAnimationFrame = raf;
      return n;
    });
    assert.equal(frames, 1);
  } finally {
    await browser.close();
  }
});

test('pagehide flushes the pending position at once', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 800 } });
    await boot(page);
    await page.evaluate(() => window.scrollTo(0, 5000));
    await page.waitForTimeout(100);
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    await page.waitForTimeout(100);
    const offset = await page.evaluate(() => window.__h.sourceHarness().byteOffset);
    const text = await stored(page);
    assert.ok(offset > 0 && text?.match(new RegExp(`"byteOffset":\\s*${offset}\\b`)), `positions.json: ${text?.slice(0, 300)}`);
  } finally {
    await browser.close();
  }
});

test('quitting right after a scroll, before the debounce has written, keeps the place (the B-14 review)', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 800 } });
    await boot(page);
    const seen = await page.evaluate(async () => {
      window.scrollTo(0, 4000);
      const offset = window.__h.sourceHarness().byteOffset;
      // No wait: the debounced write (POSITIONS_DEBOUNCE_MS) has not run; only the quit's flush can write.
      await window.__h.shell.quit(0);
      let text = null;
      try {
        text = new TextDecoder().decode(await window.__h.shell.readFile('/data/positions.json'));
      } catch {}
      return { offset, text };
    });
    assert.ok(seen.offset > 0);
    assert.ok(seen.text?.match(new RegExp(`"byteOffset":\\s*${seen.offset}\\b`)), `positions.json: ${seen.text?.slice(0, 300)}`);
  } finally {
    await browser.close();
  }
});

/** The app page, with the window's live `pagehide` listeners counted from before anything loads. */
async function appPage(browser) {
  const page = await browser.newPage({ viewport: { width: 960, height: 800 } });
  await page.addInitScript(() => {
    const live = new Set();
    const add = window.addEventListener.bind(window);
    const remove = window.removeEventListener.bind(window);
    window.addEventListener = (type, fn, opts) => { if (type === 'pagehide') live.add(fn); return add(type, fn, opts); };
    window.removeEventListener = (type, fn, opts) => { if (type === 'pagehide') live.delete(fn); return remove(type, fn, opts); };
    window.__pagehideListeners = () => live.size;
  });
  await page.goto(`${await base()}app.html`);
  await page.waitForFunction(() => typeof window.marxyApp?.start === 'function', undefined, { timeout: 15_000 });
  return page;
}

test('a second startApp in one page leaves none of the first instance\'s persistence running (the B-14 review)', async () => {
  const browser = await launchWebkit();
  try {
    const page = await appPage(browser);
    const seen = await page.evaluate(async ({ b64 }) => {
      const frames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const writes = (h, from = 0) =>
        h.shell.calls.slice(from).filter((c) => c.method === 'writeFileAtomic' && c.args[0] === '/data/positions.json').length;
      const first = await window.marxyApp.start({ '/r/long.md': b64 }, ['/r/long.md']);
      await first.ready;
      const listenersAfterFirst = window.__pagehideListeners();
      // The first instance notes a place; its debounced write is still waiting when the second starts.
      window.scrollTo(0, 4000);
      await frames();
      const firstCalls = first.shell.calls.length;
      const firstWroteEarly = writes(first) > 0;
      // The second launch names no document: the engine reports a page's first contentful paint once, so a
      // second document launch in one page would wait for a paint entry that never comes. With no
      // document it reaches `ready` at once, and its persistence is not loaded: any write now is the first's.
      const second = await window.marxyApp.start({}, [], {});
      await second.ready;
      // Past the first instance's debounce (POSITIONS_DEBOUNCE_MS, 500 ms), and its listeners asked again.
      await new Promise((r) => setTimeout(r, 1200));
      window.scrollTo(0, 3000);
      await frames();
      window.dispatchEvent(new Event('pagehide'));
      await new Promise((r) => setTimeout(r, 1200));
      return {
        listenersAfterFirst,
        listenersAfterSecond: window.__pagehideListeners(),
        firstWroteEarly,
        staleWrites: writes(first, firstCalls),
      };
    }, { b64: longMd.toString('base64') });
    assert.equal(seen.listenersAfterFirst, 1);
    assert.equal(seen.firstWroteEarly, false, 'the first instance\'s write was still pending when the second started');
    assert.equal(seen.listenersAfterSecond, 0, 'the first instance\'s pagehide listener is gone');
    assert.equal(seen.staleWrites, 0, 'the first instance wrote positions.json after it was replaced');
  } finally {
    await browser.close();
  }
});

test('an open after the first lands on its `at`, not on the stored place: only the launch restores (firstOpen)', async () => {
  const browser = await launchWebkit();
  try {
    const page = await appPage(browser);
    const text = longMd.toString('utf8');
    const heading = Buffer.byteLength(text.slice(0, text.indexOf('\n## Pass 2') + 1), 'utf8');
    const seen = await page.evaluate(async ({ b64, heading }) => {
      const other = btoa('# Other\n\nA short document.\n');
      const h = await window.marxyApp.start({ '/r/long.md': b64, '/r/other.md': other }, ['/r/long.md']);
      await h.ready;
      window.scrollTo(0, document.documentElement.scrollHeight);
      const stored = h.sourceHarness().byteOffset;
      // Leaving the document writes its place to positions.json.
      await h.open('/r/other.md');
      await h.open('/r/long.md', { at: heading });
      await h.contentComplete();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const positions = new TextDecoder().decode(await h.shell.readFile('/data/positions.json'));
      return { stored, positions, after: h.sourceHarness().byteOffset };
    }, { b64: longMd.toString('base64'), heading });
    assert.ok(seen.stored > heading, `the stored place is below the heading (${seen.stored} > ${heading})`);
    assert.match(seen.positions, new RegExp(`"byteOffset":\\s*${seen.stored}\\b`), 'the place was stored');
    assert.equal(seen.after, heading, 'the open landed on its `at`');
  } finally {
    await browser.close();
  }
});
