// The window in WebKit: one row of tabs for the window with the panes as views onto it, the
// pane head as an address (crumbs with sibling menus, the heading chain under the reading line), and the spine.
import { strict as assert } from 'node:assert';
import { after, test as nodeTest } from 'node:test';
import { closeHarness } from './support/two-pane.mjs';
import { marksOf, pathsShown, skip, withFrame } from './support/frame.mjs';

const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);
after(() => closeHarness());

const para = (n) => `Paragraph ${n} of the section, with words enough to wrap across the measure of a reading column at least twice over.`;
const section = (title, level, n) => [`${'#'.repeat(level)} ${title}`, '', ...Array.from({ length: n }, (_, i) => [para(i), '']).flat()];
const PLAN = [
  ...section('Plan', 1, 2),
  ...section('Scope', 2, 6),
  ...section('In', 3, 6),
  ...section('Out', 3, 6),
  ...section('Dates', 2, 8),
  ...section('Rollback', 2, 8),
].join('\n');
const FILES = {
  '/w/plans/plan.md': PLAN,
  '/w/plans/notes.md': '# Notes\n\nA note.\n',
  '/w/plans/q4/review.md': '# Review\n\nAll fine.\n',
  '/w/readme.md': '# Readme\n\nHello.\n',
};

const shown = (page, slot, path) => page.waitForFunction(({ slot, path }) => window.__marxyHandle.panes().panes[slot]?.path() === path, { slot, path });
const openIn = (page, slot, path) => page.evaluate(({ slot, path }) => window.__marxyHandle.panes().openIn(slot, path), { slot, path });
const focusPane = (page, slot) => page.evaluate((slot) => window.__marxyHandle.panes().focus(window.__marxyHandle.panes().panes[slot]), slot);
const blur = (page) => page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
const crumbs = (page, slot = 0) =>
  page.evaluate((slot) => [...document.querySelectorAll(`[data-marxy-head="${slot}"] .marxy-crumb`)].filter((c) => !c.hidden).map((c) => `${c.dataset.marxyCrumb}:${c.textContent}`), slot);
const menuRows = (page) => page.$$eval('.marxy-verb-menu [role="menuitem"]', (els) => els.map((e) => e.textContent.trim()));

test('01, 35c: one row of tabs for the window; the focused pane\'s tab is current, the other\'s visible; opening beside does not duplicate', async () => {
  await withFrame({ files: FILES, open: ['/w/plans/plan.md'] }, async (page) => {
    for (const p of ['/w/plans/notes.md', '/w/readme.md']) await page.evaluate((p) => window.__marxyHandle.open(p), p);
    await shown(page, 0, '/w/readme.md');
    assert.equal(await page.$$eval('.marxy-tabbar .marxy-tab', (els) => els.length), 3, 'one .marxy-tab per open document');
    assert.equal(await page.$$eval('[data-marxy-head] .marxy-tab', (els) => els.length), 0, 'no pane head holds tabs');
    assert.deepEqual(await marksOf(page), ['plan.md', 'notes.md', 'readme.md*']);
    // The same document beside: two panes on it, one tab.
    await openIn(page, 1, '/w/readme.md');
    assert.deepEqual(await pathsShown(page), ['/w/readme.md', '/w/readme.md']);
    assert.deepEqual(await marksOf(page), ['plan.md', 'notes.md', 'readme.md*']);
    // Another beside: its tab is marked as visible, and becomes current with the focus.
    await openIn(page, 1, '/w/plans/plan.md');
    assert.deepEqual(await marksOf(page), ['plan.md+', 'notes.md', 'readme.md*']);
    await focusPane(page, 1);
    await page.waitForFunction(() => document.querySelector('.marxy-tabbar .marxy-tab[aria-selected="true"]')?.dataset.marxyTabPath === '/w/plans/plan.md');
    assert.deepEqual(await marksOf(page), ['plan.md*', 'notes.md', 'readme.md+']);
    // The split and the window's controls sit at the row's right end.
    const ends = await page.evaluate(() => {
      const bar = document.querySelector('.marxy-tabbar').getBoundingClientRect();
      const split = document.querySelector('.marxy-tabbar .marxy-tabbar-split').getBoundingClientRect();
      const last = [...document.querySelectorAll('.marxy-tabbar .marxy-tab')].at(-1).getBoundingClientRect();
      return { splitRight: bar.right - split.right, afterTabs: split.left > last.right };
    });
    assert.ok(ends.afterTabs && ends.splitRight < 80, JSON.stringify(ends));
  });
});

