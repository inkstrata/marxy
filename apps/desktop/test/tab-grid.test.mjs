// the tab row keeps every tab on one grid. Twelve tabs of long names in the unfolded window, the real app on the
// shipped skeleton and CSS in WebKit. A close button never touches its neighbour; its slot is the same width on every tab
// whether or not it shows; hovering or activating moves no other tab's left edge; heights, gaps and vertical centres agree;
// and every tab stands on the row's rule. The window has one row (frame/tab-row.ts); these measure it.
// Its full name is the tab's own title now, so the old row's delayed reveal and its tests went.
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

const NAMES = [
  '05-performance-budgets', '06-feature-command-palette', '08-feature-text-operations', '12-recommendations-and-risks',
  '13-recommendations-follow-up', '07-feature-split-viewing', '04-tests-and-gates', '02-orchestration-notes',
  '00-executive-summary', '03-flexible-layout', '01-code-reading', '09-inspector-and-outline',
];
const paths = NAMES.map((n) => `/audit/${n}.md`);
const files = Object.fromEntries(paths.map((p, i) => [p, `# Heading ${i}\n\nThe first line of the document ${i} is long enough to matter to a reader and to a tooltip.\n`]));

async function withRow(fn, { width = 1280, height = 900, only = paths, store = files } = {}) {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width, height } });
    await bootTwoPanes(page, { files: store, open: [only[0]] });
    await page.evaluate(() => window.__marxyHandle.frame().unfold());
    for (const p of only.slice(1)) {
      await page.evaluate((p) => window.__marxyHandle.open(p), p);
      await page.evaluate(() => new Promise((r) => setTimeout(r, 40)));
    }
    await page.evaluate(() => new Promise((r) => setTimeout(r, 200)));
    await fn(page);
  } finally {
    await browser.close();
  }
}

/** Every tab's boxes, and the row's, as drawn. */
const measure = (page) =>
  page.evaluate(() => {
    const box = (el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height, mid: (r.top + r.bottom) / 2 };
    };
    const head = document.querySelector('.marxy-tabbar');
    const region = head.querySelector('.marxy-tabs');
    return {
      region: box(head),
      tabs: [...region.querySelectorAll('.marxy-tab')].map((t) => {
        const glyph = t.querySelector('.marxy-tab-open svg');
        const text = document.createRange();
        text.selectNodeContents(t.querySelector('.marxy-tab-name'));
        const tr = text.getBoundingClientRect();
        return {
          path: t.title.split('\n')[0],
          x: t.offsetLeft,
          tab: box(t),
          open: box(t.querySelector('.marxy-tab-open')),
          close: box(t.querySelector('.marxy-tab-close')),
          glyph: glyph ? box(glyph) : null,
          label: { mid: (tr.top + tr.bottom) / 2 },
        };
      }),
    };
  });

const tabOpen = (path) => `.marxy-tabbar .marxy-tab[title^="${path}"] .marxy-tab-open`;
const hover = (page, path) => page.hover(tabOpen(path));
/** Left edges within the row's content (the row's own scroll is not a move). */
const lefts = async (page) => (await measure(page)).tabs.map((t) => t.x);

test('no close button touches its neighbour, and every close slot is one width', async () => {
  await withRow(async (page) => {
    for (const hovered of [null, paths[2], paths[5]]) {
      if (hovered) await hover(page, hovered);
      else await page.mouse.move(5, 400);
      const m = await measure(page);
      for (let i = 0; i < m.tabs.length; i++) {
        const t = m.tabs[i];
        for (let j = 0; j < m.tabs.length; j++) {
          if (i === j) continue;
          const o = m.tabs[j];
          for (const [what, b] of [['tab', o.tab], ['icon', o.glyph], ['close', o.close]]) {
            if (!b) continue;
            const apart = t.close.right <= b.left + 0.01 || t.close.left >= b.right - 0.01;
            assert.ok(apart, `hovering ${hovered}: ${t.path} close [${t.close.left}, ${t.close.right}] meets ${o.path} ${what} [${b.left}, ${b.right}]`);
          }
        }
        assert.ok(t.close.right <= t.tab.right + 0.01, `${t.path}: close inside its own tab`);
        assert.ok(t.close.width >= 16 && t.close.height >= 16, `${t.path}: close is ${t.close.width} x ${t.close.height}, too small to hit and to keep clear`);
        // The mark has air to the next tab's icon: at least 8 px from the close's box to it, and the close sits off the tab's edge.
        const next = m.tabs[i + 1];
        if (next?.glyph) assert.ok(next.glyph.left - t.close.right >= 8, `${t.path}: close ends ${next.glyph.left - t.close.right}px from ${next.path}'s icon`);
        assert.ok(t.tab.right - t.close.right >= 4, `${t.path}: close sits ${t.tab.right - t.close.right}px from its tab's edge`);
      }
      const widths = new Set(m.tabs.map((t) => Math.round(t.close.width * 100)));
      assert.equal(widths.size, 1, `hovering ${hovered}: close slots differ in width: ${[...widths]}`);
    }
  });
});

