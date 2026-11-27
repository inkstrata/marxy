// RTF reads as text on the office page: WordPad's sample as headings, lists, a table and links written out as text; Greek
// and Japanese from the code page the file declares; every element naming bytes of the file, so a part lands Source on
// its own lines; find on the page; Source as the file's own text. A file built to break the reader stops at its caps and
// says so, names its picture and object, and sends nothing anywhere. WebKit, over the memory shell.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test as nodeTest } from 'node:test';
import { closeHarness } from './support/two-pane.mjs';
import { cardText, skip, withFrame } from './support/frame.mjs';

const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);
after(() => closeHarness());

const dir = join(fileURLToPath(new URL('../../../', import.meta.url)), 'fixtures', 'rtf');
const NOTES = '/r/docs/harbour-notes.rtf';
const GREEK = '/r/docs/greek.rtf';
const JAPANESE = '/r/docs/japanese.rtf';
const HOSTILE = '/r/docs/hostile.rtf';
const RAW_GREEK = '/r/docs/raw-greek.rtf';
const WITH_BIN = '/r/docs/with-bin.rtf';
// Greek written raw, not by number: the store's own guess for these bytes is not Greek, the file's code page is.
const rawGreek = Buffer.concat([Buffer.from('{\\rtf1\\ansi\\ansicpg1253 ', 'latin1'), Buffer.from([0xcb, 0xe9, 0xec, 0xdc, 0xed, 0xe9]), Buffer.from(' \\par}', 'latin1')]);
// Raw bytes after \bin, NULs among them: content detection calls the file binary.
const withBin = Buffer.concat([Buffer.from('{\\rtf1\\ansi Before {\\pict\\pngblip\\bin4 ', 'latin1'), Buffer.from([0, 0x7d, 0, 0x7b]), Buffer.from('} after\\par}', 'latin1')]);
const notesBytes = readFileSync(join(dir, 'wordpad-harbour-notes.rtf'));

const hostile = () => {
  const body = [
    `before ${'{'.repeat(10_000)}lost${'}'.repeat(10_000)} after`,
    `a picture {\\pict\\jpegblip ${'ab'.repeat(2 * 1024 * 1024)}} then text`,
    '{\\object\\objemb{\\*\\objclass Package}{\\*\\objdata 4d5a00}{\\result hidden}} an object',
    '{\\field{\\*\\fldinst {HYPERLINK "javascript:alert(1)"}}{\\fldrslt {run me}}}',
    '<script>alert(1)</script> [x](https://evil.test)',
  ].join('\\par ');
  return Buffer.from(`{\\rtf1\\ansi ${body}\\par}`, 'latin1');
};

const FILES = {
  '/r/README.md': '# Here\n',
  [NOTES]: notesBytes,
  [GREEK]: readFileSync(join(dir, 'greek-1253.rtf')),
  [JAPANESE]: readFileSync(join(dir, 'japanese-932.rtf')),
  [HOSTILE]: hostile(),
  [RAW_GREEK]: rawGreek,
  [WITH_BIN]: withBin,
};

const open = (page, path) => page.evaluate((p) => window.__marxyHandle.open(p), path);
const calls = (page, method) => page.evaluate((m) => window.__marxyHandle.shell.calls.filter((c) => c.method === m).map((c) => c.args), method);
const editorState = (page) =>
  page.evaluate(() => {
    const view = document.querySelector('#marxy-source .cm-content')?.cmTile?.root?.view;
    return view ? view.state.doc.toString() : null;
  });
/** The line of Source's text that holds character `at`. */
const editorLineAt = (page, at) => page.evaluate((to) => document.querySelector('#marxy-source .cm-content').cmTile.root.view.state.doc.lineAt(to).text, at);

function watchNetwork(page) {
  const off = [];
  const base = new URL(page.url()).host;
  page.on('request', (r) => {
    const u = r.url();
    if (u.startsWith('data:') || u.startsWith('blob:') || u.startsWith('about:')) return;
    if (new URL(u).host !== base) off.push(u);
  });
  return off;
}

