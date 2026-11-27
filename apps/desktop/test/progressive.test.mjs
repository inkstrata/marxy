// The article mounted progressively: a 1 MB document shows its first screens at first text and
// appends the rest in idle chunks; a corpus document goes in whole, as before. WebKit, through
// startApp and the memory shell on the Vite dev server, as test/live-reload.test.mjs runs it.
// The 1 MB first-text test here guards that first text never waits for the whole file; the
// three 1 MB reading-position tests are in progressive-large.test.mjs, which is slow.
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { createServer } from './support/shared-vite.mjs';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { generateDense, generateLarge } from '../../../scripts/perf-harness.mjs';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const BIG = Buffer.from(generateLarge(1024 * 1024));
const CORPUS = readFileSync(join(repoRoot, 'fixtures', 'corpus', '01-long-technical.md'));
/**
 * Islands the grid pass must pad (05's tables and nested blocks) between copies of 01, about 815 KB:
 * the generated document alone is on the grid by CSS, so it cannot show a grid pass that was skipped.
 */
const ISLANDS = Buffer.concat(
  Array.from({ length: 30 }, () => [CORPUS, Buffer.from('\n\n'), readFileSync(join(repoRoot, 'fixtures', 'corpus', '05-pathological-table-and-nesting.md')), Buffer.from('\n\n')]).flat(),
);
/** Short blocks (lists, quotes, tables, fences, maths): many elements per byte. About 300 KB, under the size that says "large". */
const DENSE = Buffer.from(await generateDense(300 * 1024));
/** The same shape at 100 KB, for the mount alone. */
const DENSE_SMALL = Buffer.from(await generateDense(100 * 1024));
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
 * One WebKit page holding the 1 MB document, booted once for the first-text test, which observes the
 * page booted and not yet complete.
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

/** The open document's HTML mounted whole (threshold Infinity) into a detached article: its text and its top-level count. */
function wholeMount(page) {
  return page.evaluate(async () => {
    const { mountProgressively } = await import('/src/render/progressive.ts');
    const article = document.createElement('article');
    mountProgressively(article, window.__h.state.document.html, { thresholdBytes: Infinity });
    return { text: article.textContent, children: article.childElementCount };
  });
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

/** The rule of packages/theme/test/grid.test.mjs: every block's top, from the article's top, on the half-line grid. */
function offGrid(page) {
  return page.evaluate(() => {
    const article = document.getElementById('doc');
    const unit = parseFloat(getComputedStyle(article).lineHeight) / 2;
    const origin = article.getBoundingClientRect().top;
    const off = [];
    let blocks = 0;
    for (const el of article.querySelectorAll('[data-marxy-s]')) {
      if (!['block', 'table', 'list-item', 'flow-root'].includes(getComputedStyle(el).display)) continue;
      blocks++;
      const top = el.getBoundingClientRect().top - origin;
      const r = ((top % unit) + unit) % unit;
      if (Math.min(r, unit - r) > 0.5) off.push(`${el.tagName}@${el.getAttribute('data-marxy-s')}: ${top.toFixed(2)}`);
    }
    return { off, blocks };
  });
}

test('at 1 MB, first text holds the first screens and the rest arrives later, on the grid, the same text', async () => {
  const { page } = await bigPage();
  const whole = await wholeMount(page);
  const atFirstText = await page.evaluate(() => window.__atFirstText);
  assert.ok(atFirstText > 0 && atFirstText < whole.children, `first text with ${atFirstText} of ${whole.children} blocks`);
  await page.evaluate(() => window.__h.contentComplete());
  const marks = await markNames(page);
  assert.ok(marks.includes('first_screen'), marks.join(','));
  assert.ok(marks.indexOf('first_text') < marks.indexOf('content_complete'), `first_text before content_complete: ${marks.join(',')}`);
  const text = await page.evaluate(() => document.getElementById('doc').textContent);
  assert.equal(text.length, whole.text.length);
  assert.ok(text === whole.text, 'the article, complete, holds exactly the text of the whole mount');
  await settle(page);
  const grid = await offGrid(page);
  assert.ok(grid.blocks > 1000, `${grid.blocks} blocks measured`);
  assert.deepEqual(grid.off.slice(0, 10), [], `${grid.off.length} of ${grid.blocks} blocks off the grid`);
});

test('while chunks arrive, each grid pass from the appended blocks leaves every mounted block on the grid', async () => {
  // The completion runs a whole-article pass, so the final check above cannot see a `from` pass that
  // got a chunk boundary wrong. This checks the page at the end of every pass before completion, in
  // the same task as the pass (the block list it builds is the hook), so nothing laid out later can
  // stand in for it. The typesetter is off, so every pass in between is a `from` pass, and the
  // document carries islands the pass has to pad: copies of 01 alone are on the grid by CSS.
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await boot(page, { '/docs/small.md': b64(SMALL), '/docs/islands.md': b64(ISLANDS) }, ['/docs/small.md'], { typeset: false });
    const r = await page.evaluate(async () => {
      const h = window.__h;
      const doc = document.getElementById('doc');
      const opened = h.open('/docs/islands.md');
      while (!(h.state.document?.html.length > 65_536)) await new Promise((r) => setTimeout(r, 0));
      let complete = false;
      void h.contentComplete().then(() => { complete = true; });
      const samples = [];
      /** Every block up to the last one the pass listed: what that pass covered. */
      const check = (blocks) => {
        const last = blocks[blocks.length - 1].el;
        const unit = parseFloat(getComputedStyle(doc).lineHeight) / 2;
        const origin = doc.getBoundingClientRect().top;
        const off = [];
        let n = 0;
        for (const el of doc.querySelectorAll('[data-marxy-s]')) {
          if (el !== last && last.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING && !last.contains(el)) break;
          if (!['block', 'table', 'list-item', 'flow-root'].includes(getComputedStyle(el).display)) continue;
          n++;
          const top = el.getBoundingClientRect().top - origin;
          const m = ((top % unit) + unit) % unit;
          if (Math.min(m, unit - m) > 0.5) off.push(`${el.tagName}@${el.getAttribute('data-marxy-s')}`);
        }
        samples.push({ blocks: n, off: off.slice(0, 5), offCount: off.length });
      };
      const open = h.state.document;
      let blocks = open.blocks;
      Object.defineProperty(open, 'blocks', {
        configurable: true,
        get: () => blocks,
        set: (next) => {
          blocks = next;
          if (!complete && next.length > 0) check(next);
        },
      });
      await h.contentComplete();
      await opened;
      return samples;
    });
    assert.ok(r.length >= 3 && r.at(-1).blocks > r[0].blocks, `checked passes before completion: ${JSON.stringify(r.map((x) => x.blocks))}`);
    const bad = r.filter((x) => x.offCount > 0);
    assert.deepEqual(bad, [], `${bad.length} of ${r.length} passes left blocks off the grid`);
  } finally {
    await browser.close();
  }
});

