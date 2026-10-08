// collection.toml in the real app (C-10): the palette harness over the memory shell. Declared folders
// join the palette's scope after the current repository, a declared deny glob hides a file, and an
// edit to collection.toml drops a folder without a restart.
import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test as nodeTest } from 'node:test';
import { parseCollection } from '@marxy/core/src/index-model/collection.ts';
import { webkit } from 'playwright';
import { build } from 'vite';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip }, fn);

const desktopRoot = fileURLToPath(new URL('..', import.meta.url));
const outDir = mkdtempSync(join(tmpdir(), 'marxy-collection-'));
let server;
let base;

const enc = (s) => Buffer.from(s);
// /b is declared before /a, so file order and the path tie-break disagree: the order seen is the file's.
const twoFolders = '[[root]]\npath = "/b"\n\n[[root]]\npath = "/a"\n\n[deny]\nglobs = ["**/drafts/**"]\n';

/** The memory shell's config is `/config`: collection.toml is `/collection.toml`. */
const files = () => ({
  '/c/.git/HEAD': enc('ref: refs/heads/main\n'),
  '/c/README.md': enc('# Home\n\nThe open repository.\n'),
  '/c/notes.md': enc('# Notes in c\n'),
  '/a/notes.md': enc('# Notes in a\n'),
  '/a/drafts/notes-draft.md': enc('# Notes draft\n'),
  '/b/notes.md': enc('# Notes in b\n'),
  '/collection.toml': enc(twoFolders),
});

const toB64 = (f) => Object.fromEntries(Object.entries(f).map(([path, bytes]) => [path, bytes.toString('base64')]));

before(async () => {
  if (skip) return;
  await build({
    root: desktopRoot,
    logLevel: 'silent',
    build: {
      outDir,
      emptyOutDir: true,
      rollupOptions: { input: { paletteBoot: join(desktopRoot, 'test/palette-boot.html') } },
    },
  });
  const types = { '.html': 'text/html', '.ttf': 'font/ttf', '.js': 'text/javascript', '.txt': 'text/plain', '.css': 'text/css' };
  server = createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const path = join(outDir, pathname.endsWith('/') ? `${pathname}index.html` : pathname);
    if (!existsSync(path)) { res.statusCode = 404; return res.end(); }
    res.setHeader('Content-Type', types[extname(path)] ?? 'application/octet-stream');
    res.end(readFileSync(path));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}/`;
});
after(() => server?.close());

/** Types `query` in the palette and returns the rows' text. */
async function search(page, mod, query) {
  await page.keyboard.press(`${mod}+KeyP`);
  await page.waitForSelector('#marxy-palette[open]');
  await page.fill('#marxy-palette .marxy-palette-query', query);
  const rows = await page.$$eval('#marxy-palette .marxy-palette-row', (els) => els.map((el) => el.textContent ?? ''));
  await page.keyboard.press('Escape');
  return rows;
}

test('declared /b and /a follow the open repository /c; a denied draft never appears; dropping /b needs no restart', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 760 } });
    await page.goto(`${base}test/palette-boot.html`);
    await page.waitForFunction(() => typeof window.marxyPaletteBoot?.start === 'function');
    const marks = await page.evaluate(async ({ files }) => {
      const { handle } = await window.marxyPaletteBoot.start(files, ['/c/README.md']);
      window.__h = handle;
      await handle.collection.loaded;
      // Marks, and where collection.toml was read, in call order.
      return handle.shell.calls
        .filter((c) => c.method === 'mark' || (c.method === 'readFile' && c.args[0] === '/collection.toml'))
        .map((c) => (c.method === 'mark' ? c.args[0] : 'read collection.toml'));
    }, { files: toB64(files()) });

    // The deny list is read for the repository's first walk, but never before first text.
    assert.ok(marks.indexOf('read collection.toml') > marks.indexOf('first_text'), JSON.stringify(marks));
    assert.ok(marks.indexOf('read collection.toml') < marks.indexOf('index_loaded'), 'read before the first walk is published');

    // collection_loaded is marked once, and after first_text.
    assert.equal(marks.filter((m) => m === 'collection_loaded').length, 1, JSON.stringify(marks));
    assert.ok(marks.indexOf('first_text') >= 0, 'first_text was marked');
    assert.ok(marks.indexOf('first_text') < marks.indexOf('collection_loaded'), JSON.stringify(marks));

    const mod = (await page.evaluate(() => navigator.platform)) === 'MacIntel' ? 'Meta' : 'Control';
    const rows = await search(page, mod, 'notes');
    assert.deepEqual(rows, ['Notes in c', 'Notes in b', 'Notes in a'], 'current repository, then the declared folders in file order');
    assert.ok(!rows.some((r) => r.includes('draft')), `**/drafts/** is denied: ${JSON.stringify(rows)}`);
    assert.deepEqual(await search(page, mod, 'draft'), [], 'not even by name');

    // Rewrite collection.toml without /b and deliver the config directory's watch event.
    await page.evaluate(async () => {
      const h = window.__h;
      await h.shell.writeFileAtomic('/collection.toml', new TextEncoder().encode('[[root]]\npath = "/a"\n\n[deny]\nglobs = ["**/drafts/**"]\n'));
      h.shell.emit([{ kind: 'modified', path: '/collection.toml' }]);
      await h.collection.settled();
    });
    assert.deepEqual(await search(page, mod, 'notes'), ['Notes in c', 'Notes in a'], "/b's hits are gone, with no restart");
    assert.equal(
      await page.evaluate(() => window.__h.shell.calls.filter((c) => c.method === 'mark' && c.args[0] === 'collection_loaded').length),
      1,
    );
  } finally {
    await browser.close();
  }
});

// ---- C-14: the two palette commands ------------------------------------------------------------

const dec = (b) => Buffer.from(b).toString('utf8');

/** A harness booted on `doc`, with `extra` files beside the repositories and no collection.toml unless given. */
async function boot(browser, doc, extra = {}) {
  const page = await browser.newPage({ viewport: { width: 960, height: 760 } });
  await page.goto(`${base}test/palette-boot.html`);
  await page.waitForFunction(() => typeof window.marxyPaletteBoot?.start === 'function');
  const all = { ...files(), ...extra };
  if (!('/collection.toml' in extra)) delete all['/collection.toml'];
  all['/a/.git/HEAD'] = enc('ref: refs/heads/main\n');
  await page.evaluate(async ({ files: f, doc: d }) => {
    const { handle } = await window.marxyPaletteBoot.start(f, [d]);
    window.__h = handle;
    await handle.collection.loaded;
  }, { files: toB64(all), doc });
  const mod = (await page.evaluate(() => navigator.platform)) === 'MacIntel' ? 'Meta' : 'Control';
  return { page, mod };
}

/** Runs the first palette row for `query` and waits for the app to settle. */
async function runCommand(page, mod, query) {
  await page.keyboard.press(`${mod}+KeyP`);
  await page.waitForSelector('#marxy-palette[open]');
  await page.fill('#marxy-palette .marxy-palette-query', `>${query}`);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !document.querySelector('#marxy-palette[open]'));
}

