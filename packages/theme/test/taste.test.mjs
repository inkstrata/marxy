// Named cases for the six taste-review #1 faults (MARXY-128). Each case is written to fail on the
// pre-tune stylesheet and to stay green after the corresponding rule in base.css.
import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { after, before, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { contrast, onGrid, openPage, renderCorpus, renderMarkdown } from './page.mjs';

const skip =
  !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
    ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
    : false;
const test = (name, fn) => nodeTest(name, { skip }, fn);

let browser;
before(async () => {
  if (!skip) browser = await launchWebkit();
});
after(async () => {
  await browser?.close();
});

test('heading space belongs to what follows: above is at least twice below, both on the grid unit', async () => {
  // A lead paragraph so h1 is not :first-child (that rule zeroes the top margin).
  const html = renderMarkdown(`A lead so the title is not first.

# Title
Bound to this.

## Section
Bound to this.

### Sub
Bound to this.

#### Leaf
Bound to this.
`);
  const page = await openPage(browser, html);
  const gaps = await page.evaluate(() => {
    const article = document.getElementById('doc');
    const unit = parseFloat(getComputedStyle(article).lineHeight) / 2;
    return ['h1', 'h2', 'h3', 'h4'].map((tag) => {
      const el = article.querySelector(tag);
      const s = getComputedStyle(el);
      return {
        tag,
        above: parseFloat(s.marginTop),
        below: parseFloat(s.marginBottom),
        unit,
      };
    });
  });
  for (const g of gaps) {
    assert.ok(g.above + 0.5 >= 2 * g.below, `${g.tag}: ${g.above} above is not twice ${g.below} below`);
    assert.ok(onGrid(g.above, g.unit), `${g.tag}: space above ${g.above} is not a whole grid unit (${g.unit})`);
    assert.ok(onGrid(g.below, g.unit), `${g.tag}: space below ${g.below} is not a whole grid unit (${g.unit})`);
    assert.ok(g.above - g.below > 0.5, `${g.tag}: margins are symmetric (${g.above}/${g.below})`);
  }
  await page.close();
});

test('italic and strike read at body size: real Literata italic, no synthesis, strike has thickness and offset', async () => {
  const html = renderMarkdown('A line with *italic*, _also italic_, and ~~struck~~ text.\n');
  const page = await openPage(browser, html);
  const measured = await page.evaluate(async () => {
    const em = document.querySelector('em');
    const i = document.querySelector('i') ?? em;
    const del = document.querySelector('del, s');
    const emStyle = getComputedStyle(em);
    const iStyle = getComputedStyle(i);
    const delStyle = getComputedStyle(del);
    const italicReady = await document.fonts.ready.then(() => document.fonts.check('italic 17px Literata'));
    return {
      emSynthesis: emStyle.fontSynthesis,
      iSynthesis: iStyle.fontSynthesis,
      emStyle: emStyle.fontStyle,
      iStyle: iStyle.fontStyle,
      emFamily: emStyle.fontFamily,
      italicReady,
      thickness: delStyle.textDecorationThickness,
      offset: delStyle.textUnderlineOffset,
    };
  });
  assert.match(measured.emSynthesis, /none/, `em font-synthesis is ${measured.emSynthesis}; a synthetic slant is what review #1 called weak`);
  assert.match(measured.iSynthesis, /none/, `i font-synthesis is ${measured.iSynthesis}`);
  assert.equal(measured.emStyle, 'italic');
  assert.equal(measured.iStyle, 'italic');
  assert.match(measured.emFamily, /Literata/);
  assert.equal(measured.italicReady, true, 'Literata italic did not resolve; the engine would synthesise a slant');
  const thickness = parseFloat(measured.thickness);
  const offset = parseFloat(measured.offset);
  assert.ok(thickness >= 1, `strike thickness ${measured.thickness} is weaker than 1px`);
  assert.ok(offset > 0, `strike offset ${measured.offset} is missing; the line sits on the letters`);
  await page.close();
});

test('code blocks: padding is a whole grid unit on all four sides and the first line sits on the grid', async () => {
  const html = renderMarkdown('Intro.\n\n```\nfirst line\nsecond line\n```\n');
  const page = await openPage(browser, html, { snap: false });
  const padding = await page.evaluate(() => {
    const article = document.getElementById('doc');
    const unit = parseFloat(getComputedStyle(article).lineHeight) / 2;
    const s = getComputedStyle(article.querySelector('pre'));
    return { unit, padding: ['Top', 'Right', 'Bottom', 'Left'].map((side) => parseFloat(s[`padding${side}`])) };
  });
  await page.evaluate(() => {
    const article = document.getElementById('doc');
    window.snapToGrid(article, parseFloat(getComputedStyle(article).lineHeight));
  });
  const box = {
    ...padding,
    firstLineTop: await page.evaluate(() => {
      const article = document.getElementById('doc');
      const origin = article.getBoundingClientRect().top;
      const pre = article.querySelector('pre');
      const s = getComputedStyle(pre);
      return pre.getBoundingClientRect().top + parseFloat(s.paddingTop) - origin;
    }),
  };
  for (const [i, side] of ['top', 'right', 'bottom', 'left'].entries()) {
    assert.ok(
      onGrid(box.padding[i], box.unit) && box.padding[i] >= box.unit - 0.5,
      `pre padding-${side} ${box.padding[i]} is not a whole grid unit (${box.unit})`,
    );
  }
  const r = ((box.firstLineTop % box.unit) + box.unit) % box.unit;
  assert.ok(r <= 0.5 || box.unit - r <= 0.5, `first code line top ${box.firstLineTop.toFixed(2)} is off the grid (unit ${box.unit})`);
  await page.close();
});

test('quotations: the rule is at least 2px and contrasts 3:1 against the page in both variants', async () => {
  const html = renderMarkdown('> A quoted line.\n');
  for (const variant of ['dark', 'light']) {
    const page = await openPage(browser, html, { variant });
    const measured = await page.evaluate(() => {
      const rgb = (value) => {
        const probe = document.createElement('i');
        probe.style.color = value;
        document.body.append(probe);
        const computed = getComputedStyle(probe).color;
        probe.remove();
        const nums = computed.match(/[\d.]+/g).map(Number);
        if (computed.startsWith('color(') && nums[0] <= 1) return nums.slice(0, 3).map((n) => n * 255);
        return nums.slice(0, 3);
      };
      const quote = document.querySelector('blockquote');
      const article = document.getElementById('doc');
      const s = getComputedStyle(quote);
      return {
        width: parseFloat(s.borderInlineStartWidth),
        rule: rgb(s.borderInlineStartColor),
        bg: rgb(getComputedStyle(article).backgroundColor),
      };
    });
    assert.ok(measured.width >= 2, `${variant}: quote rule is ${measured.width}px, need ≥ 2`);
    const ratio = contrast(measured.rule, measured.bg);
    assert.ok(ratio >= 3, `${variant}: quote rule contrast ${ratio.toFixed(2)}:1 is under 3:1`);
    await page.close();
  }
});

test('task lists: the checkbox top aligns with its first line box, including under a bullet', async () => {
  const html = renderMarkdown(`- [x] checked item
- [ ] unchecked item
- a bullet
  - [ ] nested under a bullet
`);
  const page = await openPage(browser, html);
  const rows = await page.evaluate(() => {
    const article = document.getElementById('doc');
    return [...article.querySelectorAll('input[type="checkbox"]')].map((box) => {
      const item = box.closest('li');
      const line = item.getBoundingClientRect();
      const check = box.getBoundingClientRect();
      const align = getComputedStyle(box).verticalAlign;
      return { topDelta: check.top - line.top, align, text: item.textContent.trim() };
    });
  });
  assert.equal(rows.length, 3, `expected checked, unchecked, nested; got ${rows.length}`);
  for (const row of rows) {
    assert.ok(row.align !== 'baseline' && row.align !== 'auto', `${row.text}: vertical-align is ${row.align}; removing it drops the box to the baseline`);
    assert.ok(Math.abs(row.topDelta) <= 0.5, `${row.text}: checkbox top is ${row.topDelta.toFixed(2)}px from the line box top`);
  }
  await page.close();
});

test('tables: a wrapped cell uses the code line box and one grid unit of vertical padding', async () => {
  const page = await openPage(browser, renderCorpus('03-ai-plan.md'));
  const measured = await page.evaluate(() => {
    const article = document.getElementById('doc');
    const unit = parseFloat(getComputedStyle(article).lineHeight) / 2;
    const codeBox = parseFloat(getComputedStyle(article).getPropertyValue('--marxy-line-box-code'));
    const cell = [...article.querySelectorAll('td')].find((td) => {
      const range = document.createRange();
      range.selectNodeContents(td);
      const tops = new Set([...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top)));
      return tops.size > 1;
    });
    if (!cell) return { wrapped: false };
    const s = getComputedStyle(cell);
    return {
      wrapped: true,
      lineHeight: parseFloat(s.lineHeight),
      padTop: parseFloat(s.paddingTop),
      padBottom: parseFloat(s.paddingBottom),
      codeBox,
      unit,
    };
  });
  assert.equal(measured.wrapped, true, '03-ai-plan.md has no wrapped cell at 960px; the scuffed-table case cannot run');
  assert.ok(Math.abs(measured.lineHeight - measured.codeBox) <= 0.5, `wrapped cell line box ${measured.lineHeight} ≠ code line box ${measured.codeBox}`);
  assert.ok(onGrid(measured.padTop, measured.unit) && measured.padTop >= measured.unit - 0.5, `padding-top ${measured.padTop} is not one grid unit`);
  assert.ok(onGrid(measured.padBottom, measured.unit) && measured.padBottom >= measured.unit - 0.5, `padding-bottom ${measured.padBottom} is not one grid unit`);
  await page.close();
});
