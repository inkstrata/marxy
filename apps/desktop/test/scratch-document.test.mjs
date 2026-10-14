// A scratch (untitled) document, end to end in WebKit over the memory shell (E-13): it renders and edits
// like a document, writes nothing until Save As, asks before it is lost once changed, keeps no trace in
// the reader's saved layout or places, and has no folder for a relative image or link to be relative to.
import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { after, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { b64, closeHarness, harnessBase, shippedSkeleton } from './support/two-pane.mjs';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip }, fn);
after(() => closeHarness());

const A = '/d/a.md';
const SECRET = 'SCRATCH-SECRET-TEXT';
const TASKS = `# Hi\n\n- [ ] a\n\n${SECRET}\n`;

async function withPage(fn, { files = { [A]: '# Alpha\n\ntext\n' }, argv = [A], viewport = { width: 1470, height: 700 } } = {}) {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport });
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
    const encoded = Object.fromEntries(Object.entries(files).map(([path, text]) => [path, b64(text)]));
    await page.evaluate(async ({ encoded, argv }) => {
      const handle = await window.marxyApp.start(encoded, argv);
      await handle.ready;
      window.__h = handle;
    }, { encoded, argv });
    await fn(page);
  } finally {
    await browser.close();
  }
}

// Every privileged call so far, in order, as `method:first-argument`.
const log = (page) => page.evaluate(() => window.__h.shell.calls.map((c) => `${c.method}:${typeof c.args[0] === 'string' ? c.args[0] : ''}`));
const callsTo = (page, method) => page.evaluate((m) => window.__h.shell.calls.filter((c) => c.method === m).map((c) => [...c.args]).map((a) => (typeof a[0] === 'string' ? a[0] : a)), method);
// Marxy's own state (the index snapshot, positions, layout, history) lives under /data; the reader's
// documents are everything else.
const isState = (path) => path.startsWith('/data/');
const docWrites = async (page) => (await writes(page)).filter(([path]) => !isState(path));
const writes = (page) => page.evaluate(() => window.__h.shell.calls.filter((c) => c.method === 'writeFileAtomic').map((c) => [c.args[0], [...c.args[1]]]));
const openScratch = (page, text = TASKS, opts) => page.evaluate(([t, o]) => window.__h.openScratch(t, o), [text, opts]);
const bytesOf = (page, slot = 0) =>
  page.evaluate((s) => [...window.__h.panes().panes[s].content.store().snapshot().buffer.bytes], slot);
const textOf = async (page, slot = 0) => Buffer.from(await bytesOf(page, slot)).toString('utf8');
const snapOf = (page, slot = 0) =>
  page.evaluate((s) => {
    const snap = window.__h.panes().panes[s].content.store().snapshot();
    return { path: snap.path, dirty: snap.dirty, canUndo: snap.canUndo };
  }, slot);
const noticeText = (page) => page.evaluate(() => [...document.querySelectorAll('#marxy-notices .marxy-notice')].map((n) => n.textContent));
const clickButton = (page, label) =>
  page.evaluate((l) => [...document.querySelectorAll('.marxy-notice button')].find((b) => b.textContent === l).click(), label);
// The title the shell was last given (`shell.lastTitle` is not on the app's copy of the shell).
const titleIs = (page, want) =>
  page.waitForFunction(
    (w) => window.__h.shell.calls.filter((c) => c.method === 'setTitle').at(-1)?.args[0] === w,
    want,
  );
const requestClose = (page) => page.evaluate(() => window.__h.shell.emitCloseRequested());
const mod = async (page) => ((await page.evaluate(() => navigator.platform)) === 'MacIntel' ? 'Meta' : 'Control');

/** Ticks the task box in the `slot`'s page and waits for the store to take it. */
async function toggle(page, slot = 0) {
  const before = (await bytesOf(page, slot)).join();
  await page.evaluate((s) => {
    const article = window.__h.panes().panes[s].article;
    article.querySelector('input[data-marxy-s]').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  }, slot);
  await page.waitForFunction(([s, b]) => window.__h.panes().panes[s].content.store().snapshot().buffer.bytes.join() !== b, [slot, before]);
  await page.waitForTimeout(150);
}

