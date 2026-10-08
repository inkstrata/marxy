// The verb menu (C-13, ADR-0054): right-click, the context-menu key, Shift+F10 or Enter opens one themed
// menu of the selection's verbs; nothing of it exists at rest. Palette harness, WebKit.
import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { after, before, test as nodeTest } from 'node:test';
import { fileURLToPath } from 'node:url';
import { webkit } from 'playwright';
import { build } from 'vite';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { createBuffer, parseMarkdown, textOf } from '../../../packages/core/src/index.ts';
import { copyTableTsv } from '../../../packages/core/src/operations/copy-table.ts';
import { OPERATIONS } from '../../../packages/core/src/operations/index.ts';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip }, fn);

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const desktopRoot = fileURLToPath(new URL('..', import.meta.url));
const corpusDir = join(repoRoot, 'fixtures', 'corpus');
const outDir = mkdtempSync(join(tmpdir(), 'marxy-verb-menu-'));
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
      rollupOptions: { input: { paletteBoot: join(desktopRoot, 'test/palette-boot.html') } },
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

const MENU = '.marxy-verb-menu, [role="menu"]';

async function boot(file) {
  const page = await browser.newPage({ viewport: { width: 960, height: 900 } });
  const docPath = `/corpus/${file}`;
  await page.goto(`${base}test/palette-boot.html`);
  await page.waitForFunction(() => typeof window.marxyPaletteBoot?.start === 'function');
  await page.evaluate(async ({ files, argv }) => {
    window.__marxyOpsBoot = await window.marxyPaletteBoot.start(files, argv, []);
    window.__testOrigBytes = new Uint8Array(await window.__marxyOpsBoot.handle.shell.readFile(argv[0]));
  }, { files: { [docPath]: readFileSync(join(corpusDir, file)).toString('base64') }, argv: [docPath] });
  await page.waitForFunction(() => typeof window.marxySelection?.getSelectionState === 'function');
  await page.waitForFunction(() => window.__marxyOpenSynced === true);
  return page;
}

async function modKey(page) {
  return (await page.evaluate(() => navigator.platform)) === 'MacIntel' ? 'Meta' : 'Control';
}

const menuExists = (page) => page.evaluate((sel) => document.querySelector(sel) !== null, MENU);

/** The open menu's rows: title, command id (`data-row-key`), chord, and which one has focus. */
function menuRows(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('.marxy-verb-menu [role="menuitem"]')].map((row) => ({
      title: row.querySelector('.marxy-verb-menu-title')?.textContent,
      id: row.getAttribute('data-row-key'),
      key: row.querySelector('.marxy-verb-menu-key')?.textContent ?? null,
      shortcut: row.getAttribute('aria-keyshortcuts'),
      focused: document.activeElement === row,
    })),
  );
}

const clipboard = (page) =>
  page.evaluate(() => window.__marxyOpsBoot.handle.shell.calls.filter((c) => c.method === 'clipboardWrite').map((c) => c.args[0]));

/** The point at the middle of the first occurrence of `words` in the article's text. */
async function wordsPoint(page, words) {
  const point = await page.evaluate((words) => {
    const walker = document.createTreeWalker(document.getElementById('doc'), NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const at = n.data.indexOf(words);
      if (at < 0) continue;
      const r = document.createRange();
      r.setStart(n, at);
      r.setEnd(n, at + words.length);
      const box = r.getBoundingClientRect();
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    }
    return null;
  }, words);
  assert.ok(point, `text "${words}" on the page`);
  return point;
}

function byteDiffs(a, b) {
  const n = Math.max(a.length, b.length);
  const ranges = [];
  let start = -1;
  for (let i = 0; i < n; i++) {
    const diff = (a[i] ?? -1) !== (b[i] ?? -2);
    if (diff && start < 0) start = i;
    if (!diff && start >= 0) { ranges.push([start, i]); start = -1; }
  }
  if (start >= 0) ranges.push([start, n]);
  return ranges;
}

