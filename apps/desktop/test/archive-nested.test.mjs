// An archive inside an archive: listed from the bytes held in memory by core's reader, three
// levels at most, the archive on disk the first. The survey's tar.gz previews as its own small plan and list and opens as a
// full page with `o`; its entries preview and open; an inner entry's address joins every level; a fourth level and an inner
// archive over 16 MB are the card with the sentence why; nothing is written, and no shell call names a held entry.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateRawSync } from 'node:zlib';
import { after, test as nodeTest } from 'node:test';
import { closeHarness } from './support/two-pane.mjs';
import { skip, withFrame } from './support/frame.mjs';

const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);
after(() => closeHarness());

const demo = join(fileURLToPath(new URL('../../../', import.meta.url)), 'fixtures', 'demo', 'archives');
const SURVEY = '/r/archives/harbour-survey-2026.zip';
const R = 'harbour-survey-2026/';
const BACKUP = `${R}backups/notes-backup.tar.gz`;
const FILES = { '/r/README.md': '# Here\n', [SURVEY]: readFileSync(join(demo, 'harbour-survey-2026.zip')) };

/** A zip of `[name, bytes]` entries, deflated or stored, with the directory a reader lists from and each entry's checksum. */
function zip(entries, store = false) {
  const locals = [];
  const central = [];
  let at = 0;
  for (const [name, data] of entries) {
    const raw = Buffer.from(data);
    const packed = store ? raw : deflateRawSync(raw);
    const n = Buffer.from(name);
    const crc = crc32(raw);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(store ? 0 : 8, 8);
    head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(packed.length, 18);
    head.writeUInt32LE(raw.length, 22);
    head.writeUInt16LE(n.length, 26);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(store ? 0 : 8, 10);
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

const blur = (page) => page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
const where = (page) => page.evaluate(() => document.querySelector('.marxy-verb-bar:not([hidden]) .marxy-verb-bar-where')?.textContent ?? null);
const waitWhere = (page, text) => page.waitForFunction((t) => document.querySelector('.marxy-verb-bar:not([hidden]) .marxy-verb-bar-where')?.textContent === t, text);
const panePath = (page) => page.evaluate(() => window.__marxyHandle.panes().panes[0].path());
const waitPane = (page, re) => page.waitForFunction((s) => new RegExp(s).test(window.__marxyHandle.panes().panes[0].path() ?? ''), re.source);
/** The cursor put on the entry `id` (its path in the archive), as the Line's `@` does; the pane is focused first. */
const goTo = async (page, id) => {
  await page.waitForSelector('[data-marxy-pane="0"] .marxy-archpage:not(.marxy-archpage-compact) .marxy-arow');
  await blur(page);
  await page.evaluate(async (id) => {
    const { partsGoTo } = await import('/src/parts/cursor.ts');
    if (!partsGoTo(id)) throw new Error(`no part ${id}`);
  }, id);
};
/** The pane's own page, not one drawn in its preview. */
const PAGE = '[data-marxy-pane="0"] .marxy-archpage:not(.marxy-archpage-compact)';
const body = `${PAGE} .marxy-arch-pbody`;
const nested = `${body} .marxy-archpage-compact`;
const rowNames = (page, sel) => page.$$eval(`${sel} .marxy-arow .marxy-arch-name`, (els) => els.map((e) => e.textContent));
const cardWhy = (page, sel) => page.$eval(`${sel} .marxy-fcard-why`, (e) => e.textContent);
/**
 * No write outside the app's own `/data/`, every archive call names the archive on disk (a held archive is listed and
 * read in the page), and no shell call at all names a held entry or its folder: not `readDir`, not `realPath`.
 */
async function nothingWrittenNoEntryAsked(page, disk) {
  const got = await page.evaluate(() =>
    window.__marxyHandle.shell.calls.map((c) => ({ method: c.method, path: String(c.args[0]) })),
  );
  assert.deepEqual(got.filter((c) => /^write|^rename|^remove|^delete|^create/.test(c.method) && !c.path.startsWith('/data/')), [], 'nothing written');
  const archive = got.filter((c) => /^(listArchive|readArchiveEntry|readArchiveHeads)$/.test(c.method));
  assert.ok(archive.length > 0);
  assert.deepEqual([...new Set(archive.map((c) => c.path))], [disk], 'the shell is asked only of the archive on disk');
  assert.deepEqual(got.filter((c) => c.path.startsWith('archive-entry:')), [], 'no shell call names a held entry');
}

test('1. the survey\'s tar.gz lists in the preview, its plan and rows, and o opens it as a full archive page', async () => {
  await withFrame({ files: FILES, open: [SURVEY] }, async (page) => {
    await goTo(page, BACKUP);
    await page.waitForSelector(`${nested} .marxy-arow`, { timeout: 30_000 });
    assert.match(await page.textContent(`${nested} .marxy-arch-lede`), /^A tar archive, gzipped: 5 files in 2 folders, all inside notes\/\./);
    assert.ok((await page.$$(`${nested} .marxy-arch-plan .marxy-arch-cell`)).length > 0, 'its plan');
    assert.deepEqual(await rowNames(page, nested), ['.obsidian/', 'workspace.json', 'drafts/', 'tide-table.txt', '2026-10-12.md', '2026-10-13.md', '2026-10-14.md']);
    assert.equal(await page.$(`${nested} .marxy-arch-preview`), null, 'no preview inside the preview');
    await page.keyboard.press('o');
    await waitPane(page, /^archive-entry:\d+\/.*notes-backup\.tar\.gz$/);
    // With no cursor and no README, its first file: the workspace's JSON, read as a tree.
    await page.waitForSelector(`${body} [data-marxy-reading="tree"]`, { timeout: 30_000 });
    assert.match(await page.textContent(`${PAGE} .marxy-arch-lede`), /^A tar archive, gzipped/);
    assert.deepEqual(await rowNames(page, PAGE), ['.obsidian/', 'workspace.json', 'drafts/', 'tide-table.txt', '2026-10-12.md', '2026-10-13.md', '2026-10-14.md']);
    await nothingWrittenNoEntryAsked(page, SURVEY);
  });
});

test('2 and 3. its entries preview and open as themselves, read-only, held in memory; the address joins both levels', async () => {
  await withFrame({ files: FILES, open: [SURVEY] }, async (page) => {
    // In the outer page's preview: l goes into the nested list, and the address grows by both levels.
    await goTo(page, BACKUP);
    await page.waitForSelector(`${nested} .marxy-arow`, { timeout: 30_000 });
    await page.keyboard.press('l');
    await waitWhere(page, `harbour-survey-2026.zip!/${BACKUP}!/notes/.obsidian/`);
    await page.keyboard.press('h');
    await waitWhere(page, `harbour-survey-2026.zip!/${BACKUP}`);
    await page.keyboard.press('o');
    await waitPane(page, /notes-backup\.tar\.gz$/);
    // In its own tab: the note previews as Markdown, and the address names every level.
    await goTo(page, 'notes/2026-10-12.md');
    await waitWhere(page, `harbour-survey-2026.zip!/${BACKUP}!/notes/2026-10-12.md`);
    await page.waitForSelector(`${body} article.marxy-article h1`, { timeout: 30_000 });
    assert.equal(await page.textContent(`${body} h1`), '12 October');
    await page.keyboard.press('o');
    await waitPane(page, /^archive-entry:\d+\/notes\/2026-10-12\.md$/);
    await page.waitForSelector('[data-marxy-pane="0"] article h1');
    assert.equal(await page.textContent('[data-marxy-pane="0"] article h1'), '12 October');
    await page.waitForFunction(() =>
      [...document.querySelectorAll('.marxy-notice-text')].some((e) => e.textContent === 'An entry of notes-backup.tar.gz, opened into memory when you asked: notes/2026-10-12.md. It is not on disk, and nothing here can be edited.'),
    );
    const held = await page.evaluate(async (p) => {
      const { heldEntry } = await import('/src/document/entries.ts');
      const e = heldEntry(p);
      return { depth: e.depth, of: e.of, parent: /^archive-entry:\d+\/.*notes-backup\.tar\.gz$/.test(e.archive) };
    }, await panePath(page));
    assert.deepEqual(held, { depth: 2, of: 'archive', parent: true });
    await nothingWrittenNoEntryAsked(page, SURVEY);
  });
});

test('4. a third level is listed and a fourth is refused with a sentence, as the card', async () => {
  const L4 = zip([['deep.md', '# Four down\n']]);
  const L3 = zip([['l4.zip', L4], ['third.md', '# Three down\n']]);
  const sqlite = Buffer.concat([Buffer.from('SQLite format 3\0'), Buffer.alloc(496)]);
  const L2 = zip([['l3.zip', L3], ['tide.sqlite', sqlite]]);
  const L1 = '/r/archives/l1.zip';
  await withFrame({ files: { ...FILES, [L1]: zip([['l2.zip', L2], ['first.md', '# One\n']]) }, open: [L1] }, async (page) => {
    // Level 2, in l1's preview, then its own tab.
    await goTo(page, 'l2.zip');
    await page.waitForSelector(`${nested} .marxy-arow`, { timeout: 30_000 });
    assert.deepEqual(await rowNames(page, nested), ['l3.zip', 'tide.sqlite']);
    await page.keyboard.press('o');
    await waitPane(page, /\/l2\.zip$/);
    // A database two levels down: the shell's readers have no archive on disk to read it from, and the card says so.
    await goTo(page, 'tide.sqlite');
    await page.waitForSelector(`${body} .marxy-fcard`, { timeout: 30_000 });
    assert.match(await cardWhy(page, body), /tide\.sqlite is inside l2\.zip, itself inside an archive: a database, workbook, font or recording is read only from an archive on disk/);
    // Level 3, in l2's preview: listed.
    await goTo(page, 'l3.zip');
    await page.waitForSelector(`${nested} .marxy-arow`, { timeout: 30_000 });
    assert.deepEqual(await rowNames(page, nested), ['l4.zip', 'third.md']);
    await page.keyboard.press('o');
    await waitPane(page, /\/l3\.zip$/);
    await goTo(page, 'third.md');
    await waitWhere(page, 'l1.zip!/l2.zip!/l3.zip!/third.md');
    // Level 4, in l3's preview: the card, and the sentence.
    await goTo(page, 'l4.zip');
    const said = 'An archive three levels down is not listed, so a nested bomb is never walked.';
    await page.waitForSelector(`${body} .marxy-fcard`, { timeout: 30_000 });
    assert.equal(await page.$(nested), null, 'not listed');
    assert.match(await cardWhy(page, body), new RegExp(said.replace(/\./g, '\\.')));
    await page.keyboard.press('o');
    await waitPane(page, /\/l4\.zip$/);
    await page.waitForSelector('[data-marxy-pane="0"] .marxy-fcard');
    assert.equal(await page.textContent('[data-marxy-pane="0"] .marxy-fcard-kicker'), 'An archive inside an archive');
    assert.match(await cardWhy(page, '[data-marxy-pane="0"]'), new RegExp(said.replace(/\./g, '\\.')));
    await nothingWrittenNoEntryAsked(page, L1);
  });
});

test('5. an inner archive over 16 MB is not listed, and says why', async () => {
  const BIG = '/r/archives/outer.zip';
  // Stored, so the inner archive itself is over 16 MB; the outer one deflates its zeros to almost nothing.
  const inner = zip([['zeros.bin', Buffer.alloc(17 * 1024 * 1024)]], true);
  await withFrame({ files: { ...FILES, [BIG]: zip([['inner.zip', inner], ['a.md', '# A\n']]) }, open: [BIG] }, async (page) => {
    await goTo(page, 'inner.zip');
    await page.waitForSelector(`${body} .marxy-fcard`, { timeout: 30_000 });
    assert.equal(await page.$(nested), null, 'not listed');
    assert.match(await cardWhy(page, body), /inner\.zip is 17\.0 MB: an archive inside an archive is listed only up to 16\.0 MB, so a nested bomb is never walked\./);
    await nothingWrittenNoEntryAsked(page, BIG);
  });
});

/** Every path a call names that is not absolute: in the real shell a relative one is read against its working folder. */
const relativePaths = (page) =>
  page.evaluate(() => {
    const PATHED = /^(readFile|readHead|readRange|stat|readDir|realPath|watch|allowAssetScope|imageSize|imageFacts|listArchive|readArchiveEntry|readArchiveHeads|tablesOpen|tablesRows|tablesBlob|fontFacts|fontGlyph|mediaFacts|mediaEnvelope|writeFileAtomic|writeFileNew|remove|revealInExternalEditor)$/;
    const out = [];
    for (const c of window.__marxyHandle.shell.calls) {
      const named = [];
      if (PATHED.test(c.method) && typeof c.args[0] === 'string') named.push(c.args[0]);
      if (c.method === 'searchContent') named.push(...(c.args[0] ?? []), ...(c.args[2]?.roots ?? []));
      for (const p of named) if (!String(p).startsWith('/')) out.push(`${c.method} ${p}`);
    }
    return [...new Set(out)];
  });

test('an entry\'s tab of any kind, with each panel shown, names no path to the shell but an absolute one', async () => {
  await withFrame({ files: FILES, open: [SURVEY] }, async (page) => {
    for (const [id, re] of [[`${R}src/indexer.rs`, /indexer\.rs$/], [`${R}README.md`, /README\.md$/], [`${R}pictures/boat-ribs.jpg`, /boat-ribs\.jpg$/]]) {
      await page.evaluate((p) => window.__marxyHandle.panes().openIn(0, p), SURVEY);
      await goTo(page, id);
      await page.keyboard.press('o');
      await waitPane(page, re);
      await page.waitForTimeout(400);
      for (const panel of ['Links', 'Outline', 'Metadata', 'Places', 'Search']) {
        await page.click(`.marxy-rail .marxy-l-rb[aria-label="${panel}"]`).catch(() => {});
        await page.waitForTimeout(250);
      }
      await page.click('[data-marxy-pane="0"] .marxy-head .marxy-crumbs button, [data-marxy-pane="0"] .marxy-head .marxy-crumbs a').catch(() => {});
      await page.keyboard.press('Escape');
    }
    await page.waitForTimeout(800);
    assert.deepEqual(await relativePaths(page), [], 'no relative path reaches the shell');
    await nothingWrittenNoEntryAsked(page, SURVEY);
  });
});

test('letting go of the outer entry lets go of what was read from it', async () => {
  await withFrame({ files: FILES, open: [SURVEY] }, async (page) => {
    await goTo(page, BACKUP);
    await page.waitForSelector(`${nested} .marxy-arow`, { timeout: 30_000 });
    const got = await page.evaluate(async () => {
      const { heldEntry, holdPreview, releasePreviews } = await import('/src/document/entries.ts');
      const outer = holdPreview({ archive: '/r/x.zip', name: 'x/inner.zip', index: 0, bytes: new Uint8Array([0x50, 0x4b, 5, 6]), mtimeMs: null });
      const child = holdPreview({ archive: outer.path, name: 'a.md', index: 0, bytes: new TextEncoder().encode('# A\n'), mtimeMs: null });
      const before = { outer: outer.depth, child: child.depth, held: heldEntry(child.path) !== null };
      releasePreviews({ path: outer.path });
      return { ...before, after: heldEntry(child.path) !== null };
    });
    assert.deepEqual(got, { outer: 1, child: 2, held: true, after: false });
    assert.match((await where(page)) ?? '', /notes-backup\.tar\.gz$/);
  });
});
