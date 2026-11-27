// A PDF as a page of the reader's: its pages drawn by pdf.js from
// ranges of the file, never read whole; Page n of N, zoom and the fits; a text layer that selects and that Find in the
// page reaches, page by page; the Pages card with the outline and the Document card from the file's own fields; the
// place kept when Source is shown and back; a 400-page file that draws only what is near the view; a PDF found by its
// bytes when its name says nothing; a locked or broken one as the card. WebKit.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test as nodeTest } from 'node:test';
import { closeHarness } from './support/two-pane.mjs';
import { cardText, cardsOf, showCardPanel, showPanel, withFrame } from './support/frame.mjs';
import { scrollSettled, skip } from './support/kit.mjs';
import { longPdf } from '../scripts/pdf-fixture.mjs';

const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);
after(() => closeHarness());

const demo = join(fileURLToPath(new URL('../../../', import.meta.url)), 'fixtures', 'demo', 'reading');
const ESSAY = '/r/reading/the-case-for-ragged-lines.pdf';
const LONG = '/r/long.pdf';
const essayBytes = readFileSync(join(demo, 'the-case-for-ragged-lines.pdf'));
const FILES = {
  '/r/README.md': '# Here\n',
  [ESSAY]: essayBytes,
  [LONG]: longPdf(400),
  '/r/downloads/report': essayBytes,
  '/r/broken.pdf': '%PDF-1.4\nthis is not a PDF at all\n',
};

const calls = (page, method) => page.evaluate((m) => window.__marxyHandle.shell.calls.filter((c) => c.method === m).map((c) => c.args), method);
const factsOf = async (page, id) => {
  await showCardPanel(page, id);
  return page.evaluate((id) => Object.fromEntries([...document.querySelectorAll(`.marxy-drawer [data-marxy-card="${id}"] .marxy-fact`)].map((e) => [e.children[0].textContent, e.children[1].textContent])), id);
};
const drawn = (page) => page.$$eval('.marxy-pdf-page', (els) => els.map((e) => Number(e.dataset.marxyPage)));
const textOfPage = (page, i) => page.evaluate((i) => document.querySelector(`.marxy-pdf-page[data-marxy-page="${i}"] .marxy-pdf-text`)?.textContent ?? '', i);

test('a PDF opens as its pages, drawn from ranges: the bar, the text layer, the Pages and Document cards', async () => {
  await withFrame({ files: FILES, open: [ESSAY] }, async (page) => {
    await page.waitForFunction(() => document.querySelector('.marxy-pdf-page[data-marxy-page="0"] .marxy-pdf-text span'), null, { timeout: 30000 });
    assert.equal(await page.getAttribute('[data-marxy-viewer]', 'data-marxy-viewer'), 'pdf');
    assert.match(await page.innerText('.marxy-pdfbar'), /Page\s+of 3/);
    assert.equal(await page.inputValue('.marxy-pdfbar-input'), '1');
    assert.match(await page.textContent('.marxy-pdfbar-facts'), /^PDF 1\.4 · A5$/);
    assert.equal(await page.getAttribute('.marxy-pdfbar [data-marxy-zoom="width"]', 'aria-checked'), 'true', 'it opens at Fit width');
    assert.match(await textOfPage(page, 0), /^The case for ragged lines/);
    // The canvas holds ink: pdf.js drew the page.
    const ink = await page.evaluate(() => {
      const c = document.querySelector('.marxy-pdf-page[data-marxy-page="0"] canvas');
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] < 128) n++;
      return n;
    });
    assert.ok(ink > 500, `the first page has ink (${ink} dark pixels)`);
    assert.deepEqual((await cardsOf(page)).map((c) => c.title), ['Reading', 'Facts', 'Document', 'Pages']);
    assert.match(await cardText(page, 'reading'), /Shown as a PDF/);
    await showCardPanel(page, 'contents');
    assert.equal(await page.$$eval('.marxy-pdf-thumb', (els) => els.length), 3);
    assert.deepEqual(await page.$$eval('.marxy-pdf-outline-entry', (els) => els.map((e) => e.textContent)), ['The case for ragged lines', 'Looking ahead', 'Losing the place']);
    const docFacts = await factsOf(page, 'frontmatter');
    assert.equal(docFacts.title, 'The case for ragged lines');
    assert.equal(docFacts.author, 'not set in the file');
    assert.equal(docFacts.made, '2 Mar 2025, 18:00 UTC');
    assert.equal(docFacts.page, '148 × 210 mm, A5 · 3 pages');
    assert.equal(docFacts.version, 'PDF 1.4');
    assert.equal(docFacts.scripts, 'none; forms none');
    // Read by range through the shell, never whole.
    assert.equal((await calls(page, 'readFile')).filter(([p]) => p === ESSAY).length, 0);
    // The outline goes to its page.
    await showCardPanel(page, 'contents');
    await page.click('.marxy-pdf-outline-entry:text-is("Losing the place")');
    await page.waitForFunction(() => document.querySelector('.marxy-pdfbar-input').value === '3');
    // Zoom: + steps up from the fit and leaves it; Fit page fits the page.
    const before = await page.textContent('.marxy-pdfbar-zoom');
    await page.click('.marxy-pdfbar button[aria-label="Larger"]');
    assert.notEqual(await page.textContent('.marxy-pdfbar-zoom'), before);
    assert.equal(await page.getAttribute('.marxy-pdfbar [data-marxy-zoom="width"]', 'aria-checked'), 'false');
    await page.click('.marxy-pdfbar [data-marxy-zoom="page"]');
    const fits = await page.evaluate(() => {
      const s = document.querySelector('.marxy-pdf-stage');
      const p = document.querySelector('.marxy-pdf-page');
      return p.getBoundingClientRect().height <= s.clientHeight;
    });
    assert.ok(fits, 'Fit page shows a whole page');
  });
});

