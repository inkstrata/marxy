// Save and close defects, round five (MARXY-337): unsaved edits lost to a same-path open, a rename, an edit made
// during "Save and close"; Save from Source; undo across a save; a stale dirty state; a Source edit's undo entry.
// Nothing here sets window.__marxyOrigBytes: that override masks exactly the dirty-state bugs under test.
import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { register } from 'node:module';
import { after, before, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { build } from 'vite';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';

register('./support/tauri-stub-hooks.mjs', import.meta.url);
globalThis.navigator ??= { platform: 'MacIntel' };
const { fs, hooks } = await import('./support/tauri-core-stub.mjs');
const { shell } = await import('../src/shell/tauri.ts');
const enc = (s) => new TextEncoder().encode(s);
const dec = (b) => new TextDecoder().decode(b);

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip }, fn);

const desktopRoot = new URL('..', import.meta.url).pathname;
const outDir = mkdtempSync(join(tmpdir(), 'marxy-r5-'));
let server;
let base;

before(async () => {
  if (skip) return;
  await build({ root: desktopRoot, logLevel: 'silent', build: {
      outDir,
      emptyOutDir: true,
      rollupOptions: { input: { app: join(desktopRoot, 'app.html'), paletteBoot: join(desktopRoot, 'test/palette-boot.html') } },
    },
  });
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.ttf': 'font/ttf' };
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

const b64 = (s) => Buffer.from(s).toString('base64');

async function open(browser, files, argv) {
  const page = await browser.newPage({ viewport: { width: 960, height: 900 } });
  await page.goto(`${base}app.html`);
  await page.waitForFunction(() => typeof window.marxyApp?.start === 'function');
  await page.evaluate(async ({ files, argv }) => {
    const handle = await window.marxyApp.start(files, argv);
    await handle.ready;
    window.__h = handle;
    window.__sh = handle.shell;
  }, { files, argv });
  await page.waitForTimeout(300);
  return page;
}

/** The save tests boot the way save.test.mjs does: the palette harness carries the save commands. */
async function openForSave(browser, files, argv) {
  const page = await browser.newPage({ viewport: { width: 960, height: 900 } });
  await page.goto(`${base}test/palette-boot.html`);
  await page.waitForFunction(() => typeof window.marxyPaletteBoot?.start === 'function');
  await page.evaluate(async ({ files, argv }) => {
    const boot = await window.marxyPaletteBoot.start(files, argv, []);
    window.__h = boot.handle;
    window.__sh = boot.handle.shell;
  }, { files, argv });
  await page.waitForFunction(() => window.__marxyTasksReady === true && typeof window.marxyHarnessSave === 'function');
  return page;
}

const mod = navigator.platform === 'MacIntel' ? 'Meta' : 'Control';

const notices = (page) =>
  page.evaluate(() => [...document.querySelectorAll('#marxy-notices .marxy-notice-text')].map((n) => n.textContent ?? ''));
const lastTitle = (page) => page.evaluate(() => __sh.calls.filter((c) => c.method === 'setTitle').at(-1)?.args[0]);
const buffer = (page) => page.evaluate(() => new TextDecoder().decode(__h.openDocument().buffer.bytes));
const disk = (page, p) => page.evaluate(async (p) => new TextDecoder().decode(await __sh.readFile(p)), p);
const dirty = (page) => page.evaluate(() => marxyDocumentEdit().dirty);
const confirmCalls = (page) => page.evaluate(() => __sh.calls.filter((c) => c.method === 'confirmClose').length);
const clickCheckbox = async (page, i) => {
  const before = await buffer(page);
  await page.evaluate((i) =>
    document.querySelectorAll('#doc input[type=checkbox]')[i].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })), i);
  await page.waitForFunction((b) => new TextDecoder().decode(__h.openDocument().buffer.bytes) !== b, before);
  await page.waitForTimeout(150);
};
const clickAction = (page, label) =>
  page.evaluate((label) => {
    [...document.querySelectorAll('button.marxy-notice-action')].find((b) => b.textContent === label)?.click();
  }, label);
const slowWrites = (page, ms = 600) =>
  page.evaluate((ms) => {
    const write = __sh.writeFileAtomic;
    __sh.writeFileAtomic = async (p, b) => { await new Promise((r) => setTimeout(r, ms)); return write(p, b); };
  }, ms);
const toSource = async (page) => {
  await page.keyboard.press(`${mod}+KeyE`);
  await page.waitForFunction(() => document.querySelector('#marxy-source .cm-editor'));
};
const typeInSource = async (page, text = ' typed') => {
  await toSource(page);
  await page.click('#marxy-source .cm-line >> nth=0');
  await page.keyboard.press('End');
  await page.keyboard.type(text);
};

const A = '# T\n\n- [ ] one\n- [ ] two\n';
const files = { '/d/a.md': b64(A), '/d/b.md': b64('# B\n') };

async function withPage(fn, f = files) {
  const browser = await launchWebkit();
  try {
    const page = await openForSave(browser, f, ['/d/a.md']);
    await fn(page);
  } finally {
    await browser.close();
  }
}

test('1: opening the path that is already open keeps its unsaved edits', () => withPage(async (page) => {
  await clickCheckbox(page, 0);
  await page.evaluate(() => __h.open('/d/a.md'));
  await page.waitForTimeout(500);
  assert.equal(await buffer(page), '# T\n\n- [x] one\n- [ ] two\n');
  assert.equal(await dirty(page), true);
  assert.deepEqual(await notices(page), [], 'no prompt: nothing is being left');
}));