test('C-13: nothing of the menu is in the DOM at rest, after it closes, or after a verb runs', async () => {
  const page = await boot('28-llm-answer.md');
  try {
    assert.equal(await menuExists(page), false, 'at rest');
    await page.locator('#doc pre[data-marxy-s]').first().click({ button: 'right' });
    assert.equal(await menuExists(page), true, 'open');
    assert.equal(await page.locator('.marxy-verb-menu').getAttribute('role'), 'menu');
    await page.keyboard.press('Escape');
    assert.equal(await menuExists(page), false, 'after Escape');
    await page.locator('#doc pre[data-marxy-s]').first().click({ button: 'right' });
    await page.locator('.marxy-verb-menu [role="menuitem"]').first().click();
    await page.waitForFunction(() => window.__marxyOpsBoot.handle.shell.calls.some((c) => c.method === 'clipboardWrite'));
    assert.equal(await menuExists(page), false, 'after running a verb');
    // A click outside, and a scroll, close it too.
    await page.locator('#doc pre[data-marxy-s]').first().click({ button: 'right' });
    await page.mouse.click(5, 5);
    assert.equal(await menuExists(page), false, 'after a click outside');
    await page.locator('#doc pre[data-marxy-s]').first().click({ button: 'right' });
    await page.mouse.move(480, 450);
    await page.mouse.wheel(0, 200);
    await page.waitForFunction((sel) => document.querySelector(sel) === null, MENU);
  } finally {
    await page.close();
  }
});

test("C-13: right-click a table cell offers the table's verbs, TSV first, and choosing it copies the TSV", async () => {
  const file = '28-llm-answer.md';
  const bytes = readFileSync(join(corpusDir, file));
  const ast = parseMarkdown(bytes, { file });
  const table = ast.children.find((n) => n.type === 'table');
  assert.ok(table);
  const expected = copyTableTsv.run({ document: ast, node: table, range: table.src, text: textOf(createBuffer(file, bytes), table.src) })
    .clipboard.text;
  const page = await boot(file);
  try {
    await page.locator('#doc td').nth(1).click({ button: 'right' });
    const rows = await menuRows(page);
    const verbs = rows.filter((r) => r.id !== 'palette.all-actions');
    assert.equal(verbs[0]?.title, 'Copy table as TSV', rows.map((r) => r.title).join(' | '));
    assert.equal(verbs[0]?.key, (await modKey(page)) === 'Meta' ? '⌘C' : 'Ctrl+C', 'the default verb shows Mod+C');
    assert.ok(verbs[0]?.shortcut?.endsWith('+C'), 'aria-keyshortcuts names the chord');
    assert.ok(verbs.some((r) => r.title === 'Align table pipes'), rows.map((r) => r.title).join(' | '));
    assert.ok(verbs.length <= 7, `${verbs.length} verb rows`);
    const label = await page.locator('.marxy-verb-menu').getAttribute('aria-label');
    assert.equal(label, 'Table');
    await page.locator('.marxy-verb-menu [role="menuitem"]').first().click();
    await page.waitForFunction(() => window.__marxyOpsBoot.handle.shell.calls.some((c) => c.method === 'clipboardWrite'));
    const copies = await clipboard(page);
    assert.equal(copies.length, 1);
    assert.equal(copies[0].text, expected);
  } finally {
    await page.close();
  }
});

