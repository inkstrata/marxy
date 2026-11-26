// Kinds, the rest in WebKit: a click puts the cursor on a viewer's or a reading's part; y and n
// work on any part (the tray keeps its address; a note on a kind read from bytes is kept by the part's address and drawn
// beside it); Reveal puts back what a text kind's reading left out and says plainly that a byte kind has none; z and Z
// fold a tree, one state with its summaries and the depth commands; ] [ step a kind's top level; a PDF page's text blocks
// and a picture's chunks are parts; the font's tables and the recording's sections are drawn.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test as nodeTest } from 'node:test';
import { closeHarness } from './support/two-pane.mjs';
import { showPanel, skip, withFrame } from './support/frame.mjs';

const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);
after(() => closeHarness());

const demo = join(fileURLToPath(new URL('../../../', import.meta.url)), 'fixtures', 'demo');
const fixture = (rel) => readFileSync(join(demo, rel));
const DB = '/r/data/gauges.sqlite';
const XLSX = '/r/sheets/tide-log-2026.xlsx';
const ZIP = '/r/archives/tidemark-0.5.0.zip';
const JPG = '/r/images/harbour-at-low-water.jpg';
const TTF = '/r/fonts/TidemarkSans-Regular.ttf';
const MP4 = '/r/media/ferry-leaving.mp4';
const PDF = '/r/reading/the-case-for-ragged-lines.pdf';
const JSON_TEXT = '{\n  "name": "gauges",\n  "sites": [\n    { "id": 1, "river": "Tees" },\n    { "id": 2, "river": "Wear" }\n  ],\n  "deep": {\n    "a": {\n      "b": { "c": 1 }\n    }\n  },\n  "unit": "m"\n}\n';
const YAML = '# gauges we read\nname: gauges\nsites:\n  - Tees\n  - "Wear"\nunit: m\n';
const CSV = 'site,height_m,"when, local"\nTees,1.42,2026-10-01\n"Wear, lower",0.97,2026-10-01\n';
const LOG = '2026-10-01 09:00:01 INFO started\n2026-10-01 09:00:02 WARN slow disk\n';
const BLOB = Uint8Array.from({ length: 70 }, (_, i) => (i % 5 === 0 ? 0 : (i * 7 + 3) & 0xff));
const FILES = {
  '/r/README.md': '# Here\n',
  '/r/gauges.json': JSON_TEXT,
  '/r/gauges.yaml': YAML,
  '/r/levels.csv': CSV,
  '/r/run.log': LOG,
  '/r/rows.jsonl': '{"name":"Tees","constructor":1}\n{"name":"Wear"}\n',
  '/r/blob.bin': BLOB,
  [DB]: fixture('data/gauges.sqlite'),
  [XLSX]: fixture('sheets/tide-log-2026.xlsx'),
};

const keys = async (page, ...list) => {
  for (const k of list) await page.keyboard.press(k);
};
const blur = (page) => page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
const bar = (page) =>
  page.evaluate(() => {
    const b = document.querySelector('.marxy-verb-bar');
    const shown = b && !b.hidden;
    return {
      where: shown ? b.querySelector('.marxy-verb-bar-where').textContent : null,
      what: shown ? b.querySelector('.marxy-verb-bar-what').textContent : null,
      verbs: shown ? [...b.querySelectorAll('[data-marxy-verb]')].map((v) => v.textContent.trim()) : [],
    };
  });
const waitWhere = (page, want) => page.waitForFunction((want) => document.querySelector('.marxy-verb-bar:not([hidden]) .marxy-verb-bar-where')?.textContent === want, want);
const said = (page, re) => page.waitForFunction((src) => [...document.querySelectorAll('.marxy-notice-text')].some((e) => new RegExp(src).test(e.textContent)), re.source);
const clipboard = (page) =>
  page.evaluate(() => {
    const last = window.__marxyHandle.shell.calls.filter((c) => c.method === 'clipboardWriteItem').at(-1);
    const rep = last?.args[0].find((r) => r.type === 'public.utf8-plain-text');
    return rep ? new TextDecoder().decode(rep.bytes) : null;
  });
async function diskUntil(page, path, want) {
  for (let i = 0; i < 100; i++) {
    const text = await page.evaluate(async (p) => {
      try {
        return new TextDecoder().decode(await window.__marxyHandle.shell.readFile(p));
      } catch {
        return null;
      }
    }, path);
    if (text !== null && want(text)) return text;
    await page.waitForTimeout(50);
  }
  throw new Error(`${path} never became what was wanted`);
}
const written = (page) => page.evaluate(() => window.__marxyHandle.shell.calls.filter((c) => /^write/.test(c.method) && !String(c.args[0]).startsWith('/data/')).length);

