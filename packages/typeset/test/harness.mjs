// A WebKit page with a corpus document set exactly as the app sets it — the core pipeline's HTML, the
// default theme, the bundled faces — and the typesetter loaded from source. `src/*.ts` is served with
// its types stripped and `justif/*` through an import map, so the page runs the same modules the app
// bundles, with no bundler in the way. Shared by the tests and scripts/measure-rendered.mjs.

import { readFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { stripTypeScriptTypes } from 'node:module';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { renderSafeHtml } from '../../core/src/render/pipeline.ts';
import { defaultThemeCss } from '../../theme/scripts/inline.mjs';

const root = new URL('../../../', import.meta.url);
const pkg = new URL('../', import.meta.url);
const justif = new URL('node_modules/justif/dist/', pkg);

const FONTS = {
  '/fonts/Literata.ttf': 'fonts/literata/Literata[opsz,wght].ttf',
  '/fonts/Literata-Italic.ttf': 'fonts/literata/Literata-Italic[opsz,wght].ttf',
  '/fonts/JetBrainsMono.ttf': 'fonts/jetbrains-mono/JetBrainsMono[wght].ttf',
};
const fontsCss = readFileSync(new URL('apps/desktop/src/fonts/fonts.css', root), 'utf8').replaceAll('./fonts/', '/fonts/');

export function renderCorpus(file) {
  return renderSafeHtml(readFileSync(new URL(`fixtures/corpus/${file}`, root)), { file }).html;
}

/** Starts the page server; `close()` when done. */
export async function startHarness() {
  const pages = new Map();
  const server = createServer((req, res) => {
    const path = new URL(req.url, 'http://x').pathname;
    const send = (type, body) => { res.setHeader('Content-Type', type); res.end(body); };
    if (pages.has(path)) return send('text/html', pages.get(path));
    if (path.startsWith('/src/') && path.endsWith('.ts')) {
      const file = new URL(`.${path}`, pkg);
      if (existsSync(file)) return send('text/javascript', stripTypeScriptTypes(readFileSync(file, 'utf8')));
    }
    if (path.startsWith('/justif/')) {
      const file = new URL(path.slice('/justif/'.length), justif);
      if (existsSync(file)) return send('text/javascript', readFileSync(file));
    }
    if (FONTS[path]) return send('font/ttf', readFileSync(new URL(FONTS[path], root)));
    res.statusCode = 404;
    res.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await launchWebkit();
  let n = 0;

  /**
   * A page with `html` in the article. The typesetter is on `window.typeset` and the grid pass has run
   * once; nothing is typeset until the test calls `attach`.
   */
  async function open(html, { width = 960, height = 900, extraCss = '', variant = 'dark' } = {}) {
    const path = `/page-${n++}.html`;
    pages.set(path, `<!doctype html><html lang="en" data-marxy-variant="${variant}"><head><meta charset="utf-8">
<script type="importmap">{"imports":{"justif/core":"/justif/core.js","justif/hyphenate/en-us":"/justif/hyphenate/en-us.js","justif/hyphenate/en-gb":"/justif/hyphenate/en-gb.js"}}</script>
<style>${fontsCss}${defaultThemeCss()}${extraCss}</style></head>
<body><article class="marxy-article" id="doc">${html}</article>
<script type="module">import * as typeset from '/src/index.ts'; import { immediateScheduler } from '/src/scheduler.ts';
window.typeset = typeset; window.immediateScheduler = immediateScheduler;
const doc = document.getElementById('doc'); void doc.offsetHeight; await document.fonts.ready;
window.lineBox = parseFloat(getComputedStyle(doc).lineHeight); typeset.snapToGrid(doc, window.lineBox); window.harnessReady = true;</script>
</body></html>`);
    const page = await browser.newPage({ viewport: { width, height } });
    await page.goto(origin + path);
    await page.waitForFunction(() => window.harnessReady === true);
    return page;
  }

  return {
    open,
    async close() {
      await browser.close();
      server.close();
    },
  };
}

/**
 * Line widths per typesettable paragraph, in px, read from the page as it stands: each line is the
 * union of the paragraph's text rectangles on one baseline. Works for native and set paragraphs alike.
 */
export function readLines(page) {
  return page.evaluate(() => {
    const doc = document.getElementById('doc');
    const out = [];
    for (const p of doc.querySelectorAll('p[data-marxy-s], li[data-marxy-s]')) {
      if (p.matches('li') && p.querySelector(':scope > :is(p, ul, ol, pre, blockquote, table)')) continue;
      if (getComputedStyle(p).display !== 'block' && getComputedStyle(p).display !== 'list-item') continue;
      const cs = getComputedStyle(p);
      const box = p.getBoundingClientRect();
      const left = box.left + parseFloat(cs.paddingLeft);
      const measure = box.width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const range = document.createRange();
      range.selectNodeContents(p);
      const lines = new Map();
      for (const r of range.getClientRects()) {
        if (r.width === 0) continue;
        const key = Math.floor((r.top + r.height / 2 - box.top - parseFloat(cs.paddingTop)) / parseFloat(cs.lineHeight));
        const line = lines.get(key) ?? { left: Infinity, right: -Infinity };
        line.left = Math.min(line.left, r.left);
        line.right = Math.max(line.right, r.right);
        lines.set(key, line);
      }
      const widths = [...lines.entries()].sort((a, b) => a[0] - b[0]).map(([, l]) => l.right - left);
      out.push({ s: Number(p.dataset.marxyS), set: p.classList.contains('marxy-set'), measure, widths, text: p.textContent });
    }
    return out;
  });
}
