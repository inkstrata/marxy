// The sidebar (W-07): Recent, Pinned and Changed since you read in the unfolded window's left column, each section
// foldable and remembered. The real app, its palette and the shipped skeleton and CSS over the memory shell, in
// WebKit (test/support/two-pane.mjs), as open-beside.test.mjs boots it: the palette is where the sidebar's rows come
// from, and `bootTwoPanes` alone has none. The toolbar here is the real one (K-07's lesson: a fit measured on a
// reduced row proves nothing about the row the reader gets).
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
const NAMES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
const files = Object.fromEntries(NAMES.map((n) => [`/r/${n}.md`, `# Note ${n}\n\n${para(n).repeat(6)}\n`]));
files['/r/a-rather-long-file-name-that-has-to-be-cut-to-fit-the-column.md'] = `# A rather long file name that has to be cut to fit the column\n\n${para('long').repeat(4)}\n`;
const entryOf = (path, over = {}) => ({ path, root: '/r', title: files[path].match(/^# (.*)$/m)[1], headings: [], mtimeMs: 1, size: files[path].length, kind: 'markdown', ...over });
const entries = Object.keys(files).map((p) => entryOf(p));

async function withPage(fn, { width = 1470, height = 900 } = {}) {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width, height } });
    await fn(page);
  } finally {
    await browser.close();
  }
}

/** Boots the real app and palette; opens `open` in turn in the focused pane. `data` is extra bytes in the memory shell. */
async function boot(page, { open, index = entries, data = {} }) {
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
  const encoded = Object.fromEntries(Object.entries({ ...Object.fromEntries(Object.entries(files)), ...data }).map(([path, text]) => [path, b64(text)]));
  await page.evaluate(
    async ({ encoded, index, open }) => {
      const bytes = {};
      for (const [path, text] of Object.entries(encoded)) bytes[path] = Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
      const { createMemoryShell } = await import('/src/shell/memory.ts');
      const { bootApplication } = await import('/src/main.ts');
      const handle = await bootApplication(createMemoryShell(bytes), { argv: [open[0]] });
      await handle.ready;
      window.__marxyHandle = handle;
      handle.palette.setIndexEntries(index);
      await handle.collection?.loaded;
      // The launch document is read before the palette exists, so its session has not heard of it; the first open is noted as any later one is.
      handle.palette.noteRead(open[0], 'open');
      for (const path of open.slice(1)) await handle.open(path);
    },
    { encoded, index, open },
  );
}

const unfold = (page) => page.evaluate(() => window.__marxyHandle.workspace().unfold());
const fold = (page) => page.evaluate(() => window.__marxyHandle.workspace().fold());
const mac = (page) => page.evaluate(() => navigator.platform.toUpperCase().includes('MAC'));
const mod = async (page) => ((await mac(page)) ? 'Meta' : 'Control');
const sidebar = (page) => page.locator('[data-marxy-workspace-region="sidebar"]');
const drawn = (page) => page.waitForSelector('.marxy-sidebar [data-marxy-sidebar-row], .marxy-sidebar [data-marxy-sidebar-section]');
/** W-07's two lists; the trees (W-08) are `allSections`. */
const sections = async (page) => (await allSections(page)).filter((s) => s.id === 'recent' || s.id === 'pinned');
const allSections = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('.marxy-sidebar [data-marxy-sidebar-section]')].map((s) => ({
      id: s.getAttribute('data-marxy-sidebar-section'),
      expanded: s.querySelector('.marxy-sidebar-head').getAttribute('aria-expanded'),
      count: s.querySelector('.marxy-sidebar-count')?.textContent ?? null,
      rows: [...s.querySelectorAll('[data-marxy-sidebar-row]')].map((r) => r.getAttribute('data-marxy-sidebar-row')),
    })),
  );
const paths = (page) => page.evaluate(() => window.__marxyHandle.panes().panes.map((p) => p.path()));
const workspaceFile = (page) =>
  page.evaluate(async () => {
    try {
      return new TextDecoder().decode(await window.__marxyHandle.shell.readFile('/data/workspace.json'));
    } catch {
      return null;
    }
  });
const column = (page) =>
  page.evaluate(() => {
    const r = document.getElementById('doc').getBoundingClientRect();
    return { x: r.x, width: r.width };
  });
/** Pins the document on screen the reader's way: the palette, its first row, Mod+. */
async function pinCurrent(page) {
  await page.evaluate(() => window.__marxyHandle.palette.open());
  await page.waitForFunction(() => document.getElementById('marxy-palette').open);
  await page.waitForSelector('#marxy-palette .marxy-palette-row');
  await page.keyboard.press(`${await mod(page)}+.`);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.getElementById('marxy-palette').open);
}
const tenOpen = NAMES.map((n) => `/r/${n}.md`);

// --- folded is today ----------------------------------------------------------------------------------------

test('folded, there is no sidebar in the page; unfolding draws it and folding takes it out again', async () => {
  await withPage(async (page) => {
    await boot(page, { open: tenOpen.slice(0, 3) });
    const count = () => page.evaluate(() => document.querySelectorAll('.marxy-sidebar, [data-marxy-sidebar-section], [data-marxy-sidebar-row]').length);
    assert.equal(await count(), 0);
    await unfold(page);
    await drawn(page);
    assert.ok((await count()) > 0);
    await fold(page);
    assert.equal(await count(), 0);
  });
});

// --- the lists ----------------------------------------------------------------------------------------------

test('with ten files opened Recent shows eight, newest first, and nothing else is drawn', async () => {
  await withPage(async (page) => {
    await boot(page, { open: tenOpen });
    await unfold(page);
    await drawn(page);
    assert.deepEqual(await sections(page), [{ id: 'recent', expanded: 'true', count: null, rows: [...tenOpen].reverse().slice(0, 8) }]);
    const row = await page.evaluate(() => {
      const r = document.querySelector('.marxy-sidebar-section [data-marxy-sidebar-row]');
      return { glyph: r.querySelector('.marxy-kind-glyph svg') !== null, name: r.querySelector('.marxy-sidebar-name').textContent, age: r.querySelector('.marxy-sidebar-age').textContent };
    });
    assert.deepEqual(row, { glyph: true, name: 'Note j', age: 'now' === row.age ? 'now' : row.age });
    assert.match(row.age, /^(now|\d+[mhdwy])$/);
  });
});

test('a pinned file is under Pinned and not repeated in Recent; a file modified after it was read is under Changed', async () => {
  await withPage(async (page) => {
    await boot(page, { open: tenOpen.slice(0, 4) });
    await pinCurrent(page); // /r/d.md, the most recent
    await page.waitForTimeout(30);
    // c was read a moment ago and has been modified since.
    await page.evaluate((e) => window.__marxyHandle.palette.setIndexEntries(e.map((x) => (x.path === '/r/c.md' ? { ...x, mtimeMs: Date.now() + 5000 } : x))), entries);
    await unfold(page);
    await drawn(page);
    assert.deepEqual(await sections(page), [
      { id: 'recent', expanded: 'true', count: null, rows: ['/r/b.md', '/r/a.md'] },
      { id: 'pinned', expanded: 'true', count: null, rows: ['/r/d.md', '/r/c.md'] },
    ]);
    const marks = await page.evaluate(() => [...document.querySelectorAll('[data-marxy-sidebar-section="pinned"] [data-marxy-sidebar-row]')].map((r) => r.getAttribute('aria-label')));
    assert.match(marks[0], /^Note d, pinned, /);
    assert.match(marks[1], /^Note c, changed since you read, /);
  });
});

test('the lists follow a document opened while the sidebar is up', async () => {
  await withPage(async (page) => {
    await boot(page, { open: ['/r/a.md'] });
    await unfold(page);
    await drawn(page);
    assert.deepEqual((await sections(page))[0].rows, ['/r/a.md']);
    await page.evaluate(() => window.__marxyHandle.open('/r/b.md'));
    await page.waitForFunction(() => document.querySelectorAll('[data-marxy-sidebar-section="recent"] [data-marxy-sidebar-row]').length === 2);
    assert.deepEqual((await sections(page))[0].rows, ['/r/b.md', '/r/a.md']);
  });
});

// --- folding a section --------------------------------------------------------------------------------------

