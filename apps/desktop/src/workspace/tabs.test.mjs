// The tab row (W-06): the documents opened since the window unfolded, one click apart. The real app on the shipped
// skeleton and CSS over the memory shell, in WebKit (test/support/two-pane.mjs). What it checks is what the reader
// sees: the band, the tabs, the dot, the prompt over unsaved edits, the reading column, and a row that does not
// fit (a narrow window, chrome_size 26, many documents). The list's own rules are tabs.test.ts.
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

const para = (word) => `${word} runs long enough to be a paragraph of the reading column and no more than that. `;
const files = {
  '/r/A.md': `# Alpha\n\n${para('Alpha').repeat(6)}\n\n- [ ] alpha task\n`,
  '/r/B.md': `# Bravo\n\n${para('Bravo').repeat(4)}\n\n- [ ] bravo task\n`,
  '/r/C.md': `# Charlie\n\n${para('Charlie').repeat(4)}\n`,
  '/r/s.py': 'def f():\n    return 1\n',
  '/other/A.md': '# Another A\n\nIn another folder.\n',
  ...Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`/many/note-${String(i).padStart(2, '0')}-with-a-long-name.md`, `# Note ${i}\n\n${para('Note')}\n`])),
};

async function withPage(width, fn, { open = ['/r/A.md'], chrome } = {}) {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await bootTwoPanes(page, { files, open });
    if (chrome) await page.evaluate((px) => document.documentElement.style.setProperty('--marxy-size-chrome', px), chrome);
    await fn(page);
  } finally {
    await browser.close();
  }
}

const unfold = (page) => page.evaluate(() => window.__marxyHandle.workspace().unfold());
const fold = (page) => page.evaluate(() => window.__marxyHandle.workspace().fold());
const settle = (page) => page.evaluate(() => new Promise((r) => setTimeout(r, 80)));
const openFile = async (page, path) => {
  await page.evaluate((p) => window.__marxyHandle.open(p), path);
  await settle(page);
};
const names = (page) => page.evaluate(() => [...document.querySelectorAll('.marxy-tab')].map((t) => t.getAttribute('data-marxy-tab')));

/** The row as drawn: the band, and each tab with what it shows. */
const row = (page) =>
  page.evaluate(() => {
    const region = document.querySelector('[data-marxy-workspace-region="tabs"]');
    if (!region) return null;
    const r = region.getBoundingClientRect();
    return {
      hidden: region.hidden,
      height: Math.round(r.height),
      tabs: [...region.querySelectorAll('.marxy-tab')].map((t) => ({
        path: t.getAttribute('data-marxy-tab'),
        name: t.querySelector('.marxy-tab-name').textContent,
        active: t.hasAttribute('data-marxy-tab-active'),
        shown: t.hasAttribute('data-marxy-tab-shown'),
        selected: t.querySelector('[role=tab]').getAttribute('aria-selected'),
        dot: !t.querySelector('.marxy-tab-dirty').hidden,
        close: !t.querySelector('.marxy-tab-close').hidden,
        label: t.querySelector('[role=tab]').getAttribute('aria-label'),
        glyph: t.querySelector('svg')?.getAttribute('data-marxy-kind') ?? null,
      })),
    };
  });
const paths = (page) => page.evaluate(() => window.__marxyHandle.panes().panes.map((p) => p.path()));
const focusedPath = (page) => page.evaluate(() => window.__marxyHandle.panes().focused.path());
const clickTab = async (page, path) => {
  await page.click(`[data-marxy-tab="${path}"] [role=tab]`);
  await settle(page);
};
const column = (page) =>
  page.evaluate(() => {
    const r = document.getElementById('doc').getBoundingClientRect();
    return { x: r.x, width: r.width };
  });
const tick = (page, slot = 0) =>
  page.evaluate((s) => {
    const article = window.__marxyHandle.panes().panes[s].article;
    article.querySelector('input[type=checkbox]').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  }, slot);
const notice = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('.marxy-notice')].map((n) => ({ text: n.querySelector('.marxy-notice-text')?.textContent, buttons: [...n.querySelectorAll('button')].map((b) => b.textContent) })),
  );
