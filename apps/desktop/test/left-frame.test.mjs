// The left section's frame and Places in WebKit: the rail of eight panels in four groups with
// Look and Settings at its foot, the drawer's one frame, the panel cursor and its keys, b and Mod+B, Tab between the
// page and the panel, the narrow window, and Places' filter, count line, view menu, rows and verbs.
import { strict as assert } from 'node:assert';
import { after, test as nodeTest } from 'node:test';
import { closeHarness } from './support/two-pane.mjs';
import { drawerShows, frameNow, savedFrame, skip, withFrame } from './support/frame.mjs';

const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);
after(() => closeHarness());

const doc = (name) => `# ${name}\n\nThe ${name} file.\n\n## Scope\n\nWhat is in scope.\n\n## Rollback\n\nHow to go back.\n`;
const FILES = {
  '/r/plans/pg16-upgrade-plan.md': doc('Postgres 16'),
  '/r/plans/release-plan.md': doc('Release'),
  '/r/notes.md': doc('Notes'),
  '/r/data/services.json': '{"services": [{"name": "a"}, {"name": "b"}]}\n',
  '/r/data/latency.csv': 'service,p95_ms\nindexer,120\nwatcher,80\n',
  '/r/logs/indexer.log': '2026-10-14T08:00:00Z INFO start\n2026-10-14T08:00:01Z ERROR failed\n',
  '/r/src/main.rs': 'fn main() {}\n',
  '/r/.cache/kept.md': doc('kept'),
};
const PG = '/r/plans/pg16-upgrade-plan.md';
const PLAN = '/r/plans/release-plan.md';
// Opened at the top of /r, so the index's place is /r (a file's own folder is its place when no repository holds it).
const NOTES = '/r/notes.md';

