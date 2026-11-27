// The reading position of a 1 MB document (split out of progressive.test.mjs): opened
// at 80 % of the bytes, kept across a live reload, kept across a one-byte commitEdit. They are slow
// (about 100 s together, each mounting 1 MB and letting its grid passes settle); the guard for "first text
// never waits for the whole file" is the 1 MB first-text test that stays in progressive.test.mjs.
// WebKit, through startApp and the memory shell on the Vite dev server, as that file runs it.
import { strict as assert } from 'node:assert';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test as nodeTest } from 'node:test';
import { createServer } from './support/shared-vite.mjs';
import { holdBudget, openBrowser, quiet, skip, until } from './support/kit.mjs';
import { generateLarge } from '../../../scripts/perf-harness.mjs';

// Mounting 1 MB and letting the typesetter finish takes minutes on a hosted runner: the timeout is a ceiling.
const test = (name, fn, timeout = 300_000) => nodeTest(name, { skip, timeout }, fn);

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
    const browser = await openBrowser();
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

/** Waits until nothing in the article changed for thirty frames: chunks, typesetting and grid passes done. */
const settle = (page) => quiet(page, { root: '#doc', still: 30 });

const markNames = (page) => page.evaluate(() => window.__h.shell.calls.filter((c) => c.method === 'mark').map((c) => c.args[0]));

/**
 * The reader takes the page to `frac` of its height: a wheel turn first, as their scroll begins, so a place the view still
 * holds from before (the last case's, on this shared page, until its typesetting is done) is let go as a reader's scroll
 * lets it go. A scripted scroll alone is not the reader's, and a pass put the held place back over it in batch runs.
 */
async function readerScroll(page, frac) {
  await page.mouse.move(640, 450);
  await page.mouse.wheel(0, 40);
  await page.evaluate((frac) => window.scrollTo(0, document.documentElement.scrollHeight * frac), frac);
}

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
  const browser = await openBrowser();
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
  await readerScroll(page, 0.5);
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
    while (!h.shell.calls.some((c) => c.method === 'mark' && c.args[0] === 'live_reload')) await new Promise((r) => requestAnimationFrame(r));
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
  await readerScroll(page, 0.6);
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
  }, `/@fs${repoRoot.replaceAll('\\', '/').replace(/^(?!\/)/, '/')}packages/core/src/buffer/buffer.ts`);
  assert.ok(edited < before.at);
  const after = await readingBlock(page);
  assert.equal(after.at, before.at, `reading byte ${before.at} → ${after.at}`);
  await page.evaluate(() => window.__h.contentComplete());
  await settle(page);
  assert.equal((await readingBlock(page)).at, before.at);
});

// Found tracing the case above: a resize burst that starts while a repaint holds the place read the place off the page
// still being set under the hold, and its relayout held that one instead.
test('a resize while a repaint holds the reading position does not put another in its place', async () => {
  const { page } = await bigPage();
  await page.evaluate(() => window.__h.contentComplete());
  await settle(page);
  await readerScroll(page, 0.4);
  await page.waitForFunction(() => window.scrollY > 1000);
  const before = await readingBlock(page);
  await page.evaluate(async () => {
    const h = window.__h;
    const doc = document.getElementById('doc');
    // Once the repaint holds the place, the page moves off it, as a chunk mounted above it moves it, and the article narrows.
    const seen = new PerformanceObserver((list) => {
      if (!list.getEntries().some((e) => e.name === 'marxy:repaint')) return;
      seen.disconnect();
      window.scrollTo(0, 0);
      doc.style.width = `${doc.clientWidth - 80}px`;
    });
    seen.observe({ entryTypes: ['measure'] });
    await h.commitEdit(h.openDocument().buffer);
  });
  try {
    await page.evaluate(() => window.__h.contentComplete());
    await settle(page);
    const after = await readingBlock(page);
    assert.equal(after.index, before.index, `reading block ${before.index} (byte ${before.at}) -> ${after.index} (byte ${after.at})`);
  } finally {
    await page.evaluate(() => { document.getElementById('doc').style.width = ''; });
    await settle(page);
  }
  // The narrowed article sets every paragraph again, and the held place waits for the last: on 1 MB most of a minute.
});

/**
 * The worst gap between frames, in ms, from the article's own width given back until the page has gone quiet (thirty frames
 * with no change under it, the paragraphs set again), and how many paragraphs were set before.
 */
function worstFrameWidening(page) {
  return page.evaluate(async () => {
    const doc = document.getElementById('doc');
    const set = doc.querySelectorAll('.marxy-set').length;
    const gaps = [];
    let changed = false;
    const observer = new MutationObserver(() => { changed = true; });
    observer.observe(doc, { subtree: true, childList: true, characterData: true, attributes: true });
    await new Promise((r) => requestAnimationFrame(r));
    let last = performance.now();
    doc.style.width = '';
    let calm = 0;
    await new Promise((done) => {
      const tick = () => {
        const now = performance.now();
        gaps.push(now - last);
        last = now;
        calm = changed ? 0 : calm + 1;
        changed = false;
        if (calm >= 30) done();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    observer.disconnect();
    return { set, worst: Math.max(...gaps) };
  });
}

/**
 * The longest any frame may wait while a widened 1 MB page un-sets and sets its screen again, in ms: 1.2 to 1.5 s in WebKit
 * on a laptop, most of it the new width's own layout and paint, against 31 to 40 s before.
 */
const WIDEN_FRAME_MS = 15_000;

// A new width takes every set paragraph back to native wrapping in one task before setting them again. In WebKit a theme
// rule made each node taken out of a paragraph restyle the blocks after it, and on 1 MB that task held the reader for
// half a minute.
test('widening a 1 MB page set throughout holds no frame long', async () => {
  const { page } = await bigPage();
  await page.evaluate(() => window.__h.contentComplete());
  await settle(page);
  await readerScroll(page, 0.5);
  await page.waitForFunction(() => window.scrollY > 1000);
  try {
    await page.evaluate(() => {
      const doc = document.getElementById('doc');
      doc.style.width = `${doc.clientWidth - 80}px`;
    });
    await page.evaluate(() => window.__h.contentComplete());
    await settle(page);
    // The narrower page is set again from the screen outward: wait for the screen's paragraphs, then measure the widening.
    await until(page, () => document.querySelectorAll('#doc .marxy-set').length > 2_000);
    await settle(page);
    const { set, worst } = await worstFrameWidening(page);
    console.log(`widened with ${set} paragraphs set: worst frame ${worst.toFixed(0)} ms`);
    assert.ok(set > 2_000, `${set} paragraphs set before the widen`);
    holdBudget(assert, 'widening a 1 MB page: worst frame', worst, WIDEN_FRAME_MS);
  } finally {
    await page.evaluate(() => { document.getElementById('doc').style.width = ''; });
  }
}, 600_000);
