// A PDF or an image opened on its own (the launch's file, as from Explorer) brings its folder into Places and the
// crumbs, as a text file does: no Loose group, and the crumbs start with the folder's name, not a bare `/`.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test as nodeTest } from 'node:test';
import { b64, closeHarness, harnessBase, routeSkeleton } from './support/two-pane.mjs';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { drawerShows, skip, withFrame } from './support/frame.mjs';

const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);
after(() => closeHarness());

const demo = join(fileURLToPath(new URL('../../../', import.meta.url)), 'fixtures', 'demo');
const PDF = '/r/reading/the-case-for-ragged-lines.pdf';
const PNG = '/r/images/tide-chart.png';
const FILES = {
  [PDF]: readFileSync(join(demo, 'reading', 'the-case-for-ragged-lines.pdf')),
  '/r/reading/notes.md': '# Notes\n',
  [PNG]: readFileSync(join(demo, 'images', 'tide-chart.png')),
  '/r/images/other.png': readFileSync(join(demo, 'images', 'tidemark-icon.png')),
};

const crumbs = (page) =>
  page.evaluate(() => [...document.querySelectorAll('[data-marxy-head="0"] .marxy-crumb')].filter((c) => !c.hidden).map((c) => `${c.dataset.marxyCrumb}:${c.textContent}`));

for (const [path, viewer, folder, sibling] of [
  [PDF, 'pdf', 'reading', '/r/reading/notes.md'],
  [PNG, 'image', 'images', '/r/images/other.png'],
]) {
  test(`a ${viewer} opened on its own is in its folder: Places lists it with its neighbours and the crumbs start at the folder`, async () => {
    await withFrame({ files: FILES, open: [path] }, async (page, { mod }) => {
      await page.waitForFunction((v) => document.querySelector('[data-marxy-viewer]')?.getAttribute('data-marxy-viewer') === v, viewer, { timeout: 30000 });
      await page.keyboard.press(`${mod}+Shift+E`);
      await drawerShows(page, 'places');
      const row = (key) => page.locator(`.marxy-drawer .marxy-l-prow[data-marxy-left-row="${key}"]`);
      await row(`f:${sibling}`).waitFor();
      await row(`f:${path}`).waitFor();
      assert.equal(await row('g:loose').count(), 0, 'no Loose group');
      assert.doesNotMatch(await page.innerText('.marxy-drawer'), /Loose/);
      await page.waitForFunction((f) => document.querySelector('[data-marxy-head="0"] .marxy-crumb')?.textContent === f, folder);
      const steps = await crumbs(page);
      assert.deepEqual(steps, [`root:${folder}`, `file:${path.split('/').pop()}`]);
    });
  });
}

test('a PDF opened over a text file in another folder brings its own folder: Places lists its neighbour, the crumbs start at its folder', async () => {
  const files = {
    '/r/a/notes.md': '# Notes\n',
    '/r/b/paper.pdf': FILES[PDF],
    '/r/b/other.md': '# Other\n',
  };
  await withFrame({ files, open: ['/r/a/notes.md'] }, async (page, { mod }) => {
    // The path the palette and a Places click take.
    await page.evaluate(() => window.__marxyHandle.panes().openIn(0, '/r/b/paper.pdf'));
    await page.waitForFunction(() => document.querySelector('[data-marxy-viewer]')?.getAttribute('data-marxy-viewer') === 'pdf', null, { timeout: 30000 });
    await page.keyboard.press(`${mod}+Shift+E`);
    await drawerShows(page, 'places');
    await page.locator('.marxy-drawer .marxy-l-prow[data-marxy-left-row="f:/r/b/other.md"]').waitFor();
    assert.equal(await page.locator('.marxy-drawer .marxy-l-prow[data-marxy-left-row="g:loose"]').count(), 0);
    await page.waitForFunction(() => document.querySelector('[data-marxy-head="0"] .marxy-crumb')?.textContent === 'b');
    assert.deepEqual(await crumbs(page), ['root:b', 'file:paper.pdf']);
  });
});

test('closing the tab of a repository nothing else shows lets the index go of it; the other stays', async () => {
  const files = {
    '/a/.git/HEAD': 'ref: refs/heads/main\n',
    '/a/x.md': '# X\n',
    '/b/.git/HEAD': 'ref: refs/heads/main\n',
    '/b/y.md': '# Y\n',
  };
  await withFrame({ files, open: ['/a/x.md'] }, async (page) => {
    const roots = () => page.evaluate(() => [...window.__marxyHandle.index.roots()].sort());
    await page.waitForFunction(() => window.__marxyHandle.index.roots().includes('/a'));
    await page.evaluate(() => window.__marxyHandle.panes().openIn(0, '/b/y.md'));
    await page.waitForFunction(() => window.__marxyHandle.index.roots().includes('/b'));
    assert.deepEqual(await roots(), ['/a', '/b']);
    // Alt+W closes the current tab (/b/y.md); /a/x.md is the document again.
    await page.keyboard.press('Alt+W');
    await page.waitForFunction(() => !window.__marxyHandle.index.roots().includes('/b'), null, { timeout: 15000 });
    assert.deepEqual(await roots(), ['/a']);
  });
});

test('a folder that cannot be listed leaves the launched PDF shown and the layout restored', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const base = await harnessBase();
    await routeSkeleton(page, base);
    await page.goto(`${base}app.html`);
    await page.waitForFunction(() => typeof window.marxyApp?.start === 'function');
    const encoded = Object.fromEntries(Object.entries(FILES).map(([path, bytes]) => [path, b64(bytes)]));
    const result = await page.evaluate(async ({ files, path }) => {
      const bytes = {};
      for (const [p, e] of Object.entries(files)) bytes[p] = Uint8Array.from(atob(e), (c) => c.charCodeAt(0));
      const { createMemoryShell } = await import('/src/shell/memory.ts');
      const { bootApplication } = await import('/src/main.ts');
      const shell = createMemoryShell(bytes);
      const readDir = shell.readDir.bind(shell);
      shell.readDir = async (dir) => {
        if (dir === '/r/reading' || dir === '/r') throw new Error('listing refused');
        return readDir(dir);
      };
      const handle = await bootApplication(shell, { argv: [path] });
      await handle.ready;
      window.__marxyHandle = handle;
      return { viewer: document.querySelector('[data-marxy-viewer]')?.getAttribute('data-marxy-viewer') ?? null, doc: document.querySelector('#doc')?.textContent ?? '' };
    }, { files: encoded, path: PDF });
    assert.equal(result.viewer, 'pdf');
    assert.doesNotMatch(result.doc, /listing refused/);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
