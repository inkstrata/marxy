// L-08.3: a display formula wider than the column scrolls (base.css `.katex-display`), so it takes a tab stop
// and a name like a scrolling table; one that fits takes neither. Real WebKit at 320 px, the default theme.
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { createRequire } from 'node:module';
import { after, before, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { openPage } from '../../../packages/theme/test/page.mjs';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip }, fn);

const require = createRequire(import.meta.url);
const katex = require('katex');
const katexCss = readFileSync(require.resolve('katex/dist/katex.min.css'), 'utf8');
const idle = stripTypeScriptTypes(readFileSync(new URL('../src/startup/idle-work.ts', import.meta.url), 'utf8'));
const fn = idle.slice(idle.indexOf('export function focusableScrollers')).replace(/^export /, '');

const WIDE = Array.from({ length: 40 }, (_, i) => `x_{${i}}`).join(' + ');
const html =
  `<pre class="marxy-math-block"><code>${katex.renderToString(WIDE, { displayMode: true })}</code></pre>` +
  `<pre class="marxy-math-block"><code>${katex.renderToString('a^2 + b^2 = c^2', { displayMode: true })}</code></pre>`;

let browser;
before(async () => {
  if (!skip) browser = await launchWebkit();
});
after(async () => {
  await browser?.close();
});

const read = (page) =>
  page.evaluate((src) => {
    new Function(`${src}\nfocusableScrollers(document.getElementById('doc'));`)();
    return [...document.querySelectorAll('.katex-display')].map((f) => ({
      scrolls: f.scrollWidth > f.clientWidth + 1,
      tabindex: f.getAttribute('tabindex'),
      label: f.getAttribute('aria-label'),
    }));
  }, fn);

test('at 320 px a display formula that scrolls has a tab stop and a name; one that fits has neither', async () => {
  const page = await openPage(browser, html, { width: 320, extraCss: katexCss });
  const [wide, fits] = await read(page);
  assert.equal(wide.scrolls, true, 'the wide formula should overflow at 320 px');
  assert.equal(wide.tabindex, '0');
  assert.equal(wide.label, 'Formula, scrolls sideways');
  assert.equal(fits.scrolls, false);
  assert.equal(fits.tabindex, null);
  assert.equal(fits.label, null);
  await page.close();
});
