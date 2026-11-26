// An EPUB read as a book: its chapters as one page in the spine's order, a picture drawn from the book's own bytes and
// one on the web held back, the contents as the Outline with the verbs that read (go, fold, copy the chapter) and none
// that rearrange, the crumbs naming the chapter, a link inside the book followed to its place, the place kept across a
// reopening, Read as reaching the archive page and back, a locked book said plainly, and a broken spine falling back to
// the archive page with the sentence why. Every request is watched: none leaves for the network. WebKit, over the
// memory shell.
import { strict as assert } from 'node:assert';
import { after, test as nodeTest } from 'node:test';
import { epub3Parts, epubZip, SAMPLE_CHAPTERS } from '../../../packages/core/src/book/testing/samples.ts';
import { closeHarness } from './support/two-pane.mjs';
import { panelRows, skip, withFrame } from './support/frame.mjs';

const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);
after(() => closeHarness());

const BOOK = '/r/books/the-measure.epub';
const LOCKED = '/r/books/locked.epub';
const BROKEN = '/r/books/no-spine.epub';

// The sample's chapters made long enough to scroll through, so a place inside chapter 3 is a place.
const longParts = () => {
  const parts = epub3Parts();
  const filler = (n) => Array.from({ length: 30 }, (_, i) => `<p>Paragraph ${i + 1} of chapter ${n}, set long enough that the page has somewhere to scroll to and a place to keep.</p>`).join('');
  for (const n of [1, 2, 3]) parts[`OEBPS/chapter-0${n}.xhtml`] = String(parts[`OEBPS/chapter-0${n}.xhtml`]).replace('</body>', `${filler(n)}</body>`);
  return parts;
};
const locked = () => epubZip({ ...epub3Parts(), 'META-INF/rights.xml': '<rights xmlns="http://ns.adobe.com/adept"/>' });
const broken = () => {
  const parts = epub3Parts();
  parts['OEBPS/content.opf'] = String(parts['OEBPS/content.opf']).replace(/<spine[^]*<\/spine>/, '');
  return epubZip(parts);
};

const FILES = {
  '/r/README.md': '# Here\n',
  [BOOK]: epubZip(longParts()),
  [LOCKED]: locked(),
  [BROKEN]: broken(),
};

const open = (page, path) => page.evaluate((p) => window.__marxyHandle.open(p), path);
const calls = (page, method) => page.evaluate((m) => window.__marxyHandle.shell.calls.filter((c) => c.method === m).map((c) => c.args), method);
const viewerKind = (page) => page.getAttribute('[data-marxy-viewer]', 'data-marxy-viewer');
const blur = (page) => page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
const crumbs = (page) => page.$$eval('.marxy-crumbs [data-marxy-crumb="section"]:not([hidden])', (els) => els.map((e) => e.textContent));
/** The book page's scroller, and the top of heading `text` against it. */
const headingTop = (page, text) =>
  page.evaluate((t) => {
    const root = document.querySelector('.marxy-book');
    const h = [...root.querySelectorAll('h1, h2')].find((x) => x.textContent === t);
    return h ? Math.round(h.getBoundingClientRect().top - root.getBoundingClientRect().top) : null;
  }, text);

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

