// A font as a specimen: drawn by the webview from the file through FontFace, never
// installed; its sets, a sample line from its own name table typed over for this tab, the waterfall, every character it
// maps; a slider per axis and the named instances as chips; a collection's faces in a row, each lifted into a font of its
// own; a glyph picked as a passing Glyph card; the Font and Names cards; a face the webview refuses as a tier said in grey.
// The fonts are the demo's (fixtures/demo/fonts, constructed samples); their facts are the native readers'
// (the memory shell answers for the demo's own, harness/native-stand-in.ts). WebKit.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test as nodeTest } from 'node:test';
import { closeHarness } from './support/two-pane.mjs';
import { cardText, cardsOf, showCardPanel, showPanel, skip, withFrame } from './support/frame.mjs';

const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);
after(() => closeHarness());

const demo = join(fileURLToPath(new URL('../../../', import.meta.url)), 'fixtures', 'demo', 'fonts');
const font = (name) => readFileSync(join(demo, name));
const FILES = {
  '/r/README.md': '# Here\n',
  '/r/fonts/TidemarkSans-Regular.ttf': font('TidemarkSans-Regular.ttf'),
  '/r/fonts/TidemarkSans[wdth,wght].ttf': font('TidemarkSans[wdth,wght].ttf'),
  '/r/fonts/TidemarkSans[wdth,wght].woff2': font('TidemarkSans[wdth,wght].woff2'),
  '/r/fonts/Tidemark.ttc': font('Tidemark.ttc'),
  // An sfnt head with nothing a font checker accepts after it.
  '/r/fonts/broken.ttf': new Uint8Array([0, 1, 0, 0, 0, 1, 0, 16, 0, 0, 0, 0, ...new Array(200).fill(7)]),
};

const factsOf = async (page, id) => {
  // The passing Glyph card is Metadata's part under the cursor.
  await (id === 'now-glyph' ? showPanel(page, 'metadata') : showCardPanel(page, id));
  return page.evaluate((id) => Object.fromEntries([...document.querySelectorAll(`.marxy-drawer [data-marxy-card="${id}"] .marxy-fact`)].map((e) => [e.children[0].textContent, e.children[1].textContent])), id);
};
const headSay = (page) =>
  page.evaluate(() => {
    const g = document.querySelector('[data-marxy-head="0"] .marxy-guess');
    return g && !g.hidden ? { text: g.textContent, tier: g.hasAttribute('data-marxy-tier') } : null;
  });