test('opening a second document while chunks are pending leaves one typesetter, one observer and no stray nodes', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await boot(page, { '/docs/big.md': b64(BIG), '/docs/small.md': b64(SMALL) }, ['/docs/big.md']);
    assert.equal(await page.evaluate(() => window.__complete), false, 'chunks are still pending when the second open starts');
    await page.evaluate(() => window.__h.open('/docs/small.md'));
    // Longer than the 1 MB document's chunks would take: none of them may land in the new article.
    await page.waitForTimeout(3000);
    const whole = await wholeMount(page);
    const seen = await page.evaluate(() => ({
      counts: window.__h.debugCounts(),
      text: document.getElementById('doc').textContent,
      children: document.getElementById('doc').childElementCount,
      complete: window.__complete,
    }));
    assert.deepEqual(seen.counts, { typesetters: 1, resizeObservers: 1 });
    assert.equal(seen.children, whole.children);
    assert.equal(seen.text, whole.text);
    assert.equal(seen.complete, true, 'the cancelled mount settled its promise');
  } finally {
    await browser.close();
  }
});

test('a corpus document goes in whole: first_screen names all of its blocks and contentComplete resolves at once', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await boot(page, { '/docs/01-long-technical.md': b64(CORPUS) }, ['/docs/01-long-technical.md']);
    const whole = await wholeMount(page);
    const seen = await page.evaluate(async () => {
      const h = window.__h;
      const first = h.shell.calls.find((c) => c.method === 'mark' && c.args[0] === 'first_screen');
      const race = await Promise.race([h.contentComplete().then(() => 'complete'), new Promise((r) => setTimeout(() => r('pending'), 0))]);
      return {
        detail: first?.args[2] ?? null,
        atFirstText: window.__atFirstText,
        race,
        contentCompleteMark: h.shell.calls.some((c) => c.method === 'mark' && c.args[0] === 'content_complete'),
      };
    });
    assert.match(seen.detail ?? '', new RegExp(`^blocks=${whole.children} bytes=\\d+$`));
    assert.equal(seen.atFirstText, whole.children);
    assert.equal(seen.race, 'complete');
    assert.equal(seen.contentCompleteMark, false, 'nothing was chunked');
  } finally {
    await browser.close();
  }
});