const blur = (page) => page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
const inDrawer = (page) => page.evaluate(() => !!document.activeElement?.closest('.marxy-drawer'));
const cur = (page) => page.evaluate(() => document.querySelector('.marxy-drawer .marxy-l-prow.marxy-l-cur')?.dataset.marxyLeftRow ?? null);
const fileRows = (page) => page.evaluate(() => [...document.querySelectorAll('.marxy-drawer .marxy-l-prow[data-marxy-left-row^="f:"]')].map((r) => r.dataset.marxyLeftRow.slice(2)));
const shown = (page, sel) => page.evaluate((sel) => { const el = document.querySelector(sel); return !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden'; }, sel);
/** Places drawn with the index's files in it. */
const placesReady = (page, path = NOTES) => page.waitForFunction((p) => document.querySelector(`.marxy-drawer .marxy-l-prow[data-marxy-left-row="f:${p}"]`), path);
/** Moves the panel cursor with j until it rests on row `k` (the keys must be in the panel). */
async function goRow(page, k) {
  for (let i = 0; i < 60 && (await cur(page)) !== k; i++) await page.keyboard.press('j');
  assert.equal(await cur(page), k, `the cursor reaches ${k}`);
}

test('the rail: eight panels in four groups, then Look and Settings; Places is open', async () => {
  await withFrame({ files: FILES, open: [NOTES] }, async (page) => {
    await placesReady(page);
    const s = await page.evaluate(() => ({
      ids: [...document.querySelectorAll('.marxy-rail .marxy-l-rb')].map((b) => b.dataset.marxyLeft),
      rules: document.querySelectorAll('.marxy-rail .marxy-l-rule').length,
      on: [...document.querySelectorAll('.marxy-rail .marxy-l-rb[aria-pressed="true"]')].map((b) => b.dataset.marxyLeft),
      head: document.querySelector('.marxy-drawer .marxy-l-head b').textContent,
      rail: document.querySelector('.marxy-rail').getBoundingClientRect().width,
      drawer: document.querySelector('.marxy-drawer').getBoundingClientRect().width,
      panel: document.querySelector('.marxy-panel'),
    }));
    assert.deepEqual(s.ids, ['places', 'metadata', 'outline', 'links', 'search', 'transforms', 'export', 'versions', 'look', 'settings'], 'the rail, top to bottom');
    assert.equal(s.rules, 3, 'hairlines between groups');
    assert.deepEqual(s.on, ['places'], 'the panel marked on');
    assert.equal(s.head, 'Places', 'drawer head');
    assert.equal(s.rail, 44, 'rail width');
    assert.equal(s.drawer, 316, 'drawer width');
    assert.equal(s.panel, null, 'the right-hand panel of cards is gone');
    assert.equal(await page.locator('.marxy-tabbar .marxy-head-panel').count(), 0, 'and its door in the tab row');
  });
});

test("a panel's name shows on hover after a rest, with its key and what it is for; the next follows at once", async () => {
  await withFrame({ files: FILES, open: [NOTES] }, async (page) => {
    const tip = () => page.evaluate(() => { const t = document.querySelector('body > .marxy-l-tip'); return { shown: !!t && getComputedStyle(t).display !== 'none', text: t?.hidden ? '' : t?.textContent.replace(/\s+/g, ' ').trim() }; });
    const shownNow = async () => (await tip()).shown;
    assert.equal(await shownNow(), false, 'at rest');
    await page.hover('.marxy-rail .marxy-l-rb[data-marxy-left="outline"]');
    await page.waitForTimeout(120);
    assert.equal(await shownNow(), false, 'not the instant the pointer crosses the button');
    await page.waitForFunction(() => !document.querySelector('body > .marxy-l-tip').hidden, null, { timeout: 2000 });
    // A tip's two lines: the name and its key, then what the panel is for.
    const mac = (await page.evaluate(() => navigator.platform)) === 'MacIntel';
    assert.deepEqual(await tip(), { shown: true, text: `${mac ? 'Outline ⌥3' : 'Outline Alt+3'} Its headings and parts` }, 'after the rest');
    assert.equal(await page.getAttribute('.marxy-rail .marxy-l-rb[data-marxy-left="outline"]', 'aria-label'), 'Outline');
    // Down the rail the next tip shows at once.
    await page.hover('.marxy-rail .marxy-l-rb[data-marxy-left="links"]');
    await page.waitForTimeout(30);
    assert.match((await tip()).text, /^Links .* Where its links lead, and what points here$/, 'the next button, at once');
    // Off the rail long enough, the tip waits again; a press hides it.
    await page.mouse.move(800, 400);
    await page.waitForTimeout(800);
    await page.hover('.marxy-rail .marxy-l-rb[data-marxy-left="search"]');
    await page.waitForTimeout(120);
    assert.equal(await shownNow(), false, 'cold again after the pointer left the rail');
    await page.waitForFunction(() => !document.querySelector('body > .marxy-l-tip').hidden, null, { timeout: 2000 });
    await page.click('.marxy-rail .marxy-l-rb[data-marxy-left="search"]');
    assert.equal(await shownNow(), false, 'a press hides it');
    await page.hover('.marxy-rail .marxy-l-rb[data-marxy-left="settings"]');
    await page.waitForFunction(() => document.querySelector('body > .marxy-l-tip')?.textContent.includes('Every line of config.toml'));
  });
});

test('b steps the left: open, the rail alone, hidden, open; Mod+B does the same, and frame.json keeps it', async () => {
  await withFrame({ files: FILES, open: [NOTES] }, async (page, { mod }) => {
    const q = async () => ({ rail: await shown(page, '.marxy-rail'), drawer: await shown(page, '.marxy-drawer') });
    await placesReady(page);
    await blur(page);
    assert.deepEqual(await q(), { rail: true, drawer: true }, 'at rest');
    await page.keyboard.press('b');
    await drawerShows(page, null);
    assert.deepEqual(await q(), { rail: true, drawer: false }, 'after b');
    await page.keyboard.press('b');
    await page.waitForFunction(() => document.body.getAttribute('data-marxy-left') === 'hidden');
    assert.deepEqual(await q(), { rail: false, drawer: false }, 'after b twice');
    assert.equal(await page.evaluate(() => getComputedStyle(document.body).getPropertyValue('--marxy-frame-left')), '0px', 'the page has the room');
    await page.keyboard.press('b');
    await drawerShows(page, 'places');
    assert.deepEqual(await q(), { rail: true, drawer: true }, 'after b three times');
    await page.keyboard.press(`${mod}+b`);
    await drawerShows(page, null);
    assert.equal((await savedFrame(page)).leftMode, 'rail', 'Mod+B as b; the mode is kept');
    // In a field b is a letter.
    await page.keyboard.press(`${mod}+b`);
    await page.keyboard.press(`${mod}+b`);
    await drawerShows(page, 'places');
    await page.click('.marxy-drawer input[data-marxy-left-field="places-q"]');
    await page.keyboard.type('b');
    assert.equal(await page.inputValue('.marxy-drawer input[data-marxy-left-field="places-q"]'), 'b');
    assert.equal((await frameNow(page)).left, 'open');
  });
});

test('Alt+3 opens Outline and takes the keys; Tab gives them back to the page, and Tab on the page comes back', async () => {
  await withFrame({ files: FILES, open: [NOTES] }, async (page) => {
    await blur(page);
    await page.keyboard.press('Alt+3');
    await drawerShows(page, 'outline');
    await page.waitForFunction(() => document.activeElement?.closest('.marxy-drawer') && !document.activeElement.matches('input'));
    assert.equal(await inDrawer(page), true, 'keys are in the panel');
    assert.equal((await savedFrame(page)).leftPanel, 'outline', 'the panel is kept');
    await page.keyboard.press('Tab');
    assert.equal(await inDrawer(page), false, 'after Tab');
    await page.keyboard.press('j');
    await page.waitForFunction(() => window.__marxyHandle.selection.state().selection.kind !== 'none');
    assert.notEqual(await page.evaluate(() => window.__marxyHandle.selection.state().selection.kind), 'none', "j moves the page's cursor again");
    await page.keyboard.press('Tab');
    assert.equal(await inDrawer(page), true, 'Tab from the page comes back');
    // Every panel answers its key.
    for (const [n, id] of [[1, 'places'], [2, 'metadata'], [4, 'links'], [5, 'search'], [6, 'transforms'], [7, 'export'], [8, 'versions']]) {
      await blur(page);
      await page.keyboard.press(`Alt+${n}`);
      await drawerShows(page, id);
    }
  });
});

test("clicking the open panel's icon folds the drawer to the rail; another icon opens its panel", async () => {
  await withFrame({ files: FILES, open: [NOTES] }, async (page) => {
    await placesReady(page);
    await page.click('.marxy-rail .marxy-l-rb[data-marxy-left="places"]');
    await drawerShows(page, null);
    assert.deepEqual({ drawer: await shown(page, '.marxy-drawer'), rail: await shown(page, '.marxy-rail') }, { drawer: false, rail: true }, 'after a click on the active icon');
    await page.click('.marxy-rail .marxy-l-rb[data-marxy-left="metadata"]');
    await drawerShows(page, 'metadata');
    assert.deepEqual((await frameNow(page)).pressed, ['metadata']);
  });
});

test('Places: Ctrl+click on a folder reads it as a page', async () => {
  await withFrame({ files: FILES, open: [NOTES] }, async (page) => {
    await placesReady(page);
    await page.locator('.marxy-drawer .marxy-l-row.marxy-l-dir .marxy-l-nm', { hasText: /^data\/$/ }).first().click({ modifiers: ['Control'] });
    await page.waitForSelector('.marxy-apppage-title');
    assert.equal(await page.textContent('.marxy-apppage-title'), 'data/', "the folder's page");
  });
});

test('Places: typing narrows every place and marks the letters; Esc clears', async () => {
  await withFrame({ files: FILES, open: [NOTES] }, async (page) => {
    await placesReady(page);
    await page.click('.marxy-drawer input[data-marxy-left-field="places-q"]');
    await page.keyboard.type('plan');
    await page.waitForFunction(() => document.querySelector('.marxy-drawer .marxy-l-census')?.textContent.includes(' of '));
    const s = await page.evaluate(() => ({
      census: document.querySelector('.marxy-drawer .marxy-l-census').textContent,
      marks: document.querySelectorAll('.marxy-drawer .marxy-l-row mark').length,
      focus: document.activeElement.dataset.marxyLeftField,
    }));
    assert.deepEqual((await fileRows(page)).sort(), [PG, PLAN].sort(), 'file rows shown');
    assert.match(s.census, /^2 of \d+ files/, 'the count line');
    assert.ok(s.marks >= 3, `matched letters are marked (${s.marks})`);
    assert.equal(s.focus, 'places-q', 'the field keeps the caret through the redraw');
    await page.keyboard.press('Escape');
    assert.equal(await page.inputValue('.marxy-drawer input[data-marxy-left-field="places-q"]'), '', 'after Esc');
    await page.waitForFunction(() => !document.querySelector('.marxy-drawer .marxy-l-census').textContent.includes(' of '));
    assert.match(await page.textContent('.marxy-drawer .marxy-l-census'), /^\d+ prose · \d+ code/, 'the count by kind again');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.activeElement?.closest('.marxy-drawer') && !document.activeElement.matches('input'));
    // kind: and sizes narrow too.
    await page.fill('.marxy-drawer input[data-marxy-left-field="places-q"]', 'kind:data');
    await page.waitForFunction(() => document.querySelector('.marxy-drawer .marxy-l-census')?.textContent.startsWith('2 of'));
    assert.deepEqual((await fileRows(page)).sort(), ['/r/data/latency.csv', '/r/data/services.json']);
    await page.fill('.marxy-drawer input[data-marxy-left-field="places-q"]', '>40');
    await page.waitForFunction(() => !document.querySelector('.marxy-drawer .marxy-l-prow[data-marxy-left-row="f:/r/src/main.rs"]'));
    assert.ok((await fileRows(page)).includes(PG), 'a file over 40 bytes stays');
  });
});

test('Places: a kind in the count line shows only that kind', async () => {
  await withFrame({ files: FILES, open: [NOTES] }, async (page) => {
    await placesReady(page);
    await page.locator('.marxy-drawer .marxy-l-census button', { hasText: /data$/ }).click();
    await page.waitForFunction(() => document.querySelector('.marxy-drawer .marxy-l-census button.marxy-l-on'));
    assert.equal(await page.textContent('.marxy-drawer .marxy-l-census button.marxy-l-on'), '2 data', 'the word marked');
    assert.ok(await page.locator('.marxy-drawer .marxy-l-census button', { hasText: /^1 log$/ }).count(), 'one log, in the singular');
    assert.deepEqual((await fileRows(page)).sort(), ['/r/data/latency.csv', '/r/data/services.json'], 'rows');
    await page.click('.marxy-drawer .marxy-l-census button.marxy-l-on');
    await page.waitForFunction(() => !document.querySelector('.marxy-drawer .marxy-l-census button.marxy-l-on'));
    assert.ok((await page.locator('.marxy-drawer .marxy-l-prow[data-marxy-left-row^="d:"]').count()) >= 4, 'a second click shows every kind again');
  });
});

test('Places: the view menu groups by kind and orders by size', async () => {
  await withFrame({ files: FILES, open: [NOTES] }, async (page) => {
    await placesReady(page);
    const pick = async (title) => {
      await page.click('.marxy-drawer .marxy-l-fld button.marxy-l-v');
      await page.locator('[role="menu"] [role="menuitem"]', { hasText: title }).first().click();
      await page.waitForTimeout(100);
    };
    await pick('Grouped by kind');
    const groups = await page.$$eval('.marxy-drawer .marxy-l-prow[data-marxy-left-row^="k:"] .marxy-l-nm', (els) => els.map((e) => e.textContent));
    assert.deepEqual(groups, ['prose', 'code', 'data', 'logs'], 'groups, in order');
    assert.equal(await page.textContent('.marxy-drawer .marxy-l-fld button.marxy-l-v'), 'by kind ▾');
    await pick('One flat list');
    await pick('Size');
    const sizes = await page.evaluate(() => {
      const size = new Map(window.__marxyHandle.index.entries().map((e) => [e.path, e.size]));
      return [...document.querySelectorAll('.marxy-drawer .marxy-l-prow[data-marxy-left-row^="f:"]')].map((r) => size.get(r.dataset.marxyLeftRow.slice(2)));
    });
    assert.equal(sizes.length, Object.keys(FILES).length, 'every file in one flat list');
    assert.ok(sizes.every((x, i) => i === 0 || sizes[i - 1] >= x), `largest first: ${sizes}`);
    await pick('Dot files and folders');
    assert.equal((await fileRows(page)).includes('/r/.cache/kept.md'), false, 'dot files can be left out');
  });
});

test('keys in Places: J moves, L opens a folder, O opens a file and the verb bar names it', async () => {
  await withFrame({ files: FILES, open: [NOTES] }, async (page) => {
    await placesReady(page);
    await blur(page);
    await page.keyboard.press('Tab');
    assert.equal(await inDrawer(page), true);
    const a = await cur(page);
    await page.keyboard.press('j');
    const b = await cur(page);
    assert.ok(a && b && a !== b, `j moves the panel's cursor (${a} → ${b})`);
    await goRow(page, 'd:/r/data');
    await page.keyboard.press('l');
    await page.waitForFunction(() => document.querySelector('.marxy-drawer .marxy-l-prow[data-marxy-left-row="f:/r/data/services.json"]'));
    assert.equal(await cur(page), 'd:/r/data', 'the cursor stays on it');
    await page.keyboard.press('l');
    assert.equal(await cur(page), 'f:/r/data/latency.csv', 'l again steps in');
    await page.keyboard.press('h');
    assert.equal(await cur(page), 'd:/r/data', 'h steps out');
    await goRow(page, 'f:/r/data/services.json');
    assert.match(await page.textContent('.marxy-drawer .marxy-l-foot'), /services\.json.*open/, 'the verb bar names the row and its verbs');
    await page.keyboard.press('o');
    await page.waitForFunction(() => window.__marxyHandle.panes().focused.path() === '/r/data/services.json');
    assert.equal(await inDrawer(page), true, 'the keys stay in the panel');
    // Enter lists the row's verbs; Escape leaves the menu.
    await page.keyboard.press('Enter');
    await page.waitForSelector('[role="menu"]');
    const verbs = await page.$$eval('[role="menu"] [role="menuitem"]', (els) => els.map((e) => e.textContent));
    for (const v of ['Open', 'Open beside', 'Pin', 'Copy its path', 'Tick']) assert.ok(verbs.some((t) => t.startsWith(v)), `${v} in ${verbs}`);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('[role="menu"]'));
  });
});