const answer = async (page, label) => {
  await page.evaluate((label) => [...document.querySelectorAll('.marxy-notice button')].find((b) => b.textContent === label).click(), label);
  await settle(page);
};
const buffer = (page, slot = 0) =>
  page.evaluate((s) => new TextDecoder().decode(window.__marxyHandle.panes().panes[s].content.store().snapshot().buffer.bytes), slot);

test('folded there is no tab row; unfolding with one document hides the band; folding forgets the tabs', async () => {
  await withPage(1280, async (page) => {
    assert.equal(await row(page), null, 'folded: no region at all');
    assert.equal(await page.evaluate(() => document.querySelectorAll('.marxy-tabs, .marxy-tab').length), 0);
    await openFile(page, '/r/B.md');
    assert.equal(await row(page), null, 'a document opened while folded is not a tab');
    await unfold(page);
    const one = await row(page);
    assert.equal(one.tabs.length, 1, 'the document on screen is the one tab');
    assert.equal(one.hidden, true, 'one tab: the band is hidden');
    assert.equal(await page.evaluate(() => window.__marxyHandle.workspace().arrangement.tabs), true, 'and the arrangement still says docked');
    await openFile(page, '/r/C.md');
    assert.equal((await row(page)).hidden, false);
    await fold(page);
    assert.equal(await row(page), null);
    assert.equal(await page.evaluate(() => document.querySelectorAll('.marxy-tabs, .marxy-tab').length), 0);
    await unfold(page);
    assert.deepEqual(await names(page), ['/r/C.md'], 'folding forgot the tab list: only the document on screen');
  }, { open: ['/r/A.md'] });
});

test('two documents opened one after the other: two tabs, the second active; clicking the first shows it in the focused pane and checks it', async () => {
  await withPage(1280, async (page) => {
    await unfold(page);
    await openFile(page, '/r/B.md');
    let shown = await row(page);
    assert.deepEqual(shown.tabs.map((t) => [t.name, t.active, t.selected, t.glyph]), [['A.md', false, 'false', 'report'], ['B.md', true, 'true', 'report']]);
    assert.equal(shown.hidden, false);
    assert.equal(shown.height, 34, 'two tabs: the band is 34 px');
    await clickTab(page, '/r/A.md');
    assert.deepEqual(await paths(page), ['/r/A.md']);
    shown = await row(page);
    assert.deepEqual(shown.tabs.map((t) => [t.name, t.active, t.selected]), [['A.md', true, 'true'], ['B.md', false, 'false']]);
    // A third document opens to the right of the tab the reader was on, not at the end.
    await openFile(page, '/r/C.md');
    assert.deepEqual((await row(page)).tabs.map((t) => t.name), ['A.md', 'C.md', 'B.md']);
    // Opening a path that has a tab focuses that tab: no second one.
    await openFile(page, '/r/B.md');
    assert.deepEqual((await row(page)).tabs.map((t) => [t.name, t.active]), [['A.md', false], ['C.md', false], ['B.md', true]]);
    // A code file gets the code glyph; each tab is named by its file and folder.
    await openFile(page, '/r/s.py');
    await openFile(page, '/other/A.md');
    const last = (await row(page)).tabs;
    assert.equal(last.find((t) => t.name === 's.py').glyph, 'code');
    assert.equal(last.find((t) => t.path === '/other/A.md').label, 'A.md, in other');
    assert.equal(last.find((t) => t.path === '/r/A.md').label, 'A.md, in r', 'two files of one name are told apart by their folders');
  });
});

