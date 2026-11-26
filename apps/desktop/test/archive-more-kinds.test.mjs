// The archive page over the kinds only the desktop shell lists (a RAR, a Debian package, a cabinet, an ISO image):
// each opens on the archive page with its form in the lede, the shell's note under it, and its entries; a RAR's
// entry says it is not read. The browser build cannot list these from bytes, so the shell's two archive
// calls answer here with listings in the shape the Rust readers give (their own tests open generated samples). WebKit.
import { strict as assert } from 'node:assert';
import { after, test as nodeTest } from 'node:test';
import { closeHarness } from './support/two-pane.mjs';
import { skip, withFrame } from './support/frame.mjs';

const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);
after(() => closeHarness());

const entry = (index, path, more = {}) => ({
  index, path, kind: path.endsWith('/') ? 'dir' : 'file', size: path.endsWith('/') ? null : 5, packed: null, mtime: '2023-11-14T22:13:20Z',
  encrypted: false, method: null, rawName: null, link: null, offset: null, crc: null, host: null, mode: null, flags: null, comment: null, ...more,
});
const listing = (format, entries, note) => ({
  format, entries, comment: null, truncated: null, skipped: 0, declared: null, size: 4096, unpacked: null, directory: null, ...(note ? { note } : {}),
});

const RAR_NOTE = 'The contents cannot be read here: Marxy lists a RAR archive but does not unpack it.';
const RAR_REFUSED = 'Marxy does not unpack RAR archives: there is no decoder it may use, so only the listing is shown.';
const KINDS = {
  '/r/a/backup.rar': {
    listing: listing('rar', [entry(0, 'notes/'), entry(1, 'notes/a.txt', { method: 'RAR' }), entry(2, 'locked.bin', { encrypted: true })], RAR_NOTE),
    form: 'A RAR archive',
    note: RAR_NOTE,
  },
  '/r/a/hello.deb': {
    listing: listing('deb', [entry(0, 'debian-binary'), entry(1, 'control.tar.gz'), entry(2, 'data.tar.lzma'), entry(3, 'control/control')], 'data.tar.lzma is packed in a way the app does not unpack, so its files are not listed.'),
    form: 'A Debian package',
    note: 'data.tar.lzma is packed in a way the app does not unpack, so its files are not listed.',
  },
  '/r/a/setup.cab': {
    listing: listing('cab', [entry(0, 'setup.inf', { method: 'LZX' })], 'Entries packed with LZX are listed but not unpacked: the app has no decoder for it.'),
    form: 'A Windows cabinet',
    note: 'Entries packed with LZX are listed but not unpacked: the app has no decoder for it.',
  },
  '/r/a/disc.iso': { listing: listing('iso', [entry(0, 'README.TXT'), entry(1, 'DOCS/'), entry(2, 'DOCS/NOTE.MD')]), form: 'An ISO 9660 disc image', note: null },
};
const FILES = Object.fromEntries([['/r/README.md', '# Here\n'], ...Object.keys(KINDS).map((p) => [p, new Uint8Array(4096)])]);

/** The shell's archive calls answer as the desktop shell would for these paths. */
async function answerAsTheDesktop(page) {
  await page.evaluate(
    ({ kinds, refused }) => {
      const shell = window.__marxyHandle.shell;
      const list = shell.listArchive.bind(shell);
      const heads = shell.readArchiveHeads.bind(shell);
      shell.listArchive = async (p) => kinds[p]?.listing ?? list(p);
      shell.readArchiveHeads = async (p, wants, max) => {
        const k = kinds[p];
        if (!k) return heads(p, wants, max);
        const say = k.listing.format === 'rar' ? refused : null;
        return wants.map((w) => ({ index: w.index, bytes: say ? new Uint8Array() : new TextEncoder().encode('hello'), whole: !say, refused: say }));
      };
    },
    { kinds: KINDS, refused: RAR_REFUSED },
  );
}

test('each kind opens on the archive page: its form, the note the shell gives and its entries', async () => {
  await withFrame({ files: FILES, open: ['/r/README.md'] }, async (page) => {
    await answerAsTheDesktop(page);
    for (const [path, k] of Object.entries(KINDS)) {
      await page.evaluate((p) => window.__marxyHandle.open(p), path);
      await page.waitForFunction((f) => document.querySelector('.marxy-arch-lede')?.textContent.startsWith(f), k.form);
      const notes = await page.$$eval('.marxy-arch-note', (ps) => ps.map((p) => p.textContent));
      assert.deepEqual(notes, k.note ? [k.note] : [], path);
      const names = await page.$$eval('.marxy-arow .marxy-arch-name', (ns) => ns.map((n) => n.textContent));
      const files = k.listing.entries.filter((e) => e.kind === 'file').map((e) => e.path.split('/').pop());
      for (const f of files) assert.ok(names.includes(f), `${path}: ${f} in ${names}`);
    }
  });
});

test("a RAR's entry under the cursor says it is not read", async () => {
  await withFrame({ files: FILES, open: ['/r/README.md'] }, async (page) => {
    await answerAsTheDesktop(page);
    await page.evaluate(() => window.__marxyHandle.open('/r/a/backup.rar'));
    await page.waitForSelector('.marxy-atree');
    await page.click('.marxy-arow:has(.marxy-arch-name:text-is("a.txt"))');
    // Every RAR entry carries the method the app does not unpack, so the preview's head says so without asking the shell.
    await page.waitForFunction(() => document.body.innerText.includes('compressed with RAR, which the app does not read'), null, { timeout: 10_000 });
    const asked = await page.evaluate(() => window.__marxyHandle.shell.calls.filter((c) => c.method === 'readArchiveEntry').length);
    assert.equal(asked, 0, 'no entry of a RAR is read');
  });
});