test('a PDF opened with Outline shown opens at its first page: the dot that follows the page never draws one to find it', async () => {
  await withFrame({ files: FILES, open: ['/r/README.md'] }, async (page) => {
    await showPanel(page, 'outline');
    await page.evaluate((p) => window.__marxyHandle.open(p), ESSAY);
    await page.waitForFunction(() => document.querySelector('.marxy-drawer [data-marxy-left-row="u:page=3"]'), null, { timeout: 30000 });
    await page.waitForFunction(() => document.querySelector('.marxy-viewer-mount:not([hidden]) .marxy-pdf-page[data-marxy-page="0"] .marxy-pdf-text span'), null, { timeout: 30000 });
    await scrollSettled(page, '.marxy-viewer-mount:not([hidden]) .marxy-pdf-stage');
    const at = await page.evaluate(() => ({
      top: document.querySelector('.marxy-viewer-mount:not([hidden]) .marxy-pdf-stage').scrollTop,
      drawn: [...document.querySelectorAll('.marxy-viewer-mount:not([hidden]) .marxy-pdf-page')].map((e) => Number(e.dataset.marxyPage)),
    }));
    assert.ok(at.top < 100, `the stage stays at its top: ${at.top}`);
    assert.ok(at.drawn.includes(0), `page 1 is drawn: ${at.drawn}`);
  });
});

test('find on a viewer\'s page sits under its bar, so the bar\'s right end stays in reach', async () => {
  await withFrame({ files: FILES, open: [ESSAY] }, async (page, { mod }) => {
    await page.waitForSelector('.marxy-viewer-mount:not([hidden]) .marxy-pdfbar');
    await page.click('.marxy-pdf-stage');
    await page.keyboard.press(`${mod}+KeyF`);
    await page.waitForSelector('.marxy-find:not([hidden])');
    const box = await page.evaluate(() => ({
      find: document.querySelector('.marxy-find').getBoundingClientRect().top,
      bar: document.querySelector('.marxy-viewer-mount:not([hidden]) .marxy-pdfbar').getBoundingClientRect().bottom,
    }));
    assert.ok(box.find >= box.bar, `find at ${box.find}, the bar ends at ${box.bar}`);
  });
});

