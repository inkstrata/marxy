// The toolbar (W-05): a row of doors in the unfolded workspace's toolbar region, each drawn only when its command
// exists; nothing at all when folded. The real app on the shipped skeleton and CSS over the memory shell, in WebKit
// (test/support/two-pane.mjs), as workspace.test.mjs does.
import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { after, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { launchWebkit } from '../../../../scripts/playwright-webkit.mjs';
import { bootTwoPanes, closeHarness } from '../../test/support/two-pane.mjs';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);
after(() => closeHarness());

const para = (word) =>
  `${word} runs long enough to wrap across several lines of the column, so that the typesetter has ` +
  'real paragraphs to break and the page is tall enough to scroll a heading to the reading line. ';
const files = {
  '/r/A.md': `# Alpha\n\n${para('Alpha').repeat(3)}\n\nSee [the other one](./B.md) for more.\n\n${para('Alpha').repeat(8)}\n`,
  '/r/B.md': `# Bravo\n\n${para('Bravo').repeat(4)}\n`,
};

async function withPage(width, fn, { open = ['/r/A.md'], height = 900 } = {}) {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width, height } });
    await bootTwoPanes(page, { files, open });
    await fn(page);
  } finally {
    await browser.close();
  }
}

const unfold = (page) => page.evaluate(() => window.__marxyHandle.workspace().unfold());
const fold = (page) => page.evaluate(() => window.__marxyHandle.workspace().fold());
const mod = async (page) => ((await page.evaluate(() => navigator.platform)) === 'MacIntel' ? 'Meta' : 'Control');

/** Everything of the toolbar that is in the page. */
const nodes = (page) =>
  page.evaluate(() => ({
    toolbar: document.querySelectorAll('.marxy-toolbar:not(.marxy-strip), [role="toolbar"]:not(.marxy-strip)').length,
    items: document.querySelectorAll('[data-marxy-toolbar-item]:not([data-marxy-toolbar-item="more"])').length,
    buttons: document.querySelectorAll('.marxy-toolbar:not(.marxy-strip) button').length,
  }));
const items = (page) => page.evaluate(() => [...document.querySelectorAll('[data-marxy-toolbar-item]:not([data-marxy-toolbar-item="more"])')].map((el) => el.getAttribute('data-marxy-toolbar-item')));
const radios = (page) =>
  page.evaluate(() => Object.fromEntries([...document.querySelectorAll('[data-marxy-toolbar-item="mode"] [role="radio"]')].map((r) => [r.textContent, r.getAttribute('aria-checked')])));
const control = (page, name) => page.locator(`[data-marxy-workspace-region="toolbar"] button[aria-label="${name}"]`);
const column = (page) =>
  page.evaluate(() => {
    const r = document.getElementById('doc').getBoundingClientRect();
    return { x: r.x, width: r.width };
  });

// --- folded is today: chrome at rest is zero ---------------------------------------------------------------------

test('folded, no toolbar node exists; unfolding makes it, folding takes it out, and again', async () => {
  await withPage(1280, async (page) => {
    assert.deepEqual(await nodes(page), { toolbar: 0, items: 0, buttons: 0 }, 'a fresh window is folded');
    await unfold(page);
    const open = await nodes(page);
    assert.equal(open.toolbar, 1);
    assert.ok(open.items >= 6 && open.buttons >= 6, JSON.stringify(open));
    await fold(page);
    assert.deepEqual(await nodes(page), { toolbar: 0, items: 0, buttons: 0 }, 'folded again');
    await unfold(page);
    assert.equal((await nodes(page)).toolbar, 1, 'the next unfold makes it again, once');
  });
});

test('a fill is made on unfold, disposed on fold and made again on the next unfold; hasFill says so', async () => {
  await withPage(1280, async (page) => {
    const got = await page.evaluate(async () => {
      const ws = window.__marxyHandle.workspace();
      const log = [];
      // The tab row (W-06) fills `tabs` itself, so this stub joins it: it adds one element of its own and takes out only that.
      const before = ws.hasFill('tabs');
      const stubs = () => ws.region('tabs').querySelectorAll('[data-stub]').length;
      const withdraw = ws.fill('tabs', (el) => {
        const stub = document.createElement('i');
        stub.setAttribute('data-stub', '');
        el.append(stub);
        log.push(`made ${el.getAttribute('data-marxy-workspace-region')}`);
        return () => {
          stub.remove();
          log.push('disposed');
        };
      });
      const registered = ws.hasFill('tabs');
      log.push(`folded: ${document.querySelector('[data-marxy-workspace-region="strip"]') === null}`);
      await ws.unfold();
      log.push(`stubs: ${stubs()}`);
      await ws.fold();
      await ws.unfold();
      log.push(`again: ${stubs()}`);
      withdraw();
      log.push(`withdrawn: ${ws.hasFill('tabs')}`);
      await ws.fold();
      await ws.unfold();
      log.push(`after: ${stubs()}`);
      // Registered while unfolded, it is made at once.
      ws.fill('status-bar', (el) => void (el.textContent = 'late'));
      log.push(`late: ${ws.region('status-bar').textContent}`);
      return { before, registered, log };
    });
    assert.deepEqual(got, {
      before: true,
      registered: true,
      // `withdrawn` stays true: the tab row's own fill is still registered.
      log: ['folded: true', 'made tabs', 'stubs: 1', 'disposed', 'made tabs', 'again: 1', 'disposed', 'withdrawn: true', 'after: 0', 'late: late'],
    });
  });
});