test('a header folds its section and shows the count; folding and unfolding the window keeps it, and so does a launch after it', async () => {
  await withPage(async (page) => {
    await boot(page, { open: tenOpen.slice(0, 3) });
    await unfold(page);
    await drawn(page);
    await page.click('[data-marxy-sidebar-section="recent"] .marxy-sidebar-head');
    assert.deepEqual(await sections(page), [{ id: 'recent', expanded: 'false', count: '3', rows: [] }]);
    const file = JSON.parse(await workspaceFile(page));
    assert.deepEqual(Object.keys(file), ['version', 'panels', 'sidebar'], 'the file keeps its shape and gains the one field');
    assert.deepEqual(file.sidebar, { collapsed: ['recent'] });
    await fold(page);
    await unfold(page);
    await drawn(page);
    assert.equal((await sections(page))[0].expanded, 'false', 'folding and unfolding the window keeps it');
    const bytes = await workspaceFile(page);
    await withPage(async (second) => {
      await boot(second, { open: ['/r/a.md'], data: { '/data/workspace.json': bytes } });
      assert.equal(await second.evaluate(() => document.querySelectorAll('.marxy-sidebar').length), 0, 'a launch reads nothing and draws nothing');
      await unfold(second);
      await drawn(second);
      assert.equal((await sections(second))[0].expanded, 'false', 'a launch after it keeps it');
    });
    // Opening the section again is remembered too.
    await page.click('[data-marxy-sidebar-section="recent"] .marxy-sidebar-head');
    assert.deepEqual(JSON.parse(await workspaceFile(page)).sidebar, { collapsed: [] });
  });
});

test('Alt-click on a header folds every section and a second one opens every section', async () => {
  await withPage(async (page) => {
    await boot(page, { open: tenOpen.slice(0, 3) });
    await pinCurrent(page);
    await unfold(page);
    await drawn(page);
    const state = async () => (await sections(page)).map((s) => s.expanded);
    assert.deepEqual(await state(), ['true', 'true']);
    await page.click('[data-marxy-sidebar-section="recent"] .marxy-sidebar-head', { modifiers: ['Alt'] });
    assert.deepEqual(await state(), ['false', 'false']);
    await page.click('[data-marxy-sidebar-section="pinned"] .marxy-sidebar-head', { modifiers: ['Alt'] });
    assert.deepEqual(await state(), ['true', 'true']);
    assert.deepEqual(JSON.parse(await workspaceFile(page)).sidebar, { collapsed: [] });
  });
});

// --- the Library row ----------------------------------------------------------------------------------------

test('the real library.open command draws the Library row at the top; with it removed the row goes, and a stub command with that id brings it back', async () => {
  await withPage(async (page) => {
    await boot(page, { open: ['/r/a.md'] });
    await unfold(page);
    await drawn(page);
    const library = () => page.evaluate(() => [...document.querySelectorAll('.marxy-sidebar-library')].map((b) => b.textContent));
    assert.deepEqual(await library(), ['Library'], 'the real command (Q-03) is registered');
    assert.equal(await page.evaluate(() => document.querySelector('.marxy-sidebar-search').nextElementSibling.className), 'marxy-sidebar-library', 'at the top, under the search field');
    await page.evaluate(() => {
      const handle = window.__marxyHandle;
      window.__realCommands = handle.commands.bind(handle);
      handle.commands = () => window.__realCommands().filter((c) => c.id !== 'library.open');
    });
    await fold(page);
    await unfold(page);
    await drawn(page);
    assert.deepEqual(await library(), [], 'no library.open command, no Library row');
    await page.evaluate(() => {
      const handle = window.__marxyHandle;
      handle.commands = () => [...window.__realCommands().filter((c) => c.id !== 'library.open'), { id: 'library.open', title: 'Open the library', group: 'view', when: () => true, async run() { window.__ran = (window.__ran ?? 0) + 1; } }];
    });
    await fold(page);
    await unfold(page);
    await drawn(page);
    assert.deepEqual(await library(), ['Library']);
    await page.click('.marxy-sidebar-library');
    assert.equal(await page.evaluate(() => window.__ran), 1);
    await page.evaluate(() => { window.__marxyHandle.commands = () => window.__realCommands().filter((c) => c.id !== 'library.open'); });
    await fold(page);
    await unfold(page);
    await drawn(page);
    assert.deepEqual(await library(), []);
  });
});

// --- opening a row ------------------------------------------------------------------------------------------

test('Return on a focused row opens it in the focused pane; Command-click opens it in the other pane, made if need be', async () => {
  await withPage(async (page) => {
    await boot(page, { open: ['/r/a.md', '/r/b.md', '/r/c.md'] });
    await unfold(page);
    await drawn(page);
    await page.focus('[data-marxy-sidebar-row="/r/a.md"]');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.__marxyHandle.panes().focused.path() === '/r/a.md');
    assert.deepEqual(await paths(page), ['/r/a.md'], 'one pane, now showing a');
    await page.click('[data-marxy-sidebar-row="/r/b.md"]', { modifiers: [await mod(page)] });
    await page.waitForFunction(() => window.__marxyHandle.panes().panes.length === 2);
    assert.deepEqual(await paths(page), ['/r/a.md', '/r/b.md'], 'beside, in a pane made for it');
    await page.focus('[data-marxy-sidebar-row="/r/c.md"]');
    await page.keyboard.press(`${await mod(page)}+Enter`);
    await page.waitForFunction(() => window.__marxyHandle.panes().panes.some((p) => p.path() === '/r/c.md'));
    assert.equal((await paths(page)).length, 2);
  });
});

// --- reaching it --------------------------------------------------------------------------------------------

test('every row and header has an accessible name; Tab reaches the sidebar once, arrows move within it', async () => {
  await withPage(async (page) => {
    await boot(page, { open: tenOpen.slice(0, 4) });
    await pinCurrent(page);
    await unfold(page);
    await drawn(page);
    const named = await page.evaluate(() => [...document.querySelectorAll('.marxy-sidebar button')].map((b) => (b.getAttribute('aria-label') ?? '').trim()));
    assert.ok(named.length >= 5 && named.every((n) => n !== ''), named.join('|'));
    assert.match(named[0], /^Search documents/, 'the search field (U-06) leads');
    assert.equal(named[1], 'Library', 'the Library row (Q-03) follows');
    assert.match(named[2], /^Recent, 3 documents$/);
    assert.equal(await page.evaluate(() => document.querySelectorAll('.marxy-sidebar button[tabindex="0"]').length), 1, 'one tab stop');
    const active = () => page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.tagName);
    // The toolbar follows the sidebar in the page: Shift+Tab from its first control reaches the sidebar's one stop.
    await page.locator('[data-marxy-toolbar-item="sidebar"] button').focus();
    await page.keyboard.press('Shift+Tab');
    assert.equal(await active(), named[0], 'Shift+Tab from the toolbar reaches the sidebar');
    await page.keyboard.press('ArrowDown');
    assert.equal(await active(), named[1]);
    await page.keyboard.press('End');
    assert.equal(await active(), named.at(-1));
    await page.keyboard.press('ArrowDown');
    assert.equal(await active(), named.at(-1), 'the list does not wrap');
    await page.keyboard.press('Home');
    assert.equal(await active(), named[0]);
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement?.closest('.marxy-sidebar') === null), true, 'the next Tab leaves the sidebar');
    // Return on a header folds it, and focus stays on it.
    await page.focus('.marxy-sidebar-head');
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('marxy-sidebar-head')), true);
    assert.equal((await sections(page))[0].expanded, 'false');
  });
});

