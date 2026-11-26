// A data file whose name says little: a tsconfig.json with comments opens as a data tree, not as written lines, and a
// `.config` that is XML opens as XML with its fold saying how the kind was found, while a `.config` that is INI stays
// text. Playwright WebKit, the whole frame.
import { strict as assert } from 'node:assert';
import { after, test as nodeTest } from 'node:test';
import { fileURLToPath } from 'node:url';
import { closeHarness } from './support/two-pane.mjs';
import { skip, withFrame } from './support/frame.mjs';

// The page's own copy of the registry, by its path in this checkout, so the test runs from any worktree.
const REGISTRY = `/@fs/${fileURLToPath(new URL('../../../packages/core/src/kind/registry.ts', import.meta.url)).replaceAll('\\', '/').replace(/^\/+/, '')}`;
const test = (name, fn) => nodeTest(name, { skip, timeout: 180_000 }, fn);
after(() => closeHarness());

const TSCONFIG = Buffer.from(`{
  // Compiler settings
  "compilerOptions": {
    "target": "ES2022", /* newest we run */
    "strict": true,
  },
  "include": ["src"],
}
`);
const XML_CONFIG = Buffer.from('<?xml version="1.0"?>\n<configuration>\n  <appSettings>\n    <add key="mode" value="fast"/>\n  </appSettings>\n</configuration>\n');
const INI_CONFIG = Buffer.from('[core]\nmode = fast\n');
const FILES = { '/r/README.md': '# Here\n', '/r/tsconfig.json': TSCONFIG, '/r/site.config': XML_CONFIG, '/r/plain.config': INI_CONFIG };

const head = (page) => page.textContent('.marxy-article .marxy-reading-head');
const account = (page) => page.textContent('.marxy-article .marxy-account .marxy-account-body');

test('a tsconfig.json with comments opens as a data tree, keys in order, comments left in the file', async () => {
  await withFrame({ files: FILES, open: ['/r/tsconfig.json'] }, async (page) => {
    await page.waitForSelector('.marxy-article [data-marxy-reading="tree"]');
    assert.equal(await page.$('.marxy-article [data-marxy-reading="written"]'), null);
    assert.deepEqual(await page.$$eval('.marxy-article .marxy-tree-key', (els) => els.map((e) => e.textContent)), ['compilerOptions', 'target', 'strict', 'include']);
    assert.match(await head(page), /^JSON with comments · 2 keys at the top/);
    assert.match(await account(page), /comments or trailing commas/);
  });
});

test('a .config that is XML opens as an XML tree and says it was read from its text', async () => {
  await withFrame({ files: FILES, open: ['/r/site.config'] }, async (page) => {
    await page.waitForSelector('.marxy-article [data-marxy-reading="tree"]');
    assert.match(await head(page), /^XML, read from its text · <configuration> at the top/);
    assert.match(await account(page), /Read as XML from its text/);
    assert.deepEqual(await page.$$eval('.marxy-article .marxy-tree-key', (els) => els.map((e) => e.textContent)), ['configuration', 'appSettings', 'add']);
  });
});

test('a .config that is INI stays text', async () => {
  await withFrame({ files: FILES, open: ['/r/plain.config'] }, async (page) => {
    await page.waitForSelector('.cm-line');
    assert.equal(await page.$('.marxy-article [data-marxy-reading="tree"]'), null);
  });
});

test('a sniffed .config stays XML after an index walk re-reads its head, a reopen, and in Source', async () => {
  await withFrame({ files: FILES, open: ['/r/site.config'] }, async (page) => {
    await page.waitForSelector('.marxy-article [data-marxy-reading="tree"]');
    // What the index walk does to every unknown name: note its head, which says only "text".
    const id = await page.evaluate(async (registry) => {
      const { noteContent, fileTypeFor } = await import(registry);
      noteContent('/r/site.config', { class: 'text' });
      return fileTypeFor('/r/site.config').id;
    }, REGISTRY);
    assert.equal(id, 'xml');
    await page.evaluate(() => window.__marxyHandle.open('/r/README.md'));
    await page.waitForFunction(() => window.__marxyHandle.panes().panes[0].path() === '/r/README.md');
    await page.evaluate(() => window.__marxyHandle.open('/r/site.config'));
    await page.waitForSelector('.marxy-article [data-marxy-reading="tree"]');
    assert.deepEqual(await page.$$eval('.marxy-article .marxy-tree-key', (els) => els.map((e) => e.textContent)), ['configuration', 'appSettings', 'add']);
    await page.evaluate(() => window.__marxyHandle.panes().panes[0].view.setMode('source'));
    await page.waitForSelector('#marxy-source .cm-editor');
    assert.equal(await page.$eval('#marxy-source .cm-editor', (e) => e.dataset.marxyLang), 'xml');
  });
});
