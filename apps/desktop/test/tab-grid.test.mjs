// F-99: the tab row keeps every tab on one grid. Twelve tabs of long names in the unfolded window, the real app on the
// shipped skeleton and CSS in WebKit. A close button never touches its neighbour; its slot is the same width on every tab
// whether or not it shows; hovering or activating moves no other tab's left edge; heights, gaps and vertical centres agree;
// the row is centred between its rules; and the full-name reveal never lands over the document's first line.
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
    await page.evaluate(() => window.__marxyHandle.workspace().unfold());
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
    const region = document.querySelector('[data-marxy-workspace-region="tabs"]');
    const toolbar = document.querySelector('[data-marxy-workspace-region="toolbar"]');
    return {
      region: box(region),
      toolbarBottom: toolbar.getBoundingClientRect().bottom,
      tabs: [...region.querySelectorAll('.marxy-tab')].map((t) => {
        const glyph = t.querySelector('svg');
        const text = document.createRange();
        text.selectNodeContents(t.querySelector('.marxy-tab-name'));
        const tr = text.getBoundingClientRect();
        return {
          path: t.getAttribute('data-marxy-tab'),
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

const hover = (page, path) => page.hover(`[data-marxy-tab="${path}"] .marxy-tab-open`);
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

test('one grid: equal heights and gaps, one vertical centre, the row centred between its rules', async () => {
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
    // The row sits between the toolbar's rule above and its own rule below: the tab's top and the band's bottom rule
    // leave the same room round the text.
    const t = m.tabs[0];
    const above = t.label.mid - m.region.top;
    const below = m.region.bottom - 1 - t.label.mid;
    assert.ok(Math.abs(above - below) <= 1, `text centre ${above}px under the top, ${below}px above the bottom rule`);
  });
});

test('the full-name reveal opens after a delay and never over the document\'s first line', async () => {
  await withRow(async (page) => {
    assert.equal(await page.evaluate(() => document.querySelectorAll('.marxy-tab[title]').length), 0, 'no native tooltip: it opens over the text');
    await hover(page, paths[2]);
    assert.equal(await page.evaluate(() => document.querySelector('[data-marxy-tab-tip]')?.hidden ?? true), true, 'not at once');
    await page.waitForSelector('[data-marxy-tab-tip]:not([hidden])', { timeout: 3000 });
    const r = await page.evaluate(() => {
      const tip = document.querySelector('[data-marxy-tab-tip]').getBoundingClientRect();
      const line = document.querySelector('#doc').getBoundingClientRect();
      const first = document.querySelector('#doc p, #doc h1').getBoundingClientRect();
      return { tip: { top: tip.top, bottom: tip.bottom, left: tip.left, right: tip.right }, first: { top: first.top, bottom: first.bottom }, doc: line.top, text: document.querySelector('[data-marxy-tab-tip]').textContent };
    });
    assert.equal(r.text, paths[2]);
    assert.ok(r.tip.bottom <= r.first.top + 0.01, `the reveal's bottom ${r.tip.bottom} reaches the first line at ${r.first.top}`);
    await page.mouse.move(5, 400);
    await page.waitForSelector('[data-marxy-tab-tip][hidden]', { state: 'attached' });
  });
});

test('activating a tab whose name is short and whole moves no other tab either (the heavier face holds its width)', async () => {
  const short = ['/s/Alpha.md', '/s/Bravo Tango.md', '/s/Charlie.md', '/s/Delta.md'];
  const store = Object.fromEntries(short.map((p) => [p, '# T\n\nbody\n']));
  await withRow(async (page) => {
    await page.mouse.move(5, 400);
    const rest = await lefts(page);
    const widths = (await measure(page)).tabs.map((t) => t.tab.width);
    // Under the tab's 220px ceiling: a tab now keeps room for its dirty dot (F-99.1), so these are a little wider than they were.
    assert.ok(widths.every((w) => w < 220), 'the names fit whole');
    for (const p of short) {
      await page.evaluate((p) => window.__marxyHandle.open(p), p);
      await page.evaluate(() => new Promise((r) => setTimeout(r, 120)));
      const now = await lefts(page);
      for (let j = 0; j < now.length; j++) assert.ok(Math.abs(now[j] - rest[j]) < 0.01, `activating ${p} moved tab ${j} by ${now[j] - rest[j]}px`);
    }
  }, { only: short, store });
});

const tipShown = (page) => page.evaluate(() => !document.querySelector('[data-marxy-tab-tip]').hidden);

test('the full path reaches assistive tech: the hovered or focused tab is described by the tip', async () => {
  await withRow(async (page) => {
    await hover(page, paths[2]);
    const d = await page.evaluate((p) => {
      const open = document.querySelector(`[data-marxy-tab="${p}"] .marxy-tab-open`);
      const id = open.getAttribute('aria-describedby');
      const el = id && document.getElementById(id);
      return { id, text: el?.textContent, role: el?.getAttribute('role') };
    }, paths[2]);
    assert.ok(d.id, 'aria-describedby is set');
    assert.equal(d.text, paths[2]);
    assert.equal(d.role, 'tooltip');
    await page.mouse.move(5, 400);
    assert.equal(await page.evaluate(() => document.querySelectorAll('.marxy-tab-open[aria-describedby]').length), 0, 'gone with the pointer');
    await page.focus(`[data-marxy-tab="${paths[4]}"] .marxy-tab-open`);
    assert.equal(await page.evaluate((p) => document.querySelector(`[data-marxy-tab="${p}"] .marxy-tab-open`).hasAttribute('aria-describedby'), paths[4]), true, 'keyboard focus too');
  });
});

test('Esc dismisses an open tip without folding the workspace', async () => {
  await withRow(async (page) => {
    await hover(page, paths[2]);
    await page.waitForSelector('[data-marxy-tab-tip]:not([hidden])', { timeout: 3000 });
    await page.keyboard.press('Escape');
    assert.equal(await tipShown(page), false, 'dismissed');
    assert.equal(await page.evaluate(() => document.body.getAttribute('data-marxy-workspace')), 'unfolded', 'the workspace did not fold');
    // With no tip showing the row's listener does not take the key (the app's own Esc handling is what it was).
    await page.mouse.move(5, 400);
    assert.equal(await tipShown(page), false);
  });
});

test('any active-tab change hides the tip', async () => {
  await withRow(async (page) => {
    await hover(page, paths[2]);
    await page.waitForSelector('[data-marxy-tab-tip]:not([hidden])', { timeout: 3000 });
    await page.evaluate((p) => window.__marxyHandle.open(p), paths[6]);
    await page.waitForTimeout(150);
    assert.equal(await tipShown(page), false);
  });
});