test('a scratch document renders, toggles a task in one undo step, and writes and reads nothing', () =>
  withPage(async (page) => {
    assert.deepEqual(await writes(page), [], 'a window with no document has written nothing yet');
    const before = (await log(page)).length;
    assert.equal(await openScratch(page), true);
    await page.waitForSelector('#doc h1');
    await page.waitForSelector('#doc input[data-marxy-s]');
    assert.equal(await page.locator('#doc h1').textContent(), 'Hi');
    assert.equal((await snapOf(page)).path, 'untitled');
    assert.equal((await snapOf(page)).dirty, false);
    assert.equal(await page.evaluate(() => window.__h.currentPath()), 'untitled');

    await toggle(page);
    assert.equal(await textOf(page), TASKS.replace('[ ]', '[x]'));
    assert.equal((await snapOf(page)).dirty, true);
    // One undo step puts it back (the first Mod+Z in the window).
    await page.evaluate(() => window.__h.dispatch({ type: 'undo' }));
    await page.waitForFunction(() => !window.__h.panes().panes[0].content.store().snapshot().canUndo);
    assert.equal(await textOf(page), TASKS);
    assert.equal((await snapOf(page)).dirty, false);

    // The log since the open: no write of any kind, no watch, and no read of anything named untitled.
    const since = (await log(page)).slice(before);
    assert.deepEqual(since.filter((e) => e.startsWith('writeFileAtomic:')), [], since.join('\n'));
    assert.deepEqual(since.filter((e) => e.startsWith('watch:')), []);
    assert.deepEqual(since.filter((e) => /^(readFile|readHead|stat|readDir|peekFile):.*untitled/.test(e)), []);
    assert.deepEqual(await writes(page), [], 'the shell has written nothing at all: its write log is empty');
    assert.match((await noticeText(page)).join('|'), /Opened as a new document \(not saved\)/);
  }, { argv: [] }));

test('the window title says Untitled, with a dot once it is changed', () =>
  withPage(async (page) => {
    await openScratch(page);
    await page.waitForSelector('#doc input[data-marxy-s]');
    await titleIs(page, 'Untitled — marxy');
    await toggle(page);
    await titleIs(page, 'Untitled — marxy •');
  }));

test('closing a never-edited scratch does not ask; after one operation it does', () =>
  withPage(async (page) => {
    await openScratch(page);
    await page.waitForSelector('#doc input[data-marxy-s]');
    await requestClose(page);
    await page.waitForFunction(() => window.__h.shell.calls.some((c) => c.method === 'confirmClose'));
    assert.ok(!(await noticeText(page)).some((t) => /has changes/.test(t)), 'a scratch only read asks nothing');
    assert.equal((await callsTo(page, 'confirmClose')).length, 1, 'the window closed');

    await toggle(page);
    await requestClose(page);
    await page.waitForFunction(() => /Untitled has changes that are not saved\./.test(document.querySelector('#marxy-notices')?.textContent ?? ''));
    assert.equal((await callsTo(page, 'confirmClose')).length, 1, 'still open: it asked');
    // Close without saving ends the walk and writes nothing.
    await clickButton(page, 'Close without saving');
    await page.waitForFunction(() => window.__h.shell.calls.filter((c) => c.method === 'confirmClose').length === 2);
    assert.deepEqual(await docWrites(page), []);
  }));

test('quitting with a changed scratch beside a saved document asks about the scratch, and Save and close saves it', () =>
  withPage(async (page) => {
    await page.evaluate(async () => { await window.__h.panes().openIn('other', '/d/a.md'); });
    await openScratch(page); // two panes: the other one, over its copy of a.md
    await page.waitForFunction(() => window.__h.panes().panes[1].path() === 'untitled');
    await page.waitForSelector('#marxy-main section:nth-of-type(2) input[data-marxy-s]');
    await toggle(page, 1);
    await requestClose(page);
    await page.waitForFunction(() => /Untitled has changes that are not saved\./.test(document.body.textContent));
    assert.equal((await callsTo(page, 'confirmClose')).length, 0, 'asked, did not close');
    const want = await bytesOf(page, 1);
    await page.evaluate(() => window.__h.shell.queueSaveDialog('/out/s.md'));
    await clickButton(page, 'Save and close');
    await page.waitForFunction(() => window.__h.shell.calls.some((c) => c.method === 'confirmClose'));
    const written = await docWrites(page);
    assert.equal(written.length, 1);
    assert.equal(written[0][0], '/out/s.md');
    assert.deepEqual(written[0][1], want);
  }));

