// The window's one row of tabs (before it, each pane's own tabs): an open lands
// in a tab of its own, a tab is shown with a press and closed with its button, a middle click or Alt+W, an open in the
// same tab takes its place and Back brings the last one back, and three of 19's proposals: Glance tabs (from
// Places), Pairs across the two panes, and Drag a tab along the row and onto a pane. Playwright WebKit.
import { strict as assert } from 'node:assert';
import { after, test as nodeTest } from 'node:test';
import { closeHarness } from './support/two-pane.mjs';
import { drawerShows, dragTab, marksOf, pathsShown, rowOf, skip, tabsOf, withFrame } from './support/frame.mjs';

const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);
after(() => closeHarness());

const doc = (name) => `# ${name}\n\n${`The ${name} file has words enough to fill a few lines of the page. `.repeat(40)}\n`;
const FILES = Object.fromEntries(['A', 'B', 'C', 'D'].map((n) => [`/r/${n}.md`, doc(n)]));

const openHere = (page, path) => page.evaluate((p) => window.__marxyHandle.open(p), path);
const openIn = (page, slot, path) => page.evaluate(({ slot, path }) => window.__marxyHandle.panes().openIn(slot, path), { slot, path });
const tabSelector = (name) => `.marxy-tabbar .marxy-tab:has(.marxy-tab-name:text-is("${name}"))`;
const notices = (page) => page.evaluate(() => [...document.querySelectorAll('.marxy-notice-text')].map((n) => n.textContent));

test('each open lands in a tab of its own; a press shows a tab, and its button, a middle click or Alt+W close it', async () => {
  await withFrame({ files: FILES, open: ['/r/A.md'] }, async (page) => {
    assert.deepEqual(await rowOf(page), ['A.md*']);
    assert.equal(await page.isVisible(`${tabSelector('A.md')} .marxy-tab-close`), false, 'the one tab of the one pane has no close button');
    await openHere(page, '/r/B.md');
    await openHere(page, '/r/C.md');
    assert.deepEqual(await rowOf(page), ['A.md', 'B.md', 'C.md*']);
    assert.deepEqual(await pathsShown(page), ['/r/C.md']);
    await page.click(`${tabSelector('A.md')} .marxy-tab-open`);
    await page.waitForFunction(() => window.__marxyHandle.panes().panes[0].path() === '/r/A.md');
    assert.deepEqual(await rowOf(page), ['A.md*', 'B.md', 'C.md']);
    // Closing a tab in the background leaves the page alone.
    await page.click(`${tabSelector('C.md')} .marxy-tab-close`);
    assert.deepEqual(await rowOf(page), ['A.md*', 'B.md']);
    assert.deepEqual(await pathsShown(page), ['/r/A.md']);
    await page.click(`${tabSelector('B.md')} .marxy-tab-open`, { button: 'middle' });
    assert.deepEqual(await rowOf(page), ['A.md*']);
    // Closing the tab in front shows its right neighbour, else its left.
    await openHere(page, '/r/B.md');
    await openHere(page, '/r/C.md');
    await page.click(`${tabSelector('A.md')} .marxy-tab-open`);
    await page.waitForFunction(() => window.__marxyHandle.panes().panes[0].path() === '/r/A.md');
    await page.click(`${tabSelector('A.md')} .marxy-tab-close`);
    await page.waitForFunction(() => window.__marxyHandle.panes().panes[0].path() === '/r/B.md');
    assert.deepEqual(await rowOf(page), ['B.md*', 'C.md']);
    await page.click(`${tabSelector('C.md')} .marxy-tab-open`);
    await page.waitForFunction(() => window.__marxyHandle.panes().panes[0].path() === '/r/C.md');
    await page.keyboard.press('Alt+W');
    await page.waitForFunction(() => window.__marxyHandle.panes().panes[0].path() === '/r/B.md');
    assert.deepEqual(await rowOf(page), ['B.md*']);
    await page.keyboard.press('Alt+W');
    await page.waitForFunction(() => [...document.querySelectorAll('.marxy-notice-text')].some((n) => n.textContent.startsWith('This is the last tab')));
    assert.deepEqual(await rowOf(page), ['B.md*']);
  });
});

test('an open in the same tab joins its history: Back and Forward step through it in that tab', async () => {
  await withFrame({ files: FILES, open: ['/r/A.md'] }, async (page) => {
    const steps = () => page.evaluate(() => [...document.querySelectorAll('[data-marxy-head="0"] .marxy-head-step')].map((b) => b.disabled));
    assert.deepEqual(await steps(), [true, true]);
    // What a "this tab" open asks for (frame/intent.ts), as an open from the page itself would.
    await page.evaluate(async () => {
      const { intend } = await import('/src/frame/intent.ts');
      const handle = window.__marxyHandle;
      intend(handle.panes().panes[0].host, '/r/B.md', 'here');
      await handle.open('/r/B.md');
    });
    assert.deepEqual(await rowOf(page), ['B.md*']);
    assert.deepEqual(await steps(), [false, true]);
    await page.click('[data-marxy-head="0"] .marxy-head-step[aria-label="Back"]');
    await page.waitForFunction(() => window.__marxyHandle.panes().panes[0].path() === '/r/A.md');
    assert.deepEqual(await rowOf(page), ['A.md*']);
    assert.deepEqual(await steps(), [true, false]);
    await page.click('[data-marxy-head="0"] .marxy-head-step[aria-label="Forward"]');
    await page.waitForFunction(() => window.__marxyHandle.panes().panes[0].path() === '/r/B.md');
    assert.deepEqual(await rowOf(page), ['B.md*']);
    assert.deepEqual(await steps(), [false, true]);
  });
});

