// The rail and the drawer of the left section: the rail of eight panels with Look and
// Settings at its foot, each panel drawn in the drawer by a press or its chord, the drawer docked beside the page or
// lying over it, the fold and its peek, and Mod+Alt+B. These replace the retired sidebar and status bar tests.
// Playwright WebKit.
import { strict as assert } from 'node:assert';
import { after, test as nodeTest } from 'node:test';
import { closeHarness } from './support/two-pane.mjs';
import { drawerShows, frameNow, savedFrame, skip, withFrame } from './support/frame.mjs';

const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);
after(() => closeHarness());

const DOC = '/r/plan.md';
const FILES = {
  [DOC]: '# The plan\n\nA paragraph to read.\n\n## First\n\nMore words here.\n\n## Second\n\nAnd the end.\n',
  '/r/notes.md': '# Notes\n\nA second file.\n',
};

/** The rail's panels top to bottom, with the name the drawer's head carries. */
const PANELS = [
  ['places', 'Places'], ['metadata', 'Metadata'], ['outline', 'Outline'], ['links', 'Links'],
  ['search', 'Search'], ['transforms', 'Transforms'], ['export', 'Export'], ['versions', 'Versions'],
];

const blur = (page) => page.evaluate(() => document.activeElement?.blur());
const notices = (page) => page.evaluate(() => [...document.querySelectorAll('.marxy-notice-text')].map((n) => n.textContent));
const railButton = (id) => `.marxy-rail .marxy-l-rb[data-marxy-left="${id}"]`;

test('the rail holds the eight panels, Look and Settings; a press draws each panel in the drawer, and a second press shuts it to the rail', async () => {
  await withFrame({ files: FILES, open: [DOC] }, async (page) => {
    const rail = await page.evaluate(() => [...document.querySelectorAll('.marxy-rail button')].map((b) => ({ id: b.dataset.marxyLeft ?? null, label: b.getAttribute('aria-label') })));
    assert.deepEqual(rail.map((b) => b.id), [...PANELS.map(([id]) => id), 'look', 'settings'], 'the rail has no fold button, only the panels');
    assert.deepEqual(rail.map((b) => b.label), [...PANELS.map(([, name]) => name), 'Look', 'Settings']);
    assert.deepEqual(await frameNow(page), { frame: 'unfolded', drawer: 'docked', left: 'open', panel: 'places', branch: null, pressed: ['places'] }, 'the window opens with Places docked beside the page');
    for (const [id, name] of PANELS) {
      // The shown panel's own icon shuts the drawer, so where the panel is already the shown one, shut it first.
      if ((await frameNow(page)).panel === id) {
        await page.click(railButton(id));
        await drawerShows(page, null);
      }
      await page.click(railButton(id));
      await drawerShows(page, id);
      assert.deepEqual(await frameNow(page), { frame: 'unfolded', drawer: 'docked', left: 'open', panel: id, branch: null, pressed: [id] });
      assert.equal(await page.textContent('.marxy-drawer .marxy-l-head b'), name);
      await page.waitForSelector('.marxy-drawer .marxy-l-body > *', { state: 'attached' });
      await page.click(railButton(id));
      await drawerShows(page, null);
      assert.deepEqual(await frameNow(page), { frame: 'unfolded', drawer: 'closed', left: 'rail', panel: id, branch: null, pressed: [] }, 'the second press shuts the drawer to the rail');
    }
    // Settings hosts the rail's branch; its icon again goes back to the panel. Look is the Studio.
    await page.click(railButton('settings'));
    await drawerShows(page, 'settings');
    assert.deepEqual((await frameNow(page)).pressed, ['settings']);
    await page.click(railButton('settings'));
    await drawerShows(page, PANELS.at(-1)[0]);
    await page.click(railButton('look'));
    await page.waitForSelector('dialog.marxy-studio[open]');
    await page.keyboard.press('Escape');
    await page.waitForSelector('dialog.marxy-studio', { state: 'detached' });
    await drawerShows(page, PANELS.at(-1)[0]);
    assert.ok(!(await notices(page)).some((n) => /could not be/.test(n)), 'every panel loaded and drew');
  });
});