test('hovering or activating a tab moves no other tab\'s left edge', async () => {
  await withRow(async (page) => {
    await page.mouse.move(5, 400);
    const rest = await lefts(page);
    for (let i = 0; i < paths.length; i++) {
      await hover(page, paths[i]);
      await page.evaluate(() => new Promise((r) => setTimeout(r, 60)));
      const now = await lefts(page);
      for (let j = 0; j < now.length; j++) assert.ok(Math.abs(now[j] - rest[j]) < 0.01, `hovering ${paths[i]} moved tab ${j} by ${now[j] - rest[j]}px`);
    }
    // Activating: the active tab's own weight must not move its neighbours either.
    await page.mouse.move(5, 400);
    for (const p of [paths[0], paths[6], paths[11]]) {
      await page.evaluate((p) => window.__marxyHandle.open(p), p);
      await page.evaluate(() => new Promise((r) => setTimeout(r, 120)));
      await page.mouse.move(5, 400);
      const now = await lefts(page);
      for (let j = 0; j < now.length; j++) assert.ok(Math.abs(now[j] - rest[j]) < 0.01, `activating ${p} moved tab ${j} by ${now[j] - rest[j]}px`);
    }
  });
});

test('one grid: equal heights and gaps, one vertical centre, every tab standing on the row\'s rule', async () => {
  await withRow(async (page) => {
    await hover(page, paths[3]);
    const m = await measure(page);
    const heights = new Set(m.tabs.map((t) => Math.round(t.tab.height * 100)));
    assert.equal(heights.size, 1, `tab heights differ: ${[...heights]}`);
    const gaps = m.tabs.slice(1).map((t, i) => Math.round((t.tab.left - m.tabs[i].tab.right) * 100) / 100);
    assert.equal(new Set(gaps).size, 1, `gaps differ: ${gaps}`);
    for (const t of m.tabs) {
      const mids = [t.label.mid, t.close.mid, t.tab.mid, ...(t.glyph ? [t.glyph.mid] : [])];
      assert.ok(Math.max(...mids) - Math.min(...mids) <= 1, `${t.path}: label, icon, close and tab centres differ: ${mids}`);
    }
    // The tabs stand on the row's bottom rule, as a browser's do (frame.css, the row's tabs fill its height).
    for (const t of m.tabs) assert.ok(Math.abs(t.tab.bottom - m.region.bottom) <= 1, `${t.path}: the tab stands on the rule (${t.tab.bottom} against ${m.region.bottom})`);
  });
});

test('activating a tab whose name is short and whole moves no other tab either (the heavier face holds its width)', async () => {
  const short = ['/s/Alpha.md', '/s/Bravo Tango.md', '/s/Charlie.md', '/s/Delta.md'];
  const store = Object.fromEntries(short.map((p) => [p, '# T\n\nbody\n']));
  await withRow(async (page) => {
    await page.mouse.move(5, 400);
    const rest = await lefts(page);
    const widths = (await measure(page)).tabs.map((t) => t.tab.width);
    // Under the tab's 220px ceiling: a tab now keeps room for its dirty dot, so these are a little wider than they were.
    assert.ok(widths.every((w) => w < 220), 'the names fit whole');
    for (const p of short) {
      await page.evaluate((p) => window.__marxyHandle.open(p), p);
      await page.evaluate(() => new Promise((r) => setTimeout(r, 120)));
      const now = await lefts(page);
      for (let j = 0; j < now.length; j++) assert.ok(Math.abs(now[j] - rest[j]) < 0.01, `activating ${p} moved tab ${j} by ${now[j] - rest[j]}px`);
    }
  }, { only: short, store });
});

