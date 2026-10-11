// The launch document's kind is on the pane root before the page is first written (K-05a.1), without
// first text waiting for a read. K-05a decided it just after first text because the deciding reads (the
// `[[kind]]` rules in config.toml and kinds.json) would otherwise sit on the first-text road; a profile that
// changes the face, size or column then moves the page once after first text. Here the rules come from the
// pre-paint config read the launch makes anyway, and kinds.json is read beside the document's own read; one
// still out when the page is first written is not waited for, and decides again when it arrives.
// Booted on the shipped skeleton over the memory shell (config.toml is `/config`, kinds.json `/data/kinds.json`).
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { after, test as nodeTest } from 'node:test';
import { fileURLToPath } from 'node:url';
import { webkit } from 'playwright';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { b64, closeHarness, harnessBase, shippedSkeleton } from './support/two-pane.mjs';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip }, fn);
after(() => closeHarness());

const corpus = (name) => readFileSync(fileURLToPath(new URL(`../../../fixtures/corpus/${name}`, import.meta.url)), 'utf8');
const kindsJson = (map) => JSON.stringify({ version: 1, kinds: map });

/** What the launch is asked to show: [path, corpus file, the kind it is]. */
const launches = [
  ['/w/README.md', '02-readme-real-world.md', 'readme'],
  ['/w/essay.md', '01-long-technical.md', 'article'],
  ['/w/plan.md', '03-ai-plan.md', 'report'],
];

/**
 * Boots the app as a launch on `argv`, over a memory shell holding `files`. Before anything runs a page-side log
 * records, in order, every change to the pane root's `data-marxy-kind` and every change to the children of `#doc`
 * (one MutationObserver, so their order is the DOM's), and every frame's kind once `#doc` has content.
 * `holdKinds` keeps kinds.json unread until `window.__releaseKinds()`.
 */
