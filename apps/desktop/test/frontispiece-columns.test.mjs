// F-104: the empty window's two-column pieces keep their columns apart. Every bundled piece is pinned in turn
// (Math.random, as the layout audit does) in the app booted on the shipped skeleton over the memory shell; the
// pieces that carry two languages are opened at 800 px (the columns stack) and widened to 1,000, 1,400 and 1,920 px,
// and opened with the workspace unfolded at 1,400 px. At each size no text box of the left column meets one of the
// right, every text box lies inside the window, and the layout equals that of a window opened at that width.
import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { after, before, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { closeHarness, harnessBase, routeSkeleton } from './support/two-pane.mjs';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip, timeout: 600_000 }, fn);

const PIECES = 38;
const WIDTHS = [1000, 1400, 1920];
const HEIGHT = 800;
let browser;
before(async () => { if (!skip) browser = await launchWebkit(); });
after(async () => {
  await browser?.close();
  await closeHarness();
});

/** The page's measurements: each language column's box and the boxes of its text, rounded to 0.1 px. */
const measure = () => {
  const round = (n) => Math.round(n * 10) / 10;
  const box = (rect) => ({ left: round(rect.left), right: round(rect.right), top: round(rect.top), bottom: round(rect.bottom) });
  const columns = [...document.querySelectorAll('.marxy-frontispiece-parallel > .marxy-frontispiece-lang')].map((section) => {
    const texts = [];
    const walker = document.createTreeWalker(section, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.data.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const rect of range.getClientRects()) if (rect.width > 0 && rect.height > 0) texts.push(box(rect));
    }
    return { box: box(section.getBoundingClientRect()), texts };
  });
  return { width: innerWidth, prose: document.querySelector('.marxy-frontispiece-prose') !== null, columns };
};

/** Layout is settled when two reads 150 ms apart agree (the typesetter sets the viewport, then idles). */
async function settled(page) {
  let last = '';
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(150);
    const now = JSON.stringify(await page.evaluate(measure));
    if (now === last) return JSON.parse(now);
    last = now;
  }
  throw new Error('the frontispiece layout did not settle');
}

async function open(piece, width, { unfold = false } = {}) {
  const page = await browser.newPage({ viewport: { width, height: HEIGHT } });
  await page.addInitScript((k) => { Math.random = () => (k + 0.5) / 38; }, piece);
  const base = await harnessBase();
  await routeSkeleton(page, base);
  await page.goto(`${base}app.html`);
  await page.waitForFunction(() => typeof window.marxyApp?.start === 'function');
  await page.evaluate(async (unfold) => {
    const { createMemoryShell } = await import('/src/shell/memory.ts');
    const { bootApplication } = await import('/src/main.ts');
    const handle = await bootApplication(createMemoryShell({}), { argv: [] });
    await handle.ready;
    window.__marxyHandle = handle;
    if (unfold) handle.workspace().unfold();
  }, unfold);
  return page;
}

const overlap = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5;

/** What is wrong with a layout, as sentences. */
function faults(layout) {
  const out = [];
  const [left, right] = layout.columns;
  for (const [i, column] of layout.columns.entries()) {
    for (const t of column.texts) if (t.left < -0.5 || t.right > layout.width + 0.5) out.push(`column ${i} text ${t.left}..${t.right} lies outside the ${layout.width} px window`);
  }
  if (left && right) {
    const hit = left.texts.find((a) => right.texts.some((b) => overlap(a, b)));
    if (hit) out.push(`a text box of the left column (${hit.left}..${hit.right}, ${hit.top}) meets one of the right`);
    const side = right.box.left >= left.box.right - 0.5;
    // Verse is as wide as its lines, so its columns differ by design; prose is set to the measure, so its columns are equal.
    if (layout.prose && side && Math.abs(left.box.right - left.box.left - (right.box.right - right.box.left)) > 1) out.push('the two columns are unequal');
    for (const [i, column] of layout.columns.entries()) {
      const most = Math.max(...column.texts.map((t) => t.right));
      if (most > column.box.right + 0.5) out.push(`column ${i} text reaches ${most}, past its box at ${column.box.right}`);
    }
  }
  return out;
}

const sameBoxes = (a, b) => {
  const flat = (layout) => layout.columns.flatMap((c) => [c.box, ...c.texts]);
  const x = flat(a);
  const y = flat(b);
  return x.length === y.length && x.every((box, i) => ['left', 'right', 'top', 'bottom'].every((k) => Math.abs(box[k] - y[i][k]) <= 1));
};

test('every two-language piece keeps its columns apart, widened or opened wide, and the layout is the same either way', async () => {
  const problems = [];
  let parallel = 0;
  const pieces = [...Array(PIECES).keys()];
  // Four pages at a time; the pieces are independent.
  for (let start = 0; start < pieces.length; start += 4) {
    await Promise.all(pieces.slice(start, start + 4).map(async (k) => {
      const page = await open(k, 800);
      try {
        const stacked = await settled(page);
        if (stacked.columns.length < 2) return;
        parallel += 1;
        for (const f of faults(stacked)) problems.push(`piece ${k} opened at 800: ${f}`);
        for (const width of WIDTHS) {
          await page.setViewportSize({ width, height: HEIGHT });
          const widened = await settled(page);
          for (const f of faults(widened)) problems.push(`piece ${k} widened 800 to ${width}: ${f}`);
          const fresh = await open(k, width);
          try {
            const opened = await settled(fresh);
            for (const f of faults(opened)) problems.push(`piece ${k} opened at ${width}: ${f}`);
            if (!sameBoxes(widened, opened)) problems.push(`piece ${k}: widened to ${width} is not the layout of a window opened at ${width}`);
          } finally {
            await fresh.close();
          }
        }
        // The sidebar docked at 1,400: the workspace unfolds after the page is up, which narrows the article.
        const unfolded = await open(k, 1400, { unfold: true });
        try {
          for (const f of faults(await settled(unfolded))) problems.push(`piece ${k} unfolded at 1400: ${f}`);
        } finally {
          await unfolded.close();
        }
      } finally {
        await page.close();
      }
    }));
  }
  assert.ok(parallel >= 17, `expected the 17 pieces in two languages, found ${parallel}`);
  assert.deepEqual(problems, []);
});
