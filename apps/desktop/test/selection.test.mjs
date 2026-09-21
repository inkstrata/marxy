// Rendered selection: corpus resolve property, clicks, keys, re-render, text drag (MARXY-41).

import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { after, before, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { build } from 'vite';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { parseMarkdown } from '../../../packages/core/src/parse/parse.ts';
import { sectionRange } from '../../../packages/core/src/sourcemap/section.ts';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip }, fn);

const repoRoot = new URL('../../../', import.meta.url).pathname;
const appRoot = new URL('..', import.meta.url).pathname;
const corpusDir = join(repoRoot, 'fixtures', 'corpus');
const corpusFiles = readdirSync(corpusDir).filter((f) => f.endsWith('.md'));
const outDir = mkdtempSync(join(tmpdir(), 'marxy-selection-'));
let server;
let base;

const SKIP_REPARS_TYPES = new Set([
  'taskMarker', 'footnoteReference', 'hardBreak', 'softBreak', 'tableRow', 'tableCell', 'listItem',
  'link', 'image',
]);
const BLOCK_TYPES = new Set([
  'heading', 'paragraph', 'blockquote', 'list', 'listItem', 'codeBlock', 'htmlBlock',
  'thematicBreak', 'table', 'tableRow', 'tableCell', 'mathBlock', 'footnoteDefinition', 'frontmatter',
]);

