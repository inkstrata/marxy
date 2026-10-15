// F-97: the palette's footer, results and preview keep to their own rows. The panel is a column (field, chips, body,
// footer); the body takes what is left and its results and preview scroll inside it, so the footer never draws over them.
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

const para = (word) => `${word} runs long enough to wrap across several lines of the column. `;
const files = {};
const entries = [];
for (let i = 1; i <= 8; i++) {
  const path = `/r/note-${i}.md`;
  files[path] = `# Note ${i}\n\n${para(`Note ${i}`).repeat(30)}\n\n## Part ${i}\n\n${para('Part').repeat(6)}\n`;
  entries.push({ path, root: '/r', title: `Note ${i}`, headings: [{ level: 2, text: `Part ${i}`, byteOffset: 0 }], mtimeMs: 1, size: 7000 * i, kind: 'markdown' });
}

async function boot(page, variant) {
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
  const encoded = Object.fromEntries(Object.entries(files).map(([p, t]) => [p, b64(t)]));
  await page.evaluate(
    async ({ encoded, entries }) => {
      const bytes = {};
      for (const [p, t] of Object.entries(encoded)) bytes[p] = Uint8Array.from(atob(t), (c) => c.charCodeAt(0));
      const { createMemoryShell } = await import('/src/shell/memory.ts');
      const { bootApplication } = await import('/src/main.ts');
      const handle = await bootApplication(createMemoryShell(bytes), { argv: ['/r/note-1.md'] });
      await handle.ready;
      window.__marxyHandle = handle;
      handle.palette.setIndexEntries(entries);
      for (const p of ['/r/note-2.md', '/r/note-3.md', '/r/note-4.md', '/r/note-5.md']) await handle.open(p);
    },
    { encoded, entries },
  );
}

const STATES = {
  recent: async () => '',
  search: async () => 'note',
  commands: async () => '>',
};

/** The boxes the layout acceptance reads, in CSS px, from the open palette. */
const measure = (page) =>
  page.evaluate(() => {
    const q = (s) => document.querySelector(`#marxy-palette ${s}`);
    const box = (el) => {
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, h: r.height };
    };
    const dlg = box(document.getElementById('marxy-palette'));
    const aside = q('.marxy-palette-aside');
    return {
      dlg,
      foot: box(q('.marxy-palette-foot')),
      body: box(q('.marxy-palette-body')),
      results: box(q('.marxy-palette-results')),
      aside: aside && getComputedStyle(aside).display !== 'none' ? box(aside) : null,
      chips: [...document.querySelectorAll('#marxy-palette .marxy-palette-prev-chip')].map(box),
      sections: [...document.querySelectorAll('#marxy-palette .marxy-palette-section')].map(box),
      rows: [...document.querySelectorAll('#marxy-palette .marxy-palette-row')].map(box),
      query: (() => { const el = q('.marxy-palette-query'); return { pad: parseFloat(getComputedStyle(el).paddingLeft), outline: getComputedStyle(el).outlineStyle, outlineW: parseFloat(getComputedStyle(el).outlineWidth) }; })(),
      viewport: innerHeight,
    };
  });

const within = (inner, outer) => inner.top >= outer.top - 0.5 && inner.bottom <= outer.bottom + 0.5;
const disjoint = (a, b) => a.bottom <= b.top + 0.5 || b.bottom <= a.top + 0.5;

