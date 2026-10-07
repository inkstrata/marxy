// Per-document HTML grants, blocked-content notices and truncation (MARXY-44).
import '../src/trust/trust.test.ts';
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { build } from 'vite';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { extname } from 'node:path';
import { policyFor } from '../../../packages/core/src/sanitize/policy.ts';
import { parseMarkdown } from '../../../packages/core/src/parse/parse.ts';
import { renderDocumentSafeHtml } from '../../../packages/core/src/render/pipeline.ts';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip }, fn);

const repoRoot = new URL('../../../', import.meta.url).pathname;
const corpusDir = join(repoRoot, 'fixtures', 'corpus');
const testFixturesDir = new URL('./fixtures/', import.meta.url).pathname;
const outDir = mkdtempSync(join(tmpdir(), 'marxy-trust-'));
let server;
let base;

before(async () => {
  if (skip) return;
  await build({ root: new URL('..', import.meta.url).pathname, logLevel: 'silent', build: { outDir, emptyOutDir: true } });
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
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

function b64(path) {
  return readFileSync(path).toString('base64');
}

async function boot(page, files, argv) {
  await page.goto(`${base}app.html`);
  await page.waitForFunction(() => typeof window.marxyApp?.start === 'function');
  return page.evaluate(async ({ files, argv }) => {
    const handle = await window.marxyApp.start(files, argv);
    await handle.ready;
    window.__marxyHandle = handle;
    return handle;
  }, { files, argv });
}

function noticeTexts(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('#marxy-notices .marxy-notice-text')].map((el) => el.textContent ?? ''),
  );
}

function noticeActions(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('#marxy-notices .marxy-notice-action')].map((el) => el.textContent ?? ''),
  );
}

test('10-hostile.md: one notice naming example.invalid once (MARXY-138 parity)', async () => {
  const docPath = '/corpus/10-hostile.md';
  const files = { [docPath]: b64(join(corpusDir, '10-hostile.md')) };
  const browser = await webkit.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 800 } });
    await boot(page, files, [docPath]);
    const out = await page.evaluate(() => {
      const region = document.getElementById('marxy-notices');
      const lines = region ? [...region.querySelectorAll('.marxy-notice-text')].map((el) => el.textContent ?? '') : [];
      const article = document.getElementById('doc')?.textContent ?? '';
      return { lines, article };
    });
    assert.equal(out.lines.length, 1);
    assert.equal([...out.lines[0].matchAll(/example\.invalid/g)].length, 1);
    assert.doesNotMatch(out.article, /example\.invalid/);
  } finally {
    await browser.close();
  }
});

nodeTest('javascript: inside details is stripped under WIDE_POLICY (MARXY-229 vector cited, not re-tested here)', () => {
  const html = '<details><a href="javascript:alert(1)">x</a></details>';
  const ast = parseMarkdown(html, { file: '/t.md' });
  const { html: out } = renderDocumentSafeHtml(ast, policyFor({ html: true }));
  assert.match(out, /<details/);
  assert.doesNotMatch(out, /href=/);
});

test('02-readme-real-world.md: one notice naming hosts and simplified HTML; no network from page', async () => {
  const docPath = '/corpus/02-readme-real-world.md';
  const files = {
    [docPath]: b64(join(corpusDir, '02-readme-real-world.md')),
  };
  const browser = await webkit.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 800 } });
    await boot(page, files, [docPath]);
    const lines = await noticeTexts(page);
    assert.equal(lines.length, 1);
    assert.match(lines[0], /img\.shields\.io/);
    assert.match(lines[0], /example\.invalid/);
    assert.match(lines[0], /simplified/i);
    assert.match(lines[0], /details/);
    const remoteFetches = await page.evaluate(() =>
      window.__marxyHandle.shell.calls.filter((c) => c.method === 'fetchRemoteImage').length,
    );
    assert.equal(remoteFetches, 0);
  } finally {
    await browser.close();
  }
});

test('02-readme-real-world.md: the notice offers no image control, only HTML and Dismiss; Dismiss hides it', async () => {
  const docPath = '/corpus/02-readme-real-world.md';
  const files = { [docPath]: b64(join(corpusDir, '02-readme-real-world.md')) };
  const browser = await webkit.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 800 } });
    const requests = [];
    page.on('request', (r) => { if (/^https?:/.test(r.url()) && !r.url().startsWith(base)) requests.push(r.url()); });
    await boot(page, files, [docPath]);
    const lines = await noticeTexts(page);
    assert.equal(lines.length, 1);
    assert.match(lines[0], /\d+ images? from .*img\.shields\.io.* not loaded/);
    assert.deepEqual(await noticeActions(page), ["Show this document's HTML"]);
    const chrome = await page.evaluate(() => ({
      boxes: document.querySelectorAll('#marxy-notices input').length,
      details: document.querySelectorAll('#marxy-notices .marxy-notice-details').length,
      text: document.getElementById('marxy-notices')?.textContent ?? '',
    }));
    assert.equal(chrome.boxes, 0);
    assert.equal(chrome.details, 0);
    assert.doesNotMatch(chrome.text, /Load images|Images will load|selected hosts|Details/);
    await page.locator('#marxy-notices .marxy-notice-dismiss').first().click();
    assert.deepEqual(await noticeTexts(page), []);
    await page.waitForTimeout(300);
    assert.deepEqual(requests, [], 'no request left the page');
  } finally {
    await browser.close();
  }
});

