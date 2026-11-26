// The window chrome: the guess mark names the guessed part and agrees with the Reading card;
// the window's tab row that says what the cap closed, has a door to every tab, keeps the current tab in view and is
// worked from the keys; focus rings on the page's stops; what is pressed or a field in forced colours; and Escape and Tab between the left section's panel and the page. Playwright WebKit.
import { strict as assert } from 'node:assert';
import { after, test as nodeTest } from 'node:test';
import { closeHarness } from './support/two-pane.mjs';
import { drawerShows, panelHero, panelRows, rowOf, skip, withFrame } from './support/frame.mjs';

const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);
after(() => closeHarness());

const HANDOFF = '/r/handoff.md';
const FILES = {
  [HANDOFF]: '# Handoff\n\nWhat I ran.\n\n```\n$ go test ./...\nok   example.com/api  1.2s\n```\n\nDone.\n',
  '/r/plan.md': '# Plan\n\n- [ ] one\n- [ ] two\n',
  '/r/empty.txt': '',
  '/r/tide.txt': 'Low water at six.\nThe harbour gives\nback what it took.\n\nWe walk out\non the sand as if\nthe sea had signed.\n\nAt noon it turns.\nIt does not hurry.\nIt comes back in.\n',
  '/r/release.json': '{ "name": "x", "channels": ["a", "b"], "checks": { "tests": 1 } }\n',
  '/r/p95.csv': 'date,service,ms\n2026-10-08,api,41\n2026-10-08,auth,22\n',
};
const guess = (slot = 0) => `[data-marxy-head="${slot}"] .marxy-guess`;
const openHere = (page, path) => page.evaluate((p) => window.__marxyHandle.open(p), path);
const shown = (page, path) => page.waitForFunction((p) => window.__marxyHandle.panes().focused.path() === p, path);

test('the guess is said in Metadata, never drawn in the head, and is quiet where nothing was guessed', async () => {
  await withFrame({ files: FILES, open: [HANDOFF] }, async (page) => {
    await page.waitForFunction((g) => document.querySelector(g)?.textContent === 'session at line 5 · guessed', guess());
    assert.equal(await page.isVisible(guess()), false, 'the head draws no reading mark');
    const part = (await panelRows(page, 'metadata')).find((r) => r.name === 'Lines 5 to 8');
    assert.equal(part?.as, 'session · guessed', 'the fenced part, by its lines, and that it was guessed');
    const hero = await panelHero(page);
    assert.match(hero.small, /Read so because its name ends \.md\./);
    assert.match(hero.small, /One fenced part is read on its own; one was guessed to be a session\./);
    assert.equal(hero.guessed.length, 1, 'the guess in the accent');
    for (const quiet of ['/r/plan.md', '/r/empty.txt']) {
      await openHere(page, quiet);
      await shown(page, quiet);
      await page.waitForFunction((g) => document.querySelector(g)?.hidden === true, guess());
      await page.waitForFunction((n) => document.querySelector('.marxy-drawer .marxy-l-subject')?.textContent === n, quiet.slice(3));
      assert.deepEqual((await panelHero(page)).guessed, [], `${quiet}: Metadata says no guess either`);
    }
    await openHere(page, '/r/tide.txt');
    await shown(page, '/r/tide.txt');
    await page.waitForFunction((g) => document.querySelector(g)?.textContent === 'verse · guessed', guess());
    await page.waitForFunction(() => document.querySelector('.marxy-drawer .marxy-l-subject')?.textContent === 'tide.txt');
    const verse = await panelHero(page);
    assert.equal(verse.big, 'Verse');
    assert.equal(verse.guessed.length, 1, 'verse is a guess from its shape');
  });
});

