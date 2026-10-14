// W-14: New file, New file here and Fork this file, end to end in WebKit over the memory shell. The memory shell's write log is the
// evidence for what these touch beside the reader's files: New file and New file here write nothing until Save As; Fork writes
// one new file, never over one that is there, and never to the original. The real app, its palette and the shipped skeleton and
// CSS, as test/sidebar.test.mjs boots them (the sidebar's rows come from the palette).
import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { after, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { b64, closeHarness, harnessBase, shippedSkeleton } from './support/two-pane.mjs';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);
after(() => closeHarness());

const para = (word) => `${word} runs long enough to wrap across several lines of the column, so the page has real paragraphs. `;
const A_TEXT = `# Alpha\n\n${para('Alpha').repeat(3)}\n\n- [ ] a task\n`;
const files = {
  '/r/a.md': A_TEXT,
  '/r/b.md': `# Bravo\n\n${para('Bravo').repeat(3)}\n`,
  '/r/c.md': `# Charlie\n\n${para('Charlie').repeat(3)}\n`,
};
const entries = Object.keys(files).map((path) => ({ path, root: '/r', title: files[path].match(/^# (.*)$/m)[1], headings: [], mtimeMs: 1, size: files[path].length, kind: 'markdown' }));

async function withPage(fn, { width = 1470, height = 900, open = ['/r/a.md'], data = {}, links = {}, symlinks = {} } = {}) {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width, height } });
    const base = await harnessBase();
    const { style, body } = shippedSkeleton();
    await page.route(`${base}app.html`, async (route) => {
      const response = await route.fetch();
      const html = (await response.text())
        .replace('</head>', `<style>${style}</style></head>`)
        .replace(/<body[^>]*>/, '<body data-marxy-mode="rendered" data-marxy-variant="dark">')
        .replace('<article id="doc" class="marxy-article"></article>', body);
      await route.fulfill({ response, body: html });
    });
    await page.goto(`${base}app.html`);
    await page.waitForFunction(() => typeof window.marxyApp?.start === 'function');
    const encoded = Object.fromEntries(Object.entries({ ...files, ...data }).map(([path, text]) => [path, typeof text === 'string' ? b64(text) : Buffer.from(text).toString('base64')]));
    await page.evaluate(
      async ({ encoded, index, open, links, symlinks }) => {
        const bytes = {};
        for (const [path, text] of Object.entries(encoded)) bytes[path] = Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
        const { createMemoryShell } = await import('/src/shell/memory.ts');
        const { bootApplication } = await import('/src/main.ts');
        const shell = createMemoryShell(bytes);
        for (const [from, to] of Object.entries(links)) shell.link(from, to);
        for (const [at, to] of Object.entries(symlinks)) shell.symlink(at, to);
        const handle = await bootApplication(shell, { argv: [open[0]] });
        await handle.ready;
        window.__marxyHandle = handle;
        handle.palette.setIndexEntries(index);
        await handle.collection?.loaded;
        handle.palette.noteRead(open[0], 'open');
        for (const path of open.slice(1)) await handle.open(path);
      },
      { encoded, index: entries, open, links, symlinks },
    );
    await fn(page);
  } finally {
    await browser.close();
  }
}

const mod = async (page) => ((await page.evaluate(() => navigator.platform.toUpperCase().includes('MAC'))) ? 'Meta' : 'Control');
const unfold = (page) => page.evaluate(() => window.__marxyHandle.workspace().unfold());
const settle = (page) => page.evaluate(() => new Promise((r) => setTimeout(r, 120)));
/**
 * Writes beside the reader's files: the memory shell's write log without Marxy's own state (/data), both writes. A fork is a
 * create-only write (F-85, ADR-0074), a Save As the one that replaces; a `writeFileNew` call a name that was taken refused is
 * included, and the bytes on disk (`diskBytes`) say which of them made a file. `replacingWrites` is the replacing ones alone.
 */
const docWrites = (page) =>
  page.evaluate(() =>
    window.__marxyHandle.shell.calls
      .filter((c) => (c.method === 'writeFileNew' || c.method === 'writeFileAtomic') && !c.args[0].startsWith('/data/') && !c.args[0].startsWith('/config/'))
      .map((c) => [c.args[0], [...c.args[1]]]),
  );