async function launch(page, { files, argv, holdKinds = false }) {
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
  await page.addInitScript(() => {
    window.__log = [];
    window.__frames = [];
    window.__kindValues = [];
    const setAttribute = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function (name, value) {
      if (name === 'data-marxy-kind') window.__kindValues.push(String(value));
      return setAttribute.call(this, name, value);
    };
    document.addEventListener('DOMContentLoaded', () => {
      const pane = document.querySelector('section.marxy-pane');
      const doc = document.getElementById('doc');
      new MutationObserver((records) => {
        for (const r of records) {
          if (r.type === 'attributes') window.__log.push('kind');
          else if (r.target === doc) window.__log.push('write');
        }
      }).observe(pane, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-marxy-kind'] });
      const tick = () => {
        if (doc.childElementCount > 0) window.__frames.push(pane.getAttribute('data-marxy-kind'));
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  });
  await page.goto(`${base}app.html`);
  await page.waitForFunction(() => typeof window.marxyApp?.start === 'function');
  const encoded = Object.fromEntries(Object.entries(files).map(([path, text]) => [path, b64(text)]));
  await page.evaluate(
    async ({ files, argv, holdKinds }) => {
      const bytes = {};
      for (const [path, text] of Object.entries(files)) {
        const raw = atob(text);
        bytes[path] = Uint8Array.from(raw, (c) => c.charCodeAt(0));
      }
      const { createMemoryShell } = await import('/src/shell/memory.ts');
      const { startApp } = await import('/src/app.ts');
      const shell = createMemoryShell(bytes);
      let release = () => {};
      const held = new Promise((resolve) => { release = resolve; });
      window.__releaseKinds = release;
      window.__shell = shell;
      if (holdKinds) {
        const read = shell.readFile.bind(shell);
        shell.readFile = async (path) => (path === '/data/kinds.json' ? (await held, read(path)) : read(path));
      }
      window.__done = false;
      window.__started = startApp(shell, { argv }).then(async (handle) => {
        window.__marxyHandle = handle;
        await handle.ready;
        window.__done = true;
      });
    },
    { files: encoded, argv, holdKinds },
  );
}

const state = (page) =>
  page.evaluate(() => {
    const calls = window.__shell?.calls ?? [];
    return {
      log: window.__log,
      frames: window.__frames,
      kindValues: window.__kindValues,
      attribute: document.querySelector('section.marxy-pane').getAttribute('data-marxy-kind'),
      configReads: calls.filter((c) => c.method === 'readFile' && c.args[0] === '/config').length,
      kindsReads: calls.filter((c) => c.method === 'readFile' && c.args[0] === '/data/kinds.json').length,
      configPathsBeforeFirstText: calls.slice(0, calls.findIndex((c) => c.method === 'mark' && c.args[0] === 'first_text')).filter((c) => c.method === 'configPaths').length,
    };
  });

async function withBrowser(fn) {
  const browser = await launchWebkit();
  try {
    await fn(browser);
  } finally {
    await browser.close();
  }
}

const newPage = (browser) => browser.newPage({ viewport: { width: 1280, height: 800 } });

test('a readme, an article and a report have their kind on the pane root before #doc is first written', () =>
  withBrowser(async (browser) => {
    for (const [path, file, kind] of launches) {
      const fresh = await newPage(browser);
      await launch(fresh, { files: { [path]: corpus(file) }, argv: [path] });
      await fresh.waitForFunction(() => window.__done === true);
      const seen = await state(fresh);
      assert.equal(seen.attribute, kind, `${path}: the kind`);
      assert.deepEqual(seen.kindValues, [kind], `${path}: written once, as ${kind}`);
      assert.ok(seen.log.includes('write'), `${path}: the document was written`);
      assert.equal(seen.log[0], 'kind', `${path}: the first change in the pane is its kind, not the document (${seen.log.join(',')})`);
      assert.ok(seen.frames.length > 0 && seen.frames.every((k) => k === kind), `${path}: every frame with content has the kind (${seen.frames.join(',')})`);
      await fresh.close();
    }
  }));

test("the reader's [[kind]] rule and a kinds.json entry already decide the launch document before it is written", () =>
  withBrowser(async (browser) => {
    const config = '[[kind]]\nglob = "/ruled/**"\nis = "book"\n';
    const prose = '# Title\n\nA paragraph of plain prose, long enough to be a document and no more than that.\n';
    const cases = [
      ['/ruled/novel.md', 'book', 'a rule (from the pre-paint config read)'],
      ['/w/shown.md', 'transcript', 'a show-as entry (kinds.json, read beside the document)'],
    ];
    for (const [path, kind, why] of cases) {
      const fresh = await newPage(browser);
      await launch(fresh, { files: { [path]: prose, '/config': config, '/data/kinds.json': kindsJson({ '/w/shown.md': 'transcript' }) }, argv: [path] });
      await fresh.waitForFunction(() => window.__done === true);
      const seen = await state(fresh);
      assert.deepEqual(seen.kindValues, [kind], `${why}: written once, first`);
      assert.equal(seen.log[0], 'kind', why);
      assert.equal(seen.attribute, kind, why);
      await fresh.close();
    }
  }));

test('the launch reads config.toml once and kinds.json once, and asks the shell for its paths once, before first text', () =>
  withBrowser(async (browser) => {
    const page = await newPage(browser);
    const path = '/w/README.md';
    await launch(page, { files: { [path]: corpus('02-readme-real-world.md'), '/config': '[[kind]]\nglob = "/x/**"\nis = "book"\n' }, argv: [path] });
    await page.waitForFunction(() => window.__done === true);
    const seen = await state(page);
    assert.equal(seen.configReads, 1, 'config.toml: the pre-paint read is the only one');
    assert.equal(seen.kindsReads, 1, 'kinds.json: one read');
    assert.equal(seen.configPathsBeforeFirstText, 1, 'configPaths: asked once before first_text');
  }));

test('a kinds.json that is still being read does not hold first text; it decides again when it arrives', () =>
  withBrowser(async (browser) => {
    const page = await newPage(browser);
    const path = '/w/shown.md';
    await launch(page, {
      files: { [path]: corpus('01-long-technical.md'), '/data/kinds.json': kindsJson({ [path]: 'transcript' }) },
      argv: [path],
      holdKinds: true,
    });
    // First text is out while kinds.json is unread: the kind is detection's alone, and it is already there.
    await page.waitForFunction(() => window.__shell?.calls.some((c) => c.method === 'mark' && c.args[0] === 'first_text'));
    const early = await state(page);
    assert.equal(early.attribute, 'article', 'detection decided before the page was written');
    assert.equal(early.log[0], 'kind');
    assert.ok(early.frames.length > 0 && early.frames.every((k) => k === 'article'));
    assert.equal(await page.evaluate(() => window.__done), false, 'the launch is not settled while kinds.json is out');
    await page.evaluate(() => window.__releaseKinds());
    await page.waitForFunction(() => window.__done === true);
    const late = await state(page);
    assert.equal(late.attribute, 'transcript', 'show as decided again once it arrived');
    assert.equal(late.kindsReads, 1);
    assert.equal(late.configReads, 1);
  }));

test('a slow kinds.json with nothing for this file changes nothing after first text', () =>
  withBrowser(async (browser) => {
    const page = await newPage(browser);
    const path = '/w/essay.md';
    await launch(page, { files: { [path]: corpus('01-long-technical.md'), '/data/kinds.json': kindsJson({ '/elsewhere.md': 'log' }) }, argv: [path], holdKinds: true });
    await page.waitForFunction(() => window.__shell?.calls.some((c) => c.method === 'mark' && c.args[0] === 'first_text'));
    await page.evaluate(() => window.__releaseKinds());
    await page.waitForFunction(() => window.__done === true);
    const seen = await state(page);
    assert.deepEqual(seen.kindValues, ['article'], 'one write, ever');
    assert.equal(seen.log.filter((l) => l === 'kind').length, 1);
  }));