test("C-13: right-click a task item's text offers Toggle task, which changes only the marker bytes", async () => {
  const file = '03-ai-plan.md';
  const words = 'Attestation policy decided';
  const source = readFileSync(join(corpusDir, file), 'utf8');
  const ast = parseMarkdown(Buffer.from(source, 'utf8'), { file });
  let item;
  const walk = (n) => {
    if (!item && n.type === 'listItem' && n.task !== undefined && source.slice(n.src.start, n.src.end).includes(words)) item = n;
    for (const c of n.children ?? []) walk(c);
  };
  walk(ast);
  assert.ok(item);
  const marker = item.children.flatMap((b) => b.children ?? []).find((c) => c.type === 'taskMarker');
  assert.ok(marker);
  const page = await boot(file);
  try {
    const { x, y } = await wordsPoint(page, words);
    await page.mouse.click(x, y, { button: 'right' });
    const rows = await menuRows(page);
    assert.ok(rows.some((r) => r.title === 'Toggle task'), rows.map((r) => r.title).join(' | '));
    assert.equal(await page.locator('.marxy-verb-menu').getAttribute('aria-label'), 'Task');
    await page.locator('.marxy-verb-menu [role="menuitem"]', { hasText: 'Toggle task' }).click();
    await page.waitForFunction(() => window.marxyDocumentEdit?.().dirty === true);
    const { now, orig } = await page.evaluate(() => ({
      now: [...window.__marxyOpsBoot.handle.openDocument().buffer.bytes],
      orig: [...window.__testOrigBytes],
    }));
    const diffs = byteDiffs(orig, now);
    assert.ok(diffs.length > 0);
    for (const [s, e] of diffs) assert.ok(s >= marker.src.start && e <= marker.src.end, `diff [${s},${e}) outside the marker`);
    assert.equal(await menuExists(page), false);
  } finally {
    await page.close();
  }
});

test('C-13: Enter on a clicked code block opens the menu with the first row focused; ArrowDown, Enter runs the second', async () => {
  const file = '28-llm-answer.md';
  const bytes = readFileSync(join(corpusDir, file));
  const ast = parseMarkdown(bytes, { file });
  const block = ast.children.find((n) => n.type === 'codeBlock');
  assert.ok(block?.lang === 'bash');
  const input = { document: ast, node: block, range: block.src, text: textOf(createBuffer(file, bytes), block.src) };
  const page = await boot(file);
  try {
    const pre = page.locator('#doc pre[data-marxy-s]').first();
    await pre.click();
    const before = await page.evaluate(() => document.activeElement?.tagName);
    await page.keyboard.press('Enter');
    let rows = await menuRows(page);
    assert.ok(rows.length >= 2, rows.map((r) => r.title).join(' | '));
    assert.equal(rows[0].focused, true, 'the first row has focus');
    assert.equal(await page.locator('.marxy-verb-menu').getAttribute('aria-label'), 'Code block, bash');
    // Opened under the block, at its left edge.
    const [box, menuBox] = [await pre.boundingBox(), await page.locator('.marxy-verb-menu').boundingBox()];
    assert.ok(Math.abs(menuBox.x - box.x) <= 5 || menuBox.y + menuBox.height <= box.y + 1, `anchored to the block: ${JSON.stringify({ box, menuBox })}`);
    // The second verb in the written order for this block (it has no prompts, so Copy command does not apply).
    const second = OPERATIONS.find((op) => `op.${op.id}` === rows[1].id);
    assert.ok(second?.canApply(input), rows[1].id);
    const expected = second.run(input).clipboard.text;
    await page.keyboard.press('ArrowDown');
    rows = await menuRows(page);
    assert.equal(rows[1].focused, true);
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.__marxyOpsBoot.handle.shell.calls.some((c) => c.method === 'clipboardWrite'));
    const copies = await clipboard(page);
    assert.equal(copies.length, 1, 'one verb ran, once');
    assert.equal(copies[0].text, expected);
    assert.equal(await menuExists(page), false);
    assert.equal(await page.evaluate(() => document.activeElement?.tagName), before, 'focus returned where it was');

    // ArrowUp wraps to the last row; End and Home move to the ends.
    await page.keyboard.press('Shift+F10');
    assert.equal(await menuExists(page), true, 'Shift+F10 opens it');
    await page.keyboard.press('ArrowUp');
    rows = await menuRows(page);
    assert.equal(rows.at(-1).focused, true, 'ArrowUp from the first row wraps');
    await page.keyboard.press('Home');
    assert.equal((await menuRows(page))[0].focused, true);
    await page.keyboard.press('Escape');
    assert.equal(await menuExists(page), false, 'Escape closes it');

    await page.keyboard.press('ContextMenu');
    assert.equal(await menuExists(page), true, 'the context-menu key opens it');
    await page.keyboard.press('Escape');
    assert.equal(await menuExists(page), false);
    const kept = await page.evaluate(() => ({
      kind: window.marxySelection.getSelectionState().selection.kind,
      painted: document.querySelector('#doc pre .marxy-selected, #doc pre.marxy-selected') !== null,
    }));
    assert.deepEqual(kept, { kind: 'node', painted: true }, 'Escape keeps the block selected');
    assert.equal(await page.evaluate(() => document.activeElement?.tagName), before, 'focus returned after Escape');

    // Tab closes too.
    await page.keyboard.press('Enter');
    await page.keyboard.press('Tab');
    assert.equal(await menuExists(page), false, 'Tab closes it');
  } finally {
    await page.close();
  }
});

