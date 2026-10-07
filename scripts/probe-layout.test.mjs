// scripts/probe-layout.mjs (L-00): the negative control and the determinism check.
//
// The probe states facts and judges nothing, so its own test is: given a page with a known asymmetry
// (a wide block that grows to one side, a column that is off the window's axis, a hung mark past the
// gutter) it reports exactly that, with the number the page's own geometry implies; given the same
// page without the fault it reports none; and two runs over the real render entry give an identical
// probe.json. Needs Playwright WebKit, like packages/theme/test/layout.test.mjs.
import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { after, before, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { defaultThemeCss } from '../packages/theme/scripts/inline.mjs';
import { assemble, DEFAULTS, drawOverlayInPage, measureInPage, run } from './probe-layout.mjs';
import { launchWebkit } from './playwright-webkit.mjs';

const skip =
  !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
    ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
    : false;
const test = (name, a, b) => (b ? nodeTest(name, { skip, ...a }, b) : nodeTest(name, { skip }, a));

let browser;
before(async () => {
  if (!skip) browser = await launchWebkit();
});
after(async () => {
  await browser?.close();
});

const WIDE = 'x'.repeat(150);
/** A page shaped like the app's: #marxy-main (the container) around the article, the default theme, nothing else. */
function page(body, { extraCss = '' } = {}) {
  return `<!doctype html><html lang="en" data-marxy-variant="dark"><head><meta charset="utf-8"><style>${defaultThemeCss()}${extraCss}</style></head><body><main id="marxy-main"><article id="doc" class="marxy-article">${body}</article></main></body></html>`;
}
const blk = (tag, i, inner) => `<${tag} data-marxy-s="${i * 100}" data-marxy-e="${i * 100 + 99}">${inner}</${tag}>`;
const PROSE = blk('p', 0, 'A short paragraph of body text that sits on the column and nowhere else.');

async function measure(html, width, opts = {}) {
  const p = await browser.newPage({ viewport: { width, height: 900 } });
  try {
    await p.setContent(html, { waitUntil: 'load' });
    return await p.evaluate(measureInPage, { blocks: true, notice: false, ...opts });
  } finally {
    await p.close();
  }
}

test('negative control: a wide block that grows to one side only is reported as an H1 asymmetry', async () => {
  const bad = await measure(page(PROSE + blk('pre', 1, `<code>${WIDE}</code>`)), 1280);
  const h1 = bad.offenders.filter((o) => o.h === 'H1');
  assert.equal(h1.length, 1, `expected one H1 offender, got ${JSON.stringify(bad.offenders)}`);
  assert.equal(h1[0].tag, 'pre');
  // The block starts on the column's left edge and runs past its right edge: the reported difference is
  // the overhang the page itself reports (box right minus column right), not a number written in here.
  const pre = bad.blocks.find((b) => b[1] === 'pre');
  const [, , , , right, dL, dR] = pre;
  assert.equal(dL, 0, 'the block must be left-anchored for this control to mean what it says');
  assert.ok(dR > 20, `the wide block overhangs the column by only ${dR}px`);
  assert.equal(h1[0].metric, dR);
  assert.ok(Math.abs(right - (bad.column.right + dR)) < 0.02);
  // The page's visual mass is shifted: ink margins differ by the overhang, 
  assert.ok(Math.abs(bad.margins.pageBoxes.asymmetry) > 20, `page boxes look symmetric: ${JSON.stringify(bad.margins.pageBoxes)}`);
  // Body text itself starts on the column edge: the asymmetry is the block's, not the column's.
  assert.ok(Math.abs(bad.margins.bodyInk.left - bad.column.left) < 0.02);
  assert.equal(bad.margins.pageBoxes.reaches, true);
});

test('the control without the fault reports no H1 offender and symmetric margins', async () => {
  const ok = await measure(page(PROSE + blk('pre', 1, `<code>${'x'.repeat(20)}</code>`)), 1280);
  assert.deepEqual(ok.offenders.filter((o) => o.h === 'H1'), []);
  assert.ok(Math.abs(ok.margins.pageBoxes.asymmetry) < 1, JSON.stringify(ok.margins.pageBoxes));
});

test('negative control: a column off the window axis is reported with the offset its own geometry implies', async () => {
  const off = await measure(page(PROSE, { extraCss: '.marxy-article{margin-inline:0}' }), 1280);
  const { column, centre } = off;
  const expected = Math.round((column.left + column.width / 2 - 1280 / 2) * 100) / 100;
  assert.equal(centre.offsetFromWindow, expected);
  assert.ok(Math.abs(centre.offsetFromWindow) > 100, `column offset ${centre.offsetFromWindow}px is not a visible fault`);
  const centred = await measure(page(PROSE), 1280);
  assert.ok(Math.abs(centred.centre.offsetFromWindow) < 1, JSON.stringify(centred.centre));
});

test('negative control: a top-level ordered list hangs its marker past the gutter floor at 320px, not at 960px', async () => {
  const html = page(blk('ol', 0, `<li>${'first item'}</li><li>second item</li>`));
  const narrow = await measure(html, 320);
  const h3 = narrow.offenders.filter((o) => o.h === 'H3');
  assert.ok(h3.length >= 1, JSON.stringify(narrow.marks));
  const hang = narrow.marks['ol-marker'].maxHang;
  assert.ok(hang > narrow.column.gutter, `marker hangs ${hang}px, the gutter is ${narrow.column.gutter}px`);
  assert.equal(h3[0].metric, Math.round((narrow.column.gutter - (narrow.column.left - hang)) * 100) / 100);
  const wide = await measure(html, 960);
  assert.deepEqual(wide.offenders.filter((o) => o.h === 'H3'), []);
});

test('the overlay draws a red box for every offender that has a position', async () => {
  const p = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  try {
    await p.setContent(page(PROSE + blk('pre', 1, `<code>${WIDE}</code>`)), { waitUntil: 'load' });
    const cell = await p.evaluate(measureInPage, { blocks: false, notice: false });
    await p.evaluate(drawOverlayInPage, { cell, only: null, onlyH: null });
    const boxes = await p.evaluate(() => document.querySelectorAll('#probe-overlay > div[style*="outline"]').length);
    assert.equal(boxes, cell.offenders.filter((o) => o.top !== null).length);
    assert.ok(boxes >= 1);
  } finally {
    await p.close();
  }
});

test('two runs over the render entry produce an identical probe.json', { timeout: 240_000 }, async () => {
  const opts = {
    ...DEFAULTS,
    ref: 'origin/main',
    files: ['05-pathological-table-and-nesting.md', '27-alerts.md'],
    widths: [320, 960],
    sizes: [20],
    variants: ['dark'],
    scrollbars: ['overlay', 'classic'],
    workers: 2,
    png: false,
  };
  const dumps = [];
  for (let i = 0; i < 2; i++) {
    const rr = await run(opts);
    try {
      assert.deepEqual(rr.results.filter((r) => r.error), []);
      dumps.push(JSON.stringify(assemble(opts, rr)));
    } finally {
      rr.harness.close();
      await rr.browser.close();
    }
  }
  assert.ok(dumps[0].length > 10_000, 'the probe measured nothing');
  assert.equal(dumps[0], dumps[1]);
});