test('ticking two files and ~ compares them', async () => {
  await withFrame({ files: FILES, open: [NOTES], config: '[proposals]\ncompare_files = true\n' }, async (page) => {
    await placesReady(page);
    await blur(page);
    await page.keyboard.press('Tab');
    await goRow(page, 'd:/r/plans');
    await page.keyboard.press('l');
    await goRow(page, `f:${PG}`);
    await page.keyboard.press('Space');
    await goRow(page, `f:${PLAN}`);
    await page.keyboard.press('Space');
    assert.equal(await page.locator('.marxy-drawer .marxy-l-row.marxy-l-sel').count(), 2, 'ticked');
    assert.equal(await page.textContent('.marxy-drawer .marxy-l-foot .marxy-l-what'), '2 files', 'the verb bar speaks for both');
    await page.keyboard.press('~');
    await page.waitForFunction(() => window.__marxyHandle.panes().panes.some((p) => /compare|diff|patch/i.test(p.path() ?? '')) || document.querySelectorAll('.marxy-tabbar .marxy-tab').length > 1);
    assert.ok((await page.$$eval('.marxy-tabbar .marxy-tab-name', (els) => els.map((e) => e.textContent))).length > 1, 'a comparison is open');
  });
});

test('m pins the file; the pin is at the top of Places and goes there', async () => {
  await withFrame({ files: FILES, open: [NOTES] }, async (page) => {
    await placesReady(page);
    await blur(page);
    await page.keyboard.press('Tab');
    await goRow(page, 'd:/r/plans');
    await page.keyboard.press('l');
    await goRow(page, `f:${PLAN}`);
    await page.keyboard.press('m');
    await page.waitForFunction(() => document.querySelector('.marxy-drawer .marxy-l-prow[data-marxy-left-row^="p:"]'));
    assert.deepEqual(await page.$$eval('.marxy-drawer .marxy-l-gh b', (els) => els.map((e) => e.textContent)).then((g) => g[0]), 'Pinned');
    assert.equal(await page.evaluate(() => window.__marxyPalette?.session.pinned.includes('/r/plans/release-plan.md') ?? null), true, 'kept with the palette pins');
    await page.click(`.marxy-drawer .marxy-l-prow[data-marxy-left-row="p:${PLAN}"]`);
    await page.waitForFunction((p) => window.__marxyHandle.panes().focused.path() === p, PLAN);
  });
});