test('Save As writes exactly the buffer, names the window, watches the file and Save then writes in place', () =>
  withPage(async (page) => {
    await openScratch(page, '# Hi\r\n\r\n- [ ] a\r\n\r\ncafé \u{1F600}\r\n');
    await page.waitForSelector('#doc input[data-marxy-s]');
    await toggle(page);
    const want = await bytesOf(page);
    const key = await mod(page);
    await page.evaluate(() => window.__h.shell.queueSaveDialog('/out/hi.md'));
    await page.keyboard.press(`${key}+Shift+KeyS`);
    await page.waitForFunction(() => window.__h.shell.calls.some((c) => c.method === 'writeFileAtomic'));
    await page.waitForFunction(() => window.__h.panes().panes[0].path() === '/out/hi.md');
    const first = await docWrites(page);
    assert.equal(first.length, 1);
    assert.equal(first[0][0], '/out/hi.md');
    assert.deepEqual(first[0][1], want, 'exactly the buffer bytes');
    assert.equal((await snapOf(page)).dirty, false);
    await titleIs(page, 'hi.md — marxy');
    await page.waitForFunction(() => window.__h.shell.calls.some((c) => c.method === 'watch' && c.args[0] === '/out'));

    // An ordinary document now: change it, Mod+S writes the same file with no dialog.
    await toggle(page);
    await page.keyboard.press(`${key}+KeyS`);
    await page.waitForFunction(() => window.__h.shell.calls.filter((c) => c.method === 'writeFileAtomic' && !c.args[0].startsWith('/data/')).length === 2);
    const second = await docWrites(page);
    assert.equal(second[1][0], '/out/hi.md');
    assert.deepEqual(second[1][1], await bytesOf(page));
    assert.equal((await callsTo(page, 'saveDialog')).length, 1, 'the dialog came once');
    assert.equal((await snapOf(page)).dirty, false);
  }));

test('Save on a scratch that was never edited still asks where; cancelling writes nothing', () =>
  withPage(async (page) => {
    await openScratch(page);
    await page.waitForSelector('#doc input[data-marxy-s]');
    const key = await mod(page);
    await page.keyboard.press(`${key}+KeyS`);
    await page.waitForFunction(() => window.__h.shell.calls.some((c) => c.method === 'saveDialog'));
    await page.waitForTimeout(150);
    assert.deepEqual(await docWrites(page), []);
    assert.equal((await snapOf(page)).path, 'untitled');
  }));

test('two scratch documents opened in a row have different paths', () =>
  withPage(async (page) => {
    await openScratch(page);
    await page.waitForSelector('#doc input[data-marxy-s]');
    const first = (await snapOf(page)).path;
    await openScratch(page, '# Second\n');
    await page.waitForFunction((p) => window.__h.panes().panes[0].path() !== p, first);
    const second = (await snapOf(page)).path;
    assert.notEqual(first, second);
    assert.ok(/^untitled(:\d+)?$/.test(first) && /^untitled(:\d+)?$/.test(second), `${first} ${second}`);
  }));

test('two scratch documents side by side keep their own undo histories', () =>
  withPage(async (page) => {
    await openScratch(page); // the one pane
    await page.waitForSelector('#doc input[data-marxy-s]');
    await page.evaluate(async () => { await window.__h.panes().openIn('other', '/d/a.md'); });
    await openScratch(page, '# Second\n\n- [ ] b\n'); // the other pane, over a.md
    await page.waitForFunction(() => window.__h.panes().panes[1].path()?.startsWith('untitled'));
    const paths = await page.evaluate(() => window.__h.panes().panes.map((p) => p.path()));
    assert.notEqual(paths[0], paths[1]);
    assert.ok(paths.every((p) => /^untitled(:\d+)?$/.test(p)), paths.join());
    await page.waitForSelector('#marxy-main section:nth-of-type(2) input[data-marxy-s]');

    const before0 = await textOf(page, 0);
    await toggle(page, 1);
    assert.equal(await textOf(page, 0), before0, 'editing one leaves the other alone');
    const edited1 = await textOf(page, 1);
    await toggle(page, 0);
    // Undo in the first store only.
    await page.evaluate(() => window.__h.panes().panes[0].content.store().undo());
    await page.waitForFunction(() => !window.__h.panes().panes[0].content.store().snapshot().canUndo);
    assert.equal(await textOf(page, 0), before0);
    assert.equal(await textOf(page, 1), edited1, 'the other scratch keeps its edit');
    assert.equal((await snapOf(page, 1)).canUndo, true);
  }));

