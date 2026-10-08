// Undo follows the document store, not a content hash (B-11, ADR-0037 §3). The ADR's defect 2 sequence
// end to end in WebKit — tick a task, type in Source, come back, undo twice — plus rename and reload,
// and a source-text check that the modules which used to hold the history hold no state now.
// Nothing here sets window.__marxyOrigBytes: the store's own `dirty` is what is under test.
import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { after, before, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { build } from 'vite';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';

const desktopRoot = new URL('..', import.meta.url).pathname;

/** A module's source without comments, so a word in prose does not count as code. */
function code(rel) {
  return readFileSync(join(desktopRoot, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

nodeTest('commands/edits.ts and save.ts hold no module-level let and no History instance', () => {
  for (const rel of ['src/commands/edits.ts', 'src/save.ts']) {
    const src = code(rel);
    assert.doesNotMatch(src, /^(export\s+)?(let|var)\s/m, `${rel} keeps module state; the store owns it (ADR-0037)`);
    assert.doesNotMatch(src, /\bHistory\b/, `${rel} keeps its own undo history; the store owns it (ADR-0037 §3)`);
  }
});

nodeTest('Save as while another document opens: the closed store is refused as cancelled, nothing written, no rejection', async () => {
  const { openDocumentStore } = await import('../src/document/store.ts');
  const { save } = await import('../src/save.ts');
  const enc = new TextEncoder();
  const writes = [];
  const io = { async writeFileAtomic(p) { writes.push(p); }, recordRead() {} };
  const store = openDocumentStore(io, '/repo/doc.md', enc.encode('# T\n\n- [ ] one\n'));
  const at = 7;
  assert.equal(await store.apply({ range: { file: '/repo/doc.md', start: at, end: at + 3 }, replacement: '[x]', label: 'Toggle task' }), true);
  const unhandled = [];
  const onUnhandled = (e) => unhandled.push(e);
  process.on('unhandledRejection', onUnhandled);
  try {
    const result = await save({
      store,
      shell: {
        // The dialog is up; the reader opens another document, which closes this store.
        async saveDialog() { store.close(); return '/repo/other.md'; },
        async setTitle() {},
        async allowAssetScope() {},
      },
      async foldSource() {},
      async onSaveAs() { throw new Error('onSaveAs must not run'); },
    }, { as: true });
    assert.equal(result, 'cancelled');
    await new Promise((r) => setTimeout(r, 20));
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
  assert.deepEqual(unhandled, []);
  assert.deepEqual(writes, [], 'a closed store writes nothing');
});

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip }, fn);

const outDir = mkdtempSync(join(tmpdir(), 'marxy-store-undo-'));
let server;
let base;
let browser;

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
  browser = await launchWebkit();
});
after(async () => {
  await browser?.close();
  server?.close();
});

const PATH = '/d/t.md';
const ORIGINAL = '# T\n\nhello\n\n- [ ] one\n- [ ] two\n';

async function boot(text = ORIGINAL) {
  const page = await browser.newPage({ viewport: { width: 960, height: 900 } });
  await page.goto(`${base}test/palette-boot.html`);
  await page.waitForFunction(() => typeof window.marxyPaletteBoot?.start === 'function');
  await page.evaluate(async ({ b64, path }) => {
    const r = await window.marxyPaletteBoot.start({ [path]: b64 }, [path], []);
    window.__handle = r.handle;
  }, { b64: Buffer.from(text).toString('base64'), path: PATH });
  await page.waitForFunction(() => window.__marxyTasksReady === true && typeof window.marxyHarnessSave === 'function');
  return page;
}

const modOf = async (page) => ((await page.evaluate(() => navigator.platform)) === 'MacIntel' ? 'Meta' : 'Control');
const buf = (page) => page.evaluate(() => new TextDecoder().decode(window.__handle.openDocument().buffer.bytes));
const untilBuffer = (page, text) =>
  page.waitForFunction((t) => new TextDecoder().decode(window.__handle.openDocument().buffer.bytes) === t, text, { timeout: 5000 });
const canUndo = (page) => page.evaluate(() => window.__handle.document().snapshot().canUndo);
/**
 * Mod+E, then wait until the mode has changed and focus is where a following key will land: in Source
 * the editor holds focus only after the reader's click, and in Rendered it is outside the hidden editor
 * (WebKit drops a hidden element's focus at a later rendering update, so Mod+Z could go to the editor).
 */
const toggleMode = async (page, m) => {
  await page.keyboard.press(`${await modOf(page)}+e`);
  await page.waitForFunction((m) => document.body.dataset.marxyMode === m, m);
  if (m === 'rendered') await page.waitForFunction(() => !document.querySelector('#marxy-source')?.contains(document.activeElement));
};
/**
 * A click on the box once it has stopped moving: the typeset pass may still shift the page after the
 * tasks are wired, and a click at coordinates read before the shift lands beside the box. (The box is
 * `disabled`, so Playwright's own actionability wait refuses it; the stability check is done here.)
 */
const clickBox = async (page, i) => {
  const [x, y] = await page.evaluate(async (i) => {
    const el = document.querySelectorAll('#doc input[type=checkbox]')[i];
    el.scrollIntoView({ block: 'center' });
    const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
    const at = () => { const r = el.getBoundingClientRect(); return `${r.x},${r.y}`; };
    let last = at();
    // Counted in frames, not time: a box that never settles (or a page that stops painting) fails the test.
    for (let same = 0, frames = 0; same < 3; frames += 1) {
      if (frames >= 300) throw new Error('checkbox never held still');
      await frame();
      const now = at();
      same = now === last ? same + 1 : 0;
      last = now;
    }
    const r = el.getBoundingClientRect();
    return [r.x + r.width / 2, r.y + r.height / 2];
  }, i);
  await page.mouse.click(x, y);
};
const undoKey = async (page) => page.keyboard.press(`${await modOf(page)}+z`);
/** Mod+Z once the store has something to undo: the command is gated on it, and a key it refuses is dropped silently. */
const undoWhenReady = async (page) => {
  await page.waitForFunction(() => window.__handle.document().snapshot().canUndo);
  await undoKey(page);
};

test('AppHandle.dispatch reaches the store\'s transitions: apply, then undo, then redo (ADR-0037 §2)', async () => {
  const page = await boot();
  const toggled = ORIGINAL.replace('- [ ] one', '- [x] one');
  const at = ORIGINAL.indexOf('- [ ] one') + 2;
  const applied = await page.evaluate(
    (at) => window.__handle.dispatch({ type: 'apply', range: { file: '/d/t.md', start: at, end: at + 3 }, replacement: '[x]', label: 'Toggle task' }),
    at,
  );
  assert.equal(applied, true);
  await untilBuffer(page, toggled);
  await page.evaluate(() => window.__handle.dispatch({ type: 'undo' }));
  await untilBuffer(page, ORIGINAL);
  assert.equal(await canUndo(page), false, 'the undo took the one entry');
  await page.evaluate(() => window.__handle.dispatch({ type: 'redo' }));
  await untilBuffer(page, toggled);
  await page.close();
});

test('ADR-0037 defect 2: toggle, Source edit, two undos restore the original', async () => {
  const page = await boot();
  const toggled = ORIGINAL.replace('- [ ] one', '- [x] one');
  await clickBox(page, 0);
  await untilBuffer(page, toggled);
  await toggleMode(page, 'source');
  await page.click('.cm-content');
  await page.waitForFunction(() => document.querySelector('#marxy-source .cm-content')?.contains(document.activeElement));
  await page.keyboard.press((await modOf(page)) === 'Meta' ? 'Meta+ArrowUp' : 'Control+Home');
  await page.keyboard.type('X');
  await toggleMode(page, 'rendered');
  await untilBuffer(page, `X${toggled}`);
  await undoWhenReady(page);
  await untilBuffer(page, toggled);
  await undoWhenReady(page);
  await untilBuffer(page, ORIGINAL);
  assert.equal(await buf(page), ORIGINAL);
  assert.equal(await canUndo(page), false, 'two entries, two undos');
  assert.equal(await page.evaluate(() => window.marxyDocumentEdit().dirty), false, 'back at the bytes on disk');
  await page.close();
});

test('F-12: focus has left the hidden Source editor at the moment the mode flips to Rendered', async () => {
  const page = await boot();
  await toggleMode(page, 'source');
  await page.click('.cm-content');
  await page.waitForFunction(() => document.querySelector('#marxy-source .cm-content')?.contains(document.activeElement));
  // A mutation callback runs right after the task that flipped the attribute, before WebKit's next
  // rendering update (which is when it would blur a hidden element by itself).
  await page.evaluate(() => {
    window.__focusInSourceAtFlip = null;
    new MutationObserver(() => {
      if (document.body.dataset.marxyMode === 'rendered' && window.__focusInSourceAtFlip === null) {
        window.__focusInSourceAtFlip = Boolean(document.querySelector('#marxy-source')?.contains(document.activeElement));
      }
    }).observe(document.body, { attributes: true, attributeFilter: ['data-marxy-mode'] });
  });
  await page.keyboard.press(`${await modOf(page)}+e`);
  await page.waitForFunction(() => window.__focusInSourceAtFlip !== null);
  assert.equal(await page.evaluate(() => window.__focusInSourceAtFlip), false, 'Mod+Z right after the flip would go to the hidden editor');
  await page.close();
});

test('undo while Source holds typing not yet in the document: the typing goes, the earlier edit stays', async () => {
  const page = await boot();
  const toggled = ORIGINAL.replace('- [ ] one', '- [x] one');
  await clickBox(page, 0);
  await untilBuffer(page, toggled);
  await toggleMode(page, 'source');
  await page.click('.cm-content');
  await page.waitForFunction(() => document.querySelector('#marxy-source .cm-content')?.contains(document.activeElement));
  await page.keyboard.press((await modOf(page)) === 'Meta' ? 'Meta+ArrowUp' : 'Control+Home');
  await page.keyboard.type('X');
  // No leave, no wait for canUndo: the typing is only in the editor. Undo (the palette's command, as
  // in Source Mod+Z belongs to the editor) must fold it in first, then step it out.
  assert.equal(await buf(page), toggled, 'the typing is not in the document yet');
  await page.evaluate(() => window.marxyHarnessUndo());
  // The undo has run once there is something to redo. The buffer is `toggled` before and after, so it
  // cannot say so; without the fold, undo would step over the task toggle instead (buffer ORIGINAL).
  await page.waitForFunction(() => window.__handle.document().snapshot().canRedo);
  assert.equal(await buf(page), toggled, 'only the typing was undone');
  assert.equal(await canUndo(page), true, 'the task toggle is still in the history');
  await page.close();
});

test('rename keeps history: an unsaved edit followed to the new name can still be undone', async () => {
  const page = await boot();
  const toggled = ORIGINAL.replace('- [ ] one', '- [x] one');
  await clickBox(page, 0);
  await untilBuffer(page, toggled);
  await page.evaluate(async (text) => {
    const sh = window.__handle.shell;
    await sh.writeFileAtomic('/d/moved.md', new TextEncoder().encode(text));
    sh.emit([{ kind: 'renamed', path: '/d/t.md', to: '/d/moved.md' }]);
  }, ORIGINAL);
  await page.waitForFunction(() => window.__handle.currentPath() === '/d/moved.md');
  assert.equal(await buf(page), toggled, 'the unsaved edit followed the rename');
  assert.equal(await canUndo(page), true, 'the history followed the rename');
  await page.click('#doc h1');
  await undoWhenReady(page);
  await untilBuffer(page, ORIGINAL);
  await page.close();
});

test('a clean reload clears history: Mod+Z then does nothing', async () => {
  const page = await boot();
  const toggled = ORIGINAL.replace('- [ ] one', '- [x] one');
  await clickBox(page, 0);
  await untilBuffer(page, toggled);
  assert.equal(await page.evaluate(() => window.marxyHarnessSave()), 'saved');
  assert.equal(await canUndo(page), true, 'a save keeps history');
  const external = `${toggled}\nfrom disk\n`;
  await page.evaluate(async ([p, text]) => {
    const sh = window.__handle.shell;
    await sh.writeFileAtomic(p, new TextEncoder().encode(text));
    sh.emit([{ kind: 'modified', path: p }]);
  }, [PATH, external]);
  await untilBuffer(page, external);
  assert.equal(await canUndo(page), false, 'the reload cleared the history');
  await page.click('#doc h1');
  await undoKey(page);
  await page.waitForTimeout(400);
  assert.equal(await buf(page), external, 'Mod+Z after a clean reload changes nothing');
  await page.close();
});
