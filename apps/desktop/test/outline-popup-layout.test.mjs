// F-101: the outline popup (view.outline, Shift+Cmd+O) in an unfolded window. What the reader sees: every row is on screen,
// above the docked inspector and below the toolbar, tab row and strip; the list scrolls inside the popup; the page does not move.
import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { after, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { bootTwoPanes, closeHarness } from './support/two-pane.mjs';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);
after(() => closeHarness());

const para = (i) => `Paragraph ${i} runs long enough to be a paragraph of the reading column and no more than that.`;
const filler = (n, from = 0) => Array.from({ length: n }, (_, i) => para(from + i)).join('\n\n');
const ELEVEN = Array.from({ length: 11 }, (_, i) => `${i === 0 ? '#' : '##'} Heading number ${i + 1}\n\n${filler(8, i * 10)}\n`).join('\n');
// Eleven rows fit a 600 px window under the bands (about 30 px each), so the scrolling case has forty.
const FORTY = Array.from({ length: 40 }, (_, i) => `${i === 0 ? '#' : '##'} Heading number ${i + 1}\n\n${para(i)}\n`).join('\n');
const files = { '/r/Eleven.md': ELEVEN, '/r/Forty.md': FORTY };

async function withPopup({ width, height, open = '/r/Eleven.md' }, fn) {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width, height } });
    await bootTwoPanes(page, { files, open: [open] });
    await page.evaluate(() => window.__marxyHandle.workspace().unfold());
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const articleLeft = () => page.evaluate(() => document.getElementById('doc').getBoundingClientRect().left);
    const before = await articleLeft();
    await page.evaluate(async () => {
      const { commands } = await import('/src/commands/index.ts');
      await commands().find((c) => c.id === 'view.outline').run();
    });
    await page.waitForSelector('#marxy-outline[open]');
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    await fn(page, { before, articleLeft });
  } finally {
    await browser.close();
  }
}

/** For each row index: inside the window, topmost at its centre, and clear of the bands. */
const probe = (page) => page.evaluate(() => {
  const rect = (el) => el.getBoundingClientRect();
  const bands = ['toolbar', 'tabs', 'strip']
    .map((r) => document.querySelector(`[data-marxy-workspace-region="${r}"]:not([hidden])`)).filter(Boolean);
  const inspector = document.querySelector('[data-marxy-workspace-region="inspector"]:not([hidden])');
  const dialog = document.getElementById('marxy-outline');
  const dr = rect(dialog);
  const rows = [...dialog.querySelectorAll('.marxy-outline-row')];
  const list = dialog.querySelector('.marxy-outline-list');
  const lr = rect(list);
  const cross = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  const visible = rows.map((row) => {
    const r = rect(row);
    const inList = r.top >= lr.top - 0.5 && r.bottom <= lr.bottom + 0.5;
    const cx = r.left + r.width / 2; const cy = r.top + r.height / 2;
    const top = document.elementFromPoint(cx, cy);
    return { text: row.textContent, inList, top: !!top && (top === row || row.contains(top) || top.contains(row)) };
  });
  return {
    inWindow: dr.top >= 0 && dr.left >= 0 && dr.bottom <= innerHeight + 0.5 && dr.right <= innerWidth + 0.5,
    hitsBand: bands.some((b) => cross(dr, rect(b))),
    inspectorDocked: !!inspector,
    popupAboveInspector: inspector ? (() => { const x = Math.max(dr.left, rect(inspector).left) + 4; const y = dr.top + dr.height / 2; const el = document.elementFromPoint(x, y); return !!el && dialog.contains(el); })() : null,
    listScrolls: list.scrollHeight > list.clientHeight,
    rows: visible,
    scrollable: lr.height,
  };
});

for (const [width, height] of [[1400, 900], [1920, 900], [1400, 600], [1920, 600]]) {
  test(`F-101: the popup's first row is on screen and topmost at ${width} x ${height}; the page does not move`, async () => {
    await withPopup({ width, height }, async (page, { before, articleLeft }) => {
      const p = await probe(page);
      assert.equal(p.inspectorDocked, width >= 1600, 'the inspector docks by default from 1,600 px');
      assert.equal(p.inWindow, true, 'the popup is inside the window');
      assert.equal(p.hitsBand, false, 'the popup does not meet the toolbar, the tab row or the strip');
      if (p.inspectorDocked) assert.equal(p.popupAboveInspector, true, 'the popup is above the inspector');
      assert.equal(p.rows[0].inList, true, 'the first row is inside the list box');
      assert.equal(p.rows[0].top, true, 'the first row is the topmost element at its centre');
      assert.equal(await articleLeft(), before, 'the article has not moved (0 px)');
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.getElementById('marxy-outline')?.hasAttribute('open'));
      assert.equal(await articleLeft(), before, 'and has not moved when the popup closes');
    });
  });
}

test('F-101: all 11 rows are whole and topmost at 1920 x 900', async () => {
  await withPopup({ width: 1920, height: 900 }, async (page) => {
    const p = await probe(page);
    assert.equal(p.rows.length, 11);
    assert.deepEqual(p.rows.filter((r) => !(r.inList && r.top)).map((r) => r.text), []);
  });
});

test('F-101: at 600 px tall the list scrolls inside the popup and the last row can be reached', async () => {
  await withPopup({ width: 1920, height: 600, open: '/r/Forty.md' }, async (page) => {
    const p = await probe(page);
    assert.equal(p.rows.length, 40);
    assert.equal(p.listScrolls, true, '40 rows do not fit 600 px, so the list scrolls');
    await page.evaluate(() => { const l = document.querySelector('#marxy-outline .marxy-outline-list'); l.scrollTop = l.scrollHeight; });
    const after = await probe(page);
    assert.equal(after.rows[39].inList && after.rows[39].top, true, 'the last row is whole and topmost once scrolled to');
  });
});
