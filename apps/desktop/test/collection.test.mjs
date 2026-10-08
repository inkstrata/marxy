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
  const rows = await page.$$eval('#marxy-palette .marxy-palette-row', (els) =>
    // A row's title, without the age a watched root's row carries beside it (C-12).
    els.map((el) => (el.querySelector('.marxy-palette-title') ?? el).textContent ?? ''),
  );
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
    return Array.from(await window.__h.shell.readFile(window.__tomlPath ?? '/collection.toml'));
  } catch {
    return null;
  }
});
const tomlWrites = (page) => page.evaluate(
  () => window.__h.shell.calls.filter((c) => c.method === 'writeFileAtomic' && c.args[0] === (window.__tomlPath ?? '/collection.toml')).length,
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
    // Marxy's config folder lives inside the repository /c, as a reader's might.
    await page.evaluate(() => {
      window.__h.shell.configPaths = async () => ({ config: '/c/cfg/config.toml', data: '/c/data' });
      window.__tomlPath = '/c/cfg/collection.toml';
    });
    await runCommand(page, mod, 'Edit collection');
    await page.waitForFunction(() => document.body.dataset.marxyMode === 'source');
    const template = dec(await readToml(page));
    assert.ok(template.startsWith('# Folders Marxy searches.'));
    assert.ok(!/^\[\[root\]\]/m.test(template), 'the template declares no folder');
    assert.equal(await page.evaluate(() => window.__h.currentPath()), '/c/cfg/collection.toml');
    const shown = await page.evaluate(() => document.querySelector('.cm-content')?.textContent ?? '');
    assert.ok(shown.includes('Folders Marxy searches'), shown.slice(0, 200));
    assert.equal(await tomlWrites(page), 1);
    // jumpToSource(0) puts the reader in Source as soon as the open settles.
    assert.equal(await page.evaluate(() => document.body.dataset.marxyMode), 'source');

    // With collection.toml itself open, Add would declare Marxy's own config folder: refused.
    await runCommand(page, mod, 'Add this folder');
    assert.equal(await tomlWrites(page), 1, 'nothing more was written');
    assert.equal(dec(await readToml(page)), template);
    assert.match(await noticeText(page), /Marxy's own settings and state/);

    // An existing file is opened as it is, not rewritten.
    const hand = await boot(browser, '/c/README.md', { '/collection.toml': enc('# mine\r\n') });
    await runCommand(hand.page, hand.mod, 'Edit collection');
    await hand.page.waitForFunction(() => document.body.dataset.marxyMode === 'source');
    assert.equal(await tomlWrites(hand.page), 0);
  } finally {
    await browser.close();
  }
});

