// Explicit save without the harness's original-bytes shortcut: the app's own baseline decides what is
// dirty (MARXY-49, MARXY-337). Nothing here sets window.__marxyOrigBytes.
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
const outDir = mkdtempSync(join(tmpdir(), 'marxy-explicit-save-'));
const FILE = '03-ai-plan.md';
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
        input: { app: join(desktopRoot, 'app.html'), paletteBoot: join(desktopRoot, 'test/palette-boot.html') },
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

const orig = readFileSync(join(corpusDir, FILE));

function markers() {
  const out = [];
  const walk = (n) => {
    if (n.type === 'taskMarker') out.push(n);
    for (const c of n.children ?? []) walk(c);
  };
  walk(parseMarkdown(orig, { file: FILE }));
  return out;
}

/** The bytes with the given task markers flipped, computed independently of the app. */
function flipped(...which) {
  const bytes = Uint8Array.from(orig);
  const ms = markers();
  for (const i of which) {
    const m = ms[i];
    const at = bytes.indexOf(0x5b, m.src.start);
    assert.ok(at >= m.src.start && at < m.src.end);
    bytes[at + 1] = bytes[at + 1] === 0x20 ? 0x78 : 0x20;
  }
  return bytes;
}

async function boot(page) {
  const docPath = `/corpus/${FILE}`;
  await page.goto(`${base}test/palette-boot.html`);
  await page.waitForFunction(() => typeof window.marxyPaletteBoot?.start === 'function');
  await page.evaluate(async ({ files, argv }) => {
    window.__boot = await window.marxyPaletteBoot.start(files, argv, []);
  }, { files: { [docPath]: readFileSync(join(corpusDir, FILE)).toString('base64') }, argv: [docPath] });
  await page.waitForFunction(() => window.__marxyTasksReady === true);
  await page.waitForFunction(() => window.__marxyOpenSynced === true);
  await page.waitForFunction(() => typeof window.marxyHarnessSave === 'function');
  assert.equal(await page.evaluate(() => window.__marxyOrigBytes), undefined, 'the shortcut must stay unset');
  return docPath;
}

const bufferBytes = (page) => page.evaluate(() => [...window.__boot.handle.openDocument().buffer.bytes]);
const writes = (page, path) =>
  page.evaluate(
    (p) => window.__boot.handle.shell.calls.filter((c) => c.method === 'writeFileAtomic' && c.args[0] === p).map((c) => [...c.args[1]]),
    path,
  );

async function toggle(page, i) {
  const start = markers()[i].src.start;
  const before = (await bufferBytes(page)).join();
  await page.evaluate((s) => {
    document.querySelector(`#doc input[data-marxy-s="${s}"]`)?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  }, start);
  await page.waitForFunction((b) => window.__boot.handle.openDocument().buffer.bytes.join() !== b, before);
  // let the re-render (and its mutation observers) settle
  await page.waitForTimeout(150);
}

async function modKey(page, key) {
  const mod = (await page.evaluate(() => navigator.platform)) === 'MacIntel' ? 'Meta' : 'Control';
  await page.keyboard.press(`${mod}+${key}`);
}

async function withPage(fn) {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 900 } });
    const docPath = await boot(page);
    await fn(page, docPath);
  } finally {
    await browser.close();
  }
}

const same = (a, b) => Buffer.from(a).equals(Buffer.from(b));

test('toggle then Mod+S with nothing selected writes exactly the marker bytes', () =>
  withPage(async (page, docPath) => {
    await toggle(page, 0);
    assert.equal(await page.evaluate(() => window.marxyDocumentEdit().dirty), true);
    await modKey(page, 'KeyS');
    await page.waitForFunction((p) => window.__boot.handle.shell.calls.some((c) => c.method === 'writeFileAtomic' && c.args[0] === p), docPath);
    const w = await writes(page, docPath);
    assert.equal(w.length, 1);
    assert.ok(same(w[0], flipped(0)), 'the file differs from the original only by the toggled marker');
    assert.equal(await page.evaluate(() => window.marxyDocumentEdit().dirty), false);
  }));

test('toggle then Mod+S with a selection writes the same bytes', () =>
  withPage(async (page, docPath) => {
    await toggle(page, 0);
    await page.click('#doc p');
    await page.waitForSelector('#doc p.marxy-selected');
    await modKey(page, 'KeyS');
    await page.waitForFunction((p) => window.__boot.handle.shell.calls.some((c) => c.method === 'writeFileAtomic' && c.args[0] === p), docPath);
    assert.ok(same((await writes(page, docPath))[0], flipped(0)));
  }));

test('two operations then two undos restore both', () =>
  withPage(async (page) => {
    await toggle(page, 0);
    await toggle(page, 1);
    assert.ok(same(await bufferBytes(page), flipped(0, 1)));
    await modKey(page, 'KeyZ');
    await page.waitForFunction((b) => window.__boot.handle.openDocument().buffer.bytes.join() === b, [...flipped(0)].join());
    await page.waitForTimeout(150);
    await modKey(page, 'KeyZ');
    await page.waitForFunction((b) => window.__boot.handle.openDocument().buffer.bytes.join() === b, [...orig].join());
    assert.equal(await page.evaluate(() => window.marxyDocumentEdit().dirty), false, 'undone to the saved state is clean');
  }));

test('after a save the document is clean and a second Mod+S writes nothing', () =>
  withPage(async (page, docPath) => {
    await toggle(page, 0);
    assert.equal(await page.evaluate(() => window.marxyHarnessSave()), 'saved');
    assert.equal(await page.evaluate(() => window.marxyDocumentEdit().dirty), false);
    await modKey(page, 'KeyS');
    await page.waitForTimeout(200);
    assert.equal((await writes(page, docPath)).length, 1);
    // an edit after the save is dirty again, and undo across the save still works
    await toggle(page, 1);
    assert.equal(await page.evaluate(() => window.marxyDocumentEdit().dirty), true);
    await modKey(page, 'KeyS');
    await page.waitForFunction((p) => window.__boot.handle.shell.calls.filter((c) => c.method === 'writeFileAtomic' && c.args[0] === p).length === 2, docPath);
    assert.ok(same((await writes(page, docPath))[1], flipped(0, 1)));
  }));

test('an external change re-baselines: clean afterwards, and Mod+S writes nothing', () =>
  withPage(async (page, docPath) => {
    const external = flipped(2);
    await page.evaluate(async ({ path, bytes }) => {
      const shell = window.__boot.handle.shell;
      await shell.writeFileAtomic(path, Uint8Array.from(bytes));
      shell.emit([{ kind: 'modified', path }]);
    }, { path: docPath, bytes: [...external] });
    await page.waitForFunction((b) => window.__boot.handle.openDocument().buffer.bytes.join() === b, [...external].join());
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(() => window.marxyDocumentEdit().dirty), false);
    const before = (await writes(page, docPath)).length;
    await modKey(page, 'KeyS');
    await page.waitForTimeout(200);
    assert.equal((await writes(page, docPath)).length, before);
    // and a toggle on the reloaded document saves on top of the external bytes
    await toggle(page, 0);
    await modKey(page, 'KeyS');
    await page.waitForFunction(
      ({ p, n }) => window.__boot.handle.shell.calls.filter((c) => c.method === 'writeFileAtomic' && c.args[0] === p).length === n,
      { p: docPath, n: before + 1 },
    );
    assert.ok(same((await writes(page, docPath)).at(-1), flipped(2, 0)));
  }));