test("each panel's Alt+n and kept chord shows it; Look, Clip and Settings chords toggle; Mod+B steps the left and frame.json keeps it", async () => {
  await withFrame({ files: FILES, open: [DOC] }, async (page, { mod }) => {
    // Places shows at the start: Alt+1 on it shuts the drawer to the rail, and again shows it.
    await blur(page);
    await page.keyboard.press('Alt+1');
    await drawerShows(page, null);
    for (const [n, [id]] of PANELS.entries()) {
      await blur(page);
      await page.keyboard.press(`Alt+${n + 1}`);
      await drawerShows(page, id);
      // Places is the default, so pressing it first writes nothing.
      if (id !== 'places') assert.equal((await savedFrame(page)).leftPanel, id, 'the panel is kept');
    }
    // The kept chords show their panel; pressed again they stay (only Alt and its number toggle).
    for (const [chord, id] of [['Shift+E', 'places'], ['Alt+R', 'transforms'], ['Alt+V', 'versions'], ['Shift+F', 'search']]) {
      await blur(page);
      await page.keyboard.press(`${mod}+${chord}`);
      await drawerShows(page, id);
      await page.keyboard.press(`${mod}+${chord}`);
      await drawerShows(page, id);
    }
    // Search's field has the focus after its chord.
    await page.waitForFunction(() => document.activeElement?.tagName === 'INPUT' && document.activeElement.closest('.marxy-drawer'));
    // Look's chord opens the Studio; Clip and Settings toggle their branch, the second press back to the panel.
    await blur(page);
    await page.keyboard.press(`${mod}+Alt+T`);
    await page.waitForSelector('dialog.marxy-studio[open]');
    await page.keyboard.press('Escape');
    await page.waitForSelector('dialog.marxy-studio', { state: 'detached' });
    for (const [chord, id] of [['Alt+C', 'clip'], [',', 'settings']]) {
      await blur(page);
      await page.keyboard.press(`${mod}+${chord}`);
      await drawerShows(page, id);
      await blur(page);
      await page.keyboard.press(`${mod}+${chord}`);
      await drawerShows(page, 'search');
    }
    // Mod+B is the left's on the page (Bold is a text field's and Source's own): open, the rail, hidden, open.
    await blur(page);
    await page.keyboard.press(`${mod}+b`);
    await drawerShows(page, null);
    assert.equal((await savedFrame(page)).leftMode, 'rail');
    await page.keyboard.press(`${mod}+b`);
    await page.waitForFunction(() => document.body.getAttribute('data-marxy-left') === 'hidden');
    assert.equal((await savedFrame(page)).leftMode, 'hidden');
    await page.keyboard.press(`${mod}+b`);
    await drawerShows(page, 'search');
    // Docked, Escape on the page leaves the drawer where it is.
    await blur(page);
    await page.keyboard.press('Escape');
    assert.deepEqual([(await frameNow(page)).panel, (await frameNow(page)).drawer], ['search', 'docked']);
    const saved = await savedFrame(page);
    assert.deepEqual([saved.leftPanel, saved.leftMode], ['search', 'open']);
  });
});

test('in a narrow window the drawer lies over the page: Escape or a press on the page shuts it, and the rail stays', async () => {
  await withFrame({ files: FILES, open: [DOC], viewport: { width: 760, height: 800 } }, async (page, { mod }) => {
    assert.deepEqual(await frameNow(page), { frame: 'unfolded', drawer: 'closed', left: 'open', panel: 'places', branch: null, pressed: [] }, 'no room for a docked drawer beside the page');
    assert.equal(await page.isVisible('.marxy-rail'), true);
    await page.click(railButton('places'));
    await drawerShows(page, 'places');
    assert.equal((await frameNow(page)).drawer, 'over');
    await blur(page);
    await page.keyboard.press('Escape');
    await drawerShows(page, null);
    await blur(page);
    await page.keyboard.press(`${mod}+Alt+C`);
    await drawerShows(page, 'clip');
    assert.equal((await frameNow(page)).drawer, 'over');
    await page.click('#doc p', { position: { x: 300, y: 4 } });
    await drawerShows(page, null);
    assert.equal(await page.isVisible('.marxy-rail'), true);
    // Widened, the drawer docks again: being shut over the page is not a setting.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForFunction(() => document.body.getAttribute('data-marxy-drawer') === 'docked');
  });
});