test('a pressed tab shows in the focused pane; g t and g T step the row, as Ctrl+Tab does; Alt+W closes the current tab', async () => {
  await withFrame({ files: FILES, open: ['/w/plans/plan.md'] }, async (page) => {
    for (const p of ['/w/plans/notes.md', '/w/readme.md']) await page.evaluate((p) => window.__marxyHandle.open(p), p);
    await shown(page, 0, '/w/readme.md');
    await openIn(page, 1, '/w/plans/notes.md');
    await focusPane(page, 1);
    await page.click('.marxy-tabbar .marxy-tab[data-marxy-tab-path="/w/plans/plan.md"] .marxy-tab-open');
    await shown(page, 1, '/w/plans/plan.md');
    assert.deepEqual(await pathsShown(page), ['/w/readme.md', '/w/plans/plan.md'], 'the left pane is left alone');
    await blur(page);
    await page.keyboard.press('g');
    await page.keyboard.press('t');
    await shown(page, 1, '/w/plans/notes.md');
    await page.keyboard.press('g');
    await page.keyboard.press('Shift+T');
    await shown(page, 1, '/w/plans/plan.md');
    await page.keyboard.press('g');
    await page.keyboard.press('Shift+T');
    await shown(page, 1, '/w/readme.md');
    // Ctrl+Tab's command (WebKit keeps the chord for itself here): the same step, wrapping.
    await page.evaluate(() => window.__marxyHandle.commands().find((c) => c.id === 'tab.next').run({}));
    await shown(page, 1, '/w/plans/plan.md');
    await page.keyboard.press('Alt+W');
    await page.waitForFunction(() => !document.querySelector('.marxy-tabbar .marxy-tab[data-marxy-tab-path="/w/plans/plan.md"]'));
    assert.deepEqual(await marksOf(page), ['notes.md*', 'readme.md+']);
    assert.deepEqual(await pathsShown(page), ['/w/readme.md', '/w/plans/notes.md']);
  });
});

test('each pane keeps its own back and forward', async () => {
  await withFrame({ files: FILES, open: ['/w/plans/plan.md'] }, async (page) => {
    await page.evaluate(() => window.__marxyHandle.open('/w/plans/notes.md'));
    await shown(page, 0, '/w/plans/notes.md');
    await openIn(page, 1, '/w/readme.md');
    await openIn(page, 1, '/w/plans/q4/review.md');
    const steps = (slot) => page.$$eval(`[data-marxy-head="${slot}"] .marxy-head-step`, (bs) => bs.map((b) => b.disabled));
    assert.deepEqual(await steps(0), [false, true]);
    assert.deepEqual(await steps(1), [false, true]);
    await page.click('[data-marxy-head="1"] .marxy-head-step[aria-label="Back"]');
    await shown(page, 1, '/w/readme.md');
    assert.deepEqual(await pathsShown(page), ['/w/plans/notes.md', '/w/readme.md'], 'Back in the right pane leaves the left alone');
    assert.deepEqual(await steps(1), [true, false]);
    await page.click('[data-marxy-head="0"] .marxy-head-step[aria-label="Back"]');
    await shown(page, 0, '/w/plans/plan.md');
    assert.deepEqual(await steps(0), [true, false]);
    assert.equal(await page.$$eval('.marxy-tabbar .marxy-tab', (els) => els.length), 4, 'stepping opens no tab');
  });
});

test('the head is an address: folders, the file, then the headings the reading line is under, following the scroll', async () => {
  await withFrame({ files: FILES, open: ['/w/plans/plan.md'], viewport: { width: 1280, height: 700 } }, async (page) => {
    // From the place the file is in (the harness indexes its folder), each folder below it, then the file.
    const place = (await crumbs(page)).filter((c) => !c.startsWith('section:'));
    assert.deepEqual(place, ['root:plans', 'file:plan.md']);
    const scrollTo = (text) =>
      page.evaluate((text) => {
        const h = [...document.querySelectorAll('[data-marxy-pane="0"] .marxy-article h1, [data-marxy-pane="0"] .marxy-article h2, [data-marxy-pane="0"] .marxy-article h3')].find((e) => e.textContent.trim() === text);
        window.scrollTo(0, h.getBoundingClientRect().top + window.scrollY - window.innerHeight * 0.4 + 40);
      }, text);
    await scrollTo('Out');
    await page.waitForFunction(() => [...document.querySelectorAll('[data-marxy-head="0"] .marxy-crumb[data-marxy-crumb="section"]')].map((c) => c.textContent).join('>') === 'Plan>Scope>Out');
    await scrollTo('Rollback');
    await page.waitForFunction(() => [...document.querySelectorAll('[data-marxy-head="0"] .marxy-crumb[data-marxy-crumb="section"]')].map((c) => c.textContent).join('>') === 'Plan>Rollback');
    // Read and Source stay in the head, after the address.
    const order = await page.evaluate(() => {
      const head = document.querySelector('[data-marxy-head="0"]');
      return head.querySelector('.marxy-crumbs').getBoundingClientRect().right <= head.querySelector('.marxy-rs').getBoundingClientRect().left;
    });
    assert.equal(order, true);
  });
});