for (const height of [600, 720, 900]) {
  for (const state of Object.keys(STATES)) {
    test(`${height} px tall, ${state}: the footer has its own row; results, preview chips and sections stay above it`, async () => {
      const browser = await launchWebkit();
      try {
        const page = await browser.newPage({ viewport: { width: 1400, height } });
        await boot(page, 'dark');
        await page.keyboard.press('Meta+KeyP');
        await page.waitForSelector('#marxy-palette[open]');
        const text = await STATES[state]();
        if (text) await page.locator('#marxy-palette .marxy-palette-query').fill(text);
        await page.waitForSelector('#marxy-palette .marxy-palette-row');
        await page.waitForTimeout(500);
        const m = await measure(page);
        const where = JSON.stringify({ foot: m.foot, body: m.body, results: m.results, aside: m.aside });
        assert.ok(m.foot.top >= m.body.bottom - 0.5, `footer top ${m.foot.top} is at or below body bottom ${m.body.bottom}: ${where}`);
        assert.ok(disjoint(m.foot, m.results), `footer meets the results: ${where}`);
        if (m.aside) {
          assert.ok(disjoint(m.foot, m.aside), `footer meets the preview: ${where}`);
          assert.ok(m.aside.bottom <= m.foot.top + 0.5, 'the divider (the aside border) stops above the footer');
          for (const chip of m.chips) assert.ok(within(chip, m.aside) && chip.bottom <= m.foot.top, 'preview chips whole inside the aside');
        }
        for (const s of m.sections) assert.ok(disjoint(m.foot, s), 'footer meets a group label');
        assert.ok(m.dlg.bottom <= m.viewport + 0.5, 'the panel stays in the window');
        assert.ok(m.query.pad > 0, `query has a left inset, got ${m.query.pad}`);
        assert.ok(m.foot.h < 60, `footer is one row (height ${m.foot.h})`);
      } finally {
        await browser.close();
      }
    });
  }
}

test('the shortest supported window (400 px) keeps at least three result rows visible; the body scrolls beyond', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 400 } });
    await boot(page, 'dark');
    await page.keyboard.press('Meta+KeyP');
    await page.waitForSelector('#marxy-palette[open]');
    await page.locator('#marxy-palette .marxy-palette-query').fill('note');
    await page.waitForSelector('#marxy-palette .marxy-palette-row');
    await page.waitForTimeout(500);
    const m = await measure(page);
    const visible = m.rows.filter((r) => r.top >= m.results.top - 0.5 && r.bottom <= m.results.bottom + 0.5).length;
    assert.ok(visible >= 3, `${visible} rows fully visible in a results box ${m.results.h} px tall`);
    assert.ok(m.foot.top >= m.body.bottom - 0.5, 'footer below the body');
  } finally {
    await browser.close();
  }
});

test('one focus frame: the focused query draws no outline of its own, the field shows the ring', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await boot(page, 'dark');
    await page.keyboard.press('Meta+KeyP');
    await page.waitForSelector('#marxy-palette[open]');
    const frames = await page.evaluate(() => {
      const q = document.querySelector('#marxy-palette .marxy-palette-query');
      const f = document.querySelector('#marxy-palette .marxy-palette-field');
      const cs = (el) => getComputedStyle(el);
      return { active: document.activeElement === q, queryOutline: cs(q).outlineStyle, fieldOutline: cs(f).outlineStyle, fieldBoxShadow: cs(f).boxShadow, pad: parseFloat(cs(q).paddingLeft) };
    });
    assert.equal(frames.active, true);
    assert.equal(frames.queryOutline, 'none', 'the query draws no second frame');
    assert.ok(frames.fieldOutline !== 'none' || frames.fieldBoxShadow !== 'none', 'the field carries the single ring');
    assert.ok(frames.pad > 0);
  } finally {
    await browser.close();
  }
});

test('a window shorter than the floor (220 px): the body shrinks and scrolls, the footer keeps its own row', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 220 } });
    await boot(page, 'dark');
    await page.keyboard.press('Meta+KeyP');
    await page.waitForSelector('#marxy-palette[open]');
    await page.waitForTimeout(500);
    const m = await measure(page);
    assert.ok(m.foot.top >= m.body.bottom - 0.5, `footer top ${m.foot.top} below body bottom ${m.body.bottom}`);
    assert.ok(m.results.bottom <= m.foot.top + 0.5, `results box (${m.results.top}..${m.results.bottom}) ends above the footer (${m.foot.top})`);
    assert.ok(m.foot.bottom <= m.dlg.bottom + 0.5, 'footer inside the panel');
    for (const chip of m.chips) assert.ok(chip.bottom <= m.foot.top + 0.5 || chip.top >= m.foot.bottom, 'no chip is cut by the footer');
  } finally {
    await browser.close();
  }
});