test('a document the reader refused to leave gets no tab, and Cancel leaves the pane, the buffer and the row as they were', async () => {
  await withPage(1280, async (page) => {
    await unfold(page);
    await openFile(page, '/r/B.md');
    await tick(page);
    await settle(page);
    const before = { row: await row(page), buffer: await buffer(page), paths: await paths(page) };
    assert.equal(before.row.tabs.find((t) => t.name === 'B.md').dot, true, 'the dot shows B has unsaved edits');
    // Opening over it (the palette's way) asks; Dismiss refuses: no tab for C.
    await page.evaluate(() => { window.__opening = window.__marxyHandle.open('/r/C.md'); });
    await page.waitForFunction(() => document.querySelector('.marxy-notice') !== null);
    assert.deepEqual((await notice(page))[0].buttons.slice(0, 3), ['Save and open', 'Open without saving', 'Dismiss']);
    await answer(page, 'Dismiss');
    assert.deepEqual(await names(page), ['/r/A.md', '/r/B.md'], 'no tab for C');
    // Clicking a tab asks exactly as an open does; Dismiss is Cancel.
    await clickTab(page, '/r/A.md');
    assert.equal((await notice(page)).length, 1, 'clicking another tab over unsaved edits asks');
    await answer(page, 'Dismiss');
    const after = { row: await row(page), buffer: await buffer(page), paths: await paths(page) };
    assert.deepEqual(after, before, 'Cancel changes nothing');
    // Discard shows the other document; the edit is not kept off screen.
    await clickTab(page, '/r/A.md');
    await answer(page, 'Open without saving');
    assert.deepEqual(await paths(page), ['/r/A.md']);
    const next = await row(page);
    assert.deepEqual(next.tabs.map((t) => [t.name, t.active, t.dot]), [['A.md', true, false], ['B.md', false, false]]);
    await clickTab(page, '/r/B.md');
    assert.match(await buffer(page), /- \[ \] bravo task/, 'B comes back as it is on disk: the discarded edit is gone, not parked in the tab');
    assert.equal((await notice(page)).length, 0);
  });
});

test('Save and open writes the edit and then shows the clicked tab', async () => {
  await withPage(1280, async (page) => {
    await unfold(page);
    await openFile(page, '/r/B.md');
    await tick(page);
    await settle(page);
    await clickTab(page, '/r/A.md');
    await answer(page, 'Save and open');
    assert.deepEqual(await paths(page), ['/r/A.md']);
    assert.match(await page.evaluate(() => window.__marxyHandle.shell.readFile('/r/B.md').then((b) => new TextDecoder().decode(b))), /- \[x\] bravo task/);
  });
});

test('geometry: one tab hides the band and leaves the reading column where it was; two tabs make it 34 px and move the column\'s left edge and width not at all', async () => {
  await withPage(1280, async (page) => {
    const folded = await column(page);
    await unfold(page);
    await settle(page);
    const one = await column(page);
    assert.equal((await row(page)).hidden, true);
    assert.equal(one.x, folded.x, 'the column\'s left edge is the folded one');
    assert.equal(one.width, folded.width);
    const top = await page.evaluate(() => document.getElementById('doc').getBoundingClientRect().top);
    await openFile(page, '/r/B.md');
    const two = await column(page);
    assert.equal(two.x, one.x, 'two tabs: the left edge is unmoved');
    assert.equal(two.width, one.width);
    const r = await row(page);
    assert.equal(r.height, 34);
    const lower = await page.evaluate(() => document.getElementById('doc').getBoundingClientRect().top);
    assert.equal(Math.round(lower - top), 34, 'the band takes its 34 px from above the text only');
  });
});

test('closing the active tab shows its neighbour there; the last tab has no close button; a scratch tab is gone when the pane shows another document', async () => {
  await withPage(1280, async (page) => {
    await unfold(page);
    await openFile(page, '/r/B.md');
    await openFile(page, '/r/C.md');
    let shown = await row(page);
    assert.deepEqual(shown.tabs.map((t) => t.close), [true, true, true]);
    // Close B (not the one on screen): forgotten, nothing else moves.
    await page.click('[data-marxy-tab="/r/B.md"] .marxy-tab-close');
    await settle(page);
    assert.deepEqual(await names(page), ['/r/A.md', '/r/C.md']);
    assert.deepEqual(await paths(page), ['/r/C.md']);
    // Close C (the one on screen): its neighbour, A, takes its place in the pane.
    await page.click('[data-marxy-tab="/r/C.md"] .marxy-tab-close');
    await settle(page);
    assert.deepEqual(await paths(page), ['/r/A.md']);
    shown = await row(page);
    assert.deepEqual(shown.tabs.map((t) => [t.name, t.active, t.close]), [['A.md', true, false]], 'the last tab has no close button');
    assert.equal(shown.hidden, true, 'and below two tabs the band goes');
    // A scratch document is a tab only while a pane shows it.
    await openFile(page, '/r/B.md');
    await page.evaluate(() => window.__marxyHandle.openScratch('# Scratch\n\nSome text.\n'));
    await settle(page);
    shown = await row(page);
    assert.deepEqual(shown.tabs.map((t) => t.name), ['A.md', 'B.md', 'Untitled']);
    await openFile(page, '/r/A.md');
    await settle(page);
    assert.deepEqual((await row(page)).tabs.map((t) => t.name), ['A.md', 'B.md'], 'the scratch tab went when the pane showed A');
  });
});