test('34: a folder crumb opens a menu of that folder\'s entries; choosing a file opens it in the pane', async () => {
  await withFrame({ files: FILES, open: ['/w/plans/plan.md'] }, async (page) => {
    await page.click('[data-marxy-head="0"] .marxy-crumb:text-is("plans")');
    await page.waitForSelector('.marxy-verb-menu');
    const rows = await menuRows(page);
    for (const want of ['Read this folder as a page', 'q4/', 'notes.md', 'plan.md']) assert.ok(rows.some((r) => r.startsWith(want)), `${want} in ${JSON.stringify(rows)}`);
    assert.ok(rows.some((r) => /^plan\.md\s*here/.test(r)), 'the file shown is marked');
    await page.click('.marxy-verb-menu [role="menuitem"]:has-text("notes.md")');
    await shown(page, 0, '/w/plans/notes.md');
    assert.deepEqual(await marksOf(page), ['plan.md', 'notes.md*']);
  });
});

test('a heading crumb lists the headings beside it; choosing one goes there', async () => {
  await withFrame({ files: FILES, open: ['/w/plans/plan.md'], viewport: { width: 1280, height: 700 } }, async (page) => {
    await page.evaluate(() => {
      const h = [...document.querySelectorAll('[data-marxy-pane="0"] .marxy-article h2')].find((e) => e.textContent.trim() === 'Scope');
      window.scrollTo(0, h.getBoundingClientRect().top + window.scrollY - window.innerHeight * 0.4 + 40);
    });
    await page.waitForSelector('[data-marxy-head="0"] .marxy-crumb[data-marxy-crumb="section"]:text-is("Scope")');
    await page.click('[data-marxy-head="0"] .marxy-crumb[data-marxy-crumb="section"]:text-is("Scope")');
    await page.waitForSelector('.marxy-verb-menu');
    assert.deepEqual((await menuRows(page)).map((r) => r.replace(/\s*here$/, '')), ['Scope', 'Dates', 'Rollback']);
    await page.click('.marxy-verb-menu [role="menuitem"]:has-text("Rollback")');
    await page.waitForFunction(() => [...document.querySelectorAll('[data-marxy-head="0"] .marxy-crumb[data-marxy-crumb="section"]')].map((c) => c.textContent).join('>') === 'Plan>Rollback');
  });
});

test('the spine: a tick per heading by level, the view as a thumb that follows the scroll, a press goes there', async () => {
  await withFrame({ files: FILES, open: ['/w/plans/plan.md'], viewport: { width: 1280, height: 700 } }, async (page) => {
    await page.waitForFunction(() => document.querySelectorAll('[data-marxy-pane="0"] .marxy-spine-tick').length === 6);
    const ticks = await page.$$eval('[data-marxy-pane="0"] .marxy-spine-tick', (ts) => ts.map((t) => [t.dataset.marxyLevel, parseFloat(t.style.top)]));
    assert.deepEqual(ticks.map((t) => t[0]), ['1', '2', '3', '3', '2', '2']);
    assert.ok(ticks.every((t, i) => i === 0 || t[1] > ticks[i - 1][1]), `ticks run down the spine in order: ${JSON.stringify(ticks)}`);
    assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).scrollbarWidth), 'none', 'the spine stands in for the scrollbar');
    const thumbTop = () => page.$eval('[data-marxy-pane="0"] .marxy-spine-thumb', (t) => parseFloat(t.style.top));
    assert.ok((await thumbTop()) < 1);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight / 2));
    await page.waitForFunction(() => parseFloat(document.querySelector('[data-marxy-pane="0"] .marxy-spine-thumb').style.top) > 30);
    // A press near the foot of the spine takes the page there.
    const box = await page.locator('[data-marxy-pane="0"] .marxy-spine').boundingBox();
    await page.mouse.click(box.x + 9, box.y + box.height - 4);
    await page.waitForFunction(() => window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 4);
    // Dragged back up, the page follows.
    await page.mouse.move(box.x + 9, box.y + box.height - 4);
    await page.mouse.down();
    await page.mouse.move(box.x + 9, box.y + 2, { steps: 4 });
    await page.mouse.up();
    await page.waitForFunction(() => window.scrollY < 200);
  });
});

