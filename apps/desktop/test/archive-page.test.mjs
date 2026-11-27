// The archive page: the lede, the plan to scale with pictures as
// themselves, the entries with what each reads as and every warning, names drawn as written wherever they appear, z folding
// a folder, a list of 20,000 entries windowed, an empty archive, Metadata's two sections, and the preview's head following
// the cursor. Over the two samples (fixtures/demo/archives, built by make-archives.mjs) and archives built here.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test as nodeTest } from 'node:test';
import { closeHarness } from './support/two-pane.mjs';
import { showPanel, withFrame } from './support/frame.mjs';
import { frames, holdBudget, skip } from './support/kit.mjs';

// The longest the main thread may be held while 20,000 entries open and scroll: 0.1 to 1 s on the machines measured, many
// seconds were it to draw every row.
const BLOCK_MS = 4_000;

const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);
after(() => closeHarness());

const demo = join(fileURLToPath(new URL('../../../', import.meta.url)), 'fixtures', 'demo', 'archives');
const SURVEY = '/r/archives/harbour-survey-2026.zip';
const DROP = '/r/archives/vendor-drop.zip';
const surveyBytes = readFileSync(join(demo, 'harbour-survey-2026.zip'));
const FILES = {
  '/r/README.md': '# Here\n',
  [SURVEY]: surveyBytes,
  [DROP]: readFileSync(join(demo, 'vendor-drop.zip')),
};

