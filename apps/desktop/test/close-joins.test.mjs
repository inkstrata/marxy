// The last joins and the defaults, in WebKit over the memory shell. The default look is the
// Ink theme, dark; the rail's Look is the Studio; the Line's Tab keeps a result in its panel; one lens; files with
// unsaved changes that no pane shows; the smaller things the earlier slices left.
import { strict as assert } from 'node:assert';
import { after, test as nodeTest } from 'node:test';
import { closeHarness, harnessBase } from './support/two-pane.mjs';
import { skip, withFrame } from './support/frame.mjs';

const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);
after(() => closeHarness());

const PLAN = ['# Plan', '', 'The first paragraph of the plan.', '', '## Tasks', '', '- [ ] write it', '- [x] read it', '', '## Code', '', '```js', 'const a = 1;', '```', '', 'A closing paragraph.', ''].join('\n');
const FILES = { '/r/plan.md': PLAN };

const token = (page, name) => page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);

test('1: with no theme chosen the app wears Ink, dark, from the first paint; Night and Paper and the looks are a choice away', async () => {
  // The first paint: index.html and the harness page carry Ink's sheet inline, after the base.
  const base = await harnessBase();
  for (const page of ['index.html', 'app.html']) {
    const html = await (await fetch(`${base}${page}`)).text();
    assert.match(html, /<style id="marxy-default-theme">[\s\S]*<\/style>\s*<style id="marxy-first-theme">[\s\S]*--marxy-color-bg: #151412/, page);
  }
  await withFrame({ files: FILES, open: ['/r/plan.md'] }, async (page) => {
    assert.equal(await token(page, '--marxy-color-bg'), '#151412', 'Ink dark');
    assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-marxy-variant')), 'dark');
    assert.equal(await page.evaluate(async () => (await import('/src/theme/user-theme.ts')).currentThemeName()), 'ink');
    assert.notEqual(await page.evaluate(() => document.getElementById('marxy-first-theme')), null, 'the inlined Ink is the one worn: nothing applied over it');
    // Another theme takes the inlined one away; Ink chosen again comes back as the theme sheet.
    await page.evaluate(async () => (await import('/src/theme/user-theme.ts')).applyBundledTheme('night-paper'));
    assert.equal(await token(page, '--marxy-color-bg'), '#0f1113');
    assert.equal(await page.evaluate(() => document.getElementById('marxy-first-theme')), null);
    await page.evaluate(async () => (await import('/src/theme/user-theme.ts')).applyBundledTheme('ink'));
    assert.equal(await token(page, '--marxy-color-bg'), '#151412');
    // The palette offers Night and Paper, not Ink.
    const offered = await page.evaluate(async () => (await import('/src/commands/appearance.ts')).appearanceCommands().filter((c) => c.id.startsWith('view.theme-') && c.when()).map((c) => c.id));
    assert.ok(offered.includes('view.theme-default') && !offered.includes('view.theme-ink'), offered.join());
    // A look turned on and "Use the theme" turned off again: back to Ink.
    await page.evaluate(async () => {
      const { setLookState, lookState } = await import('/src/look/store.ts');
      setLookState({ ...lookState(), id: 'paper' });
    });
    await page.waitForFunction(() => document.documentElement.style.getPropertyValue('--marxy-color-bg') !== '');
    await page.evaluate(async () => (await import('/src/look/store.ts')).turnLooksOff());
    await page.waitForFunction(() => document.documentElement.style.getPropertyValue('--marxy-color-bg') === '');
    assert.equal(await token(page, '--marxy-color-bg'), '#151412', 'Use the theme is Ink');
  });
  await withFrame({ files: FILES, open: ['/r/plan.md'], config: 'theme = "night-paper"\n' }, async (page) => {
    assert.equal(await token(page, '--marxy-color-bg'), '#0f1113', 'Night, named');
    assert.equal(await page.evaluate(async () => (await import('/src/theme/user-theme.ts')).currentThemeName()), 'night-paper');
  });
  await withFrame({ files: FILES, open: ['/r/plan.md'], config: 'variant = "light"\n' }, async (page) => {
    assert.equal(await token(page, '--marxy-color-bg'), '#faf8f4', 'Ink light, when light is asked for');
  });
});

/** Types `text` in the Line and keeps what it found with Tab; resolves with the panel cursor's row once `panel` shows it. */
async function keep(page, mod, text, panel) {
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  await page.keyboard.press(`${mod}+KeyK`);
  await page.waitForSelector('#marxy-palette[open]');
  await page.keyboard.type(text);
  await page.waitForTimeout(400);
  await page.keyboard.press('Tab');
  await page.waitForSelector('#marxy-palette:not([open])', { state: 'attached' });
  await page.waitForFunction((id) => document.querySelector(`.marxy-drawer .marxy-l-body[data-marxy-left="${id}"] .marxy-l-cur`), panel);
  return page.evaluate(() => {
    const r = document.querySelector('.marxy-drawer .marxy-l-cur');
    return { key: r.dataset.marxyLeftRow, text: r.textContent.trim(), keys: document.querySelector('.marxy-drawer').contains(document.activeElement) };
  });
}

test('3: the Line\'s Tab keeps a result in its panel, the panel cursor on it: Places, Search, Outline, Transforms, Metadata', async () => {
  const files = { ...FILES, '/r/notes.md': '# Notes\n\nNothing here about it.\n' };
  await withFrame({ files, open: ['/r/plan.md'] }, async (page, { mod }) => {
    await page.waitForSelector('[data-marxy-pane="0"] .marxy-article h1');
    const go = await keep(page, mod, 'notes', 'places');
    assert.equal(go.key, 'f:/r/notes.md', 'Go: the file, in Places');
    assert.ok(go.keys, 'the keys are in the panel');
    const grep = await keep(page, mod, '#first paragraph', 'search');
    assert.equal(grep.key, 'h:/r/plan.md:2', '#: the hit under the Line\'s cursor, in Search');
    assert.equal(await page.inputValue('.marxy-drawer [data-marxy-left-field]'), 'first paragraph', 'with its query');
    const outline = await keep(page, mod, '@code', 'outline');
    assert.match(outline.text, /^Code/, '@: the heading, in Outline');
    const tx = await keep(page, mod, '!sort lines', 'transforms');
    assert.equal(tx.key, 't:sort-lines', '!: the transform, in Transforms');
    const lens = await keep(page, mod, '%open tasks', 'metadata');
    assert.equal(lens.key, 'l:tasks', '%: the lens, on, in Metadata');
    assert.equal(await page.evaluate(() => document.querySelector('[data-marxy-pane="0"] .marxy-article').getAttribute('data-marxy-lens')), 'Open tasks');
    const reading = await keep(page, mod, '&bytes', 'metadata');
    assert.equal(reading.key, 'ra:bytes', '&: the reading, in Metadata');
  });
});

test('5: a file with unsaved changes that no pane shows is a tab marked unsaved, named in Versions\' Now, and quitting asks once, naming them', async () => {
  const files = { ...FILES, '/r/a.md': '# A\n\nThe first word here.\n', '/r/b.md': '# B\n\nAnd the first one there.\n' };
  await withFrame({ files, open: ['/r/plan.md'] }, async (page) => {
    await page.waitForSelector('[data-marxy-pane="0"] .marxy-article h1');
    // Search stages a replace in three files; two of them no pane shows.
    await page.evaluate(() => window.__marxyHandle.frame().left.show('search', { q: 'first', scope: 'grep' }, false));
    await page.waitForSelector('.marxy-drawer input[data-marxy-left-field="search-r"]');
    await page.fill('.marxy-drawer input[data-marxy-left-field="search-r"]', 'last');
    await page.waitForFunction(() => /^Stage/.test(document.querySelector('.marxy-drawer .marxy-l-btns button.marxy-l-pri')?.textContent ?? ''));
    await page.click('.marxy-drawer .marxy-l-btns button.marxy-l-pri');
    await page.waitForFunction(() => /Staged/.test([...document.querySelectorAll('.marxy-notice-text')].map((n) => n.textContent).join(' ')));
    // The row: a tab each, marked unsaved.
    await page.waitForFunction(() => ['a.md', 'b.md'].every((n) => [...document.querySelectorAll('.marxy-tabbar .marxy-tab')].some((t) => t.querySelector('.marxy-tab-name').textContent === n && t.querySelector('.marxy-tab-close[data-marxy-dirty]'))));
    // Versions' Now names them.
    await page.evaluate(() => window.__marxyHandle.frame().left.show('versions', undefined, false));
    await page.waitForSelector('.marxy-drawer [data-marxy-left-row="held:/r/a.md"]');
    assert.ok(await page.$('.marxy-drawer [data-marxy-left-row="held:/r/b.md"]'));
    // The tab's menu reads, saves or discards them; closing it first asks for one of those.
    const tab = (name) => page.locator('.marxy-tabbar .marxy-tab', { has: page.locator('.marxy-tab-name', { hasText: name }) });
    await tab('a.md').click({ button: 'right' });
    const menu = await page.locator('[role="menuitem"]').allTextContents();
    for (const item of ['Read its changes', 'Save', 'Discard its changes']) assert.ok(menu.some((m) => m.startsWith(item)), `${item} in ${menu.join(' | ')}`);
    await page.keyboard.press('Escape');
    await tab('b.md').locator('.marxy-tab-close').click({ force: true });
    await page.waitForFunction(() => /no pane shows it/.test([...document.querySelectorAll('.marxy-notice-text')].map((n) => n.textContent).join(' ')));
    assert.equal(await tab('b.md').count(), 1, 'the tab stays until its changes are saved or let go');
    // Quitting: plan.md, then one question naming both files no pane shows; its Save writes both.
    await page.evaluate(() => window.__marxyHandle.shell.emitCloseRequested());
    await page.waitForFunction(() => /plan\.md has changes/.test([...document.querySelectorAll('.marxy-notice-text')].map((n) => n.textContent).join(' ')));
    await page.locator('.marxy-notice button', { hasText: 'Close without saving' }).click();
    await page.waitForFunction(() => /2 files no pane shows have changes that are not saved: a\.md, b\.md/.test([...document.querySelectorAll('.marxy-notice-text')].map((n) => n.textContent).join(' ')));
    await page.locator('.marxy-notice button', { hasText: 'Save and close' }).click();
    await page.waitForFunction(() => window.__marxyHandle.shell.calls.some((c) => c.method === 'confirmClose'));
    assert.match(new TextDecoder().decode(Buffer.from(await page.evaluate(async () => [...(await window.__marxyHandle.shell.readFile('/r/a.md'))]))), /The last word here\./);
    assert.match(new TextDecoder().decode(Buffer.from(await page.evaluate(async () => [...(await window.__marxyHandle.shell.readFile('/r/b.md'))]))), /And the last one there\./);
    assert.doesNotMatch(new TextDecoder().decode(Buffer.from(await page.evaluate(async () => [...(await window.__marxyHandle.shell.readFile('/r/plan.md'))]))), /last paragraph/, 'plan.md was let go unsaved');
  });
});

test('Save and close on a file no pane shows, its write refused, says why: the window stays open and the edit stays unsaved', async () => {
  const files = { ...FILES, '/r/a.md': '# A\n\nThe early word here.\n' };
  await withFrame({ files, open: ['/r/plan.md'] }, async (page) => {
    await page.waitForSelector('[data-marxy-pane="0"] .marxy-article h1');
    await page.evaluate(() => window.__marxyHandle.frame().left.show('search', { q: 'early', scope: 'grep' }, false));
    await page.waitForSelector('.marxy-drawer input[data-marxy-left-field="search-r"]');
    await page.fill('.marxy-drawer input[data-marxy-left-field="search-r"]', 'last');
    await page.waitForFunction(() => /^Stage/.test(document.querySelector('.marxy-drawer .marxy-l-btns button.marxy-l-pri')?.textContent ?? ''));
    await page.click('.marxy-drawer .marxy-l-btns button.marxy-l-pri');
    await page.waitForFunction(() => /Staged/.test([...document.querySelectorAll('.marxy-notice-text')].map((n) => n.textContent).join(' ')));
    await page.evaluate(() => {
      window.__marxyHandle.shell.writeFileAtomic = async () => {
        throw new Error('disk is read-only');
      };
      window.__marxyHandle.shell.emitCloseRequested();
    });
    await page.waitForFunction(() => /a\.md has changes that are not saved/.test([...document.querySelectorAll('.marxy-notice-text')].map((n) => n.textContent).join(' ')));
    await page.locator('.marxy-notice button', { hasText: 'Save and close' }).click();
    await page.waitForFunction(() => /a\.md could not be saved · disk is read-only/.test([...document.querySelectorAll('.marxy-notice-text')].map((n) => n.textContent).join(' ')));
    assert.equal(await page.evaluate(() => window.__marxyHandle.shell.calls.some((c) => c.method === 'confirmClose')), false, 'the window stays open');
    assert.equal(await page.evaluate(() => document.querySelectorAll('.marxy-tabbar .marxy-tab-close[data-marxy-dirty]').length), 1, 'the edit is still unsaved');
  });
});

test('Close the others keeps a tab whose changes no pane shows, and does nothing when the open it needs is refused', async () => {
  const files = { ...FILES, '/r/a.md': '# A\n\nThe early word here.\n', '/r/b.md': '# B\n\nAnd the early one there.\n', '/r/c.md': '# C\n', '/r/d.md': '# D\n' };
  await withFrame({ files, open: ['/r/plan.md'] }, async (page) => {
    await page.waitForSelector('[data-marxy-pane="0"] .marxy-article h1');
    const names = () => page.evaluate(() => [...document.querySelectorAll('.marxy-tabbar .marxy-tab .marxy-tab-name')].map((n) => n.textContent).sort());
    for (const p of ['/r/c.md', '/r/d.md', '/r/plan.md']) {
      await page.evaluate((path) => window.__marxyHandle.panes().openIn(0, path), p);
      await page.waitForFunction((path) => window.__marxyHandle.panes().focused.path() === path, p);
    }
    // Search stages a replace in a.md and b.md, which no pane shows.
    await page.evaluate(() => window.__marxyHandle.frame().left.show('search', { q: 'early', scope: 'grep' }, false));
    await page.waitForSelector('.marxy-drawer input[data-marxy-left-field="search-r"]');
    await page.fill('.marxy-drawer input[data-marxy-left-field="search-r"]', 'last');
    await page.waitForFunction(() => /^Stage/.test(document.querySelector('.marxy-drawer .marxy-l-btns button.marxy-l-pri')?.textContent ?? ''));
    await page.click('.marxy-drawer .marxy-l-btns button.marxy-l-pri');
    await page.waitForFunction(() => ['a.md', 'b.md'].every((n) => [...document.querySelectorAll('.marxy-tabbar .marxy-tab')].some((t) => t.querySelector('.marxy-tab-name').textContent === n)));
    const before = await names();
    for (const n of ['a.md', 'b.md', 'c.md', 'd.md', 'plan.md']) assert.ok(before.includes(n), `${n} in ${before.join(' ')}`);
    const tab = (name) => page.locator('.marxy-tabbar .marxy-tab', { has: page.locator('.marxy-tab-name', { hasText: name }) });
    // c.md over plan.md's unsaved changes: the open asks first, and nothing closes meanwhile.
    await page.evaluate(async () => {
      const store = window.__marxyHandle.panes().focused.content.store();
      await store.apply({ range: { file: '/r/plan.md', start: 0, end: 0 }, replacement: 'Added.\n\n', label: 'test', baseVersion: store.snapshot().version });
    });
    await tab('c.md').click({ button: 'right' });
    await page.locator('[role="menuitem"]', { hasText: 'Close the others' }).click();
    await page.waitForFunction(() => /plan\.md has changes/.test([...document.querySelectorAll('.marxy-notice-text')].map((n) => n.textContent).join(' ')));
    await page.waitForTimeout(200);
    assert.deepEqual(await names(), before, 'the show was refused: every tab stays');
    // From plan.md, shown: c.md and d.md go; a.md and b.md hold changes, so they stay.
    await tab('plan.md').click({ button: 'right' });
    await page.locator('[role="menuitem"]', { hasText: 'Close the others' }).click();
    await page.waitForFunction(() => document.querySelectorAll('.marxy-tabbar .marxy-tab').length === 3);
    assert.deepEqual(await names(), ['a.md', 'b.md', 'plan.md']);
  });
});

const CSV = 'city,country,tide_m\nBrest,France,7.2\nCork,Ireland,4.1\nNantes,France,6.0\nBergen,Norway,1.8\n';

test('6: Alt and a number on the panel already shown shuts the drawer to the rail', async () => {
  await withFrame({ files: FILES, open: ['/r/plan.md'] }, async (page) => {
    await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
    await page.keyboard.press('Alt+2');
    await page.waitForFunction(() => document.querySelector('.marxy-drawer .marxy-l-body[data-marxy-left="metadata"]') && document.body.getAttribute('data-marxy-drawer') === 'docked');
    await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
    await page.keyboard.press('Alt+2');
    await page.waitForFunction(() => document.body.getAttribute('data-marxy-drawer') === 'closed' && document.body.getAttribute('data-marxy-left') === 'rail');
    await page.keyboard.press('Alt+2');
    await page.waitForFunction(() => document.body.getAttribute('data-marxy-drawer') === 'docked');
  });
});

test('6: a set in Places is renamed with r, and frame.json keeps the new name', async () => {
  const frame = { sets: [{ name: 'Morning', tabs: ['/r/plan.md'], shown: ['/r/plan.md'] }] };
  await withFrame({ files: FILES, open: ['/r/plan.md'], frame, config: 'proposals = { sets = true }\n' }, async (page) => {
    await page.evaluate(() => window.__marxyHandle.frame().left.show('places'));
    await page.locator('.marxy-drawer .marxy-l-prow[data-marxy-left-row="g:sets"]').click();
    await page.locator('.marxy-drawer .marxy-l-prow[data-marxy-left-row="s:Morning"]').waitFor();
    await page.evaluate(() => document.querySelector('.marxy-drawer').focus());
    const cur = () => page.evaluate(() => document.querySelector('.marxy-drawer .marxy-l-prow.marxy-l-cur')?.dataset.marxyLeftRow ?? null);
    for (let i = 0; i < 40 && (await cur()) !== 's:Morning'; i++) await page.keyboard.press('j');
    assert.equal(await cur(), 's:Morning');
    await page.keyboard.press('r');
    const field = page.locator('.marxy-drawer input[data-marxy-left-field="places-set-name"]');
    await field.waitFor();
    assert.equal(await field.inputValue(), 'Morning');
    await field.fill('Evening');
    await page.keyboard.press('Enter');
    await page.locator('.marxy-drawer .marxy-l-prow[data-marxy-left-row="s:Evening"]').waitFor();
    await page.waitForFunction(async () => JSON.parse(new TextDecoder().decode(await window.__marxyHandle.shell.readFile('/data/frame.json'))).frame.sets?.[0]?.name === 'Evening');
  });
});

test('6: = keeps the rows of a table holding the words, in the Line and in Outline; the file is untouched', async () => {
  await withFrame({ files: { '/r/tides.csv': CSV }, open: ['/r/tides.csv'] }, async (page, { mod }) => {
    await page.waitForSelector('[data-marxy-pane="0"] .marxy-records .marxy-reading-table tbody tr');
    const shownRows = () => page.evaluate(() => [...document.querySelectorAll('[data-marxy-pane="0"] .marxy-reading-table tbody tr')].filter((tr) => !tr.hidden).map((tr) => tr.cells[0].textContent));
    await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
    await page.keyboard.press(`${mod}+KeyK`);
    await page.waitForSelector('#marxy-palette[open]');
    await page.keyboard.type('=france');
    await page.waitForTimeout(300);
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('[data-marxy-pane="0"] .marxy-reading-table').getAttribute('data-marxy-row-filter') === 'france');
    assert.deepEqual(await shownRows(), ['Brest', 'Nantes']);
    // Outline's rows field drives the same filter.
    await page.evaluate(() => window.__marxyHandle.frame().left.show('outline', undefined, false));
    const rowsField = page.locator('.marxy-drawer input[data-marxy-left-field="outline-rows"]');
    await rowsField.waitFor();
    assert.equal(await rowsField.inputValue(), 'france');
    await rowsField.fill('ireland');
    await page.waitForFunction(() => document.querySelector('[data-marxy-pane="0"] .marxy-reading-table').getAttribute('data-marxy-row-filter') === 'ireland');
    assert.deepEqual(await shownRows(), ['Cork']);
    await rowsField.fill('');
    await page.waitForFunction(() => !document.querySelector('[data-marxy-pane="0"] .marxy-reading-table').hasAttribute('data-marxy-row-filter'));
    assert.equal((await shownRows()).length, 4);
    assert.equal(await page.evaluate(async () => new TextDecoder().decode(await window.__marxyHandle.shell.readFile('/r/tides.csv'))), CSV, 'the file is untouched');
  });
});

