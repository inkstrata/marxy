// Viewers under resize and teardown (bug hunt W5b): the hex view keeps its top byte when only the height changes and does
// not ask again for a chunk the shell answered short; the image page's pan flag follows a resize at a fixed zoom; the
// archive sheet keeps its first tile at the top across a column change; a font tab closed before its face loads adds
// none; mail's Load images is capped, runs a few at a time and stops when the tab closes. WebKit.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32 } from 'node:zlib';
import { after, test as nodeTest } from 'node:test';
import { closeHarness } from './support/two-pane.mjs';
import { skip, withFrame } from './support/frame.mjs';

const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);
after(() => closeHarness());

const demo = join(fileURLToPath(new URL('../../../', import.meta.url)), 'fixtures', 'demo');
const FILES = { '/r/README.md': '# Here\n' };

const open = (page, path) => page.evaluate((p) => window.__marxyHandle.open(p), path);

/** A zip of `[name, bytes]` entries, stored. */
function storedZip(entries) {
  const locals = [];
  const central = [];
  let at = 0;
  for (const [name, data] of entries) {
    const raw = Buffer.from(data);
    const n = Buffer.from(name);
    const crc = crc32(raw);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(raw.length, 18);
    head.writeUInt32LE(raw.length, 22);
    head.writeUInt16LE(n.length, 26);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(raw.length, 20);
    cd.writeUInt32LE(raw.length, 24);
    cd.writeUInt16LE(n.length, 28);
    cd.writeUInt32LE(at, 42);
    locals.push(head, n, raw);
    central.push(cd, n);
    at += 30 + n.length + raw.length;
  }
  const cdBytes = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cdBytes.length, 12);
  end.writeUInt32LE(at, 16);
  return new Uint8Array(Buffer.concat([...locals, cdBytes, end]));
}

