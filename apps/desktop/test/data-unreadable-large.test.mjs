// A data file that stops parsing is shown line by line without drawing every line: a 1 MB pretty-printed JSON that an
// edit on disk left with text after its closing bracket made the page some thirty elements a line (over 200 s of main
// thread, 490,000 nodes). From WRITTEN_LINES_FROM it is the lines page, windowed, with the reason it is not a tree kept
// in its account. WebKit, through startApp and the memory shell, as data-tree-budget.test.mjs runs it.
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

/** Boots the app on `text` at `path`, then plants `after` and emits a change as another program saving the file does. */
async function openThenChange(path, text, after) {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(`${await base()}app.html`);
    await page.waitForFunction(() => typeof window.marxyApp?.start === 'function');
    return await page.evaluate(async ({ path, text, after }) => {
      const { createMemoryShell } = await import('/src/shell/memory.ts');
      const shell = createMemoryShell({ [path]: new TextEncoder().encode(text) });
      const { startApp } = await import('/src/app.ts');
      const handle = await startApp(shell, { argv: [path] });
      await handle.ready;
      await handle.contentComplete();
      const read = () => {
        const doc = document.getElementById('doc');
        return {
          elements: doc.querySelectorAll('*').length,
          reading: doc.querySelector('[data-marxy-reading]')?.getAttribute('data-marxy-reading') ?? null,
          why: doc.querySelector('.marxy-reading-head')?.textContent ?? '',
          written: doc.querySelectorAll('.marxy-written-line').length,
        };
      };
      const opened = read();
      let reloaded = null;
      if (after !== null) {
        shell.plant(path, new TextEncoder().encode(after));
        shell.emit([{ kind: 'modified', path }]);
        const t = performance.now();
        while (performance.now() - t < 20_000) {
          await new Promise((r) => setTimeout(r, 200));
          if (read().reading !== opened.reading) break;
        }
        await handle.contentComplete();
        await new Promise((r) => setTimeout(r, 1000));
        reloaded = read();
      }
      return { opened, reloaded };
    }, { path, text, after });
  } finally {
    await browser.close();
  }
}

const pretty = (n) => JSON.stringify(Array.from({ length: n }, (_, i) => ({ id: i, name: `item ${i}`, tags: ['a', 'b'], nested: { a: i, b: { c: 'x' } } })), null, 2);

test('a pretty-printed JSON that stops parsing after a change on disk is set as windowed lines, not every line', async () => {
  const text = pretty(5000);
  assert.ok(text.length > 300 * 1024, `${text.length} bytes`);
  const r = await openThenChange('/docs/edited.json', text, `${text}\nstray words after the bracket\n`);
  assert.equal(r.opened.reading, 'tree');
  assert.equal(r.reloaded.reading, 'lines');
  assert.match(r.reloaded.why, /cannot draw as a tree: at line \d+/);
  assert.equal(r.reloaded.written, 0);
  assert.ok(r.reloaded.elements <= 3000, `${r.reloaded.elements} elements after the reload`);
});

test('the same file opened already unreadable is the lines page too, and a short one stays as written', async () => {
  const text = `${pretty(5000)}\nstray words\n`;
  const long = await openThenChange('/docs/long.json', text, null);
  assert.equal(long.opened.reading, 'lines');
  assert.ok(long.opened.elements <= 3000, `${long.opened.elements} elements`);
  const short = await openThenChange('/docs/short.json', `${pretty(20)}\nstray words\n`, null);
  assert.equal(short.opened.reading, 'written');
});