test('6: the Book look sets justified prose, which the page shows; the ragged breaker stands aside for it', async () => {
  const essay = `# On margins\n\n${'A paragraph of an essay long enough to wrap across several lines of the column, with words of many lengths to set. '.repeat(4)}\n`;
  await withFrame({ files: { '/r/essay.md': essay, '/look.toml': 'on = true\nlook = "book"\nmode = "day"\nlean = false\n' }, open: ['/r/essay.md'] }, async (page) => {
    await page.waitForFunction(() => document.querySelector('[data-marxy-pane="0"]').getAttribute('data-marxy-look-align') === 'justify');
    await page.waitForFunction(() => {
      const p = document.querySelector('[data-marxy-pane="0"] .marxy-article p');
      return p && getComputedStyle(p).textAlign === 'justify' && !p.classList.contains('marxy-set');
    });
  });
});

test('6: partsGoTo puts the parts cursor on a part by its id', async () => {
  await withFrame({ files: { '/r/tides.csv': CSV }, open: ['/r/tides.csv'] }, async (page) => {
    await page.waitForSelector('[data-marxy-pane="0"] .marxy-records .marxy-reading-table tbody tr');
    await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
    await page.keyboard.press('j');
    await page.waitForSelector('[data-marxy-pane="0"] .marxy-cursor');
    const got = await page.evaluate(async () => {
      const m = await import('/src/parts/cursor.ts');
      const here = m.partsHere();
      const top = typeof here?.tree.top === 'function' ? here.tree.top() : here?.tree.top;
      const unit = top?.[2];
      if (!unit) return { why: here ? `top ${JSON.stringify(Object.keys(here.tree))} ${top?.length}` : 'no parts here' };
      return { ok: m.partsGoTo(unit.id), want: unit.id, head: m.partsHere()?.head?.id ?? null };
    });
    assert.ok(got);
    assert.equal(got.ok, true);
    assert.equal(got.head, got.want);
  });
});

