// The island look (V-12.1): the in-place block editor inside Rendered keeps Rendered's code metrics, grid padding,
// wrapping and ground, not Source's own (V-12, ADR-0067). Values are read from the token contract in the page.
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { bootTwoPanes, closeHarness } from './support/two-pane.mjs';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip, timeout: 90_000 }, fn);
after(() => closeHarness());

const file = '03-ai-plan.md';
const text = readFileSync(join(fileURLToPath(new URL('../../../', import.meta.url)), 'fixtures', 'corpus', file), 'utf8');
const firstParagraphStart = text.indexOf('\n\n') >= 0 ? 0 : 0;

/** Opens the first paragraph in the block editor, then reads the island's look against the tokens, per variant. */
async function readIsland(variant) {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    await bootTwoPanes(page, { files: { [`/c/${file}`]: text }, open: [`/c/${file}`] });
    await page.waitForFunction(() => document.querySelector('#doc [data-marxy-s]') !== null);
    await page.evaluate((v) => document.documentElement.setAttribute('data-marxy-variant', v), variant);
    const mod = (await page.evaluate(() => navigator.platform)) === 'MacIntel' ? 'Meta' : 'Control';
    const start = await page.evaluate(() => Number(document.querySelector('#doc p[data-marxy-s]').getAttribute('data-marxy-s')));
    await page.evaluate((b) => window.__marxyHandle.selection.selectBlockAtByte(b), start);
    await page.keyboard.press(`${mod}+Enter`);
    await page.waitForSelector('.marxy-block-editor .cm-content');
    return await page.evaluate(() => {
      const ed = document.querySelector('.marxy-block-editor');
      const cs = (el) => getComputedStyle(el);
      /** What a token resolves to as a given property, in the editor's own scope. */
      const token = (prop, css) => { const i = document.createElement('i'); i.style[prop] = css; ed.appendChild(i); const v = cs(i)[prop]; i.remove(); return v; };
      const line = ed.querySelector('.cm-line');
      const rows = (el) => Math.round(el.getBoundingClientRect().height / parseFloat(cs(el).lineHeight));
      const longest = [...ed.querySelectorAll('.cm-line')].sort((a, b) => b.textContent.length - a.textContent.length)[0];
      return {
        size: cs(ed.querySelector('.cm-content')).fontSize,
        sizeToken: token('fontSize', 'var(--marxy-size-code)'),
        lineHeight: cs(line).lineHeight,
        lineHeightPx: token('width', 'var(--marxy-line-box-code)'),
        gutters: ed.querySelectorAll('.cm-gutters').length,
        pad: (({ paddingTop, paddingRight, paddingBottom, paddingLeft }) => [paddingTop, paddingRight, paddingBottom, paddingLeft])(cs(ed.querySelector('.cm-content'))),
        unitsPx: [token('width', 'calc(var(--marxy-line-box) / 2 * 2)'), token('width', 'calc(var(--marxy-line-box) / 2 * 4)')],
        wrapRows: rows(longest),
        wraps: ed.querySelector('.cm-content').classList.contains('cm-lineWrapping') && cs(ed.querySelector('.cm-content')).whiteSpace !== 'pre',
        sourceSize: token('fontSize', 'var(--marxy-size-source)'),
        scrollsX: ed.querySelector('.cm-scroller').scrollWidth > ed.querySelector('.cm-scroller').clientWidth + 1,
        ground: cs(ed).backgroundColor,
        groundToken: token('backgroundColor', 'var(--marxy-color-code-bg)'),
      };
    });
  } finally {
    await browser.close();
  }
}

for (const variant of ['dark', 'light']) {
  test(`the block editor keeps the island look in ${variant}: code metrics, grid padding, wrapping, ground`, async () => {
    const r = await readIsland(variant);
    assert.equal(r.size, r.sizeToken, 'font size is --marxy-size-code (not Source\'s --marxy-size-source)');
    assert.equal(r.lineHeight, r.lineHeightPx, 'a line is --marxy-line-box-code tall (not --marxy-line-box-source)');
    assert.equal(r.gutters, 0, 'the island shows no line numbers or fold column');
    const [v, h] = r.unitsPx;
    assert.deepEqual(r.pad, [v, h, v, h], 'the text pads 2 grid units above and below, 4 each side, in half prose line boxes');
    assert.equal(r.wraps, true, 'the island wraps (cm-lineWrapping)');
    assert.notEqual(r.size, r.sourceSize, 'the island is not at Source\'s size');
    assert.equal(r.scrollsX, false, 'the island wraps; it does not scroll sideways');
    assert.ok(r.wrapRows >= 1);
    assert.equal(r.ground, r.groundToken, 'the ground is --marxy-color-code-bg');
  });
}