/** As the page says a size (core's shortSize). */
const shortSize = (bytes) => {
  if (bytes < 1024) return `${bytes.toLocaleString('en-GB')} ${bytes === 1 ? 'byte' : 'bytes'}`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = bytes / 1024;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v.toFixed(1)} ${units[u]}`;
};

/** A zip of `[name, bytes]` entries, stored, with the directory a reader lists from. */
function storedZip(entries) {
  const locals = [];
  const central = [];
  let at = 0;
  for (const [name, data] of entries) {
    const raw = Buffer.from(data);
    const n = Buffer.from(name);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt32LE(raw.length, 18);
    head.writeUInt32LE(raw.length, 22);
    head.writeUInt16LE(n.length, 26);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
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

const blur = (page) => page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
const keys = async (page, ...list) => {
  for (const k of list) await page.keyboard.press(k);
};
const where = (page) => page.evaluate(() => document.querySelector('.marxy-verb-bar:not([hidden]) .marxy-verb-bar-where')?.textContent ?? null);
const waitWhere = (page, text) => page.waitForFunction((t) => document.querySelector('.marxy-verb-bar:not([hidden]) .marxy-verb-bar-where')?.textContent === t, text);
const rowSel = (name) => `.marxy-arow:has(.marxy-arch-name:text-is("${name}"))`;
/** The reads-as words of every row drawn, by name (a name with a character shown, as it is spoken); a name drawn twice keeps both. */
const readsAs = (page) =>
  page.$$eval('.marxy-arow', (rows) =>
    rows.map((r) => [r.querySelector('.marxy-arch-name [role="img"]')?.getAttribute('aria-label') ?? r.querySelector('.marxy-arch-name').textContent, r.querySelector('.marxy-arch-reads').textContent, r.querySelector('.marxy-arch-reads').classList.contains('marxy-arch-warn')]),
  );
/** Clicks the middle of `sel` with the mouse, as a reader does: nothing is scrolled first. */
const clickAt = async (page, sel) => {
  const box = await page.locator(sel).first().boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
};
/** The plan's cells as drawn: their box, their tooltip, their kind. */
const cellsOf = (page) =>
  page.$$eval('.marxy-arch-cell', (cells) =>
    cells.map((c) => ({
      x: parseFloat(c.style.left), y: parseFloat(c.style.top), w: parseFloat(c.style.width), h: parseFloat(c.style.height),
      title: c.title,
      frame: c.classList.contains('marxy-arch-cell-frame'),
      file: !c.matches('.marxy-arch-cell-frame, .marxy-arch-cell-folder, .marxy-arch-cell-more'),
      on: c.classList.contains('marxy-arch-cell-on'),
    })),
  );
/** Waits until every row drawn reads from its bytes: none still reads by its name alone. */
const readingsIn = (page, n) => page.waitForFunction((n) => window.__marxyHandle.shell.calls.filter((c) => c.method === 'readArchiveHeads').length >= n, n);

test('1. the lede names the form, the counts, the one folder that holds everything, both sizes and the comment', async () => {
  await withFrame({ files: FILES, open: [SURVEY] }, async (page) => {
    await page.waitForSelector('.marxy-arch-lede .marxy-arch-warn');
    const lede = await page.textContent('.marxy-arch-lede');
    assert.match(lede, /^A ZIP archive: 25 files in 9 folders, all inside harbour-survey-2026\/\. (.+) in the file, (.+) unpacked\. Its comment: “Harbour survey, 12 to 14 October 2026\. Packed on the quay laptop\.” 1 entry is encrypted\.$/);
    assert.equal(lede.match(/\. (\S+ \S+) in the file/)[1], shortSize(surveyBytes.length));
    const listing = await page.evaluate((p) => window.__marxyHandle.shell.listArchive(p), SURVEY);
    const unpacked = listing.entries.filter((e) => e.kind === 'file').reduce((s, e) => s + e.size, 0);
    assert.equal(lede.match(/, (\S+ \S+) unpacked/)[1], shortSize(unpacked));
    assert.equal(await page.textContent('.marxy-arch-lede .marxy-arch-wrap'), 'harbour-survey-2026/');
    assert.equal(await page.textContent('.marxy-arch-lede .marxy-arch-warn'), '1 entry is encrypted.');
    // The one folder is said once, in the lede: it is not drawn as a row.
    assert.equal(await page.$(rowSel('harbour-survey-2026/')), null);
  });
});

test('2. the plan fills its box, the largest file has the largest cell, and "in the file" redraws from packed sizes', async () => {
  await withFrame({ files: FILES, open: [SURVEY] }, async (page) => {
    await page.waitForSelector('.marxy-arch-cell');
    const box = await page.$eval('.marxy-arch-plan', (p) => ({ w: p.clientWidth, h: p.clientHeight }));
    const cells = await cellsOf(page);
    const frames = cells.filter((c) => c.frame);
    const inside = (c, f) => c !== f && c.x >= f.x && c.y >= f.y && c.x + c.w <= f.x + f.w + 1e-3 && c.y + c.h <= f.y + f.h + 1e-3;
    const top = cells.filter((c) => !frames.some((f) => inside(c, f)));
    const area = (c) => c.w * c.h;
    assert.ok(Math.abs(top.reduce((s, c) => s + area(c), 0) - box.w * box.h) < 1, 'the top level fills the plan within a pixel');
    for (const f of frames) {
      const kids = cells.filter((c) => inside(c, f) && !frames.some((g) => g !== f && inside(g, f) && inside(c, g)));
      assert.ok(Math.abs(kids.reduce((s, c) => s + area(c), 0) - (f.w - 2) * (f.h - 17)) < 1, `${f.title} is filled within a pixel`);
    }
    const largest = cells.filter((c) => c.file).reduce((a, b) => (area(b) > area(a) ? b : a));
    assert.match(largest.title, /^data\/gauges\.sqlite, /);
    assert.match(await page.textContent('.marxy-arch-cap'), /^To scale by what each thing unpacks to\. The largest is data\/gauges\.sqlite, \d+% of it\.$/);
    // In the file: the data folder is drawn by what its files take packed.
    const listing = await page.evaluate((p) => window.__marxyHandle.shell.listArchive(p), SURVEY);
    const inData = (k) => listing.entries.filter((e) => e.kind === 'file' && e.path.startsWith('harbour-survey-2026/data/')).reduce((s, e) => s + e[k], 0);
    assert.ok(cells.some((c) => c.title === `data/, ${shortSize(inData('size'))}`));
    await page.click('.marxy-arch-opt:text-is("in the file")');
    await page.waitForFunction(() => /takes in the file/.test(document.querySelector('.marxy-arch-cap')?.textContent ?? ''));
    assert.equal(await page.getAttribute('.marxy-arch-opt:text-is("in the file")', 'aria-pressed'), 'true');
    const packed = await cellsOf(page);
    assert.ok(packed.some((c) => c.title === `data/, ${shortSize(inData('packed'))}`), 'the data frame by its packed size');
    assert.notDeepEqual(packed.map((c) => [c.x, c.w]), cells.map((c) => [c.x, c.w]));
  });
});

test('3. a picture\'s cell shows the picture, drawn small from memory', async () => {
  await withFrame({ files: FILES, open: [SURVEY] }, async (page) => {
    await page.waitForFunction(() => document.querySelectorAll('.marxy-arch-cell-pic canvas').length >= 4, null, { timeout: 30_000 });
    const drawn = await page.$$eval('.marxy-arch-cell-pic', (cells) =>
      cells.map((c) => {
        const canvas = c.querySelector('canvas');
        const px = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        let ink = 0;
        for (let i = 3; i < px.length; i += 4) if (px[i] > 0) ink++;
        return { title: c.title, w: canvas.width, ink };
      }),
    );
    assert.ok(drawn.some((d) => /^pictures\/boat-ribs\.jpg, /.test(d.title)), drawn.map((d) => d.title).join(' | '));
    for (const d of drawn) assert.ok(d.w > 0 && d.ink > 0, `${d.title} has its picture`);
    // Unpacked into memory by the shell, never by a URL that outlives it.
    const reads = await page.evaluate(() => window.__marxyHandle.shell.calls.filter((c) => c.method === 'readArchiveEntry').length);
    assert.ok(reads >= drawn.length);
  });
});

test('4. the cursor\'s cell is lit, and a click on a cell moves the cursor there', async () => {
  await withFrame({ files: FILES, open: [SURVEY] }, async (page) => {
    await page.waitForSelector('.marxy-arch-cell');
    await blur(page);
    await keys(page, 'g', 'g', 'j');
    await waitWhere(page, 'harbour-survey-2026.zip!/harbour-survey-2026/data/');
    let lit = (await cellsOf(page)).filter((c) => c.on);
    assert.equal(lit.length, 1);
    assert.match(lit[0].title, /^data\/, /);
    const cell = '.marxy-arch-cell[title^="recordings/bell-buoy.wav, "]';
    await clickAt(page, cell);
    await waitWhere(page, 'harbour-survey-2026.zip!/harbour-survey-2026/recordings/bell-buoy.wav');
    lit = (await cellsOf(page)).filter((c) => c.on);
    assert.equal(lit.length, 1);
    assert.match(lit[0].title, /^recordings\/bell-buoy\.wav, /);
    assert.equal(await page.textContent('.marxy-arow.marxy-cursor .marxy-arch-name'), 'bell-buoy.wav');
  });
});

test('5. each entry says what it reads as, from its bytes; a program named .jpg says so', async () => {
  await withFrame({ files: FILES, open: [SURVEY] }, async (page) => {
    await page.waitForSelector('.marxy-arow');
    await readingsIn(page, 1);
    await page.waitForFunction(() => [...document.querySelectorAll('.marxy-arow .marxy-arch-reads')].some((r) => r.textContent === 'a Windows program'));
    const said = Object.fromEntries((await readsAs(page)).map(([n, r]) => [n, r]));
    for (const [name, reads] of Object.entries({
      'README.md': 'Markdown', 'boat-ribs.jpg': 'an image', 'sketch.svg': 'an SVG drawing', 'gauges.sqlite': 'a database', 'tide-log-2026.xlsx': 'a workbook',
      'p95-latency.csv': 'a table', 'release.json': 'a tree', 'bell-buoy.wav': 'a recording', 'the-case-for-ragged-lines.pdf': 'a PDF', 'low-water-notice.eml': 'a mail message',
      'tide-heights.ipynb': 'a notebook', 'indexer.rs': 'Rust', 'publish.sh': 'a shell script', 'build-2026-10-14.log': 'a log', 'TidemarkSans-Regular.ttf': 'a font',
      'notes-backup.tar.gz': 'an archive', 'tidemark.exe': 'a Windows program', 'crew-list.xlsx': 'encrypted', 'backups/': '1 file', 'pictures/': '6 files',
    })) assert.equal(said[name], reads, name);
  });
  await withFrame({ files: FILES, open: [DROP] }, async (page) => {
    await page.waitForFunction(() => [...document.querySelectorAll('.marxy-arow .marxy-arch-reads')].some((r) => r.textContent.includes('not a .jpg')));
    const receipt = (await readsAs(page)).find(([n]) => n === 'receipt.jpg');
    assert.deepEqual(receipt, ['receipt.jpg', 'a Windows program, not a .jpg', true]);
  });
});

test('6. every warning appears on its entry, in a word or two in the list and in a sentence in the preview\'s head', async () => {
  await withFrame({ files: FILES, open: [DROP] }, async (page) => {
    await page.waitForFunction(() => [...document.querySelectorAll('.marxy-arow .marxy-arch-reads')].some((r) => r.textContent.includes('not a .jpg')));
    const rows = await readsAs(page);
    const of = (name) => rows.filter(([n]) => n === name).map(([, r, warn]) => [r, warn]);
    const fill = await page.evaluate((p) => window.__marxyHandle.shell.listArchive(p).then((l) => l.entries.find((e) => e.path === 'cache/fill.bin')), DROP);
    const table = [
      ['tide.cmd', 'climbs out', 'The archive names it ../../Start Menu/Programs/Startup/tide.cmd: unpacked as written, it would land outside the folder it is unpacked into.'],
      ['tide', 'starts at the root', 'The archive names it /etc/cron.d/tide: unpacked as written, it would land at the root of a disk.'],
      ['invoice U+202E fdp.exe', 'misleading name', 'Its name holds a character that hides or reorders the rest; it is drawn here as written, with that character shown.'],
      ['receipt.jpg', 'a Windows program, not a .jpg', 'Its name says .jpg; its bytes are a Windows program.'],
      ['licence.txt', 'named twice', 'Another entry has this path: which one is kept depends on the tool that unpacks it.'],
      ['fill.bin', `swells ${Math.round(fill.size / fill.packed).toLocaleString('en-GB')}×`, `It unpacks to ${Math.round(fill.size / fill.packed).toLocaleString('en-GB')} times its packed size: ${fill.size.toLocaleString('en-GB')} bytes from ${fill.packed.toLocaleString('en-GB')}.`],
      ['licence.key', 'encrypted', 'Its contents are encrypted: its name, sizes and date are written in the clear, and the rest is not read here.'],
    ];
    for (const [name, words, sentence] of table) {
      assert.deepEqual(of(name)[0], [words, true], name);
      await clickAt(page, name.includes('U+202E') ? '.marxy-arow:has(.marxy-arch-name [role="img"])' : rowSel(name));
      await page.waitForFunction((s) => [...document.querySelectorAll('.marxy-arch-pwarn')].some((w) => w.textContent === s), sentence);
    }
    assert.deepEqual(of('licence.txt').map(([r]) => r), ['named twice', 'named twice'], 'both copies are listed');
    assert.deepEqual(of('plugin.dll'), [['a Windows program', false]]);
    assert.equal(await page.textContent('.marxy-arch-lede .marxy-arch-warn'), '1 entry is encrypted. 7 entries need a careful look.');
  });
});

test('7. a name holding U+202E is drawn with it shown in the row, the verb bar, the tab and the crumb', async () => {
  await withFrame({ files: FILES, open: [DROP] }, async (page) => {
    await page.waitForSelector('.marxy-arow');
    const marked = (sel) => page.$eval(sel, (e) => e.querySelector('[role="img"]')?.getAttribute('aria-label') ?? null);
    const row = '.marxy-arow:has(.marxy-arch-name [role="img"])';
    assert.equal(await marked(`${row} .marxy-arch-name`), 'invoice U+202E fdp.exe');
    await clickAt(page, row);
    await page.waitForFunction(() => document.querySelector('.marxy-verb-bar:not([hidden]) .marxy-verb-bar-where [role="img"]'));
    assert.equal(await marked('.marxy-verb-bar-where'), 'vendor-drop.zip!/docs/invoice U+202E fdp.exe');
    assert.equal(await marked('.marxy-verb-bar-what'), 'entry invoice U+202E fdp.exe');
    assert.equal(await marked('.marxy-arch-pname'), 'invoice U+202E fdp.exe');
    await keys(page, 'o');
    await page.waitForFunction(() => /fdp\.exe$/.test(window.__marxyHandle.panes().panes[0].path() ?? ''));
    await page.waitForFunction(() => document.querySelector('.marxy-tab[aria-selected="true"] .marxy-tab-name [role="img"]'));
    assert.equal(await marked('.marxy-tab[aria-selected="true"] .marxy-tab-name'), 'invoice U+202E fdp.exe');
    await page.waitForFunction(() => document.querySelector('.marxy-crumb[data-marxy-crumb="file"] [role="img"]'));
    assert.equal(await marked('.marxy-crumb[data-marxy-crumb="file"]'), 'invoice U+202E fdp.exe');
  });
});

test('8. z folds a folder and unfolds it, and the cursor stays on it', async () => {
  await withFrame({ files: FILES, open: [SURVEY] }, async (page) => {
    await page.waitForSelector(rowSel('pictures/'));
    await clickAt(page, `${rowSel('pictures/')} .marxy-arch-sz`);
    await waitWhere(page, 'harbour-survey-2026.zip!/harbour-survey-2026/pictures/');
    assert.ok(await page.$(rowSel('boat-ribs.jpg')));
    await keys(page, 'z');
    await page.waitForFunction(() => document.querySelector('.marxy-arow[aria-expanded="false"] .marxy-arch-name')?.textContent === 'pictures/');
    assert.equal(await page.$(rowSel('boat-ribs.jpg')), null, 'folded');
    assert.equal(await where(page), 'harbour-survey-2026.zip!/harbour-survey-2026/pictures/');
    await keys(page, 'z');
    await page.waitForSelector(rowSel('boat-ribs.jpg'));
    // From an entry inside it, z folds the folder that holds it and the cursor goes to the folder.
    await keys(page, 'l');
    await waitWhere(page, 'harbour-survey-2026.zip!/harbour-survey-2026/pictures/boat-ribs.jpg');
    await keys(page, 'z');
    await waitWhere(page, 'harbour-survey-2026.zip!/harbour-survey-2026/pictures/');
    assert.equal(await page.$(rowSel('boat-ribs.jpg')), null);
  });
});

test('9. 20,000 entries open and scroll with no long block of the main thread', async () => {
  const many = [];
  for (let i = 0; i < 20_000; i++) many.push([`big/part-${String(i).padStart(5, '0')}.txt`, `line ${i}\n`]);
  const BIG = '/r/archives/many.zip';
  await withFrame({ files: { ...FILES, [BIG]: storedZip(many) }, open: ['/r/README.md'] }, async (page) => {
    await page.evaluate(() => {
      window.__gaps = { max: 0, last: performance.now(), on: true };
      const tick = () => {
        const now = performance.now();
        window.__gaps.max = Math.max(window.__gaps.max, now - window.__gaps.last);
        window.__gaps.last = now;
        if (window.__gaps.on) setTimeout(tick, 10);
      };
      setTimeout(tick, 10);
    });
    await page.evaluate((p) => window.__marxyHandle.open(p), BIG);
    await page.waitForSelector('.marxy-arow');
    assert.match(await page.textContent('.marxy-arch-lede'), /^A ZIP archive: 20,000 files, all inside big\/\./);
    const drawn = await page.$$eval('.marxy-arow', (r) => r.length);
    assert.ok(drawn < 200, `${drawn} rows in the page, not 20,000`);
    for (let i = 1; i <= 20; i++) {
      await page.evaluate((f) => {
        const list = document.querySelector('.marxy-atree');
        list.scrollTop = (list.scrollHeight - list.clientHeight) * f;
      }, i / 20);
      await frames(page, 3);
    }
    await page.waitForFunction(() => document.querySelector('.marxy-arow:last-child .marxy-arch-name')?.textContent === 'part-19999.txt');
    const max = await page.evaluate(() => {
      window.__gaps.on = false;
      return window.__gaps.max;
    });
    holdBudget(assert, '20,000 archive entries: longest block', max, BLOCK_MS);
    // Readings are asked for as rows show, never for all 20,000 at once.
    const asked = await page.evaluate(() => window.__marxyHandle.shell.calls.filter((c) => c.method === 'readArchiveHeads').reduce((s, c) => s + c.args[1].length, 0));
    assert.ok(asked > 0 && asked < 2_000, `${asked} heads asked for`);
  });
});

test('10. an empty archive says so and draws no plan', async () => {
  await withFrame({ files: { ...FILES, '/r/archives/empty.zip': storedZip([]) }, open: ['/r/archives/empty.zip'] }, async (page) => {
    await page.waitForSelector('.marxy-arch-lede');
    assert.equal(await page.textContent('.marxy-arch-lede'), 'A ZIP archive with nothing in it: it holds no entries. 22 bytes in the file.');
    assert.equal(await page.$('.marxy-arch-plan'), null);
    assert.equal(await page.$('.marxy-arow'), null);
  });
});

test('11. Metadata: "Written in it" carries the comment, "It holds" the files, folders, readings and what needs care', async () => {
  await withFrame({ files: FILES, open: [SURVEY] }, async (page) => {
    await page.waitForSelector('.marxy-arow');
    await page.waitForFunction(() => [...document.querySelectorAll('.marxy-arow .marxy-arch-reads')].some((r) => r.textContent === 'a Windows program'));
    await showPanel(page, 'metadata');
    const facts = (id) =>
      page.evaluate((id) => Object.fromEntries([...document.querySelectorAll(`.marxy-drawer [data-marxy-card="${id}"] .marxy-fact`)].map((e) => [e.children[0].textContent, e.children[1].textContent])), id);
    await page.waitForFunction(() => document.querySelector('.marxy-drawer [data-marxy-card="notes"] .marxy-fact'));
    const secs = await page.evaluate(() => [...document.querySelectorAll('.marxy-drawer .marxy-l-body .marxy-l-sec')].map((s) => [s.querySelector('span').textContent, s.querySelector('em')?.textContent ?? '']));
    assert.ok(secs.some(([t, n]) => /written in it/i.test(t) && n === 'its comment'), JSON.stringify(secs));
    assert.ok(secs.some(([t]) => /it holds/i.test(t)), JSON.stringify(secs));
    assert.deepEqual(await facts('frontmatter'), { Comment: 'Harbour survey, 12 to 14 October 2026. Packed on the quay laptop.' });
    await page.waitForFunction(() => /Pictures/.test(document.querySelector('.marxy-drawer [data-marxy-card="notes"]')?.textContent ?? ''));
    const holds = await facts('notes');
    assert.equal(holds.Files, '25');
    assert.equal(holds.Folders, '9');
    assert.equal(holds.Pictures, '6');
    assert.equal(holds.Data, '5');
    assert.equal(holds.Encrypted, '1');
    assert.equal(holds['No reading'], '1');
    assert.equal(holds['Need a careful look'], undefined, 'nothing but the encrypted entry, which is counted as such');
  });
});

test('12. the preview\'s head follows the cursor; with no cursor it is the README\'s', async () => {
  await withFrame({ files: FILES, open: [SURVEY] }, async (page) => {
    await page.waitForSelector('.marxy-arch-phead .marxy-arch-pname');
    assert.equal(await page.textContent('.marxy-arch-pname'), 'README.md');
    assert.match(await page.textContent('.marxy-arch-pfacts'), /^Markdown · [\d,]+ bytes · packed to [\d,]+ \(\d+%\) · 14 Oct 2026, 18:02 · checksum agrees$/);
    await blur(page);
    await keys(page, 'g', 'g');
    await page.waitForFunction(() => document.querySelector('.marxy-arch-pname')?.textContent === 'backups/');
    assert.match(await page.textContent('.marxy-arch-pfacts'), /^A folder · 1 file, 811 bytes unpacked · 14 Oct 2026, 16:00$/);
    await keys(page, 'l');
    await page.waitForFunction(() => document.querySelector('.marxy-arch-pname')?.textContent === 'notes-backup.tar.gz');
    assert.equal(await page.textContent('.marxy-arch-pdir'), 'backups/');
    assert.match(await page.textContent('.marxy-arch-pfacts'), /^An archive · 811 bytes · stored as it is · 14 Oct 2026, 18:00$/);
    await keys(page, 'Escape');
    await page.waitForFunction(() => document.querySelector('.marxy-arch-pname')?.textContent === 'README.md');
  });
});