test('a WordPad file reads as the page’s own headings, lists, table and paragraphs, its links as text', async () => {
  await withFrame({ files: FILES, open: ['/r/README.md'] }, async (page) => {
    const off = watchNetwork(page);
    await open(page, NOTES);
    await page.waitForSelector('.marxy-office .marxy-article h1');
    assert.equal(await page.getAttribute('[data-marxy-viewer]', 'data-marxy-viewer'), 'office');
    assert.match(await page.textContent('.marxy-office .marxy-reading-head'), /^Rich Text document · \d+ words · the text, not the layout$/);
    const shape = await page.evaluate(() => {
      const a = document.querySelector('.marxy-office .marxy-article');
      return {
        h: [...a.querySelectorAll(':scope > h1, :scope > h2')].map((h) => `${h.localName} ${h.textContent}`),
        ul: a.querySelectorAll(':scope > ul > li').length,
        ol: a.querySelectorAll(':scope > ol > li').length,
        rows: a.querySelectorAll(':scope > table tr').length,
        strong: [...a.querySelectorAll(':scope > p strong')].map((s) => s.textContent),
        em: a.querySelector(':scope > p em')?.textContent ?? null,
        code: a.querySelector(':scope > p code')?.textContent ?? null,
        links: a.querySelectorAll('a').length,
        text: a.innerText,
      };
    });
    assert.deepEqual(shape.h, ['h1 Harbour notes', 'h2 What we checked', 'h2 Depths by berth']);
    assert.equal(shape.ul, 3);
    assert.equal(shape.ol, 2);
    assert.equal(shape.rows, 3);
    assert.deepEqual(shape.strong, ['soundings']);
    assert.equal(shape.em, 'north basin');
    assert.equal(shape.code, 'GAUGE-7');
    assert.equal(shape.links, 0);
    // The page binds words with spaces of its own: compared without them.
    const bare = shape.text.replace(/\s+/g, '');
    assert.match(bare, /thechartoffice\(https:\/\/example\.org\/chart\)/);
    assert.match(bare, /Depth≥4missafe–“clear”water\./);
    const about = await cardText(page, 'frontmatter');
    assert.match(about, /made by\s+Riched20/);
    assert.deepEqual(off, []);
  });
});

test('every element names bytes of the file: its words are there, and a part lands Source on its own line', async () => {
  await withFrame({ files: FILES, open: [NOTES] }, async (page) => {
    await page.waitForSelector('.marxy-office .marxy-article table');
    const ranges = await page.evaluate(() => {
      const a = document.querySelector('.marxy-office .marxy-article');
      const els = [...a.querySelectorAll('*')].filter((e) => !e.closest('.marxy-account, .marxy-reading-head, .marxy-office-cut'));
      const pick = (sel, words) => {
        const e = [...a.querySelectorAll(sel)].find((x) => x.textContent.includes(words));
        return e ? [Number(e.getAttribute('data-marxy-s')), Number(e.getAttribute('data-marxy-e'))] : null;
      };
      return {
        missing: els.filter((e) => !e.hasAttribute('data-marxy-s') || !e.hasAttribute('data-marxy-e')).map((e) => e.localName),
        strong: pick('strong', 'soundings'),
        cell: pick('td', 'Fish dock'),
        item: pick('li', 'ladder'),
        heading: pick('h2', 'Depths'),
      };
    });
    assert.deepEqual(ranges.missing, []);
    const at = ([s, e]) => notesBytes.subarray(s, e).toString('latin1');
    assert.match(at(ranges.strong), /\\b soundings\\b0/);
    assert.match(at(ranges.cell), /Fish dock\\cell 4\.2\\cell\\row/);
    assert.match(at(ranges.item), /^The ladder at berth 3\\par$/);
    assert.match(at(ranges.heading), /Depths by berth/);
    // The cursor's parts carry the byte they start at; Source opens there, on the file's own line.
    const parts = await page.evaluate(() => window.__marxyHandle.panes().focused.content.viewer().parts('rendered').top().map((u) => ({ label: u.label, at: u.at })));
    const table = parts.find((p) => p.label === 'Depths by berth');
    assert.equal(table?.at, ranges.heading[0]);
    await page.evaluate((to) => window.__marxyHandle.jumpToSource(to), table.at);
    await page.waitForFunction(() => document.body.dataset.marxyMode === 'source' && document.querySelector('#marxy-source .cm-editor'));
    await page.waitForFunction(() => document.querySelector('#marxy-source .cm-content')?.cmTile?.root?.view);
    assert.equal(await editorState(page), notesBytes.toString('latin1').replace(/\r\n/g, '\n'), 'Source is the file as it is');
    // The editor counts a line's CRLF as one character; the file's bytes count two.
    const crs = (notesBytes.subarray(0, table.at).toString('latin1').match(/\r/g) ?? []).length;
    assert.match(await editorLineAt(page, table.at - crs), /^\\pard\\sa200\\sl276\\slmult1\\fs28 Depths by berth\\fs22\\par$/);
  });
});

