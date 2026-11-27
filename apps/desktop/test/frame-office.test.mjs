// Word documents and decks read as text: the demo's report as headings, lists, a table, notes, comments and a picture drawn
// from the file's own bytes; the demo's deck as one page of slides with their numbers and speaker notes; the panel's
// Document card; find on the page; Source as the bytes; a link followed only when clicked; a file whose XML declares a
// document type refused; a document's text that looks like markup kept as text; the demo's Word 97 document and
// PowerPoint 97 deck read through the shell's compound-file reader, Source their bytes. Every request is watched: none
// leaves for the network. WebKit, over the memory shell.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test as nodeTest } from 'node:test';
import { samplePng, storedZip, wordParts } from '../../../packages/core/src/office/testing/samples.ts';
import { closeHarness } from './support/two-pane.mjs';
import { cardText, skip, withFrame } from './support/frame.mjs';

const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);
after(() => closeHarness());

const demo = join(fileURLToPath(new URL('../../../', import.meta.url)), 'fixtures', 'demo', 'documents');
const DOCX = '/r/docs/harbour-survey-2026.docx';
const PPTX = '/r/docs/tide-gauge-upgrade.pptx';
const HOSTILE = '/r/docs/hostile.docx';
const DTD = '/r/docs/entities.docx';
const DOC = '/r/docs/harbour-survey-1998.doc';
const PPT = '/r/docs/tide-gauge-review.ppt';
// A compound file's magic and nothing after it: not one of the demo's, so the browser build's shell has no reading of it.
const STRANGER = '/r/docs/stranger.doc';

const hostile = () => {
  const parts = wordParts();
  const body = ['<script>alert(1)</script>', '[click](javascript:alert(1))', '# not a heading', 'a | b and **not bold**', 'depth > draught, "clear"']
    .map((t) => `<w:p><w:r><w:t xml:space="preserve">${t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</w:t></w:r></w:p>`)
    .join('');
  parts['word/document.xml'] = `<?xml version="1.0"?><w:document xmlns:w="w" xmlns:r="r"><w:body>${body}</w:body></w:document>`;
  return storedZip(parts);
};
const withDtd = () => {
  const parts = wordParts();
  parts['word/document.xml'] = '<?xml version="1.0"?><!DOCTYPE d [<!ENTITY a "aaaaaaaa"><!ENTITY b "&a;&a;&a;&a;">]><w:document xmlns:w="w"><w:body><w:p><w:r><w:t>&b;</w:t></w:r></w:p></w:body></w:document>';
  return storedZip(parts);
};

const LINKS = '/r/docs/links.docx';
const PICTURES = '/r/docs/pictures.docx';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
/** A document whose parts are the sample's, with `body` for its text and `rels` for its relationships. */
const docWith = (body, rels, more = {}) => {
  const parts = { ...wordParts(), ...more };
  parts['word/document.xml'] = `<?xml version="1.0"?><w:document xmlns:w="w" xmlns:r="r" xmlns:wp="wp" xmlns:a="a" xmlns:pic="pic"><w:body>${body}</w:body></w:document>`;
  parts['word/_rels/document.xml.rels'] = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`;
  return storedZip(parts);
};
// Links that would reach another machine, are badly encoded, or name a fragment that is.
const HREFS = ['%5C%5Cattacker%5Cshare%5Cx.md', '%2F%2Fattacker%2Fshare%2Fx.md', 'a%E0%A4%A.md', '#bad%E0%A4%A'];
const links = () =>
  docWith(
    HREFS.map((_, i) => `<w:p><w:hyperlink r:id="rL${i}"><w:r><w:t>link ${i}</w:t></w:r></w:hyperlink></w:p>`).join(''),
    HREFS.map((h, i) => `<Relationship Id="rL${i}" Type="${REL}/hyperlink" Target="${h}" TargetMode="External"/>`).join(''),
  );
// 305 pictures of their own, then one picture shown 50 times.
const DISTINCT = 305;
const pictures = () => {
  const media = {};
  let rels = '';
  let body = '';
  const drawing = (id) => `<w:p><w:r><w:drawing><wp:inline><wp:docPr id="1" name="p" descr="picture ${id}"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:blipFill><a:blip r:embed="${id}"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
  for (let i = 0; i < DISTINCT; i++) {
    media[`word/media/p${i}.png`] = samplePng(2, 2, () => [i & 255, (i >> 8) & 255, 90]);
    rels += `<Relationship Id="rP${i}" Type="${REL}/image" Target="media/p${i}.png"/>`;
  }
  // The repeated one comes first, so it is among the pictures drawn.
  for (let k = 0; k < 50; k++) body += drawing('rP0');
  for (let i = 1; i < DISTINCT; i++) body += drawing(`rP${i}`);
  return docWith(body, rels, media);
};

