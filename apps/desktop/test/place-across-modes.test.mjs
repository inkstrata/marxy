// The reader's place across modes, quit, reopen, a reload in Source and a resize (F-04).
// In Source the window scrolls, not CodeMirror's scroller: every place below is read where the reader
// reads it, on the reading line (40 % down the window), in both modes.
import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { after, test as nodeTest } from 'node:test';
import { fileURLToPath } from 'node:url';
import { webkit } from 'playwright';
import { build } from 'vite';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const modKey = process.platform === 'darwin' ? 'Meta' : 'Control';
const VIEWPORT = { width: 960, height: 800 };
const READING_LINE = Math.round(VIEWPORT.height * 0.4);

let harnessPromise;
let closeHarness = () => {};
async function harnessBase() {
  if (!harnessPromise) {
    harnessPromise = (async () => {
      const outDir = mkdtempSync(join(tmpdir(), 'marxy-place-modes-'));
      await build({ root: join(repoRoot, 'apps', 'desktop'), logLevel: 'silent', build: { outDir, emptyOutDir: true } });
      const types = { '.html': 'text/html', '.ttf': 'font/ttf', '.js': 'text/javascript', '.txt': 'text/plain', '.css': 'text/css' };
      const server = createServer((req, res) => {
        const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
        const path = join(outDir, pathname.endsWith('/') ? `${pathname}index.html` : pathname);
        if (!existsSync(path)) { res.statusCode = 404; return res.end(); }
        res.setHeader('Content-Type', types[extname(path)] ?? 'application/octet-stream');
        res.end(readFileSync(path));
      });
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      closeHarness = () => server.close();
      return `http://127.0.0.1:${server.address().port}/`;
    })();
  }
  return harnessPromise;
}
after(() => closeHarness());

const b64 = (s) => Buffer.from(s).toString('base64');

/** Paragraphs of six hard-wrapped source lines each: a source line is mostly not a block's first. */
const wrappedMd = `# Wrapped\n\n${Array.from({ length: 160 }, (_, p) =>
  Array.from({ length: 6 }, (_, l) => `P${String(p).padStart(3, '0')} line ${l} of a paragraph wrapped by hand in its source, as many are.`).join('\n'),
).join('\n\n')}\n`;

/** A source file of 1500 numbered lines. */
const codeTs = `${Array.from({ length: 1500 }, (_, i) => `export const value${String(i).padStart(5, '0')} = ${i}; // line ${i}`).join('\n')}\n`;

async function boot(page, files, argv) {
  await page.goto(`${await harnessBase()}app.html`);
  await page.waitForFunction(() => typeof window.marxyApp?.start === 'function');
  await page.evaluate(async ({ files, argv }) => {
    const handle = await window.marxyApp.start(files, argv);
    await handle.ready;
    window.__marxyHandle = handle;
  }, { files, argv });
}

/** Until the page height has held still for a second: idle typesetting moves blocks after `ready`. */
const settle = (page) => page.evaluate(async () => {
  let last = -1;
  let still = 0;
  while (still < 10) {
    await new Promise((r) => setTimeout(r, 100));
    const h = document.documentElement.scrollHeight;
    if (h === last) still++;
    else { still = 0; last = h; }
  }
});

/** The top-level rendered block under the reading line: its source start, text and box. */
const renderedAtReadingLine = (page) => page.evaluate((y) => {
  const doc = document.getElementById('doc');
  const block = [...doc.children].find((el) => {
    const r = el.getBoundingClientRect();
    return r.top <= y + 2 && r.bottom > y;
  });
  return block
    ? { s: Number(block.getAttribute('data-marxy-s')), text: block.textContent.slice(0, 40), top: block.getBoundingClientRect().top, scrollY: window.scrollY }
    : { s: null, text: null, top: null, scrollY: window.scrollY };
}, READING_LINE);

/** The Source line under the reading line. */
const sourceAtReadingLine = (page) => page.evaluate((y) => {
  const line = [...document.querySelectorAll('#marxy-source .cm-line')].find((el) => {
    const r = el.getBoundingClientRect();
    return r.top <= y + 2 && r.bottom > y;
  });
  return { text: line?.textContent ?? null, scrollY: window.scrollY, cmScrollTop: document.querySelector('.cm-scroller')?.scrollTop };
}, READING_LINE);