test('idle chunks are cut by the elements they bring, read no layout, and leave the page whole and in order', async () => {
  // A chunk sized by a layout read after it paid for the layout of everything already in, which grows with every chunk:
  // the chunks shrank to a few blocks and each cost more than the last. Here every chunk is held to its share of
  // elements, nothing in a chunk reads the layout, and the article ends exactly as the whole page.
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await boot(page, { '/docs/small.md': b64(SMALL), '/docs/dense.md': b64(DENSE_SMALL) }, ['/docs/small.md']);
    const r = await page.evaluate(async () => {
      const { mountProgressively, CHUNK_NODES } = await import('/src/render/progressive.ts');
      await window.__h.open('/docs/dense.md');
      await window.__h.contentComplete();
      const html = window.__h.state.document.html;
      const host = document.createElement('article');
      host.className = 'marxy-article';
      document.body.appendChild(host);
      let release;
      const start = new Promise((resolve) => { release = resolve; });
      const chunks = [];
      let reads = 0;
      const rect = Element.prototype.getBoundingClientRect;
      const mount = mountProgressively(host, html, {
        start,
        onChunk: (added) => chunks.push({ blocks: added.length, nodes: added.reduce((n, el) => n + 1 + el.getElementsByTagName('*').length, 0) }),
      });
      const first = host.childElementCount;
      // Reads of the mount's own article only: the app's page goes on with its own passes meanwhile.
      Element.prototype.getBoundingClientRect = function (...args) {
        if (host.contains(this)) reads += 1;
        return rect.apply(this, args);
      };
      try {
        release();
        await mount.complete;
      } finally {
        Element.prototype.getBoundingClientRect = rect;
      }
      const whole = document.createElement('article');
      mountProgressively(whole, html, { thresholdBytes: Infinity });
      const same = host.innerHTML === whole.innerHTML;
      host.remove();
      return { first, children: whole.childElementCount, chunks, reads, same, limit: CHUNK_NODES };
    });
    assert.ok(r.first > 0 && r.first < r.children, `first screens ${r.first} of ${r.children} blocks`);
    assert.ok(r.chunks.length > 1, `${r.chunks.length} chunks`);
    assert.equal(r.reads, 0, 'no chunk read the layout');
    const over = r.chunks.filter((c) => c.nodes > r.limit && c.blocks > 1);
    assert.deepEqual(over, [], `chunks over ${r.limit} elements`);
    // Held to the element budget, not shrunk below it: all but the last chunk carry at least half of it.
    const small = r.chunks.slice(0, -1).filter((c) => c.nodes < r.limit / 2);
    assert.ok(small.length <= r.chunks.length / 4, `${small.length} of ${r.chunks.length} chunks under half the budget: ${JSON.stringify(small.slice(0, 5))}`);
    assert.ok(r.same, 'the article, complete, is the whole page, block for block');
  } finally {
    await browser.close();
  }
});

test('a dense Markdown file under a megabyte opened alone is read in slices: first text with the first screens, then the whole page', async () => {
  // Bytes say little of what a page costs: 400 KB of short blocks is a quarter of a million elements, and made whole in
  // one task it held the window for seconds before first text. Such a file is parsed, rendered and put in the page in
  // slices even with no other pane on screen.
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await boot(page, { '/docs/dense.md': b64(DENSE) }, ['/docs/dense.md']);
    const seen = await page.evaluate(async () => {
      await window.__h.contentComplete();
      const parsed = window.__h.shell.calls.find((c) => c.method === 'mark' && c.args[0] === 'parsed');
      const doc = document.getElementById('doc');
      // The page's own passes after it is whole (maths, colour) change what is inside a block; the blocks and their
      // ranges, in order, are the mount's.
      const ranges = [...doc.children].map((el) => `${el.tagName}:${el.getAttribute('data-marxy-s')}`).join(' ');
      const { mountProgressively } = await import('/src/render/progressive.ts');
      const article = document.createElement('article');
      mountProgressively(article, window.__h.state.document.html, { thresholdBytes: Infinity });
      const wholeRanges = [...article.children].map((el) => `${el.tagName}:${el.getAttribute('data-marxy-s')}`).join(' ');
      return { parsed: parsed?.args[2] ?? null, atFirstText: window.__atFirstText, same: ranges === wholeRanges, children: article.childElementCount };
    });
    const whole = { children: seen.children };
    const slices = Number(/slices=(\d+)/.exec(seen.parsed ?? '')?.[1] ?? 0);
    assert.ok(slices > 1, `the parse was made in slices: ${seen.parsed}`);
    assert.ok(seen.atFirstText > 0 && seen.atFirstText < whole.children, `first text with ${seen.atFirstText} of ${whole.children} blocks`);
    assert.ok(seen.same, 'the article, complete, holds every block of the whole page, in order');
  } finally {
    await browser.close();
  }
});
