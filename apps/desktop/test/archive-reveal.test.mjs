// Reveal and x-ray on an archive: Shift X
// draws the file as stored as a strip that covers every byte once, the list gains packed size, method and offset and
// loses them again, the preview's head gains the entry's stored record, x shows an entry's local header as stored,
// Metadata's "Shown at" offers Reveal and "The file" says the methods and the system, and a page with no Reveal of its
// own (Markdown) is as before. Over the survey (fixtures/demo/archives) and a plain tar built here.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test as nodeTest } from 'node:test';
import { closeHarness } from './support/two-pane.mjs';
import { showPanel, skip, withFrame } from './support/frame.mjs';

const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);
after(() => closeHarness());

const demo = join(fileURLToPath(new URL('../../../', import.meta.url)), 'fixtures', 'demo', 'archives');
const SURVEY = '/r/archives/harbour-survey-2026.zip';
const TAR = '/r/archives/notes.tar';
const R = 'harbour-survey-2026/';
const surveyBytes = readFileSync(join(demo, 'harbour-survey-2026.zip'));

/** A ustar header for `name`, `size` bytes, its checksum set. */
function tarHeader(name, size, type) {
  const h = Buffer.alloc(512);
  h.write(name, 0);
  h.write('0000755\0', 100);
  h.write('0000000\0', 108);
  h.write('0000000\0', 116);
  h.write(`${size.toString(8).padStart(11, '0')}\0`, 124);
  h.write(`${(1_760_000_000).toString(8).padStart(11, '0')}\0`, 136);
  h.write(type, 156);
  h.write('ustar\0', 257);
  h.write('00', 263);
  h.fill(0x20, 148, 156);
  let sum = 0;
  for (const b of h) sum += b;
  h.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
  return h;
}
/** A plain tar of `[name, text]`, closed by its two zero blocks and padded to a 10,240-byte record, as tar writes it. */
function plainTar(entries) {
  const parts = [];
  for (const [name, text] of entries) {
    const dir = name.endsWith('/');
    const data = Buffer.from(dir ? '' : text);
    parts.push(tarHeader(name, data.length, dir ? '5' : '0'), data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  parts.push(Buffer.alloc(1024));
  const body = Buffer.concat(parts);
  return new Uint8Array(Buffer.concat([body, Buffer.alloc((10_240 - (body.length % 10_240)) % 10_240)]));
}
const tarBytes = plainTar([['notes/', ''], ['notes/a.md', '# A\n\nOne.\n'], ['notes/b.txt', 'b'.repeat(1300)], ['notes/c.log', 'c\n']]);

const FILES = {
  '/r/README.md': '# Here\n',
  '/r/plan.md': '# Plan\n\nThe first paragraph of the plan.\n\n- one\n- two\n',
  [SURVEY]: surveyBytes,
  [TAR]: tarBytes,
};

const blur = (page) => page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
const keys = async (page, ...list) => {
  for (const k of list) await page.keyboard.press(k);
};
/** The cursor put on the entry `id` (its path in the archive), as the Line's `@` does; the pane is focused first. */
const goTo = async (page, id) => {
  await page.waitForSelector('.marxy-arow');
  await blur(page);
  await page.evaluate(async (id) => {
    const { partsGoTo } = await import('/src/parts/cursor.ts');
    if (!partsGoTo(id)) throw new Error(`no part ${id}`);
  }, id);
  await page.waitForSelector('.marxy-arow.marxy-cursor');
};
const listing = (page, p) => page.evaluate((p) => window.__marxyHandle.shell.listArchive(p), p);
/** The strip's segments as drawn: their kind and the bytes each stands for. */
const segments = (page) =>
  page.$$eval('.marxy-arch-seg', (segs) => segs.map((s) => ({ kind: s.getAttribute('data-marxy-seg'), from: Number(s.getAttribute('data-marxy-strip-from')), to: Number(s.getAttribute('data-marxy-strip-to')), on: s.classList.contains('marxy-arch-seg-on') })));
/** Every byte from 0 to `size` in exactly one segment, in order. */
function coversOnce(segs, size) {
  let at = 0;
  for (const s of segs) {
    assert.equal(s.from, at, `${s.kind} at ${s.from} starts where the one before ended (no gap, no overlap)`);
    assert.ok(s.to > s.from, `${s.kind} at ${s.from} is not empty`);
    at = s.to;
  }
  assert.equal(at, size, 'the last segment ends at the file’s last byte');
  assert.equal(segs.reduce((n, s) => n + (s.to - s.from), 0), size, 'the widths in bytes sum to the file’s size');
}
const record = (page) =>
  page.$$eval('.marxy-arch-rec > .marxy-arch-rec-k', (ks) => Object.fromEntries(ks.map((k) => [k.textContent, k.nextElementSibling?.textContent ?? ''])));

test('1. Shift X shows the strip, and its segments cover every byte of the file once, for the survey zip and a plain tar', async () => {
  await withFrame({ files: FILES, open: [SURVEY] }, async (page) => {
    await goTo(page, `${R}src/publish.sh`);
    assert.equal(await page.$('.marxy-arch-strip'), null, 'Read draws no strip');
    await keys(page, 'Shift+X');
    // Drawn once the end record has been read from the file's tail.
    await page.waitForSelector('.marxy-arch-seg[data-marxy-seg="end"]');
    const segs = await segments(page);
    coversOnce(segs, surveyBytes.length);
    const l = await listing(page, SURVEY);
    const placed = l.entries.filter((e) => e.offset !== null);
    assert.ok(segs.filter((s) => s.kind === 'entry' || s.kind === 'entries').length >= 2);
    for (const s of segs.filter((s) => s.kind === 'entry')) assert.ok(placed.some((e) => e.offset === s.from), `the entry segment at ${s.from} begins at an entry's header`);
    const dir = segs.find((s) => s.kind === 'directory');
    assert.deepEqual([dir.from, dir.to], [l.directory.at, l.directory.at + l.directory.size]);
    assert.equal(segs.filter((s) => s.kind === 'stray' || s.kind === 'before').length, 0, 'every byte of the survey belongs to a part');
    // The cursor's entry is lit, and a click on another entry's segment moves the cursor there.
    const pub = l.entries.find((e) => e.path === `${R}src/publish.sh`);
    assert.deepEqual(segs.filter((s) => s.on).map((s) => s.from), [pub.offset]);
    assert.match(await page.textContent('.marxy-arch-stripcap'), /^The file as stored, byte 0 to [\d,]+, left to right: .* Every byte of the file is in the strip\.$/);
    const big = l.entries.find((e) => e.path === `${R}data/gauges.sqlite`);
    const box = await page.locator(`.marxy-arch-seg[data-marxy-strip-from="${big.offset}"]`).boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForFunction(() => document.querySelector('.marxy-arow.marxy-cursor .marxy-arch-name')?.textContent === 'gauges.sqlite');
  });
  await withFrame({ files: FILES, open: [TAR] }, async (page) => {
    await page.waitForSelector('.marxy-arow');
    await blur(page);
    await keys(page, 'j', 'Shift+X');
    await page.waitForSelector('.marxy-arch-seg');
    const segs = await segments(page);
    coversOnce(segs, tarBytes.length);
    assert.deepEqual(segs.map((s) => [s.kind, s.to - s.from]), [['entry', 512], ['entry', 1024], ['entry', 2048], ['entry', 1024], ['tar-end', 10_240 - 4608]]);
    assert.match(await page.textContent('.marxy-arch-stripcap'), /each entry’s 512-byte header and its data in blocks of 512, in the order they were written, then the end blocks \(5,632 bytes\)/);
  });
});

test('2. the list gains packed size, method and offset, and loses them again', async () => {
  await withFrame({ files: FILES, open: [SURVEY] }, async (page) => {
    await goTo(page, `${R}src/publish.sh`);
    const heads = () => page.$$eval('.marxy-arch-cols > span', (s) => s.filter((x) => getComputedStyle(x).display !== 'none').map((x) => x.textContent));
    assert.deepEqual(await heads(), ['Name', 'Reads as', 'Size']);
    assert.equal(await page.$$eval('.marxy-arow .marxy-arch-rv', (c) => c.length), 0);
    await keys(page, 'Shift+X');
    await page.waitForSelector('.marxy-archpage.marxy-arch-revealed');
    assert.deepEqual((await heads()).slice(-3), ['Packed', 'By', 'At byte']);
    const l = await listing(page, SURVEY);
    const pub = l.entries.find((e) => e.path === `${R}src/publish.sh`);
    const cells = () => page.$$eval('.marxy-arow.marxy-cursor .marxy-arch-rv', (c) => c.map((x) => x.textContent));
    await page.waitForFunction(() => document.querySelectorAll('.marxy-arow.marxy-cursor .marxy-arch-rv').length === 3);
    assert.deepEqual(await cells(), [pub.packed.toLocaleString('en-GB'), 'deflate', pub.offset.toLocaleString('en-GB')]);
    const stored = l.entries.find((e) => e.kind === 'file' && e.packed === e.size && !e.encrypted && e.size > 0);
    await goTo(page, stored.path);
    await page.waitForFunction(() => document.querySelectorAll('.marxy-arow.marxy-cursor .marxy-arch-rv').length === 3);
    assert.equal((await cells())[1], 'stored');
    await keys(page, 'Shift+X');
    await page.waitForFunction(() => !document.querySelector('.marxy-archpage.marxy-arch-revealed'));
    assert.deepEqual(await heads(), ['Name', 'Reads as', 'Size']);
    assert.equal(await page.$$eval('.marxy-arow .marxy-arch-rv', (c) => c.length), 0);
    assert.equal(await page.$('.marxy-arch-strip'), null);
    assert.equal(await page.$('.marxy-arch-rec'), null);
  });
});

test('3. the stored record gives offset, method, checksum and mode for an entry written on Unix', async () => {
  await withFrame({ files: FILES, open: [SURVEY] }, async (page) => {
    await goTo(page, `${R}src/publish.sh`);
    await keys(page, 'Shift+X');
    await page.waitForFunction(() => /^bytes /.test([...document.querySelectorAll('.marxy-arch-rec-k')].find((k) => k.textContent === 'Data')?.nextElementSibling?.textContent ?? ''));
    const l = await listing(page, SURVEY);
    const pub = l.entries.find((e) => e.path === `${R}src/publish.sh`);
    const rec = await record(page);
    const n = (x) => x.toLocaleString('en-GB');
    assert.equal(rec.Header, `at byte ${n(pub.offset)}`);
    // The local header is 30 bytes, the name as written and no extra field: the data follows it.
    const dataAt = pub.offset + 30 + Buffer.byteLength(pub.path);
    assert.equal(rec.Data, `bytes ${n(dataAt)} to ${n(dataAt + pub.packed - 1)}`);
    assert.equal(rec.Method, '8, deflate');
    assert.equal(rec.Checksum, pub.crc.toString(16).padStart(8, '0'));
    assert.equal(rec['Written on'], 'Unix');
    assert.equal(rec.Mode, '-rwxr-xr-x · 755');
    assert.match(rec.Flags, /^0x[0-9a-f]{4}/);
  });
});

test('4. x on an entry of a zip shows its local header as stored, bytes beginning 50 4b 03 04; x again takes it away', async () => {
  await withFrame({ files: FILES, open: [SURVEY] }, async (page) => {
    await goTo(page, `${R}src/publish.sh`);
    await keys(page, 'x');
    await page.waitForSelector('.marxy-archpage .marxy-xray');
    const first = await page.textContent('.marxy-archpage .marxy-xray .marxy-xray-line .marxy-xray-text');
    assert.match(first, /^50 4b 03 04 /i);
    assert.match(await page.getAttribute('.marxy-archpage .marxy-xray .marxy-xray-head', 'data-marxy-xray-head'), /^As stored · the local header of publish\.sh · bytes /);
    const l = await listing(page, SURVEY);
    const pub = l.entries.find((e) => e.path === `${R}src/publish.sh`);
    // Read from the archive at the entry's offset: the box's first row is numbered by it, in hex.
    assert.equal(await page.getAttribute('.marxy-archpage .marxy-xray .marxy-xray-line', 'data-marxy-line'), pub.offset.toString(16).toUpperCase().padStart(4, '0'));
    assert.ok(!(await page.evaluate(() => window.__marxyHandle.shell.calls.some((c) => c.method === 'readArchiveEntry' && c.args[2]?.endsWith('publish.sh')))), 'nothing unpacked for it');
    await keys(page, 'x');
    await page.waitForFunction(() => !document.querySelector('.marxy-archpage .marxy-xray'));
    // It goes with the cursor too.
    await keys(page, 'x');
    await page.waitForSelector('.marxy-archpage .marxy-xray');
    await keys(page, 'k');
    await page.waitForFunction(() => !document.querySelector('.marxy-archpage .marxy-xray'));
  });
});

test('5. Metadata’s "Shown at" offers Reveal for an archive, and "The file" gives its methods and the system', async () => {
  await withFrame({ files: FILES, open: [SURVEY] }, async (page) => {
    await page.waitForSelector('.marxy-arow');
    await showPanel(page, 'metadata');
    const shown = () => page.$$eval('.marxy-drawer .marxy-l-tool .marxy-l-sg button', (b) => b.map((x) => x.textContent));
    assert.deepEqual(await shown(), ['Read', 'Reveal', 'X-ray', 'Source']);
    await page.click('.marxy-drawer .marxy-l-sg button:text-is("Reveal")');
    await page.waitForSelector('.marxy-arch-strip');
    await page.waitForFunction(() => document.querySelector('.marxy-drawer .marxy-l-sg button[aria-pressed="true"]')?.textContent === 'Reveal');
    const facts = () => page.$$eval('.marxy-drawer .marxy-fact', (rows) => Object.fromEntries(rows.map((r) => [r.querySelector('.marxy-fact-k').textContent, r.querySelector('.marxy-fact-v').textContent])));
    await page.waitForFunction(() => [...document.querySelectorAll('.marxy-drawer .marxy-fact-k')].some((k) => k.textContent === 'methods'));
    const f = await facts();
    assert.equal(f.form, 'A ZIP archive');
    assert.match(f.methods, /^deflate \d+ · stored \d+$/);
    assert.equal(f['written on'], 'Unix');
    assert.match(f.packs, /^to \d+% of its unpacked size$/);
    assert.equal(f['at its root'], 'one folder, harbour-survey-2026/, holds everything');
    assert.match(f.dates, /^\d+ \w{3} 2026( to \d+ \w{3} 2026)?$/);
    // The head says ¶ while it is on, and Read takes it away.
    await page.waitForSelector('[data-marxy-head="0"] .marxy-head-chip[data-marxy-chip="reveal"]:not([hidden])');
    await page.click('.marxy-drawer .marxy-l-sg button:text-is("Read")');
    await page.waitForFunction(() => !document.querySelector('.marxy-arch-strip'));
  });
});

test('6. a page with no Reveal of its own (Markdown) behaves as before under Shift X', async () => {
  await withFrame({ files: FILES, open: ['/r/plan.md'] }, async (page) => {
    await blur(page);
    const on = () => page.evaluate(() => document.querySelector('[data-marxy-pane="0"] .marxy-article').hasAttribute('data-marxy-reveal'));
    assert.equal(await page.evaluate(() => window.__marxyHandle.panes().panes[0].content.viewer()?.reveal), undefined);
    await keys(page, 'j', 'Shift+X');
    assert.equal(await on(), true);
    assert.ok((await page.$$eval('[data-marxy-pane="0"] .marxy-article .marxy-reveal-mark', (m) => m.map((x) => x.textContent))).includes('# '));
    await keys(page, 'Shift+X');
    assert.equal(await on(), false);
  });
});
