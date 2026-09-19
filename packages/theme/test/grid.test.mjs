// The default theme, measured in Playwright WebKit over the rendered corpus (MARXY-20;
// docs/design/10-gates-and-testing.md checks 1–3, ADR-0030). No shell: the corpus is rendered by the
// core pipeline in Node, the page carries exactly the stylesheet the app inlines, and the grid pass is
// the one the app runs. The headless render entry (MARXY-25) will replace the page builder here.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { after, before, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';

/**
 * A job without Playwright's WebKit (CI's `fast` job) skips these tests and says why, unless
 * MARXY_BROWSER_TESTS_REQUIRED=1, where a missing browser is a failure as it should be.
 */
const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip }, fn);

import { renderSafeHtml } from '../../core/src/render/pipeline.ts';
import { defaultThemeCss } from '../scripts/inline.mjs';

const root = new URL('../../../', import.meta.url);
const css = defaultThemeCss();
const grid = stripTypeScriptTypes(readFileSync(new URL('packages/typeset/src/grid.ts', root), 'utf8')).replace(/^export /gm, '');

const CORPUS = [
  '01-long-technical.md', '02-readme-real-world.md', '03-ai-plan.md', '05-pathological-table-and-nesting.md',
  '06-math.md', '07-cjk.md', '08-rtl.md', '09-gfm-everything.md', '10-hostile.md', '14-marxy-plan.md', '15-prose-volume.md',
];
/** No code, math, images or tables: tables now use the code line box and are islands (MARXY-128). */
const TEXT_ONLY = ['14-marxy-plan.md'];
const WIDTHS = [720, 960, 1280];
/** Body size → line box, kept an even number so half a line is whole pixels. */
const SIZES = { 14: 24, 17: 28, 21: 34, 24: 40 };

const rendered = new Map(CORPUS.map((file) => [file, renderSafeHtml(readFileSync(new URL(`fixtures/corpus/${file}`, root)), { file }).html]));

let browser;
before(async () => { if (!skip) browser = await webkit.launch(); });
after(async () => { await browser?.close(); });

async function open(file, { width = 960, size = 17, variant = 'dark', snap = true } = {}) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  const tokens = size === 17 ? '' : `:root{--marxy-size-body:${size}px;--marxy-line-box:${SIZES[size]}px}`;
  await page.setContent(
    `<!doctype html><html lang="en" data-marxy-variant="${variant}"><head><meta charset="utf-8"><style>${css}${tokens}</style></head>` +
      `<body><article class="marxy-article" id="doc">${rendered.get(file)}</article></body></html>`,
  );
  await page.addScriptTag({ content: `${grid}\nwindow.snapToGrid = snapToGrid;` });
  if (snap) await page.evaluate(() => window.snapToGrid(document.getElementById('doc'), parseFloat(getComputedStyle(document.getElementById('doc')).lineHeight)));
  return page;
}

/** §10 check 1, with the unit of ADR-0030: every block's top, from the article's top, on the half-line grid. */
function offGrid(page) {
  return page.evaluate(() => {
    const article = document.getElementById('doc');
    const unit = parseFloat(getComputedStyle(article).lineHeight) / 2;
    const origin = article.getBoundingClientRect().top;
    const off = [];
    for (const el of article.querySelectorAll('[data-marxy-s]')) {
      const display = getComputedStyle(el).display;
      if (!['block', 'table', 'list-item', 'flow-root'].includes(display)) continue;
      const top = el.getBoundingClientRect().top - origin;
      const r = ((top % unit) + unit) % unit;
      if (r > 0.5 && r < unit - 0.5) off.push(`<${el.tagName.toLowerCase()} s=${el.dataset.marxyS}> top ${top.toFixed(2)} (unit ${unit})`);
    }
    return off;
  });
}

for (const file of TEXT_ONLY) {
  test(`${file}: the stylesheet alone puts every block on the grid`, async () => {
    const page = await open(file, { snap: false });
    assert.deepEqual((await offGrid(page)).slice(0, 10), []);
    await page.close();
  });
}

for (const file of CORPUS) {
  test(`${file}: every block on the grid after the grid pass, at three widths and four sizes`, async () => {
    const cases = [...WIDTHS.map((width) => ({ width })), ...[14, 21, 24].map((size) => ({ size }))];
    for (const options of cases) {
      const page = await open(file, options);
      assert.deepEqual((await offGrid(page)).slice(0, 10), [], `off the grid at ${JSON.stringify(options)}`);
      await page.close();
    }
  });
}

test('the measure is 60–75 ch at every size and width', async () => {
  for (const [width, size] of [...WIDTHS.map((w) => [w, 17]), ...[14, 21, 24].map((s) => [960, s])]) {
    const page = await open('01-long-technical.md', { width, size });
    const ch = await page.evaluate(() => {
      const article = document.getElementById('doc');
      const probe = document.createElement('span');
      probe.textContent = '0';
      article.prepend(probe);
      const one = probe.getBoundingClientRect().width;
      probe.remove();
      const style = getComputedStyle(article);
      return (article.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)) / one;
    });
    assert.ok(ch >= 60 && ch <= 75, `${ch.toFixed(1)} ch at ${width} px wide, ${size} px type`);
    await page.close();
  }
});

