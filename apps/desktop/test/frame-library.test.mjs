// Places (before it the Library): the place of the file in front as a tree, a
// dot folder dimmed, the filter field, and Sets (a proposal): the open tabs and their sides saved under a name in
// frame.json, opened again on both sides, and forgotten. The Library's Recent section and its Names section are gone
// (the palette keeps Recent; the filter field narrows Places' own rows). Playwright WebKit.
import { strict as assert } from 'node:assert';
import { after, test as nodeTest } from 'node:test';
import { closeHarness } from './support/two-pane.mjs';
import { drawerShows, rowOf, savedFrame, skip, withFrame } from './support/frame.mjs';

const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);
after(() => closeHarness());

const doc = (name) => `# ${name}\n\nThe ${name} file.\n`;
const FILES = {
  ...Object.fromEntries(['A', 'B', 'C', 'X'].map((n) => [`/r/${n}.md`, doc(n)])),
  '/r/sub/E.md': doc('E'),
  '/r/.cache/kept.md': doc('kept'),
};
const SETS = 'proposals = { sets = true }\n';

const places = async (page, mod) => {
  await page.keyboard.press(`${mod}+Shift+E`);
  await drawerShows(page, 'places');
};
const row = (page, key) => page.locator(`.marxy-drawer .marxy-l-prow[data-marxy-left-row="${key}"]`);
const blur = (page) => page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
const cur = (page) => page.evaluate(() => document.querySelector('.marxy-drawer .marxy-l-prow.marxy-l-cur')?.dataset.marxyLeftRow ?? null);
/** Moves the panel cursor with j until it rests on row `k` (the keys must be in the panel). */
async function goRow(page, k) {
  for (let i = 0; i < 60 && (await cur(page)) !== k; i++) await page.keyboard.press('j');
  assert.equal(await cur(page), k, `the cursor reaches ${k}`);
}
/** An item of the head's + menu. */
const addMenuItem = async (page, title) => {
  await page.click('.marxy-drawer .marxy-l-hb');
  await page.click(`[role="menuitem"]:has-text("${title}")`);
};

test('Places opens on the place of the file in front: folders as a tree, a dot folder dimmed, a row opening its file, the filter narrowing it', async () => {
  await withFrame({ files: FILES, open: ['/r/A.md'] }, async (page, { mod }) => {
    await places(page, mod);
    await row(page, 'f:/r/A.md').waitFor();
    assert.ok(await row(page, 'g:root:/r').count(), "the place's own row heads the tree");
    assert.match(await row(page, 'f:/r/A.md').getAttribute('class'), /marxy-l-at/, 'the file in front is marked');
    // A dot folder is listed, dimmed (the Library's "left out of search" note is not drawn).
    assert.match(await row(page, 'd:/r/.cache').getAttribute('class'), /marxy-l-dim/);
    assert.equal(await row(page, 'f:/r/sub/E.md').count(), 0, 'a folder is closed until it is asked for');
    await row(page, 'd:/r/sub').click();
    await row(page, 'f:/r/sub/E.md').waitFor();
    await row(page, 'f:/r/sub/E.md').click();
    await page.waitForFunction(() => window.__marxyHandle.panes().panes[0].path() === '/r/sub/E.md');
    assert.deepEqual(await rowOf(page), ['A.md', 'E.md*']);
    await page.waitForFunction(() => /marxy-l-at/.test(document.querySelector('.marxy-drawer .marxy-l-prow[data-marxy-left-row="f:/r/sub/E.md"]')?.className ?? ''));
    // The filter field lists files by name across the places.
    await page.fill('.marxy-drawer input[data-marxy-left-field="places-q"]', 'E.md');
    await page.waitForFunction(() => !document.querySelector('.marxy-drawer .marxy-l-prow[data-marxy-left-row="f:/r/A.md"]'));
    assert.deepEqual(await page.$$eval('.marxy-drawer .marxy-l-prow[data-marxy-left-row^="f:"]', (els) => els.map((e) => e.dataset.marxyLeftRow.slice(2))), ['/r/sub/E.md']);
  });
});