test('an open file in no place is Loose; d takes it off the list and nothing on disk changes', async () => {
  await withFrame({ files: FILES, open: [NOTES] }, async (page) => {
    await placesReady(page);
    assert.equal(await page.locator('.marxy-drawer .marxy-l-gh b', { hasText: 'Loose' }).count(), 0, 'no Loose while every open file is in a place');
    await page.evaluate((p) => window.__marxyHandle.open(p), PG);
    await page.waitForFunction((p) => window.__marxyHandle.panes().focused.path() === p, PG);
    // The index no longer holds the file (its place was let go): Places is drawn from the index as it is.
    await page.evaluate((p) => {
      const ix = window.__marxyHandle.index;
      const all = ix.entries.bind(ix);
      ix.entries = () => all().filter((e) => e.path !== p);
      ix.roots = () => [];
      window.__marxyHandle.frame().left.draw();
    }, NOTES);
    await page.waitForFunction(() => [...document.querySelectorAll('.marxy-drawer .marxy-l-gh b')].some((b) => b.textContent === 'Loose'));
    assert.deepEqual(await fileRows(page), [NOTES], 'the open file, in Loose');
    await blur(page);
    await page.keyboard.press('Tab');
    await goRow(page, `f:${NOTES}`);
    const before = await page.evaluate(async (p) => new TextDecoder().decode(await window.__marxyHandle.shell.readFile(p)), NOTES);
    await page.keyboard.press('d');
    await page.waitForFunction(() => !document.querySelector('.marxy-tabbar .marxy-tab-name') || ![...document.querySelectorAll('.marxy-tabbar .marxy-tab-name')].some((t) => t.textContent === 'notes.md'));
    assert.equal(await page.evaluate(async (p) => new TextDecoder().decode(await window.__marxyHandle.shell.readFile(p)), NOTES), before, 'not a byte changed');
  });
});

