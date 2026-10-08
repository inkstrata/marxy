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
import { assemble, CLASSIC_CSS, DEFAULTS, drawOverlayInPage, measureInPage, run } from './probe-layout.mjs';
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

// ---- Controls added in L-00.1: one per rule the first version left unguarded. Each builds the fault with a
// known size, reads the expected number from the page's own geometry (not a literal), and has a twin without
// the fault that must report nothing.

/** The probe's own reading of a block, by tag. */
const blockOf = (cell, tag) => cell.blocks.find((b) => b[1] === tag);

test('negative control (H2): a code block whose text starts inside the column edge is reported with that inset', async () => {
  const bad = await measure(page(PROSE + blk('pre', 1, '<code>let x = 1;</code>')), 960);
  const h2 = bad.offenders.filter((o) => o.h === 'H2');
  assert.equal(h2.length, 1, JSON.stringify(bad.offenders));
  assert.equal(h2[0].tag, 'pre');
  const [, , , , , , , , , idL] = blockOf(bad, 'pre');
  assert.ok(idL > 5, `the pre text is only ${idL}px inside the column edge`);
  assert.equal(h2[0].metric, idL);
  // The twin: body text alone starts on the column edge.
  const ok = await measure(page(PROSE), 960);
  assert.deepEqual(ok.offenders.filter((o) => o.h === 'H2'), []);
});

// ---- Controls added in L-02: the two artefacts L-01 found in the probe itself. Each has a control that fails
// when the probe is wrong and a twin that keeps the rule alive.

test('negative control (H2 artefact): a hung initial letter is ink that is allowed to hang, not the paragraph starting one letter late', async () => {
  // As the typesetter leaves a set paragraph: the first letter of every line is wrapped in a hang.
  const hang = (c) => `<span class="marxy-hang" style="margin-inline-start:-0.7px">${c}</span>`;
  const hung = blk('p', 0, `${hang('T')}his line starts with a hung capital<br>${hang('V')}alues on the second line do too`);
  const ok = await measure(page(hung), 960);
  assert.deepEqual(ok.offenders.filter((o) => o.h === 'H2'), [], 'the hung capital made the text start a letter late');
  const [, , , , , , , iL, , idL] = blockOf(ok, 'p');
  assert.ok(Math.abs(idL) < 1, `the paragraph's ink starts ${idL}px from the column edge`);
  assert.ok(Math.abs(iL - ok.column.left) < 1);
  // Twin: the same paragraph inset by 15px is a real H2, hung letter or not.
  const inset = await measure(page(hung.replace('<p ', '<p style="padding-left:15px" ')), 960);
  const h2 = inset.offenders.filter((o) => o.h === 'H2');
  assert.equal(h2.length, 1, JSON.stringify(inset.offenders));
  assert.ok(h2[0].metric > 13 && h2[0].metric < 16, String(h2[0].metric));
});

test('negative control (H2 artefact): a hung letter is excused only by the hang the typesetter declared, so a paragraph drifting outward is seen', async () => {
  const hang = (c) => `<span class="marxy-hang" style="margin-inline-start:-0.7px">${c}</span>`;
  const hung = blk('p', 0, `${hang('T')}his line starts with a hung capital<br>${hang('V')}alues on the second line do too`);
  for (const shift of [3, 6, 9]) {
    const out = await measure(page(hung.replace('<p ', `<p style="margin-left:-${shift}px" `)), 960);
    const h2 = out.offenders.filter((o) => o.h === 'H2');
    assert.equal(h2.length, 1, `a ${shift}px outward shift was not seen: ${JSON.stringify(out.offenders)}`);
    assert.ok(Math.abs(h2[0].metric) > shift - 1.5, `${shift}px outward read as ${h2[0].metric}`);
  }
});