// --- what is drawn ------------------------------------------------------------------------------------------------

test('unfolded with a document open: back, forward, title, Read/Split/Source, the kind chip, Copy, Transform (W-21) and Find, in that order, and the sidebar toggle before them (W-07), and nothing else', async () => {
  await withPage(1280, async (page) => {
    await unfold(page);
    assert.deepEqual(await items(page), ['sidebar', 'back', 'forward', 'title', 'mode', 'kind', 'copy', 'transform', 'find']);
    const buttons = await page.evaluate(() => [...document.querySelectorAll('.marxy-toolbar button')].filter((b) => !b.closest('[hidden]')).map((b) => b.getAttribute('aria-label')));
    assert.deepEqual(buttons, ['Show or hide the sidebar', 'Back', 'Forward', 'Read', 'Split: Read and Source side by side', 'Source', 'Kind: article. How this file is read', 'Copy as Markdown', 'Copy as…', 'Transform', 'Find in this pane']);
    assert.deepEqual(await radios(page), { Read: 'true', Split: 'false', Source: 'false' });
    const wording = await page.evaluate(() => document.querySelector('[data-marxy-workspace-region="toolbar"]').textContent);
    assert.doesNotMatch(wording, /extract|theme/i);
  });
});

test('the door: a registered command draws its control, the next mount draws it in place, and it goes when the command does', async () => {
  await withPage(1280, async (page) => {
    const got = await page.evaluate(async () => {
      const handle = window.__marxyHandle;
      const ws = handle.workspace();
      const real = handle.commands.bind(handle);
      const ran = [];
      const stub = (id, title) => ({ id, title, group: 'view', when: () => true, async run() { ran.push(id); } });
      const read = () => [...document.querySelectorAll('[data-marxy-toolbar-item]:not([data-marxy-toolbar-item="more"])')].map((el) => el.getAttribute('data-marxy-toolbar-item'));
      const remount = async () => { await ws.fold(); await ws.unfold(); };
      handle.commands = () => [...real(), stub('transform.open', 'Transform'), stub('export.menu', 'Export')];
      await remount();
      const added = read();
      document.querySelector('[data-marxy-toolbar-item="transform"] button').click();
      await new Promise((r) => setTimeout(r, 50));
      handle.commands = real;
      await remount();
      return { added, ran, removed: read() };
    });
    assert.deepEqual(got.added, ['sidebar', 'back', 'forward', 'title', 'mode', 'kind', 'copy', 'export', 'transform', 'find']);
    assert.deepEqual(got.ran, ['transform.open'], 'the control runs its command');
    assert.deepEqual(got.removed, ['sidebar', 'back', 'forward', 'title', 'mode', 'kind', 'copy', 'transform', 'find']);
  });
});

test('a panel toggle waits for content in its region: a stub command alone draws nothing, command and fill draw it', async () => {
  await withPage(1280, async (page) => {
    const got = await page.evaluate(async () => {
      const handle = window.__marxyHandle;
      const ws = handle.workspace();
      const real = handle.commands.bind(handle);
      const toggles = [{ id: 'view.toggle-sidebar', title: 'Sidebar', group: 'view', when: () => true, async run() { ws.setPanel('sidebar', !ws.arrangement.sidebar); } }];
      const read = () => [...document.querySelectorAll('[data-marxy-toolbar-item]:not([data-marxy-toolbar-item="more"])')].map((el) => el.getAttribute('data-marxy-toolbar-item'));
      handle.commands = () => [...real(), ...toggles];
      // The sidebar has a real fill since W-07; for the first leg `hasFill` says it has none, as it did before.
      const realHasFill = ws.hasFill.bind(ws);
      ws.hasFill = (region) => region !== 'sidebar' && realHasFill(region);
      await ws.unfold();
      const without = read();
      await ws.fold();
      ws.hasFill = realHasFill;
      await ws.unfold();
      const withFill = read();
      const pressed = () => document.querySelector('[data-marxy-toolbar-item="sidebar"] button').getAttribute('aria-pressed');
      const docked = pressed();
      document.querySelector('[data-marxy-toolbar-item="sidebar"] button').click();
      await new Promise((r) => setTimeout(r, 50));
      return { without, withFill, docked, undocked: pressed() };
    });
    assert.deepEqual(got.without, ['back', 'forward', 'title', 'mode', 'kind', 'copy', 'transform', 'find']);
    assert.deepEqual(got.withFill, ['sidebar', 'back', 'forward', 'title', 'mode', 'kind', 'copy', 'transform', 'find']);
    assert.deepEqual([got.docked, got.undocked], ['true', 'false']);
  });
});

