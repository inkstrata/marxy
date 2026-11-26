// Fonts, recordings and PDFs under the cursor in WebKit: a font's specimen lines, the glyphs it
// draws and its tables; a recording's player, tracks, tags and boxes or chunks at their offsets; a PDF's pages. `c` copies
// the part as stored, `x` x-rays a part that owns a run of the file's bytes, `] [` step the outline, and the change verbs
// refuse.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test as nodeTest } from 'node:test';
import { closeHarness } from './support/two-pane.mjs';
import { showCardPanel, skip, withFrame } from './support/frame.mjs';

const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);
after(() => closeHarness());

const demo = join(fileURLToPath(new URL('../../../', import.meta.url)), 'fixtures', 'demo');
const TTF = '/r/fonts/TidemarkSans-Regular.ttf';
const WAV = '/r/media/bell-buoy.wav';
const MP4 = '/r/media/ferry-leaving.mp4';
const PDF = '/r/reading/the-case-for-ragged-lines.pdf';
const ttf = readFileSync(join(demo, 'fonts', 'TidemarkSans-Regular.ttf'));
const wav = readFileSync(join(demo, 'media', 'bell-buoy.wav'));
const FILES = {
  '/r/README.md': '# Here\n',
  [TTF]: ttf,
  [WAV]: wav,
  [MP4]: readFileSync(join(demo, 'media', 'ferry-leaving.mp4')),
  [PDF]: readFileSync(join(demo, 'reading', 'the-case-for-ragged-lines.pdf')),
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
const copied = (page, n) => page.waitForFunction((n) => window.__marxyHandle.shell.calls.filter((c) => c.method === 'clipboardWriteItem').length === n, n);
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
const refused = (page, re) => page.waitForFunction((src) => [...document.querySelectorAll('.marxy-notice-text')].some((e) => new RegExp(src).test(e.textContent)), re.source);
/** Presses `key` until the bar's address is `where`, at most `max` times. */
async function walkTo(page, key, where, max = 120) {
  for (let i = 0; i < max && (await bar(page)).where !== where; i++) await keys(page, key);
  assert.equal((await bar(page)).where, where);
}
const hex4 = (n) => n.toString(16).toUpperCase().padStart(4, '0');
const hexPairs = (b) => [...b].map((x) => x.toString(16).toUpperCase().padStart(2, '0')).join(' ');

/** The TrueType's table directory, read here to check the viewer against the file itself. */
function tablesOf(b) {
  const n = b.readUInt16BE(4);
  return Array.from({ length: n }, (_, i) => ({ tag: b.toString('latin1', 12 + 16 * i, 16 + 16 * i), at: b.readUInt32BE(20 + 16 * i), length: b.readUInt32BE(24 + 16 * i) }));
}

/** A WAV's chunks inside RIFF. */
function chunksOf(b) {
  const out = [];
  for (let at = 12; at + 8 <= b.length; ) {
    const len = b.readUInt32LE(at + 4);
    out.push({ name: b.toString('latin1', at, at + 4), at, length: Math.min(8 + len, b.length - at) });
    at += 8 + len + (len & 1);
  }
  return out;
}

test(`K-media 10 a glyph is a part at its code point; c copies the character; a specimen line copies its text; h goes out to the grid`, async () => {
  await withFrame({ files: FILES, open: [TTF] }, async (page) => {
    await page.waitForSelector('[data-marxy-viewer="font"] .marxy-font-spec');
    await page.waitForFunction(() => document.querySelector('.marxy-font-spec')?.style.visibility !== 'hidden');
    await blur(page);
    await keys(page, 'g', 'g');
    let b = await bar(page);
    assert.equal(b.what, 'specimen');
    assert.equal(b.where, 'TidemarkSans-Regular.ttf#specimen');
    assert.deepEqual(b.verbs, ['c copy', 'C cite', '\\ source', 'r read as', 'y collect', 'n note', 'Enter all'], 'only read: no change verbs, nothing to open or x-ray');
    await keys(page, 'l');
    b = await bar(page);
    assert.equal(b.what, 'line name');
    assert.equal(b.where, 'TidemarkSans-Regular.ttf#specimen=name');
    await keys(page, 'c');
    await copied(page, 1);
    assert.equal(await clipboard(page), 'Tidemark Sans Regular', 'a specimen line copies its text');
    await keys(page, 'j');
    assert.equal((await bar(page)).what, 'line capitals');
    await keys(page, 'c');
    await copied(page, 2);
    assert.equal(await clipboard(page), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ');
    await keys(page, 'h', 'j');
    assert.equal((await bar(page)).what, 'characters', 'j from the specimen goes to the grid');
    await keys(page, 'l');
    assert.match((await bar(page)).what, /^glyph /);
    await walkTo(page, 'j', 'TidemarkSans-Regular.ttf#U+0041');
    b = await bar(page);
    assert.equal(b.what, 'glyph A');
    assert.ok(await page.$('.marxy-font-glyphs button[aria-label="U+0041"].marxy-cursor'), 'the glyph is marked');
    // The Glyph card follows the cursor, as it follows a click (a part picked: in Outline).
    await showCardPanel(page, 'now-glyph');
    await page.waitForFunction(() => document.querySelector('.marxy-drawer [data-marxy-card="now-glyph"]'));
    await keys(page, 'c');
    await copied(page, 3);
    assert.equal(await clipboard(page), 'A');
    await keys(page, 'Shift+C');
    await copied(page, 4);
    assert.equal(await clipboard(page), `> A\n\n— \`${TTF}#U+0041\`\n`);
    await keys(page, 'h');
    assert.equal((await bar(page)).what, 'characters', 'h goes out to the grid');
    await keys(page, 'k');
    assert.equal((await bar(page)).what, 'specimen', 'k to the specimen');
    await keys(page, 'e');
    await refused(page, /A font is only read here/);
    await keys(page, 'Escape');
    assert.equal((await bar(page)).where, null, 'Escape lets the cursor go');
  });
});

test(`K-media 13 a font's table: its address names it, c copies tag, offset and length, x shows its bytes at its offset; ] steps the sections`, async () => {
  await withFrame({ files: FILES, open: [TTF] }, async (page) => {
    await page.waitForSelector('[data-marxy-viewer="font"] .marxy-font-spec');
    await blur(page);
    await keys(page, 'g', 'g', ']', ']');
    let b = await bar(page);
    assert.equal(b.what, 'tables', '] steps specimen, characters, tables');
    assert.ok(await page.$('.marxy-ksec.marxy-cursor'), 'the tables are drawn, the cursor on the section');
    await keys(page, '[');
    assert.equal((await bar(page)).what, 'characters');
    await keys(page, ']', 'l');
    const tables = tablesOf(ttf);
    b = await bar(page);
    assert.equal(b.what, `table ${tables[0].tag.trim()}`);
    await walkTo(page, 'j', 'TidemarkSans-Regular.ttf#table=cmap');
    const cmap = tables.find((t) => t.tag === 'cmap');
    assert.ok((await bar(page)).verbs.includes('x x-ray'));
    await keys(page, 'c');
    await copied(page, 1);
    assert.equal(await clipboard(page), `cmap\t0x${hex4(cmap.at)}\t${cmap.length.toLocaleString('en-GB')}`);
    await keys(page, 'x');
    await page.waitForSelector('[data-marxy-pane="0"] .marxy-xray');
    const x = await page.evaluate(() => {
      const box = document.querySelector('[data-marxy-pane="0"] .marxy-xray');
      return { head: box.querySelector('.marxy-xray-head').getAttribute('data-marxy-xray-head'), first: box.querySelector('.marxy-xray-line').getAttribute('data-marxy-line'), text: box.querySelector('.marxy-xray-line').textContent };
    });
    assert.match(x.head, new RegExp(`^As stored · the cmap table · bytes ${cmap.at.toLocaleString('en-GB')}–`));
    assert.equal(x.first, hex4(cmap.at));
    assert.ok(x.text.startsWith(hexPairs(ttf.subarray(cmap.at, cmap.at + 16))), x.text);
    await keys(page, 'x');
    await page.waitForFunction(() => !document.querySelector('[data-marxy-pane="0"] .marxy-xray'));
    // \ lands Source at the table's first byte.
    await keys(page, '\\');
    await page.waitForSelector('.marxy-hexrow .marxy-hex-b i');
    assert.equal(await page.evaluate(() => window.__marxyHandle.panes().focused.view.mode), 'source');
    assert.equal(await page.evaluate(() => window.__marxyHandle.panes().focused.content.viewer().place().hex.selected), cmap.at, 'Source at the table’s first byte');
  });
});

test(`K-media 14 a WAV: the player is the first part; its track, tags and chunks are parts; a chunk's address is its offset; e refuses`, async () => {
  await withFrame({ files: FILES, open: ['/r/README.md'] }, async (page) => {
    await page.evaluate(() => Object.defineProperty(HTMLMediaElement.prototype, 'error', { configurable: true, get: () => null }));
    await page.evaluate((p) => window.__marxyHandle.open(p), WAV);
    await page.waitForSelector('[data-marxy-viewer="media"] audio.marxy-media-player');
    await blur(page);
    await keys(page, 'g', 'g');
    let b = await bar(page);
    assert.equal(b.what, 'player', 'the player is the first part');
    assert.equal(b.where, 'bell-buoy.wav');
    assert.ok(await page.$('audio.marxy-media-player.marxy-cursor'));
    await keys(page, 'e');
    await refused(page, /A recording is only read here/);
    await keys(page, 'j');
    assert.equal((await bar(page)).what, 'tracks');
    await keys(page, 'l');
    b = await bar(page);
    assert.equal(b.what, 'track 1');
    assert.equal(b.where, 'bell-buoy.wav#track=1');
    await keys(page, 'c');
    await copied(page, 1);
    assert.equal(await clipboard(page), 'audio: PCM, mono, 22,050 Hz, 16-bit');
    await keys(page, 'h', 'j', 'l');
    b = await bar(page);
    assert.equal(b.what, 'tag title');
    assert.equal(b.where, 'bell-buoy.wav#tag=INAM');
    await keys(page, 'c');
    await copied(page, 2);
    assert.equal(await clipboard(page), 'title: Bell buoy, outer channel');
    // The chunks are found once their headers are read.
    await keys(page, 'h');
    await page.waitForFunction(() => window.__marxyHandle.panes().focused.content.viewer().parts('rendered').find('boxes') !== null);
    await keys(page, 'j');
    assert.equal((await bar(page)).what, 'chunks');
    await keys(page, 'l');
    const chunks = chunksOf(wav);
    b = await bar(page);
    assert.equal(b.what, `chunk ${chunks[0].name.trim()}`);
    assert.equal(b.where, `bell-buoy.wav@0x${hex4(chunks[0].at)}`);
    await keys(page, 'c');
    await copied(page, 3);
    assert.equal(await clipboard(page), hexPairs(wav.subarray(chunks[0].at, chunks[0].at + chunks[0].length)), 'a chunk copies its bytes as hex pairs');
    await keys(page, 'x');
    await page.waitForSelector('[data-marxy-pane="0"] .marxy-xray');
    assert.match(await page.getAttribute('[data-marxy-pane="0"] .marxy-xray-head', 'data-marxy-xray-head'), new RegExp(`^As stored · the ${chunks[0].name.trim()} chunk · bytes ${chunks[0].at}–`));
    await keys(page, 'x');
    const data = chunks.find((c) => c.name === 'data');
    await walkTo(page, 'j', `bell-buoy.wav@0x${hex4(data.at)}`, 10);
    await keys(page, 'c');
    await copied(page, 4);
    assert.equal(await clipboard(page), `data\t0x${hex4(data.at)}\t${data.length.toLocaleString('en-GB')}`, 'a chunk past 64 KB copies its type, offset and length');
  });
});

test(`K-media 15 an MP4's boxes are parts at their offsets: ftyp at 0x0000, moov after it`, async () => {
  await withFrame({ files: FILES, open: [MP4] }, async (page) => {
    await page.waitForSelector('[data-marxy-viewer="media"] .marxy-media-line');
    await page.waitForFunction(() => window.__marxyHandle.panes().focused.content.viewer().parts('rendered').find('boxes') !== null);
    await blur(page);
    await keys(page, 'g', 'g');
    await walkTo(page, 'j', 'ferry-leaving.mp4#boxes', 6);
    await keys(page, 'l');
    let b = await bar(page);
    assert.equal(b.what, 'box ftyp');
    assert.equal(b.where, 'ferry-leaving.mp4@0x0000');
    await keys(page, 'j');
    b = await bar(page);
    assert.equal(b.what, 'box moov');
    assert.equal(b.where, 'ferry-leaving.mp4@0x0024');
    await keys(page, 'h');
    assert.equal((await bar(page)).what, 'boxes');
    await walkTo(page, 'k', 'ferry-leaving.mp4#tracks', 3);
    await keys(page, 'l', 'j');
    b = await bar(page);
    assert.equal(b.what, 'track 2');
    await keys(page, 'c');
    await copied(page, 1);
    assert.match(await clipboard(page), /^audio: AAC \(mp4a\), stereo, 48,000 Hz/);
  });
});

test(`K-media 16 a PDF's pages are parts: j k and ] [ step them, c copies a page's text, G the last; the zoom keys stay the PDF's`, async () => {
  await withFrame({ files: FILES, open: [PDF] }, async (page) => {
    await page.waitForFunction(() => document.querySelector('.marxy-pdf-page[data-marxy-page="0"] .marxy-pdf-text span'), null, { timeout: 30000 });
    await blur(page);
    await keys(page, 'g', 'g');
    let b = await bar(page);
    assert.equal(b.what, 'page 1');
    assert.equal(b.where, 'the-case-for-ragged-lines.pdf#page=1');
    assert.deepEqual(b.verbs, ['c copy', 'C cite', '\\ source', 'r read as', 'y collect', 'n note', 'Enter all'], 'no x-ray: a page’s content stream is not shown');
    assert.ok(await page.$('.marxy-pdf-page[data-marxy-page="0"].marxy-cursor'));
    await keys(page, 'c');
    await copied(page, 1);
    assert.match(await clipboard(page), /^The case for ragged lines/);
    // A page's text blocks are its parts; h comes back out to the page.
    await keys(page, 'l');
    await page.waitForFunction(() => document.querySelector('.marxy-verb-bar-what')?.textContent === 'block');
    assert.equal((await bar(page)).where, 'the-case-for-ragged-lines.pdf#page=1/block=1');
    await keys(page, 'h');
    assert.equal((await bar(page)).what, 'page 1');
    await keys(page, ']');
    assert.equal((await bar(page)).where, 'the-case-for-ragged-lines.pdf#page=2');
    await keys(page, ']');
    assert.equal((await bar(page)).where, 'the-case-for-ragged-lines.pdf#page=3');
    await page.waitForSelector('.marxy-pdf-page[data-marxy-page="2"].marxy-cursor');
    await keys(page, '[', 'k');
    assert.equal((await bar(page)).where, 'the-case-for-ragged-lines.pdf#page=1');
    await keys(page, 'Shift+G');
    assert.equal((await bar(page)).what, 'page 3');
    await keys(page, 'c');
    await copied(page, 2);
    assert.ok((await clipboard(page)).length > 20, 'page 3 has text');
    await keys(page, 'e');
    await refused(page, /A PDF is only read here/);
    const zoom = await page.textContent('.marxy-pdfbar-zoom');
    await keys(page, '+');
    await page.waitForFunction((z) => document.querySelector('.marxy-pdfbar-zoom').textContent !== z, zoom);
    assert.equal((await bar(page)).what, 'page 3', 'the cursor stays on its page through a zoom');
  });
});