test('find searches the page; Source is the file’s text and Read comes back to the page', async () => {
  await withFrame({ files: FILES, open: [NOTES] }, async (page) => {
    await page.waitForSelector('.marxy-office .marxy-article h1');
    await page.click('.marxy-office h1');
    await page.keyboard.press('ControlOrMeta+f');
    await page.keyboard.type('berth');
    await page.waitForFunction(() => /of 5$/.test(document.querySelector('.marxy-find')?.textContent ?? ''), null, { timeout: 10_000 }).catch(() => {});
    assert.match(await page.textContent('.marxy-find'), /1 of 5/);
    await page.keyboard.press('Escape');
    await page.click('.marxy-rs-source');
    await page.waitForFunction(() => document.querySelector('#marxy-source .cm-content')?.textContent.includes('\\rtf1'));
    await page.click('.marxy-rs-read');
    await page.waitForSelector('.marxy-office .marxy-article h1');
  });
});

test('Greek and Japanese read in the code page each file declares', async () => {
  await withFrame({ files: FILES, open: [GREEK] }, async (page) => {
    await page.waitForSelector('.marxy-office .marxy-article > p');
    assert.equal(await page.textContent('.marxy-office .marxy-article > p'), 'Λιμάνι του Πειραιά');
    await open(page, JAPANESE);
    await page.waitForFunction(() => document.querySelector('.marxy-office .marxy-article > p')?.textContent === '日本の港湾調査');
  });
});

test('a file built to break the reader stops at its caps and says so; its picture and object are named, nothing runs', async () => {
  await withFrame({ files: FILES, open: ['/r/README.md'] }, async (page) => {
    const off = watchNetwork(page);
    await open(page, HOSTILE);
    await page.waitForSelector('.marxy-office .marxy-article .marxy-office-cut');
    const got = await page.evaluate(() => {
      const a = document.querySelector('.marxy-office .marxy-article');
      return {
        cut: [...a.querySelectorAll('.marxy-office-cut')].map((p) => p.textContent),
        stands: [...a.querySelectorAll('.marxy-office-stand')].map((s) => s.textContent),
        scripts: a.querySelectorAll('script').length,
        links: a.querySelectorAll('a').length,
        text: a.innerText,
      };
    });
    assert.match(got.cut.join(' '), /nested more than 256 deep/);
    assert.deepEqual(got.stands, ['Picture, not drawn: JPEG, 2.0 MB', 'Embedded object, not shown: Package']);
    assert.equal(got.scripts, 0);
    assert.equal(got.links, 0);
    assert.match(got.text, /before\s+after/);
    assert.doesNotMatch(got.text, /lost|hidden/);
    assert.match(got.text, /run me \(javascript:alert\(1\)\)/);
    assert.match(got.text, /<script>alert\(1\)<\/script> \[x\]\(https:\/\/evil\.test\)/);
    assert.deepEqual(await calls(page, 'openExternal'), []);
    assert.deepEqual(off, []);
  });
});

test('Greek written raw reads in the file’s code page, and its elements still name Source’s bytes', async () => {
  await withFrame({ files: FILES, open: [RAW_GREEK] }, async (page) => {
    await page.waitForSelector('.marxy-office .marxy-article > p');
    assert.equal(await page.textContent('.marxy-office .marxy-article > p'), 'Λιμάνι');
    const r = await page.evaluate(() => {
      const p = document.querySelector('.marxy-office .marxy-article > p');
      return [Number(p.getAttribute('data-marxy-s')), Number(p.getAttribute('data-marxy-e'))];
    });
    // Source holds the store's text: the paragraph's range there starts at its first letter and ends after \par.
    await page.click('.marxy-rs-source');
    await page.waitForFunction(() => document.querySelector('#marxy-source .cm-content')?.cmTile?.root?.view);
    const held = new TextEncoder().encode(await editorState(page));
    assert.match(new TextDecoder().decode(held.subarray(r[0], r[1])), /^[^\\{ ]+ \\par$/);
  });
});

test('an RTF file with NULs among the raw bytes after \\bin still reads on the office page; Source holds the file', async () => {
  await withFrame({ files: FILES, open: [WITH_BIN] }, async (page) => {
    await page.waitForSelector('.marxy-office .marxy-article > p');
    assert.equal(await page.getAttribute('[data-marxy-viewer]', 'data-marxy-viewer'), 'office');
    assert.match((await page.textContent('.marxy-office .marxy-article > p')).replace(/\s+/g, ' '), /^Before Picture, not drawn: PNG, 4 bytes after$/);
    // Opened as text it is Source's text; a head detection calls binary (the registry's RTF bytes row) is the hex view.
    await page.click('.marxy-rs-source');
    await page.waitForFunction(() => document.querySelector('.marxy-hexpage') || document.querySelector('#marxy-source .cm-content')?.cmTile?.root?.view);
    const text = await editorState(page);
    if (text !== null) assert.match(text, /\\bin4 /);
  });
});