test('the look (U-06): the search field opens the palette; rows are 28 px with the open one marked; heads carry a chevron; the foot counts the index', async () => {
  await withPage(async (page) => {
    await boot(page, { open: tenOpen.slice(0, 3) });
    await unfold(page);
    await drawn(page);
    const look = await page.evaluate(() => {
      const px = (sel) => [...document.querySelectorAll(sel)].map((n) => Math.round(n.getBoundingClientRect().height));
      return {
        rows: px('.marxy-sidebar-row'),
        heads: px('.marxy-sidebar-head'),
        chevrons: document.querySelectorAll('.marxy-sidebar-head .marxy-sidebar-chevron').length,
        current: [...document.querySelectorAll('.marxy-sidebar-row[aria-current="true"]')].map((n) => n.getAttribute('data-marxy-sidebar-row')),
        foot: document.querySelector('[data-marxy-sidebar-foot]')?.textContent ?? null,
        chip: document.querySelector('.marxy-sidebar-chip')?.textContent ?? null,
      };
    });
    assert.ok(look.rows.length >= 3 && look.rows.every((h) => h === 28), JSON.stringify(look));
    assert.ok(look.heads.every((h) => h >= 28) && look.chevrons === look.heads.length, JSON.stringify(look));
    assert.deepEqual(look.current, [tenOpen[2]], 'the focused pane\'s document is marked');
    assert.match(look.foot ?? '', /^\d+ documents indexed/);
    assert.match(look.chip ?? '', /K$/);
    assert.equal(await page.evaluate(() => document.querySelector('dialog[open], [data-marxy-palette][open]') !== null), false);
    await page.click('[data-marxy-sidebar-search]');
    await page.waitForFunction(() => document.querySelector('dialog[open], [data-marxy-palette]:not([hidden])') !== null);
  });
});

test('the foot says only what is true (U-06): the count is the index\'s, a refused watch never says watching, and it follows the watch state and a walk', async () => {
  await withPage(async (page) => {
    await boot(page, { open: tenOpen.slice(0, 3) });
    await unfold(page);
    await drawn(page);
    const foot = () => page.evaluate(() => document.querySelector('[data-marxy-sidebar-foot]')?.textContent ?? null);
    const indexCount = await page.evaluate(() => window.__marxyHandle.palette.feed.entries().length);
    // The foot's N is the index's own count; "watching" is claimed only while the index says a tree watch is live.
    const count = `${indexCount.toLocaleString('en-US')} ${indexCount === 1 ? 'document' : 'documents'} indexed`;
    const state = await page.evaluate(() => window.__marxyHandle.index.watchState());
    assert.equal(await foot(), state === 'live' ? `${count} \u00b7 watching` : count);
    // The watch is refused (home-sized, over the limit): never "watching", and the notice's own words.
    await page.evaluate(() => window.__marxyHandle.index.setTreeWatch('/r', 'refused'));
    await page.waitForFunction(() => /not watching, rescanned when you open the palette$/.test(document.querySelector('[data-marxy-sidebar-foot]')?.textContent ?? ''));
    assert.equal(await foot(), `${count} \u00b7 not watching, rescanned when you open the palette`);
    assert.doesNotMatch(((await foot()) ?? '').replace('not watching', ''), /watching/);
    // The refusal is lifted: the foot follows the state back.
    await page.evaluate(() => window.__marxyHandle.index.setTreeWatch('/r', undefined));
    {
      // The test's own '/r' replaced whatever tree watch the app held there, so the state back may be none; the foot must match it.
      const now = await page.evaluate(() => window.__marxyHandle.index.watchState());
      await page.waitForFunction((want) => document.querySelector('[data-marxy-sidebar-foot]')?.textContent === want, now === 'live' ? `${count} \u00b7 watching` : count);
    }
    // A walk under way: "Indexing…", no count; the count returns when it is done. The index's own answer is stood in for.
    await page.evaluate(() => {
      const index = window.__marxyHandle.index;
      window.__realIndexing = index.indexing;
      index.indexing = () => true;
      index.setTreeWatch('/r', 'refused');
    });
    await page.waitForFunction(() => document.querySelector('[data-marxy-sidebar-foot]')?.textContent === 'Indexing\u2026');
    await page.evaluate(() => {
      const index = window.__marxyHandle.index;
      index.indexing = window.__realIndexing;
      index.setTreeWatch('/r', undefined);
    });
    {
      // The test's own '/r' replaced whatever tree watch the app held there, so the state back may be none; the foot must match it.
      const now = await page.evaluate(() => window.__marxyHandle.index.watchState());
      await page.waitForFunction((want) => document.querySelector('[data-marxy-sidebar-foot]')?.textContent === want, now === 'live' ? `${count} \u00b7 watching` : count);
    }
  });
});

test('the foot counts what the palette lists (U-06.1): a folder held twice is one document, not two', async () => {
  await withPage(async (page) => {
    await boot(page, { open: tenOpen.slice(0, 3) });
    await unfold(page);
    await drawn(page);
    // The same files held under a second root (a nested or doubly-opened folder): the palette lists each path once.
    // The index service holds all of `entries` (the harness walked /r); the palette is given five of them, each held under two roots.
    const five = entries.slice(0, 5);
    await page.evaluate((five) => window.__marxyHandle.palette.setIndexEntries([...five, ...five.map((e) => ({ ...e, root: '/r2' }))]), five);
    const rows = await page.evaluate(() => window.__marxyHandle.palette.feed.entries().length);
    assert.equal(rows, 5, 'the palette lists one row per path');
    await page.waitForFunction((want) => (document.querySelector('[data-marxy-sidebar-foot]')?.textContent ?? '').startsWith(`${want} documents indexed`), rows);
  });
});

// --- the door and the page ---------------------------------------------------------------------------------

test('view.toggle-sidebar is available, the toolbar draws its toggle, and it docks and undocks the sidebar', async () => {
  await withPage(async (page) => {
    await boot(page, { open: ['/r/a.md'] });
    const command = await page.evaluate(() => {
      const c = window.__marxyHandle.commands().find((x) => x.id === 'view.toggle-sidebar');
      return { key: c.key, when: c.when({}) };
    });
    assert.deepEqual(command, { key: 'Ctrl+Mod+S', when: true });
    await unfold(page);
    const toggle = page.locator('[data-marxy-toolbar-item="sidebar"] button');
    assert.equal(await toggle.getAttribute('aria-pressed'), 'true');
    await toggle.click();
    await page.waitForFunction(() => document.querySelector('[data-marxy-workspace-region="sidebar"]').hidden);
    assert.equal(await toggle.getAttribute('aria-pressed'), 'false');
    if (await mac(page)) {
      await page.keyboard.press('Control+Meta+KeyS');
      await page.waitForFunction(() => !document.querySelector('[data-marxy-workspace-region="sidebar"]').hidden);
    }
  });
});

test('the reading column does not move: folded and unfolded are the same, and so is the instant the rows arrive', async () => {
  for (const width of [1280, 1700]) {
    await withPage(async (page) => {
      await boot(page, { open: tenOpen.slice(0, 6) });
      const folded = await column(page);
      await page.evaluate(() => window.__marxyHandle.workspace().unfold());
      const first = await column(page); // the region may still be empty here
      await drawn(page);
      await page.waitForTimeout(100);
      assert.deepEqual(await column(page), folded, `at ${width}: after the rows are drawn`);
      assert.deepEqual(first, folded, `at ${width}: before they are`);
      await page.click('[data-marxy-sidebar-section="recent"] .marxy-sidebar-head');
      assert.deepEqual(await column(page), folded, `at ${width}: folding a section`);
      const spill = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(spill <= 0, `the page scrolls sideways by ${spill}`);
    }, { width });
  }
});

test('the sidebar draws nothing and does not throw before the palette exists, and fills when it appears', async () => {
  await withPage(async (page) => {
    await boot(page, { open: ['/r/a.md', '/r/b.md'] });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.evaluate(async () => {
      const mod = await import('/src/commands/app-handle.ts');
      window.__palette = mod.palette();
      mod.setPalette(null);
    });
    await unfold(page);
    await page.waitForSelector('.marxy-sidebar');
    await page.waitForTimeout(450);
    assert.deepEqual(await sections(page), []);
    await page.evaluate(async () => (await import('/src/commands/app-handle.ts')).setPalette(window.__palette));
    await drawn(page);
    assert.deepEqual((await sections(page))[0].rows, ['/r/b.md', '/r/a.md']);
    assert.deepEqual(errors, []);
  });
});

// --- the fit -----------------------------------------------------------------------------------------------

const rowFit = (page) =>
  page.evaluate(() => {
    const region = document.querySelector('[data-marxy-workspace-region="sidebar"]');
    const box = region.getBoundingClientRect();
    const bad = [];
    for (const el of region.querySelectorAll('.marxy-sidebar button, .marxy-sidebar-age, .marxy-kind-glyph')) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && (r.left < box.left - 0.5 || r.right > box.right + 0.5)) bad.push(el.className || el.tagName);
    }
    const name = region.querySelector('.marxy-sidebar-name');
    return { bad, scroll: region.scrollWidth - region.clientWidth, width: Math.round(box.width), nameCut: name.scrollWidth > name.clientWidth };
  });
