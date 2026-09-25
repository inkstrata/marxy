// Rendered-mode edits: task toggle, table align, undo, dirty state (MARXY-43).
import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { after, before, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { build } from 'vite';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { alignTablePipes } from '../../../packages/core/src/operations/align-table-pipes.ts';
import { createBuffer, parseMarkdown, textOf } from '../../../packages/core/src/index.ts';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip }, fn);

const repoRoot = new URL('../../../', import.meta.url).pathname;
const desktopRoot = new URL('..', import.meta.url).pathname;
const corpusDir = join(repoRoot, 'fixtures', 'corpus');
const outDir = mkdtempSync(join(tmpdir(), 'marxy-ops-edit-'));
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

async function boot(page, file, argv) {
  const docPath = `/corpus/${file}`;
  await page.goto(`${base}test/palette-boot.html`);
  await page.waitForFunction(() => typeof window.marxyPaletteBoot?.start === 'function');
  await page.evaluate(async ({ files, argv }) => {
    window.__marxyOpsBoot = await window.marxyPaletteBoot.start(files, argv, []);
    window.__marxyOrigBytes = new Uint8Array(await window.__marxyOpsBoot.handle.shell.readFile(argv[0]));
  }, { files: { [docPath]: b64(join(corpusDir, file)) }, argv: [docPath] });
  await page.waitForFunction(() => typeof window.marxySelection?.getSelectionState === 'function');
  await page.waitForFunction(() => window.__marxyTasksReady === true);
  await page.waitForFunction(() => typeof window.marxyDocumentEdit === 'function');
  await page.waitForFunction(() => window.__marxyOpenSynced === true);
  return docPath;
}

function modKey(platform) {
  return platform === 'MacIntel' ? 'Meta' : 'Control';
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

test('clicking the first open task checkbox toggles only the marker bytes', async () => {
  const file = '03-ai-plan.md';
  const bytes = readFileSync(join(corpusDir, file));
  const ast = parseMarkdown(bytes, { file });
  const markers = [];
  const walk = (n) => {
    if (n.type === 'taskMarker') markers.push(n);
    for (const c of n.children ?? []) walk(c);
  };
  walk(ast);
  const firstMarker = markers[0];
  assert.ok(firstMarker);
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 900 } });
    const docPath = await boot(page, file, [`/corpus/${file}`]);
    const beforeBlock = await page.evaluate(() => {
      const b = document.querySelector('#doc [data-marxy-s]');
      return b ? { start: b.getAttribute('data-marxy-s'), top: b.getBoundingClientRect().top } : null;
    });
    await page.evaluate((start) => {
      const box = document.querySelector(`#doc input[data-marxy-s="${start}"]`);
      box?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    }, firstMarker.src.start);
    await page.waitForFunction(
      async (path) => {
        const now = new Uint8Array(await window.__marxyOpsBoot.handle.shell.readFile(path));
        const orig = window.__marxyOrigBytes;
        for (let i = 0; i < orig.length; i++) if (orig[i] !== now[i]) return true;
        return false;
      },
      docPath,
    );
    const result = await page.evaluate(
      async ({ path, beforeBlock, markerStart }) => {
        const now = new Uint8Array(await window.__marxyOpsBoot.handle.shell.readFile(path));
        const orig = window.__marxyOrigBytes;
        const checked = document.querySelector(`#doc input[data-marxy-s="${markerStart}"]`)?.checked;
        const afterBlock = document.querySelector('#doc [data-marxy-s]');
        return {
          now: [...now],
          orig: [...orig],
          checked,
          beforeBlock,
          afterTop: afterBlock?.getBoundingClientRect().top,
        };
      },
      { path: docPath, beforeBlock, markerStart: firstMarker.src.start },
    );
    const now = Uint8Array.from(result.now);
    const orig = Uint8Array.from(result.orig);
    const diffs = byteDiffs(orig, now);
    assert.ok(diffs.length > 0);
    for (const [s, e] of diffs) {
      assert.ok(s >= firstMarker.src.start && e <= firstMarker.src.end, `diff [${s},${e}) outside marker`);
    }
    const markerText = new TextDecoder().decode(now.subarray(firstMarker.src.start, firstMarker.src.end));
    assert.equal(markerText, firstMarker.checked ? '[ ]' : '[x]');
    assert.equal(result.checked, !firstMarker.checked);
    assert.equal(result.afterTop, result.beforeBlock?.top);
  } finally {
    await browser.close();
  }
});