const FILES = {
  '/r/README.md': '# Here\n',
  [DOCX]: readFileSync(join(demo, 'harbour-survey-2026.docx')),
  [PPTX]: readFileSync(join(demo, 'tide-gauge-upgrade.pptx')),
  [HOSTILE]: hostile(),
  [DTD]: withDtd(),
  [LINKS]: links(),
  [PICTURES]: pictures(),
  [DOC]: readFileSync(join(demo, 'harbour-survey-1998.doc')),
  [PPT]: readFileSync(join(demo, 'tide-gauge-review.ppt')),
  [STRANGER]: new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]),
};

const open = (page, path) => page.evaluate((p) => window.__marxyHandle.open(p), path);
const calls = (page, method) => page.evaluate((m) => window.__marxyHandle.shell.calls.filter((c) => c.method === m).map((c) => c.args), method);

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

test('a Word document reads as text in the reading look: headings, lists, a table, notes, comments, a picture', async () => {
  await withFrame({ files: FILES, open: ['/r/README.md'] }, async (page) => {
    const off = watchNetwork(page);
    await open(page, DOCX);
    await page.waitForSelector('.marxy-office .marxy-article h1');
    assert.equal(await page.getAttribute('[data-marxy-viewer]', 'data-marxy-viewer'), 'office');
    assert.match(await page.textContent('.marxy-office .marxy-reading-head'), /^Word document · \d+ words · 3 notes · 2 comments$/);
    const shape = await page.evaluate(() => {
      const a = document.querySelector('.marxy-office .marxy-article');
      return {
        h: [...a.querySelectorAll(':scope > h1, :scope > h2, :scope > h3')].map((h) => `${h.localName} ${h.textContent}`),
        lists: a.querySelectorAll(':scope > ol, :scope > ul').length,
        nested: a.querySelectorAll(':scope > ol li > ul').length,
        resumed: a.querySelector(':scope > ol[start="3"]')?.textContent.trim() ?? null,
        rows: a.querySelectorAll(':scope > table tbody tr').length,
        notes: a.querySelectorAll('.marxy-footnotes > li').length,
        asides: [...a.querySelectorAll('.marxy-office-aside .marxy-office-who-name')].map((e) => e.textContent),
        code: a.querySelector(':scope > pre')?.textContent ?? null,
        quote: a.querySelector(':scope > blockquote')?.textContent.trim() ?? null,
        text: a.innerText,
      };
    });
    assert.deepEqual(shape.h, ['h1 Harbour Survey 2026', 'h2 Summary', 'h2 What we did', 'h3 Equipment', 'h2 Results by berth', 'h3 Sounding record', 'h2 Next steps']);
    assert.equal(shape.nested, 1);
    assert.equal(shape.resumed, 'Wrote up the results');
    assert.equal(shape.rows, 3);
    assert.equal(shape.notes, 3);
    assert.deepEqual(shape.asides, ['Ines Marlow', 'Tom Reyes']);
    assert.match(shape.code, /02 {3}09:14 {2}<6\.10>/);
    // The page binds a line's last word to the one before it, with a no-break space.
    assert.match(shape.quote, /never misses a\sday/);
    assert.match(shape.text, /depth > draught, and “clear” means/);
    assert.match(shape.text, /Fish dock \| inner/);
    assert.match(shape.text, /Chart, not drawn: Dredged depth by berth/);
    // The picture, drawn from the file's own bytes.
    await page.waitForFunction(() => document.querySelector('.marxy-office img.marxy-office-pic')?.complete);
    const pic = await page.evaluate(() => {
      const i = document.querySelector('.marxy-office img.marxy-office-pic');
      return { src: i.src.slice(0, 5), w: i.naturalWidth, alt: i.alt };
    });
    assert.deepEqual(pic, { src: 'blob:', w: 240, alt: 'A week of tide heights at the north gauge: two highs a day, the spring tide on Thursday' });
    // The parts the file holds were read; nothing it names outside itself was.
    const read = (await calls(page, 'readArchiveEntry')).map((c) => c[2]);
    assert.ok(read.includes('word/document.xml') && read.includes('word/media/tides.png'), read.join(', '));
    assert.ok(read.every((n) => !/^[a-z]+:/i.test(n)), read.join(', '));
    const about = await cardText(page, 'frontmatter');
    assert.match(about, /author\s+Ines Marlow/);
    assert.match(about, /saved by\s+Tom Reyes/);
    assert.match(about, /words\s+\d+/);
    assert.match(about, /comments\s+2/);
    assert.deepEqual(off, []);
  });
});