const toolbarFit = (page) =>
  page.evaluate(() => {
    const region = document.querySelector('[data-marxy-workspace-region="toolbar"]').getBoundingClientRect();
    const bar = document.querySelector('.marxy-toolbar');
    const clipped = [...bar.querySelectorAll('button')]
      .filter((b) => !b.closest('[hidden]'))
      .filter((b) => { const r = b.getBoundingClientRect(); return r.left < region.left - 0.5 || r.right > region.right + 0.5; })
      .map((b) => b.getAttribute('aria-label'));
    return { clipped, overflow: bar.scrollWidth - bar.clientWidth };
  });

test('at chrome_size 26 the rows fit the 252 px column, a long name is cut to fit, and the age stays in sight', async () => {
  await withPage(async (page) => {
    await page.addInitScript(() => {});
    await boot(page, { open: [...tenOpen.slice(0, 3), '/r/a-rather-long-file-name-that-has-to-be-cut-to-fit-the-column.md'] });
    await page.evaluate(() => document.documentElement.style.setProperty('--marxy-size-chrome', '26px'));
    await unfold(page);
    await drawn(page);
    const fit = await rowFit(page);
    assert.deepEqual(fit.bad, [], JSON.stringify(fit));
    assert.ok(fit.scroll <= 0, JSON.stringify(fit));
    assert.equal(fit.width, 252);
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('.marxy-sidebar-name')].some((n) => n.scrollWidth > n.clientWidth)), true, 'the long name is cut');
  });
});

test('the real toolbar still fits with the sidebar toggle in it: at 929 px (the toggle folds into More, last) and at chrome_size 26 in a wide window', async () => {
  await withPage(async (page) => {
    await boot(page, { open: ['/r/a.md'] });
    await unfold(page);
    await drawn(page);
    await page.waitForTimeout(150);
    const fit = await toolbarFit(page);
    assert.deepEqual(fit.clipped, [], JSON.stringify(fit));
    assert.ok(fit.overflow <= 0, JSON.stringify(fit));
    // Wherever it is, the toggle is reachable: in the row, or in More, and Ctrl+Cmd+S still works.
    const reachable = await page.evaluate(() => {
      const item = document.querySelector('[data-marxy-toolbar-item="sidebar"]');
      return item.hidden || item.querySelector('button') !== null;
    });
    assert.equal(reachable, true);
  }, { width: 929 });
  await withPage(async (page) => {
    await boot(page, { open: ['/r/a.md'] });
    await page.evaluate(() => document.documentElement.style.setProperty('--marxy-size-chrome', '26px'));
    await unfold(page);
    await drawn(page);
    await page.waitForTimeout(150);
    const fit = await toolbarFit(page);
    assert.deepEqual(fit.clipped, [], JSON.stringify(fit));
    assert.ok(fit.overflow <= 0, JSON.stringify(fit));
  }, { width: 1440 });
});

// --- ages (F-49) --------------------------------------------------------------------------------------------

test('a row shows its age from a known time, and no age at all when the time is missing', async () => {
  await withPage(async (page) => {
    const index = [
      entryOf('/r/a.md', { mtimeMs: Date.now() - 3 * 3_600_000 }),
      entryOf('/r/c.md', { mtimeMs: 0 }),
    ];
    await boot(page, { open: ['/r/a.md', '/r/c.md'], index });
    await unfold(page);
    await drawn(page);
    const ages = await page.evaluate(() =>
      Object.fromEntries([...document.querySelectorAll('.marxy-sidebar [data-marxy-sidebar-row]')].map((r) => [
        r.getAttribute('data-marxy-sidebar-row'),
        { text: r.querySelector('.marxy-sidebar-age')?.textContent ?? null, label: r.getAttribute('aria-label') },
      ])));
    assert.equal(ages['/r/a.md'].text, '3h');
    assert.equal(ages['/r/c.md'].text, null, 'a zero time shows no age');
    assert.ok(!/ago/.test(ages['/r/c.md'].label), 'and none is spoken');
  });
});

// --- Repositories and Folders (W-08): lazy trees over the index's roots ---------------------------------------

const GIT = (name) => `gitdir: /gitrepo/.git/worktrees/${name}\n`;
const treeData = {
  // Two worktrees of one repository (their `.git` is a file naming the shared gitdir), and a plain folder.
  '/wt-a/.git': GIT('a'), '/wt-b/.git': GIT('b'),
  '/wt-a/README.md': '# Readme a\n', '/wt-b/README.md': '# Readme b\n',
  '/wt-a/docs/guide.md': '# Guide a\n', '/wt-b/docs/guide.md': '# Guide b\n',
  '/wt-a/docs/deep/inner.md': '# Inner a\n', '/wt-a/src/main.rs': 'fn main() {}\n',
  '/plain/notes.md': '# Plain notes\n', '/plain/sub/more.md': '# More\n',
};
const treeEntry = (root, rel, title, over = {}) => ({ path: `${root}/${rel}`, root, title, headings: [], mtimeMs: 1, size: 10, kind: 'markdown', ...over });

/** The harness app with the two worktrees and the plain folder held by the index; the worktrees are declared (watched), as collection.toml would. */
async function bootTrees(page, { feedOver = {} } = {}) {
  await boot(page, { open: ['/r/a.md', '/r/b.md', '/r/c.md'], data: treeData });
  await page.evaluate(
    async ({ extra }) => {
      const h = window.__marxyHandle;
      await h.index.ensureRoot('/wt-a', { watch: true });
      await h.index.ensureRoot('/wt-b', { watch: true });
      await h.index.ensureRoot('/plain');
      await h.index.settled();
      h.palette.setIndexEntries(extra);
    },
    {
      extra: [
        ...entries.map((e) => (e.path === '/r/c.md' ? { ...e, mtimeMs: Date.now() + 5000 } : e)),
        treeEntry('/wt-a', 'README.md', 'Readme a', feedOver['/wt-a/README.md']),
        treeEntry('/wt-b', 'README.md', 'Readme b', feedOver['/wt-b/README.md']),
        treeEntry('/wt-a', 'docs/guide.md', 'Guide a', feedOver['/wt-a/docs/guide.md']),
        treeEntry('/wt-b', 'docs/guide.md', 'Guide b', feedOver['/wt-b/docs/guide.md']),
        treeEntry('/plain', 'notes.md', 'Plain notes'),
      ],
    },
  );
  await unfold(page);
  await page.waitForSelector('[data-marxy-sidebar-tree="repos"]');
}
const readDirCalls = (page, from = 0) =>
  page.evaluate((from) => window.__marxyHandle.shell.calls.slice(from).filter((c) => c.method === 'readDir').map((c) => c.args[0]), from);
const callCount = (page) => page.evaluate(() => window.__marxyHandle.shell.calls.length);
const treeRows = (page, tree) =>
  page.evaluate((tree) => [...document.querySelectorAll(`[data-marxy-sidebar-tree="${tree}"] [role="treeitem"]`)].map((b) => [b.getAttribute('data-marxy-sidebar-row'), Number(b.getAttribute('aria-level')), b.getAttribute('aria-expanded')]), tree);
const label = (page, path) => page.evaluate((path) => document.querySelector(`[role="treeitem"][data-marxy-sidebar-row="${path}"]`)?.getAttribute('aria-label') ?? null, path);

test('two worktrees of one repository and a plain folder: one Repositories row with 2 checkouts, and Folders for the rest', async () => {
  await withPage(async (page) => {
    await bootTrees(page);
    const all = await allSections(page);
    assert.deepEqual(all.map((s) => s.id), ['recent', 'pinned', 'repos', 'folders'], 'Repositories and Folders follow the lists; a section with no rows is not drawn');
    assert.deepEqual(all.find((s) => s.id === 'repos').rows, ['/wt-a'], 'one row, the first checkout held');
    assert.deepEqual(all.find((s) => s.id === 'folders').rows.sort(), ['/plain', '/r']);
    assert.equal(await label(page, '/wt-a'), 'wt-a, repository, 2 checkouts');
    const quiet = await page.evaluate(() => document.querySelector('[role="treeitem"][data-marxy-sidebar-row="/wt-a"]').textContent);
    assert.match(quiet, /2 checkouts/);
    assert.equal(await label(page, '/plain'), 'plain, folder');
    assert.equal(await page.evaluate(() => document.querySelector('[data-marxy-sidebar-tree="repos"] [role="treeitem"] .marxy-toolbar-glyph svg') !== null), true, 'the branch glyph');
    assert.equal(await page.evaluate(() => /main|master/.test(document.querySelector('[data-marxy-sidebar-tree="repos"]').textContent)), false, 'the glyph says repository, not a branch name');
  });
});