test('negative control (H5 artefact): trailing spaces in a pre-wrap line are not ink', async () => {
  const code = `<code>let x = 1;${' '.repeat(220)}\nlet y = 2;</code>`;
  const bad = await measure(page(PROSE + blk('pre', 1, code).replace('<pre ', '<pre style="white-space:pre-wrap" ')), 480);
  assert.deepEqual(bad.offenders.filter((o) => o.h === 'H5'), [], JSON.stringify(bad.offenders));
  // Twin: the same line with real text where the spaces were is ink past the window, and is reported.
  const real = await measure(page(PROSE + blk('pre', 1, `<code>let x = 1;${'z'.repeat(220)}</code>`).replace('<pre ', '<pre style="white-space:pre;overflow:visible;max-width:none;width:max-content" ')), 480);
  assert.ok(real.offenders.some((o) => o.h === 'H5'), `real overflow was not reported: ${JSON.stringify(real.offenders)}`);
});

test('negative control (clip): ink inside a scrolling descendant is not ink cut off by the window', async () => {
  const wide = (clip) => blk('div', 1, `<span style="display:block;white-space:nowrap;${clip}">${'x'.repeat(200)}</span>`);
  const ok = await measure(page(PROSE + wide('overflow-x:auto')), 480);
  assert.deepEqual(ok.offenders.filter((o) => o.h === 'H5'), [], JSON.stringify(ok.offenders));
  // Twin: the same line that does not scroll or clip is ink past the window.
  const bad = await measure(page(PROSE + wide('')), 480);
  assert.ok(bad.offenders.some((o) => o.h === 'H5'), JSON.stringify(bad.offenders));
});

/** A set paragraph: the typesetter's class on a nowrap paragraph, as the app leaves it. */
const setP = (inner, i = 2) => `<p class="marxy-set" data-marxy-s="${i * 100}" data-marxy-e="${i * 100 + 99}">${inner}</p>`;
const HYPHEN_CSS = '.marxy-lb.marxy-hyphen::before{content:"-\\A";white-space:pre}';

test('negative control (H4): a set line past its box is reported by the amount it passes; a hung hyphen is not', async () => {
  const over = await measure(page(setP(`<span id="wide">${'x'.repeat(150)}</span>`)), 960);
  const h4 = over.offenders.filter((o) => o.h === 'H4');
  assert.equal(h4.length, 1, JSON.stringify(over.lines));
  // Expected: the text's own right edge minus the paragraph's content right edge, read in the page.
  const p = await browser.newPage({ viewport: { width: 960, height: 900 } });
  let expected;
  try {
    await p.setContent(page(setP(`<span id="wide">${'x'.repeat(150)}</span>`)), { waitUntil: 'load' });
    expected = await p.evaluate(() => {
      const el = document.querySelector('p.marxy-set');
      const cs = getComputedStyle(el);
      return Math.round((document.getElementById('wide').getBoundingClientRect().right - (el.getBoundingClientRect().right - parseFloat(cs.paddingRight))) * 100) / 100;
    });
  } finally {
    await p.close();
  }
  assert.ok(expected > 50, `the control line passes by only ${expected}px`);
  assert.equal(h4[0].metric, expected);

  // The typesetter's hung hyphen: a line filled to the measure, then the generated hyphen past it.
  const fill = '<span style="display:inline-block;width:100%">a line filled to the measure</span>';
  const hung = await measure(page(setP(`${fill}<span class="marxy-lb marxy-hyphen"></span>next`), { extraCss: HYPHEN_CSS }), 960);
  assert.ok(hung.lines.maxHungPastPx > 3, `the hyphen does not hang past the box here (${hung.lines.maxHungPastPx}px): the control proves nothing`);
  assert.deepEqual(hung.offenders.filter((o) => o.h === 'H4'), [], 'a hung hyphen was counted as line overflow');
  assert.equal(hung.lines.overflowing, 0);
  // Twin: the same glyph as ordinary text at the same place is real overflow, of the size the hyphen hung.
  const plain = await measure(page(setP(`${fill}<span>-</span>`), { extraCss: HYPHEN_CSS }), 960);
  const h4plain = plain.offenders.filter((o) => o.h === 'H4');
  assert.equal(h4plain.length, 1, JSON.stringify(plain.lines));
  assert.ok(Math.abs(h4plain[0].metric - hung.lines.maxHungPastPx) < 1, `${h4plain[0].metric} vs ${hung.lines.maxHungPastPx}`);
});

