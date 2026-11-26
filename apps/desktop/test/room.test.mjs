// The pane's room before anything is hidden: a data table runs to the pane's edge, through a column of words, before it
// keeps a column past the edge; a long monospace line wraps at the pane's edge, not the prose measure; a drawn diagram
// keeps its width and scrolls in its own box; and a window with no kept frame opens the drawer only where the page keeps
// its measure beside it. Each at two widths. Prose keeps its measure, and the wide things keep the text's left edge.
// Playwright WebKit.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test as nodeTest } from 'node:test';
import { closeHarness } from './support/two-pane.mjs';
import { skip, withFrame } from './support/frame.mjs';

const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);
after(() => closeHarness());

const demo = join(fileURLToPath(new URL('../../../', import.meta.url)), 'fixtures', 'demo');
// The rail alone, so the pane is the window less the rail at every width.
const RAIL = { folded: false, leftPanel: 'places', leftMode: 'rail', sets: [], placeOrder: [] };

const records = Array.from({ length: 6 }, (_, i) =>
  JSON.stringify({ at: `2026-10-14T0${i}:00:00Z`, root: '~/notes/somewhere', files: 1200 + i, changed: i, ms: 80 + i, note: `the walk skipped a folder it could not read, run ${i}, and went on with the rest` }),
).join('\n');
const LONG = `fetch --from https://example.org/a/very/long/path ${'--flag value '.repeat(16)}--end`;
const FILES = {
  '/r/runs.jsonl': `${records}\n`,
  '/r/code.md': `# Code\n\nA paragraph of prose that is long enough to fill the measure of the column and wrap onto a second line of the page.\n\n\`\`\`sh\n${LONG}\nshort\n\`\`\`\n`,
  '/r/arch.md': readFileSync(join(demo, 'tidemark', 'docs', 'architecture.md')),
};

/** The box, the prose column and the pane's edge, in px from the window's left. */
const geometry = (page, sel) =>
  page.evaluate((sel) => {
    const box = document.querySelector(sel);
    const article = box.closest('.marxy-article');
    const a = article.getBoundingClientRect();
    const cs = getComputedStyle(article);
    const section = article.closest('section.marxy-pane');
    // The pane's edge is its content box's: the spine keeps the strip past it.
    const pane = { right: section.getBoundingClientRect().right - Number.parseFloat(getComputedStyle(section).paddingRight) };
    const b = box.getBoundingClientRect();
    return {
      left: b.left, right: b.right, height: b.height, client: box.clientWidth, scroll: box.scrollWidth,
      textLeft: a.left + Number.parseFloat(cs.paddingLeft), textRight: a.right - Number.parseFloat(cs.paddingRight),
      gutter: Number.parseFloat(cs.paddingRight), paneRight: pane.right,
      more: box.getAttribute('data-marxy-more'), cut: box.hasAttribute('data-marxy-cut'),
    };
  }, sel);

test('a data table runs to the pane edge through a column of words before it keeps one past the edge; wider, it shows them all', async () => {
  for (const width of [1100, 1700]) {
    await withFrame({ files: FILES, open: ['/r/runs.jsonl'], frame: RAIL, viewport: { width, height: 800 } }, async (page) => {
      await page.waitForSelector('.marxy-reading-scroll');
      await page.waitForTimeout(300);
      const g = await geometry(page, '.marxy-reading-scroll');
      assert.ok(Math.abs(g.left - g.textLeft) < 1, `${width}: the table keeps the text's left edge`);
      if (width === 1100) {
        assert.equal(g.more, 'end', 'more past the right edge');
        assert.ok(g.right > g.textRight + 100, 'the table runs well past the prose measure');
        assert.ok(Math.abs(g.right - (g.paneRight - g.gutter)) < 2, `it runs to the pane edge, less the gutter (${g.right} vs ${g.paneRight - g.gutter})`);
        const shown = await page.$eval('.marxy-reading-table thead th:last-child', (th) => th.getBoundingClientRect().left);
        assert.ok(shown < g.right - 60, 'the column of words starts inside the box, not wholly past it');
        assert.match(await page.getAttribute('.marxy-reading-foot', 'data-marxy-more-cols'), /1 more column/);
      } else {
        assert.equal(g.more, null, 'every column shows');
        assert.equal(g.cut, false);
        assert.ok(g.right > g.textRight, 'and the table still runs past the prose measure to show them');
      }
    });
  }
});