test('closing a tab over unsaved edits asks first; Dismiss keeps the tab', async () => {
  await withPage(1280, async (page) => {
    await unfold(page);
    await openFile(page, '/r/B.md');
    await tick(page);
    await settle(page);
    await page.click('[data-marxy-tab="/r/B.md"] .marxy-tab-close');
    await settle(page);
    assert.equal((await notice(page)).length, 1, 'the close asks, as opening over the document does');
    await answer(page, 'Dismiss');
    assert.deepEqual(await names(page), ['/r/A.md', '/r/B.md']);
    assert.deepEqual(await paths(page), ['/r/B.md']);
    await page.click('[data-marxy-tab="/r/B.md"] .marxy-tab-close');
    await answer(page, 'Open without saving');
    assert.deepEqual(await names(page), ['/r/A.md']);
    assert.deepEqual(await paths(page), ['/r/A.md']);
  });
});

test('two panes on two paths: both tabs are marked as shown, only the focused pane\'s is active; Open beside gives the new document a tab', async () => {
  await withPage(1470, async (page) => {
    await unfold(page);
    await page.evaluate(() => window.__marxyHandle.open('/r/B.md', { target: 'other' }));
    await settle(page);
    assert.deepEqual(await paths(page), ['/r/A.md', '/r/B.md']);
    let shown = await row(page);
    assert.deepEqual(shown.tabs.map((t) => [t.name, t.shown, t.active]), [['A.md', true, false], ['B.md', true, true]]);
    assert.equal(shown.tabs[0].label, 'A.md, in r, shown in the other pane');
    await page.evaluate(() => { const p = window.__marxyHandle.panes(); p.focus(p.panes[0]); });
    await settle(page);
    shown = await row(page);
    assert.deepEqual(shown.tabs.map((t) => [t.name, t.shown, t.active]), [['A.md', true, true], ['B.md', true, false]]);
    // Clicking the tab of the other pane's document focuses that pane; it does not show the document twice.
    await clickTab(page, '/r/B.md');
    assert.deepEqual(await paths(page), ['/r/A.md', '/r/B.md']);
    assert.equal(await page.evaluate(() => window.__marxyHandle.panes().focused.path()), '/r/B.md');
    // A document opened beside while the other pane keeps focus (a link followed beside) still gets its tab.
    await page.evaluate(() => window.__marxyHandle.open('/r/C.md', { target: 'other', focus: 'stay' }));
    await settle(page);
    assert.deepEqual((await row(page)).tabs.map((t) => t.name), ['A.md', 'B.md', 'C.md']);
    // Closing the focused pane's tab opens a neighbour that the other pane is not already showing.
    const focused = await focusedPath(page);
    await page.click(`[data-marxy-tab="${focused}"] .marxy-tab-close`);
    await settle(page);
    const now = await paths(page);
    assert.notEqual(now[0], now[1], 'the two panes do not end up on one document');
  });
});

test('a Save As moves the tab with its document and the tab keeps its place; a scratch document saved becomes the file\'s tab', async () => {
  await withPage(1280, async (page) => {
    await unfold(page);
    await openFile(page, '/r/B.md');
    await openFile(page, '/r/C.md');
    const saveAs = (path) =>
      page.evaluate((p) => {
        const h = window.__marxyHandle;
        h.shell.queueSaveDialog(p);
        return h.panes().focused.content.save({ as: true });
      }, path);
    assert.equal(await saveAs('/r/C-copy.md'), 'saved');
    await settle(page);
    assert.deepEqual(await names(page), ['/r/A.md', '/r/B.md', '/r/C-copy.md'], 'no tab for the new path beside one for the old');
    assert.equal((await row(page)).tabs[2].active, true);
    await page.evaluate(() => window.__marxyHandle.openScratch('# Scratch\n\nSome text.\n'));
    await settle(page);
    assert.equal((await row(page)).tabs.at(-1).name, 'Untitled');
    assert.equal(await saveAs('/r/fresh.md'), 'saved');
    await settle(page);
    assert.deepEqual(await names(page), ['/r/A.md', '/r/B.md', '/r/C-copy.md', '/r/fresh.md']);
    await clickTab(page, '/r/A.md');
    await clickTab(page, '/r/fresh.md');
    assert.equal(await focusedPath(page), '/r/fresh.md', 'and the saved scratch document is a tab that opens again');
  });
});