test('a link is followed only when clicked, out to the browser; find searches the page; Source is the bytes', async () => {
  await withFrame({ files: FILES, open: [DOCX] }, async (page) => {
    await page.waitForSelector('.marxy-office .marxy-article h1');
    assert.deepEqual(await calls(page, 'openExternal'), []);
    await page.click('.marxy-office a[href="https://example.org/harbour"]');
    await page.waitForFunction(() => window.__marxyHandle.shell.calls.some((c) => c.method === 'openExternal'));
    assert.deepEqual(await calls(page, 'openExternal'), [['https://example.org/harbour']]);
    await page.click('.marxy-office h1');
    await page.keyboard.press('ControlOrMeta+f');
    await page.keyboard.type('gauge');
    await page.waitForFunction(() => /of 3$/.test(document.querySelector('.marxy-find')?.textContent ?? ''), null, { timeout: 10_000 }).catch(() => {});
    assert.match(await page.textContent('.marxy-find'), /1 of 3/);
    await page.keyboard.press('Escape');
    await page.click('.marxy-rs-source');
    await page.waitForFunction(() => document.querySelectorAll('.marxy-hexpage').length > 0);
  });
});

test('a deck reads as one page of slides: numbers in the margin, titles, bullets, a table, notes set apart', async () => {
  await withFrame({ files: FILES, open: ['/r/README.md'] }, async (page) => {
    const off = watchNetwork(page);
    await open(page, PPTX);
    await page.waitForSelector('.marxy-office .marxy-office-slide');
    assert.equal(await page.textContent('.marxy-office .marxy-reading-head'), 'PowerPoint deck · 5 slides · 1 hidden · notes on 3');
    const deck = await page.evaluate(() => {
      const a = document.querySelector('.marxy-office .marxy-article');
      return {
        slides: [...a.querySelectorAll('.marxy-office-slide')].map((h) => h.textContent),
        hidden: [...a.querySelectorAll('.marxy-office-no-hidden')].map((n) => n.textContent),
        notes: a.querySelectorAll('.marxy-office-notes').length,
        nested: a.querySelectorAll(':scope > ul li > ul li > ul').length,
        table: a.querySelector(':scope > table')?.innerText.replace(/\s+/g, ' ').trim(),
        text: a.innerText,
      };
    });
    assert.deepEqual(deck.slides, ['1Tide Gauge Upgrade', '2Why replace the gauge', '3Costs', '4A week of readings', '5Slide 5']);
    assert.deepEqual(deck.hidden, ['5']);
    assert.equal(deck.notes, 3);
    assert.equal(deck.nested, 1);
    assert.equal(deck.table, 'Item Cost Radar head £4,200 Mast and fitting £1,150');
    assert.doesNotMatch(deck.text, /Confidential draft/);
    const parts = await page.evaluate(() => window.__marxyHandle.panes().focused.content.viewer().parts('rendered').top().map((u) => `${u.label} ${u.address}`));
    assert.deepEqual(parts, ['Tide Gauge Upgrade #slide=1', 'Why replace the gauge #slide=2', 'Costs #slide=3', 'A week of readings #slide=4', 'Slide 5 #slide=5']);
    assert.deepEqual(off, []);
  });
});

