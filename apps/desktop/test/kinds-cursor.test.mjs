// Kinds under the cursor in WebKit: the cursor, the verb bar and the verbs over the parts of a
// kind that is not Markdown. The byte floor's rows, an archive's entries, a data tree's nodes, a table's rows then cells,
// a log's entries; `c` and `C` copy the part as stored, `x` x-rays it, `o` opens a part that is a file, `\` goes to the
// bytes or the lines and back, `r` reads the file another way with Bytes last, and the change verbs refuse on a kind that
// is only read.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test as nodeTest } from 'node:test';
import { closeHarness } from './support/two-pane.mjs';
import { rowOf, skip, withFrame } from './support/frame.mjs';

const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);
after(() => closeHarness());

const demo = join(fileURLToPath(new URL('../../../', import.meta.url)), 'fixtures', 'demo', 'archives');
const ZIP = '/r/archives/tidemark-0.5.0.zip';
const JSON_TEXT = '{\n  "name": "gauges",\n  "sites": [\n    { "id": 1, "river": "Tees" },\n    { "id": 2, "river": "Wear" }\n  ],\n  "unit": "m"\n}\n';
const CSV = 'site,height_m,when\nTees,1.42,2026-10-01\nWear,0.97,2026-10-01\nTyne,2.10,2026-10-02\n';
const LOG = '2026-10-01 09:00:01 INFO started\n2026-10-01 09:00:02 WARN slow disk\n2026-10-01 09:00:09 ERROR gave up\n';
const BLOB = Uint8Array.from({ length: 70 }, (_, i) => (i % 5 === 0 ? 0 : (i * 7 + 3) & 0xff));
const FILES = {
  '/r/README.md': '# Here\n',
  [ZIP]: readFileSync(join(demo, 'tidemark-0.5.0.zip')),
  '/r/gauges.json': JSON_TEXT,
  '/r/levels.csv': CSV,
  '/r/twins.csv': 'name,name,city\nAda,Lovelace,London\n',
  '/r/run.log': LOG,
  '/r/blob.bin': BLOB,
};

const keys = async (page, ...list) => {
  for (const k of list) await page.keyboard.press(k);
};
const blur = (page) => page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
const clipboard = (page) =>
  page.evaluate(() => {
    const last = window.__marxyHandle.shell.calls.filter((c) => c.method === 'clipboardWriteItem').at(-1);
    const rep = last?.args[0].find((r) => r.type === 'public.utf8-plain-text');
    return rep ? new TextDecoder().decode(rep.bytes) : null;
  });
const copies = (page) => page.evaluate(() => window.__marxyHandle.shell.calls.filter((c) => c.method === 'clipboardWriteItem').length);
const copied = (page, n) => page.waitForFunction((n) => window.__marxyHandle.shell.calls.filter((c) => c.method === 'clipboardWriteItem').length === n, n);

/** The bar as the reader sees it, and the element under the cursor. */
const bar = (page) =>
  page.evaluate(() => {
    const b = document.querySelector('.marxy-verb-bar');
    const shown = b && !b.hidden;
    const el = document.querySelector('[data-marxy-pane="0"] .marxy-cursor');
    return {
      where: shown ? b.querySelector('.marxy-verb-bar-where').textContent : null,
      what: shown ? b.querySelector('.marxy-verb-bar-what').textContent : null,
      verbs: shown ? [...b.querySelectorAll('[data-marxy-verb]')].map((v) => v.textContent.trim()) : [],
      text: el ? el.textContent.trim().replace(/\s+/g, ' ').slice(0, 60) : null,
    };
  });
const notices = (page) => page.$$eval('.marxy-notice-text', (els) => els.map((e) => e.textContent));