test('2: a rename followed while the buffer has unsaved edits keeps them, dirty, under the new name', () => withPage(async (page) => {
  await clickCheckbox(page, 0);
  await page.evaluate(async () => {
    await __sh.writeFileAtomic('/d/moved.md', new TextEncoder().encode('# T\n\n- [ ] one\n- [ ] two\n'));
    __sh.emit([{ kind: 'renamed', path: '/d/a.md', to: '/d/moved.md' }]);
  });
  await page.waitForFunction(() => __h.currentPath() === '/d/moved.md');
  await page.waitForTimeout(400);
  assert.equal(await buffer(page), '# T\n\n- [x] one\n- [ ] two\n');
  assert.equal(await dirty(page), true);
  assert.match(await lastTitle(page), / •$/);
  assert.equal(await page.evaluate(() => marxyHarnessSave()), 'saved');
  assert.equal(await disk(page, '/d/moved.md'), '# T\n\n- [x] one\n- [ ] two\n', 'the save goes to the new name');
  assert.equal(await dirty(page), false);
}));

test('2b: a rename with nothing unsaved is still followed', () => withPage(async (page) => {
  await page.evaluate(async () => {
    await __sh.writeFileAtomic('/d/moved.md', new TextEncoder().encode('# T\n\n- [ ] one\n- [ ] two\n'));
    __sh.emit([{ kind: 'renamed', path: '/d/a.md', to: '/d/moved.md' }]);
  });
  await page.waitForFunction(() => __h.currentPath() === '/d/moved.md');
  assert.equal(await dirty(page), false);
}));

test('3: "Save and close" does not close over an edit made while it saved', () => withPage(async (page) => {
  await clickCheckbox(page, 0);
  await slowWrites(page);
  await page.evaluate(() => __sh.emitCloseRequested());
  await clickAction(page, 'Save and close');
  await page.waitForTimeout(100);
  await clickCheckbox(page, 1); // while the write is pending
  await page.waitForTimeout(1200);
  assert.equal(await confirmCalls(page), 0, 'the window did not close');
  assert.equal(await buffer(page), '# T\n\n- [x] one\n- [x] two\n');
  assert.equal(await dirty(page), true);
  assert.equal((await notices(page)).length, 1, 'the reader is asked again');
  await clickAction(page, 'Save and close');
  await page.waitForFunction(() => __sh.calls.some((c) => c.method === 'confirmClose'));
  assert.equal(await disk(page, '/d/a.md'), '# T\n\n- [x] one\n- [x] two\n');
}));

test('3b: "Save and open" does not open over an edit made while it saved', () => withPage(async (page) => {
  await clickCheckbox(page, 0);
  await slowWrites(page);
  await page.evaluate(() => __h.open('/d/b.md'));
  await clickAction(page, 'Save and open');
  await page.waitForTimeout(100);
  await clickCheckbox(page, 1);
  await page.waitForTimeout(1200);
  assert.equal(await page.evaluate(() => __h.currentPath()), '/d/a.md');
  assert.equal(await dirty(page), true);
}));

test('4: Mod+S saves from Source mode, Mod+Shift+S saves as', () => withPage(async (page) => {
  await typeInSource(page);
  await page.keyboard.press(`${mod}+KeyS`);
  await page.waitForFunction(async () => new TextDecoder().decode(await __sh.readFile('/d/a.md')).startsWith('# T typed'));
  assert.equal(await dirty(page), false);
  await page.evaluate(() => __sh.queueSaveDialog('/d/c.md'));
  await page.keyboard.type(' more');
  await page.keyboard.press(`${mod}+Shift+KeyS`);
  await page.waitForFunction(() => __h.currentPath() === '/d/c.md');
  assert.equal((await disk(page, '/d/c.md')).split('\n')[0], '# T typed more');
  assert.equal(await disk(page, '/d/a.md'), '# T typed\n\n- [ ] one\n- [ ] two\n', 'the original keeps what Save wrote');
}));

test('5: an edit made while a save was in flight can still be undone', () => withPage(async (page) => {
  await clickCheckbox(page, 0);
  await slowWrites(page);
  const saving = page.evaluate(() => marxyHarnessSave());
  await page.waitForTimeout(100);
  await clickCheckbox(page, 1);
  assert.equal(await saving, 'saved');
  await page.keyboard.press(`${mod}+KeyZ`);
  await page.waitForFunction(() => new TextDecoder().decode(__h.openDocument().buffer.bytes) === '# T\n\n- [x] one\n- [ ] two\n');
  assert.equal(await dirty(page), false, 'back at what was written');
}));

test('8: an external write that makes the file equal the unsaved buffer leaves nothing unsaved', () => withPage(async (page) => {
  await clickCheckbox(page, 0);
  await page.evaluate(async () => {
    await __sh.writeFileAtomic('/d/a.md', new TextEncoder().encode('# T\n\n- [x] one\n- [ ] two\n'));
    __sh.emit([{ kind: 'modified', path: '/d/a.md' }]);
  });
  await page.waitForFunction(() => !marxyDocumentEdit().dirty);
  assert.doesNotMatch(await lastTitle(page), / •$/);
  await page.evaluate(() => __sh.emitCloseRequested());
  assert.equal(await confirmCalls(page), 1, 'closes without a prompt');
}));

test('9: leaving Source for Rendered is one undo entry', () => withPage(async (page) => {
  await typeInSource(page);
  await page.keyboard.press(`${mod}+KeyE`);
  await page.waitForFunction(() => new TextDecoder().decode(__h.openDocument().buffer.bytes).startsWith('# T typed'));
  await page.waitForTimeout(300);
  await page.keyboard.press(`${mod}+KeyZ`);
  await page.waitForFunction(() => new TextDecoder().decode(__h.openDocument().buffer.bytes) === '# T\n\n- [ ] one\n- [ ] two\n');
  assert.equal(await dirty(page), false);
}));
