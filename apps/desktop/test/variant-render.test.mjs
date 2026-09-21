// MARXY-46: config.variant light and auto resolve through the headless render entry (Playwright WebKit).

import { strict as assert } from 'node:assert';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { defaultThemeCss } from '../../../packages/theme/scripts/inline.mjs';
import { resolveVariantPreference } from '../../../packages/theme/test/resolve-variant.mjs';

const root = new URL('../../../', import.meta.url);
const desktop = join(root.pathname, 'apps/desktop');
const dist = join(desktop, 'dist');
const palettes = JSON.parse(readFileSync(new URL('../../../packages/theme/test/palettes.json', import.meta.url), 'utf8'));

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip }, fn);

const FONT_URLS = {
  '/fonts/Literata.ttf': join(root.pathname, 'fonts/literata/Literata[opsz,wght].ttf'),
  '/fonts/Literata-Italic.ttf': join(root.pathname, 'fonts/literata/Literata-Italic[opsz,wght].ttf'),
  '/fonts/JetBrainsMono.ttf': join(root.pathname, 'fonts/jetbrains-mono/JetBrainsMono[wght].ttf'),
};

async function buildHarness() {
  const { build } = await import('vite');
  await build({
    configFile: join(desktop, 'src/render/vite.config.ts'),
    root: desktop,
    logLevel: 'error',
  });
  mkdirSync(dist, { recursive: true });
  const fontsCss = readFileSync(join(desktop, 'src/fonts/fonts.css'), 'utf8').replaceAll('./fonts/', '/fonts/');
  writeFileSync(
    join(dist, 'render.html'),
    `<!doctype html><html lang="en" data-marxy-variant="dark"><head><meta charset="utf-8"><style id="marxy-fonts">${fontsCss}</style>` +
      `<style id="marxy-default-theme">${defaultThemeCss()}</style></head><body><main id="marxy-main">` +
      `<article id="doc" class="marxy-article"></article></main><script src="./render.js"></script></body></html>`,
  );
}

function startServer() {
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.ttf': 'font/ttf' };
  const server = createServer((req, res) => {
    const path = new URL(req.url, 'http://x').pathname;
    if (FONT_URLS[path]) {
      res.setHeader('Content-Type', 'font/ttf');
      res.end(readFileSync(FONT_URLS[path]));
      return;
    }
    const file = path === '/' ? join(dist, 'render.html') : join(dist, path.slice(1));
    if (!file.startsWith(dist) || !existsSync(file) || !statSync(file).isFile()) {
      res.statusCode = 404;
      return res.end('not found');
    }
    const ext = file.slice(file.lastIndexOf('.'));
    res.setHeader('Content-Type', types[ext] ?? 'application/octet-stream');
    res.end(readFileSync(file));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function bgForVariant(page, origin, variant) {
  await page.goto(`${origin}/render.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.marxyRender === 'function');
  await page.evaluate(async (v) => {
    await window.marxyRender('# Hi\n\nBody.', { variant: v, width: 960, size: 17 });
  }, variant);
  return page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--marxy-color-bg').trim());
}

test('MARXY-46: variant light paints the designed paper through marxyRender', async () => {
  await buildHarness();
  const server = await startServer();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 800 } });
    const variant = resolveVariantPreference('light', true);
    assert.equal(variant, 'light');
    const bg = await bgForVariant(page, origin, variant);
    assert.equal(bg, palettes.light['--marxy-color-bg']);
  } finally {
    await browser.close();
    server.close();
  }
});

test('MARXY-46: variant auto follows prefers-color-scheme on the headless entry', async () => {
  await buildHarness();
  const server = await startServer();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 800 } });
    await page.emulateMedia({ colorScheme: 'light' });
    const prefersDark = await page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches);
    assert.equal(prefersDark, false);
    const variant = resolveVariantPreference('auto', prefersDark);
    assert.equal(variant, 'light');
    const bg = await bgForVariant(page, origin, variant);
    assert.equal(bg, palettes.light['--marxy-color-bg']);

    await page.emulateMedia({ colorScheme: 'dark' });
    const prefersDark2 = await page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches);
    assert.equal(prefersDark2, true);
    const variantDark = resolveVariantPreference('auto', prefersDark2);
    assert.equal(variantDark, 'dark');
    const bgDark = await bgForVariant(page, origin, variantDark);
    assert.equal(bgDark, palettes.dark['--marxy-color-bg']);
  } finally {
    await browser.close();
    server.close();
  }
});