before(async () => {
  if (skip) return;
  await build({ root: appRoot, logLevel: 'silent', build: { outDir, emptyOutDir: true } });
  await build({
    configFile: false,
    root: appRoot,
    logLevel: 'silent',
    build: {
      lib: {
        entry: resolve(appRoot, 'src/selection/harness-entry.ts'),
        formats: ['iife'],
        name: 'MarxySelectionHarness',
        fileName: 'selection-harness',
      },
      outDir: join(outDir, 'sel'),
      emptyOutDir: true,
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
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}/`;
});
after(() => server?.close());

function b64(path) {
  return readFileSync(path).toString('base64');
}

async function boot(page, files, argv) {
  await page.goto(`${base}app.html`);
  await page.waitForFunction(() => typeof window.marxyApp?.start === 'function');
  await page.addScriptTag({ url: `${base}sel/selection-harness.iife.js` });
  await page.waitForFunction(() => window.__marxySelectionHarnessPatched === true);
  await page.evaluate(async ({ files, argv }) => {
    const handle = await window.marxyApp.start(files, argv);
    await handle.ready;
    window.__marxyTestHandle = handle;
  }, { files, argv });
  await page.waitForFunction(() => window.marxySelection?.parseMarkdown);
}

async function runCorpusProperty(page, { brokenResolve = false } = {}) {
  return page.evaluate(async ({ skipTypes, blockTypes, brokenResolve }) => {
    const api = window.marxySelection;
    const { parseMarkdown, textOf, sectionRange: secRange, createBuffer } = api;
    const handle = window.__marxyTestHandle;
    const article = document.getElementById('doc');
    if (!handle?.state?.document || !api || !article) return { failures: ['harness not ready'] };

    const { ast, nodeMap } = handle.state.document;
    const bytes = await handle.shell.readFile(ast.path);
    const buffer = createBuffer(ast.path, bytes);

    const resolveFn = (el, map) => {
      const hit = api.resolve(el, map);
      if (!hit || !brokenResolve) return hit;
      if (hit.node.type === 'paragraph' && hit.node.children?.[0]) {
        return { node: hit.node.children[0], range: hit.node.children[0].src };
      }
      if (hit.node.type !== 'paragraph') {
        return { node: { type: 'paragraph', src: hit.range, children: [hit.node] }, range: hit.range };
      }
      return hit;
    };

    const failures = [];
    const checkReparse = (range, nodeType) => {
      if (skipTypes.includes(nodeType)) return;
      try {
        textOf(buffer, range);
      } catch (e) {
        failures.push(`textOf ${nodeType} @${range.start}: ${e}`);
        return;
      }
      const slice = bytes.subarray(range.start, range.end);
      const doc = parseMarkdown(slice, { file: 'slice.md' });
      if (blockTypes.includes(nodeType)) {
        if (doc.children[0]?.type !== nodeType) failures.push(`re-parse block ${nodeType} got ${doc.children[0]?.type}`);
        return;
      }
      const para = doc.children[0];
      if (para?.type !== 'paragraph' || !para.children?.some((c) => c.type === nodeType)) {
        failures.push(`re-parse inline ${nodeType} got ${para?.type}/${para?.children?.[0]?.type}`);
      }
    };

    for (const el of article.querySelectorAll('[data-marxy-s]')) {
      const hit = resolveFn(el, nodeMap);
      if (!hit) {
        failures.push(`miss ${el.outerHTML.slice(0, 60)}`);
        continue;
      }
      if (String(hit.node.src.start) !== el.getAttribute('data-marxy-s') && hit.node.type !== 'codeBlock') {
        failures.push(`src mismatch on ${el.tagName} ${hit.node.src.start} vs ${el.getAttribute('data-marxy-s')}`);
      }
      checkReparse(hit.range, hit.node.type);
    }

    const walkHeadings = (node, out) => {
      if (node.type === 'heading') out.push(node);
      for (const c of node.children ?? []) walkHeadings(c, out);
    };
    const headings = [];
    walkHeadings(ast, headings);
    for (const h of headings) {
      const range = secRange(ast, h);
      checkReparse(range, 'heading');
    }

    checkReparse({ file: ast.path, start: ast.src.start, end: ast.src.end }, ast.children[0]?.type ?? 'paragraph');

    return { failures, count: article.querySelectorAll('[data-marxy-s]').length };
  }, { skipTypes: [...SKIP_REPARS_TYPES], blockTypes: [...BLOCK_TYPES], brokenResolve });
}

test('corpus property: resolve, textOf, and re-parse for every provenance element', async () => {
  const browser = await launchWebkit();
  try {
    for (const file of corpusFiles) {
      const bytes = readFileSync(join(corpusDir, file));
      if (bytes.length === 0) continue;
      const docPath = `/corpus/${file}`;
      const page = await browser.newPage({ viewport: { width: 960, height: 900 } });
      try {
        await boot(page, { [docPath]: b64(join(corpusDir, file)) }, [docPath]);
      } catch (e) {
        throw new Error(`${file}: boot failed — ${e}`);
      }
      const props = await runCorpusProperty(page);
      assert.equal(props.failures.length, 0, `${file}: ${props.failures.slice(0, 5).join('; ')}`);
      assert.ok(props.count > 0, `${file}: expected provenance elements`);
      await page.close();
    }
  } finally {
    await browser.close();
  }
});

test('corpus property fails when resolve is neutralised to the parent', async () => {
  const file = '09-gfm-everything.md';
  const docPath = `/corpus/${file}`;
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 900 } });
    await boot(page, { [docPath]: b64(join(corpusDir, file)) }, [docPath]);
    const props = await runCorpusProperty(page, { brokenResolve: true });
    assert.ok(props.failures.length > 0, 'neutralised resolve should fail the property');
  } finally {
    await browser.close();
  }
});

test('clicking a paragraph selects it; a link opens externally; Alt+click selects the link', async () => {
  const docPath = '/corpus/09-gfm-everything.md';
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 900 } });
    await boot(page, { [docPath]: b64(join(corpusDir, '09-gfm-everything.md')) }, [docPath]);
    await page.locator('#doc p[data-marxy-s]').first().click();
    assert.equal(await page.locator('#doc p.marxy-selected').count(), 1);
    const link = page.locator('#doc a[href="https://example.invalid/"]').first();
    await link.click();
    const external = await page.evaluate(() =>
      window.__marxyTestHandle.shell.calls.filter((c) => c.method === 'openExternal'),
    );
    assert.ok(external.length >= 1);
    assert.equal(await page.locator('#doc a.marxy-selected').count(), 0);
    await link.click({ modifiers: ['Alt'] });
    assert.equal(await page.locator('#doc a.marxy-selected').count(), 1);
  } finally {
    await browser.close();
  }
});

test('Alt+ArrowDown and Alt+Shift+ArrowUp move structured selection; Esc clears', async () => {
  const source = '- one\n- two\n';
  const docPath = '/list.md';
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 800 } });
    await boot(page, { [docPath]: Buffer.from(source, 'utf8').toString('base64') }, [docPath]);
    await page.evaluate(() => {
      const li = document.querySelector('#doc li[data-marxy-s]');
      li?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const kind0 = await page.evaluate(() => window.marxySelection.getSelectionState().selection.node?.type);
    assert.equal(kind0, 'listItem');
    await page.keyboard.press('Alt+ArrowDown');
    const down = await page.evaluate(() => window.marxySelection.getSelectionState().selection);
    assert.equal(down.kind, 'node');
    assert.equal(down.node?.type, 'listItem');
    await page.keyboard.press('Alt+Shift+ArrowUp');
    const up = await page.evaluate(() => window.marxySelection.getSelectionState().selection);
    assert.equal(up.kind, 'node');
    assert.equal(up.node?.type, 'list');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#doc .marxy-selected').count(), 0);
  } finally {
    await browser.close();
  }
});

test('selection survives a re-render with unchanged bytes', async () => {
  const docPath = '/corpus/02-readme-real-world.md';
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 900 } });
    await boot(page, { [docPath]: b64(join(corpusDir, '02-readme-real-world.md')) }, [docPath]);
    const para = page.locator('#doc p[data-marxy-s]').first();
    await para.click();
    const before = await para.evaluate((el) => el.getAttribute('data-marxy-s'));
    await page.evaluate(() => window.marxySelection.rerenderWithSameHtml());
    const after = await page.locator('#doc p.marxy-selected').first().evaluate((el) => el.getAttribute('data-marxy-s'));
    assert.equal(after, before);
  } finally {
    await browser.close();
  }
});

test('a text drag stays kind text and never becomes structured', async () => {
  const source = 'First paragraph here.\n\nSecond paragraph there.\n';
  const docPath = '/two-para.md';
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 800 } });
    await boot(page, { [docPath]: Buffer.from(source, 'utf8').toString('base64') }, [docPath]);
    const first = page.locator('#doc p[data-marxy-s]').first();
    const second = page.locator('#doc p[data-marxy-s]').nth(1);
    const a = await first.boundingBox();
    const b = await second.boundingBox();
    assert.ok(a && b);
    await page.mouse.move(a.x + 4, a.y + 4);
    await page.mouse.down();
    await page.mouse.move(b.x + 4, b.y + 4, { steps: 8 });
    await page.mouse.up();
    const sel = await page.evaluate(() => window.marxySelection.getSelectionState().selection);
    assert.equal(sel.kind, 'text');
    assert.ok(sel.text.includes('First') || sel.text.includes('Second'));
  } finally {
    await browser.close();
  }
});

nodeTest('sectionRange sanity on a sample corpus file', () => {
  const bytes = readFileSync(join(corpusDir, '09-gfm-everything.md'));
  const doc = parseMarkdown(bytes, { file: '09-gfm-everything.md' });
  const walk = (node, out) => {
    if (node.type === 'heading') out.push(node);
    for (const c of node.children ?? []) walk(c, out);
  };
  const headings = [];
  walk(doc, headings);
  assert.ok(headings.length > 3);
  for (const h of headings) {
    const range = sectionRange(doc, h);
    assert.equal(range.start, h.src.start);
  }
});
