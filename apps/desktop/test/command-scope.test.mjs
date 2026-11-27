// The shell's scope as the reader meets it: the path commands answer only for files the reader opened, folders they
// chose and Marxy's own (src-tauri/src/scope.rs). Booted on the shipped skeleton over a memory shell that models the
// scope, so each open route (the launch, the restored layout, an open from history, Save as, Compare) is seen to tell the
// shell before it reads, and what the index reads is seen never to become served.
import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { after, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { b64, closeHarness, harnessBase, shippedSkeleton } from './support/two-pane.mjs';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip }, fn);
after(() => closeHarness());

const doc = (word) => `# ${word}\n\n${word} is a short page with one paragraph of text.\n`;
const WIDE = { width: 1470, height: 700 };

async function withPage(fn) {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: WIDE });
    const base = await harnessBase();
    const { style, body } = shippedSkeleton();
    await page.route(`${base}app.html`, async (route) => {
      const response = await route.fetch();
      const html = (await response.text())
        .replace('</head>', `<style>${style}</style></head>`)
        .replace(/<body[^>]*>/, '<body data-marxy-mode="rendered" data-marxy-variant="dark">')
        .replace('<article id="doc" class="marxy-article"></article>', body);
      await route.fulfill({ response, body: html });
    });
    await page.goto(`${base}app.html`);
    await page.waitForFunction(() => typeof window.marxyApp?.start === 'function');
    await fn(page);
  } finally {
    await browser.close();
  }
}

/**
 * Starts the app over a scoped memory shell holding `files` (path to text, or `{ b64 }` for bytes), with `argv`. With
 * `entries`, the whole app with its Line is booted (`bootApplication`) and given those index entries.
 */
async function start(page, files, argv, entries = null) {
  const encoded = Object.fromEntries(Object.entries(files).map(([path, f]) => [path, typeof f === 'string' ? b64(f) : f.b64]));
  await page.evaluate(
    async ({ encoded, argv, entries }) => {
      const bytes = {};
      for (const [path, e] of Object.entries(encoded)) bytes[path] = Uint8Array.from(atob(e), (c) => c.charCodeAt(0));
      const { createMemoryShell } = await import('/src/shell/memory.ts');
      const shell = createMemoryShell(bytes, { scoped: true });
      let handle;
      if (entries) {
        const { bootApplication } = await import('/src/main.ts');
        handle = await bootApplication(shell, { argv });
      } else {
        const { startApp } = await import('/src/app.ts');
        handle = await startApp(shell, { argv });
      }
      await handle.ready;
      window.__marxyHandle = handle;
      if (entries) handle.palette.setIndexEntries(entries);
    },
    { encoded, argv, entries },
  );
}

/** What the shell answers the page for `method(...args)`: 'ok', or the refusal's code. `'bytes'` stands for a byte. */
const answer = (page, method, ...args) =>
  page.evaluate(async ({ method, args }) => {
    try {
      await window.__marxyHandle.shell[method](...args.map((a) => (a === 'bytes' ? new Uint8Array([1]) : a)));
      return 'ok';
    } catch (e) {
      return e?.code ?? String(e);
    }
  }, { method, args });

const headings = (page) => page.evaluate(() => [...document.querySelectorAll('.marxy-pane h1')].map((h) => h.textContent.trim()));

const files = {
  '/notes/plan.md': doc('Plan'),
  '/notes/draft.md': doc('Draft'),
  '/elsewhere/other.md': doc('Other'),
  '/private/secret.md': doc('Secret'),
};

test('the launch file and its folder are read; a folder nobody chose is refused', async () => {
  await withPage(async (page) => {
    await start(page, files, ['/notes/plan.md']);
    assert.deepEqual(await headings(page), ['Plan']);
    assert.equal(await answer(page, 'readHead', '/notes/plan.md', 4), 'ok');
    // The document's folder is its index root: the reader chose it by opening a file there.
    await page.evaluate(() => window.__marxyHandle.index.settled());
    assert.equal(await answer(page, 'readHead', '/notes/draft.md', 4), 'ok');
    assert.equal(await answer(page, 'readFile', '/private/secret.md'), 'outside');
    assert.equal(await answer(page, 'readDir', '/private'), 'outside');
    assert.equal(await answer(page, 'writeFileAtomic', '/private/secret.md', 'bytes'), 'outside');
    // Marxy's own folders are always there to read and write.
    assert.equal(await answer(page, 'writeFileAtomic', '/data/probe.json', 'bytes'), 'ok');
  });
});

