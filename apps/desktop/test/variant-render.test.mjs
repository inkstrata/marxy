// MARXY-46: config.variant light and auto resolve through the app harness the aesthetics gate renders
// with (apps/desktop/gate.html, B-02): the variant goes in the config file and the real app applies it.
// Playwright WebKit.

import { strict as assert } from 'node:assert';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';

const desktop = fileURLToPath(new URL('..', import.meta.url));
const palettes = JSON.parse(readFileSync(new URL('../../../packages/theme/test/palettes.json', import.meta.url), 'utf8'));

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
// A hung WebKit (starved or killed under load) leaves a promise pending with nothing keeping the event loop
// alive, and node:test then reports only "Promise resolution is still pending". An explicit timeout turns
// that into a failure that names this test.
const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);

const outDir = mkdtempSync(join(tmpdir(), 'marxy-variant-render-'));
let server;
let origin;
let browser;

before(async () => {
  if (skip) return;
  const { build } = await import('vite');
  await build({
    root: desktop,
    configFile: join(desktop, 'vite.config.ts'),
    logLevel: 'error',
    build: { outDir, emptyOutDir: true },
    plugins: [{ name: 'marxy-gate-input', config(c) { c.build.rollupOptions.input = { gate: join(desktop, 'gate.html') }; } }],
  });
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.ttf': 'font/ttf', '.txt': 'text/plain' };
  server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = join(outDir, path === '/' ? 'gate.html' : path.slice(1));
    if (!file.startsWith(outDir) || !existsSync(file) || !statSync(file).isFile()) {
      res.statusCode = 404;
      return res.end('not found');
    }
    res.setHeader('Content-Type', types[extname(file)] ?? 'application/octet-stream');
    res.end(readFileSync(file));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await launchWebkit();
});

after(async () => {
  await browser?.close();
  server?.close();
  rmSync(outDir, { recursive: true, force: true });
});

/** The page background the app paints for `variantPreference`, after a fresh harness render. */
async function bgForVariant(page, variantPreference) {
  await page.goto(`${origin}/gate.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.marxyGate?.render === 'function');
  await page.evaluate(async (v) => {
    await window.marxyGate.render('# Hi\n\nBody.', { variant: v, width: 960, size: 20 });
  }, variantPreference);
  return page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--marxy-color-bg').trim());
}

test('MARXY-46: variant light paints the designed paper through the app harness', async () => {
  const page = await browser.newPage({ viewport: { width: 960, height: 800 } });
  try {
    assert.equal(await bgForVariant(page, 'light'), palettes.light['--marxy-color-bg']);
  } finally {
    await page.close();
  }
});

test('MARXY-46: variant auto follows prefers-color-scheme through the app harness', async () => {
  const page = await browser.newPage({ viewport: { width: 960, height: 800 } });
  try {
    await page.emulateMedia({ colorScheme: 'light' });
    assert.equal(await page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches), false);
    assert.equal(await bgForVariant(page, 'auto'), palettes.light['--marxy-color-bg']);

    await page.emulateMedia({ colorScheme: 'dark' });
    assert.equal(await page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches), true);
    assert.equal(await bgForVariant(page, 'auto'), palettes.dark['--marxy-color-bg']);
  } finally {
    await page.close();
  }
});
