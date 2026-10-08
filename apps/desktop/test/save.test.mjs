// Explicit save: byte-faithful writes, title dirty dot, watch echo (MARXY-49).
import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { after, before, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { build } from 'vite';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { parseMarkdown } from '../../../packages/core/src/index.ts';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip }, fn);

const repoRoot = new URL('../../../', import.meta.url).pathname;
const desktopRoot = new URL('..', import.meta.url).pathname;
const corpusDir = join(repoRoot, 'fixtures', 'corpus');
const outDir = mkdtempSync(join(tmpdir(), 'marxy-save-'));
let server;
let base;

before(async () => {
  if (skip) return;
  await build({
    root: desktopRoot,
    logLevel: 'silent',
    build: {
      outDir,
      emptyOutDir: true,
      rollupOptions: {
        input: {
          app: join(desktopRoot, 'app.html'),
          paletteBoot: join(desktopRoot, 'test/palette-boot.html'),
        },
      },
    },
  });
  const types = { '.html': 'text/html', '.ttf': 'font/ttf', '.js': 'text/javascript', '.css': 'text/css' };
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

function byteDiffs(a, b) {
  const n = Math.max(a.length, b.length);
  const ranges = [];
  let start = -1;
  for (let i = 0; i < n; i++) {
    const diff = (a[i] ?? -1) !== (b[i] ?? -2);
    if (diff && start < 0) start = i;
    if (!diff && start >= 0) {
      ranges.push([start, i]);
      start = -1;
    }
  }
  if (start >= 0) ranges.push([start, n]);
  return ranges;
}

function modKey(platform) {
  return platform === 'MacIntel' ? 'Meta' : 'Control';
}

async function boot(page, file) {
  const docPath = `/corpus/${file}`;
  await page.goto(`${base}test/palette-boot.html`);
  await page.waitForFunction(() => typeof window.marxyPaletteBoot?.start === 'function');
  await page.evaluate(async ({ files, argv }) => {
    window.__marxySaveBoot = await window.marxyPaletteBoot.start(files, argv, []);
  }, { files: { [docPath]: b64(join(corpusDir, file)) }, argv: [docPath] });
  await page.waitForFunction(() => window.__marxyTasksReady === true);
  await page.waitForFunction(() => window.__marxyOpenSynced === true);
  await page.waitForFunction(() => typeof window.marxyHarnessSave === 'function');
  return docPath;
}

function firstTaskMarker(bytes, file) {
  const ast = parseMarkdown(bytes, { file });
  const markers = [];
  const walk = (n) => {
    if (n.type === 'taskMarker') markers.push(n);
    for (const c of n.children ?? []) walk(c);
  };
  walk(ast);
  return markers[0];
}

test('toggle then Mod+S writes only the marker range in 03-ai-plan.md', async () => {
  const file = '03-ai-plan.md';
  const orig = readFileSync(join(corpusDir, file));
  const marker = firstTaskMarker(orig, file);
  assert.ok(marker);
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 900 } });
    const docPath = await boot(page, file);
    await page.evaluate((start) => {
      document.querySelector(`#doc input[data-marxy-s="${start}"]`)?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    }, marker.src.start);
    await page.waitForFunction(() => window.marxyDocumentEdit?.().dirty === true);
    await page.waitForFunction(() => / •/.test(window.__marxySaveBoot.handle.shell.calls.filter((c) => c.method === 'setTitle').at(-1)?.args[0] ?? ''));
    assert.match(await page.evaluate(() => window.__marxySaveBoot.handle.shell.calls.filter((c) => c.method === 'setTitle').at(-1)?.args[0] ?? ''), / •/);
    const saved = await page.evaluate(async () => window.marxyHarnessSave());
    assert.equal(saved, 'saved');
    await page.waitForFunction(
      (path) =>
        window.__marxySaveBoot.handle.shell.calls.filter((c) => c.method === 'writeFileAtomic' && c.args[0] === path).length === 1,
      docPath,
    );
    const written = await page.evaluate((path) => {
      const call = window.__marxySaveBoot.handle.shell.calls.find((c) => c.method === 'writeFileAtomic' && c.args[0] === path);
      return call ? [...call.args[1]] : [];
    }, docPath);
    const now = Uint8Array.from(written);
    const diffs = byteDiffs(orig, now);
    assert.ok(diffs.length > 0);
    for (const [s, e] of diffs) {
      assert.ok(s >= marker.src.start && e <= marker.src.end, `diff [${s},${e}) outside marker`);
    }
    assert.doesNotMatch(await page.evaluate(() => window.__marxySaveBoot.handle.shell.calls.filter((c) => c.method === 'setTitle').at(-1)?.args[0] ?? ''), / •/);
  } finally {
    await browser.close();
  }
});

test('Mod+S when clean records no write', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage();
    const docPath = await boot(page, '01-long-technical.md');
    const platform = await page.evaluate(() => navigator.platform);
    await page.keyboard.down(modKey(platform));
    await page.keyboard.press('s');
    await page.keyboard.up(modKey(platform));
    const writes = await page.evaluate(
      (path) => window.__marxySaveBoot.handle.shell.calls.filter((c) => c.method === 'writeFileAtomic' && c.args[0] === path).length,
      docPath,
    );
    assert.equal(writes, 0);
  } finally {
    await browser.close();
  }
});

test('watch echo after save does not show the disk-changed notice', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 900 } });
    const docPath = await boot(page, '03-ai-plan.md');
    const marker = firstTaskMarker(readFileSync(join(corpusDir, '03-ai-plan.md')), '03-ai-plan.md');
    await page.evaluate((start) => {
      document.querySelector(`#doc input[data-marxy-s="${start}"]`)?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    }, marker.src.start);
    await page.waitForFunction(() => window.marxyDocumentEdit?.().dirty === true);
    const saved = await page.evaluate(async () => window.marxyHarnessSave());
    assert.equal(saved, 'saved');
    await page.evaluate(async (path) => {
      const shell = window.__marxySaveBoot.handle.shell;
      const bytes = new Uint8Array(await shell.readFile(path));
      shell.emit([{ kind: 'modified', path }]);
    }, docPath);
    await page.waitForTimeout(200);
    const notice = await page.evaluate(() => document.getElementById('marxy-notices')?.textContent ?? '');
    assert.ok(!notice.includes('changed on disk'));
  } finally {
    await browser.close();
  }
});