test('a narrow window keeps tab names legible in the one row', async () => {
  const files = {
    '/r/pg16-upgrade-plan.md': FILES['/r/plan.md'],
    '/r/p95-latency.csv': FILES['/r/p95.csv'],
    '/r/auth-refactor-handoff.md': FILES[HANDOFF],
    '/r/tide-table.txt': FILES['/r/tide.txt'],
  };
  for (const width of [1440, 1024]) {
    await withFrame({ files, open: ['/r/pg16-upgrade-plan.md', '/r/p95-latency.csv'], viewport: { width, height: 768 } }, async (page) => {
      await openHere(page, '/r/auth-refactor-handoff.md');
      await page.evaluate(() => window.__marxyHandle.panes().openIn(1, '/r/tide-table.txt'));
      await page.waitForFunction(() => document.querySelectorAll('.marxy-tabbar .marxy-tab').length === 4);
      await page.waitForTimeout(400);
      const got = await page.evaluate(() => {
        const bar = document.querySelector('.marxy-tabbar');
        const row = bar.querySelector('.marxy-tabs').getBoundingClientRect();
        const active = bar.querySelector('.marxy-tab[aria-selected="true"]').getBoundingClientRect();
        return {
          activeInView: active.left >= row.left - 1 && active.right <= row.right + 1,
          allInView: [...bar.querySelectorAll('.marxy-tab')].every((t) => { const b = t.getBoundingClientRect(); return b.left >= row.left - 1 && b.right <= row.right + 1; }),
          door: !bar.querySelector('.marxy-tabs-all').hidden,
          // A cut name keeps a head of a few characters before its ellipsis, and the whole of its tail.
          legible: [...bar.querySelectorAll('.marxy-tab-head')].every((lead) => {
            const tail = lead.parentElement.querySelector('.marxy-tab-tail');
            const name = lead.closest('.marxy-tab-name').getBoundingClientRect();
            const t = tail.getBoundingClientRect();
            return lead.clientWidth >= 24 && t.right <= name.right + 1;
          }),
          history: [0, 1].every((s) => getComputedStyle(document.querySelector(`[data-marxy-head="${s}"] .marxy-head-history`)).display !== 'none'),
        };
      });
      assert.equal(got.activeInView, true, `${width}: the current tab is whole`);
      assert.ok(got.allInView || got.door, `${width}: a tab out of the row is reached by the door`);
      assert.equal(got.legible, true, `${width}: no name is cut to a stub`);
      assert.equal(got.history, true, `${width}: each pane's head keeps Back and Forward`);
    });
  }
});

test('the cap says which tab it closed; the door lists every tab; the current tab stays in view', async () => {
  const many = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`/t/2026-10-01-quarterly-planning-review-draft-${i}.md`, `# ${i}\n`]));
  await withFrame({ files: many, open: ['/t/2026-10-01-quarterly-planning-review-draft-0.md'], viewport: { width: 1200, height: 800 } }, async (page) => {
    for (let i = 1; i < 50; i++) await openHere(page, `/t/2026-10-01-quarterly-planning-review-draft-${i}.md`);
    await shown(page, '/t/2026-10-01-quarterly-planning-review-draft-49.md');
    await page.waitForFunction(() => [...document.querySelectorAll('.marxy-notice-text')].some((n) => /^Closed .*draft-1\.md · the window holds 48 tabs$/.test(n.textContent)));
    assert.equal((await rowOf(page)).length, 48);
    // A cut name keeps its tail, so the drafts stay told apart.
    const tails = await page.$$eval('.marxy-tabbar .marxy-tab-tail', (els) => els.map((e) => e.textContent));
    assert.equal(new Set(tails).size, tails.length, JSON.stringify(tails));
    await page.waitForFunction(() => !document.querySelector('.marxy-tabbar .marxy-tabs-all').hidden);
    await page.click('.marxy-tabbar .marxy-tabs-all');
    await page.waitForSelector('.marxy-verb-menu');
    const listed = await page.$$eval('.marxy-verb-menu [role="menuitem"], .marxy-verb-menu .marxy-verb-menu-item', (els) => els.length);
    assert.ok(listed >= 48, `the door lists every tab (${listed})`);
    await page.keyboard.press('Escape');
    // The first tab shown, the row scrolled away from it, then a narrower window: it is brought back into view.
    await page.click('.marxy-tabbar .marxy-tab:first-child .marxy-tab-open');
    await page.waitForFunction(() => document.querySelector('.marxy-tabbar .marxy-tab:first-child')?.getAttribute('aria-selected') === 'true');
    await page.evaluate(() => { document.querySelector('.marxy-tabbar .marxy-tabs').scrollLeft = 99999; });
    await page.setViewportSize({ width: 900, height: 700 });
    await page.waitForFunction(() => {
      const row = document.querySelector('.marxy-tabbar .marxy-tabs').getBoundingClientRect();
      const a = document.querySelector('.marxy-tabbar .marxy-tab[aria-selected="true"]').getBoundingClientRect();
      return a.left >= row.left - 1 && a.right <= row.right + 1;
    });
  });
});