test(`K-frame: an archive's entries are parts: j k walk them, l goes into a folder, h out, the bar says !/path, c copies the path`, async () => {
  await withFrame({ files: FILES, open: [ZIP] }, async (page) => {
    await page.waitForSelector('.marxy-atree');
    await blur(page);
    // The one folder that holds everything is the lede's, not a row: the cursor starts inside it.
    await keys(page, 'g', 'g');
    let b = await bar(page);
    assert.equal(b.where, 'tidemark-0.5.0.zip!/tidemark-0.5.0/assets/');
    assert.equal(b.what, 'folder assets');
    // A zip's folder has a local header of its own, so x shows it.
    assert.deepEqual(b.verbs, ['c copy', 'C cite', 'x x-ray', '\\ source', 'r read as', 'y collect', 'n note', 'Enter all'], 'only read: no change verbs, nothing to open');
    await keys(page, 'j');
    assert.equal((await bar(page)).what, 'folder bench', 'j steps over a folder to its sibling');
    await keys(page, 'k', 'l');
    b = await bar(page);
    assert.equal(b.what, 'entry tidemark-icon.png');
    assert.deepEqual(b.verbs, ['c copy', 'C cite', 'x x-ray', 'o open', '\\ source', 'r read as', 'y collect', 'n note', 'Enter all']);
    await keys(page, 'c');
    await copied(page, 1);
    assert.equal(await clipboard(page), 'tidemark-0.5.0/assets/tidemark-icon.png');
    await keys(page, 'Shift+C');
    await copied(page, 2);
    assert.equal(await clipboard(page), `> tidemark-0.5.0/assets/tidemark-icon.png\n\n— \`${ZIP}!/tidemark-0.5.0/assets/tidemark-icon.png\`\n`);
    await keys(page, 'h');
    assert.equal((await bar(page)).what, 'folder assets');
    // A folded folder opens when the cursor goes into it.
    await page.click('.marxy-arow:has(.marxy-arch-name:text-is("assets/")) .marxy-arch-tw');
    await blur(page);
    await keys(page, 'l');
    assert.equal((await bar(page)).what, 'entry tidemark-icon.png');
    assert.ok(await page.$('.marxy-arow:has(.marxy-arch-name:text-is("tidemark-icon.png"))'), 'unfolded');
  });
});

test(`K-frame: o opens an entry in a tab of its own, read-only; the change verbs refuse on the archive and say why`, async () => {
  await withFrame({ files: FILES, open: [ZIP] }, async (page) => {
    await page.waitForSelector('.marxy-atree');
    await blur(page);
    await keys(page, 'g', 'g', 'e');
    await page.waitForFunction(() => [...document.querySelectorAll('.marxy-notice-text')].some((e) => /An archive is only read here/.test(e.textContent)));
    await keys(page, 'd');
    assert.ok((await notices(page)).some((t) => /only read here/.test(t)));
    // The app's own layout.json may be saved meanwhile: nothing of the archive is written.
    assert.equal((await page.evaluate(() => window.__marxyHandle.shell.calls.filter((c) => /^write/.test(c.method) && !String(c.args[0]).startsWith('/data/')).length)), 0, 'nothing written');
    // To docs/config.md: into the folder, then j to docs, l, j to config.md.
    await page.evaluate(() => {
      const row = [...document.querySelectorAll('.marxy-arow')].find((r) => r.querySelector('.marxy-arch-name').textContent === 'config.md');
      row.scrollIntoView();
    });
    for (let i = 0; i < 20 && (await bar(page)).what !== 'entry config.md'; i++) await keys(page, (await bar(page)).what === 'folder docs' ? 'l' : (await bar(page)).what?.startsWith('folder tidemark') ? 'l' : 'j');
    assert.equal((await bar(page)).what, 'entry config.md');
    await keys(page, 'o');
    await page.waitForFunction(() => document.querySelector('.marxy-article h1')?.textContent === 'Configuration');
    assert.deepEqual(await rowOf(page), ['tidemark-0.5.0.zip', 'config.md*']);
  });
});