test('Glance tabs: a click in Places shows a file in one glance tab, the next click replaces it, and a double click or a scroll keeps it', async () => {
  await withFrame({ files: FILES, open: ['/r/A.md'], config: 'proposals = { glance = true }\n' }, async (page, { mod }) => {
    await page.keyboard.press(`${mod}+Shift+E`);
    await drawerShows(page, 'places');
    const row = (path) => page.locator(`.marxy-drawer .marxy-l-prow[data-marxy-left-row="f:${path}"]`);
    await row('/r/B.md').click();
    await page.waitForFunction(() => window.__marxyHandle.panes().panes[0].path() === '/r/B.md');
    assert.deepEqual(await tabsOf(page), [
      { name: 'A.md', active: false, glance: false, paired: false },
      { name: 'B.md', active: true, glance: true, paired: false },
    ]);
    await row('/r/C.md').click();
    await page.waitForFunction(() => window.__marxyHandle.panes().panes[0].path() === '/r/C.md');
    assert.deepEqual(await rowOf(page), ['A.md', 'C.md*'], 'the glance was replaced, not added to');
    assert.equal((await tabsOf(page))[1].glance, true);
    const glances = () => tabsOf(page).then((t) => t.map((x) => `${x.name}${x.glance ? '~' : ''}`));
    const noGlance = () => page.waitForFunction(() => !document.querySelector('.marxy-tabbar .marxy-tab[data-marxy-glance]'));
    // A double click on the glance tab keeps it.
    await page.dblclick(`${tabSelector('C.md')} .marxy-tab-open`);
    await noGlance();
    await row('/r/D.md').click();
    await page.waitForFunction(() => window.__marxyHandle.panes().panes[0].path() === '/r/D.md');
    assert.deepEqual(await glances(), ['A.md', 'C.md', 'D.md~']);
    // Scrolling it keeps it: it is being read.
    await page.mouse.move(700, 500);
    await page.mouse.wheel(0, 200);
    await noGlance();
    await row('/r/B.md').click();
    await page.waitForFunction(() => window.__marxyHandle.panes().panes[0].path() === '/r/B.md');
    assert.deepEqual(await glances(), ['A.md', 'C.md', 'D.md', 'B.md~']);
    // A double click on its row in Places keeps it.
    await row('/r/B.md').dblclick();
    await noGlance();
    assert.deepEqual(await rowOf(page), ['A.md', 'C.md', 'D.md', 'B.md*']);
  });
});

test('without Glance tabs a click in Places opens a kept tab', async () => {
  await withFrame({ files: FILES, open: ['/r/A.md'] }, async (page, { mod }) => {
    await page.keyboard.press(`${mod}+Shift+E`);
    await drawerShows(page, 'places');
    await page.locator('.marxy-drawer .marxy-l-prow[data-marxy-left-row="f:/r/B.md"]').click();
    await page.waitForFunction(() => window.__marxyHandle.panes().panes[0].path() === '/r/B.md');
    await page.locator('.marxy-drawer .marxy-l-prow[data-marxy-left-row="f:/r/C.md"]').click();
    await page.waitForFunction(() => window.__marxyHandle.panes().panes[0].path() === '/r/C.md');
    assert.deepEqual(await tabsOf(page).then((t) => t.map((x) => `${x.name}${x.glance ? '~' : ''}`)), ['A.md', 'B.md', 'C.md']);
  });
});

test('Pairs: a tab remembers what the other pane showed, and returning to it brings that back', async () => {
  await withFrame({ files: FILES, open: ['/r/A.md', '/r/B.md'] }, async (page) => {
    assert.deepEqual(await tabsOf(page), [
      { name: 'A.md', active: true, glance: false, paired: true },
      { name: 'B.md', active: false, glance: false, paired: true },
    ]);
    assert.deepEqual(await marksOf(page), ['A.md*', 'B.md+'], 'the left pane\'s tab is current, the right\'s visible');
    // D lands on the right beside A, then C on the left beside D: B still remembers A.
    await openIn(page, 1, '/r/D.md');
    await openIn(page, 0, '/r/C.md');
    assert.deepEqual(await rowOf(page, 0), ['A.md', 'C.md*', 'B.md', 'D.md']);
    assert.deepEqual(await rowOf(page, 1), ['A.md', 'C.md', 'B.md', 'D.md*']);
    assert.deepEqual(await pathsShown(page), ['/r/C.md', '/r/D.md']);
    // B pressed with the right pane focused shows there, and brings A back beside it.
    await page.evaluate(() => window.__marxyHandle.panes().focus(window.__marxyHandle.panes().panes[1]));
    await page.click(`${tabSelector('B.md')} .marxy-tab-open`);
    await page.waitForFunction(() => window.__marxyHandle.panes().panes.map((p) => p.path()).join() === '/r/A.md,/r/B.md');
    assert.deepEqual(await marksOf(page), ['A.md+', 'C.md', 'B.md*', 'D.md']);
    assert.equal(await page.evaluate(() => window.__marxyHandle.panes().focused.slot), 1, 'focus stays with the tab pressed');
  });
});