test('Look at the foot of the rail opens the Studio; Settings shows in the drawer, and again goes back to the panel', async () => {
  await withFrame({ files: FILES, open: [NOTES] }, async (page) => {
    await placesReady(page);
    await page.click('.marxy-rail .marxy-l-rb[data-marxy-left="look"]');
    await page.waitForSelector('dialog.marxy-studio[open]');
    assert.deepEqual((await frameNow(page)).pressed, ['places'], 'the drawer keeps its panel');
    await page.keyboard.press('Escape');
    await page.waitForSelector('dialog.marxy-studio', { state: 'detached' });
    await page.click('.marxy-rail .marxy-l-rb[data-marxy-left="settings"]');
    await drawerShows(page, 'settings');
    await page.waitForSelector('.marxy-drawer [data-marxy-settings]');
    await page.click('.marxy-rail .marxy-l-rb[data-marxy-left="settings"]');
    await drawerShows(page, 'places');
  });
});

test('at 760 px the drawer gives way to the rail, and a panel asked for lies over the page until Escape', async () => {
  await withFrame({ files: FILES, open: [NOTES], viewport: { width: 760, height: 700 } }, async (page) => {
    assert.deepEqual({ rail: await shown(page, '.marxy-rail'), drawer: await shown(page, '.marxy-drawer') }, { rail: true, drawer: false }, 'narrow window');
    await blur(page);
    await page.keyboard.press('Alt+2');
    await drawerShows(page, 'metadata');
    assert.equal((await frameNow(page)).drawer, 'over');
    assert.equal(await page.evaluate(() => getComputedStyle(document.body).getPropertyValue('--marxy-frame-left')), '44px', 'over the page, not beside it');
    await page.keyboard.press('Escape');
    await drawerShows(page, null);
    assert.equal(await inDrawer(page), false);
  });
});

