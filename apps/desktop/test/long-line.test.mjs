// F-79, commitment 5: a file that is one 2 MB line does not freeze the page. Two things took minutes before: WebKit
// laid out a run of letters with no space (a minified file, base64) in time quadratic in its length once the HTML parser
// had cut it into text nodes (render/long-runs.ts puts a break in it), and the typesetter measured every word of a
// one-paragraph file in a task before first text (packages/typeset caps what it sets). WebKit, through startApp and the
// memory shell on the Vite dev server, as test/progressive.test.mjs runs it. The bounds are generous (the bug was
// 40 to 150 s; the fix is 1 to 7 s), and what is exact is what the page holds.
import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { createServer } from 'vite';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip, timeout: 240_000 }, fn);

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

const MB = 1024 * 1024;
/** `size` bytes of lower-case letters, no space, the same every run. */
function letters(size) {
  let seed = 7;
  const out = new Array(size);
  for (let i = 0; i < size; i++) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    out[i] = 'abcdefghijklmnopqrstuvwxyz'[(seed >>> 8) % 26];
  }
  return out.join('');
}
/** `size` bytes of short words with single spaces: a great many tokens to a byte. */
const words = (size) => 'ab c de f gh i '.repeat(Math.ceil(size / 15)).slice(0, size);

/** Boots the app on one file; reports the main thread's longest stall from the first moment the file is asked for. */
async function openLong(path, text) {
  const browser = await launchWebkit();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const root = await base();
  await page.goto(`${root}app.html`);
  await page.waitForFunction(() => typeof window.marxyApp?.start === 'function');
  const result = await page.evaluate(async ({ path, b64 }) => {
    const raw = atob(b64);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    const { createMemoryShell } = await import('/src/shell/memory.ts');
    const shell = createMemoryShell({ [path]: bytes });
    const { startApp } = await import('/src/app.ts');
    let last = performance.now();
    let stall = 0;
    const beat = setInterval(() => {
      const now = performance.now();
      stall = Math.max(stall, now - last - 10);
      last = now;
    }, 10);
    const started = performance.now();
    const handle = await startApp(shell, { argv: [path] });
    await handle.ready;
    window.__h = handle;
    const ready = performance.now() - started;
    await handle.contentComplete();
    // Everything the load queued gets its turn before the stall is read.
    await new Promise((r) => setTimeout(r, 1500));
    clearInterval(beat);
    return { ready, stall, marks: shell.calls.filter((c) => c.method === 'mark').map((c) => c.args[0]) };
  }, { path, b64: Buffer.from(text, 'utf8').toString('base64') });
  return { browser, page, ...result };
}

test('a 2 MB line with no space in it lays out in seconds, holds exactly the file\'s text, and every later layout is as fast', async () => {
  const text = letters(2 * MB);
  const { browser, page, ready, stall, marks } = await openLong('/docs/min.md', `${text}\n`);
  try {
    assert.ok(marks.includes('first_text'), marks.join());
    const shown = await page.evaluate(() => {
      const p = document.querySelector('#doc p');
      return {
        text: p.textContent,
        wbr: p.querySelectorAll('wbr').length,
        others: p.querySelectorAll(':not(wbr)').length,
        longest: Math.max(...[...p.childNodes].filter((n) => n.nodeType === 3).map((n) => n.data.length)),
      };
    });
    assert.ok(shown.text === text, 'the paragraph holds the file\'s text, every character, in order');
    assert.ok(shown.longest <= 4098, `no unbroken stretch is longer than a break interval: ${shown.longest}`);
    assert.ok(shown.wbr >= text.length / 4096 - 40, `${shown.wbr} breaks in ${text.length} characters`);
    assert.equal(shown.others, 0, 'and nothing else is in it');
    // The quadratic cost was in layout, and each layout paid it again: one forced from scratch is the measure.
    const layout = await page.evaluate(() => {
      const doc = document.getElementById('doc');
      doc.style.display = 'none';
      void doc.offsetHeight;
      doc.style.display = '';
      const t = performance.now();
      void doc.offsetHeight;
      return performance.now() - t;
    });
    assert.ok(layout < 10_000, `a layout from scratch took ${Math.round(layout)} ms (80,000 before F-79)`);
    assert.ok(ready < 60_000 && stall < 30_000, `ready after ${Math.round(ready)} ms, longest stall ${Math.round(stall)} ms`);
  } finally {
    await browser.close();
  }
});