test('a click puts the cursor on a reading\'s part: a CSV cell, then a row; a double click still does what it did', async () => {
  await withFrame({ files: FILES, open: ['/r/levels.csv'] }, async (page) => {
    await page.waitForSelector('[data-marxy-reading="table"]');
    await page.click('[data-marxy-reading="table"] tbody tr:nth-child(2) td:nth-child(2)');
    await waitWhere(page, 'levels.csv:3#height_m');
    assert.equal((await bar(page)).what, 'cell height_m');
    assert.ok(await page.$('[data-marxy-reading="table"] tbody tr:nth-child(2) td:nth-child(2).marxy-cursor'), 'painted');
    // The keys go on from where the click put the cursor.
    await keys(page, 'h');
    await waitWhere(page, 'levels.csv:3');
    await keys(page, 'k');
    await waitWhere(page, 'levels.csv:2');
  });
});

test('a click on an archive\'s entry puts the cursor there; a double click still opens it', async () => {
  await withFrame({ files: { ...FILES, [ZIP]: fixture('archives/tidemark-0.5.0.zip') }, open: [ZIP] }, async (page) => {
    await page.waitForSelector('.marxy-atree');
    const row = '.marxy-arow:has(.marxy-arch-name:text-is("config.md"))';
    await page.evaluate((sel) => document.querySelector(sel)?.scrollIntoView(), row.replace(':text-is("config.md")', ''));
    await page.locator(row).scrollIntoViewIfNeeded();
    await page.click(`${row} .marxy-arch-sz`);
    await waitWhere(page, 'tidemark-0.5.0.zip!/tidemark-0.5.0/docs/config.md');
    await page.dblclick(`${row} .marxy-arch-sz`);
    await page.waitForFunction(() => document.querySelector('.marxy-article h1')?.textContent === 'Configuration');
  });
});