test('the panels are commands in the finder', async () => {
  await withFrame({ files: FILES, open: [NOTES] }, async (page, { mod }) => {
    await blur(page);
    await page.keyboard.press(`${mod}+Shift+P`);
    await page.waitForSelector('#marxy-palette[open]');
    await page.keyboard.type('show the panel');
    await page.waitForTimeout(300);
    const labs = await page.evaluate(() => document.querySelector('#marxy-palette').innerText);
    for (const n of ['Places', 'Metadata', 'Outline', 'Links', 'Search', 'Transforms', 'Export', 'Versions']) assert.ok(labs.includes(`${n}: show the panel`), `${n} is listed`);
  });
});

test('the panel cursor survives a redraw, and an older frame.json opens on its branch\'s panel', async () => {
  await withFrame({ files: FILES, open: [NOTES], frame: { folded: false, branch: 'find', lastBranch: 'find', panel: 'pinned' } }, async (page) => {
    await drawerShows(page, 'search');
    await page.evaluate(() => window.__marxyHandle.frame().left.show('places', undefined, true));
    await placesReady(page);
    await goRow(page, `f:${NOTES}`);
    await page.evaluate(() => window.__marxyHandle.frame().left.draw());
    assert.equal(await cur(page), `f:${NOTES}`, 'kept by its key');
    assert.equal((await savedFrame(page)).leftPanel, 'places');
  });
});

test('the rail marks state the reader made: Search\'s matches after a query, an unsaved dot on Versions', async () => {
  await withFrame({ files: FILES, open: [NOTES] }, async (page) => {
    await placesReady(page);
    const badge = (id) => page.evaluate((id) => {
      const b = document.querySelector(`.marxy-rail .marxy-l-rb[data-marxy-left="${id}"]`);
      const m = b.querySelector('.marxy-l-badge');
      return m ? { text: m.textContent, dot: m.classList.contains('marxy-l-dot'), label: b.getAttribute('aria-label') } : null;
    }, id);
    assert.equal(await badge('search'), null, 'no mark before a query');
    assert.equal(await badge('versions'), null, 'nor before an edit');
    assert.equal(await badge('outline'), null, 'never for what a file holds');
    await page.evaluate(() => window.__marxyHandle.frame().left.show('search', { q: 'scope', scope: 'grep' }, false));
    await page.waitForFunction(() => document.querySelector('.marxy-rail .marxy-l-rb[data-marxy-left="search"] .marxy-l-badge'));
    const s = await badge('search');
    assert.match(s.text, /^\d+$/, 'a count');
    assert.equal(s.label, `Search, ${s.text} ${s.text === '1' ? 'match' : 'matches'}`, 'in the accessible name');
    // The query cleared, the mark goes.
    await page.fill('.marxy-drawer input[data-marxy-left-field]', '');
    await page.waitForFunction(() => !document.querySelector('.marxy-rail .marxy-l-rb[data-marxy-left="search"] .marxy-l-badge'));
    // An edit to the file in front: Versions carries a dot until it is saved.
    await page.evaluate(() => window.__marxyHandle.frame().left.show('versions', undefined, false));
    await page.evaluate(async () => {
      const st = window.__marxyHandle.panes().focused.content.store();
      const snap = st.snapshot();
      await st.apply({ range: { file: snap.path, start: 0, end: 0 }, replacement: 'x', label: 'an edit', baseVersion: snap.version });
    });
    await page.waitForFunction(() => document.querySelector('.marxy-rail .marxy-l-rb[data-marxy-left="versions"] .marxy-l-badge'));
    assert.deepEqual(await badge('versions'), { text: '', dot: true, label: 'Versions, unsaved changes' });
    await page.evaluate(() => window.__marxyHandle.panes().focused.content.store().undo());
    await page.waitForFunction(() => !document.querySelector('.marxy-rail .marxy-l-rb[data-marxy-left="versions"] .marxy-l-badge'));
  });
});

test("the foot's verbs are buttons: a press runs the verb on the row under the cursor and keeps the keys", async () => {
  await withFrame({ files: FILES, open: [NOTES] }, async (page) => {
    await placesReady(page);
    await blur(page);
    await page.keyboard.press('Tab');
    await goRow(page, 'd:/r/data');
    await page.keyboard.press('l');
    await goRow(page, 'f:/r/data/services.json');
    const verbs = await page.$$eval('.marxy-drawer .marxy-l-foot button.marxy-l-vb', (bs) => bs.map((b) => b.textContent.replace(/\s+/g, ' ').trim()));
    assert.ok(verbs.some((v) => /^o open$/.test(v)), `open is a button: ${verbs}`);
    assert.ok(await page.locator('.marxy-drawer .marxy-l-foot button.marxy-l-vb .marxy-l-key').count() >= 1, 'each keeps its key cap');
    await page.locator('.marxy-drawer .marxy-l-foot button.marxy-l-vb', { hasText: /open$/ }).first().click();
    await page.waitForFunction(() => window.__marxyHandle.panes().focused.path() === '/r/data/services.json');
    assert.equal(await inDrawer(page), true, 'the keys stay in the panel');
    const all = page.locator('.marxy-drawer .marxy-l-foot button.marxy-l-vb', { hasText: /all$/ });
    if (await all.count()) {
      await all.click();
      await page.waitForSelector('[role="menu"]');
      await page.keyboard.press('Escape');
    }
  });
});