test('a 2 MB line of words is read as it was, the typesetter leaves it to the engine, and the main thread is not held for a minute', async () => {
  const text = words(2 * MB);
  const { browser, page, ready, stall, marks } = await openLong('/docs/line.txt', `${text}\n`);
  try {
    assert.ok(marks.includes('first_text'), marks.join());
    const shown = await page.evaluate(() => {
      const p = document.querySelector('#doc p');
      return { text: p.textContent, set: p.classList.contains('marxy-set'), lines: p.querySelectorAll('.marxy-lb').length, wbr: p.querySelectorAll('wbr').length };
    });
    assert.ok(shown.text.replaceAll(' ', ' ') === text, 'the text is the file\'s');
    assert.equal(shown.set, false, 'past the typesetter\'s limit the paragraph is not set');
    assert.equal(shown.lines, 0, 'and has none of its breaks');
    assert.equal(shown.wbr, 0, 'a paragraph of words needs no break put in it');
    assert.ok(ready < 60_000 && stall < 25_000, `ready after ${Math.round(ready)} ms, longest stall ${Math.round(stall)} ms (60,000 and more before F-79)`);
  } finally {
    await browser.close();
  }
});

test('a 2 MB one-line .py (the code path) still shows its first text at once, in Rendered', async () => {
  const { browser, page, ready } = await openLong('/docs/data.py', `data = [${Array.from({ length: 2 * MB / 4 }, (_, i) => i % 1000).join(', ').slice(0, 2 * MB)}]\n`);
  try {
    assert.ok(ready < 20_000, `opened in Source after ${Math.round(ready)} ms`);
    const modifier = (await page.evaluate(() => navigator.platform)) === 'MacIntel' ? 'Meta' : 'Control';
    const started = Date.now();
    await page.keyboard.press(`${modifier}+Digit1`);
    await page.waitForFunction(() => (document.getElementById('doc')?.textContent.length ?? 0) > 0, null, { timeout: 60_000, polling: 25 });
    assert.ok(Date.now() - started < 30_000, `first text in Rendered after ${Date.now() - started} ms`);
  } finally {
    await browser.close();
  }
});

for (const [path, build] of [
  ['/docs/one.log', (n) => letters(n)],
  ['/docs/blob.py', (n) => `blob = "${letters(n)}"`],
  ['/docs/blob.json', (n) => `{"blob":"${letters(n)}"}`],
]) {
  test(`a 1 MB .${path.split('.').pop()} with one unbroken token reads in Rendered in seconds, not minutes, with all its text`, async () => {
    const text = build(MB);
    const { browser, page, ready, stall } = await openLong(path, `${text}\n`);
    try {
      const modifier = (await page.evaluate(() => navigator.platform)) === 'MacIntel' ? 'Meta' : 'Control';
      if (await page.evaluate(() => window.__h.panes().focused.view.mode) !== 'rendered') await page.keyboard.press(`${modifier}+Digit1`);
      await page.waitForFunction(() => (document.getElementById('doc')?.textContent.length ?? 0) > 0, null, { timeout: 90_000, polling: 25 });
      await page.evaluate(() => window.__h.contentComplete());
      await page.waitForTimeout(2000);
      const shown = await page.evaluate(() => document.getElementById('doc').textContent);
      assert.ok(shown.length >= text.length && shown.includes(text.slice(0, 1000)) && shown.includes(text.slice(-1000)), 'the page holds the text, head and tail');
      const layout = await page.evaluate(() => {
        const doc = document.getElementById('doc');
        doc.style.display = 'none';
        void doc.offsetHeight;
        doc.style.display = '';
        const t = performance.now();
        void doc.offsetHeight;
        return performance.now() - t;
      });
      assert.ok(layout < 10_000, `a layout from scratch took ${Math.round(layout)} ms`);
      assert.ok(ready < 60_000 && stall < 30_000, `ready after ${Math.round(ready)} ms, longest stall ${Math.round(stall)} ms`);
    } finally {
      await browser.close();
    }
  });
}