test('the fold leaves the page alone; Mod+\\ or the quiet button brings the frame back as it was, and the left edge peeks', async () => {
  await withFrame({ files: FILES, open: [DOC] }, async (page, { mod }) => {
    await page.click(railButton('versions'));
    await drawerShows(page, 'versions');
    // The rail has no fold button now: the fold is Mod+\ or the frame's own command.
    assert.equal(await page.locator('.marxy-rail-fold').count(), 0);
    await page.evaluate(() => window.__marxyHandle.frame().fold());
    await page.waitForFunction(() => document.body.getAttribute('data-marxy-frame') === 'folded');
    assert.deepEqual(await frameNow(page), { frame: 'folded', drawer: 'closed', left: 'open', panel: 'versions', branch: null, pressed: [] });
    assert.equal(await page.isVisible('.marxy-rail'), false);
    assert.ok((await notices(page)).some((n) => n.startsWith('The page alone')), 'the fold says how to come back');
    assert.equal((await savedFrame(page)).folded, true);
    // Held at the left edge, the pointer peeks the rail and the drawer on the panel it last showed.
    await page.mouse.move(400, 300);
    await page.mouse.move(0, 300);
    await page.waitForFunction(() => document.body.getAttribute('data-marxy-peek') === 'left');
    assert.equal(await page.isVisible('.marxy-rail'), true);
    await page.waitForFunction(() => document.querySelector('.marxy-drawer')?.dataset.marxyLeft === 'versions');
    await page.mouse.move(900, 300);
    await page.waitForFunction(() => !document.body.hasAttribute('data-marxy-peek'));
    await blur(page);
    await page.keyboard.press(`${mod}+Backslash`);
    await page.waitForFunction(() => document.body.getAttribute('data-marxy-frame') === 'unfolded');
    await drawerShows(page, 'versions');
    await page.keyboard.press(`${mod}+Backslash`);
    await page.waitForFunction(() => document.body.getAttribute('data-marxy-frame') === 'folded');
    // The quiet button wakes with the pointer near the page.
    await page.mouse.move(700, 20);
    await page.click('.marxy-quiet');
    await page.waitForFunction(() => document.body.getAttribute('data-marxy-frame') === 'unfolded');
    assert.equal((await savedFrame(page)).folded, false);
  });
});

test('Mod+Alt+B shows Metadata, and with Metadata shown sets the rail; the mode is kept in frame.json', async () => {
  await withFrame({ files: FILES, open: [DOC] }, async (page, { mod }) => {
    await blur(page);
    await page.keyboard.press(`${mod}+Alt+B`);
    await drawerShows(page, 'metadata');
    assert.equal((await savedFrame(page)).leftPanel, 'metadata');
    await blur(page);
    await page.keyboard.press(`${mod}+Alt+B`);
    await drawerShows(page, null);
    await page.waitForFunction(() => document.body.getAttribute('data-marxy-left') === 'rail');
    assert.equal((await savedFrame(page)).leftMode, 'rail');
    await page.keyboard.press(`${mod}+Alt+B`);
    await drawerShows(page, 'metadata');
    assert.equal((await savedFrame(page)).leftMode, 'open');
  });
});

const peekNow = (page) => page.evaluate(() => document.body.getAttribute('data-marxy-peek'));
const settle = (page, ms = 350) => page.waitForTimeout(ms);

test('the edge peek is only for a folded frame at rest: not after an unfold, with a menu open, mid-drag, or once the pointer has left', async () => {
  await withFrame({ files: FILES, open: [DOC] }, async (page, { mod }) => {
    const fold = () => page.evaluate(() => window.__marxyHandle.frame().fold());
    // the dwell armed while folded does not outlive an unfold.
    await fold();
    await page.mouse.move(400, 300);
    await page.mouse.move(2, 300);
    await page.evaluate(() => window.__marxyHandle.frame().unfold());
    await settle(page);
    assert.equal(await peekNow(page), null, 'no peek on an unfolded frame');
    // R10-001: a menu open over the page holds the peek back.
    await fold();
    await page.mouse.move(400, 300);
    await page.click('#doc p', { button: 'right' });
    await page.waitForSelector('[role="menu"]');
    await page.mouse.move(2, 300);
    await settle(page);
    assert.equal(await peekNow(page), null, 'no peek beside an open menu');
    await page.keyboard.press('Escape');
    await page.waitForSelector('[role="menu"]', { state: 'detached' });
    // A drag that reaches the edge is not a rest there.
    await page.mouse.move(400, 300);
    await page.mouse.down();
    await page.mouse.move(2, 300);
    await settle(page);
    assert.equal(await peekNow(page), null, 'no peek mid-drag');
    await page.mouse.up();
    // The pointer leaving the window through the edge cancels the dwell.
    await page.mouse.move(400, 300);
    await page.mouse.move(2, 300);
    await page.evaluate(() => document.documentElement.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: null })));
    await settle(page);
    assert.equal(await peekNow(page), null, 'no peek once the pointer has left the window');
    // At rest at the edge it still peeks.
    await page.mouse.move(400, 300);
    await page.mouse.move(2, 300);
    await page.waitForFunction(() => document.body.getAttribute('data-marxy-peek') === 'left');
    await blur(page);
    await page.keyboard.press(`${mod}+Backslash`);
    await page.waitForFunction(() => document.body.getAttribute('data-marxy-frame') === 'unfolded');
    assert.equal(await peekNow(page), null);
  });
});