test("C-13: every command in the menu is also in the palette's > list, for three selections", async () => {
  const page = await boot('28-llm-answer.md');
  const mod = await modKey(page);
  try {
    const targets = [
      ['a table cell', () => page.locator('#doc td').first()],
      ['a code block', () => page.locator('#doc pre[data-marxy-s]').first()],
      ['a heading', () => page.locator('#doc h2').first()],
    ];
    for (const [name, locate] of targets) {
      await locate().click({ button: 'right' });
      const menu = (await menuRows(page)).map((r) => r.id).filter((id) => id !== 'palette.all-actions');
      assert.ok(menu.length > 0, name);
      await page.keyboard.press('Escape');
      await page.keyboard.press(`${mod}+KeyP`);
      await page.locator('#marxy-palette .marxy-palette-query').fill('>');
      await page.waitForSelector('#marxy-palette .marxy-palette-row');
      const palette = await page.locator('#marxy-palette .marxy-palette-row').evaluateAll((rows) => rows.map((r) => r.dataset.rowKey));
      for (const id of menu) assert.ok(palette.includes(id), `${name}: ${id} is in the menu but not the palette`);
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.getElementById('marxy-palette').open);
    }
  } finally {
    await page.close();
  }
});

test('C-13: a contextmenu event inside the article is always prevented; WebKit never shows its own menu', async () => {
  const page = await boot('28-llm-answer.md');
  try {
    await page.evaluate(() => {
      window.__ctx = [];
      window.addEventListener('contextmenu', (e) => window.__ctx.push(e.defaultPrevented));
    });
    await page.locator('#doc p').first().click({ button: 'right' });
    await page.keyboard.press('Escape');
    // Whitespace in the article with nothing under it: no menu, but no native one either.
    const prevented = await page.evaluate(() => {
      const doc = document.getElementById('doc');
      const box = doc.getBoundingClientRect();
      const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: box.x + 1, clientY: box.y + 1 });
      doc.dispatchEvent(ev);
      return ev.defaultPrevented;
    });
    assert.equal(prevented, true);
    assert.deepEqual(await page.evaluate(() => window.__ctx), [true, true]);
  } finally {
    await page.close();
  }
});

test('C-13: right-click a link selects it and never follows it; the menu offers Jump to source', async () => {
  const page = await boot('09-gfm-everything.md');
  try {
    const link = page.locator('#doc p a[href]').first();
    await link.click({ button: 'right' });
    const state = await page.evaluate(() => {
      const sel = window.marxySelection.getSelectionState().selection;
      return { kind: sel.kind, type: sel.node?.type };
    });
    assert.deepEqual(state, { kind: 'node', type: 'link' });
    const rows = await menuRows(page);
    assert.deepEqual(rows.map((r) => r.id), ['view.jump-to-source'], rows.map((r) => r.title).join(' | '));
    assert.equal(rows[0].key, null, 'no copy chord: no default verb applies to an inline node');
    assert.equal(await page.locator('.marxy-verb-menu').getAttribute('aria-label'), 'Link');
    const calls = await page.evaluate(() => window.__marxyOpsBoot.handle.shell.calls.map((c) => c.method));
    assert.ok(!calls.includes('openExternal'), calls.join(','));
    assert.equal(await page.evaluate(() => window.__marxyOpsBoot.handle.openDocument()?.path), '/corpus/09-gfm-everything.md');
  } finally {
    await page.close();
  }
});