const topRow = (page) => page.evaluate(() => Number(document.querySelector('.marxy-hexrow')?.dataset.marxyRow ?? NaN));
const frames = (page, n = 4) => page.evaluate((n) => new Promise((done) => { let i = 0; const f = () => (++i >= n ? done(null) : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);

test('a 100 MB file in the hex view keeps its top byte when only the pane height changes', async () => {
  const DISK = '/r/lab/big.img';
  await withFrame({ files: FILES, sparse: { [DISK]: 100_000_000 }, open: ['/r/README.md'] }, async (page) => {
    await open(page, DISK);
    await page.waitForSelector('.marxy-hexscroll');
    await page.waitForFunction(() => document.querySelector('.marxy-hexscroll')?.clientHeight > 100);
    await page.evaluate(() => { document.querySelector('.marxy-hexscroll').scrollTop = 2_000_000; });
    await page.waitForFunction(() => Number(document.querySelector('.marxy-hexrow')?.dataset.marxyRow) > 1_000_000);
    await frames(page);
    const before = await topRow(page);
    await page.setViewportSize({ width: 1440, height: 1300 });
    await frames(page, 6);
    const grown = await topRow(page);
    assert.ok(Math.abs(grown - before) <= 32, `top byte ${before} became ${grown} (${grown - before} bytes) on a taller pane`);
    await page.setViewportSize({ width: 1440, height: 700 });
    await frames(page, 6);
    const shrunk = await topRow(page);
    assert.ok(Math.abs(shrunk - before) <= 64, `top byte ${before} became ${shrunk} on a shorter pane`);
  });
});

test('a chunk the shell answers short is asked for once, not on every frame', async () => {
  const BIN = '/r/lab/short.bin';
  await withFrame({ files: { ...FILES, [BIN]: new Uint8Array(300_000).map((_, i) => i % 251) }, open: ['/r/README.md'] }, async (page) => {
    await page.evaluate(() => {
      const shell = window.__marxyHandle.shell;
      window.__asked = 0;
      shell.readRange = async () => {
        window.__asked++;
        return new Uint8Array(0);
      };
    });
    await open(page, BIN);
    await page.waitForSelector('.marxy-hexscroll');
    await frames(page, 12);
    const early = await page.evaluate(() => window.__asked);
    await frames(page, 30);
    const late = await page.evaluate(() => window.__asked);
    assert.ok(early >= 1, 'the view asked at all');
    assert.equal(late, early, `asked ${early} times in 12 frames and ${late} after 30 more`);
  });
});

test('the image page lets a drag pan after the pane narrows at 100 %', async () => {
  const IMG = '/r/images/harbour-at-low-water.jpg';
  await withFrame({ files: { ...FILES, [IMG]: readFileSync(join(demo, 'images', 'harbour-at-low-water.jpg')) }, open: [IMG] }, async (page) => {
    await page.waitForFunction(() => document.querySelector('.marxy-imgpic')?.complete && document.querySelector('.marxy-imgpic').naturalWidth > 0 && document.querySelector('.marxy-imgbar-zoom')?.textContent);
    await page.keyboard.press('1');
    await page.waitForFunction(() => document.querySelector('.marxy-imgbar-zoom')?.textContent === '100 %');
    const flag = () => page.$eval('.marxy-imgpage', (e) => e.hasAttribute('data-marxy-zoomed'));
    await page.setViewportSize({ width: 2000, height: 1200 });
    await frames(page, 6);
    assert.equal(await flag(), false, 'the picture fits a wide pane');
    await page.setViewportSize({ width: 800, height: 600 });
    await frames(page, 6);
    const spills = await page.$eval('.marxy-imgstage', (e) => e.scrollWidth > e.clientWidth || e.scrollHeight > e.clientHeight);
    assert.equal(spills, true, 'the picture spills a narrow pane');
    assert.equal(await flag(), true, 'drag-to-pan is on');
    await page.setViewportSize({ width: 2000, height: 1200 });
    await frames(page, 6);
    assert.equal(await flag(), false, 'and off again when it fits');
  });
});

test('the archive sheet keeps its first visible tile at the top when the column count changes', async () => {
  const icon = readFileSync(join(demo, 'images', 'tidemark-icon.png'));
  const many = [];
  for (let i = 0; i < 1_200; i++) many.push([`p/p-${String(i).padStart(4, '0')}.png`, icon]);
  const ZIP = '/r/archives/tiles.zip';
  await withFrame({ files: { ...FILES, [ZIP]: storedZip(many) }, open: ['/r/README.md'], viewport: { width: 1700, height: 900 } }, async (page) => {
    await open(page, ZIP);
    await page.waitForSelector('.marxy-arch-sheet .marxy-arch-tile');
    const colsOf = () => page.evaluate(() => {
      const s = document.querySelector('.marxy-arch-sheet');
      const xs = new Set([...s.querySelectorAll('.marxy-arch-tile')].map((t) => Math.round(t.getBoundingClientRect().left)));
      return xs.size;
    });
    const firstOf = () => page.evaluate(() => {
      const s = document.querySelector('.marxy-arch-sheet');
      const top = s.getBoundingClientRect().top;
      const t = [...s.querySelectorAll('.marxy-arch-tile')].find((e) => e.getBoundingClientRect().bottom > top + 1);
      return t?.querySelector('.marxy-arch-tile-name')?.textContent ?? null;
    });
    await page.evaluate(() => {
      const s = document.querySelector('.marxy-arch-sheet');
      s.scrollTop = (s.scrollHeight - s.clientHeight) / 2;
    });
    await frames(page, 6);
    const wide = await colsOf();
    const was = await firstOf();
    await page.setViewportSize({ width: 500, height: 900 });
    await frames(page, 8);
    const narrow = await colsOf();
    assert.ok(narrow !== wide, `the column count changed (${wide} to ${narrow})`);
    const now = await firstOf();
    const num = (s) => Number(/(\d{4})/.exec(s ?? '')?.[1]);
    assert.ok(Math.abs(num(now) - num(was)) <= wide + narrow, `first tile ${was} became ${now}`);
  });
});

test('a font tab closed before its face loads adds no face to the document', async () => {
  const FONT = '/r/fonts/TidemarkSans-Regular.ttf';
  await withFrame({ files: { ...FILES, [FONT]: readFileSync(join(demo, 'fonts', 'TidemarkSans-Regular.ttf')) }, open: ['/r/README.md'] }, async (page) => {
    await page.evaluate(() => {
      let release;
      const gate = new Promise((r) => (release = r));
      const load = FontFace.prototype.load;
      FontFace.prototype.load = function () {
        return gate.then(() => load.call(this));
      };
      window.__release = release;
    });
    await open(page, FONT);
    await page.click('.marxy-tabbar .marxy-tab[data-marxy-tab-path$="TidemarkSans-Regular.ttf"] .marxy-tab-close');
    await page.waitForFunction((p) => window.__marxyHandle.panes().panes[0].path() !== p, FONT);
    await page.evaluate(() => window.__release());
    await page.waitForTimeout(400);
    const faces = await page.evaluate(() => [...document.fonts].filter((f) => f.family.replace(/"/g, '').startsWith('marxy-specimen-')).length);
    assert.equal(faces, 0);
  });
});

const IMAGES = 300;
const mail = () =>
  [
    'From: a@example.com',
    'To: b@example.com',
    'Subject: Many images',
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=utf-8',
    '',
    `<html><body><h1>Hello</h1>${Array.from({ length: IMAGES }, (_, i) => `<img src="https://img.example/i/${i}.png">`).join('')}</body></html>`,
    '',
  ].join('\r\n');

test('Load images holds back past the store, fetches a few at once, and stops when the tab closes', async () => {
  const EML = '/r/mail/many.eml';
  await withFrame({ files: { ...FILES, [EML]: new TextEncoder().encode(mail()) }, open: ['/r/README.md'] }, async (page) => {
    await page.evaluate(() => {
      const shell = window.__marxyHandle.shell;
      const inner = shell.fetchRemoteImage.bind(shell);
      window.__fetch = { started: 0, live: 0, most: 0 };
      shell.fetchRemoteImage = async (url) => {
        const f = window.__fetch;
        f.started++;
        f.most = Math.max(f.most, ++f.live);
        await new Promise((r) => setTimeout(r, 5));
        f.live--;
        return inner(url);
      };
    });
    await open(page, EML);
    await page.waitForSelector('.marxy-mail-remote .marxy-btn');
    await page.click('.marxy-mail-remote .marxy-btn');
    await page.waitForSelector('.marxy-mail-remote[data-marxy-on]', { timeout: 60_000 });
    const f = await page.evaluate(() => window.__fetch);
    assert.ok(f.started <= 256, `${f.started} fetched for one click`);
    assert.ok(f.most <= 4, `${f.most} at once`);
    assert.match(await page.innerText('.marxy-mail-remote'), /left alone|not loaded/, 'the shortfall is said');
  });
  await withFrame({ files: { ...FILES, [EML]: new TextEncoder().encode(mail()) }, open: ['/r/README.md'] }, async (page) => {
    await page.evaluate(() => {
      const shell = window.__marxyHandle.shell;
      window.__started = 0;
      shell.fetchRemoteImage = async () => {
        window.__started++;
        await new Promise((r) => setTimeout(r, 20));
        return 'data:image/png;base64,iVBORw0KGgo=';
      };
    });
    await open(page, EML);
    await page.waitForSelector('.marxy-mail-remote .marxy-btn');
    await page.click('.marxy-mail-remote .marxy-btn');
    await page.waitForFunction(() => window.__started >= 4);
    await page.click('.marxy-tabbar .marxy-tab[data-marxy-tab-path$="many.eml"] .marxy-tab-close');
    await page.waitForFunction((p) => window.__marxyHandle.panes().panes[0].path() !== p, EML);
    await page.waitForTimeout(100);
    const stopped = await page.evaluate(() => window.__started);
    await page.waitForTimeout(600);
    assert.equal(await page.evaluate(() => window.__started), stopped, 'nothing is fetched after the tab closed');
    assert.ok(stopped < 60, `${stopped} fetched`);
  });
});

/** A PDF of `n` pages of about `kb` KB each, in a tree ten wide, as a big report's pages are scattered through its file. */
function bigPdf(n, kb) {
  const objs = [];
  const add = (s) => objs.push(s);
  add('');
  add('');
  let level = [];
  const filler = '0 0 m 10 10 l S\n'.repeat(Math.floor((kb * 1024) / 16));
  for (let i = 0; i < n; i++) {
    const c = objs.push(`<< /Length ${filler.length} >>\nstream\n${filler}\nendstream`);
    level.push(objs.push({ c }));
  }
  const kids = new Map();
  while (level.length > 1) {
    const up = [];
    for (let i = 0; i < level.length; i += 10) up.push(objs.push(''));
    up.forEach((u, k) => kids.set(u, level.slice(k * 10, k * 10 + 10)));
    level = up;
  }
  const top = level[0];
  const parent = new Map();
  for (const [u, ks] of kids) for (const k of ks) parent.set(k, u);
  const count = (u) => (kids.has(u) ? kids.get(u).reduce((a, k) => a + count(k), 0) : 1);
  objs[0] = `<< /Type /Catalog /Pages ${top} 0 R >>`;
  objs[1] = '<< >>';
  objs.forEach((o, i) => {
    if (typeof o === 'object') objs[i] = `<< /Type /Page /Parent ${parent.get(i + 1)} 0 R /MediaBox [0 0 612 792] /Contents ${o.c} 0 R >>`;
  });
  for (const [u, ks] of kids) objs[u - 1] = `<< /Type /Pages ${u === top ? '' : `/Parent ${parent.get(u)} 0 R`} /Kids [${ks.map((k) => `${k} 0 R`).join(' ')}] /Count ${count(u)} >>`;
  let out = '%PDF-1.4\n';
  const offs = [];
  objs.forEach((o, i) => {
    offs.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(out, 'latin1'));
}

test('opening a many-page PDF does not read the whole file to learn every page size', async () => {
  const PDF = '/r/big/report.pdf';
  const bytes = bigPdf(1_500, 12);
  await withFrame({ files: { ...FILES, [PDF]: bytes }, open: ['/r/README.md'] }, async (page) => {
    await page.evaluate(() => {
      const shell = window.__marxyHandle.shell;
      const inner = shell.readRange.bind(shell);
      window.__read = 0;
      shell.readRange = async (p, o, l) => {
        const got = await inner(p, o, l);
        if (p.endsWith('report.pdf')) window.__read += got.length;
        return got;
      };
    });
    await open(page, PDF);
    await page.waitForSelector('.marxy-pdf-page');
    // The pages near the first are learned within ten seconds; after that nothing keeps reading the rest in the background.
    await page.waitForTimeout(10_000);
    const early = await page.evaluate(() => window.__read);
    await page.waitForTimeout(5_000);
    const late = await page.evaluate(() => window.__read);
    assert.ok(late - early < 512 * 1024, `${Math.round((late - early) / 1024)} KB more read in 5 s, ${Math.round(late / 1024)} KB of ${Math.round(bytes.length / 1024)} KB in all`);
    assert.ok(late < bytes.length * 0.4);
  });
});
