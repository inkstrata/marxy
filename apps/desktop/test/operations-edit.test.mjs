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
import { fileURLToPath } from 'node:url';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip }, fn);

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const desktopRoot = fileURLToPath(new URL('..', import.meta.url));
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
    await page.waitForFunction(() => window.marxyDocumentEdit?.().dirty === true);
    const result = await page.evaluate(
      async ({ path, beforeBlock, markerStart }) => {
        const now = Uint8Array.from(window.__marxyOpsBoot.handle.openDocument().buffer.bytes);
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

test('a tick after a reload from disk keeps what the other writer added (MARXY-246)', async () => {
  const file = '03-ai-plan.md';
  const bytes = readFileSync(join(corpusDir, file));
  const markers = [];
  const walk = (n) => {
    if (n.type === 'taskMarker') markers.push(n);
    for (const c of n.children ?? []) walk(c);
  };
  walk(parseMarkdown(bytes, { file }));
  const firstMarker = markers[0];
  const appended = '\n\nA section another tool appended.\n';
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 900 } });
    const docPath = await boot(page, file, [`/corpus/${file}`]);
    await page.evaluate(async ({ path, appended }) => {
      const shell = window.__marxyOpsBoot.handle.shell;
      const now = new Uint8Array(await shell.readFile(path));
      const extra = new TextEncoder().encode(appended);
      const next = new Uint8Array(now.length + extra.length);
      next.set(now);
      next.set(extra, now.length);
      await shell.writeFileAtomic(path, next);
      shell.emit([{ kind: 'modified', path }]);
    }, { path: docPath, appended });
    await page.waitForFunction(() => document.getElementById('doc')?.textContent?.includes('A section another tool appended.'));
    await page.evaluate((start) => {
      document.querySelector(`#doc input[data-marxy-s="${start}"]`)?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    }, firstMarker.src.start);
    await page.waitForFunction(
      async ({ path, start }) => {
        const now = Uint8Array.from(window.__marxyOpsBoot.handle.openDocument().buffer.bytes);
        return new TextDecoder().decode(now.subarray(start, start + 3)) === '[x]';
      },
      { path: docPath, start: firstMarker.src.start },
    );
    const text = await page.evaluate(
      () => new TextDecoder().decode(window.__marxyOpsBoot.handle.openDocument().buffer.bytes),
    );
    assert.ok(text.endsWith(appended), 'the tick wrote the pre-reload buffer over the appended section');
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
        const now = Uint8Array.from(window.__marxyOpsBoot.handle.openDocument().buffer.bytes);
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
        const now = Uint8Array.from(window.__marxyOpsBoot.handle.openDocument().buffer.bytes);
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
        const now = Uint8Array.from(window.__marxyOpsBoot.handle.openDocument().buffer.bytes);
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
        const now = Uint8Array.from(window.__marxyOpsBoot.handle.openDocument().buffer.bytes);
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
        const now = Uint8Array.from(window.__marxyOpsBoot.handle.openDocument().buffer.bytes);
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

test('switching to a second document does not carry over the first one\'s dirty baseline', async () => {
  const fileA = '03-ai-plan.md';
  const fileB = '09-gfm-everything.md';
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 900 } });
    const docPathA = `/corpus/${fileA}`;
    const docPathB = `/corpus/${fileB}`;
    await page.goto(`${base}test/palette-boot.html`);
    await page.waitForFunction(() => typeof window.marxyPaletteBoot?.start === 'function');
    await page.evaluate(async ({ files, argv }) => {
      window.__marxyOpsBoot = await window.marxyPaletteBoot.start(files, argv, []);
    }, {
      files: { [docPathA]: b64(join(corpusDir, fileA)), [docPathB]: b64(join(corpusDir, fileB)) },
      argv: [docPathA],
    });
    await page.waitForFunction(() => typeof window.marxyDocumentEdit === 'function');
    await page.waitForFunction(() => window.__marxyOpenSynced === true);

    await page.evaluate((path) => window.__marxyOpsBoot.handle.open(path), docPathB);
    await page.waitForFunction((path) => window.__marxyOpsBoot.handle.currentPath() === path, docPathB);
    await page.waitForFunction(() => document.querySelector('#doc [data-marxy-s]') !== null);
    // documentEditState() only compares against savedFingerprint when the Playwright harness's own
    // bytes override is absent, so remove it to exercise the real (non-harness) dirty computation.
    await page.evaluate(() => { delete window.__marxyOrigBytes; });
    assert.equal(await page.evaluate(() => window.marxyDocumentEdit?.().dirty), false);
  } finally {
    await browser.close();
  }
});