/** Polls positions.json until `ok` holds for it (or 5 s pass), and returns the last read. */
async function positionsWhen(page, ok) {
  const deadline = Date.now() + 5000;
  for (;;) {
    const json = await storedPositions(page);
    if ((json && ok(json)) || Date.now() > deadline) return json;
    await page.waitForTimeout(100);
  }
}

const storedPositions = (page) => page.evaluate(async () => {
  try {
    return JSON.parse(new TextDecoder().decode(await window.__marxyHandle.shell.readFile('/data/positions.json')));
  } catch {
    return null;
  }
});

async function enterSource(page) {
  await page.keyboard.press(`${modKey}+e`);
  await page.waitForFunction(() => document.body.dataset.marxyMode === 'source' && document.querySelector('#marxy-source .cm-editor'));
  await page.waitForTimeout(300);
}

async function leaveSource(page) {
  await page.keyboard.press(`${modKey}+e`);
  await page.waitForFunction(() => document.body.dataset.marxyMode === 'rendered');
  await settle(page);
}

test('after an edit, leaving Source keeps the paragraph on the reading line (S-07-0002, S-05-0001)', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: VIEWPORT });
    await boot(page, { '/d/wrapped.md': b64(wrappedMd) }, ['/d/wrapped.md']);
    await settle(page);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight / 2));
    await settle(page);
    await enterSource(page);
    // Three source lines further: the reading line is now on a line inside a paragraph, not its first.
    const lineHeight = await page.evaluate(() => document.querySelector('#marxy-source .cm-line').getBoundingClientRect().height);
    await page.evaluate((dy) => window.scrollBy(0, dy), Math.round(3 * lineHeight));
    await page.waitForTimeout(300);
    const inSource = await sourceAtReadingLine(page);
    assert.match(inSource.text ?? '', /^P\d{3} line [1-5] /, `an interior line on the reading line: ${JSON.stringify(inSource)}`);
    assert.ok(inSource.scrollY > 1000, 'the window is what scrolls in Source');
    await page.mouse.click(400, READING_LINE + 2);
    await page.keyboard.press('End');
    await page.keyboard.type(' Z');
    await leaveSource(page);
    const after = await renderedAtReadingLine(page);
    const paragraph = inSource.text.slice(0, 4);
    assert.ok(after.text?.startsWith(paragraph), `the reading line is in ${paragraph}, the paragraph edited: ${JSON.stringify(after)}`);
    assert.ok(await page.evaluate(() => document.getElementById('doc').textContent.includes(' Z')), 'the edit is on the page');
  } finally {
    await browser.close();
  }
});

test('scrolled in Source with no edit, leaving it lands where Source was read, not where it was entered', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: VIEWPORT });
    await boot(page, { '/d/wrapped.md': b64(wrappedMd) }, ['/d/wrapped.md']);
    await settle(page);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight / 3));
    await settle(page);
    const entered = await renderedAtReadingLine(page);
    await enterSource(page);
    const lineHeight = await page.evaluate(() => document.querySelector('#marxy-source .cm-line').getBoundingClientRect().height);
    await page.evaluate((dy) => window.scrollBy(0, dy), Math.round(60 * lineHeight));
    await page.waitForTimeout(300);
    const inSource = await sourceAtReadingLine(page);
    const paragraph = inSource.text.slice(0, 4);
    assert.ok(!entered.text.startsWith(paragraph), 'scrolled to another paragraph');
    await leaveSource(page);
    const after = await renderedAtReadingLine(page);
    assert.ok(after.text?.startsWith(paragraph), `the reading line is in ${paragraph}: ${JSON.stringify(after)}`);
  } finally {
    await browser.close();
  }
});

