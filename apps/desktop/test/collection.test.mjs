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
