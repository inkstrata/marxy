// Renders the three review #1 corpus documents through the headless entry at 68ch, 17px, light, 2×.
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { defaultThemeCss } from '../../../packages/theme/scripts/inline.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../../..');
const desktop = join(root, 'apps/desktop');
const dist = join(desktop, 'dist');
const outDir = join(here, 'marxy');
const corpusDir = join(root, 'fixtures/corpus');

export const FILES = [
  '01-long-technical.md',
  '02-readme-real-world.md',
  '03-ai-plan.md',
];
export const WIDTH = 960;
export const HEIGHT = 900;
export const DPR = 2;
export const VARIANT = 'light';
export const SIZE = 17;
export const SCROLL_FRAC = 0.7;

const FONT_URLS = {
  '/fonts/Literata.ttf': join(root, 'fonts/literata/Literata[opsz,wght].ttf'),
  '/fonts/Literata-Italic.ttf': join(root, 'fonts/literata/Literata-Italic[opsz,wght].ttf'),
  '/fonts/JetBrainsMono.ttf': join(root, 'fonts/jetbrains-mono/JetBrainsMono[wght].ttf'),
};

export function slug(file) {
  return file.replace(/\.md$/, '');
}

export function pngName(file, kind) {
  return `${slug(file)}-${kind}-${VARIANT}-${WIDTH}-${DPR}x.png`;
}

async function buildRenderEntry() {
  const require = createRequire(join(desktop, 'package.json'));
  const { build } = require('vite');
  await build({
    configFile: join(desktop, 'src/render/vite.config.ts'),
    root: desktop,
    logLevel: 'error',
  });
  mkdirSync(dist, { recursive: true });
  const fontsCss = readFileSync(join(desktop, 'src/fonts/fonts.css'), 'utf8').replaceAll('./fonts/', '/fonts/');
  writeFileSync(
    join(dist, 'render.html'),
    `<!doctype html>
<html lang="en" data-marxy-variant="dark">
<head>
<meta charset="utf-8">
<title>marxy render</title>
<style id="marxy-fonts">${fontsCss}</style>
<style id="marxy-default-theme">${defaultThemeCss()}</style>
</head>
<body>
<main id="marxy-main"><article id="doc" class="marxy-article"></article></main>
<script src="./render.js"></script>
</body>
</html>
`,
  );
  if (!existsSync(join(dist, 'render.js'))) throw new Error('vite build did not write apps/desktop/dist/render.js');
}

function startHarness() {
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.ttf': 'font/ttf',
  };
  const server = createServer((req, res) => {
    const path = new URL(req.url, 'http://x').pathname;
    const send = (code, type, body) => {
      res.statusCode = code;
      res.setHeader('Content-Type', type);
      res.end(body);
    };
    if (FONT_URLS[path]) return send(200, 'font/ttf', readFileSync(FONT_URLS[path]));
    const file = path === '/' ? join(dist, 'render.html') : join(dist, path.slice(1));
    if (!file.startsWith(dist) || !existsSync(file) || !statSync(file).isFile()) return send(404, 'text/plain', 'not found');
    const ext = file.slice(file.lastIndexOf('.'));
    return send(200, types[ext] ?? 'application/octet-stream', readFileSync(file));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ origin: `http://127.0.0.1:${server.address().port}`, close: () => server.close() });
    });
  });
}

async function renderCorpus(page, origin, source, opts) {
  await page.goto(`${origin}/render.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.marxyRender === 'function');
  return page.evaluate(async ({ source, opts }) => window.marxyRender(source, opts), { source, opts });
}

export async function captureAll({ dest = outDir } = {}) {
  await buildRenderEntry();
  const harness = await startHarness();
  const browser = await launchWebkit();
  mkdirSync(dest, { recursive: true });
  const written = [];
  try {
    for (const file of FILES) {
      const source = readFileSync(join(corpusDir, file), 'utf8');
      const opts = { variant: VARIANT, width: WIDTH, size: SIZE, typeset: true };
      const page = await browser.newPage({
        viewport: { width: WIDTH, height: HEIGHT },
        deviceScaleFactor: DPR,
      });
      try {
        await renderCorpus(page, harness.origin, source, opts);
        const first = pngName(file, 'first');
        const firstPath = join(dest, first);
        await page.screenshot({ path: firstPath, fullPage: false, type: 'png' });
        written.push(firstPath);

        await page.evaluate((frac) => {
          const max = Math.max(document.documentElement.scrollHeight - window.innerHeight, 0);
          window.scrollTo(0, Math.round(max * frac));
        }, SCROLL_FRAC);
        await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

        const scroll = pngName(file, 'scroll70');
        const scrollPath = join(dest, scroll);
        await page.screenshot({ path: scrollPath, fullPage: false, type: 'png' });
        written.push(scrollPath);
      } finally {
        await page.close();
      }
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