test('a twisty is a drawn chevron that turns; a press on it opens the folder', async () => {
  await withFrame({ files: FILES, open: [NOTES] }, async (page) => {
    await placesReady(page);
    const tw = (k) => page.evaluate((k) => {
      const t = document.querySelector(`.marxy-drawer .marxy-l-prow[data-marxy-left-row="${k}"] .marxy-l-tw`);
      return t ? { svg: !!t.querySelector('svg'), text: t.textContent, open: t.classList.contains('marxy-l-on') } : null;
    }, k);
    assert.deepEqual(await tw('d:/r/data'), { svg: true, text: '▸', open: false }, 'shut: a chevron, the glyph kept in its text');
    await page.click('.marxy-drawer .marxy-l-prow[data-marxy-left-row="d:/r/data"] .marxy-l-tw svg');
    await page.waitForFunction(() => document.querySelector('.marxy-drawer .marxy-l-prow[data-marxy-left-row="f:/r/data/services.json"]'));
    assert.deepEqual(await tw('d:/r/data'), { svg: true, text: '▾', open: true }, 'open: turned');
    const angle = await page.evaluate(() => getComputedStyle(document.querySelector('.marxy-drawer .marxy-l-prow[data-marxy-left-row="d:/r/data"] .marxy-l-tw svg')).transform);
    assert.notEqual(angle, 'none', 'the chevron is turned');
  });
});

const attr = (page, sel, name) => page.evaluate(([sel, name]) => document.querySelector(sel)?.getAttribute(name) ?? null, [sel, name]);
/** Whether the focused tree or listbox points at the panel cursor's row. */
const pointsAtCursor = (page) => page.evaluate(() => {
  const d = document.activeElement;
  if (!d?.matches('.marxy-drawer .marxy-l-body[role="tree"], .marxy-drawer .marxy-l-body[role="listbox"]') || d.hasAttribute('tabindex') === false) return false;
  const row = document.querySelector('.marxy-drawer .marxy-l-prow.marxy-l-cur');
  const id = d.getAttribute('aria-activedescendant');
  return !!row && !!id && row.id === id && document.getElementById(id) === row;
});

test('Places is a tree: levels, expanded, a name for each row, and the drawer points at the cursor row as j k l h move it', async () => {
  await withFrame({ files: FILES, open: [NOTES] }, async (page) => {
    await placesReady(page);
    assert.equal(await attr(page, '.marxy-drawer .marxy-l-body', 'role'), 'tree');
    assert.equal(await attr(page, '.marxy-drawer .marxy-l-body', 'aria-label'), 'Places');
    const dir = '.marxy-drawer .marxy-l-prow[data-marxy-left-row="d:/r/data"]';
    assert.equal(await attr(page, dir, 'role'), 'treeitem');
    assert.equal(await attr(page, dir, 'aria-expanded'), 'false', 'a shut folder');
    assert.equal(await attr(page, dir, 'aria-level'), '2', 'under its place');
    const file = '.marxy-drawer .marxy-l-prow[data-marxy-left-row="f:/r/notes.md"]';
    assert.equal(await attr(page, file, 'aria-expanded'), null, 'a file does not open');
    assert.match(await attr(page, file, 'aria-label'), /^notes\.md\b.*open in a tab/, 'its name and the state that is only drawn');
    assert.doesNotMatch(await attr(page, dir, 'aria-label'), /[▸▾]/, 'the twisty glyph is not part of the name');
    assert.equal(await page.evaluate(() => document.querySelectorAll('.marxy-drawer [tabindex]:not([tabindex="-1"])').length), 0, 'no tab stops were added');

    await blur(page);
    await page.keyboard.press('Tab');
    assert.equal(await inDrawer(page), true);
    await goRow(page, 'd:/r/data');
    assert.equal(await pointsAtCursor(page), true, 'j moved the cursor and the pointer');
    const first = await attr(page, '.marxy-drawer .marxy-l-body', 'aria-activedescendant');
    await page.keyboard.press('k');
    assert.equal(await pointsAtCursor(page), true, 'k too');
    assert.notEqual(await attr(page, '.marxy-drawer .marxy-l-body', 'aria-activedescendant'), first, 'and it is another row');
    await goRow(page, 'd:/r/data');
    await page.keyboard.press('l');
    await page.waitForFunction(() => document.querySelector('.marxy-drawer .marxy-l-prow[data-marxy-left-row="d:/r/data"]')?.getAttribute('aria-expanded') === 'true');
    assert.equal(await attr(page, '.marxy-drawer .marxy-l-prow[data-marxy-left-row="f:/r/data/services.json"]', 'aria-level'), '3', 'its files are one level down');
    assert.equal(await pointsAtCursor(page), true, 'the pointer survives the redraw');
    await page.keyboard.press('h');
    await page.waitForFunction(() => document.querySelector('.marxy-drawer .marxy-l-prow[data-marxy-left-row="d:/r/data"]')?.getAttribute('aria-expanded') === 'false');
    assert.equal(await pointsAtCursor(page), true);
  });
});

