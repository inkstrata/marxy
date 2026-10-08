// The reading position of a 1 MB document (A-02, split out of progressive.test.mjs by G-04): opened
// at 80 % of the bytes, kept across a live reload, kept across a one-byte commitEdit. They are slow
// (about 100 s together, each mounting 1 MB and letting its grid passes settle), so they run in the
// nightly `browser-full` suite and are not in `test:lite`; the pull-request guard for "first text
// never waits for the whole file" is the 1 MB first-text test that stays in progressive.test.mjs.
// WebKit, through startApp and the memory shell on the Vite dev server, as that file runs it.
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
const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const BIG = Buffer.from(generateLarge(1024 * 1024));
const SMALL = Buffer.from('# Small\n\nA short document, wholly in the article at once.\n');
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

/**
 * One WebKit page holding the 1 MB document, booted once and handed to the two tests that need it
 * (the live reload and the one-byte edit). Mounting 1 MB and letting its grid passes settle is most
 * of this file's time, and neither needs a page of its own: each reads its own position before it
 * acts and compares after.
 */
let bigShared;
function bigPage() {
  bigShared ??= (async () => {
    const browser = await launchWebkit();
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      await boot(page, { '/docs/big.md': b64(BIG) }, ['/docs/big.md']);
      return { browser, page };
    } catch (e) {
      await browser.close();
      throw e;
    }
  })();
  return bigShared;
}
after(async () => { if (bigShared) await (await bigShared.catch(() => null))?.browser.close(); });

/**
 * Boots the app on `argv[0]`. At the `first_text` mark the shell records how many top-level children
 * the article holds; `window.__h` is the handle, and `window.__complete` turns true when the open
 * document is wholly in.
 */
async function boot(page, files, argv, { typeset = true } = {}) {
  const base = await harnessBase();
  await page.goto(`${base}app.html`);
  await page.waitForFunction(() => typeof window.marxyApp?.start === 'function');
  await page.evaluate(
    async ({ files, argv, typeset }) => {
      // The theme's kill switch: no typesetter, so no background pass asks for a whole-article snap.
      if (!typeset) document.documentElement.style.setProperty('--marxy-typeset', 'none');
      const bytes = {};
      for (const [path, b64] of Object.entries(files)) {
        const raw = atob(b64);
        const out = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
        bytes[path] = out;
      }
      const { createMemoryShell } = await import('/src/shell/memory.ts');
      const shell = createMemoryShell(bytes);
      const mark = shell.mark.bind(shell);
      window.__atFirstText = null;
      shell.mark = async (name, t, data) => {
        if (name === 'first_text') window.__atFirstText = document.getElementById('doc').childElementCount;
        return mark(name, t, data);
      };
      const { startApp } = await import('/src/app.ts');
      const handle = await startApp(shell, { argv });
      await handle.ready;
      window.__h = handle;
      window.__complete = false;
      void handle.contentComplete().then(() => { window.__complete = true; });
    },
    { files, argv, typeset },
  );
}

/** Waits until the article stops changing height for a second: chunks, typesetting and grid passes done. */
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

const markNames = (page) => page.evaluate(() => window.__h.shell.calls.filter((c) => c.method === 'mark').map((c) => c.args[0]));

/** The index in the block list of the block the reading position names, and that block's byte range. */
function readingBlock(page) {
  return page.evaluate(() => {
    const h = window.__h;
    const at = h.sourceHarness().byteOffset;
    const blocks = h.state.document.blocks;
    let i = -1;
    for (let j = 0; j < blocks.length && blocks[j].start <= at; j++) i = j;
    return { at, index: i, count: blocks.length };
  });
}

/** The innermost block element whose byte range holds `at`. */
function blockHolding(page, at) {
  return page.evaluate((at) => {
    let best = null;
    for (const el of document.querySelectorAll('#doc :is(p, h1, h2, h3, h4, h5, h6, pre, li, blockquote, table, hr)[data-marxy-s]')) {
      const s = Number(el.getAttribute('data-marxy-s'));
      const e = Number(el.getAttribute('data-marxy-e'));
      if (s <= at && at < e) best = { s, e };
    }
    return best;
  }, at);
}

test('opened at 80 % of the bytes, the block holding that byte is on the reading line, then and after completion', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await boot(page, { '/docs/small.md': b64(SMALL), '/docs/big.md': b64(BIG) }, ['/docs/small.md']);
    const at = Math.floor(BIG.length * 0.8);
    await page.evaluate((at) => window.__h.open('/docs/big.md', { at }), at);
    const block = await blockHolding(page, at);
    assert.ok(block, `a block holds byte ${at} once the open returns`);
    const now = await readingBlock(page);
    assert.ok(now.at >= block.s && now.at < block.e, `reading byte ${now.at}, block ${block.s}-${block.e}`);
    await page.evaluate(() => window.__h.contentComplete());
    await settle(page);
    const later = await readingBlock(page);
    assert.ok(later.at >= block.s && later.at < block.e, `after completion: reading byte ${later.at}, block ${block.s}-${block.e}`);
  } finally {
    await browser.close();
  }
});

test('a live reload at 1 MB keeps the reading byte within one block', async () => {
  const { page } = await bigPage();
  await page.evaluate(() => window.__h.contentComplete());
  await settle(page);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight * 0.5));
  await page.waitForFunction(() => window.scrollY > 1000);
  const before = await readingBlock(page);
  const next = Buffer.concat([BIG, Buffer.from('\n\nAppended after an external write.\n')]);
  await page.evaluate(async (b64) => {
    const h = window.__h;
    const path = h.currentPath();
    const raw = atob(b64);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    await h.shell.writeFileAtomic(path, bytes);
    h.shell.emit([{ kind: 'modified', path }]);
    const deadline = performance.now() + 20_000;
    while (!h.shell.calls.some((c) => c.method === 'mark' && c.args[0] === 'live_reload') && performance.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20));
    }
  }, b64(next));
  assert.ok((await markNames(page)).includes('live_reload'), 'the reload happened');
  const after = await readingBlock(page);
  assert.ok(Math.abs(after.index - before.index) <= 1, `reading block ${before.index} (byte ${before.at}) → ${after.index} (byte ${after.at})`);
  await page.evaluate(() => window.__h.contentComplete());
  await settle(page);
  const settled = await readingBlock(page);
  assert.ok(Math.abs(settled.index - before.index) <= 1, `settled: reading block ${before.index} → ${settled.index}`);
});

test('commitEdit of a one-byte change at 1 MB keeps the reading position', async () => {
  const { page } = await bigPage();
  await page.evaluate(() => window.__h.contentComplete());
  await settle(page);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight * 0.6));
  await page.waitForFunction(() => window.scrollY > 1000);
  const before = await readingBlock(page);
  // One byte of the document's first paragraph, well above the reading position, changes case.
  const edited = await page.evaluate(async (core) => {
    const h = window.__h;
    const { createBuffer } = await import(core);
    const open = h.openDocument();
    const bytes = open.buffer.bytes.slice();
    const at = bytes.indexOf(0x54 /* T */, 90);
    bytes[at] = 0x74; /* t */
    await h.commitEdit(createBuffer(open.path, bytes));
    return at;
  }, `/@fs${repoRoot}packages/core/src/buffer/buffer.ts`);
  assert.ok(edited < before.at);
  const after = await readingBlock(page);
  assert.equal(after.at, before.at, `reading byte ${before.at} → ${after.at}`);
  await page.evaluate(() => window.__h.contentComplete());
  await settle(page);
  assert.equal((await readingBlock(page)).at, before.at);
});