test('an EPUB opens as one page in its spine’s order, its picture from inside the book, the one on the web held back', async () => {
  await withFrame({ files: FILES, open: ['/r/README.md'] }, async (page) => {
    const off = watchNetwork(page);
    await open(page, BOOK);
    await page.waitForSelector('.marxy-book .marxy-article h1');
    assert.equal(await viewerKind(page), 'book');
    assert.match(await page.textContent('.marxy-book .marxy-reading-head'), /^Book · 3 chapters · [\d,]+ words$/);
    const shape = await page.evaluate(() => {
      const a = document.querySelector('.marxy-book .marxy-article');
      const blocks = [...a.children].filter((c) => !c.matches('.marxy-account, .marxy-reading-head'));
      return {
        h1: [...a.querySelectorAll(':scope > h1')].map((h) => h.textContent),
        h2: [...a.querySelectorAll(':scope > h2')].map((h) => h.textContent),
        unranged: blocks.filter((b) => !b.hasAttribute('data-marxy-s') || !b.hasAttribute('data-marxy-e')).map((b) => b.outerHTML.slice(0, 60)),
        scripts: a.querySelectorAll('script').length,
        ran: window.ran === true,
        stand: [...a.querySelectorAll('.marxy-office-stand')].map((s) => s.textContent),
        table: a.querySelector(':scope > table')?.innerText.replace(/\s+/g, ' ').trim(),
      };
    });
    assert.deepEqual(shape.h1, SAMPLE_CHAPTERS);
    assert.deepEqual(shape.h2, ['Sixty-six']);
    assert.deepEqual(shape.unranged, [], 'every block carries its range in the page');
    assert.equal(shape.scripts, 0);
    assert.equal(shape.ran, false, 'nothing the book holds ran');
    assert.ok(shape.stand.some((t) => /^Linked picture, not fetched: A picture on the web/.test(t)), shape.stand.join(' | '));
    assert.equal(shape.table, 'Size Measure 16 600');
    // The picture, drawn from the book's own bytes.
    await page.waitForFunction(() => document.querySelector('.marxy-book img.marxy-office-pic')?.complete);
    const pic = await page.evaluate(() => {
      const i = document.querySelector('.marxy-book img.marxy-office-pic');
      return { src: i.src.slice(0, 5), w: i.naturalWidth, alt: i.alt };
    });
    assert.deepEqual(pic, { src: 'blob:', w: 48, alt: 'A plate of the measure' });
    const read = (await calls(page, 'readArchiveEntry')).map((c) => c[2]);
    assert.ok(read.includes('OEBPS/content.opf') && read.includes('OEBPS/images/plate.png'), read.join(', '));
    assert.ok(read.every((n) => !/^[a-z]+:/i.test(n)), read.join(', '));
    assert.ok(!read.includes('OEBPS/styles/book.css'), 'its styles are never read');
    assert.deepEqual(off, []);
  });
});

