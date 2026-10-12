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
const sections = (page) =>
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
    await page.waitForFunction(() => document.querySelectorAll('.marxy-sidebar-section [data-marxy-sidebar-row]').length === 2);
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
