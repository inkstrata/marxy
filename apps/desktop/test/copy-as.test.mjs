// Copy as (J-04, ADR-0065 item 1): ⇧⌘C opens a menu of the targets at the pointer; a choice writes one pasteboard
// item through clipboardWriteItem and says one notice. Palette harness (memory shell), WebKit.
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
import { COPY_TARGETS, copyAsFromOperation, copyTargets, createBuffer, parseMarkdown, sectionRange, textOf } from '../../../packages/core/src/index.ts';
import { copyRich } from '../../../packages/core/src/operations/copy-rich.ts';
import { COPY_FORMATS } from '../../../packages/theme/src/config.ts';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip }, fn);

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const desktopRoot = fileURLToPath(new URL('..', import.meta.url));
const corpusDir = join(repoRoot, 'fixtures', 'corpus');
const outDir = mkdtempSync(join(tmpdir(), 'marxy-copy-as-'));
let server;
let base;
let browser;

before(async () => {
  if (skip) return;
  await build({
    root: desktopRoot,
    logLevel: 'silent',
    build: { outDir, emptyOutDir: true, rollupOptions: { input: { paletteBoot: join(desktopRoot, 'test/palette-boot.html') } } },
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

const TEXT = 'public.utf8-plain-text';
const HTML = 'public.html';
const enc = new TextEncoder();
const utf8 = (s) => enc.encode(s).byteLength;

async function boot(file, extra = {}) {
  const page = await browser.newPage({ viewport: { width: 960, height: 900 } });
  const docPath = `/corpus/${file}`;
  await page.goto(`${base}test/palette-boot.html`);
  await page.waitForFunction(() => typeof window.marxyPaletteBoot?.start === 'function');
  const files = { [docPath]: readFileSync(join(corpusDir, file)).toString('base64') };
  for (const [path, text] of Object.entries(extra)) files[path] = Buffer.from(text).toString('base64');
  await page.evaluate(async ({ files, argv }) => {
    window.__marxyOpsBoot = await window.marxyPaletteBoot.start(files, argv, []);
  }, { files, argv: [docPath] });
  await page.waitForFunction(() => typeof window.marxySelection?.getSelectionState === 'function');
  await page.waitForFunction(() => window.__marxyOpenSynced === true);
  return { page, docPath };
}

const mod = async (page) => ((await page.evaluate(() => navigator.platform)) === 'MacIntel' ? 'Meta' : 'Control');
const MENU = '.marxy-verb-menu';

/** The shell's recorded calls, with pasteboard bytes decoded to text. */
const calls = (page, method) =>
  page.evaluate((method) => {
    const dec = new TextDecoder();
    return window.__marxyOpsBoot.handle.shell.calls
      .filter((c) => c.method === method)
      .map((c) => (method === 'clipboardWriteItem'
        ? { reps: Object.fromEntries(c.args[0].map((r) => [r.type, dec.decode(r.bytes)])), meta: c.args[1] }
        : c.args[0]));
  }, method);

const rowIds = (page) => page.evaluate(() => [...document.querySelectorAll('.marxy-verb-menu [role="menuitem"]')].map((r) => r.getAttribute('data-row-key')));
/** The copy notices on the page (the document's own notices, such as simplified HTML, are not ours). */
const notices = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('#marxy-notices .marxy-notice-text')]
      .map((n) => n.textContent.trim())
      .filter((t) => t.startsWith('Copied') || t.startsWith('Could not')),
  );

async function openMenu(page) {
  await page.keyboard.press(`${await mod(page)}+Shift+KeyC`);
  await page.waitForSelector(MENU);
}

async function choose(page, id) {
  await page.locator(`${MENU} [data-row-key="copy-as.${id}"]`).click();
  await page.waitForSelector(MENU, { state: 'detached' });
}

test('the eight formats of copy_format are the eight targets of core, in menu order', () => {
  const all = copyTargets({ has: () => true, run: (_id, text) => text });
  assert.deepEqual(COPY_FORMATS, all.map((t) => t.id));
  // Today the registry can run six of them; the menu lists exactly those (J-03.1 adds Slack and Jira).
  assert.deepEqual(COPY_TARGETS.map((t) => t.id), ['markdown', 'plain', 'rich', 'html', 'json-string', 'quote']);
});

test('each target, for a heading, a table and the document, writes exactly one item', async () => {
  const file = '09-gfm-everything.md';
  const bytes = readFileSync(join(corpusDir, file));
  const ast = parseMarkdown(bytes, { file });
  const buffer = createBuffer(file, bytes);
  const heading = ast.children.find((n) => n.type === 'heading' && (n.level ?? n.depth) === 2);
  let table;
  const walk = (n) => { if (!table && n.type === 'table') table = n; for (const c of n.children ?? []) walk(c); };
  walk(ast);
  assert.ok(heading && table);
  const cases = [
    { name: 'heading', input: { document: ast, node: heading, range: sectionRange(ast, heading) } },
    { name: 'table', input: { document: ast, node: table, range: table.src } },
    { name: 'document', input: { document: ast, range: ast.src } },
  ];
  for (const c of cases) c.input.text = textOf(buffer, c.input.range);
  const { page, docPath } = await boot(file);
  try {
    for (const c of cases) {
      const input = copyAsFromOperation(c.input, { path: docPath });
      for (const target of COPY_TARGETS) {
        await page.evaluate(() => { window.__marxyOpsBoot.handle.shell.calls.length = 0; document.getElementById('marxy-notices').replaceChildren(); });
        if (c.name === 'heading') await page.locator('#doc h2').first().click();
        else if (c.name === 'table') await page.locator('#doc td').first().click();
        else {
          await page.keyboard.press('Escape');
          await page.mouse.move(4, 4);
        }
        if (c.name !== 'document') await page.mouse.move(4, 4);
        await openMenu(page);
        assert.deepEqual((await rowIds(page)).slice(0, 1), ['copy-as.markdown']);
        await choose(page, target.id);
        const writes = await calls(page, 'clipboardWriteItem');
        const label = `${c.name} as ${target.id}`;
        assert.equal(writes.length, 1, `${label}: one native write`);
        assert.equal((await calls(page, 'clipboardWrite')).length, 0, `${label}: no clipboardWrite`);
        const expected = target.build(input);
        const types = Object.keys(writes[0].reps).sort();
        assert.deepEqual(types, expected.html === undefined ? [TEXT] : [HTML, TEXT].sort(), label);
        assert.equal(writes[0].reps[TEXT], expected.text, `${label}: text`);
        if (expected.html !== undefined) assert.equal(writes[0].reps[HTML], expected.html, `${label}: html`);
        assert.equal(writes[0].meta?.transient, false, `${label}: not transient`);
        // Rich text is copy-rich's html, byte for byte; no other target writes public.html.
        if (target.id === 'rich') assert.equal(writes[0].reps[HTML], copyRich.run(c.input).clipboard.html);
        else assert.equal(HTML in writes[0].reps, false, `${label}: no html`);
        // One notice that names the format and the size of the text; nothing read from the pasteboard.
        const size = utf8(expected.text);
        const said = await notices(page);
        const sizeText = size < 1000 ? `${size} B` : `${(size / 1000).toFixed(1)} KB`;
        assert.deepEqual(said, [`Copied as ${target.name}, ${sizeText}`], label);
        assert.equal((await calls(page, 'clipboardRead')).length + (await calls(page, 'clipboardTypes')).length, 0, `${label}: no read`);
      }
    }
  } finally {
    await page.close();
  }
});

test('with nothing selected, the block under the pointer is copied; over nothing, the document', async () => {
  const file = '28-llm-answer.md';
  const bytes = readFileSync(join(corpusDir, file));
  const { page } = await boot(file);
  try {
    const para = page.locator('#doc p').first();
    const box = await para.boundingBox();
    await page.mouse.move(box.x + 8, box.y + box.height / 2);
    await openMenu(page);
    await choose(page, 'markdown');
    const [one] = await calls(page, 'clipboardWriteItem');
    assert.ok(one.reps[TEXT].length > 0 && one.reps[TEXT].length < bytes.length / 2, 'a block, not the file');
    assert.ok(bytes.toString('utf8').includes(one.reps[TEXT].replace(/\s+$/, '')));
    await page.keyboard.press('Escape');
    await page.mouse.move(3, 3);
    await page.evaluate(() => { window.__marxyOpsBoot.handle.shell.calls.length = 0; });
    await openMenu(page);
    await choose(page, 'markdown');
    const [all] = await calls(page, 'clipboardWriteItem');
    assert.equal(all.reps[TEXT], bytes.toString('utf8').replace(/^﻿/, ''));
  } finally {
    await page.close();
  }
});

test('⇧⌘C Return is the old behaviour: Markdown first and focused; the other rows follow in order', async () => {
  const file = '28-llm-answer.md';
  const { page } = await boot(file);
  try {
    await page.locator('#doc pre[data-marxy-s]').first().click();
    await openMenu(page);
    assert.deepEqual(await rowIds(page), COPY_TARGETS.map((t) => `copy-as.${t.id}`));
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-row-key')), 'copy-as.markdown');
    assert.equal(await page.locator(MENU).getAttribute('aria-label'), 'Copy as');
    await page.keyboard.press('Enter');
    await page.waitForSelector(MENU, { state: 'detached' });
    const [w] = await calls(page, 'clipboardWriteItem');
    const bytes = readFileSync(join(corpusDir, file));
    const ast = parseMarkdown(bytes, { file });
    const block = ast.children.find((n) => n.type === 'codeBlock');
    assert.equal(w.reps[TEXT], textOf(createBuffer(file, bytes), block.src));
  } finally {
    await page.close();
  }
});

test('copy_format names the first row and Enter copies it; an unknown or unbuilt one leaves Markdown first', async () => {
  const cases = [
    ['quote', 'copy-as.quote'],
    ['json-string', 'copy-as.json-string'],
    ['nope', 'copy-as.markdown'],
    ['slack', 'copy-as.markdown'], // to-slack is not built (J-03.1): its row is not offered
  ];
  for (const [value, first] of cases) {
    const { page } = await boot('01-long-technical.md', { '/config': `copy_format = "${value}"\n` });
    try {
      await page.locator('#doc p').first().click();
      await openMenu(page);
      const ids = await rowIds(page);
      assert.equal(ids[0], first, value);
      assert.equal(ids.length, COPY_TARGETS.length, value);
      await page.keyboard.press('Enter');
      await page.waitForSelector(MENU, { state: 'detached' });
      const [w] = await calls(page, 'clipboardWriteItem');
      assert.ok(w, value);
      if (value === 'quote') assert.match(w.reps[TEXT], /^> /);
      if (value === 'json-string') assert.match(w.reps[TEXT], /^"/);
    } finally {
      await page.close();
    }
  }
});

test('a shell with no native pasteboard falls back to clipboardWrite with the same notice', async () => {
  const { page } = await boot('01-long-technical.md');
  try {
    await page.evaluate(() => {
      const shell = window.__marxyOpsBoot.handle.shell;
      shell.clipboardWriteItem = async () => { throw Object.assign(new Error('no pasteboard'), { code: 'unsupported' }); };
    });
    await page.locator('#doc p').first().click();
    await openMenu(page);
    await choose(page, 'rich');
    const [w] = await calls(page, 'clipboardWrite');
    assert.ok(w.text.length > 0 && typeof w.html === 'string' && w.html.includes('<'));
    const said = await notices(page);
    assert.equal(said.length, 1);
    assert.match(said[0], /^Copied as Rich text, \d/);
  } finally {
    await page.close();
  }
});

test('a document with CRLF and a BOM: Markdown is the bytes without the mark; JSON string escapes the CRLF', async () => {
  const file = '12-crlf-and-bom.md';
  const text = readFileSync(join(corpusDir, file), 'utf8').replace(/^﻿/, '');
  const { page } = await boot(file);
  try {
    await page.mouse.move(3, 3);
    await openMenu(page);
    await choose(page, 'markdown');
    await page.mouse.move(3, 3);
    await openMenu(page);
    await choose(page, 'json-string');
    const [md, json] = await calls(page, 'clipboardWriteItem');
    assert.equal(md.reps[TEXT], text);
    assert.ok(!md.reps[TEXT].includes('﻿'));
    assert.ok(md.reps[TEXT].includes('\r\n'));
    assert.equal(json.reps[TEXT], JSON.stringify(text));
    assert.ok(json.reps[TEXT].includes('\\r\\n') && !json.reps[TEXT].includes('\r'));
  } finally {
    await page.close();
  }
});

test('in Source, the selected text is copied and not the line; with no selection, the file', async () => {
  const file = '04-source.rs';
  const text = readFileSync(join(corpusDir, file), 'utf8');
  const { page } = await boot(file);
  try {
    await page.waitForSelector('#marxy-source .cm-editor');
    await page.locator('#marxy-source .cm-content').click();
    await page.keyboard.press(`${await mod(page)}+ArrowUp`);
    for (let i = 0; i < 7; i++) await page.keyboard.press('Shift+ArrowRight');
    const selected = await page.evaluate(() => window.getSelection()?.toString() ?? '');
    await page.mouse.move(400, 300);
    await openMenu(page);
    await choose(page, 'markdown');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowLeft');
    const [part] = await calls(page, 'clipboardWriteItem');
    assert.equal(part.reps[TEXT], text.slice(0, 7), `selection ${JSON.stringify(selected)}`);
    // No selection: the whole file.
    await page.evaluate(() => { window.__marxyOpsBoot.handle.shell.calls.length = 0; });
    await openMenu(page);
    await choose(page, 'markdown');
    const [whole] = await calls(page, 'clipboardWriteItem');
    assert.equal(whole.reps[TEXT], text);
  } finally {
    await page.close();
  }
});

const noMenuAfter = async (page, press) => {
  await press();
  await page.waitForTimeout(400);
  assert.equal(await page.locator(MENU).count(), 0, 'no Copy as menu');
};

test('⇧⌘C leaves the find field alone, in Rendered and in Source, and works again once focus is back in the page', async () => {
  const chord = async (page) => page.keyboard.press(`${await mod(page)}+Shift+KeyC`);
  const { page } = await boot('09-gfm-everything.md');
  try {
    await page.keyboard.press(`${await mod(page)}+f`);
    await page.waitForSelector('.marxy-find-input');
    assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('marxy-find-input')), true);
    await noMenuAfter(page, () => chord(page));
    await page.keyboard.press('Escape');
    await page.mouse.move(400, 300);
    await openMenu(page);
    await page.keyboard.press('Escape');
  } finally {
    await page.close();
  }
  const source = await boot('04-source.rs');
  try {
    const p = source.page;
    await p.waitForSelector('#marxy-source .cm-editor');
    await p.locator('#marxy-source .cm-content').click();
    await p.keyboard.press(`${await mod(p)}+f`);
    await p.waitForSelector('.cm-panels input');
    assert.equal(await p.evaluate(() => document.activeElement?.closest('.cm-panels') !== null), true);
    await noMenuAfter(p, () => chord(p));
    await p.keyboard.press('Escape');
    await p.locator('#marxy-source .cm-content').click();
    await p.mouse.move(400, 300);
    await openMenu(p);
    assert.equal(await p.locator(MENU).count(), 1, 'in the editor itself it still opens');
  } finally {
    await source.page.close();
  }
});

test('⇧⌘C leaves the open palette alone, and Copy as… from the palette still opens the menu', async () => {
  const { page } = await boot('09-gfm-everything.md');
  try {
    await page.keyboard.press(`${await mod(page)}+p`);
    await page.waitForFunction(() => document.getElementById('marxy-palette')?.open === true);
    await noMenuAfter(page, async () => page.keyboard.press(`${await mod(page)}+Shift+KeyC`));
    assert.equal(await page.evaluate(() => document.getElementById('marxy-palette')?.open), true, 'the palette is still open');
    await page.keyboard.type('>Copy as');
    await page.waitForFunction(() => /Copy as…\s*⇧⌘C/.test(document.getElementById('marxy-palette').innerText));
    // The rows are ranked; arrow down to the one named Copy as… (the targets sort before it).
    for (let i = 0; i < 12 && !(await page.evaluate(() => /Copy as…/.test(document.querySelector('#marxy-palette [aria-selected="true"]')?.textContent ?? ''))); i++) await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await page.waitForSelector(MENU);
  } finally {
    await page.close();
  }
});
