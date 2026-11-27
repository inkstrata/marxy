// One element inserted beside a long page restyles only what it can change. A `:has()` above a subject that names
// nothing (`:has(> .marxy-fact) > *`, `blockquote:has(…) > :last-child`) made Chromium restyle the whole document at every
// element inserted anywhere: 110-125 ms with a 5 MB plain .txt in, paid by every typesetter batch, mounted run and panel
// redraw. Those rules now find their children from the children's own siblings. A :has() tried on every element of the
// page (a box named only by its ancestors) did the same at every span typesetting inserts into a paragraph of a long
// Markdown page, restyling every block beside it; that case is read from Chromium's own trace. Chromium is the engine that showed it
// (the Windows WebView), run here on the system Edge when there is one; WebKit never showed it and is held to the same bound.
import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { after, test as nodeTest } from 'node:test';
import { chromium, webkit } from 'playwright';
import { launchOptions, launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { b64, closeHarness, harnessBase, routeSkeleton } from './support/two-pane.mjs';

const noWebkit = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1';
after(() => closeHarness());

/** The slowest median style recalculation one insertion may cost, in ms. 2 MB of prose took 33-50 ms before, 0.1-4 after. */
const INSERT_MS = 15;

/** Plain prose, as plain-text-large.test.mjs makes it: sentences, a blank line every six. */
function plainProse(bytes) {
  const words = 'the reader keeps a place in a long text and the page holds it while the window moves around it quietly'.split(' ');
  const out = [];
  let n = 0;
  for (let i = 0; n < bytes; i++) {
    const w = [];
    for (let k = 0; k < 18; k++) w.push(words[(i * 7 + k * 3) % words.length]);
    const piece = `${w.join(' ')}. ${i % 6 === 5 ? '\n\n' : ''}`;
    out.push(piece);
    n += piece.length;
  }
  return out.join('');
}

/** The median style recalculation, in ms, of one element appended to the body, the panel, and the reading's last run. */
async function insertionCosts(page) {
  const base = await harnessBase();
  await routeSkeleton(page, base);
  await page.goto(`${base}app.html`);
  await page.waitForFunction(() => typeof window.marxyApp?.start === 'function');
  const files = { '/n/small.md': b64('# Small\n\nShort.\n'), '/n/big.txt': b64(plainProse(2 * 1024 * 1024)) };
  return page.evaluate(async (files) => {
    const bytes = {};
    for (const [path, b] of Object.entries(files)) bytes[path] = Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
    const { createMemoryShell } = await import('/src/shell/memory.ts');
    const { startApp } = await import('/src/app.ts');
    const h = await startApp(createMemoryShell(bytes), { argv: ['/n/small.md'] });
    await h.ready;
    await h.open('/n/big.txt');
    await h.contentComplete();
    await new Promise((r) => setTimeout(r, 2_000));
    const sites = {
      body: () => document.body,
      panel: () => document.querySelector('.marxy-panel') ?? document.body,
      run: () => document.querySelector('[data-marxy-reading] > .marxy-reading-run:last-child'),
    };
    const once = (site) => {
      const el = document.createElement(site === 'run' ? 'p' : 'div');
      el.textContent = 'x';
      getComputedStyle(document.body).color;
      const t = performance.now();
      sites[site]().appendChild(el);
      // Reading a computed style forces the style recalculation the insertion asked for, and no layout.
      getComputedStyle(el).color;
      const ms = performance.now() - t;
      el.remove();
      getComputedStyle(document.body).color;
      return ms;
    };
    const out = { nodes: document.getElementsByTagName('*').length, reading: document.querySelector('[data-marxy-reading]')?.getAttribute('data-marxy-reading') ?? null };
    for (const site of Object.keys(sites)) {
      const xs = [];
      for (let i = 0; i < 9; i++) xs.push(once(site));
      xs.sort((a, b) => a - b);
      out[site] = xs[4];
    }
    return out;
  }, files);
}

function check(engine, costs) {
  console.log(`${engine}, ${costs.nodes} elements: one insertion restyles in ${['body', 'panel', 'run'].map((s) => `${s} ${costs[s].toFixed(1)}`).join(', ')} ms`);
  assert.equal(costs.reading, 'prose');
  assert.ok(costs.nodes > 4_000, `${costs.nodes} elements in the page`);
  for (const site of ['body', 'panel', 'run']) {
    assert.ok(costs[site] < INSERT_MS, `an element inserted at ${site} took ${costs[site].toFixed(1)} ms of style recalculation; the bound is ${INSERT_MS} ms`);
  }
}

nodeTest('one element inserted beside a 2 MB prose reading restyles in bounded time (Chromium, system Edge)', { timeout: 240_000 }, async (t) => {
  let browser;
  try {
    browser = await chromium.launch(launchOptions({ channel: 'msedge' }));
  } catch {
    t.skip('no system Edge here to run Chromium on');
    return;
  }
  try {
    check('Chromium', await insertionCosts(await browser.newPage({ viewport: { width: 1280, height: 900 } })));
  } finally {
    await browser.close();
  }
});

/** Technical Markdown, sections of headings, paragraphs, a list, a table and a break, as a long design document has them. */
function technicalMarkdown(sections) {
  const out = ['# A long technical document\n'];
  for (let i = 0; i < sections; i++) {
    out.push(`## Section ${i}\n`);
    for (let k = 0; k < 6; k++) out.push(`The service keeps its state in **one table** and the worker reads it every \`${k}\` seconds; a change in section ${i} moves the next read, and the reader follows it without a reload. ${plainProse(200)}\n`);
    out.push('- first item of the list\n- second item, a little longer than the first\n');
    out.push('| name | value |\n| --- | --- |\n| depth | 4 |\n| rate | 12 |\n');
    out.push('---\n');
  }
  return out.join('\n');
}

/**
 * The elements Chromium restyles when one span is inserted into a paragraph in the middle of a long Markdown page, read
 * from its own trace (the `elementCount` of the style recalculation), with the number of the article's top-level blocks.
 * Typesetting inserts its spans like this, paragraph by paragraph, while a big file opens.
 */
async function paragraphInsertion(browser, page) {
  const base = await harnessBase();
  await routeSkeleton(page, base);
  await page.goto(`${base}app.html`);
  await page.waitForFunction(() => typeof window.marxyApp?.start === 'function');
  const files = { '/n/small.md': b64('# Small\n\nShort.\n'), '/n/tech.md': b64(technicalMarkdown(160)) };
  await page.evaluate(async (files) => {
    const bytes = {};
    for (const [path, b] of Object.entries(files)) bytes[path] = Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
    const { createMemoryShell } = await import('/src/shell/memory.ts');
    const { startApp } = await import('/src/app.ts');
    const h = await startApp(createMemoryShell(bytes), { argv: ['/n/small.md'] });
    await h.ready;
    await h.open('/n/tech.md');
    await h.contentComplete();
    await new Promise((r) => setTimeout(r, 2_000));
  }, files);
  await browser.startTracing(page, { categories: ['devtools.timeline'] });
  const blocks = await page.evaluate(() => {
    const art = [...document.querySelectorAll('.marxy-article')].find((a) => !a.hidden && !a.closest('[hidden]'));
    const ps = art.querySelectorAll(':scope > p');
    const p = ps[Math.floor(ps.length / 2)];
    for (let i = 0; i < 5; i++) {
      getComputedStyle(document.body).color;
      const span = document.createElement('span');
      span.textContent = 'x';
      p.appendChild(span);
      getComputedStyle(span).color;
      span.remove();
    }
    return art.children.length;
  });
  const trace = JSON.parse((await browser.stopTracing()).toString());
  const counts = trace.traceEvents.filter((e) => e.name === 'UpdateLayoutTree' && e.ph === 'X').map((e) => e.args?.elementCount ?? 0);
  counts.sort((a, b) => a - b);
  return { blocks, restyled: counts[Math.floor(counts.length / 2)] ?? 0, recalcs: counts.length };
}

nodeTest('one span inserted into a paragraph of a long technical Markdown page restyles a few elements, not the page (Chromium, system Edge)', { timeout: 240_000 }, async (t) => {
  let browser;
  try {
    browser = await chromium.launch(launchOptions({ channel: 'msedge' }));
  } catch {
    t.skip('no system Edge here to run Chromium on');
    return;
  }
  try {
    const r = await paragraphInsertion(browser, await browser.newPage({ viewport: { width: 1280, height: 900 } }));
    console.log(`Chromium, ${r.blocks} top-level blocks: one insertion into a paragraph restyled ${r.restyled} elements (median of ${r.recalcs} recalculations)`);
    assert.ok(r.blocks > 1_000, `${r.blocks} top-level blocks in the article`);
    assert.ok(r.recalcs >= 5, `${r.recalcs} style recalculations traced`);
    // A rule whose :has() was tried on every element of the page restyled every block beside the paragraph (about all
    // of them); what is left is the breaks, which a rule on the block after them still reaches.
    assert.ok(r.restyled < r.blocks / 4, `one span inserted into a paragraph restyled ${r.restyled} elements of a page of ${r.blocks} blocks`);
  } finally {
    await browser.close();
  }
});

nodeTest('one element inserted beside a 2 MB prose reading restyles in bounded time (WebKit)', { skip: noWebkit && 'Playwright WebKit is not installed here', timeout: 240_000 }, async () => {
  const browser = await launchWebkit();
  try {
    check('WebKit', await insertionCosts(await browser.newPage({ viewport: { width: 1280, height: 900 } })));
  } finally {
    await browser.close();
  }
});