test('opening a folder reads it and nothing deeper; closing it and opening it again lists the disk afresh', async () => {
  await withPage(async (page) => {
    await bootTrees(page);
    let mark = await callCount(page);
    await page.click('[role="treeitem"][data-marxy-sidebar-row="/wt-a"]');
    await page.waitForSelector('[role="treeitem"][data-marxy-sidebar-row="/wt-a/README.md"]');
    assert.deepEqual(await readDirCalls(page, mark), ['/wt-a'], 'the folder, and not docs/ or src/ below it');
    // Folders first, then files by name; the shell lists no .git.
    assert.deepEqual((await treeRows(page, 'repos')).map((r) => r.slice(0, 2)), [['/wt-a', 1], ['/wt-a/docs', 2], ['/wt-a/src', 2], ['/wt-a/README.md', 2]]);
    mark = await callCount(page);
    await page.click('[role="treeitem"][data-marxy-sidebar-row="/wt-a/docs"]');
    await page.waitForSelector('[role="treeitem"][data-marxy-sidebar-row="/wt-a/docs/guide.md"]');
    assert.deepEqual(await readDirCalls(page, mark), ['/wt-a/docs'], 'one level, not docs/deep');
    assert.deepEqual((await treeRows(page, 'repos')).map((r) => r.slice(0, 2)).slice(1, 5), [['/wt-a/docs', 2], ['/wt-a/docs/deep', 3], ['/wt-a/docs/guide.md', 3], ['/wt-a/src', 2]]);
    // Close the top: everything under it goes, and reopening reads the top again (and only the top).
    await page.click('[role="treeitem"][data-marxy-sidebar-row="/wt-a"]');
    assert.deepEqual(await treeRows(page, 'repos'), [['/wt-a', 1, 'false']]);
    mark = await callCount(page);
    await page.click('[role="treeitem"][data-marxy-sidebar-row="/wt-a"]');
    await page.waitForSelector('[role="treeitem"][data-marxy-sidebar-row="/wt-a/README.md"]');
    assert.deepEqual(await readDirCalls(page, mark), ['/wt-a']);
    assert.equal((await treeRows(page, 'repos')).some(([p]) => p === '/wt-a/docs/guide.md'), false, 'what was open under it starts closed');
  });
});

test('a file written into an open folder appears without a click, and one that goes disappears', async () => {
  await withPage(async (page) => {
    await bootTrees(page);
    await page.click('[role="treeitem"][data-marxy-sidebar-row="/plain"]');
    await page.waitForSelector('[role="treeitem"][data-marxy-sidebar-row="/plain/notes.md"]');
    await page.evaluate(async () => {
      const h = window.__marxyHandle;
      await h.shell.writeFileAtomic('/plain/fresh.md', new TextEncoder().encode('# Fresh\n'));
      h.index.applyEvents([{ kind: 'created', path: '/plain/fresh.md' }]);
    });
    await page.waitForSelector('[role="treeitem"][data-marxy-sidebar-row="/plain/fresh.md"]');
    assert.deepEqual((await treeRows(page, 'folders')).map(([p]) => p).filter((p) => p.startsWith('/plain')), ['/plain', '/plain/sub', '/plain/fresh.md', '/plain/notes.md']);
    await page.evaluate(() => {
      const h = window.__marxyHandle;
      h.shell.remove('/plain/fresh.md');
      h.index.applyEvents([{ kind: 'removed', path: '/plain/fresh.md' }]);
    });
    await page.waitForFunction(() => !document.querySelector('[role="treeitem"][data-marxy-sidebar-row="/plain/fresh.md"]'));
  });
});

test('a modified file costs the open folder no read', async () => {
  await withPage(async (page) => {
    await bootTrees(page);
    await page.click('[role="treeitem"][data-marxy-sidebar-row="/plain"]');
    await page.waitForSelector('[role="treeitem"][data-marxy-sidebar-row="/plain/notes.md"]');
    const mark = await callCount(page);
    await page.evaluate(async () => {
      const h = window.__marxyHandle;
      await h.shell.writeFileAtomic('/plain/notes.md', new TextEncoder().encode('# Plain notes, edited\n'));
      h.index.applyEvents([{ kind: 'modified', path: '/plain/notes.md' }]);
      await h.index.settled();
    });
    assert.deepEqual(await readDirCalls(page, mark), []);
  });
});

test('a file changed since it was read carries the mark, named in its accessible name; the repository counts changed paths once', async () => {
  await withPage(async (page) => {
    // README.md changed in both worktrees (one path), docs/guide.md in one: two files changed in the repository.
    const future = { mtimeMs: Date.now() + 9000 };
    await bootTrees(page, { feedOver: { '/wt-a/README.md': future, '/wt-b/README.md': future, '/wt-b/docs/guide.md': future } });
    assert.equal(await label(page, '/wt-a'), 'wt-a, repository, 2 checkouts, 2 changed since you read');
    assert.equal(await page.evaluate(() => document.querySelector('[role="treeitem"][data-marxy-sidebar-row="/wt-a"] .marxy-sidebar-badge').textContent), '2');
    // /r is the current repository (watched): c.md was read and has been modified since.
    await page.click('[role="treeitem"][data-marxy-sidebar-row="/r"]');
    await page.waitForSelector('[role="treeitem"][data-marxy-sidebar-row="/r/c.md"]');
    assert.equal(await label(page, '/r/c.md'), 'c.md, changed since you read');
    assert.equal(await label(page, '/r/d.md'), 'd.md');
    const marks = await page.evaluate(() => [...document.querySelectorAll('[data-marxy-sidebar-tree="folders"] .marxy-sidebar-mark')].map((m) => [m.parentElement.getAttribute('data-marxy-sidebar-row'), m.textContent.length > 0]));
    assert.deepEqual(marks, [['/r/c.md', true]], 'a shape, not only a colour, and only on the changed file');
  });
});

test('the tree has the tree roles, and the arrows act as the mock says', async () => {
  await withPage(async (page) => {
    await bootTrees(page);
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('[role="tree"]')].map((t) => [t.getAttribute('data-marxy-sidebar-tree'), t.getAttribute('aria-label')])), [['repos', 'Repositories'], ['folders', 'Folders']]);
    assert.deepEqual(await treeRows(page, 'repos'), [['/wt-a', 1, 'false']]);
    await page.focus('[role="treeitem"][data-marxy-sidebar-row="/wt-a"]');
    const focused = () => page.evaluate(() => document.activeElement.getAttribute('data-marxy-sidebar-row'));
    await page.keyboard.press('ArrowRight');
    await page.waitForSelector('[role="treeitem"][data-marxy-sidebar-row="/wt-a/docs"]');
    assert.equal(await focused(), '/wt-a', '→ opens a closed folder and keeps the focus');
    assert.deepEqual(await treeRows(page, 'repos'), [['/wt-a', 1, 'true'], ['/wt-a/docs', 2, 'false'], ['/wt-a/src', 2, 'false'], ['/wt-a/README.md', 2, null]]);
    await page.keyboard.press('ArrowRight');
    assert.equal(await focused(), '/wt-a/docs', '→ on an open folder steps into it');
    await page.keyboard.press('ArrowRight');
    await page.waitForSelector('[role="treeitem"][data-marxy-sidebar-row="/wt-a/docs/guide.md"]');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    assert.equal(await focused(), '/wt-a/docs/guide.md');
    await page.keyboard.press('ArrowRight');
    assert.equal(await focused(), '/wt-a/docs/guide.md', '→ on a file does nothing');
    await page.keyboard.press('ArrowLeft');
    assert.equal(await focused(), '/wt-a/docs', '← on a file or closed folder steps out to the parent');
    await page.keyboard.press('ArrowLeft');
    assert.equal((await treeRows(page, 'repos')).find(([p]) => p === '/wt-a/docs')[2], 'false', '← on an open folder closes it');
    assert.equal(await focused(), '/wt-a/docs');
    // One tab stop: exactly one button in the sidebar is in the tab order.
    assert.equal(await page.evaluate(() => document.querySelectorAll('.marxy-sidebar button[tabindex="0"]').length), 1);
    await page.keyboard.press('Enter');
    await page.waitForSelector('[role="treeitem"][data-marxy-sidebar-row="/wt-a/docs/guide.md"]');
  });
});