test('the flat panels are listboxes of options, a segmented choice is named, and the pointer follows j k', async () => {
  await withFrame({ files: FILES, open: [NOTES] }, async (page) => {
    await blur(page);
    await page.keyboard.press('Alt+8');
    await drawerShows(page, 'versions');
    await page.waitForFunction(() => document.querySelector('.marxy-drawer .marxy-l-body[data-marxy-left="versions"] .marxy-l-prow'));
    assert.equal(await attr(page, '.marxy-drawer .marxy-l-body', 'role'), 'listbox');
    assert.equal(await attr(page, '.marxy-drawer .marxy-l-body', 'aria-label'), 'Versions');
    const names = await page.$$eval('.marxy-drawer .marxy-l-prow', (rs) => rs.map((r) => [r.getAttribute('role'), r.getAttribute('aria-label')]));
    assert.ok(names.length >= 3 && names.every(([role, name]) => role === 'option' && name), `every row is a named option: ${JSON.stringify(names)}`);
    assert.equal(await attr(page, '.marxy-drawer .marxy-l-sg', 'aria-label'), 'Copies kept for each file');
    assert.equal(await attr(page, '.marxy-drawer .marxy-l-sg', 'role'), 'group');
    await page.keyboard.press('j');
    assert.equal(await pointsAtCursor(page), true);
    const one = await attr(page, '.marxy-drawer .marxy-l-body', 'aria-activedescendant');
    await page.keyboard.press('j');
    assert.equal(await pointsAtCursor(page), true);
    assert.notEqual(await attr(page, '.marxy-drawer .marxy-l-body', 'aria-activedescendant'), one);
  });
});

test("Outline is a tree with its headings' levels, and Search's buttons have names", async () => {
  await withFrame({ files: FILES, open: [PG] }, async (page) => {
    await blur(page);
    await page.keyboard.press('Alt+3');
    await drawerShows(page, 'outline');
    await page.waitForSelector('.marxy-drawer .marxy-l-prow[data-marxy-left-row^="h:"]');
    assert.equal(await attr(page, '.marxy-drawer .marxy-l-body', 'role'), 'tree');
    const levels = await page.$$eval('.marxy-drawer .marxy-l-prow', (rs) => rs.map((r) => r.getAttribute('aria-level')));
    assert.deepEqual(levels, ['1', '2', '2'], 'the title and its two sections');
    assert.equal(await attr(page, '.marxy-drawer .marxy-l-prow', 'aria-expanded'), 'true', 'the title is open');
    await blur(page);
    await page.keyboard.press('Alt+5');
    await drawerShows(page, 'search');
    await page.waitForSelector('.marxy-drawer .marxy-l-opt button');
    const opts = await page.$$eval('.marxy-drawer .marxy-l-opt button', (bs) => bs.map((b) => b.getAttribute('aria-label')));
    assert.deepEqual(opts, ['Match case', 'Regular expression', 'Whole words']);
    await page.fill('.marxy-drawer input[data-marxy-left-field="search-q"]', 'scope');
    await page.waitForSelector('.marxy-drawer .marxy-l-prow[data-marxy-left-row^="g:"]');
    assert.equal(await attr(page, '.marxy-drawer .marxy-l-body', 'role'), 'tree', 'files that open over their matches');
    const hit = await page.$$eval('.marxy-drawer .marxy-l-hit', (rs) => rs.map((r) => [r.getAttribute('role'), r.getAttribute('aria-level')]));
    assert.ok(hit.length > 0 && hit.every(([role, level]) => role === 'treeitem' && level === '2'), `matches are one level under their file: ${JSON.stringify(hit)}`);
  });
});

test("a panel's notice lands in the pane's status region, which announces what is added and no more", async () => {
  await withFrame({ files: FILES, open: [NOTES] }, async (page) => {
    const region = '.marxy-pane > [role="status"]';
    assert.equal(await attr(page, region, 'aria-atomic'), 'false', 'a new pill is read alone');
    await page.evaluate(async () => (await import('/src/notices/index.ts')).notify({ kind: 'refused', text: 'Nothing was changed by this panel' }));
    await page.waitForSelector(`${region} .marxy-notice[data-notice-kind="refused"]`);
    const text = await page.$eval(region, (r) => r.textContent);
    assert.equal(text.split('Nothing was changed by this panel').length - 1, 1, 'the words appear once');
    assert.equal(await page.evaluate((s) => document.querySelectorAll(`${s} [aria-live], ${s} [role="alert"]`).length, region), 0, 'no second live region inside the first');
  });
});