test('every tab has an accessible name; Tab reaches the row once, arrows move within it, Return activates, Delete closes', async () => {
  await withPage(1280, async (page) => {
    await unfold(page);
    await openFile(page, '/r/B.md');
    await openFile(page, '/r/C.md');
    const named = await page.evaluate(() => [...document.querySelectorAll('.marxy-tab button')].map((b) => (b.getAttribute('aria-label') ?? '').trim()));
    assert.equal(named.length, 6);
    assert.ok(named.every((n) => n !== ''), named.join('|'));
    assert.equal(await page.evaluate(() => document.querySelector('.marxy-tabs').getAttribute('role')), 'tablist');
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('[role=tab]')].map((t) => t.tabIndex)), [-1, -1, 0], 'one tab stop: the active tab');
    const label = () => page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.tagName);
    // From the toolbar's last control, Tab goes to the row; the next Tab leaves it.
    await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); document.querySelector('.marxy-toolbar [tabindex="0"]')?.focus(); });
    await page.keyboard.press('End');
    await page.keyboard.press('Tab');
    assert.equal(await label(), 'C.md, in r', 'the first Tab after the toolbar reaches the row, on the active tab');
    await page.keyboard.press('ArrowLeft');
    assert.equal(await label(), 'B.md, in r');
    await page.keyboard.press('Home');
    assert.equal(await label(), 'A.md, in r');
    await page.keyboard.press('ArrowLeft');
    assert.equal(await label(), 'C.md, in r', 'the row wraps');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement?.closest('.marxy-tabs') === null), true, 'the next Tab leaves the row');
    await page.keyboard.press('Shift+Tab');
    assert.equal(await label(), 'C.md, in r', 'Shift+Tab comes back to the tab it left');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('Enter');
    await settle(page);
    assert.deepEqual(await paths(page), ['/r/B.md'], 'Return shows the tab');
    assert.equal(await label(), 'B.md, in r', 'and focus stays in the row');
    await page.keyboard.press('Delete');
    await settle(page);
    assert.deepEqual(await names(page), ['/r/A.md', '/r/C.md'], 'Delete closes the tab with focus');
    assert.equal(await page.evaluate(() => document.activeElement?.closest('.marxy-tabs') !== null), true, 'focus stays in the row');
  });
});

test('tab.next, tab.previous and tab.close are palette commands, there only with two tabs or more', async () => {
  await withPage(1280, async (page) => {
    const state = () =>
      page.evaluate(async () => {
        const { commands } = await import('/src/commands/index.ts');
        const { buildAppContext } = await import('/src/selection/bind.ts');
        const ctx = buildAppContext(window.__marxyHandle);
        return Object.fromEntries(commands().filter((c) => c.id.startsWith('tab.')).map((c) => [c.id, c.when(ctx)]));
      });
    const run = (id) =>
      page.evaluate(async (id) => {
        const { commands } = await import('/src/commands/index.ts');
        const { buildAppContext } = await import('/src/selection/bind.ts');
        await commands().find((c) => c.id === id).run(buildAppContext(window.__marxyHandle));
      }, id);
    assert.deepEqual(await state(), { 'tab.next': false, 'tab.previous': false, 'tab.close': false }, 'folded');
    await unfold(page);
    assert.deepEqual(await state(), { 'tab.next': false, 'tab.previous': false, 'tab.close': false }, 'one tab');
    await openFile(page, '/r/B.md');
    await openFile(page, '/r/C.md');
    assert.deepEqual(await state(), { 'tab.next': true, 'tab.previous': true, 'tab.close': true });
    await run('tab.next');
    await settle(page);
    assert.equal(await focusedPath(page), '/r/A.md', 'next from the last wraps to the first');
    await run('tab.previous');
    await settle(page);
    assert.equal(await focusedPath(page), '/r/C.md');
    await run('tab.close');
    await settle(page);
    assert.deepEqual(await names(page), ['/r/A.md', '/r/B.md']);
    assert.equal(await focusedPath(page), '/r/B.md', 'closing C shows its left neighbour: it has no right one');
    await fold(page);
    assert.deepEqual(await state(), { 'tab.next': false, 'tab.previous': false, 'tab.close': false }, 'folded again');
  });
});