test('what the index read is not served: past its head, an indexed file is the reader\'s to open first', async () => {
  await withPage(async (page) => {
    await start(page, files, ['/notes/plan.md']);
    await page.evaluate(() => window.__marxyHandle.index.settled());
    assert.equal(await answer(page, 'readHead', '/notes/draft.md', 4), 'ok', 'the index may read it');
    assert.equal(await answer(page, 'readRange', '/notes/draft.md', 0, 4), 'refused', 'but marxy-file does not serve it');
    await page.evaluate(() => window.__marxyHandle.open('/notes/draft.md'));
    assert.deepEqual(await headings(page), ['Draft']);
    assert.equal(await answer(page, 'readRange', '/notes/draft.md', 0, 4), 'ok', 'opened, it is served');
  });
});

test('the restored layout is what comes back into scope, and nothing else from before the restart', async () => {
  await withPage(async (page) => {
    const layout = JSON.stringify({
      version: 1,
      columns: [{ path: '/notes/plan.md', mode: 'rendered' }, { path: '/elsewhere/other.md', mode: 'rendered' }],
      ratio: 0.5,
      focused: 0,
    });
    await start(page, { ...files, '/data/layout.json': layout }, []);
    await page.waitForFunction(() => document.querySelectorAll('.marxy-pane h1').length === 2);
    assert.deepEqual((await headings(page)).sort(), ['Other', 'Plan']);
    assert.equal(await answer(page, 'readHead', '/elsewhere/other.md', 4), 'ok');
    assert.equal(await answer(page, 'readRange', '/elsewhere/other.md', 0, 4), 'ok');
    assert.equal(await answer(page, 'readFile', '/private/secret.md'), 'outside');
  });
});

test('a file from history opens through the open path, which tells the shell first', async () => {
  await withPage(async (page) => {
    await start(page, files, ['/notes/plan.md']);
    assert.equal(await answer(page, 'readHead', '/private/secret.md', 4), 'outside');
    await page.evaluate(() => window.__marxyHandle.open('/private/secret.md'));
    assert.deepEqual(await headings(page), ['Secret']);
    assert.equal(await answer(page, 'readHead', '/private/secret.md', 4), 'ok');
    // A gone file the reader asks for says it is gone, not that it is out of reach.
    await page.evaluate(() => window.__marxyHandle.open('/private/gone.md'));
    assert.equal(await answer(page, 'readFile', '/private/gone.md'), 'not-found');
  });
});

test('Save as writes where the reader chose, and Fork beside the opened file', async () => {
  await withPage(async (page) => {
    await start(page, files, ['/elsewhere/other.md']);
    const saved = await page.evaluate(async () => {
      const h = window.__marxyHandle;
      h.shell.queueSaveDialog('/private/copy.md');
      await h.save({ as: true });
      return h.shell.hasFile('/private/copy.md');
    });
    assert.equal(saved, true, 'the Save as name was written');
    assert.equal(await answer(page, 'writeFileNew', '/private/copy (fork).md', 'bytes'), 'ok');
    assert.equal(await answer(page, 'writeFileNew', '/nobody/x.md', 'bytes'), 'outside');
  });
});

// A 1x1 PNG: bytes that are not text.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
const entry = (path, title, size, extra = {}) => ({ path, root: path.slice(0, path.lastIndexOf('/')), title, headings: [], mtimeMs: 1_700_000_000_000, size, kind: 'markdown', readerKind: 'article', ...extra });

test("the Line previews an indexed image the reader has not opened, and says so plainly of a file outside every folder", async () => {
  await withPage(async (page) => {
    page.setDefaultTimeout(15_000);
    const entries = [
      entry('/notes/plan.md', 'Plan', 60),
      entry('/notes/pic.png', 'pic.png', 70, { kind: 'image', readerKind: undefined }),
      entry('/private/secret.md', 'Secret', 60),
    ];
    await start(page, { ...files, '/notes/pic.png': { b64: PNG } }, ['/notes/plan.md'], entries);
    await page.evaluate(() => window.__marxyHandle.index.settled());
    const aside = (t) => page.waitForFunction((t) => (document.querySelector('#marxy-palette .marxy-palette-aside')?.textContent ?? '').includes(t), t);
    await page.keyboard.press('ControlOrMeta+KeyP');
    await page.waitForSelector('#marxy-palette[open] .marxy-palette-row');
    await page.locator('#marxy-palette .marxy-palette-query').fill('pic.png');
    await aside('Not text, so there is nothing to show');
    // Previewing reads its head and nothing else: it is not opened, so it is not served.
    assert.equal(await answer(page, 'readRange', '/notes/pic.png', 0, 4), 'refused');
    await page.locator('#marxy-palette .marxy-palette-query').fill('Secret');
    await aside('Not opened since Marxy started');
  });
});