test('an images-only document: one plain notice naming hosts, no action, Dismiss', async () => {
  const docPath = '/badges.md';
  const source = '# T\n\n![a](https://img.shields.io/a.svg) ![b](https://img.shields.io/b.svg) ![c](https://github.com/c.png) ![d](https://github.com/d.png)\n';
  const files = { [docPath]: Buffer.from(source).toString('base64') };
  const browser = await webkit.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 800 } });
    await boot(page, files, [docPath]);
    assert.deepEqual(await noticeTexts(page), ['4 images from img.shields.io and github.com were not loaded.']);
    assert.deepEqual(await noticeActions(page), []);
    await page.locator('#marxy-notices .marxy-notice-dismiss').click();
    assert.deepEqual(await noticeTexts(page), []);
  } finally {
    await browser.close();
  }
});

test('a trust.json from v0.1.0 with imageHosts: HTML still shows, no image command, file untouched until a change, then imageHosts is gone', async () => {
  const docPath = '/corpus/02-readme-real-world.md';
  const other = '/corpus/other.md';
  const stale = `${JSON.stringify({
    version: 1,
    documents: {
      [docPath]: { html: true, imageHosts: ['img.shields.io', 'example.invalid'], at: 1 },
      [other]: { html: true, imageHosts: ['github.com'], at: 2 },
    },
  }, null, 2)}\n`;
  const files = {
    [docPath]: b64(join(corpusDir, '02-readme-real-world.md')),
    '/data/trust.json': Buffer.from(stale).toString('base64'),
  };
  const browser = await webkit.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 800 } });
    await boot(page, files, [docPath]);
    await page.waitForFunction(() => document.querySelector('#doc details'));
    const trustWrites = () => page.evaluate(() =>
      window.__marxyHandle.shell.calls.filter((c) => c.method === 'writeFileAtomic' && String(c.args[0]).endsWith('trust.json'))
        .map((c) => new TextDecoder().decode(c.args[1])));
    assert.deepEqual(await trustWrites(), [], 'opening the document does not rewrite the reader\'s file');
    const cmds = await page.evaluate(() => window.__marxyHandle.commands().map((c) => `${c.id} ${c.title}`));
    assert.ok(cmds.some((c) => c.startsWith('trust.revoke-html')));
    assert.deepEqual(cmds.filter((c) => /image/i.test(c)), [], cmds.join(' | '));
    await page.evaluate(() =>
      window.__marxyHandle.commands().find((c) => c.id === 'trust.revoke-html')?.run({
        shell: window.__marxyHandle.shell,
        selection: { kind: 'none' },
        operationInput: () => null,
        closePalette: () => {},
        showNotice: () => {},
      }),
    );
    await page.waitForFunction(() => !document.querySelector('#doc details'));
    const writes = await trustWrites();
    assert.equal(writes.length, 1);
    assert.doesNotMatch(writes[0], /imageHosts|shields|github\.com/);
    assert.equal(JSON.parse(writes[0]).documents[other].html, true, 'another document keeps its HTML grant');
  } finally {
    await browser.close();
  }
});

test('grant HTML: wide elements appear, script absent, trust.json written, position kept', async () => {
  const docPath = '/corpus/02-readme-real-world.md';
  const files = {
    [docPath]: b64(join(corpusDir, '02-readme-real-world.md')),
  };
  const browser = await webkit.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 800 } });
    await boot(page, files, [docPath]);
    const beforeText = await page.evaluate(() =>
      document.querySelector('#doc [data-marxy-s]')?.textContent?.trim() ?? '',
    );
    await page.locator('button.marxy-notice-action', { hasText: /Show this document's HTML/ }).first().click();
    await page.waitForFunction(() => document.querySelector('#doc details'));
    const html = await page.evaluate(() => document.getElementById('doc')?.innerHTML ?? '');
    assert.match(html, /<details/);
    assert.match(html, /align="center"/);
    assert.match(html, /width="120"/);
    assert.doesNotMatch(html, /<script/i);
    const trustWrite = await page.evaluate(() =>
      window.__marxyHandle.shell.calls.find((c) => c.method === 'writeFileAtomic' && String(c.args[0]).endsWith('trust.json')),
    );
    assert.ok(trustWrite);
    const body = new TextDecoder().decode(trustWrite.args[1]);
    assert.match(body, /"html":\s*true/);
    const afterText = await page.evaluate(() =>
      document.querySelector('#doc [data-marxy-s]')?.textContent?.trim() ?? '',
    );
    assert.equal(afterText, beforeText);
  } finally {
    await browser.close();
  }
});

