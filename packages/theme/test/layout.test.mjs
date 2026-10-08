// MARXY-263: the article opens near the top of the window instead of reading as vertically
// centered, and its side gutter is a measure-derived remainder with a floor rather than a flat
// 3rem — Reader Typography ch.4 "Margins" ("these pages keep at least 16px on phones and 24px
// on larger screens"). Rendered over the corpus with Playwright WebKit, same page shape as
// grid.test.mjs (docs/design/10-gates-and-testing.md).

import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { after, before, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { openPage, renderCorpus, renderMarkdown } from './page.mjs';

const skip =
  !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
    ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
    : false;
const test = (name, fn) => nodeTest(name, { skip }, fn);

const CORPUS = ['01-long-technical.md', '02-readme-real-world.md', '14-marxy-plan.md'];

let browser;
before(async () => {
  if (!skip) browser = await launchWebkit();
});
after(async () => {
  await browser?.close();
});

test('the first line sits close to the top of the window at several viewport heights', async () => {
  const html = renderCorpus('01-long-technical.md');
  for (const height of [600, 900, 1400]) {
    const page = await openPage(browser, html, { height });
    const gap = await page.evaluate(() => document.getElementById('doc').firstElementChild.getBoundingClientRect().top);
    // Not a fraction of the viewport (which is what "looks vertically centered" would mean): a
    // fixed, small distance regardless of how tall the window is.
    assert.ok(gap < 20, `first block starts ${gap}px from the top at ${height}px tall (expected a small, fixed gap)`);
    assert.ok(gap < height * 0.05, `first block at ${gap}px reads as centered in a ${height}px window`);
    await page.close();
  }
});

test('the article top padding is one grid unit (half the line box), not three line boxes', async () => {
  const page = await openPage(browser, renderCorpus('01-long-technical.md'));
  const { paddingTop, half } = await page.evaluate(() => {
    const article = document.getElementById('doc');
    return { paddingTop: parseFloat(getComputedStyle(article).paddingTop), half: parseFloat(getComputedStyle(article).lineHeight) / 2 };
  });
  assert.equal(paddingTop, half);
  await page.close();
});

test('the side gutter never collapses below the minimum: 16px under 30em, 24px at or above it', async () => {
  const html = renderCorpus('01-long-technical.md');
  const cases = [
    [320, 16],
    [479, 16],
    [480, 24],
    [960, 24],
    [1920, 24],
  ];
  for (const [width, expected] of cases) {
    const page = await openPage(browser, html, { width });
    const paddingLeft = await page.evaluate(() => parseFloat(getComputedStyle(document.getElementById('doc')).paddingLeft));
    assert.equal(paddingLeft, expected, `gutter ${paddingLeft}px at ${width}px wide, expected ${expected}px`);
    await page.close();
  }
});

test('at every gutter width, content still centers on the measure', async () => {
  const html = renderCorpus('02-readme-real-world.md');
  for (const width of [320, 600, 960, 1280, 1920]) {
    const page = await openPage(browser, html, { width });
    const { left, right } = await page.evaluate(() => {
      const r = document.getElementById('doc').getBoundingClientRect();
      return { left: r.left, right: window.innerWidth - r.right };
    });
    assert.ok(Math.abs(left - right) < 1, `article is not centered at ${width}px: left ${left}, right ${right}`);
    await page.close();
  }
});

test('a narrow window never lets the gutter shrink to zero or overflow the viewport', async () => {
  for (const file of CORPUS) {
    const page = await openPage(browser, renderCorpus(file), { width: 320 });
    const { paddingLeft, scrollWidth, clientWidth } = await page.evaluate(() => {
      const article = document.getElementById('doc');
      return {
        paddingLeft: parseFloat(getComputedStyle(article).paddingLeft),
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      };
    });
    assert.equal(paddingLeft, 16, `${file}: gutter ${paddingLeft}px at 320px wide`);
    assert.ok(scrollWidth <= clientWidth + 1, `${file}: the page scrolls sideways at 320px (${scrollWidth} > ${clientWidth})`);
    await page.close();
  }
});

// L-03: a mark hangs into the margin only as far as there is room, so it never crosses the gutter's
// floor (Reader Typography ch.4 "Margins": a minimum gutter of 16px on phones and 24px above). Where
// the room holds the whole hang, the markers still hang fully and the item text keeps the prose edge.
const LISTS = '- a bullet item\n- another\n\n1. first item\n2. second\n\n- [ ] an open task\n- [x] a done task\n';

/** Where the marks and the item text sit: measured as the layout probe measures them (scripts/probe-layout.mjs). */
function measureMarks() {
  const article = document.getElementById('doc');
  const cs = getComputedStyle(article);
  const colL = article.getBoundingClientRect().left + parseFloat(cs.paddingLeft);
  const firstText = (li) => {
    const walker = document.createTreeWalker(li, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.nodeValue.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      return range.getClientRects()[0].left;
    }
    return null;
  };
  const lists = [...article.children].filter((el) => el.tagName === 'UL' || el.tagName === 'OL');
  const ol = lists.find((el) => el.tagName === 'OL').querySelector('li');
  const before = getComputedStyle(ol, '::before');
  const olMarker = ol.getBoundingClientRect().left + parseFloat(getComputedStyle(ol).paddingLeft) + parseFloat(before.marginInlineStart);
  const bullet = lists[0].querySelector('li');
  return {
    colL,
    gutter: parseFloat(cs.paddingLeft),
    em: parseFloat(cs.fontSize),
    olMarker,
    olMarkerWidth: parseFloat(before.width),
    olText: firstText(ol),
    bulletText: firstText(bullet),
    checkboxes: [...article.querySelectorAll('input[type="checkbox"]')].map((cb) => cb.getBoundingClientRect().left),
  };
}

test('at 320px with 28px type, list markers and checkboxes stay inside the gutter floor (L-03)', async () => {
  const page = await openPage(browser, renderMarkdown(LISTS), { width: 320, extraCss: ':root { --marxy-size-body: 28px; }' });
  const m = await page.evaluate(measureMarks);
  await page.close();
  assert.equal(m.gutter, 16);
  assert.ok(m.olMarker >= 16 - 0.5, `the ordered-list marker starts at ${m.olMarker}px, left of the 16px gutter floor`);
  assert.equal(m.checkboxes.length, 2);
  for (const left of m.checkboxes) assert.ok(left >= 16 - 0.5, `a checkbox starts at ${left}px, left of the 16px gutter floor`);
  // A bullet's ink hangs at most 1.25em (measured: 1.04 to 1.19em at 16 to 28px type), so its text sits that far in.
  assert.ok(m.bulletText - 1.25 * m.em >= 16 - 0.5, `a bullet's text starts at ${m.bulletText}px: its bullet could cross the floor`);
});

test('at 1280px the markers still hang fully: item text on the column edge, the marker 2.25em left of it (L-03)', async () => {
  const page = await openPage(browser, renderMarkdown(LISTS), { width: 1280 });
  const m = await page.evaluate(measureMarks);
  await page.close();
  assert.ok(Math.abs(m.olText - m.colL) <= 1, `item 1's text starts ${m.olText - m.colL}px from the column edge`);
  assert.ok(Math.abs(m.bulletText - m.colL) <= 1, `a bullet item's text starts ${m.bulletText - m.colL}px from the column edge`);
  assert.equal(m.olMarkerWidth, 2.25 * m.em);
  assert.ok(Math.abs(m.colL - m.olMarker - 2.25 * m.em) <= 0.5, `the marker hangs ${m.colL - m.olMarker}px, not 2.25em (${2.25 * m.em}px)`);
  for (const left of m.checkboxes) assert.ok(left < m.colL, `a checkbox at ${left}px does not hang left of the column (${m.colL}px)`);
});