test('a long monospace line wraps at the pane edge, not the prose measure; prose keeps its measure', async () => {
  for (const width of [1000, 1600]) {
    await withFrame({ files: FILES, open: ['/r/code.md'], frame: RAIL, viewport: { width, height: 800 } }, async (page) => {
      await page.waitForSelector('.marxy-article pre');
      await page.waitForTimeout(300);
      const g = await geometry(page, '.marxy-article pre');
      const p = await geometry(page, '.marxy-article > p');
      assert.ok(p.right <= p.textRight + 1, `${width}: the paragraph keeps the measure`);
      assert.ok(Math.abs(g.left - g.textLeft) < 1, `${width}: the block keeps the text's left edge`);
      assert.ok(Math.abs(g.right - (g.paneRight - g.gutter)) < 2, `${width}: the block runs to the pane edge, less the gutter (${g.right} vs ${g.paneRight - g.gutter})`);
      const rows = await page.$eval('.marxy-article pre code', (code) => {
        const line = code.querySelector('.marxy-line') ?? code;
        return Math.round(line.getBoundingClientRect().height / Number.parseFloat(getComputedStyle(code).lineHeight));
      });
      assert.ok(rows >= 2, `${width}: the long line wraps (${rows} rows)`);
      assert.equal(g.scroll <= g.client + 1, true, `${width}: and nothing scrolls`);
    });
  }
});

test('a wide diagram keeps its drawn width and scrolls in its own box, its caption in view', async () => {
  for (const width of [900, 1280]) {
    await withFrame({ files: FILES, open: ['/r/arch.md'], frame: RAIL, viewport: { width, height: 800 } }, async (page) => {
      await page.waitForSelector('pre[data-marxy-diagram="drawn"] .marxy-diagram-scroll svg');
      const sel = '.marxy-diagram-scroll';
      await page.waitForFunction((s) => document.querySelector(s).hasAttribute('data-marxy-more'), sel);
      const g = await geometry(page, sel);
      assert.ok(g.scroll > g.client + 50, `${width}: the drawing is wider than its box`);
      assert.ok(Math.abs(g.left - g.textLeft) < 1, `${width}: the box keeps the text's left edge`);
      assert.ok(g.right <= g.paneRight - g.gutter + 1, `${width}: and ends inside the pane`);
      assert.equal(g.more, 'end');
      const drawn = await page.$eval(`.marxy-diagram`, (d) => [d.querySelector('svg').getBoundingClientRect().width, Number.parseFloat(d.style.getPropertyValue('--marxy-dw'))]);
      assert.ok(Math.abs(drawn[0] - drawn[1]) < 1, `${width}: drawn at its own width, not scaled down (${drawn})`);
      const before = await page.$eval('.marxy-diagram-title', (t) => t.getBoundingClientRect().left);
      await page.$eval(sel, (box) => { box.scrollLeft = 120; });
      await page.waitForFunction((s) => document.querySelector(s).getAttribute('data-marxy-more') === 'both', sel);
      const afterLeft = await page.$eval('.marxy-diagram-title', (t) => t.getBoundingClientRect().left);
      assert.ok(Math.abs(afterLeft - before) < 1, `${width}: the caption stays at the left as the drawing scrolls`);
      const faded = await page.evaluate((s) => { const box = document.querySelector(s); return [getComputedStyle(box).maskImage, getComputedStyle(document.querySelector('.marxy-diagram-title')).maskImage, box.contains(document.querySelector('.marxy-diagram-title'))]; }, sel);
      assert.notEqual(faded[0], 'none', `${width}: the drawing fades at its edge`);
      assert.equal(faded[2], false, `${width}: the caption is outside the faded box`);
      // The scrollbar may take the box's height: the page below must still sit on the baseline grid.
      await page.waitForTimeout(400);
      const off = await page.evaluate(() => {
        const article = document.querySelector('.marxy-article');
        const unit = Number.parseFloat(getComputedStyle(article.querySelector(':scope > p')).lineHeight) / 2;
        const base = article.querySelector(':scope > p').getBoundingClientRect().top;
        const out = [];
        for (const el of article.querySelectorAll(':scope > p')) {
          if (el.offsetHeight === 0) continue;
          const r = (el.getBoundingClientRect().top - base) % unit;
          out.push(Math.min(Math.abs(r), Math.abs(unit - Math.abs(r))));
        }
        return Math.max(...out);
      });
      assert.ok(off < 1, `${width}: paragraphs sit on the grid below a scrolling diagram (off by ${off})`);
    });
  }
});

test('a window with no kept frame opens the drawer only where the page keeps its measure beside it', async () => {
  const drawer = (page) => page.evaluate(() => [document.body.getAttribute('data-marxy-drawer'), document.body.getAttribute('data-marxy-left')]);
  await withFrame({ files: FILES, open: ['/r/code.md'], viewport: { width: 960, height: 800 } }, async (page) => {
    assert.deepEqual(await drawer(page), ['closed', 'rail'], 'narrow: the rail alone, the page at its measure');
    const g = await geometry(page, '.marxy-article > p');
    assert.ok(g.textRight - g.textLeft > 560, 'the page has its measure');
  });
  await withFrame({ files: FILES, open: ['/r/code.md'], viewport: { width: 1440, height: 900 } }, async (page) => {
    assert.deepEqual(await drawer(page), ['docked', 'open'], 'wide: the drawer docks beside the page');
  });
  // A kept frame is the reader's: open, it docks where it always did.
  await withFrame({ files: FILES, open: ['/r/code.md'], frame: { ...RAIL, leftMode: 'open' }, viewport: { width: 960, height: 800 } }, async (page) => {
    assert.deepEqual(await drawer(page), ['docked', 'open']);
  });
});