const readToml = (page) => page.evaluate(async () => {
  try {
    return Array.from(await window.__h.shell.readFile('/collection.toml'));
  } catch {
    return null;
  }
});
const tomlWrites = (page) => page.evaluate(
  () => window.__h.shell.calls.filter((c) => c.method === 'writeFileAtomic' && c.args[0] === '/collection.toml').length,
);
const noticeText = (page) => page.evaluate(() => document.getElementById('marxy-notices')?.textContent ?? '');
/** Delivers the config directory's watch event, as the shell does, and waits for the reload. */
const follow = (page) => page.evaluate(async () => {
  window.__h.shell.emit([{ kind: 'modified', path: '/collection.toml' }]);
  await window.__h.collection.settled();
});

test('both commands are in the palette', async () => {
  const browser = await launchWebkit();
  try {
    const { page, mod } = await boot(browser, '/c/README.md');
    const rows = await search(page, mod, '>collection');
    assert.ok(rows.some((r) => r.includes('Add this folder to the collection')), JSON.stringify(rows));
    assert.ok(rows.some((r) => r.includes('Edit collection')), JSON.stringify(rows));
  } finally {
    await browser.close();
  }
});

test('Add on an empty config directory writes the template and one root, and the palette searches it', async () => {
  const browser = await launchWebkit();
  try {
    const { page, mod } = await boot(browser, '/a/notes.md');
    assert.equal(await readToml(page), null, 'no collection.toml yet');
    await runCommand(page, mod, 'Add this folder');
    const written = dec(await readToml(page));
    assert.ok(written.startsWith('# Folders Marxy searches.'), written);
    assert.ok(written.endsWith("[[root]]\npath = '/a'\n"), written);
    assert.equal((written.match(/^\[\[root\]\]/gm) ?? []).length, 1);
    assert.match(await noticeText(page), /Added a to the collection/);
    // The reader moves to another repository; /a is held because it is declared.
    await follow(page);
    await page.evaluate(() => window.__h.open('/c/README.md'));
    await page.evaluate(() => window.__h.collection.settled());
    assert.ok((await search(page, mod, 'Notes in a')).includes('Notes in a'));
    const roots = await page.evaluate(() => window.__h.index.roots());
    assert.ok(roots.includes('/a'), JSON.stringify(roots));
  } finally {
    await browser.close();
  }
});

