// Copy operations: Mod+C, palette, and clipboard shape (MARXY-42).
import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { after, before, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { build } from 'vite';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { createBuffer, parseMarkdown, sectionRange, textOf } from '../../../packages/core/src/index.ts';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip }, fn);

const repoRoot = new URL('../../../', import.meta.url).pathname;
const desktopRoot = new URL('..', import.meta.url).pathname;
const corpusDir = join(repoRoot, 'fixtures', 'corpus');
const outDir = mkdtempSync(join(tmpdir(), 'marxy-ops-copy-'));
let server;
let base;

before(async () => {
  if (skip) return;
  await build({
    root: desktopRoot,
    logLevel: 'silent',
    build: {
      outDir,
      emptyOutDir: true,
      rollupOptions: {
        input: {
          app: join(desktopRoot, 'app.html'),
          paletteBoot: join(desktopRoot, 'test/palette-boot.html'),
        },
      },
    },
  });
  const types = { '.html': 'text/html', '.ttf': 'font/ttf', '.js': 'text/javascript', '.css': 'text/css' };
  server = createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const path = join(outDir, pathname.endsWith('/') ? `${pathname}index.html` : pathname);
    if (!existsSync(path)) { res.statusCode = 404; return res.end(); }
    res.setHeader('Content-Type', types[extname(path)] ?? 'application/octet-stream');
    res.end(readFileSync(path));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}/`;
});
after(() => server?.close());

function b64(path) {
  return readFileSync(path).toString('base64');
}

async function bootPalette(page, files, argv) {
  await page.goto(`${base}test/palette-boot.html`);
  await page.waitForFunction(() => typeof window.marxyPaletteBoot?.start === 'function');
  await page.evaluate(async ({ files, argv }) => {
    window.__marxyOpsBoot = await window.marxyPaletteBoot.start(files, argv, []);
  }, { files, argv });
  await page.waitForFunction(() => typeof window.marxySelection?.getSelectionState === 'function');
}

function modKey(platform) {
  return platform === 'MacIntel' ? 'Meta' : 'Control';
}

test('Mod+C on the Install section copies markdown source and sanitised html', async () => {
  const file = '02-readme-real-world.md';
  const docPath = `/corpus/${file}`;
  const bytes = readFileSync(join(corpusDir, file));
  const ast = parseMarkdown(bytes, { file });
  const buffer = createBuffer(file, bytes);
  const installHeading = ast.children.find((n) => n.type === 'heading' && n.children?.[0]?.type === 'text' && n.children[0].value === 'Install');
  assert.ok(installHeading);
  const range = sectionRange(ast, installHeading);
  const expectedText = `${textOf(buffer, range).replace(/\s+$/, '')}\n`;

  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 900 } });
    await bootPalette(page, { [docPath]: b64(join(corpusDir, file)) }, [docPath]);
    await page.locator('#doc h2').filter({ hasText: 'Install' }).click();
    const mod = modKey(await page.evaluate(() => navigator.platform));
    await page.keyboard.press(`${mod}+KeyC`);
    const copies = await page.evaluate(() =>
      window.__marxyOpsBoot.handle.shell.calls.filter((c) => c.method === 'clipboardWrite'),
    );
    assert.equal(copies.length, 1);
    const payload = copies[0].args[0];
    assert.equal(payload.text, expectedText);
    assert.ok(typeof payload.html === 'string' && payload.html.length > 0);
    assert.ok(!payload.html.includes('data-marxy-'));
    assert.ok(!/<script/i.test(payload.html));
  } finally {
    await browser.close();
  }
});

test('Mod+C on a code block copies plain source without fences or highlight markup', async () => {
  const file = '19-source-file.md';
  const docPath = `/corpus/${file}`;
  const bytes = readFileSync(join(corpusDir, file));
  const ast = parseMarkdown(bytes, { file });
  const block = ast.children.find((n) => n.type === 'codeBlock');
  assert.ok(block && block.type === 'codeBlock');

  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 900 } });
    await bootPalette(page, { [docPath]: b64(join(corpusDir, file)) }, [docPath]);
    await page.locator('#doc pre[data-marxy-s]').first().click();
    const mod = modKey(await page.evaluate(() => navigator.platform));
    await page.keyboard.press(`${mod}+KeyC`);
    const copies = await page.evaluate(() =>
      window.__marxyOpsBoot.handle.shell.calls.filter((c) => c.method === 'clipboardWrite'),
    );
    assert.equal(copies.length, 1);
    const payload = copies[0].args[0];
    assert.equal(payload.text, block.value.endsWith('\n') ? block.value : `${block.value}\n`);
    assert.ok(!payload.text.includes('```'));
    assert.ok(!payload.text.includes('marxy-tok-'));
    assert.equal(payload.html, undefined);
  } finally {
    await browser.close();
  }
});

test('palette lists no copy operations for a paragraph selection', async () => {
  const file = '02-readme-real-world.md';
  const docPath = `/corpus/${file}`;
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 900 } });
    await bootPalette(page, { [docPath]: b64(join(corpusDir, file)) }, [docPath]);
    await page.locator('#doc p[data-marxy-s]').first().click();
    const mod = modKey(await page.evaluate(() => navigator.platform));
    await page.keyboard.press(`${mod}+KeyP`);
    await page.locator('#marxy-palette .marxy-palette-query').fill('> copy');
    const labels = await page.locator('#marxy-palette .marxy-palette-row').allTextContents();
    assert.ok(!labels.some((t) => /copy section/i.test(t)));
    assert.ok(!labels.some((t) => /copy code/i.test(t)));
  } finally {
    await browser.close();
  }
});

test('palette Copy code runs on Enter, closes, and shows Copied', async () => {
  const file = '19-source-file.md';
  const docPath = `/corpus/${file}`;
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 900 } });
    await bootPalette(page, { [docPath]: b64(join(corpusDir, file)) }, [docPath]);
    await page.locator('#doc pre[data-marxy-s]').first().click();
    const mod = modKey(await page.evaluate(() => navigator.platform));
    await page.keyboard.press(`${mod}+KeyP`);
    await page.locator('#marxy-palette .marxy-palette-query').fill('>');
    await page.waitForSelector('#marxy-palette .marxy-palette-row');
    const labels = await page.locator('#marxy-palette .marxy-palette-row').allTextContents();
    assert.ok(labels.some((t) => /copy code/i.test(t)));
    await page.keyboard.press('Enter');
    await page.waitForFunction(
      () => {
        const dialog = document.getElementById('marxy-palette');
        return dialog instanceof HTMLDialogElement && !dialog.open;
      },
      undefined,
      { timeout: 5000 },
    );
    const notice = await page.locator('#marxy-notices .marxy-notice-text').textContent();
    assert.equal(notice?.trim(), 'Copied');
    const copies = await page.evaluate(() =>
      window.__marxyOpsBoot.handle.shell.calls.filter((c) => c.method === 'clipboardWrite'),
    );
    assert.ok(copies.length >= 1);
  } finally {
    await browser.close();
  }
});
