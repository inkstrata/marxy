// MARXY-235: artifact fence rendering — ESC glyph, long-line elision, diff continuation hang.
import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { after, before, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { build } from '../../../apps/desktop/node_modules/vite/dist/node/index.js';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip }, fn);

const repoRoot = new URL('../../../', import.meta.url).pathname;
const corpusPath = join(repoRoot, 'fixtures', 'corpus', '28-artifact-fences.md');
const outDir = mkdtempSync(join(tmpdir(), 'marxy-artifact-fences-'));
let server;
let base;

before(async () => {
  if (skip) return;
  await build({
    root: join(repoRoot, 'apps/desktop'),
    logLevel: 'silent',
    build: { outDir, emptyOutDir: true },
  });
  const types = { '.html': 'text/html', '.ttf': 'font/ttf', '.js': 'text/javascript', '.txt': 'text/plain', '.css': 'text/css', '.png': 'image/png' };
  server = createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const path = join(outDir, pathname.endsWith('/') ? `${pathname}index.html` : pathname);
    if (!existsSync(path)) {
      res.statusCode = 404;
      return res.end();
    }
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
  }, { files, argv });
}

async function waitHighlight(page, selector = 'code') {
  await page.waitForFunction(
    (sel) => [...document.querySelectorAll(sel)].every((c) => c.dataset.marxyDone === 'highlight'),
    selector,
    { timeout: 15_000 },
  );
}

test('MARXY-235: ESC renders as ␛ and copy text keeps byte 0x1B', async () => {
  const esc = '\u001b';
  const docPath = '/ansi.md';
  const body = `\`\`\`text\n${esc}[31mFAIL${esc}[0m\n\`\`\`\n`;
  const files = { [docPath]: Buffer.from(body, 'utf8').toString('base64') };
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 720, height: 600 } });
    await boot(page, files, [docPath]);
    await waitHighlight(page);
    const r = await page.evaluate(() => {
      const code = document.querySelector('code.language-text');
      const ctrl = code?.querySelector('.marxy-ctrl');
      const visible = ctrl ? getComputedStyle(ctrl, '::before').content : '';
      const bytes = [...(code?.textContent ?? '')].map((c) => c.codePointAt(0));
      return { visible, bytes, hasCtrl: Boolean(ctrl) };
    });
    assert.ok(r.hasCtrl);
    assert.ok(r.visible.includes('241B') || r.visible.includes('␛'));
    assert.ok(r.bytes.includes(0x1b));
  } finally {
    await browser.close();
  }
});

test('MARXY-235: a line over 1,000 characters shows 200 plus a count marker; copy keeps every byte', async () => {
  const payload = 'a'.repeat(5000);
  const docPath = '/long.json.md';
  const body = `\`\`\`json\n{"p":"${payload}"}\n\`\`\`\n`;
  const files = { [docPath]: Buffer.from(body, 'utf8').toString('base64') };
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 720, height: 600 } });
    await boot(page, files, [docPath]);
    await waitHighlight(page, 'code.language-json');
    const r = await page.evaluate(() => {
      const code = document.querySelector('code.language-json');
      const elided = code?.querySelector('.marxy-elided')?.textContent ?? '';
      const omitted = code?.querySelector('.marxy-line-omitted')?.textContent?.length ?? 0;
      const head = code?.querySelector('.marxy-line')?.firstChild?.textContent?.length ?? 0;
      return { elided, copyLen: code?.textContent?.length ?? 0, omitted, head };
    });
    assert.match(r.elided, /more characters/);
    assert.ok(r.copyLen > 5000);
    assert.ok(r.omitted > 4000);
    assert.ok(r.head <= 200);
  } finally {
    await browser.close();
  }
});

test('MARXY-235: diff continuation hangs at least 2ch past the marker column (28-artifact-fences)', async () => {
  const docPath = '/corpus/28-artifact-fences.md';
  const files = { [docPath]: b64(corpusPath) };
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 720, height: 900 } });
    await boot(page, files, [docPath]);
    await waitHighlight(page, 'code.language-diff');
    const r = await page.evaluate(() => {
      const line = document.querySelector('code.language-diff .marxy-diff-add');
      if (!line) return null;
      const range = document.createRange();
      range.selectNodeContents(line);
      const rows = new Map();
      for (const rect of range.getClientRects()) {
        if (rect.width === 0) continue;
        const key = Math.round(rect.top + rect.height / 2);
        const row = rows.get(key) ?? { top: rect.top, left: Infinity };
        row.left = Math.min(row.left, rect.left);
        rows.set(key, row);
      }
      const sorted = [...rows.values()].sort((a, b) => a.top - b.top);
      if (sorted.length < 2) return { missing: 'wrap', rects: sorted.length };
      const probe = document.createElement('span');
      probe.textContent = '0';
      probe.style.font = getComputedStyle(line).font;
      line.append(probe);
      const ch = probe.getBoundingClientRect().width;
      probe.remove();
      return { hang: sorted[1].left - sorted[0].left, ch, rows: line.getBoundingClientRect().height };
    });
    assert.ok(r && !r.missing, `expected a long added diff line (${r?.missing ?? 'none'})`);
    assert.ok(r.rows > 40, 'diff line should wrap');
    assert.ok(r.hang > r.ch * 1.9, `continuation hang ${r.hang}px vs marker ch ${r.ch}px`);
  } finally {
    await browser.close();
  }
});