test('Drag a tab: along the row to reorder it, onto a pane to show it there', async () => {
  await withFrame({ files: FILES, open: ['/r/A.md', '/r/D.md'] }, async (page) => {
    await openIn(page, 0, '/r/B.md');
    await openIn(page, 0, '/r/C.md');
    assert.deepEqual(await rowOf(page, 0), ['A.md', 'B.md', 'C.md*', 'D.md']);
    assert.equal(await page.getAttribute(tabSelector('A.md'), 'draggable'), 'true');
    await dragTab(page, 2, { tab: 0 });
    await page.waitForFunction(() => document.querySelector('.marxy-tabbar .marxy-tab .marxy-tab-name')?.textContent === 'C.md');
    assert.deepEqual(await rowOf(page, 0), ['C.md*', 'A.md', 'B.md', 'D.md']);
    assert.deepEqual(await pathsShown(page), ['/r/C.md', '/r/D.md'], 'reordering opens nothing');
    // Onto the other pane's page: that pane shows it, and the row keeps one tab for it.
    await dragTab(page, 1, { slot: 1 });
    await page.waitForFunction(() => window.__marxyHandle.panes().panes[1].path() === '/r/A.md');
    assert.deepEqual(await rowOf(page, 1), ['C.md', 'A.md*', 'B.md', 'D.md']);
    // Closing a tab no pane shows leaves the panes alone; closing one a pane shows moves that pane to its neighbour.
    assert.deepEqual(await pathsShown(page), ['/r/C.md', '/r/A.md'], 'a drop places one tab; its pair stays where it is');
    await page.click(`${tabSelector('D.md')} .marxy-tab-close`);
    await page.waitForFunction(() => document.querySelectorAll('.marxy-tabbar .marxy-tab').length === 3);
    assert.deepEqual(await pathsShown(page), ['/r/C.md', '/r/A.md']);
    await page.click(`${tabSelector('A.md')} .marxy-tab-close`);
    await page.waitForFunction(() => window.__marxyHandle.panes().panes.map((p) => p.path()).join() === '/r/C.md,/r/B.md');
    assert.deepEqual(await rowOf(page, 0), ['C.md*', 'B.md']);
    // A pane whose next tab is what the other pane already shows closes instead.
    await page.click(`${tabSelector('B.md')} .marxy-tab-close`);
    await page.waitForFunction(() => window.__marxyHandle.panes().panes.length === 1);
    assert.deepEqual(await pathsShown(page), ['/r/C.md']);
    assert.deepEqual(await rowOf(page), ['C.md*']);
  });
});

test('closing the current tab over unsaved edits: Dismiss keeps the tab, Open without saving closes it', async () => {
  const files = { ...FILES, '/r/T.md': '# T\n\n- [ ] one\n- [ ] two\n' };
  await withFrame({ files, open: ['/r/A.md'] }, async (page) => {
    await openHere(page, '/r/T.md');
    assert.deepEqual(await rowOf(page), ['A.md', 'T.md*']);
    await page.evaluate(() => {
      window.__marxyHandle.panes().panes[0].article.querySelector('input[type=checkbox]').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await page.waitForFunction(() => window.__marxyHandle.panes().panes[0].content.hasUnsavedChanges());
    const button = (label) => page.evaluate((l) => [...document.querySelectorAll('#marxy-notices .marxy-notice button')].find((b) => b.textContent === l)?.click(), label);
    const asked = () => page.waitForFunction(() => [...document.querySelectorAll('#marxy-notices .marxy-notice button')].some((b) => b.textContent === 'Open without saving'));
    await page.click(`${tabSelector('T.md')} .marxy-tab-close`);
    await asked();
    await button('Dismiss');
    await page.waitForTimeout(200);
    assert.deepEqual(await pathsShown(page), ['/r/T.md']);
    assert.deepEqual(await rowOf(page), ['A.md', 'T.md*'], 'a dismissed close keeps the tab');
    await page.click(`${tabSelector('T.md')} .marxy-tab-close`);
    await asked();
    await button('Open without saving');
    await page.waitForFunction(() => window.__marxyHandle.panes().panes[0].path() === '/r/A.md');
    await page.waitForFunction(() => document.querySelectorAll('.marxy-tabbar .marxy-tab').length === 1);
    assert.deepEqual(await rowOf(page), ['A.md*'], 'the closed tab leaves the row once the reader has answered');
  });
});