test('4: one lens: the Line\'s % and Metadata\'s rows share it; it survives a relayout, no style is made at run time, and Esc drops it', async () => {
  await withFrame({ files: FILES, open: ['/r/plan.md'] }, async (page) => {
    await page.waitForSelector('[data-marxy-pane="0"] .marxy-article input[type="checkbox"]');
    const shown = () => page.evaluate(() => [...document.querySelector('[data-marxy-pane="0"] .marxy-article').children].filter((el) => el.getClientRects().length > 0 && !el.classList.contains('marxy-elide')).map((el) => el.localName));
    await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
    await page.keyboard.press('Shift+Digit5');
    await page.waitForSelector('#marxy-palette[open]');
    await page.keyboard.type('open tasks');
    await page.waitForTimeout(150);
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('[data-marxy-pane="0"] .marxy-article').getAttribute('data-marxy-lens') === 'Open tasks');
    assert.deepEqual(await shown(page), ['h1', 'h2', 'ul'], 'the open task\'s list and the headings above it');
    assert.equal(await page.evaluate(() => document.getElementById('marxy-lens-style')), null, 'no sheet made at run time');
    // Metadata reads the same lens: its Tasks row is lit.
    await page.evaluate(() => window.__marxyHandle.frame().left.show('metadata', undefined, false));
    await page.waitForSelector('.marxy-drawer [data-marxy-left-row="l:tasks"].marxy-l-sel');
    // A relayout (the text size) sets the page again: the lens is dressed again.
    await page.evaluate(async () => {
      document.documentElement.style.setProperty('--marxy-size-body', '24px');
      await window.__marxyHandle.relayout();
    });
    await page.waitForTimeout(300);
    assert.deepEqual(await shown(page), ['h1', 'h2', 'ul'], 'kept across the relayout');
    await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('[data-marxy-pane="0"] .marxy-article').hasAttribute('data-marxy-lens'));
    assert.equal(await page.evaluate(() => document.querySelectorAll('.marxy-focus-out, .marxy-elide').length), 0);
  });
});

