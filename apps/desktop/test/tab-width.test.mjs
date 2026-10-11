// Source tab width from `.editorconfig` under the indexed root (MARXY-239).
import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { after, before, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { build } from 'vite';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { clampTab, parseEditorConfig, resolveTabWidth, tabSizeFromSection } = require('../src/source/editorconfig.ts');

nodeTest('editorconfig tab_width, indent_size, bounds, and default', async () => {
  const section = tabSizeFromSection(parseEditorConfig('[*]\ntab_width = 2\n')[0]);
  assert.equal(section, 2);
  const indent = tabSizeFromSection(parseEditorConfig('[*]\nindent_size = 6\n')[0]);
  assert.equal(indent, 6);
  assert.equal(clampTab(0), 1);
  assert.equal(clampTab(12), 8);
  const root = '/repo';
  const read = async (path) => {
    if (path === '/repo/.editorconfig') return '[*]\ntab_width = 2\n';
    throw new Error('missing');
  };
  assert.equal(await resolveTabWidth('/repo/pkg/main.rs', '/repo', read), 2);
  assert.equal(await resolveTabWidth('/repo/pkg/main.rs', root, async () => { throw new Error('x'); }), 4);
});

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip }, fn);

const repoRoot = new URL('../../../', import.meta.url).pathname;
const appRoot = join(repoRoot, 'apps', 'desktop');
const outDir = mkdtempSync(join(tmpdir(), 'marxy-tab-width-'));
let server;
let base;

before(async () => {
  if (skip) return;
  await build({ root: appRoot, logLevel: 'silent', build: { outDir, emptyOutDir: true } });
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
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

test('Source editor tab-size follows .editorconfig under the indexed root', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage();
    const file = '/repo/pkg/main.rs';
    const ec = '/repo/.editorconfig';
    await page.goto(`${base}app.html`);
    await page.evaluate(async ({ file, ec }) => {
      const files = {
        [file]: btoa('fn main() {\n\tlet x = 1;\n}\n'),
        [ec]: btoa('[*]\ntab_width = 2\n'),
        '/repo/.git/HEAD': btoa('ref: refs/heads/main\n'),
      };
      const handle = await window.marxyApp.start(files, [file]);
      window.__marxyHandle = handle;
      await handle.ready;
    }, { file, ec });
    await page.waitForFunction(() => document.querySelector('.cm-content') && window.marxySelection);
    const reads = await page.evaluate(async () => {
      await window.marxyRefreshSourceTab?.();
      return window.__marxyHandle.shell.calls
        .filter((c) => c.method === 'readFile')
        .map((c) => c.args[0]);
    });
    assert.ok(reads.includes('/repo/.editorconfig'), `readFile paths: ${reads.join(', ')}`);
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.cm-content')).tabSize === '2');
    const applied = await page.evaluate(() => getComputedStyle(document.querySelector('.cm-content')).tabSize);
    assert.equal(applied, '2');
  } finally {
    await browser.close();
  }
});

const V16_FILES = {
  '/repo/cmd/main.go': 'package main\n\nfunc main() {\n\tprintln("a")\n}\n',
  '/repo/notes.md': '# Notes\n\n```go\nfunc f() {\n\treturn\n}\n```\n',
  '/repo/.editorconfig': 'root = true\n[*]\nindent_size = 2\n[*.go]\nindent_size = 8\n',
  '/repo/.git/HEAD': 'ref: refs/heads/main\n',
};

async function openV16(page, opened) {
  await page.goto(`${base}app.html`);
  await page.evaluate(async ({ files, opened }) => {
    const enc = Object.fromEntries(Object.entries(files).map(([k, v]) => [k, btoa(v)]));
    const handle = await window.marxyApp.start(enc, [opened]);
    window.__marxyHandle = handle;
    await handle.ready;
  }, { files: V16_FILES, opened });
}

test('V-16: a tab-indented .go has one tab width in Rendered and Source, and its wrapped row hangs at that column', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage();
    await openV16(page, '/repo/cmd/main.go');
    await page.waitForFunction(() => document.documentElement.style.getPropertyValue('--marxy-tab-size') === '8');
    // A code block as Rendered sets one (the code-file view itself arrives with V-09): the app reacts to it.
    await page.evaluate(() => {
      const pre = document.createElement('pre');
      pre.id = 'v16-pre';
      const code = document.createElement('code');
      const line = document.createElement('span');
      line.className = 'marxy-line';
      line.textContent = '\tprintln("a") ' + 'word '.repeat(60);
      code.append(line);
      pre.append(code);
      document.querySelector('article').append(pre);
    });
    await page.waitForFunction(() => document.querySelector('#v16-pre .marxy-line')?.style.getPropertyValue('--marxy-indent') === '8ch');
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#v16-pre')).tabSize), '8');
    // Show Rendered and measure: the wrapped (second) row starts 8ch plus the block's hang from the line start.
    const m = await page.evaluate(() => {
      document.querySelector('article').hidden = false;
      const pre = document.querySelector('#v16-pre');
      const line = pre.querySelector('.marxy-line');
      const probe = document.createElement('span');
      probe.textContent = '0000000000';
      pre.append(probe);
      const ch = probe.getBoundingClientRect().width / 10;
      probe.remove();
      const text = line.firstChild;
      const rows = new Map();
      for (let i = 0; i < text.length; i++) {
        const r = document.createRange();
        r.setStart(text, i);
        r.setEnd(text, i + 1);
        const b = r.getBoundingClientRect();
        if (b.width === 0) continue;
        const top = Math.round(b.top);
        if (!rows.has(top) || b.left < rows.get(top)) rows.set(top, b.left);
      }
      const lefts = [...rows.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1]);
      return { ch, lefts };
    });
    assert.ok(m.lefts.length >= 2, 'the line wrapped');
    // The wrapped row starts 8ch (the tab's columns) plus the block's 2ch hang in from where row one starts.
    assert.ok(Math.abs(m.lefts[1] - m.lefts[0] - 10 * m.ch) < 1.5, JSON.stringify(m));
    await page.evaluate(() => window.marxyRefreshSourceTab?.());
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.cm-content')).tabSize === '8');
  } finally {
    await browser.close();
  }
});

test('V-16: a fence inside Markdown keeps tab width 4', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage();
    await openV16(page, '/repo/notes.md');
    await page.waitForSelector('article pre');
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(await page.evaluate(() => document.documentElement.style.getPropertyValue('--marxy-tab-size')), '');
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('article pre')).tabSize), '4');
  } finally {
    await browser.close();
  }
});