test('a document’s text that looks like markup stays text; a document type is refused, its entities never expanded', async () => {
  await withFrame({ files: FILES, open: ['/r/README.md'] }, async (page) => {
    await open(page, HOSTILE);
    await page.waitForSelector('.marxy-office .marxy-article > p');
    const got = await page.evaluate(() => {
      const a = document.querySelector('.marxy-office .marxy-article');
      return { scripts: a.querySelectorAll('script').length, links: a.querySelectorAll('a').length, h: a.querySelectorAll('h1').length, strong: a.querySelectorAll('strong').length, text: a.innerText };
    });
    assert.deepEqual({ ...got, text: undefined }, { scripts: 0, links: 0, h: 0, strong: 0, text: undefined });
    assert.match(got.text, /<script>alert\(1\)<\/script>/);
    assert.match(got.text, /\[click\]\(javascript:alert\(1\)\)/);
    assert.match(got.text, /# not a heading/);
    assert.match(got.text, /a \| b and \*\*not bold\*\*/);
    assert.match(got.text, /depth > draught, “clear”/);
    await open(page, DTD);
    await page.waitForFunction(() => /document type/.test(document.querySelector('[data-marxy-viewer]')?.textContent ?? ''));
    assert.equal(await page.getAttribute('[data-marxy-viewer]', 'data-marxy-viewer'), 'card');
    assert.doesNotMatch(await page.textContent('[data-marxy-viewer]'), /aaaaaaaa/);
  });
});

test('a link to another machine or a badly encoded one is refused, and nothing is looked up', async () => {
  await withFrame({ files: FILES, open: [LINKS] }, async (page) => {
    await page.waitForSelector('.marxy-office .marxy-article > p a');
    const hrefs = await page.$$eval('.marxy-office .marxy-article > p a', (as) => as.map((a) => a.getAttribute('href')));
    assert.equal(hrefs.length, HREFS.length, hrefs.join(' '));
    for (let i = 0; i < hrefs.length; i++) {
      await page.click(`.marxy-office .marxy-article > p:nth-of-type(${i + 1}) a`);
      await page.waitForTimeout(150);
    }
    const said = await page.$$eval('.marxy-notice-text', (els) => els.map((e) => e.textContent));
    assert.ok(said.some((t) => /another machine, a drive or a scheme/.test(t)), said.join(' | '));
    assert.ok(said.some((t) => /not a well-formed address/.test(t)), said.join(' | '));
    const asked = await page.evaluate(() => window.__marxyHandle.shell.calls.filter((c) => JSON.stringify(c.args).includes('attacker')).map((c) => c.method));
    assert.deepEqual(asked, []);
    assert.deepEqual(await calls(page, 'openExternal'), []);
    assert.equal(await page.getAttribute('[data-marxy-viewer]', 'data-marxy-viewer'), 'office', 'the page is still there');
  });
});

test('pictures: each one read once however often it is shown, one after another, and no more than 300', async () => {
  await withFrame({ files: FILES, open: [PICTURES] }, async (page) => {
    await page.waitForSelector('.marxy-office .marxy-office-figure');
    await page.waitForFunction(() => document.querySelectorAll('.marxy-office img.marxy-office-pic').length >= 50 + 299, null, { timeout: 60_000 });
    const got = await page.evaluate(() => ({
      drawn: document.querySelectorAll('.marxy-office img.marxy-office-pic').length,
      named: [...document.querySelectorAll('.marxy-office .marxy-office-stand')].map((s) => s.textContent),
    }));
    assert.equal(got.drawn, 50 + 299);
    assert.equal(got.named.length, 305 - 300);
    assert.ok(got.named.every((t) => /too many pictures/.test(t)), got.named.join(' | '));
    const read = (await calls(page, 'readArchiveEntry')).map((c) => c[2]).filter((n) => n.startsWith('word/media/'));
    assert.equal(read.length, 300);
    assert.equal(new Set(read).size, 300, 'none read twice');
  });
});

test('a Word 97 document reads as text: a title, headings, bold, a link, a table, a list, a picture named; Source is its bytes', async () => {
  await withFrame({ files: FILES, open: ['/r/README.md'] }, async (page) => {
    const off = watchNetwork(page);
    await open(page, DOC);
    await page.waitForSelector('.marxy-office .marxy-article h1');
    assert.equal(await page.getAttribute('[data-marxy-viewer]', 'data-marxy-viewer'), 'office');
    assert.match(await page.textContent('.marxy-office .marxy-reading-head'), /^Word 97-2003 document · \d+ words$/);
    const shape = await page.evaluate(() => {
      const a = document.querySelector('.marxy-office .marxy-article');
      const words = (e) => e.textContent.replace(/\s+/g, ' ').trim();
      return {
        h: [...a.querySelectorAll(':scope > h1, :scope > h2, :scope > h3')].map((h) => `${h.localName} ${words(h)}`),
        strong: [...a.querySelectorAll('strong')].map(words),
        em: [...a.querySelectorAll('em')].map(words),
        rows: [...a.querySelectorAll(':scope > table tr')].map((r) => r.innerText.replace(/\s+/g, ' ').trim()),
        items: [...a.querySelectorAll(':scope > ul > li')].map(words),
        link: words(a.querySelector('a[href="https://example.org/survey"]')),
        text: a.innerText,
      };
    });
    assert.deepEqual(shape.h, ['h1 Harbour survey, 1998', 'h2 Soundings', 'h3 Readings', 'h2 Notes from the pilots']);
    assert.deepEqual(shape.strong, ['four metres']);
    assert.deepEqual(shape.em, ['emphatically']);
    assert.deepEqual(shape.rows, ['Gauge Metres', 'North mole 4.2', 'Inner basin 3.9']);
    assert.deepEqual(shape.items, ['Buoys relaid', 'Leading lights checked']);
    assert.equal(shape.link, 'the board’s page');
    // An 8-bit piece in Windows-1252 and a UTF-16 one; a field's result, never its code. The page binds short words to
    // their neighbours with no-break spaces.
    assert.match(shape.text, /the café\spier\s–\sas\s‘ever’\s–\sa\slittle\sless/);
    assert.match(shape.text, /Ωμέγα\sbuoy,\semphatically\srelit\s漢字/);
    assert.match(shape.text, /page\s3\./);
    assert.doesNotMatch(shape.text, /HYPERLINK|PAGE/);
    assert.match(shape.text, /Picture, not drawn/);
    const about = await cardText(page, 'frontmatter');
    assert.match(about, /title\s+Harbour survey, 1998/);
    assert.match(about, /author\s+R\. Marsh/);
    // The file's bytes, as they are, were what the shell was handed.
    const size = FILES[DOC].length;
    assert.deepEqual(await calls(page, 'officeFromOle'), [[size]]);
    await page.click('.marxy-office h1');
    await page.click('.marxy-rs-source');
    await page.waitForFunction(() => /d0\s*cf\s*11\s*e0/i.test(document.querySelector('.marxy-hexpage')?.textContent ?? ''));
    assert.deepEqual(off, []);
  });
});

test('a PowerPoint 97 deck lists its three slides with their titles, the hidden one marked, its notes set apart', async () => {
  await withFrame({ files: FILES, open: ['/r/README.md'] }, async (page) => {
    await open(page, PPT);
    await page.waitForSelector('.marxy-office .marxy-office-slide');
    assert.equal(await page.textContent('.marxy-office .marxy-reading-head'), 'PowerPoint 97-2003 deck · 3 slides · 1 hidden · notes on 1');
    const deck = await page.evaluate(() => {
      const a = document.querySelector('.marxy-office .marxy-article');
      return {
        slides: [...a.querySelectorAll('.marxy-office-slide')].map((h) => h.textContent),
        hidden: [...a.querySelectorAll('.marxy-office-no-hidden')].map((n) => n.textContent),
        notes: [...a.querySelectorAll('.marxy-office-notes')].map((n) => n.innerText.replace(/\s+/g, ' ').trim()),
        text: a.innerText,
      };
    });
    assert.deepEqual(deck.slides, ['1Tide gauge review', '2Readings by month', '3Spares']);
    assert.deepEqual(deck.hidden, ['3']);
    assert.deepEqual(deck.notes, ['Speaker notes Mention the winter storms. Thank the pilots.']);
    assert.match(deck.text, /Figures from the harbour log/);
    assert.match(deck.text, /Picture, not drawn/);
    const parts = await page.evaluate(() => window.__marxyHandle.panes().focused.content.viewer().parts('rendered').top().map((u) => `${u.label} ${u.address}`));
    assert.deepEqual(parts, ['Tide gauge review #slide=1', 'Readings by month #slide=2', 'Spares #slide=3']);
  });
});

test('a .doc the shell cannot read falls to the file card, which says why', async () => {
  await withFrame({ files: FILES, open: [STRANGER] }, async (page) => {
    await page.waitForFunction(() => /cannot read/.test(document.querySelector('[data-marxy-viewer]')?.textContent ?? ''));
    assert.equal(await page.getAttribute('[data-marxy-viewer]', 'data-marxy-viewer'), 'card');
    assert.match(await page.textContent('[data-marxy-viewer]'), /A Word 97-2003 document the app cannot read/);
  });
});

test('a conversion whose pictures are not the ones it counted puts no image in the page and asks for none', async () => {
  await withFrame({ files: FILES, open: [DOCX] }, async (page) => {
    await page.evaluate(() => performance.setResourceTimingBufferSize(10_000));
    const got = await page.evaluate(async () => {
      const { fillOfficePage } = await import('/src/render/office-page.ts');
      const into = document.createElement('div');
      document.body.append(into);
      const drawn = fillOfficePage(into, 'Before ![a chart](./office-only-chart.png) and <img src="./office-only-tracker.png" alt="t"> after.\n', '/r/docs/harbour-survey-2026.docx');
      await new Promise((r) => setTimeout(r, 300));
      return {
        drawn: drawn.length,
        imgs: into.querySelectorAll('img').length,
        asked: performance.getEntriesByType('resource').map((e) => e.name).filter((n) => /office-only/.test(n)),
      };
    });
    assert.deepEqual(got, { drawn: 0, imgs: 0, asked: [] });
  });
});