test('2: the rail\'s Look opens the Studio, whose shelf chooses the theme, dark or light; a puts up the pop-over, whose Use the theme puts a look away', async () => {
  await withFrame({ files: FILES, open: ['/r/plan.md'], config: '# mine\n' }, async (page) => {
    await page.click('.marxy-rail .marxy-l-rb[data-marxy-left="look"]');
    await page.waitForSelector('dialog.marxy-studio[open] .marxy-studio-themerow[data-marxy-look="ink"]');
    assert.equal(await page.getAttribute('.marxy-studio-themerow[aria-selected="true"]', 'data-marxy-look'), 'ink', 'Ink, the default, is the one in force');
    await page.click('.marxy-studio-themerow[data-marxy-look="night-paper"]');
    await page.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--marxy-color-bg').trim() === '#0f1113');
    assert.equal(await page.getAttribute('.marxy-studio-themerow[aria-selected="true"]', 'data-marxy-look'), 'night-paper');
    // A light theme is seen light.
    await page.click('.marxy-studio-themerow[data-marxy-look="book"]');
    await page.waitForFunction(() => document.documentElement.getAttribute('data-marxy-variant') === 'light');
    await page.waitForFunction(() => document.querySelector('[data-marxy-pane="0"]').getAttribute('data-marxy-look') === 'book');
    await page.keyboard.press('Escape');
    await page.waitForSelector('dialog.marxy-studio', { state: 'detached' });
    // The drawer never hosts a look branch.
    assert.equal(await page.evaluate(() => document.querySelector('.marxy-drawer[data-marxy-branch="look"]')), null);
    // The pop-over's Use the theme puts the look away.
    await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
    await page.keyboard.press('a');
    await page.waitForSelector('dialog.marxy-look-pop');
    await page.locator('dialog.marxy-look-pop .marxy-btn', { hasText: 'Use the theme' }).click();
    await page.waitForFunction(() => !document.querySelector('[data-marxy-pane="0"]').hasAttribute('data-marxy-look'));
  });
});