test('quit from Source stores the line on the reading line, and a source file reopens on it (S-08-0002, S-08-0001)', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: VIEWPORT });
    const path = '/r/big.ts';
    await boot(page, { [path]: b64(codeTs) }, [path]);
    await page.waitForFunction(() => document.body.dataset.marxyMode === 'source');
    await page.evaluate(() => window.scrollTo(0, 24000));
    await page.waitForTimeout(400);
    const inSource = await sourceAtReadingLine(page);
    assert.match(inSource.text ?? '', /^export const value\d{5}/);
    await page.evaluate(() => window.__marxyHandle.shell.quit(0));
    const stored = (await storedPositions(page))?.positions?.[path];
    const lineStart = Buffer.from(codeTs).indexOf(inSource.text);
    assert.equal(stored?.mode, 'source', JSON.stringify(stored));
    assert.equal(stored?.byteOffset, lineStart, `stored ${JSON.stringify(stored)}, line on the reading line starts at ${lineStart}`);
    const positions = await page.evaluate(async () => [...await window.__marxyHandle.shell.readFile('/data/positions.json')]);
    await page.close();

    const again = await browser.newPage({ viewport: VIEWPORT });
    await boot(again, { [path]: b64(codeTs), '/data/positions.json': Buffer.from(positions).toString('base64') }, [path]);
    await again.waitForFunction(() => document.body.dataset.marxyMode === 'source');
    await again.waitForTimeout(400);
    const reopened = await sourceAtReadingLine(again);
    assert.equal(reopened.text, inSource.text, `reopened on ${JSON.stringify(reopened)}`);
  } finally {
    await browser.close();
  }
});

test('a markdown file left in Source reopens in Rendered at that paragraph (S-08-0001, S-08-0002)', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: VIEWPORT });
    const path = '/d/wrapped.md';
    await boot(page, { [path]: b64(wrappedMd) }, [path]);
    await settle(page);
    await enterSource(page);
    await page.evaluate(() => window.scrollTo(0, 9000));
    await page.waitForTimeout(400);
    const inSource = await sourceAtReadingLine(page);
    assert.match(inSource.text ?? '', /^P\d{3} line /);
    // pagehide flushes the place as quit does.
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
    const stored = (await positionsWhen(page, (json) => json.positions[path]?.mode === 'source'))?.positions?.[path];
    assert.equal(stored?.byteOffset, Buffer.from(wrappedMd).indexOf(inSource.text), JSON.stringify(stored));
    const positions = await page.evaluate(async () => [...await window.__marxyHandle.shell.readFile('/data/positions.json')]);
    await page.close();

    const again = await browser.newPage({ viewport: VIEWPORT });
    await boot(again, { [path]: b64(wrappedMd), '/data/positions.json': Buffer.from(positions).toString('base64') }, [path]);
    await settle(again);
    assert.equal(await again.evaluate(() => document.body.dataset.marxyMode), 'rendered');
    const reopened = await renderedAtReadingLine(again);
    const paragraph = inSource.text.slice(0, 4);
    assert.ok(reopened.text?.startsWith(paragraph), `reopened in ${paragraph}: ${JSON.stringify(reopened)}`);
  } finally {
    await browser.close();
  }
});

test('scrolling in Source records the line on the reading line, mode source, with no quit (S-08-0002)', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: VIEWPORT });
    const path = '/r/big.ts';
    await boot(page, { [path]: b64(codeTs) }, [path]);
    await page.waitForFunction(() => document.body.dataset.marxyMode === 'source');
    await page.mouse.move(480, 400);
    await page.mouse.wheel(0, 15000);
    await page.waitForTimeout(400);
    const inSource = await sourceAtReadingLine(page);
    const lineStart = Buffer.from(codeTs).indexOf(inSource.text);
    const stored = (await positionsWhen(page, (json) => json.positions[path]?.byteOffset === lineStart))?.positions?.[path];
    assert.deepEqual({ byteOffset: stored?.byteOffset, mode: stored?.mode }, { byteOffset: lineStart, mode: 'source' });
  } finally {
    await browser.close();
  }
});

test('a file changed on disk while Source shows keeps the line on the reading line', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: VIEWPORT });
    const path = '/r/big.ts';
    await boot(page, { [path]: b64(codeTs) }, [path]);
    await page.waitForFunction(() => document.body.dataset.marxyMode === 'source');
    await page.evaluate(() => window.scrollTo(0, 24000));
    await page.waitForTimeout(400);
    const before = await sourceAtReadingLine(page);
    await page.evaluate(async ({ text }) => {
      const h = window.__marxyHandle;
      await h.shell.writeFileAtomic('/r/big.ts', new TextEncoder().encode(text));
      h.shell.emit([{ kind: 'modified', path: '/r/big.ts' }]);
    }, { text: `${codeTs}// appended on disk\n` });
    await page.waitForFunction(() => document.querySelector('#marxy-source .cm-content')?.textContent.includes('appended on disk') ||
      window.__marxyHandle.shell.calls.some((c) => c.method === 'mark' && c.args[0] === 'live_reload'), undefined, { timeout: 5000 });
    await page.waitForTimeout(600);
    assert.equal(await page.evaluate(() => document.body.dataset.marxyMode), 'source');
    const after = await sourceAtReadingLine(page);
    assert.equal(after.text, before.text, `before ${JSON.stringify(before)}, after ${JSON.stringify(after)}`);
  } finally {
    await browser.close();
  }
});