test('negative control (H5): a nested block past the gutter floor is reported at its depth; a block inside it is not', async () => {
  const nested = (style) => blk('blockquote', 1, blk('p', 2, 'quoted text that is pushed out of the page').replace('<p ', `<p style="${style}" `));
  const bad = await measure(page(PROSE + nested('margin-left:-150px')), 480);
  const h5 = bad.offenders.filter((o) => o.h === 'H5');
  assert.equal(h5.length, 1, JSON.stringify(bad.offenders));
  assert.equal(h5[0].depth, 1);
  const b = bad.blocks.find((x) => x[2] === 1);
  const [, , , left] = b;
  assert.equal(h5[0].metric, Math.round((bad.column.gutter - left - 0.5) * 100) / 100);
  assert.ok(h5[0].metric > 20);
  const ok = await measure(page(PROSE + nested('margin-left:0')), 480);
  assert.deepEqual(ok.offenders.filter((o) => o.h === 'H5'), []);
});


test('negative control (H6): a notice region sized at a different font than the article is off the column by what its geometry implies', async () => {
  const bad = await measure(page(PROSE), 960, { notice: true });
  const h6 = bad.offenders.filter((o) => o.h === 'H6' && o.k === 'notice');
  assert.equal(h6.length, 1, JSON.stringify(bad.notice));
  const n = bad.notice;
  assert.ok(Math.abs(h6[0].metric - Math.max(Math.abs(n.boxLeft - bad.column.left), Math.abs(n.boxRight - bad.column.right))) < 0.02);
  assert.ok(h6[0].metric > 20, `notice is only ${h6[0].metric}px off`);
  // The cause is the font basis, not the padding: matching the font puts it on the column, matching the padding does not.
  assert.equal(n.regionFontPx, 16);
  assert.equal(n.articleFontPx, 20);
  assert.ok(Math.abs(n.edgeIfRegionFontMatchedArticle) < 0.5, JSON.stringify(n));
  assert.ok(Math.abs(n.edgeIfRegionPaddingMatchedArticle - n.boxVsColumnL) < 0.5, JSON.stringify(n));
  assert.match(h6[0].why, /sizes its column in em at its own 16px font/);
  // Twin: the article at the browser's 16px font puts the region on the column.
  const ok = await measure(page(PROSE, { extraCss: '.marxy-article{font-size:16px}' }), 960, { notice: true });
  assert.deepEqual(ok.offenders.filter((o) => o.h === 'H6' && o.k === 'notice'), []);
});

test('negative control (centre axis): a classic scrollbar moves the column off the window axis and not off the client axis', async () => {
  const p = await browser.newPage({ viewport: { width: 960, height: 600 } });
  try {
    await p.setContent(page(PROSE + `<div style="height:2400px"></div>`, { extraCss: CLASSIC_CSS }), { waitUntil: 'load' });
    await p.evaluate(() => {
      const el = document.documentElement;
      el.style.overflowY = 'hidden';
      void el.offsetHeight;
      el.style.overflowY = '';
      void el.offsetHeight;
    });
    const c = await p.evaluate(measureInPage, { blocks: false, notice: false });
    assert.equal(c.viewport.scrollbar, 15, 'the classic scrollbar did not take space: the control proves nothing');
    assert.equal(c.centre.offsetFromWindow, -7.5);
    assert.equal(c.centre.offsetFromClient, 0);
    assert.equal(c.centre.clientAxis, (960 - 15) / 2);
    assert.equal(c.centre.windowAxis, 480);
  } finally {
    await p.close();
  }
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

test('two runs over the render entry produce an identical probe.json', { timeout: 900_000 }, async () => {
  const opts = {
    ...DEFAULTS,
    ref: 'origin/main',
    files: ['01-long-technical.md', '05-pathological-table-and-nesting.md'],
    widths: DEFAULTS.widths,
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
