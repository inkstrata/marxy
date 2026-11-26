// An archive's page (its page as the archive page draws it, whose own
// checks are archive-page.test.mjs): listed, never extracted; folders with their counts and sizes; the cursor's keys and the folds; an entry opened into memory, read-only, in a tab of its own with a
// line saying what it is, in neither the Library's Recent nor on disk; the 16 MB cap; a name that climbs out of the
// archive shown inside it and never written; an image entry drawn from memory; a tar.gz; a 7z left to the desktop app.
// The archives are the demo's (fixtures/demo/archives, constructed samples) and one built here. WebKit.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test as nodeTest } from 'node:test';
import { crc32, deflateRawSync } from 'node:zlib';
import { closeHarness } from './support/two-pane.mjs';
import { cardText, cardsOf, drawerShows, panelKvs, rowOf, showCardPanel, skip, withFrame } from './support/frame.mjs';

const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);
after(() => closeHarness());

const demo = join(fileURLToPath(new URL('../../../', import.meta.url)), 'fixtures', 'demo', 'archives');

/** A zip of `[name, bytes]`, each deflated, with the central directory a reader lists from. */
function zipOf(entries) {
  const locals = [];
  const central = [];
  let at = 0;
  for (const [name, data] of entries) {
    const raw = Buffer.from(data);
    const packed = deflateRawSync(raw);
    const n = Buffer.from(name);
    const crc = crc32(raw);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(8, 8);
    head.writeUInt16LE(0x8000, 10);
    head.writeUInt16LE(0x5b4e, 12);
    head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(packed.length, 18);
    head.writeUInt32LE(raw.length, 22);
    head.writeUInt16LE(n.length, 26);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(8, 10);
    cd.writeUInt16LE(0x8000, 12);
    cd.writeUInt16LE(0x5b4e, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(packed.length, 20);
    cd.writeUInt32LE(raw.length, 24);
    cd.writeUInt16LE(n.length, 28);
    cd.writeUInt32LE(at, 42);
    locals.push(head, n, packed);
    central.push(cd, n);
    at += 30 + n.length + packed.length;
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

const FILES = {
  '/r/README.md': '# Here\n',
  '/r/archives/tidemark-0.5.0.zip': readFileSync(join(demo, 'tidemark-0.5.0.zip')),
  '/r/archives/notes-backup.tar.gz': readFileSync(join(demo, 'notes-backup.tar.gz')),
  '/r/archives/fonts.7z': readFileSync(join(demo, 'fonts.7z')),
  '/r/archives/hostile.zip': zipOf([
    ['../../evil.txt', 'climbed out\n'],
    ['C:\\Windows\\win.ini', '[fonts]\n'],
    ['notes/plain.md', '# Plain\n'],
  ]),
};
const ZIP = '/r/archives/tidemark-0.5.0.zip';

const names = (page) => page.$$eval('.marxy-arow', (rows) => rows.map((r) => `${'  '.repeat(Number(r.getAttribute('aria-level')) - 1)}${r.querySelector('.marxy-arch-name').textContent}`));
const selected = (page) => page.$eval('.marxy-arow[aria-selected="true"] .marxy-arch-name', (e) => e.textContent);
/** A row's name, what it reads as, and its size, as drawn. */
const cells = (page, name) =>
  page.$$eval(
    '.marxy-arow',
    (rows, name) => {
      const r = rows.find((r) => r.querySelector('.marxy-arch-name').textContent === name);
      return r ? [...r.querySelectorAll('.marxy-arch-nm, .marxy-arch-reads, .marxy-arch-sz')].map((c) => c.textContent.trim()) : null;
    },
    name,
  );
const factsOf = async (page, id) => {
  await showCardPanel(page, id);
  return page.evaluate((id) => Object.fromEntries([...document.querySelectorAll(`.marxy-drawer [data-marxy-card="${id}"] .marxy-fact`)].map((e) => [e.children[0].textContent, e.children[1].textContent])), id);
};
const calls = (page, method) => page.evaluate((m) => window.__marxyHandle.shell.calls.filter((c) => c.method === m).map((c) => c.args), method);
const noticeTexts = (page) => page.$$eval('.marxy-notice-text', (els) => els.map((e) => e.textContent));
/** Clicks a row by the mouse, as a reader does, and waits for the cursor on it. */
const pick = async (page, name) => {
  const box = await page.locator(`.marxy-arow:has(.marxy-arch-name:text-is("${name}")) .marxy-arch-sz`).boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForFunction((name) => document.querySelector('.marxy-arow[aria-selected="true"] .marxy-arch-name')?.textContent === name, name);
};

test('a zip opens as its page: the lede, folders with counts and sizes, what each entry reads as, the Archive card, never read whole', async () => {
  await withFrame({ files: FILES, open: [ZIP] }, async (page) => {
    await page.waitForSelector('.marxy-arow');
    assert.equal(await page.getAttribute('[data-marxy-viewer]', 'data-marxy-viewer'), 'archive');
    await page.waitForFunction(() => /careful look/.test(document.querySelector('.marxy-arch-lede')?.textContent ?? ''));
    assert.equal(
      await page.textContent('.marxy-arch-lede'),
      'A ZIP archive: 11 files in 6 folders, all inside tidemark-0.5.0/. 39.1 KB in the file, 20.0 MB unpacked. It reads like a Rust crate: Cargo.toml is at its root. Its comment: “tidemark 0.5.0 source, constructed for reader-lab” 1 entry needs a careful look.',
    );
    assert.deepEqual(await page.$$eval('.marxy-arch-cols span', (s) => s.map((t) => t.textContent)), ['Name', 'Reads as', 'Size']);
    // The one folder that holds everything is said in the lede, not drawn as a row.
    assert.deepEqual((await names(page)).slice(0, 5), ['assets/', '  tidemark-icon.png', 'bench/', '  fixtures/', '    huge.log']);
    assert.deepEqual(await cells(page, 'docs/'), ['docs/', '2 files', '989 bytes']);
    await page.waitForFunction(() => [...document.querySelectorAll('.marxy-arow .marxy-arch-reads')].some((r) => r.textContent === 'Markdown'));
    assert.deepEqual(await cells(page, 'config.md'), ['config.md', 'Markdown', '650 bytes']);
    // The entry past the cap swells, and its head says it does not open.
    assert.match((await cells(page, 'huge.log'))[1], /^swells [\d,]+×$/);
    await pick(page, 'huge.log');
    assert.match(await page.textContent('.marxy-arch-pfacts'), /over the 16\.0 MB an entry opens with/);
    // The panels: Metadata holds Reading, Facts, its comment and what it holds; Outline the Archive card.
    assert.deepEqual((await cardsOf(page)).map((c) => c.title), ['Reading', 'Facts', 'its comment', 'by what each reads as', 'Archive']);
    assert.match(await cardText(page, 'reading'), /Shown as an archive · zip/);
    const archive = await factsOf(page, 'contents');
    assert.equal(archive.format, 'zip');
    assert.equal(archive.unpacked, '20.0 MB · 524 : 1 on 39.1 KB');
    assert.equal(archive.locked, 'none of it');
    assert.equal(archive.extracted, 'never; an entry opens into memory on request');
    assert.deepEqual(await page.$$eval('.marxy-arch-big-name', (els) => els.map((e) => e.textContent)), ['huge.log', 'tidemark.exe', 'index.rs', 'main.rs']);
    // Listed by the shell; the archive itself is never read whole.
    assert.deepEqual(await calls(page, 'listArchive'), [[ZIP]]);
    assert.equal((await calls(page, 'readFile')).filter(([p]) => p === ZIP).length, 0);
    // Source is the bytes: the hex view, starting PK.
    await page.click('.marxy-rs-source');
    await page.waitForFunction(() => document.querySelector('.marxy-hexrow .marxy-hex-b i')?.textContent === '50');
    assert.equal(await page.$('.marxy-arow'), null);
  });
});

test('the cursor walks the entries, l unfolds a folder, o opens an entry into memory in a tab of its own: read-only, said, and not Recent', async () => {
  await withFrame({ files: FILES, open: [ZIP] }, async (page, { mod }) => {
    await page.waitForSelector('.marxy-arow');
    assert.equal(await page.$('.marxy-arow[aria-selected="true"]'), null, 'no cursor until the reader moves');
    await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
    await page.keyboard.press('g');
    await page.keyboard.press('g');
    assert.equal(await selected(page), 'assets/');
    await page.click('.marxy-arow[aria-selected="true"] .marxy-arch-tw');
    assert.equal(await page.getAttribute('.marxy-arow[aria-selected="true"]', 'aria-expanded'), 'false');
    assert.ok(!(await names(page)).includes('  tidemark-icon.png'), 'folded');
    await page.keyboard.press('l');
    assert.ok((await names(page)).includes('  tidemark-icon.png'), 'unfolded');
    // Past the cap, opening is refused and says so; nothing opens.
    await page.dblclick('.marxy-arow:has(.marxy-arch-name:text-is("huge.log"))');
    await page.waitForFunction(() => [...document.querySelectorAll('.marxy-notice-text')].some((e) => /over the 16\.0 MB an entry may open with/.test(e.textContent)));
    assert.deepEqual(await rowOf(page), ['tidemark-0.5.0.zip*']);
    assert.equal((await calls(page, 'readArchiveEntry')).filter(([, , n]) => !n.endsWith('.png')).length, 0);
    // An entry opens in its own tab, read as its name says: Markdown.
    await page.dblclick('.marxy-arow:has(.marxy-arch-name:text-is("config.md"))');
    await page.waitForFunction(() => document.querySelector('.marxy-article h1')?.textContent === 'Configuration');
    assert.deepEqual(await rowOf(page), ['tidemark-0.5.0.zip', 'config.md*']);
    assert.deepEqual((await calls(page, 'readArchiveEntry')).filter(([, , n]) => !n.endsWith('.png')), [[ZIP, 13, 'tidemark-0.5.0/docs/config.md']], 'a picture is unpacked for the plan, and nothing else until asked');
    const entryPath = await page.evaluate(() => window.__marxyHandle.panes().panes[0].path());
    assert.match(entryPath, /^archive-entry:\d+\/tidemark-0\.5\.0\/docs\/config\.md$/);
    await page.waitForFunction(() => [...document.querySelectorAll('.marxy-notice-text')].some((e) => e.textContent.startsWith('An entry of tidemark-0.5.0.zip')));
    assert.ok((await noticeTexts(page)).includes('An entry of tidemark-0.5.0.zip, opened into memory when you asked: tidemark-0.5.0/docs/config.md. It is not on disk, and nothing here can be edited.'));
    // An entry is text: Metadata's The file says where it is.
    assert.equal((await panelKvs(page, 'metadata')).In, 'tidemark-0.5.0.zip › tidemark-0.5.0/docs/config.md');
    // Nothing of it reaches the disk: a save is refused and said, and nothing is written or read under its name.
    await page.keyboard.press(`${mod}+s`);
    await page.waitForFunction(() => [...document.querySelectorAll('.marxy-notice-text')].some((e) => /is an entry of tidemark-0\.5\.0\.zip, opened into memory: it is not on disk, and nothing here can be edited or saved/.test(e.textContent)));
    // Source shows its text, and typing changes nothing.
    await page.click('.marxy-rs-source');
    await page.waitForSelector('.cm-content');
    assert.deepEqual(await page.$$eval('.marxy-source-seg', (els) => els.map((e) => e.textContent)), ['tidemark-0.5.0.zip', 'tidemark-0.5.0', 'docs', 'config.md'], 'its place is the archive');
    const before = await page.textContent('.cm-content');
    await page.click('.cm-content');
    await page.keyboard.type('edited');
    assert.equal(await page.textContent('.cm-content'), before);
    // Not even a Versions copy in the app's own data: what is written at all is the app's frame and history, never these bytes.
    const bytes = new TextEncoder().encode('tidemark reads');
    const holds = (u) => u && Array.from({ length: Math.max(0, u.length - bytes.length + 1) }, (_, i) => i).some((i) => bytes.every((b, j) => u[i + j] === b));
    for (const m of ['writeFileAtomic', 'writeFileNew']) assert.deepEqual((await calls(page, m)).filter(([p, u]) => String(p).startsWith('archive-entry:') || holds(u)).map(([p]) => p), [], m);
    assert.deepEqual((await calls(page, 'watch')).filter(([p]) => String(p).startsWith('archive-entry:')), []);
    assert.deepEqual((await calls(page, 'readFile')).filter(([p]) => String(p).startsWith('archive-entry:') || p.includes('config.md')), []);
    // Closed, it is not listed: Places lists files, and an entry is not one.
    await page.click('.marxy-tabbar .marxy-tab:has(.marxy-tab-name:text-is("config.md")) .marxy-tab-close');
    await page.waitForFunction((zip) => window.__marxyHandle.panes().panes[0].path() === zip, ZIP);
    await page.keyboard.press(`${mod}+Shift+E`);
    await drawerShows(page, 'places');
    await page.waitForSelector('.marxy-drawer .marxy-l-prow');
    assert.deepEqual(await page.$$eval('.marxy-drawer .marxy-l-prow', (els) => els.map((e) => e.dataset.marxyLeftRow).filter((k) => k?.startsWith('f:archive-entry:') || k?.endsWith('config.md'))), []);
  });
});

test('a name that climbs out of the archive is listed inside it, opens from memory, and is never a path on disk', async () => {
  await withFrame({ files: FILES, open: ['/r/archives/hostile.zip'] }, async (page) => {
    await page.waitForSelector('.marxy-arow');
    assert.deepEqual(await names(page), ['notes/', '  plain.md', 'Windows/', '  win.ini', 'evil.txt']);
    assert.equal((await cells(page, 'evil.txt'))[1], 'climbs out');
    assert.equal((await cells(page, 'win.ini'))[1], 'starts at the root');
    await pick(page, 'evil.txt');
    assert.equal(await page.textContent('.marxy-arch-pwarn'), 'The archive names it ../../evil.txt: unpacked as written, it would land outside the folder it is unpacked into.');
    await page.dblclick('.marxy-arow:has(.marxy-arch-name:text-is("evil.txt"))');
    await page.waitForFunction(() => /^archive-entry:\d+\/evil\.txt$/.test(window.__marxyHandle.panes().panes[0].path() ?? ''));
    await page.waitForFunction(() => document.body.innerText.includes('climbed out'));
    // Nothing was written but Marxy's own state (layout.json keeps the row of tabs, a moment after it changes), and no
    // file by that name exists on either side of the archive's folder.
    assert.deepEqual((await calls(page, 'writeFileAtomic')).filter(([p]) => !String(p).startsWith('/data/')), []);
    assert.deepEqual(await calls(page, 'writeFileNew'), []);
    for (const p of ['/evil.txt', '/r/evil.txt', '/r/archives/evil.txt']) assert.equal(await page.evaluate((p) => window.__marxyHandle.shell.stat(p), p), null, p);
  });
});

test('an image entry is drawn from memory through a blob URL, as the image page', async () => {
  await withFrame({ files: FILES, open: [ZIP] }, async (page) => {
    await page.waitForSelector('.marxy-arow');
    await pick(page, 'tidemark-icon.png');
    await page.dblclick('.marxy-arow:has(.marxy-arch-name:text-is("tidemark-icon.png"))');
    await page.waitForFunction(() => document.querySelector('.marxy-imgpic')?.complete && document.querySelector('.marxy-imgpic').naturalWidth > 0);
    assert.match(await page.getAttribute('.marxy-imgpic', 'src'), /^blob:/);
    assert.deepEqual(await rowOf(page), ['tidemark-0.5.0.zip', 'tidemark-icon.png*']);
    assert.equal((await factsOf(page, 'facts')).path, 'tidemark-0.5.0.zip › tidemark-0.5.0/assets/tidemark-icon.png');
  });
});

test('a tar.gz lists the same way through gzip, with one scale and its dot folder shown; a 7z is left to the desktop app', async () => {
  await withFrame({ files: FILES, open: ['/r/archives/notes-backup.tar.gz'] }, async (page) => {
    await page.waitForSelector('.marxy-arow');
    assert.equal(await page.textContent('.marxy-arch-lede'), 'A tar archive, gzipped: 5 files in 2 folders, all inside notes/. 811 bytes in the file, 969 bytes unpacked.');
    // The line's only words are the entries': list | sheet.
    assert.deepEqual(await page.$$eval('.marxy-arch-opt', (b) => b.map((x) => x.textContent)), ['a list', 'a sheet'], 'a tar keeps no packed size an entry, so the plan has one scale');
    assert.deepEqual(await names(page), ['.obsidian/', '  workspace.json', 'drafts/', '  tide-table.txt', '2026-10-12.md', '2026-10-13.md', '2026-10-14.md']);
    await pick(page, 'workspace.json');
    await page.dblclick('.marxy-arow:has(.marxy-arch-name:text-is("workspace.json"))');
    await page.waitForFunction(() => /workspace\.json$/.test(window.__marxyHandle.panes().panes[0].path() ?? ''));
    assert.deepEqual(await rowOf(page), ['notes-backup.tar.gz', 'workspace.json*']);
    await page.evaluate(() => window.__marxyHandle.open('/r/archives/fonts.7z'));
    await page.waitForSelector('.marxy-fcard');
    assert.equal(await page.textContent('.marxy-fcard-kicker'), 'An archive the app cannot list');
    assert.match(await page.innerText('.marxy-fcard'), /This build does not read 7z: the desktop app does\./);
  });
});