// --- the mode switch ----------------------------------------------------------------------------------------------

test('Source puts the focused pane in Source and checks it; ⌘E moves the check; Read puts it back', async () => {
  await withPage(1280, async (page) => {
    await unfold(page);
    await control(page, 'Source').click();
    await page.waitForSelector('.cm-editor');
    assert.equal(await page.evaluate(() => window.__marxyHandle.panes().focused.view.mode), 'source');
    assert.deepEqual(await radios(page), { Read: 'false', Split: 'false', Source: 'true' });
    await page.keyboard.press(`${await mod(page)}+KeyE`);
    await page.waitForFunction(() => window.__marxyHandle.panes().focused.view.mode === 'rendered');
    assert.deepEqual(await radios(page), { Read: 'true', Split: 'false', Source: 'false' });
    await page.keyboard.press(`${await mod(page)}+KeyE`);
    await page.waitForFunction(() => window.__marxyHandle.panes().focused.view.mode === 'source');
    assert.deepEqual(await radios(page), { Read: 'false', Split: 'false', Source: 'true' });
    await control(page, 'Read').click();
    await page.waitForFunction(() => window.__marxyHandle.panes().focused.view.mode === 'rendered');
    assert.deepEqual(await radios(page), { Read: 'true', Split: 'false', Source: 'false' });
  });
});

// Two panes need two columns' room, panels included (workspace.test.mjs): these windows are wide enough.
test('Split makes two panes on one path and checks Split', async () => {
  await withPage(1700, async (page) => {
    await unfold(page);
    await control(page, 'Split: Read and Source side by side').click();
    await page.waitForFunction(() => window.__marxyHandle.panes().panes.length === 2 && window.__marxyHandle.panes().panes[1].view.mode === 'source');
    const paths = await page.evaluate(() => window.__marxyHandle.panes().panes.map((p) => p.path()));
    assert.equal(paths[0], paths[1], 'one path in two panes');
    assert.deepEqual(await radios(page), { Read: 'false', Split: 'true', Source: 'false' });
  });
});

test('two panes on one path check Split from the start, and two documents do not', async () => {
  await withPage(1700, async (page) => {
    await unfold(page);
    await page.evaluate(() => window.__marxyHandle.panes().openIn('other', '/r/A.md'));
    await page.waitForFunction(() => window.__marxyHandle.panes().panes.length === 2);
    assert.deepEqual(await radios(page), { Read: 'false', Split: 'true', Source: 'false' });
  });
  await withPage(1700, async (page) => {
    await unfold(page);
    await page.evaluate(() => window.__marxyHandle.panes().openIn('other', '/r/B.md'));
    await page.waitForFunction(() => window.__marxyHandle.panes().panes.length === 2);
    assert.deepEqual(await radios(page), { Read: 'true', Split: 'false', Source: 'false' });
  });
});

// --- Copy ---------------------------------------------------------------------------------------------------------

test('Copy writes one pasteboard item in the configured target; its chevron opens the Copy as menu', async () => {
  await withPage(1280, async (page) => {
    await unfold(page);
    const writes = () => page.evaluate(() => window.__marxyHandle.shell.calls.filter((c) => c.method === 'clipboardWriteItem').length);
    assert.equal(await writes(), 0);
    await control(page, 'Copy as Markdown').click();
    await page.waitForFunction(() => window.__marxyHandle.shell.calls.some((c) => c.method === 'clipboardWriteItem'));
    assert.equal(await writes(), 1, 'one item');
    const item = await page.evaluate(() => {
      const call = window.__marxyHandle.shell.calls.find((c) => c.method === 'clipboardWriteItem');
      return call.args[0].map((r) => r.type);
    });
    assert.deepEqual(item, ['public.utf8-plain-text'], 'Markdown is plain text only');
    assert.equal(await page.locator('.marxy-verb-menu').count(), 0, 'the click opened no menu');
    await control(page, 'Copy as…').click();
    await page.waitForSelector('.marxy-verb-menu');
    const rows = await page.evaluate(() => [...document.querySelectorAll('.marxy-verb-menu [role="menuitem"]')].map((r) => r.getAttribute('data-row-key')));
    assert.equal(rows[0], 'copy-as.markdown');
    assert.ok(rows.length >= 6, rows.join());
    assert.equal(await writes(), 1, 'opening the menu wrote nothing');
  });
});