test(`an archive folder folded with the cursor on an entry inside it stays folded; the next move unfolds it`, async () => {
  await withFrame({ files: FILES, open: [ZIP] }, async (page) => {
    await page.waitForSelector('.marxy-atree');
    await blur(page);
    await keys(page, 'g', 'g', 'l', 'l');
    assert.equal((await bar(page)).what, 'entry tidemark-icon.png');
    // A click on any row looks the rows up without unfolding them.
    await page.click('.marxy-arow:has(.marxy-arch-name:text-is("assets/")) .marxy-arch-tw');
    await blur(page);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    assert.equal(await page.getAttribute('.marxy-arow:has(.marxy-arch-name:text-is("assets/"))', 'aria-expanded'), 'false', 'still folded');
    assert.equal(await page.$('.marxy-arow:has(.marxy-arch-name:text-is("tidemark-icon.png"))'), null);
    assert.equal((await bar(page)).what, 'entry tidemark-icon.png', 'the cursor stays on its entry, as in the other trees');
    await keys(page, 'h');
    assert.equal((await bar(page)).what, 'folder assets');
    assert.equal(await page.getAttribute('.marxy-arow:has(.marxy-arch-name:text-is("assets/"))', 'aria-expanded'), 'false', 'h onto the folder leaves it folded');
    await keys(page, 'l');
    assert.ok(await page.$('.marxy-arow:has(.marxy-arch-name:text-is("tidemark-icon.png"))'), 'a move into it unfolds it');
  });
});

test(`K-trees: a data tree's nodes are parts with their lines; l goes into a branch, c copies the node as written, x x-rays it`, async () => {
  await withFrame({ files: FILES, open: ['/r/gauges.json'] }, async (page) => {
    await page.waitForSelector('[data-marxy-reading="tree"]');
    await blur(page);
    await keys(page, 'g', 'g');
    let b = await bar(page);
    assert.match(b.what, /^node name/);
    assert.equal(b.where, 'gauges.json:2');
    await keys(page, 'c');
    await copied(page, 1);
    assert.equal(await clipboard(page), '"gauges"', 'a leaf is its value as written');
    await keys(page, 'j');
    b = await bar(page);
    assert.match(b.what, /^node sites/);
    assert.equal(b.where, 'gauges.json:3–6');
    await keys(page, 'l');
    b = await bar(page);
    assert.equal(b.where, 'gauges.json:4');
    await keys(page, 'x');
    await page.waitForSelector('[data-marxy-pane="0"] .marxy-xray');
    assert.match(await page.textContent('[data-marxy-pane="0"] .marxy-xray'), /"id": 1, "river": "Tees"/);
    await keys(page, 'x');
    await page.waitForFunction(() => !document.querySelector('[data-marxy-pane="0"] .marxy-xray'));
    await keys(page, 'h');
    assert.match((await bar(page)).what, /^node sites/);
    // The Markdown cursor's verbs that change the file are not offered on a reading's part.
    assert.ok(!(await bar(page)).verbs.some((v) => /edit|tick/.test(v)));
  });
});

test(`K-tables: a CSV's rows then cells; c copies a row as the file holds it, a cell its value; the cell's address names its column`, async () => {
  await withFrame({ files: FILES, open: ['/r/levels.csv'] }, async (page) => {
    await page.waitForSelector('[data-marxy-reading="table"]');
    await blur(page);
    await keys(page, 'g', 'g');
    let b = await bar(page);
    assert.equal(b.what, 'row');
    assert.equal(b.where, 'levels.csv:2');
    await keys(page, 'j', 'c');
    await copied(page, 1);
    assert.equal(await clipboard(page), 'Wear,0.97,2026-10-01');
    await keys(page, 'l', 'j');
    b = await bar(page);
    assert.equal(b.what, 'cell height_m');
    assert.equal(b.where, 'levels.csv:3#height_m');
    await keys(page, 'c');
    await copied(page, 2);
    assert.equal(await clipboard(page), '0.97');
    await keys(page, 'Shift+G');
    assert.equal((await bar(page)).where, 'levels.csv:4');
    await keys(page, 'Escape');
    assert.equal((await bar(page)).where, null, 'Escape lets the cursor go');
  });
});

test(`two columns named alike are two cells: j walks from one to the other and on, c copies each`, async () => {
  await withFrame({ files: FILES, open: ['/r/twins.csv'] }, async (page) => {
    await page.waitForSelector('[data-marxy-reading="table"]');
    await blur(page);
    await keys(page, 'g', 'g', 'l', 'j');
    assert.equal((await bar(page)).text, 'Lovelace');
    await keys(page, 'c');
    await copied(page, 1);
    assert.equal(await clipboard(page), 'Lovelace');
    await keys(page, 'j');
    assert.equal((await bar(page)).what, 'cell city');
    assert.equal((await bar(page)).text, 'London');
  });
});