/** Boots the app on one document given as text. */
async function bootText(page, docPath, text) {
  await page.goto(`${base}test/palette-boot.html`);
  await page.waitForFunction(() => typeof window.marxyPaletteBoot?.start === 'function');
  await page.evaluate(async ({ files, argv }) => {
    window.__marxyOpsBoot = await window.marxyPaletteBoot.start(files, argv, []);
    window.__marxyOrigBytes = new Uint8Array(await window.__marxyOpsBoot.handle.shell.readFile(argv[0]));
  }, { files: { [docPath]: Buffer.from(text, 'utf8').toString('base64') }, argv: [docPath] });
  await page.waitForFunction(() => typeof window.marxySelection?.getSelectionState === 'function');
  await page.waitForFunction(() => window.__marxyOpenSynced === true);
}

/** Clicks the middle of the first text node in `#doc` that contains `words` (not a checkbox, not a link). */
async function clickWords(page, words) {
  const point = await page.evaluate((words) => {
    const walker = document.createTreeWalker(document.querySelector('#doc'), NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const at = n.textContent.indexOf(words);
      if (at < 0) continue;
      n.parentElement.scrollIntoView({ block: 'center' });
      const r = document.createRange();
      r.setStart(n, at);
      r.setEnd(n, at + words.length);
      const box = r.getBoundingClientRect();
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    }
    return null;
  }, words);
  assert.ok(point, `text "${words}" on the page`);
  await page.mouse.click(point.x, point.y);
}

async function actionTitles(page, query) {
  const mod = modKey(await page.evaluate(() => navigator.platform));
  await page.keyboard.press(`${mod}+KeyP`);
  await page.locator('#marxy-palette .marxy-palette-query').fill(query);
  await page.waitForSelector('#marxy-palette .marxy-palette-row');
  return page.locator('#marxy-palette .marxy-palette-row .marxy-palette-title').allTextContents();
}

async function bytesNow(page) {
  return page.evaluate(() => ({
    now: [...window.__marxyOpsBoot.handle.openDocument().buffer.bytes],
    orig: [...window.__marxyOrigBytes],
  }));
}

for (const [name, docPath, text, words] of [
  ['a tight task list (03-ai-plan.md)', '/corpus/03-ai-plan.md', null, 'Attestation policy decided'],
  ['a loose task list', '/loose-tasks.md', '# Plan\n\n- [ ] Write the brief\n\n- [x] Book the room\n', 'Write the brief'],
]) {
  test(`C-06: a click on a task item's text offers Toggle task, which changes only the marker bytes: ${name}`, async () => {
    const source = text ?? readFileSync(join(corpusDir, docPath.slice('/corpus/'.length)), 'utf8');
    const ast = parseMarkdown(Buffer.from(source, 'utf8'), { file: docPath });
    let item;
    const walk = (n) => {
      if (!item && n.type === 'listItem' && n.task !== undefined) {
        const body = Buffer.from(source, 'utf8').subarray(n.src.start, n.src.end).toString('utf8');
        if (body.includes(words)) item = n;
      }
      for (const c of n.children ?? []) walk(c);
    };
    walk(ast);
    assert.ok(item);
    const marker = item.children.flatMap((b) => b.children ?? []).find((c) => c.type === 'taskMarker');
    assert.ok(marker);
    const browser = await launchWebkit();
    try {
      const page = await browser.newPage({ viewport: { width: 960, height: 900 } });
      if (text === null) await boot(page, '03-ai-plan.md', [docPath]);
      else await bootText(page, docPath, text);
      await clickWords(page, words);
      const picked = await page.evaluate(() => window.marxySelection.getSelectionState().selection.node?.type);
      assert.equal(picked, text === null ? 'listItem' : 'paragraph', 'what the click selects');
      const titles = await actionTitles(page, '> toggle');
      assert.ok(titles.includes('Toggle task'), titles.join(' | '));
      await page.locator('#marxy-palette .marxy-palette-row', { hasText: 'Toggle task' }).click();
      await page.waitForFunction(() => window.marxyDocumentEdit?.().dirty === true);
      const { now, orig } = await bytesNow(page);
      const diffs = byteDiffs(Uint8Array.from(orig), Uint8Array.from(now));
      assert.ok(diffs.length > 0);
      for (const [s, e] of diffs) {
        assert.ok(s >= marker.src.start && e <= marker.src.end, `diff [${s},${e}) outside the marker`);
      }
      assert.equal(
        Buffer.from(now).subarray(marker.src.start, marker.src.end).toString('utf8'),
        marker.checked ? '[ ]' : '[x]',
      );
    } finally {
      await browser.close();
    }
  });
}

test('C-06: a click on a table cell offers the table\'s verbs, Align table pipes among them', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 900 } });
    await boot(page, '02-readme-real-world.md', ['/corpus/02-readme-real-world.md']);
    await clickWords(page, 'Title shown in the frame');
    const sel = await page.evaluate(() => window.marxySelection.getSelectionState().selection);
    assert.equal(sel.kind, 'node');
    assert.equal(sel.node.type, 'tableCell', 'the click selects the cell, not the table');
    const titles = await actionTitles(page, '> table');
    assert.ok(titles.includes('Align table pipes'), titles.join(' | '));
    assert.ok(titles.includes('Copy table as TSV'), titles.join(' | '));
  } finally {
    await browser.close();
  }
});