/** Which tab controls lie outside the band, and how far the page runs sideways. */
const fit = (page) =>
  page.evaluate(() => {
    const region = document.querySelector('[data-marxy-workspace-region="tabs"]').getBoundingClientRect();
    const bar = document.querySelector('.marxy-tabs');
    const outside = [...bar.querySelectorAll('button')]
      .filter((b) => !b.hidden)
      .map((b) => ({ name: b.getAttribute('aria-label'), r: b.getBoundingClientRect() }))
      .filter(({ r }) => r.top < region.top - 0.5 || r.bottom > region.bottom + 0.5)
      .map(({ name }) => name);
    const doc = document.documentElement;
    return { outside, rowOverflow: bar.scrollWidth - bar.clientWidth, pageOverflow: doc.scrollWidth - doc.clientWidth, region: Math.round(region.width), band: Math.round(region.height) };
  });

test('narrow window: 30 tabs at 929 px, at the default chrome size and at chrome_size 26, stay inside a 34 px band; the row scrolls, the page does not, and every tab is reachable', async () => {
  for (const chrome of [undefined, '26px']) {
    await withPage(929, async (page) => {
      await unfold(page);
      for (let i = 0; i < 30; i++) await page.evaluate((p) => window.__marxyHandle.open(p), `/many/note-${String(i).padStart(2, '0')}-with-a-long-name.md`);
      await settle(page);
      const r = await row(page);
      assert.equal(r.tabs.length, 24, 'the cap');
      const f = await fit(page);
      assert.deepEqual(f.outside, [], `chrome ${chrome ?? 'default'}: ${JSON.stringify(f)}`);
      assert.equal(f.band, 34);
      assert.ok(f.rowOverflow > 0, 'twenty-four tabs do not fit 929 px: the row scrolls');
      assert.ok(f.pageOverflow <= 0, `the page does not scroll sideways: ${JSON.stringify(f)}`);
      // The active tab (the last) is in view, whole.
      const inView = (path) =>
        page.evaluate((p) => {
          const bar = document.querySelector('.marxy-tabs').getBoundingClientRect();
          const t = document.querySelector(`[data-marxy-tab="${p}"]`).getBoundingClientRect();
          return t.left >= bar.left - 0.5 && t.right <= bar.right + 0.5;
        }, path);
      assert.equal(await inView('/many/note-29-with-a-long-name.md'), true, 'the active tab is scrolled into view');
      // Home then End in the row reach both ends and scroll the row to them.
      await page.focus('[role=tab][tabindex="0"]');
      await page.keyboard.press('Home');
      assert.equal(await inView(await page.evaluate(() => document.activeElement.closest('[data-marxy-tab]').getAttribute('data-marxy-tab'))), true, 'the first tab can be reached');
      await page.keyboard.press('End');
      assert.equal(await inView('/many/note-29-with-a-long-name.md'), true, 'the last tab can be reached');
      // The scroll fade is drawn: there is a sign that more is out of sight.
      assert.equal((await page.evaluate(() => getComputedStyle(document.querySelector('.marxy-tabs')).backgroundImage.match(/linear-gradient/g)?.length)), 4);
    }, { chrome });
  }
});

test('the toolbar still fits at 929 px with a full tab row below it, and the tab row does not change the toolbar\'s box', async () => {
  await withPage(929, async (page) => {
    await unfold(page);
    const box = () => page.evaluate(() => { const r = document.querySelector('[data-marxy-workspace-region="toolbar"]').getBoundingClientRect(); return { x: r.x, width: r.width, height: r.height }; });
    const alone = await box();
    await openFile(page, '/r/B.md');
    assert.deepEqual(await box(), alone);
    assert.equal(await page.evaluate(() => { const bar = document.querySelector('.marxy-toolbar'); return bar.scrollWidth - bar.clientWidth <= 0; }), true);
  });
});