test('its contents are the Outline: chapters with their words, go, fold and copy the chapter, and nothing that rearranges', async () => {
  await withFrame({ files: FILES, open: [BOOK] }, async (page) => {
    await page.waitForSelector('.marxy-book .marxy-article h1');
    const rows = await panelRows(page, 'outline');
    assert.deepEqual(rows.map((r) => r.name), [SAMPLE_CHAPTERS[0], SAMPLE_CHAPTERS[1], 'Sixty-six', SAMPLE_CHAPTERS[2]]);
    assert.ok(rows.every((r) => /^[\d,]+$/.test(r.n) && r.n !== '0'), JSON.stringify(rows));
    assert.equal(await page.getAttribute('.marxy-drawer input[data-marxy-left-field="outline-q"]', 'placeholder'), 'Filter chapters');
    // The keys in the panel, the cursor on chapter 3: the foot offers the verbs that read, and no others.
    await page.evaluate(() => window.__marxyHandle.frame().left.show('outline', undefined, true));
    const cur = () => page.evaluate(() => document.querySelector('.marxy-drawer .marxy-l-prow.marxy-l-cur')?.dataset.marxyLeftRow ?? null);
    for (let i = 0; i < 8 && (await cur()) !== 'v:3'; i++) await page.keyboard.press('j');
    assert.equal(await cur(), 'v:3');
    const verbs = await page.$$eval('.marxy-drawer .marxy-l-foot button.marxy-l-vb', (bs) => bs.map((b) => b.textContent.replace(/\s+/g, ' ').trim()));
    assert.deepEqual(verbs, ['o go', 'z fold', 'c copy the chapter']);
    // Go: the chapter is at the top of the page and the crumbs name it.
    await page.keyboard.press('o');
    await page.waitForFunction(() => {
      const root = document.querySelector('.marxy-book');
      const h = [...root.querySelectorAll('h1')].find((x) => x.textContent.startsWith('3.'));
      return Math.abs(h.getBoundingClientRect().top - root.getBoundingClientRect().top) < 4;
    });
    await page.waitForFunction((t) => [...document.querySelectorAll('.marxy-crumbs [data-marxy-crumb="section"]')].some((e) => e.textContent === t), SAMPLE_CHAPTERS[2]);
    assert.deepEqual(await crumbs(page), [SAMPLE_CHAPTERS[2]]);
    // Copy the chapter: its text as the page's Markdown holds it.
    await page.keyboard.press('c');
    await page.waitForFunction(() => window.__marxyHandle.shell.calls.some((c) => c.method === 'clipboardWriteItem'));
    const copied = await page.evaluate(() => {
      const last = window.__marxyHandle.shell.calls.filter((c) => c.method === 'clipboardWriteItem').at(-1);
      const rep = last.args[0].find((r) => r.type === 'public.utf8-plain-text');
      return rep ? new TextDecoder().decode(rep.bytes) : '';
    });
    assert.match(copied, /^# 3\\\. Working it out/);
    assert.doesNotMatch(copied, /Where the numbers come from/);
    // Fold chapter 1 on the page: its heading stays, the rest of it goes; the file is not touched.
    for (let i = 0; i < 8 && (await cur()) !== 'v:0'; i++) await page.keyboard.press('k');
    await page.keyboard.press('z');
    const folded = await page.evaluate(() => {
      const a = document.querySelector('.marxy-book .marxy-article');
      const h = [...a.children].find((x) => x.textContent === '1. The way back');
      const next = h.nextElementSibling;
      return { headShown: !h.hidden, shut: h.classList.contains('marxy-book-shut'), nextHidden: next.hidden, ch2Shown: ![...a.children].find((x) => x.textContent.startsWith('2.')).hidden };
    });
    assert.deepEqual(folded, { headShown: true, shut: true, nextHidden: true, ch2Shown: true });
    assert.deepEqual(await calls(page, 'writeFileAtomic').then((c) => c.filter((a) => String(a[0]).endsWith('.epub'))), []);
  });
});

test('a link inside the book goes to its place; the place is kept when the book is opened again', async () => {
  await withFrame({ files: FILES, open: ['/r/README.md'] }, async (page) => {
    await open(page, BOOK);
    await page.waitForSelector('.marxy-book .marxy-article h1');
    await page.click('.marxy-book a[href^="#bk"]:text("the numbers")');
    await page.waitForFunction(() => {
      const root = document.querySelector('.marxy-book');
      const h = [...root.querySelectorAll('h2')].find((x) => x.textContent === 'Sixty-six');
      return Math.abs(h.getBoundingClientRect().top - root.getBoundingClientRect().top) < 4;
    });
    await page.waitForFunction(() => [...document.querySelectorAll('.marxy-crumbs [data-marxy-crumb="section"]')].some((e) => e.textContent === 'Sixty-six'));
    assert.deepEqual(await crumbs(page), [SAMPLE_CHAPTERS[1], 'Sixty-six']);
    // A way into chapter 3, then away and back: the book opens where it was left.
    await page.evaluate(() => {
      const root = document.querySelector('.marxy-book');
      const h = [...root.querySelectorAll('h1')].find((x) => x.textContent.startsWith('3.'));
      root.dispatchEvent(new WheelEvent('wheel'));
      root.scrollTop += h.getBoundingClientRect().top - root.getBoundingClientRect().top + 300;
    });
    await page.waitForTimeout(800);
    await blur(page);
    await open(page, '/r/README.md');
    await page.waitForFunction(() => !document.querySelector('.marxy-book'));
    await open(page, BOOK);
    await page.waitForSelector('.marxy-book .marxy-article h1');
    await page.waitForFunction(() => {
      const root = document.querySelector('.marxy-book');
      const h = [...root.querySelectorAll('h1')].find((x) => x.textContent.startsWith('3.'));
      const off = root.getBoundingClientRect().top - h.getBoundingClientRect().top;
      return off > 200 && off < 400;
    }, null, { timeout: 10_000 });
    const top = await headingTop(page, SAMPLE_CHAPTERS[2]);
    assert.ok(top < -200 && top > -400, String(top));
    // The book changed while it was closed: the place kept was a byte of the old page, and is dropped.
    await blur(page);
    await open(page, '/r/README.md');
    await page.waitForFunction(() => !document.querySelector('.marxy-book'));
    const changed = longParts();
    changed['OEBPS/chapter-01.xhtml'] = String(changed['OEBPS/chapter-01.xhtml']).replace('A column of type', 'A longer column of set type');
    await page.evaluate(async (b64) => {
      const raw = atob(b64);
      const out = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
      await window.__marxyHandle.shell.writeFileAtomic('/r/books/the-measure.epub', out);
    }, Buffer.from(epubZip(changed)).toString('base64'));
    await open(page, BOOK);
    await page.waitForFunction(() => /A longer column/.test(document.querySelector('.marxy-book')?.textContent ?? ''));
    await page.waitForTimeout(600);
    assert.equal(await page.evaluate(() => document.querySelector('.marxy-book').scrollTop), 0, 'the changed book opens at its start');
  });
});

test('Read as still reaches the archive page, and back to the book', async () => {
  await withFrame({ files: FILES, open: [BOOK] }, async (page) => {
    await page.waitForSelector('.marxy-book .marxy-article h1');
    await blur(page);
    await page.keyboard.press('r');
    await page.waitForSelector('[role="menu"]');
    const rows = await page.$$eval('[role="menu"] [role="menuitem"], [role="menu"] [aria-disabled]', (els) => els.map((e) => e.textContent.trim()));
    assert.match(rows[1], /^As found: A book/);
    assert.ok(rows.some((r) => /^An archive/.test(r)), rows.join(' | '));
    assert.match(rows.at(-1), /^Bytes/);
    await page.click('[role="menu"] [data-row-key="read-as.archive"]');
    await page.waitForFunction(() => document.querySelector('[data-marxy-viewer]')?.getAttribute('data-marxy-viewer') === 'archive');
    await page.waitForFunction(() => /chapter-01\.xhtml/.test(document.querySelector('[data-marxy-viewer]').textContent));
    assert.match(await page.textContent('.marxy-arch-said'), /You chose to read this book as the archive/);
    await blur(page);
    await page.keyboard.press('r');
    await page.waitForSelector('[role="menu"]');
    await page.click('[role="menu"] [data-row-key="read-as.found"]');
    await page.waitForSelector('.marxy-book .marxy-article h1');
    assert.equal(await viewerKind(page), 'book');
  });
});

test('a locked book says so plainly; a book with no spine is its archive, with the sentence why', async () => {
  await withFrame({ files: FILES, open: ['/r/README.md'] }, async (page) => {
    await open(page, LOCKED);
    await page.waitForFunction(() => /A locked book/.test(document.querySelector('[data-marxy-viewer]')?.textContent ?? ''));
    assert.equal(await viewerKind(page), 'card');
    assert.match(await page.textContent('[data-marxy-viewer]'), /Adobe’s DRM/);
    assert.doesNotMatch(await page.textContent('[data-marxy-viewer]'), /The way back/);
    await open(page, BROKEN);
    await page.waitForFunction(() => document.querySelector('[data-marxy-viewer]')?.getAttribute('data-marxy-viewer') === 'archive');
    assert.match(await page.textContent('.marxy-arch-said'), /^It is not read as a book: Its package file, OEBPS\/content\.opf, has no spine/);
  });
});