test('Copy follows copy_format in config.toml', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await bootTwoPanes(page, { files: { ...files, '/cfg/config.toml': 'copy_format = "html"\n' }, open: ['/r/A.md'] });
    await page.evaluate(() => {
      const shell = window.__marxyHandle.shell;
      shell.configPaths = async () => ({ config: '/cfg/config.toml', data: '/cfg/data' });
    });
    await unfold(page);
    await control(page, 'Copy as HTML source').waitFor();
    await control(page, 'Copy as HTML source').click();
    await page.waitForFunction(() => window.__marxyHandle.shell.calls.some((c) => c.method === 'clipboardWriteItem'));
    // HTML source is the HTML as text: one plain-text representation that holds the markup.
    const text = await page.evaluate(() => {
      const call = window.__marxyHandle.shell.calls.find((c) => c.method === 'clipboardWriteItem');
      return new TextDecoder().decode(call.args[0][0].bytes);
    });
    assert.match(text, /<h1[^>]*>Alpha/, text.slice(0, 80));
  } finally {
    await browser.close();
  }
});

// --- Back, Forward ------------------------------------------------------------------------------------------------

test('Back is aria-disabled on the first document and enabled after a second is opened; it goes back', async () => {
  await withPage(1280, async (page) => {
    await unfold(page);
    const state = () => page.evaluate(() => ({
      back: document.querySelector('[aria-label="Back"]').getAttribute('aria-disabled'),
      forward: document.querySelector('[aria-label="Forward"]').getAttribute('aria-disabled'),
    }));
    assert.deepEqual(await state(), { back: 'true', forward: 'true' });
    await page.locator('article#doc a[href="./B.md"]').click();
    await page.waitForFunction(() => window.__marxyHandle.currentPath() === '/r/B.md');
    assert.equal((await state()).back, null, 'a link was followed: there is somewhere to go back to');
    await control(page, 'Back').click();
    await page.waitForFunction(() => window.__marxyHandle.currentPath() === '/r/A.md');
  });
});

test('W-05.2: follow a link, Back once: Back is disabled again at the start of the link history', async () => {
  await withPage(1280, async (page) => {
    await unfold(page);
    const back = () => page.evaluate(() => document.querySelector('[aria-label="Back"]').getAttribute('aria-disabled'));
    await page.locator('article#doc a[href="./B.md"]').click();
    await page.waitForFunction(() => window.__marxyHandle.currentPath() === '/r/B.md');
    assert.equal(await back(), null, 'enabled after the link');
    await control(page, 'Back').click();
    await page.waitForFunction(() => window.__marxyHandle.currentPath() === '/r/A.md');
    await page.waitForFunction(() => document.querySelector('[aria-label="Back"]').getAttribute('aria-disabled') === 'true');
    assert.equal(await page.evaluate(() => window.__marxyHandle.selection.canBack()), false);
    assert.equal(await page.evaluate(() => window.__marxyHandle.selection.back()), false, 'and pressing it would do nothing');
  });
});

test('Back is enabled for a link followed while the window was folded, and not for a document merely opened', async () => {
  await withPage(1280, async (page) => {
    await page.locator('article#doc a[href="./B.md"]').click();
    await page.waitForFunction(() => window.__marxyHandle.currentPath() === '/r/B.md');
    await unfold(page);
    assert.equal(await page.evaluate(() => document.querySelector('[aria-label="Back"]').getAttribute('aria-disabled')), null);
  });
  await withPage(1280, async (page) => {
    await page.evaluate(() => window.__marxyHandle.open('/r/B.md'));
    await page.waitForFunction(() => window.__marxyHandle.currentPath() === '/r/B.md');
    await unfold(page);
    assert.equal(await page.evaluate(() => document.querySelector('[aria-label="Back"]').getAttribute('aria-disabled')), 'true', 'Back would do nothing');
  });
});

// --- the title ----------------------------------------------------------------------------------------------------