/** The page's own faces in document.fonts, and whether each loaded. */
const loadedFaces = (page) => page.evaluate(() => [...document.fonts].filter((f) => f.family.replace(/"/g, '').startsWith('marxy-specimen-')).map((f) => `${f.family.replace(/"/g, '')}:${f.status}`));
const specimenShown = (page) => page.waitForFunction(() => {
  const s = document.querySelector('.marxy-font-spec');
  return s && s.style.visibility !== 'hidden';
});

test('a TrueType font is a specimen the webview draws from the file: sets, sample, waterfall, every character, Font and Names', async () => {
  await withFrame({ files: FILES, open: ['/r/fonts/TidemarkSans-Regular.ttf'] }, async (page) => {
    await page.waitForSelector('[data-marxy-viewer="font"] .marxy-font-spec');
    await specimenShown(page);
    assert.equal(await page.textContent('.marxy-font-line'), 'TrueType · 94 glyphs');
    // A FontFace made over the file's bytes, loaded, under a family of the page's own: nothing installed.
    const faces = await loadedFaces(page);
    assert.equal(faces.length, 1);
    assert.match(faces[0], /^marxy-specimen-\d+:loaded$/);
    const family = faces[0].split(':')[0];
    assert.match(await page.$eval('.marxy-font-spec', (s) => s.style.fontFamily), new RegExp(family));
    assert.equal(await page.textContent('.marxy-font-name'), 'Tidemark Sans Regular');
    assert.deepEqual(await page.$$eval('.marxy-font-row .marxy-font-label', (els) => els.map((e) => e.textContent)), ['Capitals', 'Lower case', 'Figures', 'Marks', 'Sample']);
    assert.equal(await page.$eval('.marxy-font-set', (e) => e.textContent), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ');
    assert.equal(await page.inputValue('.marxy-font-sample'), 'The tide turns at the harbour mouth.', 'the sample line is the font’s own name table’s');
    assert.deepEqual(await page.$$eval('.marxy-font-wr .marxy-font-label', (els) => els.map((e) => e.textContent)), ['12', '14', '18', '24', '32', '48', '72']);
    assert.match(await page.textContent('.marxy-font-gh'), /Every character it maps\s*92 characters, 94 glyphs/);
    assert.equal(await page.$$eval('.marxy-font-glyphs button', (b) => b.length), 92);
    assert.equal(await page.textContent('.marxy-font-glyphs button[aria-label="U+0041"] .marxy-font-c'), '0041');
    // Typed over for this tab: every size says it.
    await page.fill('.marxy-font-sample', 'Slack water');
    assert.deepEqual(new Set(await page.$$eval('.marxy-font-wf', (els) => els.map((e) => e.textContent))), new Set(['Slack water']));
    // Metadata: Reading with its tiers and caps, Names, Facts; Outline: Font.
    assert.deepEqual((await cardsOf(page)).map((c) => c.title), ['Reading', 'Facts', 'Names', 'Font']);
    const reading = await cardText(page, 'reading');
    assert.match(reading, /Shown as a font · TrueType/);
    assert.match(reading, /A specimen\s+drawn by the webview from the file\s+Its tables only\s+when the webview will not draw it\s+The bytes\s+when it is not a font/);
    assert.match(reading, /never installed/);
    assert.equal(await page.textContent('.marxy-drawer .marxy-tiers li[data-marxy-here] b'), 'A specimen');
    const f = await factsOf(page, 'contents');
    assert.equal(f.format, 'TrueType');
    assert.equal(f.outlines, 'TrueType (quadratics)');
    assert.equal(f.units, '1000 to the em · caps 700, x-height 500');
    assert.equal(f.weight, '400 · width class 5');
    assert.equal(f.covers, '93 characters: Basic Latin 83, Latin-1 2, Punctuation 6, Currency 1, Arrows 1');
    assert.equal(f.embedding, 'installable: no limits set');
    assert.equal(f.tables, 'OS/2 cmap glyf head hhea hmtx loca maxp name post');
    const n = await factsOf(page, 'frontmatter');
    assert.equal(n.family, 'Tidemark Sans');
    assert.equal(n.PostScript, 'TidemarkSans-Regular');
    assert.equal(n.licence, 'SIL Open Font License 1.1');
    assert.equal(await headSay(page), null, 'a font found by its name and bytes is not a guess');
    // Source is the bytes: the hex view, from the sfnt's 00 01 00 00.
    await page.click('.marxy-rs-source');
    await page.waitForFunction(() => document.querySelector('.marxy-hexrow .marxy-hex-b i')?.textContent === '00');
    assert.equal(await page.$('.marxy-font-spec'), null);
    // Back in Read, the tab's sample is as the reader left it.
    await page.click('.marxy-rs-read');
    await page.waitForSelector('.marxy-font-sample');
    assert.equal(await page.inputValue('.marxy-font-sample'), 'Slack water');
    const exports = await page.evaluate(() => window.__marxyHandle.panes().focused.content.viewer().exports('rendered').map((e) => e.name));
    assert.deepEqual(exports, ['The file, as it is']);
  });
});

test('a variable font has a slider per axis that sets its variation settings, and named instances as chips', async () => {
  await withFrame({ files: FILES, open: ['/r/fonts/TidemarkSans[wdth,wght].ttf'] }, async (page) => {
    await page.waitForSelector('.marxy-font-axes');
    await specimenShown(page);
    assert.match(await page.textContent('.marxy-font-line'), /^TrueType · 94 glyphs · variable: wght, wdth$/);
    assert.deepEqual(await page.$$eval('.marxy-font-axis-name', (els) => els.map((e) => e.textContent)), ['Weight wght', 'Width wdth']);
    assert.deepEqual(await page.$$eval('.marxy-font-axis-range', (els) => els.map((e) => e.textContent)), ['300 to 800', '75 to 100']);
    assert.deepEqual(await page.$$eval('.marxy-font-named .marxy-chip', (els) => els.map((e) => e.textContent)), ['Light', 'Regular', 'Medium', 'Bold', 'ExtraBold', 'Condensed', 'Condensed Bold']);
    const settings = () => page.$eval('.marxy-font-spec', (s) => s.style.fontVariationSettings);
    assert.equal(await settings(), '"wght" 400, "wdth" 100');
    assert.equal(await page.textContent('.marxy-font-style'), 'Regular');
    // The sliders: between instances, the name says the values.
    const slide = (label, v) =>
      page.$eval(`.marxy-font-axis input[aria-label="${label}"]`, (i, v) => {
        i.value = String(v);
        i.dispatchEvent(new Event('input', { bubbles: true }));
      }, v);
    await slide('Weight', 720);
    await slide('Width', 78);
    assert.equal(await settings(), '"wght" 720, "wdth" 78');
    assert.equal(await page.textContent('.marxy-font-style'), 'wght 720 · wdth 78');
    assert.deepEqual(await page.$$eval('.marxy-font-axis-value', (els) => els.map((e) => e.textContent)), ['720', '78']);
    assert.equal(await page.$$eval('.marxy-font-named .marxy-chip[aria-pressed="true"]', (els) => els.length), 0);
    await page.click('.marxy-font-named .marxy-chip:text-is("Condensed Bold")');
    assert.equal(await settings(), '"wght" 700, "wdth" 75');
    assert.equal(await page.textContent('.marxy-font-style'), 'Condensed Bold');
    assert.equal(await page.textContent('.marxy-font-named .marxy-chip[aria-pressed="true"]'), 'Condensed Bold');
    // A glyph picked is a passing Glyph card above the standing ones, read from glyf.
    await page.click('.marxy-font-glyphs button[aria-label="U+0052"]');
    // The Glyph card is the part under the cursor: Metadata's "This part", after its standing cards.
    await showPanel(page, 'metadata');
    await page.waitForFunction(() => document.querySelector('.marxy-drawer [data-marxy-card="now-glyph"]')?.innerText.includes('outline'));
    const glyph = (await cardsOf(page, 'metadata')).at(-1);
    assert.deepEqual([glyph.title, glyph.detail], ['Glyph', 'U+0052']);
    // Read before Outline is shown: the Font card drawn there sets the specimen again, which lets the glyph go.
    const g = await factsOf(page, 'now-glyph');
    assert.equal(await page.$eval('.marxy-drawer .marxy-font-big', (b) => b.style.fontVariationSettings), '"wght" 700, "wdth" 75');
    const font = (await cardsOf(page, 'outline'))[0];
    assert.deepEqual([font.title, font.detail], ['Font', '94 glyphs']);
    assert.match(g.glyph, /^number \d+ · (no names in the file|named R)$/);
    assert.match(g.advance, /^\d+ of 1000 units, at the default axes$/);
    assert.match(g.outline, /^\d+ contours?, \d+ points$/);
    const f = await factsOf(page, 'contents');
    assert.equal(f.axes, 'Weight wght 300 to 800, default 400Width wdth 75 to 100, default 100');
    assert.equal(f.named, 'Light, Regular, Medium, Bold, ExtraBold, Condensed, Condensed Bold');
    // Escape lets the glyph go. Metadata is shown first: drawing the Font card again picks a glyph of its own (the
    // note), and a click on the name puts the parts cursor there, which the first Escape lets go.
    await showPanel(page, 'metadata');
    await page.click('.marxy-font-name');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.marxy-drawer [data-marxy-card="now-glyph"]'));
  });
});

test("a collection's faces are a row above the specimen, each lifted into a font of its own and drawn", async () => {
  await withFrame({ files: FILES, open: ['/r/fonts/Tidemark.ttc'] }, async (page) => {
    await page.waitForSelector('.marxy-font-faces');
    await specimenShown(page);
    assert.match(await page.textContent('.marxy-font-line'), /^a font collection · 3 faces · 94 glyphs$/);
    assert.deepEqual(await page.$$eval('.marxy-font-face', (els) => els.map((e) => `${e.textContent}${e.getAttribute('aria-selected') === 'true' ? '*' : ''}`)), [
      'Tidemark Sans Regular*',
      'Tidemark Sans Bold',
      'Tidemark Mono Regular',
    ]);
    await page.click('.marxy-font-face:text-is("Tidemark Mono Regular")');
    await page.waitForFunction(() => document.querySelector('.marxy-font-name')?.textContent === 'Tidemark Mono Regular');
    await specimenShown(page);
    await page.waitForFunction(() => [...document.fonts].filter((f) => f.family.replace(/"/g, '').startsWith('marxy-specimen-') && f.status === 'loaded').length === 2);
    // Each face its own family: the first and the third are not one font.
    const families = await loadedFaces(page);
    assert.equal(new Set(families.map((f) => f.split(':')[0])).size, 2);
    // Drawn at its fixed pitch: an i is as wide as an m.
    const widths = await page.evaluate(() => {
      const spec = document.querySelector('.marxy-font-spec');
      const w = (t) => {
        const s = document.createElement('span');
        s.textContent = t;
        s.style.fontSize = '40px';
        spec.append(s);
        const width = s.getBoundingClientRect().width;
        s.remove();
        return width;
      };
      return [w('iiii'), w('mmmm')];
    });
    assert.ok(Math.abs(widths[0] - widths[1]) < 1, `fixed pitch: ${widths}`);
    const f = await factsOf(page, 'contents');
    assert.equal(f.format, 'a font collection');
    assert.equal(f.weight, '400 · width class 5 · fixed pitch');
    assert.equal(f.faces, '1. Tidemark Sans Regular2. Tidemark Sans Bold3. Tidemark Mono Regular');
    assert.equal((await factsOf(page, 'frontmatter')).family, 'Tidemark Mono');
    assert.match(await cardText(page, 'reading'), /Shown as a font · a font collection/);
  });
});

test('a WOFF2 is drawn, and its names and axes come from the file itself, its own directory in the Font card', async () => {
  await withFrame({ files: FILES, open: ['/r/fonts/TidemarkSans[wdth,wght].woff2'] }, async (page) => {
    await page.waitForSelector('.marxy-font-axes');
    await specimenShown(page);
    assert.match(await page.textContent('.marxy-font-line'), /^WOFF2 · 94 glyphs · variable: wght, wdth$/);
    const f = await factsOf(page, 'contents');
    assert.equal(f.format, 'WOFF2 · Brotli, 9.8 KB for 22.9 KB');
    assert.equal(f.tables, 'OS/2 STAT cmap fvar glyf gvar head hhea hmtx loca maxp name post');
    assert.equal((await factsOf(page, 'frontmatter')).family, 'Tidemark Sans');
    assert.match(await cardText(page, 'reading'), /Shown as a font · WOFF2/);
  });
});

test('a face the webview will not draw is its tables only, said in grey in the head as a tier', async () => {
  await withFrame({ files: FILES, open: ['/r/fonts/broken.ttf'] }, async (page) => {
    await page.waitForSelector('[data-marxy-viewer="font"] .marxy-font-note');
    assert.match(await page.textContent('.marxy-font-note'), /^The webview would not draw this face: .+\. Metadata lists its tables, and Source has the bytes\.$/);
    assert.equal(await page.$('.marxy-font-spec'), null);
    await page.waitForFunction(() => document.querySelector('[data-marxy-head="0"] .marxy-guess')?.textContent === 'Tables only · the webview will not draw it');
    assert.deepEqual(await headSay(page), { text: 'Tables only · the webview will not draw it', tier: true });
    await showCardPanel(page, 'reading');
    assert.equal(await page.textContent('.marxy-drawer .marxy-tiers li[data-marxy-here] b'), 'Its tables only');
    // The file card and the bytes, on request.
    await page.click('.marxy-drawer button:text-is("Show the file card and the bytes instead")');
    await page.waitForSelector('.marxy-fcard');
    assert.equal(await page.textContent('.marxy-drawer .marxy-tiers li[data-marxy-here] b'), 'The bytes');
  });
});