test('the tab row from the keys: arrows, Home and End move, Enter shows, Delete closes, Shift+F10 opens its menu', async () => {
  await withFrame({ files: FILES, open: ['/r/plan.md'] }, async (page) => {
    for (const p of ['/r/tide.txt', '/r/p95.csv', '/r/release.json']) await openHere(page, p);
    await shown(page, '/r/release.json');
    const focused = () => page.evaluate(() => document.activeElement?.closest('.marxy-tab')?.querySelector('.marxy-tab-name')?.textContent ?? null);
    await page.focus('.marxy-tabbar .marxy-tab[aria-selected="true"]');
    assert.equal(await page.$$eval('.marxy-tabbar .marxy-tab[tabindex="0"]', (els) => els.length), 1, 'one stop in the row');
    await page.keyboard.press('Home');
    assert.equal(await focused(), 'plan.md');
    await page.keyboard.press('ArrowRight');
    assert.equal(await focused(), 'tide.txt');
    await page.keyboard.press('End');
    assert.equal(await focused(), 'release.json');
    await page.keyboard.press('ArrowRight');
    assert.equal(await focused(), 'plan.md', 'the arrows wrap');
    await page.keyboard.press('Enter');
    await shown(page, '/r/plan.md');
    await page.focus('.marxy-tabbar .marxy-tab[data-marxy-tab-path="/r/p95.csv"]');
    await page.keyboard.press('Delete');
    await page.waitForFunction(() => document.querySelectorAll('.marxy-tabbar .marxy-tab').length === 3);
    assert.equal(await focused(), 'release.json', 'focus goes to the tab that took its place');
    await page.keyboard.press('Shift+F10');
    await page.waitForSelector('.marxy-verb-menu');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.marxy-verb-menu'));
  });
});

test('a fold, a column that sorts and a tab show where focus is', async () => {
  await withFrame({ files: FILES, open: ['/r/release.json'] }, async (page) => {
    const ring = (sel) => page.evaluate((sel) => { const e = document.querySelector(sel); e.focus(); const cs = getComputedStyle(e); return e === document.activeElement && cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2; }, sel);
    await page.keyboard.press('Shift');
    assert.equal(await ring('.marxy-article summary'), true, 'a data tree fold');
    await openHere(page, '/r/p95.csv');
    await shown(page, '/r/p95.csv');
    await page.waitForSelector('.marxy-article th[data-marxy-sort]');
    await page.keyboard.press('Shift');
    assert.equal(await ring('.marxy-article th[data-marxy-sort]'), true, 'a column that sorts');
    assert.equal(await ring('.marxy-tabbar .marxy-tab[aria-selected="true"]'), true, 'a tab');
  });
});

test('the palette says when nothing has that name, and a command that cannot run now is dimmed with why', async () => {
  await withFrame({ files: FILES, open: ['/r/plan.md'], viewport: { width: 640, height: 600 } }, async (page, { mod }) => {
    await page.keyboard.press(`${mod}+k`);
    await page.waitForSelector('#marxy-palette[open]');
    await page.fill('#marxy-palette .marxy-palette-query', 'zzqxqv');
    await page.waitForFunction(() => /^Nothing by that name/.test(document.querySelector('#marxy-palette .marxy-palette-notice')?.textContent ?? ''));
    await page.fill('#marxy-palette .marxy-palette-query', '>split this document');
    const row = '#marxy-palette .marxy-palette-row[data-row-key="view.split-same"]';
    await page.waitForSelector(row);
    assert.equal(await page.getAttribute(row, 'aria-disabled'), 'true');
    assert.match(await page.textContent(`${row} .marxy-palette-why`), /needs a window at least \d+ px wide/);
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => [...document.querySelectorAll('.marxy-notice-text')].some((n) => /needs a window/.test(n.textContent)));
    assert.equal(await page.evaluate(() => window.__marxyHandle.panes().panes.length), 1, 'nothing split');
  });
});