test("Add escapes a folder named it's, keeps every prior byte and parses back to that path", async () => {
  const browser = await launchWebkit();
  try {
    const hand = '# mine\r\n[[root]]\r\npath = "/b"\r\n';
    const { page, mod } = await boot(browser, "/it's/notes.md", {
      "/it's/.git/HEAD": enc('ref: refs/heads/main\n'),
      "/it's/notes.md": enc('# Quoted\n'),
      '/collection.toml': enc(hand),
    });
    await runCommand(page, mod, 'Add this folder');
    const written = dec(await readToml(page));
    assert.ok(written.startsWith(hand), 'every prior byte is where it was');
    const parsed = parseCollection(Buffer.from(written), { home: '/home/x' });
    assert.deepEqual(parsed.warnings, []);
    assert.deepEqual(parsed.collection.roots.map((r) => r.path), ['/b', "/it's"]);
||||||| parent of 17668199 (feat(desktop): a watch event patches one entry in the collection, never the whole index (C-11))
// ---------------------------------------------------------------------------------------------
// C-11: a watch event patches one entry, never the whole index.

/** /c is the open repository; /n is declared; /c/docs is declared inside /c; drafts are denied. */
const watchedFiles = () => ({
  '/c/.git/HEAD': enc('ref: refs/heads/main\n'),
  '/c/README.md': enc('# Home\n'),
  '/c/docs/guide.md': enc('# Guide\n'),
  '/n/notes.md': enc('# Notes in n\n'),
  '/collection.toml': enc('[[root]]\npath = "/n"\n\n[[root]]\npath = "/c/docs"\n\n[deny]\nglobs = ["**/drafts/**"]\n'),
});

/** Boots the palette harness on `files` and waits until every root is walked and every watch is open. */
async function bootWatched(page, files, opts) {
  await page.goto(`${base}test/palette-boot.html`);
  await page.waitForFunction(() => typeof window.marxyPaletteBoot?.start === 'function');
  await page.evaluate(async ({ files, opts }) => {
    const { handle } = await window.marxyPaletteBoot.start(files, ['/c/README.md'], undefined, opts);
    window.__h = handle;
    await handle.collection.recentLoaded;
    await handle.index.settled();
    await handle.trees.settled();
    // A bounded wait for a condition in the page; a timeout reads as the failure it is.
    window.__until = async (ok, what) => {
      const deadline = performance.now() + 5000;
      while (!ok()) {
        if (performance.now() > deadline) throw new Error(`timed out waiting for ${what}`);
        await new Promise((r) => setTimeout(r, 10));
      }
    };
  }, { files: toB64(files), opts });
  return (await page.evaluate(() => navigator.platform)) === 'MacIntel' ? 'Meta' : 'Control';
}

test('C-11: a file written temp-then-rename into a watched folder is listed after the batch; deleting it removes it', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 760 } });
    const mod = await bootWatched(page, watchedFiles());
    const watches = await page.evaluate(() => ({
      trees: window.__h.trees.trees(),
      recursive: window.__h.shell.calls.filter((c) => c.method === 'watch' && c.args[1]?.recursive).map((c) => c.args[0]),
    }));
    // /c/docs lies inside /c: one watch on the outer tree serves both.
    assert.deepEqual([...watches.trees].sort(), ['/c', '/n']);
    assert.deepEqual([...watches.recursive].sort(), ['/c', '/n']);

    const walks = () => page.evaluate(() => window.__h.shell.calls.filter((c) => c.method === 'mark' && c.args[0] === 'index_loaded').length);
    const walked = await walks();
    await page.evaluate(async () => {
      const h = window.__h;
      await h.shell.writeFileAtomic('/n/plan.md', new TextEncoder().encode('# Agent plan\n\n## Steps\n'));
      h.shell.emit([
        { kind: 'created', path: '/n/.plan.md.tmp' },
        { kind: 'renamed', path: '/n/.plan.md.tmp', to: '/n/plan.md' },
      ]);
      await window.__until(() => h.index.entries().some((e) => e.path === '/n/plan.md'), 'the patch');
    });
    assert.deepEqual(await search(page, mod, 'agent plan'), ['Agent plan']);
    assert.equal(await walks(), walked, 'no walk: the batch was a patch');

    await page.evaluate(async () => {
      const h = window.__h;
      h.shell.remove('/n/plan.md');
      h.shell.emit([{ kind: 'removed', path: '/n/plan.md' }]);
      await window.__until(() => !h.index.entries().some((e) => e.path === '/n/plan.md'), 'the removal');
    });
    assert.deepEqual(await search(page, mod, 'agent plan'), []);

    // A denied path never joins, though its folder is watched and the event names it.
    const denied = await page.evaluate(async () => {
      const h = window.__h;
      await h.shell.writeFileAtomic('/n/drafts/secret.md', new TextEncoder().encode('# Secret draft\n'));
      await h.shell.writeFileAtomic('/n/after.md', new TextEncoder().encode('# After\n'));
      h.shell.emit([{ kind: 'created', path: '/n/drafts/secret.md' }]);
      h.shell.emit([{ kind: 'created', path: '/n/after.md' }]);
      await window.__until(() => h.index.entries().some((e) => e.path === '/n/after.md'), 'the control file');
      return {
        listed: h.index.entries().some((e) => e.path.includes('drafts')),
        read: h.shell.calls.some((c) => c.method === 'readFile' && String(c.args[0]).includes('drafts')),
      };
    });
    assert.deepEqual(denied, { listed: false, read: false }, '**/drafts/** is denied for a patch as for a walk');

    // A change inside the nested declared folder patches both roots that hold it; the palette lists it once.
    await page.evaluate(async () => {
      const h = window.__h;
      await h.shell.writeFileAtomic('/c/docs/guide.md', new TextEncoder().encode('# Field guide\n'));
      h.shell.emit([{ kind: 'modified', path: '/c/docs/guide.md' }]);
      await window.__until(() => h.index.entries().filter((e) => e.title === 'Field guide').length === 2, 'both roots');
    });
    assert.deepEqual(await search(page, mod, 'field guide'), ['Field guide']);
  } finally {
    await browser.close();
  }
});

test('C-11: one changed file prepares one row, not the whole index; a burst of 20 events writes the snapshot once', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 760 } });
    const mod = await bootWatched(page, watchedFiles());
    const rows = await page.evaluate(async () => {
      const h = window.__h;
      const stats = window.marxyPaletteBoot.prepareStats;
      const before = stats.prepareRow;
      await h.shell.writeFileAtomic('/n/notes.md', new TextEncoder().encode('# Notes in n, revised\n'));
      h.shell.emit([{ kind: 'modified', path: '/n/notes.md' }]);
      await window.__until(() => h.palette.feed.entries().some((e) => e.title === 'Notes in n, revised'), 'the patch');
      return { prepared: stats.prepareRow - before, scope: h.palette.feed.entries().length };
    });
    assert.equal(rows.prepared, 1, `one row, of ${rows.scope}`);
    assert.ok(rows.scope > 1);
    assert.deepEqual(await search(page, mod, 'revised'), ['Notes in n, revised']);

    const writes = await page.evaluate(async () => {
      const h = window.__h;
      await h.index.settled();
      const snapshotWrites = () => h.shell.calls.filter((c) => c.method === 'writeFileAtomic' && String(c.args[0]).startsWith('/data/index-')).length;
      const before = snapshotWrites();
      // Twenty files, each its own batch and its own patch.
      for (let i = 0; i < 20; i++) {
        const path = `/n/burst-${i}.md`;
        await h.shell.writeFileAtomic(path, new TextEncoder().encode(`# Burst ${i}\n`));
        h.shell.emit([{ kind: 'created', path }]);
        await window.__until(() => h.index.entries().some((e) => e.path === path), path);
      }
      await h.index.settled();
      return snapshotWrites() - before;
    });
    assert.equal(writes, 1, 'twenty patches, one snapshot write');
  } finally {
    await browser.close();
  }
});