test('a file row opens in the focused pane, and Command-click opens it beside', async () => {
  await withPage(async (page) => {
    await bootTrees(page);
    await page.click('[role="treeitem"][data-marxy-sidebar-row="/plain"]');
    await page.waitForSelector('[role="treeitem"][data-marxy-sidebar-row="/plain/notes.md"]');
    await page.click('[role="treeitem"][data-marxy-sidebar-row="/plain/notes.md"]');
    await page.waitForFunction(() => window.__marxyHandle.panes().focused.path() === '/plain/notes.md');
    assert.equal((await paths(page)).length, 1);
    await page.click('[role="treeitem"][data-marxy-sidebar-row="/plain/notes.md"]', { modifiers: [(await mac(page)) ? 'Meta' : 'Control'] });
    await page.waitForFunction(() => window.__marxyHandle.panes().panes.length === 2);
  });
});

test('a folded Repositories survives fold, unfold and a launch; an unknown id in workspace.json is dropped', async () => {
  await withPage(async (page) => {
    await bootTrees(page);
    await page.click('[data-marxy-sidebar-section="repos"] .marxy-sidebar-head');
    const repos = async (p) => (await allSections(p)).find((s) => s.id === 'repos');
    assert.deepEqual(await repos(page), { id: 'repos', expanded: 'false', count: '1', rows: [] });
    assert.deepEqual(JSON.parse(await workspaceFile(page)).sidebar, { collapsed: ['repos'] });
    await fold(page);
    await unfold(page);
    await page.waitForSelector('[data-marxy-sidebar-section="repos"]');
    assert.equal((await repos(page)).expanded, 'false');
    const bytes = JSON.stringify({ version: 1, panels: { sidebar: true }, sidebar: { collapsed: ['repos', 'gone'] } });
    await withPage(async (second) => {
      await bootTrees(second);
      await second.evaluate(async (bytes) => {
        const h = window.__marxyHandle;
        await h.shell.writeFileAtomic('/data/workspace.json', new TextEncoder().encode(bytes));
      }, bytes);
    });
    await withPage(async (second) => {
      await boot(second, { open: ['/r/a.md'], data: { ...treeData, '/data/workspace.json': bytes } });
      await second.evaluate(async () => {
        const h = window.__marxyHandle;
        await h.index.ensureRoot('/wt-a', { watch: true });
        await h.index.settled();
      });
      await unfold(second);
      await second.waitForSelector('[data-marxy-sidebar-section="repos"]');
      assert.equal((await repos(second)).expanded, 'false', 'a launch after it keeps it');
      await second.click('[data-marxy-sidebar-section="repos"] .marxy-sidebar-head');
      assert.deepEqual(JSON.parse(await workspaceFile(second)).sidebar, { collapsed: [] }, 'the unknown id was never kept');
    });
  });
});

test('the trees are honest about their size: a huge folder is one listing capped at 500 rows, said aloud, and the reading column does not move', async () => {
  await withPage(async (page) => {
    const many = Object.fromEntries(Array.from({ length: 620 }, (_, i) => [`/big/f${String(i).padStart(4, '0')}.txt`, 'x']));
    await boot(page, { open: ['/r/a.md'], data: many });
    await page.evaluate(async () => {
      const h = window.__marxyHandle;
      await h.index.ensureRoot('/big');
      await h.index.settled();
    });
    const before = await column(page);
    await unfold(page);
    await page.waitForSelector('[data-marxy-sidebar-tree="folders"]');
    await page.click('[role="treeitem"][data-marxy-sidebar-row="/big"]');
    await page.waitForSelector('.marxy-sidebar-note');
    assert.equal(await page.evaluate(() => document.querySelectorAll('[data-marxy-sidebar-tree="folders"] [role="treeitem"][aria-level="2"]').length), 500);
    assert.equal(await page.evaluate(() => document.querySelector('.marxy-sidebar-note').textContent), '120 more not shown');
    const after = await column(page);
    assert.deepEqual(after, before);
  });
});

test('a walk that ends lists the open folders again: what the disk gained without a watch patch appears (a refused watch has no other way)', async () => {
  await withPage(async (page) => {
    await bootTrees(page);
    await page.click('[role="treeitem"][data-marxy-sidebar-row="/plain"]');
    await page.waitForSelector('[role="treeitem"][data-marxy-sidebar-row="/plain/notes.md"]');
    // The disk changes and no index patch says so.
    await page.evaluate(async () => {
      await window.__marxyHandle.shell.writeFileAtomic('/plain/late.md', new TextEncoder().encode('# Late\n'));
      // A walk starts: the index's own answer is stood in for, and a status change announces it.
      const index = window.__marxyHandle.index;
      window.__realIndexing = index.indexing;
      index.indexing = () => true;
      index.setTreeWatch('/r', 'refused');
    });
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => !!document.querySelector('[role="treeitem"][data-marxy-sidebar-row="/plain/late.md"]')), false, 'nothing has told the tree yet');
    const mark = await callCount(page);
    // The walk ends.
    await page.evaluate(() => {
      const index = window.__marxyHandle.index;
      index.indexing = window.__realIndexing;
      index.setTreeWatch('/r', undefined);
    });
    await page.waitForSelector('[role="treeitem"][data-marxy-sidebar-row="/plain/late.md"]');
    assert.deepEqual(await readDirCalls(page, mark), ['/plain'], 'the open folder only');
  });
});

test('a root that is not watched shows no changed dot and no changed count, whatever its files\' times say', async () => {
  await withPage(async (page) => {
    const solo = { '/solo/.git': 'gitdir: /otherrepo/.git/worktrees/s\n', '/solo/a.md': '# Solo a\n' };
    await boot(page, { open: ['/r/a.md'], data: { ...treeData, ...solo } });
    await page.evaluate(async () => {
      const h = window.__marxyHandle;
      await h.index.ensureRoot('/plain'); // not declared watched
      await h.index.ensureRoot('/solo'); // a repository, not declared watched
      await h.index.settled();
      const future = Date.now() + 9000;
      h.palette.setIndexEntries([
        { path: '/plain/notes.md', root: '/plain', title: 'Plain notes', headings: [], mtimeMs: future, size: 10, kind: 'markdown' },
        { path: '/solo/a.md', root: '/solo', title: 'Solo a', headings: [], mtimeMs: future, size: 10, kind: 'markdown' },
      ]);
    });
    await unfold(page);
    await page.waitForSelector('[data-marxy-sidebar-tree="repos"]');
    const watched = await page.evaluate(() => ['/plain', '/solo'].map((r) => window.__marxyHandle.index.isWatched(r)));
    assert.deepEqual(watched, [false, false], 'the premise: neither root is watched');
    assert.equal(await label(page, '/solo'), 'solo, repository');
    await page.click('[role="treeitem"][data-marxy-sidebar-row="/plain"]');
    await page.waitForSelector('[role="treeitem"][data-marxy-sidebar-row="/plain/notes.md"]');
    await page.click('[role="treeitem"][data-marxy-sidebar-row="/solo"]');
    await page.waitForSelector('[role="treeitem"][data-marxy-sidebar-row="/solo/a.md"]');
    assert.equal(await label(page, '/plain/notes.md'), 'notes.md');
    assert.equal(await label(page, '/solo/a.md'), 'a.md');
    assert.equal(await page.evaluate(() => document.querySelectorAll('.marxy-sidebar-mark, .marxy-sidebar-badge').length), 0, 'no dot, no count');
  });
});