test('a scratch opened with a label is called by it in the window title', () =>
  withPage(async (page) => {
    await openScratch(page, '# Named\n', { label: 'Pasted text' });
    await titleIs(page, 'Pasted text — marxy');
  }));

test('a relative image and a relative link in a scratch document are inert: a notice, no filesystem read', () =>
  withPage(async (page) => {
    const text = '![pic](pics/a.png)\n\n![root](/pics/b.png)\n\n[other](other.md)\n\n[up](../x.md#h)\n';
    await page.evaluate(() => { window.__h.shell.calls.length = 0; });
    await openScratch(page, text);
    await page.waitForSelector('#doc a');
    await page.waitForFunction(() => document.querySelectorAll('#doc img[data-marxy-done="images"]').length === 2 || document.querySelectorAll('#doc img').length === 0);
    // Let the deferred image pass run.
    await page.waitForTimeout(400);
    const images = await page.evaluate(() => [...document.querySelectorAll('#doc img')].map((i) => i.getAttribute('src')));
    assert.deepEqual(images.filter((s) => s !== null), [], 'no image has a source');

    await page.locator('#doc a', { hasText: 'other' }).click();
    await page.waitForFunction(() => /That link points outside this folder and was not opened\./.test(document.body.textContent));
    await page.locator('#doc a', { hasText: 'up' }).click();
    await page.waitForTimeout(150);
    assert.equal((await snapOf(page)).path, 'untitled', 'nothing opened');
    // Everything the shell was asked since the page was set: Marxy's own state under /data and /config (and collection.toml beside
    // it, which the version recorder reads for its deny rules, V-06) aside, no read
    // of any file, no stat, no listing, no asset scope or image size, no watch and no write.
    const since = await log(page);
    const touched = since.filter((e) => {
      const [method, ...rest] = e.split(':');
      return /^(readFile|readHead|stat|readDir|peekFile|imageSize|allowAssetScope|assetUrl|watch|writeFileAtomic)$/.test(method) && !/^\/(data|config|collection\.toml)\b/.test(rest.join(':'));
    });
    assert.deepEqual(touched, [], since.join('\n'));
  }));

test('layout.json and the places never hold a scratch: not its path, not its text', () =>
  withPage(async (page) => {
    await page.evaluate(async () => { await window.__h.panes().openIn('other', '/d/a.md'); });
    await openScratch(page); // the other pane
    await page.waitForFunction(() => window.__h.panes().panes[1].path() === 'untitled');
    await page.waitForTimeout(300);
    await page.evaluate(() => window.__h.shell.quit(0));
    const all = (await writes(page)).map(([path, bytes]) => [path, Buffer.from(bytes).toString('utf8')]);
    for (const [path, content] of all) {
      assert.ok(!/untitled/.test(path) && !/untitled/.test(content), `${path} names a scratch: ${content}`);
      assert.ok(!content.includes(SECRET), `${path} holds the scratch text`);
    }
    // And nothing of it was written as the layout: a restart finds the saved document alone, or no layout.
    const layout = all.find(([path]) => path.endsWith('/layout.json'));
    if (layout) assert.deepEqual(JSON.parse(layout[1]).columns.map((c) => c.path), ['/d/a.md']);
  }));

test('the palette history and the index never hear of a scratch document', () =>
  withPage(async (page) => {
    await page.evaluate(() => window.__h.shell.calls.splice(0));
    await openScratch(page);
    await page.waitForSelector('#doc input[data-marxy-s]');
    await page.waitForTimeout(400);
    const entries = await page.evaluate(() => window.__h.index.entries?.().map((e) => e.path) ?? []);
    assert.ok(entries.every((p) => !/untitled/.test(p)), entries.join());
    await page.evaluate(() => window.__h.shell.quit(0));
    const history = (await writes(page)).filter(([path]) => /history\.json$/.test(path));
    for (const [, bytes] of history) assert.ok(!Buffer.from(bytes).toString('utf8').includes('untitled'));
  }));