test(`a log's entries are parts; J takes the next one too and c copies the run as written`, async () => {
  await withFrame({ files: FILES, open: ['/r/run.log'] }, async (page) => {
    // Lines come before the log page is drawn (under load, long enough for the keys to land between): its page is waited for.
    await page.waitForSelector('pre.language-log code[data-marxy-done="highlight"] .marxy-line');
    await blur(page);
    await keys(page, 'g', 'g');
    assert.equal((await bar(page)).where, 'run.log:1');
    assert.equal((await bar(page)).what, 'entry');
    await keys(page, 'Shift+J');
    assert.equal((await bar(page)).what, '2 parts');
    await keys(page, 'c');
    await copied(page, 1);
    assert.equal(await clipboard(page), '2026-10-01 09:00:01 INFO started\n2026-10-01 09:00:02 WARN slow disk');
  });
});

test(`K-frame: the byte floor: rows of bytes at their offsets; c copies a row's bytes; \\ goes to Source and back`, async () => {
  await withFrame({ files: FILES, open: ['/r/blob.bin'] }, async (page) => {
    await page.waitForSelector('.marxy-hexrow .marxy-hex-b i');
    await blur(page);
    await keys(page, 'g', 'g');
    let b = await bar(page);
    assert.equal(b.where, 'blob.bin@0x0000');
    assert.equal(b.what, 'row');
    await keys(page, 'j');
    b = await bar(page);
    assert.equal(b.where, 'blob.bin@0x0010');
    await keys(page, 'c');
    await copied(page, 1);
    const want = [...BLOB.subarray(16, 32)].map((x) => x.toString(16).toUpperCase().padStart(2, '0')).join(' ');
    assert.equal(await clipboard(page), want);
    assert.ok(await page.$('.marxy-hexrow.marxy-cursor[data-marxy-row="16"]'), 'the row is marked');
    await keys(page, 'e');
    await page.waitForFunction(() => [...document.querySelectorAll('.marxy-notice-text')].some((e) => /Bytes are only read here/.test(e.textContent)));
    await keys(page, '\\');
    await page.waitForFunction(() => document.querySelector('[data-marxy-viewer]')?.closest('[data-marxy-mode="source"]') || document.body.dataset.marxyMode === 'source');
    await keys(page, '\\');
    await page.waitForFunction(() => document.body.dataset.marxyMode !== 'source');
    assert.ok(await page.$('.marxy-fcard'), 'back to the card');
  });
});

test(`r reads the file another way: the reading found, the others, Bytes last; Bytes and back`, async () => {
  await withFrame({ files: FILES, open: ['/r/gauges.json'] }, async (page) => {
    await page.waitForSelector('[data-marxy-reading="tree"]');
    await blur(page);
    await keys(page, 'r');
    await page.waitForSelector('[role="menu"]');
    const rows = await page.$$eval('[role="menu"] [role="menuitem"], [role="menu"] [aria-disabled]', (els) => els.map((e) => e.textContent.trim()));
    assert.match(rows[0], /^The reading found/);
    assert.match(rows[1], /^As found: Data/);
    assert.ok(rows.some((r) => /^Read it another way/.test(r)));
    assert.match(rows.at(-2), /^The floor/);
    assert.match(rows.at(-1), /^Bytes/);
    await page.click('[role="menu"] [data-row-key="read-as.bytes"]');
    await page.waitForSelector('.marxy-hexrow .marxy-hex-b i');
    assert.equal(await page.getAttribute('[data-marxy-viewer]', 'data-marxy-viewer'), 'card');
    assert.match(await page.textContent('.marxy-fcard-kicker'), /Bytes, your choice/);
    await blur(page);
    await keys(page, 'r');
    await page.waitForSelector('[role="menu"]');
    await page.click('[role="menu"] [data-row-key="read-as.found"]');
    await page.waitForSelector('[data-marxy-reading="tree"]');
    assert.equal(await copies(page), 0);
  });
});