test('Find in the page reaches the text layer, page by page; the text layer selects the words', async () => {
  await withFrame({ files: FILES, open: [ESSAY] }, async (page, { mod }) => {
    await page.waitForFunction(() => document.querySelector('.marxy-pdf-page[data-marxy-page="0"] .marxy-pdf-text span'), null, { timeout: 30000 });
    await page.click('.marxy-pdf-stage');
    await page.keyboard.press(`${mod}+f`);
    // The word in one input: typed a key at a time under load, 'plac' can be matched and counted '1 of 2' while 'place' is
    // still being read page by page, and an Enter then steps from no match to the first.
    await page.fill('.marxy-find-input', 'place');
    await page.waitForFunction(() => document.querySelector('.marxy-find-count')?.textContent === '1 of 2', null, { timeout: 15000 });
    await page.waitForFunction(() => document.querySelector('.marxy-pdfbar-input').value === '3');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('.marxy-find-count')?.textContent === '2 of 2');
    await page.keyboard.press('Shift+Enter');
    await page.waitForFunction(() => document.querySelector('.marxy-find-count')?.textContent === '1 of 2');
    await page.keyboard.press('Escape');
    // A selection over the text layer is the PDF's words. A page's text layer is drawn after the page scrolls into view.
    await page.waitForFunction(
      () => [...document.querySelectorAll('.marxy-pdf-page[data-marxy-page="2"] .marxy-pdf-text span')].some((s) => s.textContent.startsWith('Losing the')),
      null,
      { timeout: 15000 },
    );
    const said = await page.evaluate(() => {
      const span = [...document.querySelectorAll('.marxy-pdf-page[data-marxy-page="2"] .marxy-pdf-text span')].find((s) => s.textContent.startsWith('Losing the'));
      const r = document.createRange();
      r.setStart(span.firstChild, 0);
      r.setEnd(span.firstChild, 6);
      getSelection().removeAllRanges();
      getSelection().addRange(r);
      return getSelection().toString();
    });
    assert.equal(said, 'Losing');
  });
});

test('a new query over a long PDF never shows the last query\'s count while its own pages are still being read', async () => {
  await withFrame({ files: FILES, open: [LONG] }, async (page, { mod }) => {
    await page.waitForFunction(() => document.querySelector('.marxy-pdf-page[data-marxy-page="0"] .marxy-pdf-text span'), null, { timeout: 30000 });
    await page.click('.marxy-pdf-stage');
    await page.keyboard.press(`${mod}+f`);
    await page.fill('.marxy-find-input', 'Page 1 of');
    await page.waitForFunction(() => /^1 of 1$/.test(document.querySelector('.marxy-find-count')?.textContent ?? ''), null, { timeout: 60000 });
    await page.evaluate(() => {
      const el = document.querySelector('.marxy-find-count');
      window.__counts = [];
      new MutationObserver(() => window.__counts.push(el.textContent)).observe(el, { childList: true, characterData: true, subtree: true });
    });
    await page.fill('.marxy-find-input', 'Nothing');
    const at = () => page.textContent('.marxy-find-count');
    assert.doesNotMatch(await at(), /^1 of 1$/, 'the first count is gone the moment the second query is typed');
    await page.waitForFunction(() => /^\d+ of [1-9]\d* · still counting$/.test(document.querySelector('.marxy-find-count')?.textContent ?? ''), null, { timeout: 60000 });
    await page.waitForFunction(() => /^\d+ of 399$/.test(document.querySelector('.marxy-find-count')?.textContent ?? ''), null, { timeout: 90000 });
    const seen = await page.evaluate(() => window.__counts);
    // The first query's count, finished, is exactly "1 of 1"; the second's own first page may read "1 of 1 · still counting".
    assert.ok(!seen.some((t) => /^1 of 1$/.test(t)), `counts seen: ${seen.join(' | ')}`);
  });
});