test('C-13: a right-click inside a drag keeps the drag and offers its verbs', async () => {
  const page = await boot('28-llm-answer.md');
  try {
    const p = page.locator('#doc p').first();
    const bb = await p.boundingBox();
    await page.mouse.move(bb.x + 2, bb.y + 4);
    await page.mouse.down();
    await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2, { steps: 5 });
    await page.mouse.move(bb.x + bb.width - 4, bb.y + bb.height - 4, { steps: 5 });
    await page.mouse.up();
    assert.equal(await page.evaluate(() => window.marxySelection.getSelectionState().selection.kind), 'text');
    await page.mouse.click(bb.x + bb.width / 3, bb.y + 6, { button: 'right' });
    const rows = await menuRows(page);
    assert.equal(rows[0]?.id, 'selection.copy-rich', rows.map((r) => r.title).join(' | '));
    assert.equal(await page.locator('.marxy-verb-menu').getAttribute('aria-label'), 'Selected text');
    assert.equal(await page.evaluate(() => window.marxySelection.getSelectionState().selection.kind), 'text');
    await page.keyboard.press('Escape');
  } finally {
    await page.close();
  }
});

test('C-06 review: a plain click in the margin after a drag drops the recorded drag, so Mod+C copies nothing', async () => {
  const page = await boot('28-llm-answer.md');
  try {
    const p = page.locator('#doc p').first();
    const bb = await p.boundingBox();
    await page.mouse.move(bb.x + 2, bb.y + 4);
    await page.mouse.down();
    await page.mouse.move(bb.x + bb.width - 4, bb.y + bb.height - 4, { steps: 8 });
    await page.mouse.up();
    assert.equal(await page.evaluate(() => window.marxySelection.getSelectionState().selection.kind), 'text');
    const doc = await page.locator('#doc').boundingBox();
    await page.mouse.click(Math.max(2, doc.x - 40), bb.y + 4);
    await page.waitForFunction(() => window.getSelection()?.isCollapsed ?? true);
    // The drop waits one task after the press (WebKit collapses the highlight as its default action).
    await page.evaluate(() => new Promise((r) => setTimeout(r, 50)));
    assert.equal(await page.evaluate(() => window.marxySelection.getSelectionState().selection.kind), 'none');
    await page.keyboard.press(`${await modKey(page)}+KeyC`);
    assert.equal((await clipboard(page)).length, 0, 'nothing the reader can no longer see is copied');
  } finally {
    await page.close();
  }
});

test('C-13: forced colours keep the menu border and the focused row', async () => {
  const page = await boot('28-llm-answer.md');
  try {
    const rules = await page.evaluate(() => {
      const found = [];
      const visit = (list) => {
        for (const rule of list) {
          if (rule instanceof CSSMediaRule && rule.conditionText.includes('forced-colors')) {
            for (const inner of rule.cssRules) if (inner.selectorText?.includes('marxy-verb-menu')) found.push(inner.cssText);
          } else if (rule.cssRules) visit(rule.cssRules);
        }
      };
      for (const sheet of document.styleSheets) {
        try { visit(sheet.cssRules); } catch { /* a cross-origin sheet */ }
      }
      return found.join('\n');
    });
    assert.match(rules, /\.marxy-verb-menu\s*\{[^}]*border-color: canvastext/i);
    assert.match(rules, /\.marxy-verb-menu-item:focus\s*\{[^}]*background(?:-color)?: highlight/i);
  } finally {
    await page.close();
  }
});