test('a visit from a narrow window ends when the window widens and the drawer docks', async () => {
  await withFrame({ files: FILES, open: [DOC], viewport: { width: 800, height: 600 } }, async (page) => {
    await page.click(railButton('places'));
    await drawerShows(page, 'places');
    assert.equal((await frameNow(page)).drawer, 'over');
    await page.setViewportSize({ width: 1280, height: 700 });
    await page.waitForFunction(() => document.body.getAttribute('data-marxy-drawer') === 'docked');
    await page.click('#doc p', { position: { x: 200, y: 4 } });
    await page.setViewportSize({ width: 800, height: 600 });
    await page.waitForFunction(() => document.body.getAttribute('data-marxy-drawer') !== 'docked');
    await settle(page, 150);
    assert.equal((await frameNow(page)).drawer, 'closed', 'the drawer does not come back over the page');
  });
});

test('narrowing the window while typing in the docked drawer lays it over the page and keeps the field', async () => {
  await withFrame({ files: FILES, open: [DOC], viewport: { width: 1280, height: 800 } }, async (page) => {
    await drawerShows(page, 'places');
    await page.click('.marxy-drawer input[placeholder="Filter files and folders"]');
    await page.setViewportSize({ width: 800, height: 700 });
    await page.waitForFunction(() => document.body.getAttribute('data-marxy-drawer') !== 'docked');
    assert.equal((await frameNow(page)).drawer, 'over');
    await page.keyboard.type('zz');
    assert.equal(await page.inputValue('.marxy-drawer input[placeholder="Filter files and folders"]'), 'zz');
    assert.equal(await page.evaluate(() => document.activeElement?.closest('.marxy-drawer') !== null), true);
  });
});

test('in a short window the rail scrolls to its foot: Look and Settings stay reachable', async () => {
  await withFrame({ files: FILES, open: [DOC], viewport: { width: 1280, height: 360 } }, async (page) => {
    // A wheel over the rail, as a hand would: a rail that clips does not move.
    await page.mouse.move(20, 200);
    await page.mouse.wheel(0, 600);
    await page.waitForTimeout(200);
    const at = await page.evaluate((sel) => {
      const b = document.querySelector(sel).getBoundingClientRect();
      return { x: b.left + b.width / 2, y: b.top + b.height / 2, bottom: b.bottom };
    }, railButton('settings'));
    assert.ok(at.bottom <= 360, `Settings reachable: bottom ${at.bottom}`);
    await page.mouse.click(at.x, at.y);
    await drawerShows(page, 'settings');
  });
});

test("the drawer foot's hint wraps rather than being cut", async () => {
  await withFrame({ files: FILES, open: [DOC] }, async (page) => {
    await page.click(railButton('search'));
    await drawerShows(page, 'search');
    await page.waitForSelector('.marxy-drawer .marxy-l-foot');
    await page.evaluate(() => document.activeElement?.blur());
    const foot = await page.evaluate(() => {
      const f = document.querySelector('.marxy-drawer .marxy-l-foot');
      return { sw: f.scrollWidth, cw: f.clientWidth, text: f.textContent };
    });
    assert.ok(foot.sw <= foot.cw, `the foot fits: ${foot.sw} > ${foot.cw} for "${foot.text}"`);
  });
});