test('the title shows the name and folder, a dot while unsaved, and Untitled for a scratch document', async () => {
  await withPage(1280, async (page) => {
    await unfold(page);
    const title = () =>
      page.evaluate(() => {
        const t = document.querySelector('[data-marxy-toolbar-item="title"]');
        return {
          name: t.querySelector('.marxy-toolbar-name').textContent,
          folder: t.querySelector('.marxy-toolbar-folder').textContent,
          dot: !t.querySelector('.marxy-toolbar-dirty').hidden,
        };
      });
    assert.deepEqual(await title(), { name: 'A.md', folder: 'r', dot: false });
    await page.evaluate(() => {
      const store = window.__marxyHandle.document();
      return store.apply({ range: { file: '/r/A.md', start: 2, end: 7 }, replacement: 'Edited', label: 'edit', baseVersion: store.snapshot().version });
    });
    assert.deepEqual(await title(), { name: 'A.md', folder: 'r', dot: true }, 'an edit');
    await page.evaluate(() => window.__marxyHandle.save());
    assert.deepEqual(await title(), { name: 'A.md', folder: 'r', dot: false }, 'a save');
    await page.evaluate(() => window.__marxyHandle.openScratch('# Notes\n\nA scratch.\n'));
    await page.waitForFunction(() => window.__marxyHandle.currentPath()?.startsWith('untitled'));
    const scratch = await title();
    assert.equal(scratch.name, 'Untitled');
    assert.equal(scratch.folder, '');
  });
});

test('the title follows the pane that has focus', async () => {
  await withPage(1700, async (page) => {
    await unfold(page);
    await page.evaluate(() => window.__marxyHandle.panes().openIn('other', '/r/B.md'));
    await page.waitForFunction(() => window.__marxyHandle.panes().panes.length === 2);
    const name = () => page.evaluate(() => document.querySelector('.marxy-toolbar-name').textContent);
    await page.evaluate(() => { const p = window.__marxyHandle.panes(); p.focus(p.panes[0]); });
    assert.equal(await name(), 'A.md');
    await page.evaluate(() => { const p = window.__marxyHandle.panes(); p.focus(p.panes[1]); });
    assert.equal(await name(), 'B.md');
  });
});

// --- geometry -----------------------------------------------------------------------------------------------------

test('the reading column has the same left edge and width before and after the toolbar fills, and the toolbar is in its region', async () => {
  for (const width of [1280, 1700]) {
    await withPage(width, async (page) => {
      const folded = await column(page);
      await unfold(page);
      await page.waitForTimeout(100);
      assert.deepEqual(await column(page), folded, `at ${width}`);
      const placed = await page.evaluate(() => {
        const region = document.querySelector('[data-marxy-workspace-region="toolbar"]').getBoundingClientRect();
        const bar = document.querySelector('.marxy-toolbar').getBoundingClientRect();
        const outside = [...document.body.querySelectorAll('.marxy-toolbar:not(.marxy-strip), .marxy-toolbar:not(.marxy-strip) *')].filter((el) => !el.closest('[data-marxy-workspace-region="toolbar"]')).length;
        return { within: bar.left >= region.left - 0.5 && bar.right <= region.right + 0.5 && bar.top >= region.top - 0.5 && bar.bottom <= region.bottom + 0.5, outside };
      });
      assert.deepEqual(placed, { within: true, outside: 0 });
    });
  }
});

/** Which buttons lie outside the toolbar region, and how far the row runs past its box. */
const fitOf = (page) =>
  page.evaluate(() => {
    const region = document.querySelector('[data-marxy-workspace-region="toolbar"]').getBoundingClientRect();
    const bar = document.querySelector('.marxy-toolbar');
    const clipped = [...bar.querySelectorAll('button')]
      .filter((b) => !b.closest('[hidden]'))
      .map((b) => ({ name: b.getAttribute('aria-label'), r: b.getBoundingClientRect() }))
      .filter(({ r }) => r.left < region.left - 0.5 || r.right > region.right + 0.5 || r.top < region.top - 0.5 || r.bottom > region.bottom + 0.5)
      .map(({ name }) => name);
    return { clipped, overflow: bar.scrollWidth - bar.clientWidth, region: Math.round(region.width) };
  });

test('the controls fit the toolbar region at the default chrome size in the narrowest window, and at chrome_size 26 in a wide one (the title now keeps five ems, W-04)', async () => {
  await withPage(929, async (page) => {
    await unfold(page);
    await page.waitForTimeout(100);
    const fit = await fitOf(page);
    assert.deepEqual(fit.clipped, [], `default chrome at 929 px: ${JSON.stringify(fit)}`);
    assert.ok(fit.overflow <= 0, JSON.stringify(fit));
  });
  await withPage(1440, async (page) => {
    await page.evaluate(() => document.documentElement.style.setProperty('--marxy-size-chrome', '26px'));
    await unfold(page);
    await page.waitForTimeout(100);
    const fit = await fitOf(page);
    assert.deepEqual(fit.clipped, [], `chrome_size 26 at 1440 px: ${JSON.stringify(fit)}`);
  });
});