test('Mod+Z undoes a task toggle and Mod+Shift+Z redoes it', async () => {
  const file = '03-ai-plan.md';
  const bytes = readFileSync(join(corpusDir, file));
  const ast = parseMarkdown(bytes, { file });
  const markers = [];
  const walk = (n) => {
    if (n.type === 'taskMarker') markers.push(n);
    for (const c of n.children ?? []) walk(c);
  };
  walk(ast);
  const firstMarker = markers[0];
  assert.ok(firstMarker);
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 900 } });
    const docPath = await boot(page, file, [`/corpus/${file}`]);
    await page.evaluate((start) => {
      const box = document.querySelector(`#doc input[data-marxy-s="${start}"]`);
      box?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    }, firstMarker.src.start);
    await page.waitForFunction(
      async (path) => {
        const now = new Uint8Array(await window.__marxyOpsBoot.handle.shell.readFile(path));
        const orig = window.__marxyOrigBytes;
        for (let i = 0; i < orig.length; i++) if (orig[i] !== now[i]) return true;
        return false;
      },
      docPath,
    );
    const mod = modKey(await page.evaluate(() => navigator.platform));
    await page.keyboard.press(`${mod}+KeyZ`);
    await page.waitForFunction(
      async (path) => {
        const now = new Uint8Array(await window.__marxyOpsBoot.handle.shell.readFile(path));
        const orig = window.__marxyOrigBytes;
        for (let i = 0; i < orig.length; i++) if (orig[i] !== now[i]) return false;
        return true;
      },
      docPath,
    );
    await page.evaluate(async () => {
      await window.marxyHarnessRedo?.();
    });
    await page.waitForFunction(
      async (path) => {
        const now = new Uint8Array(await window.__marxyOpsBoot.handle.shell.readFile(path));
        const orig = window.__marxyOrigBytes;
        for (let i = 0; i < orig.length; i++) if (orig[i] !== now[i]) return true;
        return false;
      },
      docPath,
    );
  } finally {
    await browser.close();
  }
});

nodeTest('align table pipes summary string for 07-cjk.md', () => {
  const file = '07-cjk.md';
  const bytes = readFileSync(join(corpusDir, file));
  const ast = parseMarkdown(bytes, { file });
  const walk = (n, out = []) => {
    if (n.type === 'table') out.push(n);
    for (const c of n.children ?? []) walk(c, out);
    return out;
  };
  const table = walk(ast)[0];
  assert.ok(table);
  const buffer = createBuffer(file, bytes);
  const text = textOf(buffer, table.src);
  const out = alignTablePipes.run({ document: ast, node: table, range: table.src, text });
  assert.equal(out.summary, 'Aligned 3 columns across 5 rows');
});

test('dirty is true after an edit and false after undo to the saved version', async () => {
  const file = '03-ai-plan.md';
  const bytes = readFileSync(join(corpusDir, file));
  const ast = parseMarkdown(bytes, { file });
  const markers = [];
  const walk = (n) => {
    if (n.type === 'taskMarker') markers.push(n);
    for (const c of n.children ?? []) walk(c);
  };
  walk(ast);
  const firstMarker = markers[0];
  assert.ok(firstMarker);
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 900 } });
    await boot(page, file, [`/corpus/${file}`]);
    await page.evaluate((start) => {
      const box = document.querySelector(`#doc input[data-marxy-s="${start}"]`);
      box?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    }, firstMarker.src.start);
    await page.waitForFunction(
      async (path) => {
        const now = new Uint8Array(await window.__marxyOpsBoot.handle.shell.readFile(path));
        const orig = window.__marxyOrigBytes;
        for (let i = 0; i < orig.length; i++) if (orig[i] !== now[i]) return true;
        return false;
      },
      `/corpus/${file}`,
    );
    assert.equal(await page.evaluate(() => window.marxyDocumentEdit?.().dirty), true);
    const mod = modKey(await page.evaluate(() => navigator.platform));
    await page.keyboard.press(`${mod}+KeyZ`);
    await page.waitForFunction(
      async (path) => {
        const now = new Uint8Array(await window.__marxyOpsBoot.handle.shell.readFile(path));
        const orig = window.__marxyOrigBytes;
        for (let i = 0; i < orig.length; i++) if (orig[i] !== now[i]) return false;
        return true;
      },
      `/corpus/${file}`,
    );
  } finally {
    await browser.close();
  }
});