test('Find stays live over a PDF made again after it changed on disk: its marks come back, and Enter steps in the new page', async () => {
  await withFrame({ files: FILES, open: [ESSAY] }, async (page, { mod }) => {
    await page.waitForFunction(() => document.querySelector('.marxy-pdf-page[data-marxy-page="0"] .marxy-pdf-text span'), null, { timeout: 30000 });
    await page.click('.marxy-pdf-stage');
    await page.keyboard.press(`${mod}+f`);
    // The word in one input: typed a key at a time under load, 'plac' can be matched and counted '1 of 2' while 'place' is
    // still being read page by page, and an Enter then steps from no match to the first.
    await page.fill('.marxy-find-input', 'place');
    await page.waitForFunction(() => document.querySelector('.marxy-find-count')?.textContent === '1 of 2', null, { timeout: 15000 });
    const viewer = () => page.evaluate(() => { window.__viewers ??= []; const v = window.__marxyHandle.panes().focused.view.viewer(); if (!window.__viewers.includes(v)) window.__viewers.push(v); return window.__viewers.indexOf(v); });
    assert.equal(await viewer(), 0);
    await page.evaluate((p) => window.__marxyHandle.shell.emit([{ kind: 'modified', path: p }]), ESSAY);
    await page.waitForFunction(() => { const v = window.__marxyHandle.panes().focused.view.viewer(); return v && !(window.__viewers ?? []).includes(v); }, null, { timeout: 15000 });
    assert.equal(await viewer(), 1, 'the page was made again');
    await page.waitForFunction(() => (CSS.highlights.get('marxy-find')?.size ?? 0) > 0 && (CSS.highlights.get('marxy-find-current')?.size ?? 0) > 0, null, { timeout: 15000 });
    await page.focus('.marxy-find-input');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('.marxy-find-count')?.textContent === '2 of 2');
    const current = await page.evaluate(() => [...CSS.highlights.get('marxy-find-current')].map((r) => r.startContainer.isConnected));
    assert.deepEqual(current, [true], 'the current match is in the page on screen');
  });
});

test('the place is kept: Source shows the bytes, and Read comes back where it was', async () => {
  await withFrame({ files: FILES, open: [ESSAY] }, async (page) => {
    await page.waitForSelector('.marxy-pdf-page');
    await page.fill('.marxy-pdfbar-input', '2');
    await page.press('.marxy-pdfbar-input', 'Enter');
    await page.waitForFunction(() => document.querySelector('.marxy-pdfbar-input').value === '2');
    const top = await page.$eval('.marxy-pdf-stage', (s) => s.scrollTop);
    await page.click('.marxy-rs-source');
    await page.waitForFunction(() => document.querySelector('.marxy-hexrow .marxy-hex-b i')?.textContent === '25', null, { timeout: 15000 });
    assert.equal(await page.$('.marxy-pdf-page'), null, 'Source is the hex view');
    await page.click('.marxy-rs-read');
    await page.waitForSelector('.marxy-pdf-page');
    const back = await page.$eval('.marxy-pdf-stage', (s) => s.scrollTop);
    assert.ok(Math.abs(back - top) < 24, `scrollTop ${top} -> ${back}`);
    assert.equal(await page.inputValue('.marxy-pdfbar-input'), '2');
  });
});

test('a 400-page PDF draws only the pages near the view, and its last page is one key away', async () => {
  await withFrame({ files: FILES, open: [LONG] }, async (page) => {
    await page.waitForFunction(() => document.querySelector('.marxy-pdf-page[data-marxy-page="0"] .marxy-pdf-text span'), null, { timeout: 30000 });
    assert.match(await page.innerText('.marxy-pdfbar'), /of 400/);
    assert.ok((await drawn(page)).length <= 4, `pages in the DOM: ${(await drawn(page)).join(', ')}`);
    await page.click('.marxy-pdf-stage');
    await page.keyboard.press('End');
    await page.waitForFunction(() => document.querySelector('.marxy-pdf-page[data-marxy-page="399"] .marxy-pdf-text span'), null, { timeout: 30000 });
    assert.match(await textOfPage(page, 399), /Page 400 of 400/);
    const shown = await drawn(page);
    assert.equal((await calls(page, 'readFile')).filter(([p]) => p === LONG).length, 0, 'never read whole');
    assert.ok(shown.length <= 4 && !shown.includes(0), `pages in the DOM: ${shown.join(', ')}`);
  });
});

test('a PDF with no extension opens by its bytes, guessed; a broken one is the card that says why', async () => {
  await withFrame({ files: FILES, open: ['/r/downloads/report'] }, async (page) => {
    await page.waitForSelector('.marxy-pdf-page', { timeout: 30000 });
    // The head keeps its guess mark current but does not draw it: read it as frame-tables does, by its hidden attribute.
    assert.equal(await page.$eval('.marxy-head .marxy-guess', (g) => (g.hidden ? null : g.textContent)), 'PDF · guessed');
    assert.match(await cardText(page, 'reading'), /guessed from its first bytes; the name did not say/);
  });
  await withFrame({ files: FILES, open: ['/r/broken.pdf'] }, async (page) => {
    await page.waitForSelector('.marxy-fcard', { timeout: 30000 });
    assert.match(await page.innerText('.marxy-fcard'), /A PDF the app cannot read/i);
  });
});