/** WCAG contrast of two computed `rgb()` colours. */
const luminance = ([r, g, b]) => {
  const c = [r, g, b].map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

for (const variant of ['dark', 'light']) {
  test(`contrast, ${variant}: body ≥ 7:1, secondary ≥ 4.5:1, code and every code token ≥ 4.5:1`, async () => {
    const page = await open('09-gfm-everything.md', { variant });
    const colours = await page.evaluate(() => {
      const rgb = (value) => {
        const probe = document.createElement('i');
        probe.style.color = value;
        document.body.append(probe);
        const out = getComputedStyle(probe).color.match(/[\d.]+/g).slice(0, 3).map(Number);
        probe.remove();
        return out;
      };
      const article = document.getElementById('doc');
      const root = getComputedStyle(document.documentElement);
      const pre = article.querySelector('pre');
      const tokens = {};
      for (const name of ['keyword', 'string', 'comment', 'number', 'function', 'type', 'variable', 'operator', 'punctuation', 'constant', 'tag', 'attribute']) {
        tokens[name] = rgb(root.getPropertyValue(`--marxy-tok-${name}`));
      }
      return {
        bg: rgb(getComputedStyle(article).backgroundColor),
        body: rgb(getComputedStyle(article.querySelector('p')).color),
        secondary: rgb(root.getPropertyValue('--marxy-color-text-secondary')),
        link: rgb(getComputedStyle(article.querySelector('a[href]')).color),
        codeBg: rgb(getComputedStyle(pre).backgroundColor),
        code: rgb(getComputedStyle(pre.querySelector('code')).color),
        tokens,
      };
    });
    assert.ok(contrast(colours.body, colours.bg) >= 7, `body ${contrast(colours.body, colours.bg).toFixed(2)}`);
    assert.ok(contrast(colours.secondary, colours.bg) >= 4.5, `secondary ${contrast(colours.secondary, colours.bg).toFixed(2)}`);
    assert.ok(contrast(colours.link, colours.bg) >= 4.5, `link ${contrast(colours.link, colours.bg).toFixed(2)}`);
    assert.ok(contrast(colours.code, colours.codeBg) >= 7, `code ${contrast(colours.code, colours.codeBg).toFixed(2)}`);
    for (const [name, colour] of Object.entries(colours.tokens)) {
      assert.ok(contrast(colour, colours.codeBg) >= 4.5, `token ${name} ${contrast(colour, colours.codeBg).toFixed(2)}`);
    }
    await page.close();
  });
}

test('the design-language numbers fall out of the formulas at 17 px: h2 is 56 above, 34 tall, 14 below', async () => {
  const page = await open('01-long-technical.md');
  const h2 = await page.evaluate(() => {
    const style = getComputedStyle(document.querySelector('h2'));
    return [style.marginTop, style.lineHeight, style.marginBottom, style.fontSize].map(parseFloat);
  });
  // 56 / 34 / 14: the named gaps are grid units; the 8 px remainder is padding-bottom (MARXY-128).
  assert.deepEqual(h2, [56, 34, 14, 27]);
  await page.close();
});

test('headings keep at least half a line below them at every size (constraint 3)', async () => {
  for (const size of [14, 17, 21, 24]) {
    const page = await open('01-long-technical.md', { size });
    const gaps = await page.evaluate(() => {
      const half = parseFloat(getComputedStyle(document.getElementById('doc')).lineHeight) / 2;
      return [...document.querySelectorAll('h1, h2')].map((h) => {
        const s = getComputedStyle(h);
        return { tag: h.tagName, above: parseFloat(s.marginTop), below: parseFloat(s.marginBottom), half, lh: parseFloat(s.lineHeight), size: parseFloat(s.fontSize) };
      });
    });
    for (const g of gaps) {
      assert.ok(g.below >= g.half && g.below < g.half * 2 + 0.5, `${g.tag} at ${size}px: ${g.below} below`);
      assert.ok(g.lh >= g.size, `${g.tag} at ${size}px: line box ${g.lh} under its size ${g.size}`);
    }
    await page.close();
  }
});

test('a wrapped line of code hangs under its own first line, on every source line', async () => {
  const page = await browser.newPage({ viewport: { width: 720, height: 600 } });
  const long = 'x'.repeat(200);
  const { html } = renderSafeHtml(`\`\`\`\nfirst\n${long}\n\`\`\`\n`, { file: 't.md' });
  await page.setContent(`<!doctype html><html data-marxy-variant="dark"><head><style>${css}</style></head><body><article class="marxy-article" id="doc">${html}</article></body></html>`);
  const lefts = await page.evaluate(() => {
    const text = document.querySelector('pre code').firstChild;
    const at = (i) => { const r = document.createRange(); r.setStart(text, i); r.setEnd(text, i + 1); return r.getBoundingClientRect(); };
    const start = text.data.indexOf('x');
    const first = at(start);
    let i = start;
    while (i < text.data.length - 2 && Math.abs(at(i + 1).top - first.top) < 1) i++;
    return { firstLine: at(0).left, sourceLine: first.left, wrapped: at(i + 1).left, ch: at(0).width };
  });
  assert.ok(Math.abs(lefts.sourceLine - lefts.firstLine) < 0.5, 'every source line starts at the block edge');
  assert.ok(lefts.wrapped - lefts.sourceLine > lefts.ch * 1.5, `a continuation hangs: ${JSON.stringify(lefts)}`);
  await page.close();
});