test('a click on a database cell, a workbook cell and a row of bytes puts the cursor there', async () => {
  await withFrame({ files: FILES, open: [DB] }, async (page) => {
    await page.waitForSelector('.marxy-tbl-grid tbody tr td');
    await page.click('.marxy-tbl-grid tbody tr:nth-child(3) td:nth-child(2)');
    await page.waitForFunction(() => /^gauges\.sqlite#[^/]+\/[^/]+\/[^/]+$/.test(document.querySelector('.marxy-verb-bar:not([hidden]) .marxy-verb-bar-where')?.textContent ?? ''));
    assert.match((await bar(page)).what, /^cell /);
    assert.ok(await page.$('.marxy-tbl-grid tbody tr:nth-child(3) td:nth-child(2).marxy-cursor'));
  });
  await withFrame({ files: FILES, open: [XLSX] }, async (page) => {
    await page.waitForSelector('.marxy-tbl-sheet tbody td[data-marxy-cell="B3"]');
    await page.click('.marxy-tbl-sheet tbody td[data-marxy-cell="B3"]');
    await page.waitForFunction(() => /!B3$/.test(document.querySelector('.marxy-verb-bar:not([hidden]) .marxy-verb-bar-where')?.textContent ?? ''));
  });
  await withFrame({ files: FILES, open: ['/r/blob.bin'] }, async (page) => {
    await page.waitForSelector('.marxy-hexrow[data-marxy-row="32"]');
    await page.click('.marxy-hexrow[data-marxy-row="32"]');
    await waitWhere(page, 'blob.bin@0x0020');
  });
});

test('y collects a part of any kind with its address; the tray quotes it with path and address', async () => {
  await withFrame({ files: FILES, open: ['/r/levels.csv'] }, async (page) => {
    await page.waitForSelector('[data-marxy-reading="table"]');
    await blur(page);
    await keys(page, 'g', 'g', 'l', 'j', 'y');
    await said(page, /Collected \/r\/levels\.csv:2#height_m · 1 in the tray/);
    await keys(page, 'h', 'y');
    await said(page, /Collected \/r\/levels\.csv:2 · 2 in the tray/);
    assert.deepEqual((await bar(page)).verbs.slice(-3), ['y collect', 'n note', 'Enter all']);
  });
  await withFrame({ files: FILES, open: [XLSX] }, async (page) => {
    await page.waitForSelector('.marxy-tbl-sheet tbody td[data-marxy-cell="B5"]');
    await page.click('.marxy-tbl-sheet tbody td[data-marxy-cell="B5"]');
    await page.waitForFunction(() => /!B5$/.test(document.querySelector('.marxy-verb-bar:not([hidden]) .marxy-verb-bar-where')?.textContent ?? ''));
    const address = (await bar(page)).where.replace(/^tide-log-2026\.xlsx/, '');
    await keys(page, 'y', 'Shift+T');
    await page.waitForSelector('.marxy-apppage .marxy-piece');
    assert.equal(await page.textContent('.marxy-apppage .marxy-piece-src'), `${XLSX}${address}`);
    await page.click('.marxy-apppage [data-marxy-page-act="copy"]');
    await page.waitForFunction(() => window.__marxyHandle.shell.calls.some((c) => c.method === 'clipboardWriteItem'));
    assert.match(await clipboard(page), new RegExp(`^> 434\\n\\n— \`${XLSX.replace(/[.]/g, '\\.')}${address.replace(/[!]/g, '\\!')}\`\\n$`));
    // Its source button goes back to the part.
    await page.click('.marxy-apppage .marxy-piece-src');
    await page.waitForFunction((a) => document.querySelector('.marxy-verb-bar:not([hidden]) .marxy-verb-bar-where')?.textContent === `tide-log-2026.xlsx${a}`, address);
  });
});

test('n on a part of a kind read from text anchors by its lines; on a byte kind by its address, drawn beside the part, kept in notes.json', async () => {
  await withFrame({ files: FILES, open: ['/r/gauges.json'], viewport: { width: 1600, height: 900 } }, async (page) => {
    await page.waitForSelector('[data-marxy-reading="tree"]');
    await blur(page);
    await keys(page, 'g', 'g', 'j', 'n');
    await page.waitForSelector('.marxy-mnote-field');
    await page.keyboard.type('Two sites');
    await page.keyboard.press('Control+Enter');
    await page.waitForSelector('.marxy-article .marxy-mnote:not(:has(textarea))');
    const sidecar = JSON.parse(await diskUntil(page, '/data/notes.json', (t) => t.includes('Two sites')));
    assert.deepEqual(sidecar.files['/r/gauges.json'], [{ l0: 2, l1: 6, key: '  "sites": [', text: 'Two sites' }]);
  });
  await withFrame({ files: FILES, open: ['/r/blob.bin'], viewport: { width: 1600, height: 900 } }, async (page) => {
    await page.waitForSelector('.marxy-hexrow[data-marxy-row="16"]');
    await blur(page);
    await keys(page, 'g', 'g', 'j', 'n');
    await page.waitForSelector('.marxy-mnote-layer .marxy-mnote-field');
    await page.keyboard.type('Odd bytes here');
    await page.keyboard.press('Control+Enter');
    await page.waitForSelector('.marxy-mnote-layer .marxy-mnote:not(:has(textarea))');
    const place = await page.evaluate(() => {
      const n = document.querySelector('.marxy-mnote-layer .marxy-mnote').getBoundingClientRect();
      const row = document.querySelector('.marxy-hexrow[data-marxy-row="16"]').getBoundingClientRect();
      return { at: document.querySelector('.marxy-mnote-layer .marxy-mnote').getAttribute('data-marxy-mnote-at'), beside: n.left >= row.right - 1 && Math.abs(n.top - row.top) < 4, under: n.top >= row.bottom - 1 };
    });
    assert.ok(place.at === 'margin' ? place.beside : place.under, JSON.stringify(place));
    const sidecar = JSON.parse(await diskUntil(page, '/data/notes.json', (t) => t.includes('Odd bytes')));
    assert.deepEqual(sidecar.files['/r/blob.bin'], [{ l0: 0, l1: 0, key: '', text: 'Odd bytes here', address: '@0x0010' }]);
    assert.equal(await written(page), 0, 'nothing written but notes.json');
  });
});

const run = (page, id) =>
  page.evaluate(async (command) => {
    const { buildAppContext } = await import('/src/selection/bind.ts');
    const handle = window.__marxyHandle;
    await handle.commands().find((c) => c.id === command).run(buildAppContext(handle));
  }, id);
const shown = (page, sel) => page.evaluate((s) => document.querySelector(s)?.innerText.replace(/\s+/g, ' ').trim() ?? null, sel);
const leafText = (page, key) =>
  page.evaluate((k) => [...document.querySelectorAll('[data-marxy-pane="0"] .marxy-tree-leaf')].find((l) => l.querySelector('.marxy-tree-key')?.textContent === k)?.innerText.replace(/\s+/g, ' ').trim() ?? null, key);
const marks = (page) => page.$$eval('[data-marxy-pane="0"] .marxy-article .marxy-reveal-mark', (els) => els.map((e) => e.textContent));

test('Reveal on a data tree puts back its quotes, colons, commas and brackets from the bytes; X again takes them away', async () => {
  await withFrame({ files: FILES, open: ['/r/gauges.json'] }, async (page) => {
    await page.waitForSelector('[data-marxy-reading="tree"]');
    await blur(page);
    assert.equal(await leafText(page, 'name'), 'name “gauges”');
    await keys(page, 'Shift+X');
    await page.waitForSelector('.marxy-article[data-marxy-reveal] .marxy-reveal-mark');
    assert.equal(await leafText(page, 'name'), '"name": "gauges",');
    assert.equal(await leafText(page, 'unit'), '"unit": "m"');
    const all = await marks(page);
    assert.equal(all[0], '{', 'the file opens with its brace');
    assert.equal(all.at(-1), '}', 'and closes with it');
    assert.ok(all.includes('],'), 'a list closes with its bracket and the comma after it');
    assert.equal(await shown(page, '.marxy-tree-branch > summary'), '"sites": [ [ ] 2 items');
    assert.equal(await written(page), 0);
    // A redraw of the page keeps Reveal on.
    await page.evaluate(() => window.__marxyHandle.relayout());
    await page.waitForFunction(() => document.querySelector('.marxy-article[data-marxy-reveal] .marxy-reveal-mark'));
    await keys(page, 'Shift+X');
    await page.waitForFunction(() => !document.querySelector('.marxy-article .marxy-reveal-mark'));
    assert.equal(await leafText(page, 'name'), 'name “gauges”');
  });
});

test('Reveal on YAML: its comment, its dashes and a quoted value as written', async () => {
  await withFrame({ files: FILES, open: ['/r/gauges.yaml'] }, async (page) => {
    await page.waitForSelector('[data-marxy-reading="tree"]');
    await blur(page);
    await keys(page, 'Shift+X');
    await page.waitForSelector('.marxy-article[data-marxy-reveal] .marxy-reveal-mark');
    const all = await marks(page);
    assert.equal(all[0], '# gauges we read');
    assert.ok(all.includes('-'), all.join('|'));
    assert.ok(all.includes('"Wear"'), all.join('|'));
    assert.equal(await leafText(page, 'name'), 'name: gauges');
  });
});

test('Reveal on a CSV: the quotes and delimiters each row is written with', async () => {
  await withFrame({ files: FILES, open: ['/r/levels.csv'] }, async (page) => {
    await page.waitForSelector('[data-marxy-reading="table"]');
    await blur(page);
    await keys(page, 'Shift+X');
    await page.waitForSelector('.marxy-article[data-marxy-reveal] .marxy-reveal-mark');
    const row = (sel) => page.$$eval(sel, (cells) => cells.map((c) => c.innerText.replace(/\s+/g, ' ').trim()));
    assert.deepEqual(await row('[data-marxy-reading="table"] thead th'), ['site,', 'height_m,', '"when, local"']);
    assert.deepEqual(await row('[data-marxy-reading="table"] tbody tr:nth-child(2) td'), ['"Wear, lower",', '0.97,', '2026-10-01']);
    // The cursor never takes a mark for a part, and c still copies the cell's value.
    await keys(page, 'g', 'g', 'j', 'l', 'c');
    await page.waitForFunction(() => window.__marxyHandle.shell.calls.some((c) => c.method === 'clipboardWriteItem'));
    assert.equal(await clipboard(page), 'Wear, lower');
  });
});

test('Reveal on JSON Lines puts back the keys each record writes, and none it does not (a key named like Object\'s own)', async () => {
  await withFrame({ files: FILES, open: ['/r/rows.jsonl'] }, async (page) => {
    await page.waitForSelector('[data-marxy-reading="records"] tbody tr');
    await blur(page);
    await keys(page, 'Shift+X');
    await page.waitForSelector('.marxy-article[data-marxy-reveal] .marxy-reveal-mark');
    const row = (n) => page.$$eval(`[data-marxy-reading="records"] tbody tr:nth-child(${n}) td`, (cells) => cells.map((c) => [...c.querySelectorAll('.marxy-reveal-mark')].map((m) => m.textContent).join('')));
    assert.deepEqual(await row(1), ['{"name": "",', '"constructor": }']);
    assert.equal((await row(2))[1], '', 'the second record writes no "constructor"');
  });
});

test('Reveal on a log draws each entry\'s stamp as the file writes it; a byte kind has no Reveal and says so', async () => {
  await withFrame({ files: FILES, open: ['/r/run.log'] }, async (page) => {
    await page.waitForSelector('pre.language-log .marxy-line .marxy-log-time');
    await blur(page);
    const size = () => page.evaluate(() => getComputedStyle(document.querySelector('pre.language-log .marxy-log-time')).fontSize);
    assert.equal(await size(), '0px');
    await keys(page, 'g', 'g', 'Shift+X');
    await page.waitForSelector('.marxy-article[data-marxy-reveal]');
    assert.notEqual(await size(), '0px');
    assert.match(await page.evaluate(() => document.querySelector('pre.language-log .marxy-line').innerText), /^2026-10-01 09:00:01 INFO/);
  });
  await withFrame({ files: FILES, open: [DB] }, async (page) => {
    await page.waitForSelector('.marxy-tbl-grid tbody tr td');
    await blur(page);
    await keys(page, 'Shift+X');
    await said(page, /A database is read from the file's bytes: there is no markup for Reveal to put back/);
  });
});

test('z folds a tree\'s branch and Z folds it to the second level: one state with its summaries and the depth commands, kept across a redraw', async () => {
  await withFrame({ files: FILES, open: ['/r/gauges.json'] }, async (page) => {
    await page.waitForSelector('[data-marxy-reading="tree"]');
    const open = () =>
      page.evaluate(() =>
        Object.fromEntries([...document.querySelectorAll('[data-marxy-pane="0"] details.marxy-tree-branch')].map((d) => [d.querySelector(':scope > summary :is(.marxy-tree-key, .marxy-tree-index)')?.textContent, d.open])),
      );
    const all = (o) => ({ sites: o, 0: o, 1: o, deep: o, a: o, b: o });
    assert.deepEqual(await open(), { ...all(true), b: false }, 'drawn open to two levels');
    await blur(page);
    await keys(page, 'g', 'g', 'j');
    await waitWhere(page, 'gauges.json:3–6');
    await keys(page, 'z');
    await page.waitForFunction(() => !document.querySelector('details.marxy-tree-branch').open);
    assert.equal((await bar(page)).where, 'gauges.json:3–6', 'the cursor stays on the branch');
    await keys(page, 'j', 'l', 'z');
    assert.deepEqual(await open(), { ...all(true), sites: false, a: false, b: false });
    assert.equal((await bar(page)).where, 'gauges.json:8–10');
    // From a leaf, z folds the branch holding it and the cursor goes there.
    await keys(page, 'Shift+G', 'z');
    assert.equal((await bar(page)).where, 'gauges.json:12', 'a leaf at the top folds nothing');
    await keys(page, 'g', 'g', 'j', 'z', 'l', 'l', 'z');
    assert.equal((await bar(page)).where, 'gauges.json:4', 'the cursor went out to the item holding the leaf');
    assert.deepEqual(await open(), { ...all(true), 0: false, a: false, b: false });
    await keys(page, 'Shift+Z');
    assert.deepEqual(await open(), { ...all(false), sites: true, deep: true }, 'to the second level');
    // A summary pressed by hand is the same state, and a redraw keeps it.
    await page.click('details.marxy-tree-branch:has(> summary .marxy-tree-key:text-is("a")) > summary');
    await page.evaluate(() => window.__marxyHandle.relayout());
    await page.waitForTimeout(200);
    assert.deepEqual(await open(), { ...all(false), sites: true, deep: true, a: true });
    // The depth commands fold the same tree: depth 1 closes the top level's branches.
    await run(page, 'source.fold-depth-1');
    assert.deepEqual(await open(), all(false));
    await blur(page);
    await keys(page, 'Shift+Z');
    assert.deepEqual(await open(), all(true), 'Z on a folded tree opens it all');
    await keys(page, 'Shift+Z');
    assert.deepEqual(await open(), { ...all(false), sites: true, deep: true });
    assert.equal(await written(page), 0);
  });
});

test('Outline\'s depth switch on a data tree is the same fold state: Z then opens it all, and a redraw keeps it', async () => {
  await withFrame({ files: FILES, open: ['/r/gauges.json'] }, async (page) => {
    await page.waitForSelector('[data-marxy-reading="tree"]');
    const open = () =>
      page.evaluate(() =>
        Object.fromEntries([...document.querySelectorAll('[data-marxy-pane="0"] details.marxy-tree-branch')].map((d) => [d.querySelector(':scope > summary :is(.marxy-tree-key, .marxy-tree-index)')?.textContent, d.open])),
      );
    const all = (o) => ({ sites: o, 0: o, 1: o, deep: o, a: o, b: o });
    await showPanel(page, 'outline');
    const depth = async (n) => {
      await page.click(`.marxy-drawer .marxy-l-sg button:text-is("${n}")`);
      await page.waitForFunction((n) => document.querySelector('.marxy-drawer .marxy-l-sg button[aria-pressed="true"]')?.textContent === n, n);
    };
    await depth('1');
    assert.deepEqual(await open(), { ...all(false), sites: true, deep: true }, 'the top level open, the rest closed');
    await page.evaluate(() => window.__marxyHandle.relayout());
    await page.waitForTimeout(200);
    assert.deepEqual(await open(), { ...all(false), sites: true, deep: true }, 'a redraw keeps it');
    await blur(page);
    await keys(page, 'Shift+Z');
    assert.deepEqual(await open(), all(true), 'Z sees the tree folded and opens it all');
    await depth('2');
    assert.deepEqual(await open(), { ...all(true), b: false }, 'two levels open');
    await depth('all');
    assert.deepEqual(await open(), all(true));
    assert.equal(await written(page), 0);
  });
});

const NB = '/r/notebooks/tide-heights.ipynb';
const PNG = '/r/images/tidemark-icon.png';
const MORE = {
  ...FILES,
  [NB]: fixture('notebooks/tide-heights.ipynb'),
  [JPG]: fixture('images/harbour-at-low-water.jpg'),
  [PNG]: fixture('images/tidemark-icon.png'),
  [TTF]: fixture('fonts/TidemarkSans-Regular.ttf'),
  [MP4]: fixture('media/ferry-leaving.mp4'),
  [PDF]: fixture('reading/the-case-for-ragged-lines.pdf'),
  [ZIP]: fixture('archives/tidemark-0.5.0.zip'),
};

test('] [ step a kind\'s top level where it names no outline of its own: a notebook\'s cells, a tree\'s nodes', async () => {
  await withFrame({ files: MORE, open: [NB] }, async (page) => {
    await page.waitForSelector('[data-marxy-reading="notebook"] section[data-marxy-cell]');
    await blur(page);
    await keys(page, ']');
    await waitWhere(page, 'tide-heights.ipynb#cell=0');
    await keys(page, ']', ']');
    await waitWhere(page, 'tide-heights.ipynb#cell=2');
    // From inside a cell, [ goes to the cell's own top first.
    await keys(page, 'l', '[');
    await waitWhere(page, 'tide-heights.ipynb#cell=2');
    await keys(page, '[');
    await waitWhere(page, 'tide-heights.ipynb#cell=1');
  });
  await withFrame({ files: MORE, open: ['/r/gauges.json'] }, async (page) => {
    await page.waitForSelector('[data-marxy-reading="tree"]');
    await blur(page);
    await keys(page, ']', ']');
    await waitWhere(page, 'gauges.json:3–6');
    await keys(page, 'l', 'l', ']');
    await waitWhere(page, 'gauges.json:7–11');
  });
});

test('Reveal on a notebook fences each code cell\'s source with its language', async () => {
  await withFrame({ files: MORE, open: [NB] }, async (page) => {
    await page.waitForSelector('[data-marxy-reading="notebook"] section.marxy-nb-code');
    await blur(page);
    await keys(page, 'Shift+X');
    await page.waitForSelector('section.marxy-nb-code > .marxy-reveal-mark');
    const fence = await page.evaluate(() => {
      const pre = document.querySelector('section.marxy-nb-code > pre');
      return [pre.previousElementSibling.textContent, pre.nextElementSibling.textContent];
    });
    assert.match(fence[0], /^```\w+$/);
    assert.equal(fence[1], '```');
  });
});

test('a PDF page\'s text blocks are its parts: l goes in, c copies a block\'s words, y keeps its address, a click on a page puts the cursor there', async () => {
  await withFrame({ files: MORE, open: [PDF] }, async (page) => {
    await page.waitForFunction(() => document.querySelector('.marxy-pdf-page[data-marxy-page="0"] .marxy-pdf-text span'), null, { timeout: 30000 });
    await page.waitForTimeout(300);
    await blur(page);
    await keys(page, 'g', 'g', 'l');
    await waitWhere(page, 'the-case-for-ragged-lines.pdf#page=1/block=1');
    assert.equal((await bar(page)).what, 'block');
    assert.ok(await page.$('.marxy-pdf-page[data-marxy-page="0"] .marxy-pdf-block.marxy-cursor'), 'a box over the block\'s words');
    assert.ok(!(await page.$('.marxy-pdf-page[data-marxy-page="0"].marxy-cursor')), 'the page is not the cursor then');
    await keys(page, 'c');
    await page.waitForFunction(() => window.__marxyHandle.shell.calls.some((c) => c.method === 'clipboardWriteItem'));
    assert.match(await clipboard(page), /^The case for ragged lines/);
    await keys(page, 'j');
    await waitWhere(page, 'the-case-for-ragged-lines.pdf#page=1/block=2');
    await keys(page, 'y');
    await said(page, /Collected \/r\/reading\/the-case-for-ragged-lines\.pdf#page=1\/block=2/);
    await keys(page, 'h');
    await waitWhere(page, 'the-case-for-ragged-lines.pdf#page=1');
    // A page is made only near the view; a page is taller than the screen, so scroll toward the second.
    await page.evaluate(() => { const s = document.querySelector('.marxy-pdf-stage'); s.scrollTop = s.scrollHeight / 3; });
    await page.waitForSelector('.marxy-pdf-page[data-marxy-page="1"]');
    await page.click('.marxy-pdf-page[data-marxy-page="1"]', { position: { x: 5, y: 5 } });
    await waitWhere(page, 'the-case-for-ragged-lines.pdf#page=2');
  });
});

test('a picture\'s chunks are parts: l into its structure, the bar speaks each offset, c copies its line, x its bytes; a PNG\'s chunks too', async () => {
  await withFrame({ files: MORE, open: [JPG] }, async (page) => {
    await page.waitForSelector('.marxy-imgstage');
    await blur(page);
    await keys(page, 'Shift+G');
    await page.waitForFunction(() => document.querySelector('.marxy-verb-bar-what')?.textContent === 'segments');
    assert.equal((await bar(page)).where, 'harbour-at-low-water.jpg#structure');
    await page.waitForSelector('.marxy-imgparts .marxy-ksec-row');
    await keys(page, 'l');
    await waitWhere(page, 'harbour-at-low-water.jpg@0x0000');
    assert.equal((await bar(page)).what, 'segment SOI');
    await keys(page, 'j');
    await waitWhere(page, 'harbour-at-low-water.jpg@0x0002');
    await keys(page, 'c');
    await page.waitForFunction(() => window.__marxyHandle.shell.calls.some((c) => c.method === 'clipboardWriteItem'));
    assert.match(await clipboard(page), /^APP\d+\t0x0002\t[\d,]+$/);
    await keys(page, 'x');
    await page.waitForSelector('[data-marxy-pane="0"] .marxy-xray');
    assert.match(await page.getAttribute('[data-marxy-pane="0"] .marxy-xray .marxy-xray-head', 'data-marxy-xray-head'), /^As stored · the APP\d+ segment · bytes 2–/);
    assert.ok(await page.$('.marxy-imgparts .marxy-ksec-row.marxy-cursor'));
  });
  await withFrame({ files: MORE, open: [PNG] }, async (page) => {
    await page.waitForSelector('.marxy-imgstage');
    await blur(page);
    await keys(page, 'Shift+G', 'l', 'j');
    await waitWhere(page, 'tidemark-icon.png@0x0008');
    assert.equal((await bar(page)).what, 'chunk IHDR');
  });
});

test('a font\'s tables and a recording\'s tracks, tags and boxes are drawn as sections of rows, shown before the cursor reaches them', async () => {
  await withFrame({ files: MORE, open: [TTF] }, async (page) => {
    await page.waitForSelector('.marxy-font-glyphs');
    const sec = await page.evaluate(() => {
      const s = [...document.querySelectorAll('.marxy-ksec')].find((x) => /Its tables/i.test(x.querySelector('.marxy-ksec-h').textContent));
      const row = s?.querySelector('.marxy-ksec-row:not(.marxy-ksec-cols)');
      return s ? { shown: s.getClientRects().length > 0, cols: [...s.querySelectorAll('.marxy-ksec-cols > span')].map((x) => x.textContent), first: [...row.children].map((c) => c.textContent) } : null;
    });
    assert.equal(sec.shown, true);
    assert.deepEqual(sec.cols.slice(0, 3), ['table', 'at byte', 'bytes']);
    assert.match(sec.first[1], /^0x[0-9A-F]{4,}$/);
    await page.click('.marxy-ksec-row:not(.marxy-ksec-cols)');
    await page.waitForFunction(() => /#table=/.test(document.querySelector('.marxy-verb-bar:not([hidden]) .marxy-verb-bar-where')?.textContent ?? ''));
  });
  await withFrame({ files: MORE, open: [MP4] }, async (page) => {
    await page.waitForSelector('.marxy-media-parts .marxy-ksec');
    await page.waitForFunction(() => [...document.querySelectorAll('.marxy-media-parts .marxy-ksec-h')].some((h) => /Its boxes/.test(h.textContent)));
    const heads = await page.$$eval('.marxy-media-parts .marxy-ksec-h', (els) => els.map((e) => e.firstChild.textContent));
    assert.ok(heads.includes('Tracks') && heads.includes('Its boxes'), heads.join('|'));
    const ftyp = await page.$$eval('.marxy-media-parts .marxy-ksec-row[data-marxy-ksec="parts"]:not(.marxy-ksec-cols)', (rows) => [...rows[0].children].map((c) => c.textContent));
    assert.deepEqual(ftyp.slice(0, 2), ['ftyp', '0x0000']);
  });
});

const FENCED = [
  '# Gauges', '', 'What the gauges read.', '', '## Levels', '', '```csv', 'site,height_m', 'Tees,1.42', 'Wear,0.97', 'Tyne,2.10', '```', '',
  '## Sites', '', '```json', '{', '  "name": "gauges",', '  "unit": "m"', '}', '```', '', 'The end.', '',
].join('\n');

test('a Markdown page with fenced data parts: the Markdown cursor walks it all; l goes into a fence\'s rows, h comes back out to the fence', async () => {
  await withFrame({ files: { ...FILES, '/r/fenced.md': FENCED }, open: ['/r/fenced.md'] }, async (page) => {
    await page.waitForSelector('.marxy-article .marxy-part [data-marxy-reading="table"]');
    await blur(page);
    const md = () => page.evaluate(() => document.querySelector('[data-marxy-pane="0"] .marxy-article .marxy-cursor')?.textContent.trim().replace(/\s+/g, ' ').slice(0, 30) ?? null);
    assert.equal(await page.evaluate(() => window.__marxyHandle.selection.cursorReady()), true, 'the Markdown cursor is the page\'s');
    await keys(page, 'g', 'g');
    assert.match(await md(), /^Gauges/);
    await keys(page, 'j');
    assert.match(await md(), /^What the gauges read/);
    await keys(page, ']');
    assert.match(await md(), /^Levels/, '] goes to a heading');
    // Into the section: its fence, a Markdown part. l again goes into its rows, which the parts cursor takes by their lines.
    await keys(page, 'l');
    await page.waitForFunction(() => document.querySelector('[data-marxy-pane="0"] .marxy-article .marxy-part.marxy-cursor, [data-marxy-pane="0"] .marxy-article .marxy-cursor .marxy-part'));
    await keys(page, 'l');
    await waitWhere(page, 'fenced.md:9');
    assert.equal((await bar(page)).what, 'row');
    await keys(page, 'j');
    await waitWhere(page, 'fenced.md:10');
    await keys(page, 'l');
    assert.equal((await bar(page)).what, 'cell site');
    await keys(page, 'h', 'h');
    // Out to the fence, which is the Markdown cursor's again; j goes on over the page.
    await page.waitForFunction(() => document.querySelector('[data-marxy-pane="0"] .marxy-article .marxy-part.marxy-cursor, [data-marxy-pane="0"] .marxy-article .marxy-cursor .marxy-part'));
    await keys(page, 'j');
    assert.match(await md(), /^Sites/);
    await keys(page, 'j', 'l');
    await page.waitForFunction(() => /^node name/.test(document.querySelector('.marxy-verb-bar:not([hidden]) .marxy-verb-bar-what')?.textContent ?? ''));
    await keys(page, 'Escape');
    await page.waitForFunction(() => document.querySelector('[data-marxy-pane="0"] .marxy-article .marxy-part.marxy-cursor'));
    await keys(page, 'k');
    assert.match(await md(), /^Sites/);
  });
});