test('a folder that vanishes while open and comes back is listed again, not stuck at "Could not be read"', async () => {
  await withPage(async (page) => {
    await bootTrees(page);
    await page.click('[role="treeitem"][data-marxy-sidebar-row="/plain"]');
    await page.click('[role="treeitem"][data-marxy-sidebar-row="/plain/sub"]');
    await page.waitForSelector('[role="treeitem"][data-marxy-sidebar-row="/plain/sub/more.md"]');
    // The folder goes; the tree learns of it from the parent being listed again (a walk ended).
    await page.evaluate(() => {
      const h = window.__marxyHandle;
      h.shell.remove('/plain/sub/more.md');
      // The memory shell lists a missing folder as empty; a real disk refuses it.
      const real = h.shell.readDir;
      window.__realReadDir = real;
      h.shell.readDir = async (dir) => {
        if (dir === '/plain/sub' && window.__gone !== false) throw new Error('ENOENT');
        return real.call(h.shell, dir);
      };
      window.__gone = true;
      h.index.applyEvents([{ kind: 'removed', path: '/plain/sub/more.md' }]);
    });
    await page.waitForFunction(() => /Could not be read/.test(document.querySelector('[data-marxy-sidebar-tree="folders"]').textContent));
    await page.evaluate(() => {
      const index = window.__marxyHandle.index;
      window.__realIndexing = index.indexing;
      index.indexing = () => true;
      index.setTreeWatch('/r', 'refused');
    });
    await page.evaluate(() => {
      const index = window.__marxyHandle.index;
      index.indexing = window.__realIndexing;
      index.setTreeWatch('/r', undefined);
    });
    await page.waitForFunction(() => !document.querySelector('[role="treeitem"][data-marxy-sidebar-row="/plain/sub"]'));
    // It comes back.
    await page.evaluate(async () => {
      const h = window.__marxyHandle;
      window.__gone = false;
      await h.shell.writeFileAtomic('/plain/sub/again.md', new TextEncoder().encode('# Again\n'));
      h.index.applyEvents([{ kind: 'created', path: '/plain/sub/again.md' }]);
    });
    await page.waitForSelector('[role="treeitem"][data-marxy-sidebar-row="/plain/sub"]');
    assert.equal(await page.evaluate(() => /Could not be read/.test(document.querySelector('[data-marxy-sidebar-tree="folders"]').textContent)), false);
    assert.equal(await page.evaluate(() => document.querySelector('[role="treeitem"][data-marxy-sidebar-row="/plain/sub"]').getAttribute('aria-expanded')), 'false', 'it starts closed');
  });
});

// --- Smart collections (Q-07) -------------------------------------------------------------------------------

/** Three of the files are reports: `kind:report` matches them. */
const REPORTS = ['/r/a.md', '/r/b.md', '/r/c.md'];
const reportEntries = entries.map((e) => (REPORTS.includes(e.path) ? { ...e, readerKind: 'report' } : e));
const TOML = '# my smart collections\nunknown = 1   # kept\n\n[[query]]\nname = "Reports"\nq = "kind:report"\n\n[[query]]\nname = "Pinned"\nq = "is:pinned"\n\n[[query]]\nname = "Cache notes"\nq = "cache"\n';
const smartRows = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('[data-marxy-sidebar-section="smart"] [data-marxy-sidebar-row]')].map((r) => ({
      row: r.getAttribute('data-marxy-sidebar-row'),
      name: r.querySelector('.marxy-sidebar-name').textContent,
      count: r.querySelector('.marxy-sidebar-age')?.textContent ?? null,
      label: r.getAttribute('aria-label'),
      title: r.title,
    })),
  );
/** The counts are made off the path of a redraw (SmartCounts): wait for the first one to land. */
const countsLanded = (page, name = 'Reports') =>
  page.waitForFunction((n) => document.querySelector(`[data-marxy-sidebar-row="smart:${n}"] .marxy-sidebar-age`) !== null, name);
const smartSection = (page) => page.evaluate(() => document.querySelector('[data-marxy-sidebar-section="smart"]') !== null);
const writeToml = (page, text) =>
  page.evaluate(async (t) => {
    const shell = window.__marxyHandle.shell;
    await shell.writeFileAtomic('/collection.toml', new TextEncoder().encode(t));
    shell.emit([{ kind: 'modified', path: '/collection.toml' }]);
    await window.__marxyHandle.collection.settled();
  }, text);
const libraryStatus = async (page) => {
  await page.waitForSelector('[data-marxy-library]');
  await page.waitForTimeout(300);
  return page.evaluate(() => ({ field: document.querySelector('.marxy-library-field').value, status: document.querySelector('.marxy-library-status').textContent, scope: document.querySelector('.marxy-library-title').textContent }));
};
const firstNumber = (status) => Number(/^([\d,]+)/.exec(status)[1].replace(/,/g, ''));

test('with no [[query]] the section is not drawn, and no built-in row (near-duplicates, broken paths) appears', async () => {
  await withPage(async (page) => {
    await boot(page, { open: ['/r/a.md'], index: reportEntries });
    await unfold(page);
    await drawn(page);
    assert.equal(await smartSection(page), false, 'no collection.toml');
    assert.equal(await page.evaluate(() => /Near-duplicates|Broken|Smart/i.test(document.querySelector('.marxy-sidebar').textContent)), false);
    await writeToml(page, '[[root]]\npath = "/r"\n');
    assert.equal(await smartSection(page), false, 'a collection.toml with folders and no queries');
    assert.equal(await page.evaluate(() => /Near-duplicates|Broken|Smart/i.test(document.querySelector('.marxy-sidebar').textContent)), false);
  });
});

test('the section lists the queries by name in file order, after Folders, with a quiet count where the index can give one', async () => {
  await withPage(async (page) => {
    await boot(page, { open: ['/r/a.md'], index: reportEntries, data: { '/collection.toml': TOML } });
    await unfold(page);
    await page.waitForSelector('[data-marxy-sidebar-section="smart"]');
    await countsLanded(page);
    await countsLanded(page, 'Pinned');
    const rows = await smartRows(page);
    assert.deepEqual(rows.map((r) => [r.row, r.name, r.count]), [
      ['smart:Reports', 'Reports', '3'],
      ['smart:Pinned', 'Pinned', '0'],
      ['smart:Cache notes', 'Cache notes', null], // a word is searched in the lines of the files: only the library reads them
    ]);
    assert.equal(rows[0].label, 'Reports, smart collection, 3 files');
    assert.equal(rows[2].label, 'Cache notes, smart collection');
    assert.equal(rows[0].title, 'kind:report', 'the query is the tooltip');
    const order = (await allSections(page)).map((s) => s.id);
    assert.equal(order.at(-1), 'smart');
    assert.deepEqual((await allSections(page)).find((s) => s.id === 'smart').rows, ['smart:Reports', 'smart:Pinned', 'smart:Cache notes']);
  });
});

test('a row opens the library with its query, and its count is the number the library shows for it', async () => {
  await withPage(async (page) => {
    await boot(page, { open: ['/r/a.md'], index: reportEntries, data: { '/collection.toml': TOML } });
    await unfold(page);
    await page.waitForSelector('[data-marxy-sidebar-row="smart:Reports"]');
    await countsLanded(page);
    await countsLanded(page, 'Pinned');
    const counted = (await smartRows(page)).find((r) => r.name === 'Reports').count;
    await page.click('[data-marxy-sidebar-row="smart:Reports"]');
    const shown = await libraryStatus(page);
    assert.equal(shown.field, 'kind:report');
    assert.equal(shown.scope, 'All files');
    assert.equal(String(firstNumber(shown.status)), counted, `library says "${shown.status}"`);
    assert.equal(await page.evaluate(() => document.querySelectorAll('.marxy-query-chip').length), 1);
    // With the view open, another row puts its query in place; the pinned query shows nothing yet.
    await page.click('[data-marxy-sidebar-row="smart:Pinned"]');
    await page.waitForFunction(() => document.querySelector('.marxy-library-field').value === 'is:pinned');
    assert.equal(await page.evaluate(() => document.querySelectorAll('[data-marxy-library]').length), 1, 'one library, not two');
    const second = await libraryStatus(page);
    assert.equal(firstNumber(second.status), 0);
    assert.equal(String(firstNumber(second.status)), (await smartRows(page)).find((r) => r.name === 'Pinned').count);
  });
});