// Deleted with the right-hand panel: the case where it lay over the page and sent the drawer away (one overlay at a time
// is now the one drawer). Escape in the docked drawer no longer shuts it: it gives the keys back to the page.
test('overlays: the drawer lies over a narrow page and Escape shuts it; docked, Escape gives the keys back to the page; focus comes back', async () => {
  await withFrame({ files: FILES, open: ['/r/plan.md'], viewport: { width: 640, height: 600 } }, async (page, { mod }) => {
    await page.keyboard.press(`${mod}+Shift+E`);
    await page.waitForFunction(() => document.body.getAttribute('data-marxy-drawer') === 'over');
    await page.waitForFunction(() => document.querySelector('.marxy-drawer')?.contains(document.activeElement));
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.body.getAttribute('data-marxy-drawer') === 'closed');
    assert.equal(await page.evaluate(() => document.activeElement !== document.body && !document.querySelector('.marxy-drawer').contains(document.activeElement)), true, 'focus back on the page');
  });
  await withFrame({ files: FILES, open: ['/r/plan.md'] }, async (page, { mod }) => {
    await page.keyboard.press(`${mod}+Shift+F`);
    await drawerShows(page, 'search');
    await page.waitForFunction(() => document.querySelector('.marxy-drawer input') === document.activeElement);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.marxy-drawer').contains(document.activeElement));
    assert.equal(await page.getAttribute('body', 'data-marxy-drawer'), 'docked', 'docked, it stays');
    assert.equal(await page.evaluate(() => document.activeElement !== document.body), true);
    // Export (a panel) takes the keys, and Escape gives them back to the page.
    await page.focus('[data-marxy-head="0"] .marxy-rs-source');
    await page.evaluate(() => window.__marxyHandle.commands().find((c) => c.id === 'document.export').run({}));
    await page.waitForFunction(() => document.querySelector('.marxy-drawer .marxy-l-body[data-marxy-left="export"]') && document.querySelector('.marxy-drawer').contains(document.activeElement));
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.marxy-drawer').contains(document.activeElement));
    assert.equal(await page.evaluate(() => !!document.activeElement?.closest('.marxy-pane')), true, 'the keys are the page\'s again');
  });
});
test('in forced colours a pressed rail icon, Read or Source and a field are drawn in system colours, not weight alone', async () => {
  await withFrame({ files: FILES, open: ['/r/plan.md'], media: { forcedColors: 'active' } }, async (page) => {
    await page.click('.marxy-rail .marxy-l-rb[data-marxy-left="search"]');
    await page.waitForSelector('.marxy-drawer[data-marxy-left="search"] .marxy-l-fld');
    const got = await page.evaluate(() => {
      const bg = (sel) => getComputedStyle(document.querySelector(sel)).backgroundColor;
      const canvas = getComputedStyle(document.body).backgroundColor;
      const field = getComputedStyle(document.querySelector('.marxy-drawer[data-marxy-left="search"] .marxy-l-fld'));
      return {
        forced: matchMedia('(forced-colors: active)').matches,
        rail: bg('.marxy-rail .marxy-l-rb[aria-pressed="true"]') !== canvas,
        read: bg('[data-marxy-head="0"] .marxy-rs button[aria-pressed="true"]') !== canvas,
        field: field.borderTopStyle !== 'none' && parseFloat(field.borderTopWidth) >= 1,
      };
    });
    if (!got.forced) return; // this WebKit build does not emulate forced colours
    assert.deepEqual(got, { forced: true, rail: true, read: true, field: true });
  });
});