test('Add keeps every byte of a hand-edited CRLF file and lists the new root last', async () => {
  const browser = await launchWebkit();
  try {
    // Comments, CRLF, a deny table, and no final newline.
    const hand = '# mine\r\n\r\n[[root]]\r\npath = "/b"   # kept\r\n\r\n[deny]\r\nglobs = ["**/drafts/**"]';
    const { page, mod } = await boot(browser, '/a/notes.md', { '/collection.toml': enc(hand) });
    await runCommand(page, mod, 'Add this folder');
    const written = dec(await readToml(page));
    assert.ok(written.startsWith(hand), 'every prior byte is where it was');
    const tail = written.slice(hand.length);
    assert.equal(tail, `\r\n[[root]]\r\npath = '/a'\r\n`);
    const parsed = parseCollection(Buffer.from(written), { home: '/home/x' });
    assert.deepEqual(parsed.collection.roots.map((r) => r.path), ['/b', '/a'], 'the new root is listed last');
    assert.deepEqual(parsed.collection.denyGlobs, ['**/drafts/**']);
  } finally {
    await browser.close();
  }
});

test('Add twice writes once, and a folder written another way counts as declared', async () => {
  const browser = await launchWebkit();
  try {
    const { page, mod } = await boot(browser, '/a/notes.md');
    await runCommand(page, mod, 'Add this folder');
    await runCommand(page, mod, 'Add this folder');
    assert.equal(await tomlWrites(page), 1);
    assert.match(await noticeText(page), /Already in the collection/);
    const once = await readToml(page);

    // The same folder with a trailing slash is the same folder.
    const b = await boot(browser, '/a/notes.md', { '/collection.toml': enc('[[root]]\npath = "/a/"\n') });
    await runCommand(b.page, b.mod, 'Add this folder');
    assert.equal(await tomlWrites(b.page), 0);
    assert.match(await noticeText(b.page), /Already in the collection/);
    assert.ok(once.length > 0);
  } finally {
    await browser.close();
  }
});

test('Add refuses a file that is not TOML and a filesystem root, and changes nothing', async () => {
  const browser = await launchWebkit();
  try {
    const broken = '[[root\npath = = "/b"\n';
    const { page, mod } = await boot(browser, '/a/notes.md', { '/collection.toml': enc(broken) });
    await runCommand(page, mod, 'Add this folder');
    assert.equal(dec(await readToml(page)), broken);
    assert.equal(await tomlWrites(page), 0);
    assert.match(await noticeText(page), /collection\.toml was not changed/);

    const disk = await boot(browser, '/loose.md', { '/loose.md': enc('# Loose\n') });
    await runCommand(disk.page, disk.mod, 'Add this folder');
    assert.equal(await tomlWrites(disk.page), 0);
    assert.equal(await readToml(disk.page), null);
    assert.match(await noticeText(disk.page), /whole disk/);
  } finally {
    await browser.close();
  }
});

test('Edit collection creates the template when absent and opens it in Source showing its bytes', async () => {
  const browser = await launchWebkit();
  try {
    const { page, mod } = await boot(browser, '/c/README.md');
    await runCommand(page, mod, 'Edit collection');
    await page.waitForFunction(() => document.body.dataset.marxyMode === 'source');
    const template = dec(await readToml(page));
    assert.ok(template.startsWith('# Folders Marxy searches.'));
    assert.ok(!/^\[\[root\]\]/m.test(template), 'the template declares no folder');
    assert.equal(await page.evaluate(() => window.__h.currentPath()), '/collection.toml');
    const shown = await page.evaluate(() => document.querySelector('.cm-content')?.textContent ?? '');
    assert.ok(shown.includes('Folders Marxy searches'), shown.slice(0, 200));
    assert.equal(await tomlWrites(page), 1);

    // An existing file is opened as it is, not rewritten.
    const hand = await boot(browser, '/c/README.md', { '/collection.toml': enc('# mine\r\n') });
    await runCommand(hand.page, hand.mod, 'Edit collection');
    await hand.page.waitForFunction(() => document.body.dataset.marxyMode === 'source');
    assert.equal(await tomlWrites(hand.page), 0);
  } finally {
    await browser.close();
  }
});