test('a count changes when a matching file is added, and when a file stops matching', async () => {
  await withPage(async (page) => {
    await boot(page, { open: ['/r/a.md'], index: reportEntries, data: { '/collection.toml': TOML } });
    await unfold(page);
    await page.waitForSelector('[data-marxy-sidebar-row="smart:Reports"]');
    await countsLanded(page);
    const count = async () => (await smartRows(page)).find((r) => r.name === 'Reports').count;
    assert.equal(await count(), '3');
    const added = { ...reportEntries[0], path: '/r/new-report.md', title: 'New report' };
    await page.evaluate((all) => window.__marxyHandle.palette.setIndexEntries(all), [...reportEntries, added]);
    await page.waitForFunction(() => document.querySelector('[data-marxy-sidebar-row="smart:Reports"] .marxy-sidebar-age').textContent === '4');
    await page.evaluate((all) => window.__marxyHandle.palette.setIndexEntries(all), reportEntries.map((e) => (e.path === '/r/a.md' ? { ...e, readerKind: 'notes' } : e)));
    await page.waitForFunction(() => document.querySelector('[data-marxy-sidebar-row="smart:Reports"] .marxy-sidebar-age').textContent === '2');
    // The library, opened on the same query, agrees with the row at every step.
    await page.click('[data-marxy-sidebar-row="smart:Reports"]');
    assert.equal(firstNumber((await libraryStatus(page)).status), 2);
  });
});

test('a hand edit to collection.toml updates the section: a new query appears, a removed one goes, and with none the section goes', async () => {
  await withPage(async (page) => {
    await boot(page, { open: ['/r/a.md'], index: reportEntries, data: { '/collection.toml': TOML } });
    await unfold(page);
    await page.waitForSelector('[data-marxy-sidebar-section="smart"]');
    await writeToml(page, `${TOML}\n[[query]]\nname = "Added by hand"\nq = "is:changed"\n`);
    await page.waitForSelector('[data-marxy-sidebar-row="smart:Added by hand"]');
    await writeToml(page, '[[query]]\nname = "Only"\nq = "kind:report"\n');
    await page.waitForFunction(() => [...document.querySelectorAll('[data-marxy-sidebar-section="smart"] [data-marxy-sidebar-row]')].length === 1);
    assert.deepEqual((await smartRows(page)).map((r) => r.name), ['Only']);
    await writeToml(page, '# nothing left\n');
    await page.waitForFunction(() => document.querySelector('[data-marxy-sidebar-section="smart"]') === null);
  });
});

test('folded, the section keeps a count of its queries and evaluates none; it is remembered like the others', async () => {
  await withPage(async (page) => {
    await boot(page, { open: ['/r/a.md'], index: reportEntries, data: { '/collection.toml': TOML } });
    await unfold(page);
    await page.waitForSelector('[data-marxy-sidebar-section="smart"]');
    await page.click('[data-marxy-sidebar-section="smart"] .marxy-sidebar-head');
    const folded = (await allSections(page)).find((s) => s.id === 'smart');
    assert.deepEqual([folded.expanded, folded.count, folded.rows], ['false', '3', []]);
    assert.deepEqual(JSON.parse(await workspaceFile(page)).sidebar, { collapsed: ['smart'] });
    // Counts are not computed while it is folded: the query is evaluated against the feed only when the section opens.
    await page.evaluate(() => window.__marxyHandle.palette.setIndexEntries(window.__marxyHandle.palette.feed.entries().map((e) => ({ ...e }))));
    await page.click('[data-marxy-sidebar-section="smart"] .marxy-sidebar-head');
    await page.waitForFunction(() => [...document.querySelectorAll('[data-marxy-sidebar-section="smart"] .marxy-sidebar-age')].length === 2);
    assert.deepEqual((await smartRows(page)).map((r) => r.count), ['3', '0', null], 'counted again once open');
  });
});

test('a row\'s menu has Edit in collection.toml, which opens the file in Source at that table', async () => {
  // Far enough down that Source shows it only when it was taken there.
  const filler = '# filler\n'.repeat(150);
  const long = filler + TOML;
  const tableAt = new TextEncoder().encode(`${filler}${TOML.slice(0, TOML.indexOf('[[query]]\nname = "Pinned"'))}`).length;
  await withPage(async (page) => {
    await boot(page, { open: ['/r/a.md'], index: reportEntries, data: { '/collection.toml': long } });
    await unfold(page);
    await page.waitForSelector('[data-marxy-sidebar-row="smart:Pinned"]');
    await page.evaluate(() => {
      const h = window.__marxyHandle;
      const real = h.jumpToSource.bind(h);
      window.__jumps = [];
      h.jumpToSource = (at) => { window.__jumps.push(at); return real(at); };
    });
    await page.click('[data-marxy-sidebar-row="smart:Pinned"]', { button: 'right' });
    await page.waitForSelector('.marxy-verb-menu');
    const items = await page.evaluate(() => [...document.querySelectorAll('.marxy-verb-menu [role="menuitem"]')].map((n) => n.textContent.trim()));
    assert.ok(items.length === 1 && /^Edit in collection\.toml/.test(items[0]), items.join('|'));
    await page.click('.marxy-verb-menu [role="menuitem"]');
    await page.waitForFunction(() => window.__marxyHandle.panes().focused.path() === '/collection.toml');
    await page.waitForFunction(() => document.body.dataset.marxyMode === 'source' && document.querySelector('.cm-line'));
    await page.waitForFunction(() => window.__jumps.length > 0);
    assert.deepEqual(await page.evaluate(() => window.__jumps), [tableAt], 'asked for the table\'s first byte');
    await page.waitForFunction(() => [...document.querySelectorAll('.cm-line')].some((l) => l.textContent === 'name = "Pinned"' && l.getBoundingClientRect().top >= 0 && l.getBoundingClientRect().bottom <= window.innerHeight));
  });
});

test('the context-menu key, and Shift+F10, open the same menu from the keyboard', async () => {
  await withPage(async (page) => {
    await boot(page, { open: ['/r/a.md'], index: reportEntries, data: { '/collection.toml': TOML } });
    await unfold(page);
    await page.waitForSelector('[data-marxy-sidebar-row="smart:Reports"]');
    await page.focus('[data-marxy-sidebar-row="smart:Reports"]');
    await page.keyboard.press('Shift+F10');
    await page.waitForSelector('.marxy-verb-menu');
    assert.match(await page.evaluate(() => document.querySelector('.marxy-verb-menu [role="menuitem"]').textContent), /Edit in collection\.toml/);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.marxy-verb-menu'));
    // Mod+Enter is "open beside" for a document row; a smart row has no document to open beside.
    await page.focus('[data-marxy-sidebar-row="smart:Reports"]');
    await page.keyboard.press(`${await mod(page)}+Enter`);
    assert.deepEqual(await paths(page), ['/r/a.md']);
  });
});

test('a feed patch does not wait on the counts: 50 saved queries over 20,000 entries redraw in a fraction of a second, and the counts land after', async () => {
  const many = Array.from({ length: 20_000 }, (_, i) => entryOf('/r/a.md', { path: `/r/many/f${i}.md`, title: `F ${i}`, size: i % 4000, readerKind: i % 3 === 0 ? 'report' : 'notes', mtimeMs: Date.now() - (i % 90) * 3_600_000 }));
  // entryOf reads `files` for the title: give the entries their own.
  const queries = Array.from({ length: 50 }, (_, i) => `[[query]]\nname = "Q${i}"\nq = "kind:report size:>${i * 40} modified:<${(i % 40) + 1}d"\n`).join('\n');
  await withPage(async (page) => {
    await boot(page, { open: ['/r/a.md'], index: entries, data: { '/collection.toml': queries } });
    await unfold(page);
    await page.waitForSelector('[data-marxy-sidebar-row="smart:Q0"]');
    await page.evaluate((all) => window.__marxyHandle.palette.setIndexEntries(all), many);
    // Patches as a walk makes them: a new feed each time. Each redraw must come back at once; none may wait for a count.
    const cost = await page.evaluate((all) => {
      const palette = window.__marxyHandle.palette;
      const worst = [];
      for (let i = 0; i < 5; i++) {
        const t = performance.now();
        palette.setIndexEntries(all.map((e, k) => (k === i ? { ...e, mtimeMs: Date.now() } : e)));
        worst.push(performance.now() - t);
      }
      return Math.max(...worst);
    }, many);
    // The feed rebuild is most of this (it prepares 20,000 rows); the counts of 50 queries over 20,000 entries took over a second more.
    assert.ok(cost < 600, `a patch took ${cost.toFixed(0)} ms`);
    await page.waitForFunction(() => document.querySelector('[data-marxy-sidebar-row="smart:Q49"] .marxy-sidebar-age') !== null, undefined, { timeout: 60_000 });
  }, { width: 1470, height: 900 });
});