for (const width of [560, 720]) {
  // 560 narrows the article itself (every paragraph re-broken); 720 leaves it at its full measure and
  // reflows only what is wider than the measure.
  test(`a resize to ${width} px keeps the block on the reading line (S-02-0001)`, async () => {
    const browser = await launchWebkit();
    try {
      const page = await browser.newPage({ viewport: VIEWPORT });
      const long = readFileSync(join(repoRoot, 'fixtures', 'corpus', '01-long-technical.md'), 'utf8');
      const path = '/d/long.md';
      await boot(page, { [path]: b64(Array.from({ length: 4 }, () => long).join('\n\n')) }, [path]);
      await settle(page);
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight * 0.6));
      await settle(page);
      const before = await renderedAtReadingLine(page);
      await page.setViewportSize({ width, height: VIEWPORT.height });
      await page.waitForTimeout(300);
      await settle(page);
      const after = await renderedAtReadingLine(page);
      assert.equal(after.s, before.s, `before ${JSON.stringify(before)}, after ${JSON.stringify(after)}`);
    } finally {
      await browser.close();
    }
  });
}

test('no anchor listener is left on the window once a hold ends: open, reload, open deep', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: VIEWPORT });
    // The anchor's listeners: one function on both `wheel` and `mousedown`, capturing, on the window.
    // While any `wheel` listener is there, WebKit repaints the whole page after every layout (B-02.8).
    await page.addInitScript(() => {
      const live = new Map();
      const capture = (opts) => (typeof opts === 'boolean' ? opts : !!opts?.capture);
      const add = window.addEventListener.bind(window);
      const remove = window.removeEventListener.bind(window);
      window.addEventListener = (type, fn, opts) => {
        if (capture(opts)) live.set(fn, new Set([...(live.get(fn) ?? []), type]));
        return add(type, fn, opts);
      };
      window.removeEventListener = (type, fn, opts) => {
        if (capture(opts)) live.get(fn)?.delete(type);
        return remove(type, fn, opts);
      };
      window.__anchorWheelListeners = () => [...live.values()].filter((t) => t.has('wheel') && t.has('mousedown')).length;
    });
    const a = '/d/wrapped.md';
    const b = '/d/other.md';
    const other = wrappedMd.replace('# Wrapped', '# Other');
    await boot(page, { [a]: b64(wrappedMd), [b]: b64(other) }, [a]);
    await settle(page);
    const count = () => page.evaluate(() => window.__anchorWheelListeners());
    assert.equal(await count(), 0, 'opened at the top: nothing held');

    // A reload holds the reader's place through the typesetter's passes, then lets go.
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight / 2));
    await page.evaluate(async (text) => {
      const h = window.__marxyHandle;
      await h.shell.writeFileAtomic('/d/wrapped.md', new TextEncoder().encode(text));
      h.shell.emit([{ kind: 'modified', path: '/d/wrapped.md' }]);
    }, `${wrappedMd}\nAppended on disk.\n`);
    await page.waitForFunction(() => window.__marxyHandle.shell.calls.some((c) => c.method === 'mark' && c.args[0] === 'live_reload'), undefined, { timeout: 10_000 });
    await settle(page);
    assert.equal(await count(), 0, 'the reload hold has ended');

    // Opened deep: held until the reader takes over, then released with its listeners.
    await page.evaluate((at) => window.__marxyHandle.open('/d/other.md', { at }), Buffer.from(other).indexOf('P120 line 0'));
    await settle(page);
    assert.equal(await count(), 1, 'opened deep: the anchor holds the place');
    await page.mouse.click(5, 5);
    await page.waitForTimeout(100);
    assert.equal(await count(), 0, 'released by the reader');
  } finally {
    await browser.close();
  }
});