/** The doors a later story registers, stubbed, so the row is measured as it will be with every door in it. */
const registerEveryDoor = (page) =>
  page.evaluate(() => {
    const handle = window.__marxyHandle;
    const real = handle.commands.bind(handle);
    const stub = (id, title) => ({ id, title, group: 'view', when: () => true, async run() { window.__ran = [...(window.__ran ?? []), id]; } });
    handle.commands = () => [...real(), stub('transform.open', 'Transform'), stub('export.menu', 'Export'), stub('document.new-menu', 'New')];
  });

test('with every door registered the real row still fits at 929 px and at chrome_size 26 in a wide window; what does not fit is in More, and runs', async () => {
  await withPage(929, async (page) => {
    await registerEveryDoor(page);
    await unfold(page);
    await page.waitForTimeout(150);
    const fit = await fitOf(page);
    assert.deepEqual(fit.clipped, [], JSON.stringify(fit));
    assert.ok(fit.overflow <= 0, JSON.stringify(fit));
    const state = await page.evaluate(() => ({
      more: !document.querySelector('[data-marxy-toolbar-item="more"]').hidden,
      folded: [...document.querySelectorAll('.marxy-toolbar [data-marxy-toolbar-item][hidden]')].map((el) => el.getAttribute('data-marxy-toolbar-item')).filter((id) => id !== 'more'),
    }));
    assert.equal(state.more, true);
    assert.ok(state.folded.includes('transform') && state.folded.includes('export'), `the lowest doors fold first: ${state.folded}`);
    // Every folded door is reachable from More, by the keyboard, and runs its command.
    await page.locator('[data-marxy-toolbar-item="more"] button').focus();
    await page.keyboard.press('Enter');
    await page.waitForSelector('.marxy-verb-menu');
    const rows = await page.evaluate(() => [...document.querySelectorAll('.marxy-verb-menu [role="menuitem"]')].map((r) => r.dataset.rowKey));
    assert.ok(rows.includes('transform.open') && rows.includes('export.menu'), rows.join());
    await page.click('.marxy-verb-menu [data-row-key="transform.open"]');
    assert.ok((await page.evaluate(() => window.__ran)).includes('transform.open'));
  });
  await withPage(1440, async (page) => {
    await registerEveryDoor(page);
    await page.evaluate(() => document.documentElement.style.setProperty('--marxy-size-chrome', '26px'));
    await unfold(page);
    await page.waitForTimeout(150);
    const fit = await fitOf(page);
    assert.deepEqual(fit.clipped, [], JSON.stringify(fit));
    assert.ok(fit.overflow <= 0, JSON.stringify(fit));
  });
  await withPage(1440, async (page) => {
    await registerEveryDoor(page);
    await unfold(page);
    await page.waitForTimeout(150);
    assert.equal(await page.evaluate(() => document.querySelector('[data-marxy-toolbar-item="more"]').hidden), true, 'a wide window folds nothing');
  });
});

test('at chrome_size 26 in the narrowest window the row is wider than its box, and every control can still be reached', async () => {
  await withPage(929, async (page) => {
    await page.evaluate(() => document.documentElement.style.setProperty('--marxy-size-chrome', '26px'));
    await unfold(page);
    await page.waitForTimeout(100);
    const before = await fitOf(page);
    assert.ok(before.overflow > 0, `this is the case the PR reports: ${JSON.stringify(before)}`);
    // The row scrolls to a control that takes focus (Tab, or End in the row): none is out of reach.
    // (the first control, the sidebar's toggle, is folded into More here: the first one in the row is Back)
    await page.locator('[data-marxy-toolbar-item="back"] button').focus();
    await page.keyboard.press('End');
    const last = await page.evaluate(() => {
      const region = document.querySelector('[data-marxy-workspace-region="toolbar"]').getBoundingClientRect();
      const r = document.activeElement.getBoundingClientRect();
      return { name: document.activeElement.getAttribute('aria-label'), inside: r.left >= region.left - 0.5 && r.right <= region.right + 0.5 };
    });
    assert.deepEqual(last, { name: 'More tools', inside: true });
  });
});