test('a file renamed on disk while edited saves at its new name', async () => {
  await withPage(async (page) => {
    await start(page, files, ['/notes/plan.md']);
    const result = await page.evaluate(async () => {
      const h = window.__marxyHandle;
      const snap = h.document().snapshot();
      await h.dispatch({ type: 'apply', range: { start: 0, end: 0 }, replacement: 'X', label: 'edit', baseVersion: snap.version });
      // Another program renames the file: its bytes appear at the new name and the old one goes.
      h.shell.plant('/notes/moved.md', snap.buffer.bytes);
      h.shell.remove('/notes/plan.md');
      h.shell.emit([{ kind: 'renamed', path: '/notes/plan.md', to: '/notes/moved.md' }]);
      for (let i = 0; i < 100 && h.currentPath() !== '/notes/moved.md'; i++) await new Promise((r) => setTimeout(r, 20));
      const saved = await h.save();
      return { path: h.currentPath(), saved: typeof saved === 'string' ? saved : saved?.kind ?? JSON.stringify(saved), text: new TextDecoder().decode(await h.shell.readFile('/notes/moved.md')) };
    });
    assert.equal(result.path, '/notes/moved.md');
    assert.ok(result.text.startsWith('X# Plan'), `saved at the new name: ${JSON.stringify(result)}`);
  });
});

test('the folders above an opened text file are listed once the reader goes up to them, and a sibling folder too', async () => {
  await withPage(async (page) => {
    const tree = {
      '/home/proj/docs/a.txt': 'plain text two levels down\n',
      '/home/proj/readme.txt': 'beside docs\n',
      '/home/other/b.txt': 'in a sibling folder\n',
    };
    await start(page, tree, ['/home/proj/docs/a.txt'], []);
    // Its own folder is listed for any kind of file, before anything else is chosen.
    assert.equal(await answer(page, 'readDir', '/home/proj/docs'), 'ok');
    assert.equal(await answer(page, 'readDir', '/home'), 'outside', 'nothing above is listed until the reader goes there');
    const names = () => page.evaluate(() => [...document.querySelectorAll('.marxy-folderpage-name')].map((c) => c.textContent));
    // The crumb's folder page, as a press on `home/` opens it.
    await page.evaluate(async () => {
      const { openFolderPage } = await import('/src/frame/folder-page.ts');
      await openFolderPage(window.__marxyHandle, '/home');
    });
    await page.waitForFunction(() => document.querySelectorAll('.marxy-folderpage-name').length >= 2);
    assert.deepEqual((await names()).sort(), ['other/', 'proj/']);
    await page.locator('.marxy-folderpage-name', { hasText: 'other/' }).click();
    await page.waitForFunction(() => [...document.querySelectorAll('.marxy-folderpage-name')].some((c) => c.textContent === 'b.txt'));
    assert.deepEqual(await names(), ['b.txt']);
    assert.equal(await answer(page, 'writeFileAtomic', '/home/other/b.txt', 'bytes'), 'outside', 'going there lets the reader read it, not write it');
  });
});

test('an image folder the reader goes up to draws its pictures, and its files stay unwritable', async () => {
  await withPage(async (page) => {
    page.setDefaultTimeout(15_000);
    const tree = { '/shots/notes/a.txt': 'plain text below the photos\n' };
    for (const n of ['one', 'two', 'three']) tree[`/shots/${n}.png`] = { b64: PNG };
    await start(page, tree, ['/shots/notes/a.txt'], []);
    assert.equal(await answer(page, 'imageFacts', '/shots/one.png'), 'ok');
    assert.equal(await page.evaluate(() => window.__marxyHandle.shell.imageFacts('/shots/one.png')), null, 'nothing is served before the reader goes there');
    await page.evaluate(async () => {
      const { openFolderPage } = await import('/src/frame/folder-page.ts');
      await openFolderPage(window.__marxyHandle, '/shots');
    });
    await page.waitForFunction(() => document.querySelectorAll('.marxy-folderpage-pic canvas').length === 3);
    assert.equal(await answer(page, 'writeFileAtomic', '/shots/one.png', 'bytes'), 'outside');
  });
});
