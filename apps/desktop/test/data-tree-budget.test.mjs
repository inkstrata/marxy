// A data file no longer hangs the window. A tree draws its first TREE_MAX_VALUES
// values and says how many there are ("the first N of M values drawn; Source has the rest"), as a table says its rows,
// so a 1.4 MB JSON or TOML file, a list of 200,000 items and a 50 MB JSON (streamed, counted by a fast scan) set in
// about a second with the page bounded; a file nested 100,000 deep is set as written. WebKit, through startApp and the
// memory shell on the Vite dev server, as test/long-line.test.mjs runs it. Before the budget, the 1.4 MB JSON took 35 s
// to first text here, with a 26 s stall; before the stream, a 50 MB JSON was plain text after 6 to 7 s.
import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { createServer } from './support/shared-vite.mjs';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);

/** The most elements the page holds for any of these files: the budget's values at about three and a half each. */
const ELEMENT_BOUND = 20_000;

const desktopRoot = fileURLToPath(new URL('..', import.meta.url));
let serverPromise;
let closeServer = () => {};
function base() {
  serverPromise ??= (async () => {
    const server = await createServer({
      root: desktopRoot,
      configFile: join(desktopRoot, 'vite.config.ts'),
      logLevel: 'silent',
      server: { port: 0, strictPort: false, host: '127.0.0.1' },
    });
    await server.listen();
    closeServer = () => server.close();
    return `http://127.0.0.1:${server.config.server.port}/`;
  })();
  return serverPromise;
}
after(() => closeServer());

/** Boots the app on one file; reports when the reading first showed, the longest stall, and what the page holds. */
async function openData(path, text) {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(`${await base()}app.html`);
    await page.waitForFunction(() => typeof window.marxyApp?.start === 'function');
    return await page.evaluate(async ({ path, text }) => {
      const { createMemoryShell } = await import('/src/shell/memory.ts');
      const shell = createMemoryShell({ [path]: new TextEncoder().encode(text) });
      const { startApp } = await import('/src/app.ts');
      let last = performance.now();
      let stall = 0;
      const beat = setInterval(() => {
        const now = performance.now();
        stall = Math.max(stall, now - last - 10);
        last = now;
      }, 10);
      const started = performance.now();
      let first = -1;
      const look = () => {
        if (first < 0 && document.querySelector('#doc [data-marxy-reading]')) first = performance.now() - started;
      };
      const observer = new MutationObserver(look);
      observer.observe(document.documentElement, { childList: true, subtree: true });
      const handle = await startApp(shell, { argv: [path] });
      await handle.ready;
      await handle.contentComplete();
      look();
      // Everything the load queued gets its turn before the stall is read.
      await new Promise((r) => setTimeout(r, 1500));
      clearInterval(beat);
      observer.disconnect();
      const doc = document.getElementById('doc');
      return {
        first,
        stall,
        elements: doc.querySelectorAll('*').length,
        reading: doc.querySelector('[data-marxy-reading]')?.getAttribute('data-marxy-reading') ?? null,
        why: doc.querySelector('.marxy-reading-head')?.textContent ?? '',
      };
    }, { path, text });
  } finally {
    await browser.close();
  }
}

const records = (n) => JSON.stringify(Array.from({ length: n }, (_, i) => (i % 2 ? { id: i, name: `item ${i}`, ok: true, tags: ['a', 'b'] } : { id: i, title: `t${i}`, size: i * 3, when: '2026-01-01' })), null, 1);
const toml = (n) => Array.from({ length: n }, (_, i) => `[[item]]\nid = ${i}\nname = "item ${i}"\nok = true\nsize = ${i * 3}\n`).join('\n');
const numbers = (n) => JSON.stringify(Array.from({ length: n }, (_, i) => i));

for (const [path, build, all, stallBound] of [
  ['/docs/big.json', () => records(17_500), '105,001', 1000],
  ['/docs/big.toml', () => toml(23_000), '115,002', 1000],
  ['/docs/array.json', () => numbers(200_000), '200,001', 1000],
  // Past 1.5 MB a JSON is streamed: the fast scan reads all 50 MB in one task, the parse only what is drawn.
  ['/docs/fifty.json', () => records(700_000), '4,200,001', 1500],
]) {
  test(`${path.slice(6)} sets its first values in under 2 s with no stall over ${stallBound / 1000} s, and says Source has the rest`, async () => {
    const text = build();
    assert.ok(path.endsWith('array.json') || text.length > 1.3 * 1024 * 1024, `${text.length} bytes`);
    const r = await openData(path, text);
    assert.equal(r.reading, 'tree');
    assert.match(r.why, new RegExp(` · the first 5,000 of ${all} values drawn; Source has the rest$`));
    assert.ok(r.elements <= ELEMENT_BOUND, `${r.elements} elements in the page, the bound is ${ELEMENT_BOUND}`);
    assert.ok(r.first >= 0 && r.first < 2000, `first text after ${Math.round(r.first)} ms`);
    assert.ok(r.stall < stallBound, `longest stall ${Math.round(r.stall)} ms`);
  });
}

test('a JSON file nested 100,000 deep is set as written, with why, not a stack overflow', async () => {
  const r = await openData('/docs/deep.json', `${'['.repeat(100_000)}${']'.repeat(100_000)}\n`);
  assert.equal(r.reading, 'written');
  assert.match(r.why, /nesting more than \d+ levels deep/);
  assert.ok(r.stall < 1000, `longest stall ${Math.round(r.stall)} ms`);
});
