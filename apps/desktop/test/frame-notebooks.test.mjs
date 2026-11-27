// A Jupyter notebook: read as its cells, code coloured as fences are, outputs as saved, and nothing in
// it run: not the script, the event handler or the image from the network in an HTML output, not the JavaScript output
// (shown as written on request), not the SVG's script. The panel's fourth card is Cells, its metadata slot Notebook;
// find reads the page; Source is the JSON. The file is the demo's (fixtures/demo, tide-heights.ipynb).
// Playwright WebKit.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as nodeTest } from 'node:test';
import { idle, skip, withApp } from './support/kit.mjs';
import { panelHero, panelKvs, panelSecs, panelText, showPanel } from './support/frame.mjs';

const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);

const demo = join(fileURLToPath(new URL('../../../', import.meta.url)), 'fixtures', 'demo');
const NB = '/r/notebooks/tide-heights.ipynb';
/** An SVG output whose script would set the flag, and a Markdown output, beside the demo's notebook. */
const EXTRA = JSON.stringify({
  cells: [
    { cell_type: 'markdown', metadata: {}, source: ['# Extras\n', '\n', 'Outputs of other kinds.'] },
    {
      cell_type: 'code',
      execution_count: 1,
      metadata: {},
      outputs: [
        { output_type: 'display_data', metadata: {}, data: { 'image/svg+xml': '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20" onload="window.__nbRan = 4"><script>window.__nbRan = 5</script><rect width="40" height="20" fill="#2e6ebe"/></svg>' } },
        { output_type: 'display_data', metadata: {}, data: { 'text/markdown': 'A **Markdown** output.' } },
      ],
      source: ['draw()'],
    },
  ],
  metadata: { kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' }, language_info: { name: 'python' } },
  nbformat: 4,
  nbformat_minor: 5,
});
const FILES = {
  '/r/README.md': '# Here\n\nA page.\n',
  [NB]: readFileSync(join(demo, 'notebooks', 'tide-heights.ipynb')),
  '/r/notebooks/extras.ipynb': EXTRA,
};

/** Opens `path` in the focused pane once a listener can see every request the page makes for it. */
const open = async (page, path) => {
  await showPanel(page, 'metadata');
  await page.evaluate((p) => window.__marxyHandle.open(p), path);
  await page.waitForFunction((p) => document.querySelector('.marxy-drawer .marxy-l-subject')?.textContent === p.slice(p.lastIndexOf('/') + 1), path);
  await page.waitForSelector('.marxy-notebook');
};
const ran = (page) => page.evaluate(() => ({ flag: window.__nbRan ?? null, ground: document.body.style.background }));
/** Metadata's "Written in it" for a notebook: the Notebook card's rows. */
const notebookRows = async (page) => {
  const kv = await panelKvs(page, 'metadata');
  return Object.fromEntries(['kernel', 'language', 'format', 'cells', 'outputs', 'runs'].map((k) => [k, kv[k]]));
};

test('a notebook reads as its cells: Markdown set, code coloured in the kernel’s language, outputs as saved, nothing run', async () => {
  await withApp({ files: FILES, open: ['/r/README.md'] }, async (page) => {
    const away = [];
    page.on('request', (r) => {
      if (!/^(https?:\/\/(localhost|127\.0\.0\.1)[:/]|data:|blob:)/.test(r.url())) away.push(r.url());
    });
    await open(page, NB);
    assert.match(await page.textContent('.marxy-notebook > .marxy-account .marxy-reading-head'), /^Jupyter notebook · Python 3 \(ipykernel\) · 9 cells: 3 Markdown, 6 code$/);
    assert.match(await page.textContent('.marxy-notebook > .marxy-account .marxy-account-body'), /Marxy has no kernel and runs nothing\./);
    assert.equal(await page.textContent('.marxy-notebook h1'), 'Tide heights at the harbour');
    // Code cells are fences in the kernel's language, coloured by the page's highlight pass.
    assert.equal(await page.locator('.marxy-nb-code > pre.language-python[data-marxy-lang="python"]').count(), 6);
    await page.waitForFunction(() => document.querySelector('[data-marxy-cell="1"] pre code')?.dataset.marxyDone === 'highlight');
    assert.ok(await page.locator('[data-marxy-cell="1"] pre [class^="marxy-tok-"]').count() > 0, 'coloured');
    // Run numbers are drawn from an attribute in the margin: not in the text find and copy read.
    assert.equal(await page.getAttribute('[data-marxy-cell="2"]', 'data-marxy-run'), '2');
    assert.doesNotMatch(await page.textContent('[data-marxy-cell="2"]'), /\[2\]/);
    // The pandas table, cleaned and said.
    assert.equal(await page.locator('[data-marxy-cell="2"] .marxy-nb-html td').count(), 10);
    assert.equal(await page.textContent('[data-marxy-cell="2"] .marxy-nb-note'), 'HTML output, cleaned: 1 style block left out.');
    // The figure, drawn from the data URL the notebook carries.
    await page.waitForFunction(() => document.querySelector('.marxy-nb-img')?.complete && document.querySelector('.marxy-nb-img').naturalWidth === 600);
    // Cell 5: the HTML output's script, handler and network image left out, the JavaScript output not run.
    const five = await page.innerText('[data-marxy-cell="6"] .marxy-nb-outputs');
    assert.match(five, /An interactive chart\. It needs JavaScript\./);
    assert.match(five, /HTML output, cleaned: 1 script, 1 event handler, 1 image from the network, 1 other part left out\./);
    assert.match(five, /A JavaScript output, 1 line: never run\. Show it as written/);
    assert.equal(await page.locator('.marxy-notebook script, .marxy-notebook iframe, .marxy-notebook [onerror], .marxy-notebook [onload]').count(), 0);
    assert.equal(await page.locator('.marxy-notebook img[src^="http"]').count(), 0);
    // The traceback: its name and message, then its text with no colour codes, and how many were left out.
    assert.equal(await page.textContent('.marxy-nb-ename'), "KeyError: '2026-10-13'");
    const tb = await page.textContent('.marxy-nb-error pre');
    assert.ok(!tb.includes('\u001b') && !/\[0;3\dm/.test(tb), 'no colour codes');
    assert.match(tb, /Traceback \(most recent call last\)/);
    assert.match(await page.textContent('.marxy-nb-error .marxy-nb-note'), /^27 colour codes in the traceback left out; Source has them\.$/);
    await idle(page);
    assert.deepEqual(await ran(page), { flag: null, ground: '' }, 'nothing in the notebook ran');
    assert.deepEqual(away, [], 'nothing was fetched from the network');
  });
});

test('a JavaScript output is shown as written on request, and still never runs', async () => {
  await withApp({ files: FILES, open: [NB] }, async (page) => {
    await page.waitForSelector('.marxy-notebook');
    const asis = page.locator('[data-marxy-cell="6"] details.marxy-nb-asis');
    assert.equal(await asis.getAttribute('open'), null);
    assert.equal(await page.isVisible('[data-marxy-cell="6"] details.marxy-nb-asis pre'), false);
    await page.click('[data-marxy-cell="6"] details.marxy-nb-asis > summary');
    await page.waitForSelector('[data-marxy-cell="6"] details.marxy-nb-asis[open] pre', { state: 'visible' });
    assert.equal(await page.textContent('[data-marxy-cell="6"] details.marxy-nb-asis pre'), 'window.__nbRan = 3;');
    await idle(page);
    assert.deepEqual(await ran(page), { flag: null, ground: '' });
  });
});

test('the panels: Cells in Outline, each row going to its cell, and Notebook written in it in Metadata', async () => {
  await withApp({ files: FILES, open: [NB] }, async (page) => {
    await page.waitForSelector('.marxy-notebook');
    assert.deepEqual((await panelSecs(page, 'metadata')).find(([t]) => t === 'Written in it'), ['Written in it', 'Notebook']);
    assert.equal((await panelSecs(page, 'outline'))[0][0], 'Cells');
    const hero = await panelHero(page);
    assert.match(hero.big, /notebook/i);
    assert.match(hero.small, /its name ends \.ipynb/);
    const cells = await panelText(page, 'outline');
    for (const row of ['Tide heights at the harbour', '[1] import pandas as pd', 'Low water', '[4] plt.figure(figsize=(6, 2.6))', 'error']) assert.ok(cells.includes(row), row);
    assert.deepEqual(await notebookRows(page), {
      kernel: 'Python 3 (ipykernel)',
      language: 'python 3.12.4',
      format: 'nbformat 4.5',
      cells: '9: 3 Markdown, 6 code',
      outputs: '5 saved: 1 image, 2 HTML, 1 text, 1 error',
      runs: 'never: Marxy has no kernel; 1 JavaScript output not run',
    });
    // A row goes to its cell: cell [6] comes to the reading line.
    await showPanel(page, 'outline');
    await page.click('.marxy-drawer .marxy-l-prow:has-text("[6]")');
    await page.waitForFunction(() => {
      const r = document.querySelector('[data-marxy-cell="7"]').getBoundingClientRect();
      return r.top >= 0 && r.top < window.innerHeight * 0.6;
    });
  });
});

test('find reads the page: a word in a Markdown cell, in code and in an output', async () => {
  await withApp({ files: FILES, open: [NB] }, async (page, { mod }) => {
    await page.waitForSelector('.marxy-notebook');
    await page.click('.marxy-notebook h1');
    await page.keyboard.press(`${mod}+f`);
    await page.waitForSelector('.marxy-find input:focus');
    await page.keyboard.type('Low water');
    await page.waitForFunction(() => /\d+ of \d+/.test(document.querySelector('.marxy-find-count')?.textContent ?? ''));
    // The heading, the paragraph under it, the print in cell [3] and its output.
    assert.equal(await page.textContent('.marxy-find-count'), '1 of 4');
  });
});

test('Source is the JSON as written, and showing it runs nothing', async () => {
  await withApp({ files: FILES, open: [NB] }, async (page) => {
    await page.waitForSelector('.marxy-notebook');
    await page.click('.marxy-rs-source');
    await page.waitForFunction(() => document.querySelector('.marxy-source-mount:not([hidden]) .cm-content')?.textContent.includes('"cell_type": "markdown"'));
    assert.deepEqual(await ran(page), { flag: null, ground: '' });
  });
});

test('an SVG output is an image whose script never runs; a Markdown output is set as Markdown', async () => {
  await withApp({ files: FILES, open: ['/r/notebooks/extras.ipynb'] }, async (page) => {
    await page.waitForSelector('.marxy-notebook');
    await page.waitForFunction(() => document.querySelector('.marxy-nb-img')?.complete && document.querySelector('.marxy-nb-img').naturalWidth === 40);
    assert.match(await page.getAttribute('.marxy-nb-img', 'src'), /^data:image\/svg\+xml;charset=utf-8,/);
    assert.equal(await page.locator('.marxy-notebook svg').count(), 0, 'never inlined');
    assert.equal(await page.innerText('.marxy-nb-md-out'), 'A Markdown output.');
    assert.equal(await page.textContent('.marxy-nb-md-out strong'), 'Markdown');
    await idle(page);
    assert.deepEqual(await ran(page), { flag: null, ground: '' });
  });
});
