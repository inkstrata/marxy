// B-17: `typeset = false` in config.toml turns the typesetter off through the --marxy-typeset kill switch,
// so the engine wraps every paragraph; with no config the typesetter sets them.
import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { build } from 'vite';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip }, fn);

const desktopRoot = fileURLToPath(new URL('..', import.meta.url));
const fixture = readFileSync(join(desktopRoot, '../../fixtures/corpus/01-long-technical.md'));
const DOC = '/docs/long.md';
const b64 = (text) => Buffer.from(text).toString('base64');


const outDir = mkdtempSync(join(tmpdir(), 'marxy-typeset-off-'));
let server;
let base;

before(async () => {
  if (skip) return;
  await build({
    root: desktopRoot,
    logLevel: 'silent',
    build: { outDir, emptyOutDir: true, rollupOptions: { input: { paletteBoot: join(desktopRoot, 'test/palette-boot.html') } } },
  });
  const types = { '.html': 'text/html', '.ttf': 'font/ttf', '.js': 'text/javascript', '.txt': 'text/plain', '.css': 'text/css' };
  server = createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const path = join(outDir, pathname.endsWith('/') ? `${pathname}index.html` : pathname);
    if (!existsSync(path)) { res.statusCode = 404; return res.end(); }
    res.setHeader('Content-Type', types[extname(path)] ?? 'application/octet-stream');
    res.end(readFileSync(path));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}/`;
});
after(() => server?.close());


/** Boots the app on the palette harness with `config` as /config (null: none); resolves after typeset_done or 2 s. */
async function boot(browser, config) {
  const page = await browser.newPage({ viewport: { width: 960, height: 800 } });
  await page.goto(`${base}test/palette-boot.html`);
  await page.waitForFunction(() => typeof window.marxyPaletteBoot?.start === 'function');
  const files = { [DOC]: fixture.toString('base64') };
  if (config !== null) files['/config'] = b64(config);
  await page.evaluate(async ({ files, doc }) => {
    const { handle } = await window.marxyPaletteBoot.start(files, [doc]);
    window.__h = handle;
  }, { files, doc: DOC });
  await page.evaluate(async () => {
    const marks = () => window.__h.shell.calls.filter((c) => c.method === 'mark').map((c) => c.args[0]);
    for (let waited = 0; waited < 2000 && !marks().includes('typeset_done'); waited += 50) await new Promise((r) => setTimeout(r, 50));
  });
  return page;
}

const stateOf = (page) => page.evaluate(() => ({
  set: document.querySelectorAll('#doc .marxy-set').length,
  paragraphs: document.querySelectorAll('#doc p').length,
  typeset: document.documentElement.style.getPropertyValue('--marxy-typeset'),
  firstText: window.__h.shell.calls.some((c) => c.method === 'mark' && c.args[0] === 'first_text'),
}));

test('typeset = false: no paragraph is engine-set, and first text is still emitted', async () => {
  const browser = await launchWebkit();
  try {
    const page = await boot(browser, '# my config\ntypeset = false\n');
    const s = await stateOf(page);
    assert.equal(s.typeset, 'none');
    assert.ok(s.paragraphs > 20, `the document has paragraphs: ${s.paragraphs}`);
    assert.equal(s.set, 0, 'no .marxy-set paragraph');
    assert.ok(s.firstText, 'first_text mark emitted');
  } finally {
    await browser.close();
  }
});

test('no config: the typesetter sets paragraphs', async () => {
  const browser = await launchWebkit();
  try {
    const page = await boot(browser, null);
    const s = await stateOf(page);
    assert.equal(s.typeset, '');
    assert.ok(s.set > 0, `.marxy-set paragraphs exist: ${s.set}`);
    assert.ok(s.firstText);
  } finally {
    await browser.close();
  }
});

test('typeset = true behaves as no config', async () => {
  const browser = await launchWebkit();
  try {
    const page = await boot(browser, 'typeset = true\n');
    const s = await stateOf(page);
    assert.equal(s.typeset, '');
    assert.ok(s.set > 0);
  } finally {
    await browser.close();
  }
});