/** Calls to the write that replaces, beside the reader's files: Fork, and a copy beside a file, make none. */
const replacingWrites = (page) =>
  page.evaluate(() =>
    window.__marxyHandle.shell.calls
      .filter((c) => c.method === 'writeFileAtomic' && !c.args[0].startsWith('/data/') && !c.args[0].startsWith('/config/'))
      .map((c) => c.args[0]),
  );
const callsTo = (page, method) => page.evaluate((m) => window.__marxyHandle.shell.calls.filter((c) => c.method === m).map((c) => [...c.args]), method);
const diskBytes = (page, path) => page.evaluate(async (p) => [...(await window.__marxyHandle.shell.peekFile(p))], path);
const paneInfo = (page) => page.evaluate(() => window.__marxyHandle.panes().panes.map((p) => ({ path: p.path(), mode: p.view.mode })));
const focusedPath = (page) => page.evaluate(() => window.__marxyHandle.panes().focused.path());
const bufferText = (page) => page.evaluate(() => new TextDecoder().decode(window.__marxyHandle.document().snapshot().buffer.bytes));
const noticeTexts = (page) => page.evaluate(() => [...document.querySelectorAll('.marxy-notice')].map((n) => ({ kind: n.getAttribute('data-notice-kind'), text: n.querySelector('.marxy-notice-text')?.textContent ?? '', buttons: [...n.querySelectorAll('button')].map((b) => b.textContent) })));
const waitForPath = (page, path) => page.waitForFunction((p) => window.__marxyHandle.panes().focused.path() === p, path);
const tick = async (page) => {
  await page.evaluate(() => document.querySelector('#doc input[type=checkbox]').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
  await page.waitForFunction(() => window.__marxyHandle.document().snapshot().dirty);
};
const menuRows = (page) => page.evaluate(() => [...document.querySelectorAll('.marxy-verb-menu .marxy-verb-menu-item')].map((r) => r.querySelector('.marxy-verb-menu-title').textContent));
const menuLabel = (page) => page.evaluate(() => document.querySelector('.marxy-verb-menu')?.getAttribute('aria-label') ?? null);
const clickRow = (page, title) => page.locator('.marxy-verb-menu .marxy-verb-menu-item').filter({ hasText: new RegExp(`^${title}`) }).click();
const clickNotice = (page, label) => page.evaluate((l) => [...document.querySelectorAll('.marxy-notice button')].find((b) => b.textContent === l).click(), label);

test('folded: Mod+N opens an untitled document in Source, and closing it writes nothing and asks nothing', () =>
  withPage(async (page) => {
    const key = await mod(page);
    assert.equal(await page.evaluate(() => document.querySelector('.marxy-toolbar') !== null), false, 'folded: no toolbar is drawn');
    await page.keyboard.press(`${key}+KeyN`);
    await waitForPath(page, 'untitled');
    await page.waitForFunction(() => window.__marxyHandle.panes().focused.view.mode === 'source');
    await page.waitForSelector('.cm-content');
    assert.deepEqual(await bufferText(page), '');
    assert.deepEqual(await docWrites(page), [], 'nothing is written by opening it');
    assert.ok((await noticeTexts(page)).some((n) => /Opened as a new document \(not saved\)/.test(n.text)), 'and it says it is not saved');
    // The same chord from inside the Source editor opens another, with its own name.
    await page.locator('.cm-content').click();
    await page.keyboard.press(`${key}+KeyN`);
    await waitForPath(page, 'untitled:2');
    // Closing: nothing was typed, so nothing is asked and nothing is written.
    await page.evaluate(() => window.__marxyHandle.shell.emitCloseRequested());
    await page.waitForFunction(() => window.__marxyHandle.shell.calls.some((c) => c.method === 'confirmClose'));
    assert.equal((await noticeTexts(page)).some((n) => /has changes/.test(n.text)), false);
    assert.deepEqual(await docWrites(page), [], 'closing writes nothing');
  }));

test('New file is in the palette, and its row opens the same untitled document', () =>
  withPage(async (page) => {
    const key = await mod(page);
    await page.keyboard.press(`${key}+Shift+KeyP`);
    await page.waitForSelector('#marxy-palette[open] .marxy-palette-row');
    await page.locator('#marxy-palette .marxy-palette-query').fill('>New file');
    await page.waitForFunction(() => [...document.querySelectorAll('#marxy-palette .marxy-palette-title')].some((t) => t.textContent === 'New file'));
    const titles = await page.evaluate(() => [...document.querySelectorAll('#marxy-palette .marxy-palette-title')].map((t) => t.textContent));
    assert.ok(titles.includes('New file here') && !titles.includes('New…'), `New file, New file here; the menu door itself is not a row: ${titles}`);
    await page.locator('#marxy-palette .marxy-palette-title').filter({ hasText: /^New file$/ }).click();
    await waitForPath(page, 'untitled');
    assert.deepEqual(await docWrites(page), []);
  }));

test('New file here, from a sidebar folder row\'s menu, opens an untitled document whose Save As starts in that folder, and writes nothing', () =>
  withPage(async (page) => {
    await unfold(page);
    await page.waitForSelector('[role="treeitem"][data-marxy-sidebar-row="/r"]');
    await page.click('[role="treeitem"][data-marxy-sidebar-row="/r"]', { button: 'right' });
    await page.waitForSelector('.marxy-verb-menu');
    assert.equal(await menuLabel(page), 'Folder');
    assert.deepEqual(await menuRows(page), ['New file here']);
    await clickRow(page, 'New file here');
    await waitForPath(page, 'untitled');
    assert.deepEqual(await docWrites(page), [], 'the folder was not written to');
    // Save As asks where: its dialog starts in the folder the menu was opened on.
    const key = await mod(page);
    await page.evaluate(() => window.__marxyHandle.shell.queueSaveDialog(null));
    await page.keyboard.press(`${key}+KeyS`);
    await page.waitForFunction(() => window.__marxyHandle.shell.calls.some((c) => c.method === 'saveDialog'));
    assert.equal((await callsTo(page, 'saveDialog'))[0][0].defaultPath, '/r/Untitled.md');
    assert.deepEqual(await docWrites(page), [], 'cancelling the dialog writes nothing');
    // Naming it is the reader's: the file is made only then, with the document's own (empty) bytes.
    await page.evaluate(() => window.__marxyHandle.shell.queueSaveDialog('/r/fresh.md'));
    await page.keyboard.press(`${key}+KeyS`);
    await page.waitForFunction(() => window.__marxyHandle.panes().focused.path() === '/r/fresh.md');
    assert.deepEqual(await docWrites(page), [['/r/fresh.md', []]]);
  }));

test('the folder row\'s menu opens from the keyboard too (the context-menu key and Shift+F10), and a file row has none', () =>
  withPage(async (page) => {
    await unfold(page);
    await page.waitForSelector('[role="treeitem"][data-marxy-sidebar-row="/r"]');
    await page.focus('[role="treeitem"][data-marxy-sidebar-row="/r"]');
    await page.keyboard.press('Shift+F10');
    await page.waitForSelector('.marxy-verb-menu');
    assert.deepEqual(await menuRows(page), ['New file here']);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.marxy-verb-menu'));
    await page.click('[role="treeitem"][data-marxy-sidebar-row="/r"]');
    await page.waitForSelector('[role="treeitem"][data-marxy-sidebar-row="/r/b.md"]');
    await page.click('[role="treeitem"][data-marxy-sidebar-row="/r/b.md"]', { button: 'right' });
    await settle(page);
    assert.equal(await page.evaluate(() => document.querySelector('.marxy-verb-menu') !== null), false, 'a file row has no folder menu');
  }));

test('the toolbar\'s + is drawn once its command exists and lists only what can run now; the tab bar\'s + opens the same menu', () =>
  withPage(async (page) => {
    await unfold(page);
    await page.waitForSelector('[data-marxy-toolbar-item="new"] button');
    await page.click('[data-marxy-toolbar-item="new"] button');
    await page.waitForSelector('.marxy-verb-menu');
    assert.equal(await menuLabel(page), 'New');
    assert.deepEqual(await menuRows(page), ['New file', 'New file here', 'Fork this file'], 'with a file open all three can run');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.marxy-verb-menu'));
    // A second tab brings the tab bar; its + is the same menu.
    await page.evaluate(() => window.__marxyHandle.open('/r/b.md'));
    await waitForPath(page, '/r/b.md');
    await page.waitForSelector('[data-marxy-tab-new]');
    assert.equal(await page.evaluate(() => document.querySelectorAll('.marxy-tab').length), 2, 'the + is not counted as a tab');
    await page.click('[data-marxy-tab-new]');
    await page.waitForSelector('.marxy-verb-menu');
    assert.deepEqual(await menuRows(page), ['New file', 'New file here', 'Fork this file']);
    const shut = await page.evaluate(() => {
      const m = document.querySelector('.marxy-verb-menu').getBoundingClientRect();
      const b = document.querySelector('[data-marxy-tab-new]').getBoundingClientRect();
      return { below: m.top >= b.bottom - 1, near: Math.abs(m.left - b.left) < 40 };
    });
    assert.deepEqual(shut, { below: true, near: true }, 'under the + that opened it');
    await clickRow(page, 'New file here');
    await waitForPath(page, 'untitled');
    // On a scratch document there is no file to be beside, so only the first row can run: the others are not drawn.
    await page.click('[data-marxy-toolbar-item="new"] button');
    await page.waitForSelector('.marxy-verb-menu');
    assert.deepEqual(await menuRows(page), ['New file']);
    await page.keyboard.press('Escape');
    assert.deepEqual(await docWrites(page), []);
  }));

test('Fork this file writes the open file\'s bytes beside it as name (fork).md, opens it, and says where; the original is not written', () =>
  withPage(async (page) => {
    const key = await mod(page);
    const original = await diskBytes(page, '/r/a.md');
    await page.keyboard.press(`${key}+Shift+KeyN`);
    await waitForPath(page, '/r/a (fork).md');
    assert.deepEqual(await docWrites(page), [['/r/a (fork).md', original]], 'one write: the fork, with the original\'s bytes');
    assert.deepEqual(await replacingWrites(page), [], 'and it is create-only: nothing that replaces was called');
    assert.deepEqual(await diskBytes(page, '/r/a.md'), original, 'the original is as it was');
    const said = (await noticeTexts(page)).find((n) => /Forked/.test(n.text));
    assert.ok(said, `a notice: ${JSON.stringify(await noticeTexts(page))}`);
    assert.equal(said.kind, 'done');
    assert.match(said.text, /Forked a\.md as a \(fork\)\.md in \/r · a\.md is unchanged/);
    assert.equal(await bufferText(page), A_TEXT);
  }));

test('ADVERSARIAL: with a (fork).md already there, Fork is refused there, writes (fork 2), and the first keeps its bytes; unsaved edits go into the fork only', () =>
  withPage(async (page) => {
    const key = await mod(page);
    const mine = 'MY OWN FORK OF A, kept exactly\n';
    await tick(page);
    const edited = await bufferText(page);
    assert.notEqual(edited, A_TEXT);
    await page.keyboard.press(`${key}+Shift+KeyN`);
    // The original has unsaved edits, so opening the fork asks first (as any open does); the fork is already written.
    await page.waitForFunction(() => document.body.textContent.includes('Forked a.md as a (fork 2).md'));
    const writes = await docWrites(page);
    assert.deepEqual(writes.map(([p]) => p), ['/r/a (fork).md', '/r/a (fork 2).md'], 'it tried the first name, was refused, and went on');
    assert.deepEqual(await replacingWrites(page), [], 'nothing that replaces was called');
    assert.equal(Buffer.from(writes[1][1]).toString('utf8'), edited, 'the unsaved edit is in the fork');
    assert.equal(Buffer.from(await diskBytes(page, '/r/a (fork).md')).toString('utf8'), mine);
    assert.equal(Buffer.from(await diskBytes(page, '/r/a.md')).toString('utf8'), A_TEXT, 'and not in the original on disk');
    const said = (await noticeTexts(page)).find((n) => /Forked/.test(n.text));
    assert.match(said.text, /a \(fork\)\.md was already there and left as it was/);
    assert.equal(await focusedPath(page), '/r/a.md', 'the prompt over the unsaved original stands; nothing has been opened over it');
    await clickNotice(page, 'Open without saving');
    await waitForPath(page, '/r/a (fork 2).md');
    assert.deepEqual((await docWrites(page)).map(([p]) => p), ['/r/a (fork).md', '/r/a (fork 2).md'], 'still the same two tries');
  }, { data: { '/r/a (fork).md': 'MY OWN FORK OF A, kept exactly\n' } }));

test('a symlink at the name is a file that is there: the fork goes to the next name and the link\'s target is not touched', () =>
  withPage(async (page) => {
    const key = await mod(page);
    const target = await diskBytes(page, '/r/b.md');
    await page.keyboard.press(`${key}+Shift+KeyN`);
    await waitForPath(page, '/r/a (fork 2).md');
    assert.deepEqual((await docWrites(page)).map(([p]) => p), ['/r/a (fork).md', '/r/a (fork 2).md'], 'the link was refused, not written through');
    assert.deepEqual(await diskBytes(page, '/r/b.md'), target);
  }, { symlinks: { '/r/a (fork).md': '/r/b.md' } }));

test('text typed in Source and not yet folded into the document is in the fork, and not in the original on disk', () =>
  withPage(async (page) => {
    const key = await mod(page);
    await page.evaluate(() => window.__marxyHandle.toggleMode());
    await page.waitForSelector('.cm-content');
    await page.locator('.cm-content').click();
    await page.keyboard.press(`${key}+ArrowDown`);
    await page.keyboard.type('TYPED-IN-SOURCE ');
    // The precondition that makes this test mean something: the typing is in the editor and not yet in the store.
    assert.equal(await page.evaluate(() => window.__marxyHandle.hasUnfoldedSource()), true, 'typed, not yet folded');
    assert.equal(await bufferText(page), A_TEXT, 'the store does not have it yet');
    await page.keyboard.press(`${key}+Shift+KeyN`);
    await page.waitForFunction(() => document.body.textContent.includes('Forked a.md as a (fork).md'));
    const writes = await docWrites(page);
    assert.deepEqual(writes.map(([p]) => p), ['/r/a (fork).md']);
    assert.match(Buffer.from(writes[0][1]).toString('utf8'), /TYPED-IN-SOURCE/, 'the typed text is in the fork');
    assert.equal(Buffer.from(await diskBytes(page, '/r/a.md')).toString('utf8'), A_TEXT, 'the original on disk is untouched');
  }));

test('a failed write says so, writes and opens nothing, and the original is as it was', () =>
  withPage(async (page) => {
    const key = await mod(page);
    const original = await diskBytes(page, '/r/a.md');
    await page.evaluate(() => window.__marxyHandle.shell.rejectNextWrite('io'));
    await page.keyboard.press(`${key}+Shift+KeyN`);
    await page.waitForFunction(() => document.body.textContent.includes('Not forked: a (fork).md could not be written'));
    const said = (await noticeTexts(page)).find((n) => /Not forked/.test(n.text));
    assert.equal(said.kind, 'error');
    assert.match(said.text, /because the write was refused · nothing was written and a\.md is unchanged · Check the folder, then try again\.$/);
    assert.doesNotMatch(said.text, /marxy-tmp|os error/);
    assert.equal(await page.evaluate(() => window.__marxyHandle.shell.hasFile('/r/a (fork).md')), false, 'no file at the name');
    assert.equal(await focusedPath(page), '/r/a.md', 'nothing opened');
    assert.deepEqual(await diskBytes(page, '/r/a.md'), original);
    assert.equal((await paneInfo(page)).length, 1);
  }));

test('the fork holds a BOM and CRLF line endings exactly, and Fork is not offered on an untitled document', () =>
  withPage(async (page) => {
    const key = await mod(page);
    const crlf = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('# Windows\r\n\r\nline one\r\nline two\r\n')]);
    await page.evaluate(() => window.__marxyHandle.open('/r/crlf.md'));
    await waitForPath(page, '/r/crlf.md');
    await page.keyboard.press(`${key}+Shift+KeyN`);
    await waitForPath(page, '/r/crlf (fork).md');
    assert.deepEqual(await diskBytes(page, '/r/crlf (fork).md'), [...crlf]);
    assert.deepEqual(await diskBytes(page, '/r/crlf.md'), [...crlf], 'the original is the same bytes');
    // On a new document there is no file to fork: the chord does nothing and the palette does not list it.
    await page.keyboard.press(`${key}+KeyN`);
    await waitForPath(page, 'untitled');
    const writesBefore = (await docWrites(page)).length;
    await page.keyboard.press(`${key}+Shift+KeyN`);
    await settle(page);
    assert.equal((await docWrites(page)).length, writesBefore);
    assert.equal(await focusedPath(page), 'untitled');
  }, { data: { '/r/crlf.md': Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('# Windows\r\n\r\nline one\r\nline two\r\n')]) } }));

test('forking touches nothing outside the machine: no network request is made by New file or Fork', () =>
  withPage(async (page) => {
    const requests = [];
    page.on('request', (r) => {
      if (!/^(http:\/\/127\.0\.0\.1|data:|blob:|about:)/.test(r.url())) requests.push(r.url());
    });
    const key = await mod(page);
    await page.keyboard.press(`${key}+Shift+KeyN`);
    await waitForPath(page, '/r/a (fork).md');
    await page.keyboard.press(`${key}+KeyN`);
    await waitForPath(page, 'untitled');
    assert.deepEqual(requests, []);
  }));