test('trust.json with html grant: wide render without HTML action in notice', async () => {
  const docPath = '/corpus/02-readme-real-world.md';
  const trust = JSON.stringify({
    version: 1,
    documents: { [docPath]: { html: true, at: 1 } },
  }, null, 2);
  const files = {
    [docPath]: b64(join(corpusDir, '02-readme-real-world.md')),
    '/data/trust.json': Buffer.from(`${trust}\n`).toString('base64'),
  };
  const browser = await webkit.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 800 } });
    await boot(page, files, [docPath]);
    await page.waitForFunction(() => document.querySelector('#doc details'));
    const actions = await noticeActions(page);
    assert.ok(!actions.some((a) => a.includes("Show this document's HTML")));
    } finally {
    await browser.close();
  }
});

test('22-unclosed-script.md: truncation notice names line 5 and remaining lines', async () => {
  const docPath = '/corpus/22-unclosed-script.md';
  const files = { [docPath]: b64(join(testFixturesDir, '22-unclosed-script.md')) };
  const browser = await webkit.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 800 } });
    await boot(page, files, [docPath]);
    const lines = await noticeTexts(page);
    const trunc = lines.find((l) => l.includes('unclosed'));
    assert.ok(trunc, lines.join(' | '));
    assert.match(trunc, /line 5/);
    assert.match(trunc, /22 lines/);
  } finally {
    await browser.close();
  }
});

test('only-script document: no HTML grant action', async () => {
  const docPath = '/only-script.md';
  const source = '<script>alert(1)\n';
  const files = { [docPath]: Buffer.from(source).toString('base64') };
  const browser = await webkit.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 800 } });
    await boot(page, files, [docPath]);
    const actions = await noticeActions(page);
    assert.ok(!actions.some((a) => a.toLowerCase().includes('html')));
  } finally {
    await browser.close();
  }
});

test('revoke HTML grant restores default render and clears trust.json entry', async () => {
  const docPath = '/corpus/02-readme-real-world.md';
  const trust = JSON.stringify({
    version: 1,
    documents: { [docPath]: { html: true, at: 1 } },
  }, null, 2);
  const files = {
    [docPath]: b64(join(corpusDir, '02-readme-real-world.md')),
    '/data/trust.json': Buffer.from(`${trust}\n`).toString('base64'),
  };
  const browser = await webkit.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 800 } });
    await boot(page, files, [docPath]);
    await page.waitForFunction(() => document.querySelector('#doc details'));
    await page.evaluate(() =>
      window.__marxyHandle.commands().find((c) => c.id === 'trust.revoke-html')?.run({
        shell: window.__marxyHandle.shell,
        selection: { kind: 'none' },
        operationInput: () => null,
        closePalette: () => {},
        showNotice: () => {},
      }),
    );
    await page.waitForFunction(() => !document.querySelector('#doc details'));
    const trustWrite = await page.evaluate(() => {
      const calls = window.__marxyHandle.shell.calls.filter(
        (c) => c.method === 'writeFileAtomic' && String(c.args[0]).endsWith('trust.json'),
      );
      const last = calls[calls.length - 1];
      return last ? new TextDecoder().decode(last.args[1]) : '';
    });
    assert.doesNotMatch(trustWrite, /"html":\s*true/);
  } finally {
    await browser.close();
  }
});

test('revoking a grant clears its grant-summary notice (MARXY-337)', async () => {
  const docPath = '/corpus/02-readme-real-world.md';
  const files = { [docPath]: b64(join(corpusDir, '02-readme-real-world.md')) };
  const summaries = (page) =>
    noticeTexts(page).then((ts) => ts.filter((t) => /Undo in the palette/.test(t)));
  const browser = await webkit.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 800 } });
    await boot(page, files, [docPath]);
    await page.locator('button.marxy-notice-action', { hasText: /Show this document's HTML/ }).first().click();
    await page.waitForFunction(() => document.querySelector('#doc details'));
    await page.waitForFunction(() =>
      [...document.querySelectorAll('#marxy-notices .marxy-notice-text')].some((e) => /Showing HTML for/.test(e.textContent ?? '')));
    assert.ok((await summaries(page)).length > 0, 'a summary shows after the grant');
    await page.evaluate(() =>
      window.__marxyHandle.commands().find((c) => c.id === 'trust.revoke-html')?.run({
        shell: window.__marxyHandle.shell,
        selection: { kind: 'none' },
        operationInput: () => null,
        closePalette: () => {},
        showNotice: () => {},
      }));
    assert.deepEqual(await summaries(page), [], 'no summary outlives the revoke');
  } finally {
    await browser.close();
  }
});