/** The title's box and the row's, in px, and the em the title's minimum is measured in. */
const titleOf = (page) =>
  page.evaluate(() => {
    const bar = document.querySelector('.marxy-toolbar');
    const title = bar.querySelector('[data-marxy-toolbar-item="title"]');
    return {
      title: title.getBoundingClientRect().width,
      minimum: parseFloat(getComputedStyle(title).minWidth),
      em: parseFloat(getComputedStyle(title).fontSize),
      overflow: bar.scrollWidth - bar.clientWidth,
      attachment: getComputedStyle(bar).backgroundAttachment,
      image: getComputedStyle(bar).backgroundImage,
    };
  });

test('W-04: the title keeps its minimum at the narrowest window, at the default size and at chrome_size 26; the row that cannot fit scrolls and shows it', async () => {
  await withPage(929, async (page) => {
    await unfold(page);
    await page.waitForTimeout(100);
    const normal = await titleOf(page);
    assert.equal(normal.minimum, 5 * normal.em, 'the title declares five ems');
    assert.ok(normal.title >= normal.minimum - 0.5, `the title has its minimum at the default size: ${JSON.stringify(normal)}`);
    assert.ok(normal.overflow <= 0, `and the row fits: ${JSON.stringify(normal)}`);
    await page.evaluate(() => document.documentElement.style.setProperty('--marxy-size-chrome', '26px'));
    await page.waitForTimeout(100);
    const big = await titleOf(page);
    assert.ok(big.title >= big.minimum - 0.5 && big.title > 100, `the title is not squeezed to nothing at chrome_size 26: ${JSON.stringify(big)}`);
    assert.ok(big.overflow > 0, `the row scrolls: ${JSON.stringify(big)}`);
    // The sign: an edge shadow that shows while more is out of sight, and a ground drawn over it once the end is reached.
    assert.match(big.attachment, /local.*local.*scroll.*scroll/, big.attachment);
    assert.equal((big.image.match(/linear-gradient/g) ?? []).length, 4, big.image);
    // Scrolling to the end reaches the last control.
    await page.evaluate(() => { const bar = document.querySelector('.marxy-toolbar'); bar.scrollLeft = bar.scrollWidth; });
    const reached = await fitOf(page);
    assert.equal(reached.overflow > 0, true);
    const last = await page.evaluate(() => {
      const region = document.querySelector('[data-marxy-workspace-region="toolbar"]').getBoundingClientRect();
      const r = [...document.querySelectorAll('.marxy-toolbar button')].at(-1).getBoundingClientRect();
      return r.right <= region.right + 0.5;
    });
    assert.equal(last, true, 'the last control is reachable by scrolling');
  });
});

test('W-04: checked, pressed, disabled and focused toolbar controls look different from the rest, from the surface roles', async () => {
  await withPage(1280, async (page) => {
    await unfold(page);
    const look = (label) =>
      page.evaluate((label) => {
        const el = [...document.querySelectorAll('.marxy-toolbar button')].find((b) => b.getAttribute('aria-label') === label);
        const cs = getComputedStyle(el);
        return { background: cs.backgroundColor, color: cs.color, shadow: cs.boxShadow, outline: cs.outlineStyle, radius: cs.borderTopLeftRadius };
      }, label);
    const role = (name) =>
      page.evaluate((name) => {
        const probe = document.createElement('i');
        probe.style.cssText = `color: var(${name}); background: var(${name})`;
        document.body.append(probe);
        const c = getComputedStyle(probe).color;
        probe.remove();
        return c;
      }, name);
    const read = await look('Read');
    const source = await look('Source');
    const find = await look('Find in this pane');
    assert.equal(await page.evaluate(() => document.querySelector('[aria-label="Read"]').getAttribute('aria-checked')), 'true');
    assert.notEqual(read.background, source.background, 'the checked radio has its own ground');
    assert.notEqual(read.shadow, 'none', 'and a line under it, not colour alone');
    assert.equal(source.shadow, 'none');
    assert.equal(find.radius, '6px');
    // Pressed (a panel toggle's state) is drawn as checked is.
    await page.evaluate(() => document.querySelector('[aria-label="Find in this pane"]').setAttribute('aria-pressed', 'true'));
    const pressed = await look('Find in this pane');
    assert.equal(pressed.background, read.background);
    assert.equal(pressed.shadow, read.shadow);
    // Disabled is the secondary text, whatever else it is.
    await page.evaluate(() => document.querySelector('[aria-label="Back"]').getAttribute('aria-disabled') === 'true' || document.querySelector('[aria-label="Back"]').setAttribute('aria-disabled', 'true'));
    const back = await look('Back');
    assert.equal(back.color, await role('--marxy-color-text-secondary'));
    assert.notEqual(back.color, source.color);
    // Focus from the keyboard draws the accent outline.
    await page.locator('.marxy-toolbar button').nth(2).focus();
    await page.keyboard.press('ArrowRight');
    const focused = await page.evaluate(() => { const cs = getComputedStyle(document.activeElement); return { style: cs.outlineStyle, color: cs.outlineColor }; });
    assert.equal(focused.style, 'solid');
    assert.equal(focused.color, await role('--marxy-color-accent'));
  });
});

