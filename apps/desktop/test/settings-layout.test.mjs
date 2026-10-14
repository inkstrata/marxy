// F-102 (X-32 finding 2): the Settings page keeps a readable column in a 900 to 1,150 px unfolded window. The body grid keeps a
// right-hand track for an inspector that Settings does not have, so the page was the middle track alone (496 of 748 px at 1,000)
// and its card 250 px. These are the page's boxes, measured in WebKit on the shipped skeleton and CSS over the memory shell.
import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { after, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { b64, closeHarness, harnessBase, shippedSkeleton } from './support/two-pane.mjs';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip, timeout: 180_000 }, fn);
after(() => closeHarness());

const para = (word) => `${word} runs long enough to wrap across several lines of the column, so the page is tall enough to scroll. `;
const files = { '/r/A.md': `# Alpha\n\n${para('Alpha').repeat(14)}\n\n## Later\n\n${para('Later').repeat(14)}\n` };

async function withPage(fn, { width, height = 900, variant = 'dark' }) {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width, height } });
    const base = await harnessBase();
    const { style, body } = shippedSkeleton();
    await page.route(`${base}app.html`, async (route) => {
      const response = await route.fetch();
      const html = (await response.text())
        .replace('</head>', `<style>${style}</style></head>`)
        .replace(/<body[^>]*>/, `<body data-marxy-mode="rendered" data-marxy-variant="${variant}">`)
        .replace('<article id="doc" class="marxy-article"></article>', body);
      await route.fulfill({ response, body: html });
    });
    await page.goto(`${base}app.html`);
    await page.waitForFunction(() => typeof window.marxyApp?.start === 'function');
    const encoded = Object.fromEntries(Object.entries(files).map(([path, text]) => [path, b64(text)]));
    await page.evaluate(async ({ encoded }) => {
      const bytes = {};
      for (const [path, text] of Object.entries(encoded)) bytes[path] = Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
      const { createMemoryShell } = await import('/src/shell/memory.ts');
      const { bootApplication } = await import('/src/main.ts');
      const handle = await bootApplication(createMemoryShell(bytes), { argv: ['/r/A.md'] });
      await handle.ready;
      window.__marxyHandle = handle;
      window.__cmd = async (id) => {
        const { commands } = await import('/src/commands/index.ts');
        return commands().find((c) => c.id === id).run({ showNotice() {} });
      };
    }, { encoded });
    await page.evaluate(() => window.__marxyHandle.workspace().unfold());
    await page.waitForTimeout(120);
    await fn(page);
  } finally {
    await browser.close();
  }
}

const settle = (page, ms = 100) => page.waitForTimeout(ms);
const openSettings = async (page) => {
  await page.evaluate(() => window.__cmd('view.settings'));
  await page.waitForSelector('[data-marxy-settings]');
  await settle(page, 120);
};

/** The boxes the card names: the page, its pane, the cards and the rows' labels against their controls. */
const measure = (page) =>
  page.evaluate(() => {
    const box = (el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom };
    };
    const hit = (a, b) => a.x < b.right - 0.5 && b.x < a.right - 0.5 && a.y < b.bottom - 0.5 && b.y < a.bottom - 0.5;
    const pageEl = document.querySelector('[data-marxy-settings]');
    const paneEl = pageEl.querySelector('.marxy-settings-pane');
    const pane = box(paneEl);
    const cs = getComputedStyle(paneEl);
    const content = pane.w - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const cards = [...pageEl.querySelectorAll('.marxy-settings-group:has(> .marxy-setting)')].map(box);
    const overlaps = [];
    for (const row of pageEl.querySelectorAll('.marxy-setting')) {
      const label = row.querySelector('.marxy-setting-label');
      if (!label) continue;
      const lr = (() => {
        const range = document.createRange();
        range.selectNodeContents(label);
        return range.getBoundingClientRect();
      })();
      for (const control of row.querySelectorAll('.marxy-setting-control > *')) {
        if (hit(lr, box(control))) overlaps.push(`${label.textContent} / ${control.className}`);
      }
    }
    const segments = [...pageEl.querySelectorAll('.marxy-settings-segmented')].map((s) => {
      const labels = [...s.querySelectorAll('.marxy-settings-segment-label')];
      return { whole: s.scrollWidth <= s.clientWidth + 0.5, labels: labels.map((l) => box(l).right <= box(s).right + 0.5) };
    });
    const inspector = document.querySelector('[data-marxy-workspace-region="inspector"]:not([hidden])');
    return {
      page: box(pageEl),
      pane,
      content,
      cardMax: Math.max(0, ...cards.map((c) => c.w)),
      cardMin: cards.length ? Math.min(...cards.map((c) => c.w)) : null,
      cardCount: cards.length,
      overlaps,
      segments,
      scrollsX: pageEl.scrollWidth > pageEl.clientWidth + 1,
      inspectorLeft: inspector ? box(inspector).x : null,
      window: innerWidth,
    };
  });

