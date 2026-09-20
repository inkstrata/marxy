// Named acceptance cases for MARXY-129: code x-height at the new mono size, heading weight voice,
// and numbered-list marker alignment. Each case is written to fail without the tune or tabular-nums.
import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { after, before, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { onGrid, openPage, renderMarkdown } from './page.mjs';

/** Headings must stay lighter than this effective weight (token is 560). */
export const HEADING_WEIGHT_CEILING = 570;

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

/** Canvas probe: each face at its rendered size (gate-aesthetics check 8 on the shipped pair). */
function xHeightProbe(page) {
  return page.evaluate(() => {
    const article = document.getElementById('doc');
    const p = article.querySelector('p');
    const code = article.querySelector('code');
    const xHeightAt = (el, px) => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const s = getComputedStyle(el);
      ctx.font = `${s.fontStyle} ${s.fontWeight} ${px}px ${s.fontFamily}`;
      const m = ctx.measureText('x');
      return m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
    };
    const bodySize = parseFloat(getComputedStyle(p).fontSize);
    const codeSize = parseFloat(getComputedStyle(code).fontSize);
    const textX = xHeightAt(p, bodySize);
    const monoX = xHeightAt(code, codeSize);
    return { textX, monoX, bodySize, codeSize, ratio: monoX / textX };
  });
}

/** gate-aesthetics check 7 — hierarchy from size and weight only. */
function hierarchyViolations(page) {
  return page.evaluate(() => {
    const article = document.getElementById('doc');
    const articleColor = getComputedStyle(article).color;
    const out = [];
    for (const h of article.querySelectorAll('h1, h2, h3, h4, h5, h6')) {
      const s = getComputedStyle(h);
      if (s.color !== articleColor) out.push(`${h.tagName} color ${s.color} ≠ article ${articleColor}`);
      for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
        if (parseFloat(s[`border${side}Width`]) > 0 && s[`border${side}Style`] !== 'none') out.push(`${h.tagName} has a border`);
      }
      if (s.backgroundColor !== 'rgba(0, 0, 0, 0)' && s.backgroundColor !== 'transparent' && s.backgroundImage !== 'none') {
        const articleBg = getComputedStyle(article).backgroundColor;
        if (s.backgroundColor !== articleBg) out.push(`${h.tagName} background ${s.backgroundColor}`);
      }
    }
    return out;
  });
}

test('code voice: mono and text x-heights match within 5% at --marxy-size-code and the code line box is on the grid', async () => {
  const html = renderMarkdown('Body with `inline code` in the sentence.\n');
  const page = await openPage(browser, html);
  const tokens = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const article = document.getElementById('doc');
    const unit = parseFloat(getComputedStyle(article).lineHeight) / 2;
    const codeSize = parseFloat(root.getPropertyValue('--marxy-size-code'));
    const codeBox = parseFloat(root.getPropertyValue('--marxy-line-box-code'));
    return { codeSize, codeBox, unit };
  });
  assert.ok(tokens.codeSize > 14, `--marxy-size-code is still ${tokens.codeSize}px; the tune should raise it`);
  assert.ok(onGrid(tokens.codeBox, tokens.unit), `code line box ${tokens.codeBox}px is not a whole grid unit (${tokens.unit}px)`);
  const { textX, monoX, codeSize, ratio } = await xHeightProbe(page);
  assert.ok(codeSize >= tokens.codeSize - 0.5, `inline code renders at ${codeSize}px, expected ≥ ${tokens.codeSize}px`);
  assert.ok(textX > 0 && monoX > 0, 'x-height probe returned zero');
  assert.ok(Math.abs(ratio - 1) <= 0.05, `x-height ratio ${(ratio * 100).toFixed(1)}% outside 5% (body vs code at ${codeSize}px)`);
  await page.close();
});

test('heading voice: every level is below the weight ceiling, ≥120 above body, hierarchy is size/weight only', async () => {
  const html = renderMarkdown(`Lead.

# One
## Two
### Three
#### Four
##### Five
###### Six
`);
  const page = await openPage(browser, html);
  const bodyWeight = await page.evaluate(() => Number(getComputedStyle(document.querySelector('p')).fontWeight));
  const headings = await page.evaluate(() =>
    [...document.querySelectorAll('h1, h2, h3, h4, h5, h6')].map((h) => ({
      tag: h.tagName,
      weight: Number(getComputedStyle(h).fontWeight),
      size: parseFloat(getComputedStyle(h).fontSize),
    })),
  );
  assert.deepEqual(await hierarchyViolations(page), []);
  for (const h of headings) {
    assert.ok(h.weight <= HEADING_WEIGHT_CEILING, `${h.tag} weight ${h.weight} exceeds ceiling ${HEADING_WEIGHT_CEILING}`);
    assert.ok(h.weight - bodyWeight >= 120, `${h.tag} weight ${h.weight} is not 120 above body ${bodyWeight}`);
  }
  const sizes = headings.map((h) => h.size);
  assert.ok(sizes[0] > sizes[1] && sizes[1] > sizes[2], 'h1–h3 sizes must step down');
  await page.close();
});

test('numbered lists: one- and two-digit markers share a right edge with tabular figures in the secondary colour', async () => {
  const html = renderMarkdown(`1. first item
2. second
9. ninth
10. tenth
`);
  const page = await openPage(browser, html);
  const measured = await page.evaluate(() => {
    const items = [...document.querySelectorAll('ol > li')];
    const textLeft = (li) => {
      const range = document.createRange();
      const node = [...li.childNodes].find((n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim()) ?? li;
      range.selectNodeContents(node);
      range.collapse(true);
      return range.getBoundingClientRect().left;
    };
    const nums = items.map((li, i) => ({
      index: i + 1,
      textLeft: textLeft(li),
      color: getComputedStyle(li, '::before').color,
      variant: getComputedStyle(li, '::before').fontVariantNumeric,
    }));
    return { nums };
  });
  assert.equal(measured.nums.length, 4);
  for (const row of measured.nums) {
    assert.match(row.variant, /tabular-nums/, `item ${row.index}: font-variant-numeric is ${row.variant}`);
    assert.ok(row.color.includes('rgb'), `item ${row.index}: marker colour did not resolve`);
  }
  const oneDigit = measured.nums[0];
  const twoDigit = measured.nums[3];
  assert.ok(
    Math.abs(oneDigit.textLeft - twoDigit.textLeft) <= 0.5,
    `list text starts at ${oneDigit.textLeft} vs ${twoDigit.textLeft}; marker right edges are not aligned`,
  );
  await page.close();
});

test('numbered lists: proportional figures break alignment (tabular-nums is load-bearing)', async () => {
  const html = renderMarkdown('1. one\n10. ten\n');
  const page = await openPage(browser, html, {
    extraCss:
      '.marxy-article>ol>li::before{font-variant-numeric:normal!important;width:auto!important;' +
      'margin-inline:0!important;text-align:start!important;display:inline!important}',
  });
  const delta = await page.evaluate(() => {
    const items = [...document.querySelectorAll('ol > li')];
    const textLeft = (li) => {
      const range = document.createRange();
      const node = [...li.childNodes].find((n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim()) ?? li;
      range.selectNodeContents(node);
      range.collapse(true);
      return range.getBoundingClientRect().left;
    };
    return Math.abs(textLeft(items[0]) - textLeft(items[1]));
  });
  assert.ok(delta > 0.5, `proportional marker figures still aligned within 0.5px (delta ${delta})`);
  await page.close();
});
