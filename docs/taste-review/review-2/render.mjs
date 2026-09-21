// Captures review #2 palette states and Source mode via the app harness (MARXY-39).
import { existsSync, mkdtempSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';

const require = createRequire(join(dirname(fileURLToPath(import.meta.url)), '../../../apps/desktop/package.json'));
const { build } = require('vite');
const { parseMarkdown, outlineFrom } = require('@marxy/core');

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../../..');
const desktop = join(root, 'apps/desktop');
const corpusDir = join(root, 'fixtures/corpus');
const outDir = here;

export const WIDTH = 960;
export const HEIGHT = 900;
export const DPR = 2;
export const VARIANT = 'dark';

export const SEQUENCE = [
  '01-long-technical.md',
  '02-readme-real-world.md',
  '03-ai-plan.md',
  '15-prose-volume.md',
  '09-gfm-everything.md',
];

export const CAPTURES = {
  empty: 'palette-empty-dark-960-2x.png',
  typing: 'palette-typing-dark-960-2x.png',
  headings: 'palette-headings-dark-960-2x.png',
  operations: 'palette-operations-dark-960-2x.png',
  source: 'source-04-source-rs-dark-960-2x.png',
};

function corpusPath(file) {
  return `/corpus/${file}`;
}

function b64(file) {
  return readFileSync(join(corpusDir, file)).toString('base64');
}

function kindFor(file) {
  if (file.endsWith('.rs')) return 'source';
  if (file.endsWith('.md')) return 'markdown';
  return 'text';
}

function indexEntry(file, rootPath = '/corpus') {
  const path = corpusPath(file);
  const bytes = readFileSync(join(corpusDir, file));
  const ast = parseMarkdown(bytes, { file: path });
  const outline = outlineFrom(ast);
  const headings = outline.map((entry) => ({
    level: entry.level,
    text: entry.text,
    byteOffset: entry.src.start,
  }));
  const title =
    headings.find((h) => h.level === 1)?.text ??
    file.replace(/\.[^.]+$/, '').replace(/^\d+-/, '').replace(/-/g, ' ');
  return {
    path,
    root: rootPath,
    title,
    headings,
    mtimeMs: 1_700_000_000_000 + SEQUENCE.indexOf(file),
    size: bytes.length,
    kind: kindFor(file),
  };
}

async function buildHarness() {
  const buildOut = mkdtempSync(join(tmpdir(), 'marxy-review2-'));
  await build({
    root: desktop,
    logLevel: 'silent',
    build: {
      outDir: buildOut,
      emptyOutDir: true,
      rollupOptions: {
        input: {
          app: join(desktop, 'app.html'),
          paletteBoot: join(desktop, 'test/palette-boot.html'),
        },
      },
    },
  });
  const types = {
    '.html': 'text/html',
    '.ttf': 'font/ttf',
    '.js': 'text/javascript',
    '.txt': 'text/plain',
    '.css': 'text/css',
    '.png': 'image/png',
  };
  const server = createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const path = join(buildOut, pathname.endsWith('/') ? `${pathname}index.html` : pathname);
    if (!existsSync(path)) {
      res.statusCode = 404;
      return res.end();
    }
    res.setHeader('Content-Type', types[extname(path)] ?? 'application/octet-stream');
    res.end(readFileSync(path));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/`;
  return { base, close: () => server.close() };
}

function modChord(platform) {
  return platform === 'MacIntel' ? 'Meta' : 'Control';
}

async function bootPalette(page, base, files, argv, indexEntries) {
  await page.goto(`${base}test/palette-boot.html`);
  await page.waitForFunction(() => typeof window.marxyPaletteBoot?.start === 'function');
  await page.evaluate(
    async ({ files, argv, indexEntries }) => {
      await window.marxyPaletteBoot.start(files, argv, indexEntries);
    },
    { files, argv, indexEntries },
  );
  await page.waitForFunction(() => document.querySelector('#doc')?.textContent?.length > 0);
}

async function openDocViaPalette(page, mod, needle) {
  await page.keyboard.press(`${mod}+KeyP`);
  await page.fill('#marxy-palette .marxy-palette-query', needle);
  await page.waitForTimeout(80);
  await page.keyboard.press('Enter');
  await page.waitForFunction(
    (q) => !document.querySelector('#marxy-palette')?.open,
    needle,
  );
  await page.waitForTimeout(150);
}

async function capturePaletteSet(page, base, dest) {
  const files = {};
  for (const file of SEQUENCE) files[corpusPath(file)] = b64(file);
  const indexEntries = SEQUENCE.map((file) => indexEntry(file));
  const first = corpusPath(SEQUENCE[0]);
  await bootPalette(page, base, files, [first], indexEntries);
  const mod = modChord(await page.evaluate(() => navigator.platform));

  const openNeedles = ['long-technical', 'readme-real', 'ai-plan', 'prose-volume', 'gfm-everything'];
  for (let i = 1; i < SEQUENCE.length; i++) {
    await openDocViaPalette(page, mod, openNeedles[i]);
  }

  await page.keyboard.press(`${mod}+KeyP`);
  await page.fill('#marxy-palette .marxy-palette-query', '');
  await page.waitForTimeout(120);
  await page.screenshot({ path: join(dest, CAPTURES.empty), fullPage: false, type: 'png' });
  await page.keyboard.press('Escape');

  await page.keyboard.press(`${mod}+KeyP`);
  await page.fill('#marxy-palette .marxy-palette-query', 'readme');
  await page.waitForTimeout(120);
  await page.screenshot({ path: join(dest, CAPTURES.typing), fullPage: false, type: 'png' });

  await page.keyboard.press('Tab');
  await page.waitForTimeout(80);
  await page.screenshot({ path: join(dest, CAPTURES.headings), fullPage: false, type: 'png' });

  await page.keyboard.press('Escape');
  await page.keyboard.press(`${mod}+KeyP`);
  await page.fill('#marxy-palette .marxy-palette-query', '> copy');
  await page.waitForTimeout(120);
  await page.screenshot({ path: join(dest, CAPTURES.operations), fullPage: false, type: 'png' });
  await page.keyboard.press('Escape');
}

async function captureSource(page, base, dest) {
  const rs = '04-source.rs';
  const path = corpusPath(rs);
  await page.goto(`${base}app.html`);
  await page.waitForFunction(() => typeof window.marxyApp?.start === 'function');
  await page.evaluate(
    async ({ files, argv }) => {
      const handle = await window.marxyApp.start(files, argv);
      await handle.ready;
    },
    { files: { [path]: b64(rs) }, argv: [path] },
  );
  await page.waitForFunction(
    () =>
      document.body.dataset.marxyMode === 'source' &&
      document.querySelector('#marxy-source .cm-editor') !== null,
  );
  await page.waitForTimeout(200);
  await page.screenshot({ path: join(dest, CAPTURES.source), fullPage: false, type: 'png' });
}

export async function captureAll({ dest = outDir } = {}) {
  const harness = await buildHarness();
  const browser = await launchWebkit();
  mkdirSync(dest, { recursive: true });
  const written = [];
  try {
    const page = await browser.newPage({
      viewport: { width: WIDTH, height: HEIGHT },
      deviceScaleFactor: DPR,
    });
    try {
      await capturePaletteSet(page, harness.base, dest);
      written.push(...Object.values(CAPTURES).map((name) => join(dest, name)));
      await captureSource(page, harness.base, dest);
    } finally {
      await page.close();
    }
  } finally {
    await browser.close();
    harness.close();
  }
  return written;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const paths = await captureAll();
  for (const p of paths) console.log(`wrote ${p} (${statSync(p).size} bytes)`);
}