test('Discard on a file no pane shows says it is back to disk and promises no u: the held store goes with its history', async () => {
  const files = { ...FILES, '/r/a.md': '# A\n\nThe first word here.\n' };
  await withFrame({ files, open: ['/r/plan.md'] }, async (page) => {
    await page.waitForSelector('[data-marxy-pane="0"] .marxy-article h1');
    await page.evaluate(() => window.__marxyHandle.frame().left.show('search', { q: 'first', scope: 'grep' }, false));
    await page.waitForSelector('.marxy-drawer input[data-marxy-left-field="search-r"]');
    await page.fill('.marxy-drawer input[data-marxy-left-field="search-r"]', 'last');
    await page.waitForFunction(() => /^Stage/.test(document.querySelector('.marxy-drawer .marxy-l-btns button.marxy-l-pri')?.textContent ?? ''));
    await page.click('.marxy-drawer .marxy-l-btns button.marxy-l-pri');
    await page.waitForFunction(() => /Staged/.test([...document.querySelectorAll('.marxy-notice-text')].map((n) => n.textContent).join(' ')));
    const said = await page.evaluate(async () => {
      const { discardAll } = await import('/src/changes/page.ts');
      const stores = window.__marxyHandle.panes().stores;
      const out = [];
      for (const p of ['/r/a.md', '/r/plan.md']) {
        await discardAll(stores.held(p));
        out.push([...document.querySelectorAll('.marxy-notice-text')].map((n) => n.textContent).filter((t) => t.startsWith('Back to what is on disk')).pop() ?? '');
      }
      return out;
    });
    assert.equal(said[0], 'Back to what is on disk', 'a.md, in no pane: no u to promise');
    assert.match(said[1], /u undoes that too/, 'plan.md, shown: u undoes it');
  });
});
