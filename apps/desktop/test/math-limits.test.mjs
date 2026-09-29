// KaTeX in a real WebKit page with the options and theme the app uses: a hostile formula stays
// bounded (maxSize/maxExpand, MARXY-337) and a wide display formula scrolls inside its own block
// instead of widening the page at narrow widths.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { defaultThemeCss } from '../../../packages/theme/scripts/inline.mjs';
import { katexOptions } from '../src/render/math.ts';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip }, fn);

const katexDir = new URL('../node_modules/katex/dist/', import.meta.url);
const katexJs = readFileSync(new URL('katex.min.js', katexDir), 'utf8');
const katexCss = readFileSync(new URL('katex.min.css', katexDir), 'utf8').replace(/url\(fonts\/[^)]*\)/g, 'url(data:,)');

async function withMath(width, blocks, inlines, run) {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width, height: 800 } });
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${defaultThemeCss()}${katexCss}</style></head><body>
<article class="marxy-article" id="doc">${blocks.map(() => '<pre class="marxy-math-block"><code></code></pre>').join('')}<p>${inlines.map(() => '<code class="marxy-math"></code>').join(' ')}</p></article></body></html>`);
    await page.addScriptTag({ content: katexJs });
    await page.evaluate(({ blocks, inlines, opts }) => {
      document.querySelectorAll('pre.marxy-math-block code').forEach((el, i) => katex.render(blocks[i], el, opts.display));
      document.querySelectorAll('code.marxy-math').forEach((el, i) => katex.render(inlines[i], el, opts.inline));
    }, { blocks, inlines, opts: { display: katexOptions(true), inline: katexOptions(false) } });
    return await run(page);
  } finally {
    await browser.close();
  }
}

test('a hostile formula renders bounded, not millions of pixels wide', async () => {
  const width = await withMath(960, ['\\rule{10em}{2000em}'], ['\\rule{100000em}{1em}', '\\hspace{99999em}x'], (page) =>
    page.evaluate(() => {
      const widest = Math.max(...[...document.querySelectorAll('.marxy-math .katex, .katex-display .katex')].map((el) => el.scrollWidth));
      return { widest, doc: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight };
    }),
  );
  assert.ok(width.widest < 2000, `widest katex box ${width.widest}px`);
  assert.ok(width.doc < 3000, `page scrollWidth ${width.doc}px`);
  assert.ok(width.height < 20000, `page scrollHeight ${width.height}px`);
});

test('wide display math scrolls inside its own block and leaves the page at the viewport width', async () => {
  const wide = 'a_1+a_2+a_3+a_4+a_5+a_6+a_7+a_8+a_9+a_{10}+a_{11}+a_{12}+a_{13}+a_{14}+a_{15}+a_{16}+a_{17}+a_{18}';
  const r = await withMath(400, [wide], [], (page) =>
    page.evaluate(() => {
      const el = document.querySelector('.katex-display');
      return { page: document.documentElement.scrollWidth, vw: document.documentElement.clientWidth, overflowX: getComputedStyle(el).overflowX, scrolls: el.scrollWidth > el.clientWidth };
    }),
  );
  assert.ok(r.page <= r.vw, `page scrollWidth ${r.page} > viewport ${r.vw}`);
  assert.equal(r.scrolls, true, 'the block itself scrolls');
});

test('display math that fits is not given a scrollbar or extra height', async () => {
  const r = await withMath(960, ['x^2+y^2=z^2'], [], (page) =>
    page.evaluate(() => {
      const el = document.querySelector('.katex-display');
      return { scrolls: el.scrollWidth > el.clientWidth, vScroll: el.scrollHeight > el.clientHeight + 1 };
    }),
  );
  assert.deepEqual(r, { scrolls: false, vScroll: false });
});