test('the spine marks find\'s hits while find is open and the cursor\'s part; spineMarks(pane).set adds a kind of one\'s own', async () => {
  await withFrame({ files: FILES, open: ['/w/plans/plan.md'], viewport: { width: 1280, height: 700 } }, async (page, { mod }) => {
    const marks = (kind) => page.$$eval(`[data-marxy-pane="0"] .marxy-spine-mark[data-marxy-mark="${kind}"]`, (ms) => ms.length);
    await blur(page);
    await page.keyboard.press(`${mod}+f`);
    await page.waitForSelector('.marxy-find-slot input');
    await page.keyboard.type('Paragraph 5 of');
    // One hit per paragraph 5: in Scope, In, Out, Dates and Rollback.
    await page.waitForFunction(() => document.querySelectorAll('[data-marxy-pane="0"] .marxy-spine-mark[data-marxy-mark="hit"]').length === 5);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelectorAll('[data-marxy-pane="0"] .marxy-spine-mark[data-marxy-mark="hit"]').length === 0);
    await blur(page);
    await page.keyboard.press('j');
    await page.waitForFunction(() => document.querySelectorAll('[data-marxy-pane="0"] .marxy-spine-mark[data-marxy-mark="cursor"]').length === 1);
    await page.evaluate(async () => {
      const { spineMarks } = await import('/src/frame/spine.ts');
      spineMarks(window.__marxyHandle.panes().panes[0]).set('note', [{ start: 0 }, { start: 400 }]);
    });
    await page.waitForFunction(() => document.querySelectorAll('[data-marxy-pane="0"] .marxy-spine-mark[data-marxy-mark="note"]').length === 2);
    assert.equal(await marks('hit'), 0);
    await page.evaluate(async () => {
      const { spineMarks } = await import('/src/frame/spine.ts');
      spineMarks(window.__marxyHandle.panes().panes[0]).set('note', []);
    });
    await page.waitForFunction(() => document.querySelectorAll('[data-marxy-pane="0"] .marxy-spine-mark[data-marxy-mark="note"]').length === 0);
  });
});

test('the spine marks the hits of find opened from the Line with a pattern, as find counts them', async () => {
  await withFrame({ files: FILES, open: ['/w/plans/plan.md'], viewport: { width: 1280, height: 700 } }, async (page) => {
    await blur(page);
    await page.keyboard.press('Slash');
    await page.waitForSelector('#marxy-palette[open]');
    await page.keyboard.type('/Paragraph [57] of/');
    await page.waitForTimeout(250);
    await page.keyboard.press('Enter');
    await page.waitForSelector('.marxy-find-input');
    // Paragraph 5 in Scope, In, Out, Dates and Rollback; paragraph 7 in Dates and Rollback.
    await page.waitForFunction(() => document.querySelectorAll('[data-marxy-pane="0"] .marxy-spine-mark[data-marxy-mark="hit"]').length === 7);
  });
});

test('39: at 760x700 the text column ends left of the spine', async () => {
  await withFrame({ files: FILES, open: ['/w/plans/plan.md'], viewport: { width: 760, height: 700 } }, async (page) => {
    await page.waitForFunction(() => document.querySelector('[data-marxy-pane="0"] .marxy-spine:not([hidden])'));
    const r = await page.evaluate(() => {
      const spine = document.querySelector('[data-marxy-pane="0"] .marxy-spine').getBoundingClientRect();
      const right = Math.max(...[...document.querySelectorAll('[data-marxy-pane="0"] .marxy-article p')].map((p) => p.getBoundingClientRect().right));
      return { right, spine: spine.left };
    });
    assert.ok(r.right <= r.spine + 0.5, JSON.stringify(r));
  });
});

test('a long page\'s spine has a tick for every heading, in order, down to its foot', async () => {
  const many = Array.from({ length: 1500 }, (_, i) => section(`Part ${i}`, 2, 6).join('\n')).join('\n');
  await withFrame({ files: { '/w/long.md': many }, open: ['/w/long.md'] }, async (page) => {
    await page.waitForFunction(() => document.querySelectorAll('[data-marxy-pane="0"] .marxy-spine-tick').length === 1500, null, { timeout: 60_000 });
    const tops = await page.$$eval('[data-marxy-pane="0"] .marxy-spine-tick', (ts) => ts.map((t) => parseFloat(t.style.top)));
    assert.ok(tops.every((t, i) => i === 0 || t >= tops[i - 1]), 'the ticks run in order down the spine');
    assert.ok(tops.at(-1) > 95, `the last part sits at the spine's foot (${tops.at(-1)} %)`);
  });
});