test('Sets: the open tabs and what each side shows are saved under a name in frame.json, listed in Places, and forgotten with d', async () => {
  await withFrame({ files: FILES, open: ['/r/A.md', '/r/B.md'], config: SETS }, async (page, { mod }) => {
    await page.evaluate(() => window.__marxyHandle.panes().openIn(0, '/r/C.md'));
    await places(page, mod);
    // The set is named after the first file in the row; there is no name field to fill.
    await addMenuItem(page, 'Save the open tabs as a set');
    assert.deepEqual((await savedFrame(page)).sets, [{ name: 'A', tabs: ['/r/A.md', '/r/C.md', '/r/B.md'], shown: ['/r/C.md', '/r/B.md'] }]);
    // Sets is a group, folded until it is asked for.
    await row(page, 'g:sets').click();
    await row(page, 's:A').waitFor();
    assert.equal(await row(page, 's:A').locator('.marxy-l-as').textContent(), '3 files · two sides');
    await blur(page);
    await page.keyboard.press('Tab');
    await goRow(page, 's:A');
    await page.keyboard.press('d');
    await row(page, 's:A').waitFor({ state: 'detached' });
    assert.deepEqual((await savedFrame(page)).sets, []);
  });
});

test('Sets: a set kept as each pane\'s own tabs (before one row) opens as one row in order, each side on its last tab', async () => {
  const frame = { sets: [{ name: 'Morning', panes: [['/r/A.md', '/r/C.md'], ['/r/B.md']] }] };
  await withFrame({ files: FILES, open: ['/r/X.md'], frame, config: SETS }, async (page, { mod }) => {
    await places(page, mod);
    await row(page, 'g:sets').click();
    await row(page, 's:Morning').click();
    await page.waitForFunction(() => window.__marxyHandle.panes().panes.length === 2 && window.__marxyHandle.panes().panes[1].path() === '/r/B.md');
    assert.deepEqual(await rowOf(page, 0), ['X.md', 'A.md', 'C.md*', 'B.md']);
    assert.deepEqual(await rowOf(page, 1), ['X.md', 'A.md', 'C.md', 'B.md*']);
    await page.waitForFunction(() => [...document.querySelectorAll('.marxy-notice-text')].some((n) => n.textContent === 'Opened Morning: 3 files'));
  });
});

test('Add a folder… with no picker says why instead of nothing', async () => {
  await withFrame({ files: FILES, open: ['/r/A.md'] }, async (page, { mod }) => {
    await places(page, mod);
    // The browser's shell has no picker: the click is answered, not swallowed.
    await addMenuItem(page, 'Add a folder…');
    await page.waitForFunction(() => [...document.querySelectorAll('.marxy-notice-text')].some((n) => /no folder picker/.test(n.textContent ?? '')));
  });
});

test('Add a folder… (the head\'s + menu) asks for a folder and keeps the one chosen as a place', async () => {
  await withFrame({ files: { ...FILES, '/kept/K.md': doc('K') }, open: ['/r/A.md'] }, async (page, { mod }) => {
    await places(page, mod);
    await page.evaluate(() => {
      window.__marxyHandle.shell.openDialog = async (opts) => (opts?.directory ? ['/kept'] : []);
    });
    await addMenuItem(page, 'Add a folder…');
    await row(page, 'g:root:/kept').waitFor();
    const toml = await page.evaluate(async () => new TextDecoder().decode(await window.__marxyHandle.shell.readFile('/collection.toml')));
    assert.match(toml, /\n\[\[root\]\]\r?\npath = '\/kept'\r?\n$/);
    // A cancelled picker adds nothing and says nothing.
    await page.evaluate(() => {
      window.__marxyHandle.shell.openDialog = async () => [];
    });
    await addMenuItem(page, 'Add a folder…');
    await page.waitForTimeout(300);
    const after = await page.evaluate(async () => new TextDecoder().decode(await window.__marxyHandle.shell.readFile('/collection.toml')));
    assert.equal(after, toml);
  });
});