const category = async (page, id) => {
  await page.click(`[data-marxy-category="${id}"]`);
  await settle(page, 80);
};

const WIDTHS = [900, 1000, 1100, 1150, 1200];
for (const variant of ['dark', 'light']) {
  test(`Settings unfolded, ${variant}: the card fills the pane's column and no label lies over its control, at ${WIDTHS.join(', ')} px`, async () => {
    for (const width of WIDTHS) {
      await withPage(async (page) => {
        await openSettings(page);
        for (const id of ['types', 'advanced', 'appearance', 'general', 'reading']) {
          await category(page, id);
          const m = await measure(page);
          const at = `${width} px, ${variant}, ${id}`;
          // The page takes the window less the sidebar: no track is kept for an inspector the page does not have.
          assert.ok(Math.abs(m.page.right - m.window) <= 1, `${at}: the page runs to the window's right edge (${m.page.right} of ${m.window})`);
          assert.ok(m.cardCount > 0, `${at}: a card is drawn`);
          // The card is the pane's column (its max-width is 52em) and, from 1,000 px, at least 480 px.
          const want = Math.min(m.content, 52 * 13);
          assert.ok(m.cardMin >= want - 1, `${at}: the card is ${m.cardMin} px of ${want} px the pane leaves`);
          if (width >= 1000) assert.ok(m.cardMin >= 480, `${at}: the card is ${m.cardMin} px, at least 480`);
          assert.deepEqual(m.overlaps, [], `${at}: a label lies over its control`);
          for (const s of m.segments) assert.ok(s.whole && s.labels.every(Boolean), `${at}: a segmented control is cut`);
          assert.equal(m.scrollsX, false, `${at}: the page scrolls sideways`);
        }
      }, { width, variant });
    }
  });
}

test('Settings with the inspector docked stays left of it, on the same axis as the reader (1,400 and 1,920 px)', async () => {
  for (const width of [1400, 1920]) {
    await withPage(async (page) => {
      await page.evaluate(() => window.__marxyHandle.workspace().setPanel('inspector', true));
      await settle(page, 120);
      const before = await page.evaluate(() => document.querySelector('[data-marxy-workspace-region="inspector"]').getBoundingClientRect().x);
      await openSettings(page);
      const m = await measure(page);
      assert.ok(m.inspectorLeft !== null, 'the inspector stays docked');
      assert.ok(m.page.right <= m.inspectorLeft + 1, `${width}: the page ends at the inspector's edge (${m.page.right} vs ${m.inspectorLeft})`);
      assert.ok(Math.abs(m.inspectorLeft - before) <= 0.5, 'the inspector does not move');
      assert.ok(Math.abs(m.page.x - 300) <= 1 || Math.abs(m.page.x - 252) <= 1, `${width}: the page starts at the sidebar's edge (${m.page.x})`);
    }, { width });
  }
});

test('the reading page is not touched: the article is centred on the window, unfolded, at 1,000 and 1,400 px', async () => {
  // The grid is shared; the reader's column stays on the window's axis (V-12, L-07), with or without a docked inspector.
  for (const width of [1000, 1400]) {
    await withPage(async (page) => {
      const edge = () => page.evaluate(() => {
        const r = document.querySelector('#marxy-main article, .marxy-article').getBoundingClientRect();
        return { left: r.x, centre: r.x + r.width / 2, window: innerWidth };
      });
      const e = await edge();
      if (process.env.MARXY_PRINT_EDGES) console.log(`article ${width}: left ${e.left}`);
      assert.ok(Math.abs(e.centre - e.window / 2) <= 1, `${width}: the article is centred (${e.centre} of ${e.window})`);
    }, { width });
  }
});