test('C-11: a folder the shell refuses to watch says so in the palette, and summoning the palette walks it again once', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 760 } });
    const mod = await bootWatched(page, watchedFiles(), { refuseTreeWatch: true });
    const count = () => page.evaluate(() => ({
      walksOfN: window.__h.shell.calls.filter((c) => c.method === 'mark' && c.args[0] === 'index_loaded' && String(c.args[2]).includes('root=/n ')).length,
      readDirOfN: window.__h.shell.calls.filter((c) => c.method === 'readDir' && c.args[0] === '/n').length,
    }));
    const before = await count();
    await page.keyboard.press(`${mod}+KeyP`);
    await page.waitForSelector('#marxy-palette[open]');
    const notice = await page.$eval('#marxy-palette .marxy-palette-notice', (el) => (el.hidden ? null : el.textContent));
    assert.ok(notice?.includes('Not watching n; rescanned when you open the palette.'), `notice: ${notice}`);
    assert.ok(notice?.includes('Not watching c; rescanned when you open the palette.'), `notice: ${notice}`);
    await page.evaluate(() => window.__h.index.settled());
    const after = await count();
    await page.keyboard.press('Escape');
    assert.equal(after.walksOfN, before.walksOfN + 1, `one revalidation walk of /n: ${JSON.stringify({ before, after })}`);
    assert.equal(after.readDirOfN, before.readDirOfN + 1, 'its listing read once more');
  } finally {
    await browser.close();
  }
});

test('C-11: a folder that leaves collection.toml but stays a recent root keeps its entries and stops being watched', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 760 } });
    const files = {
      '/c/.git/HEAD': enc('ref: refs/heads/main\n'),
      '/c/README.md': enc('# Home\n'),
      '/n/notes.md': enc('# Notes in n\n'),
      '/collection.toml': enc('[[root]]\npath = "/n"\n'),
    };
    const mod = await bootWatched(page, files);
    const first = await page.evaluate(() => [...window.__h.trees.trees()].sort());
    // Reading a file in /n from the palette makes /n a recent root; then back to /c.
    for (const [query, path] of [['notes in n', '/n/notes.md'], ['home', '/c/README.md']]) {
      await page.keyboard.press(`${mod}+KeyP`);
      await page.waitForSelector('#marxy-palette[open]');
      await page.fill('#marxy-palette .marxy-palette-query', query);
      await page.keyboard.press('Enter');
      await page.waitForFunction((p) => window.__h.currentPath() === p, path);
    }
    const trees = await page.evaluate(async (first) => {
      const h = window.__h;
      if (!h.palette.session.recentRoots.includes('/n')) throw new Error(`not recent: ${h.palette.session.recentRoots}`);
      // /n leaves the file but stays in scope as a recent root: it stays held and loses its watch.
      await h.shell.writeFileAtomic('/collection.toml', new TextEncoder().encode('# nothing\n'));
      h.shell.emit([{ kind: 'modified', path: '/collection.toml' }]);
      await h.collection.settled();
      await h.trees.settled();
      return {
        first,
        then: [...h.trees.trees()].sort(),
        watched: h.index.isWatched('/n'),
        held: h.index.entries().some((e) => e.path === '/n/notes.md'),
      };
    }, first);
    assert.deepEqual(trees.first, ['/c', '/n']);
    assert.deepEqual(trees.then, ['/c']);
    assert.equal(trees.watched, false);
    assert.equal(trees.held, true);
  } finally {
    await browser.close();
  }
});

test('C-11: a change to the open document, heard by its folder watch and its tree watch, reloads it once', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 760 } });
    await bootWatched(page, watchedFiles());
    const seen = await page.evaluate(async () => {
      const h = window.__h;
      const reloads = () => h.shell.calls.filter((c) => c.method === 'mark' && c.args[0] === 'live_reload').length;
      const before = reloads();
      await h.shell.writeFileAtomic('/c/README.md', new TextEncoder().encode('# Home, rewritten\n\nBy an agent.\n'));
      h.shell.emit([{ kind: 'renamed', path: '/c/README.md' }]);
      await window.__until(() => reloads() > before, 'the reload');
      await window.__until(() => h.index.entries().some((e) => e.title === 'Home, rewritten'), 'the patch');
      await h.index.settled();
      return { reloads: reloads() - before, text: document.getElementById('doc').textContent };
    });
    assert.equal(seen.reloads, 1);
    assert.ok(seen.text.includes('By an agent.'));
  } finally {
    await browser.close();
  }
});