test('W-04: under forced-colors a checked or pressed control, a disabled one and the focused one are each distinguishable, in system colours', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 929, height: 900 }, forcedColors: 'active' });
    await bootTwoPanes(page, { files, open: ['/r/A.md'] });
    await unfold(page);
    await page.evaluate(() => document.documentElement.style.setProperty('--marxy-size-chrome', '26px'));
    await page.evaluate(() => document.querySelector('[aria-label="Find in this pane"]').setAttribute('aria-pressed', 'true'));
    const look = (label) =>
      page.evaluate((label) => {
        const cs = getComputedStyle([...document.querySelectorAll('.marxy-toolbar button')].find((b) => b.getAttribute('aria-label') === label));
        return { background: cs.backgroundColor, color: cs.color };
      }, label);
    const sys = (name) =>
      page.evaluate((name) => {
        const el = document.createElement('i');
        el.style.cssText = `color: ${name}; background: ${name}`;
        document.body.append(el);
        const v = getComputedStyle(el).color;
        el.remove();
        return v;
      }, name);
    const checked = await look('Read');
    const pressed = await look('Find in this pane');
    const plain = await look('Source');
    assert.equal(checked.background, await sys('Highlight'), 'checked is Highlight');
    assert.equal(checked.color, await sys('HighlightText'));
    assert.deepEqual(pressed, checked, 'pressed is drawn as checked');
    assert.notEqual(plain.background, checked.background, 'an unchecked control is not');
    await page.evaluate(() => document.querySelector('[aria-label="Source"]').setAttribute('aria-disabled', 'true'));
    assert.equal((await look('Source')).color, await sys('GrayText'), 'disabled is GrayText');
    await page.locator('.marxy-toolbar button').nth(2).focus();
    await page.keyboard.press('ArrowRight');
    const focus = await page.evaluate(() => { const cs = getComputedStyle(document.activeElement); return { style: cs.outlineStyle, color: cs.outlineColor }; });
    assert.equal(focus.style, 'solid');
    assert.equal(focus.color, await sys('Highlight'));
    const bar = await page.evaluate(() => { const b = document.querySelector('.marxy-toolbar'); return { over: b.scrollWidth > b.clientWidth, image: getComputedStyle(b).backgroundImage }; });
    assert.ok(bar.over && (bar.image.match(/linear-gradient/g) ?? []).length === 4, 'the scroll fade survives: ' + JSON.stringify(bar));
  } finally {
    await browser.close();
  }
});

// --- keyboard and names -------------------------------------------------------------------------------------------

test('every control has an accessible name; Tab reaches the toolbar once, arrows move within it, Return activates', async () => {
  await withPage(1280, async (page) => {
    await unfold(page);
    const named = await page.evaluate(() => [...document.querySelectorAll('.marxy-toolbar button')].map((b) => (b.getAttribute('aria-label') ?? '').trim()));
    assert.ok(named.length >= 7 && named.every((n) => n !== ''), named.join('|'));
    assert.equal(await page.evaluate(() => document.querySelector('.marxy-toolbar').getAttribute('role')), 'toolbar');
    const stops = await page.evaluate(() => [...document.querySelectorAll('.marxy-toolbar button')].filter((b) => b.tabIndex === 0).length);
    assert.equal(stops, 1, 'one tab stop');
    const active = () => page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.tagName);
    // From the top of the page: the first Tab lands in the toolbar, and the next leaves it.
    await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); });
    await page.keyboard.press('Tab');
    assert.equal(await active(), 'Show or hide the sidebar', 'the first Tab reaches the toolbar');
    await page.keyboard.press('ArrowRight');
    assert.equal(await active(), 'Back');
    await page.keyboard.press('ArrowRight');
    assert.equal(await active(), 'Forward');
    await page.keyboard.press('End');
    assert.equal(await active(), 'Find in this pane');
    await page.keyboard.press('ArrowRight');
    assert.equal(await active(), 'Show or hide the sidebar', 'the row wraps');
    await page.keyboard.press('End');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement?.closest('.marxy-toolbar') === null), true, 'the next Tab leaves the toolbar');
    await page.keyboard.press('Shift+Tab');
    assert.equal(await active(), 'Find in this pane', 'and Shift+Tab comes back to the control it left');
    // Return activates: Find opens the pane's find.
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('.marxy-find-slot input, #marxy-find input, [role="search"] input') !== null);
  });
});
