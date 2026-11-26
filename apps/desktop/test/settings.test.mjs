// The Settings page, as the reader sees it: the full app on the shipped skeleton and CSS over the memory shell, in
// WebKit. It is opened the way a reader opens it (`Mod+,`), searched, changed and reset through its own controls; the file it edits is
// the memory shell's `/config`. The schema's rules are packages/theme/src/settings-schema.test.ts, the privacy table's are
// src/settings/privacy.test.ts, and the byte rules of a line write are config.test.ts and src/settings/page.test.ts.
// Settings is a branch of the drawer (src/settings/settings.ts): one scroll of groups, a category each, under a
// search field, beside the page rather than over it, and its notices are the app's own. `category` reads one group.
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

const para = (word) => `${word} runs long enough to wrap across several lines of the column, so the page is tall enough to scroll. `;
const files = {
  '/r/A.md': `# Alpha\n\n${para('Alpha').repeat(14)}\n\n## Later\n\n${para('Later').repeat(14)}\n`,
  '/r/code.ts': 'export const a = 1;\n\tconst b = 2;  \n',
};
/** A commented config.toml of a reader who has used the file by hand: the page must keep every byte of it that it does not change. */
const CONFIG = '# Marxy configuration. Edit freely; Marxy re-reads this file when it changes.\n\n# the size I like\nsize = 22   # my eyes\n\nexternal_editor = "code --goto {file}:{line}"\ncolour = "teal"\n\n[linux]\nweight_offset = 75\n';

async function withPage(fn, { config = CONFIG, data = {}, width = 1280, height = 900, open = '/r/A.md' } = {}) {
  inGroup = null;
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width, height } });
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
    const all = { ...files, ...data, ...(config === null ? {} : { '/config': config }) };
    const encoded = Object.fromEntries(Object.entries(all).map(([path, text]) => [path, b64(text)]));
    await page.evaluate(
      async ({ encoded, open }) => {
        const bytes = {};
        for (const [path, text] of Object.entries(encoded)) bytes[path] = Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
        const { createMemoryShell } = await import('/src/shell/memory.ts');
        const { bootApplication } = await import('/src/main.ts');
        const handle = await bootApplication(createMemoryShell(bytes), { argv: [open] });
        await handle.ready;
        window.__marxyHandle = handle;
        window.__config = async () => new TextDecoder().decode(await handle.shell.readFile('/config'));
        window.__cmd = async (id) => {
          const { commands } = await import('/src/commands/index.ts');
          return commands().find((c) => c.id === id).run({ showNotice() {} });
        };
      },
      { encoded, open },
    );
    await fn(page);
  } finally {
    await browser.close();
  }
}

const settle = (page, ms = 250) => page.evaluate((t) => new Promise((r) => setTimeout(r, t)), ms);
const config = (page) => page.evaluate(() => window.__config());
const isOpen = (page) => page.evaluate(() => document.querySelector('[data-marxy-settings]') !== null);
const TITLES = { general: 'General', appearance: 'Appearance', reading: 'Reading', source: 'Source', types: 'Content types', accessibility: 'Accessibility', privacy: 'Privacy', proposals: 'Proposals', advanced: 'Advanced' };
/** The group `rowKeys` reads: every group is drawn at once, so a category is a group to look in, not a page to go to. */
let inGroup = null;
const openByKey = async (page) => {
  await page.keyboard.press('ControlOrMeta+Comma');
  await page.waitForSelector('[data-marxy-settings]');
  await settle(page, 80);
};
const rowKeys = (page) => page.evaluate((title) => {
  const groups = [...document.querySelectorAll('[data-marxy-settings] .marxy-settings-group')];
  const scope = title === null ? groups : groups.filter((g) => g.querySelector('.marxy-dlab span')?.textContent === title);
  return scope.flatMap((g) => [...g.querySelectorAll('[data-marxy-setting]')].map((r) => r.getAttribute('data-marxy-setting')));
}, inGroup);
const category = async (page, id) => {
  inGroup = TITLES[id];
  await page.locator('[data-marxy-settings] .marxy-settings-group', { has: page.locator('.marxy-dlab span', { hasText: TITLES[id] }) }).first().scrollIntoViewIfNeeded();
  await settle(page, 80);
};
const FIELD = '[data-marxy-settings] input[type="search"]';
const search = async (page, text) => {
  inGroup = null;
  await page.fill(FIELD, text);
  await settle(page, 120);
};
const row = (key) => `[data-marxy-setting="${key}"]`;
const pillTexts = (page) => page.evaluate(() => [...document.querySelectorAll('.marxy-notice-text')].map((n) => n.textContent));

test('Mod+, unfolds a folded window and shows Settings in the drawer', async () => {
  await withPage(async (page) => {
    await page.evaluate(() => window.__marxyHandle.frame().fold());
    await openByKey(page);
    assert.equal(await page.evaluate(() => (window.__marxyHandle.frame().folded ? 'folded' : 'unfolded')), 'unfolded', 'a folded window is unfolded for it');
    assert.equal(await page.evaluate(() => document.querySelector('.marxy-drawer')?.dataset.marxyBranch ?? null), 'settings');
  });
});

test('Mod+, opens Settings in the drawer beside the page (a hosted branch, `[data-marxy-branch=settings]`); its groups are the card categories, and Collections, which has no key, is not drawn', async () => {
  await withPage(async (page) => {
    await openByKey(page);
    await page.waitForSelector('.marxy-drawer[data-marxy-branch="settings"] [data-marxy-settings]');
    const state = await page.evaluate(() => {
      const main = document.getElementById('marxy-main');
      const settings = document.querySelector('[data-marxy-settings]');
      return {
        branch: document.querySelector('.marxy-drawer')?.dataset.marxyBranch ?? null,
        inDrawer: document.querySelector('.marxy-drawer')?.contains(settings) ?? false,
        hidden: main.hidden,
        inert: main.inert,
        groups: [...settings.querySelectorAll('.marxy-settings-group > .marxy-dlab span')].map((t) => t.textContent),
        region: settings.querySelector('.marxy-settings-pane')?.getAttribute('aria-label'),
      };
    });
    assert.equal(state.branch, 'settings');
    assert.equal(state.inDrawer, true, 'Settings is a branch of the drawer');
    assert.equal(state.hidden, false, 'the page stays beside it');
    assert.equal(state.inert, false);
    assert.deepEqual(state.groups, ['General', 'Appearance', 'Reading', 'Source', 'Content types', 'Accessibility', 'Privacy', 'Proposals', 'Advanced']);
    assert.equal(state.region, 'Settings');
    // Each category shows only keys that exist: the Reading ones are the four of config.toml.
    await category(page, 'reading');
    assert.deepEqual(await rowKeys(page), ['size', 'measure', 'typeset', 'verbs']);
    // The chord is the branch's own press: again goes back to the panel, and a third press draws it once.
    await page.keyboard.press('ControlOrMeta+Comma');
    await page.waitForFunction(() => document.querySelector('[data-marxy-settings]') === null && document.querySelector('.marxy-drawer')?.dataset.marxyLeft === 'places');
    await openByKey(page);
    assert.equal(await page.evaluate(() => document.querySelectorAll('[data-marxy-settings]').length), 1);
    // Folding hides it with the rest of the frame.
    await page.evaluate(() => window.__marxyHandle.frame().fold());
    await page.waitForFunction(() => document.querySelector('[data-marxy-settings]')?.checkVisibility() !== true);
    assert.equal(await page.evaluate(() => document.getElementById('marxy-main').hidden), false);
  });
});

test('typing "whitespace" shows Show whitespace; turning it on writes one line, Source shows whitespace at once, the dot appears, and clicking it restores the file\'s bytes exactly', async () => {
  await withPage(async (page) => {
    // Source is the pane's mode, so there is an editor to show it in.
    await page.evaluate(() => window.__marxyHandle.open('/r/code.ts'));
    await page.evaluate(() => window.__cmd('view.mode-source'));
    await page.waitForFunction(() => document.body.dataset.marxyMode === 'source');
    await page.waitForSelector('.cm-editor');
    const marks = () => page.evaluate(async () => {
      const { activeSourceEditor, hasWhitespaceMarks } = await import('/src/source/editor.ts');
      const editor = activeSourceEditor();
      return editor ? hasWhitespaceMarks(editor.view) : null;
    });
    assert.equal(await marks(), false);
    await openByKey(page);
    await search(page, 'whitespace');
    assert.deepEqual(await rowKeys(page), ['show_whitespace'], 'only the setting that matches');
    assert.equal(await page.locator(`${row('show_whitespace')} .marxy-setting-label`).textContent(), 'Show whitespace');
    assert.equal(await page.locator(`${row('show_whitespace')} [data-marxy-dot]`).count(), 0, 'unchanged: no dot');
    await page.locator(`${row('show_whitespace')} input[role="switch"]`).check();
    await settle(page, 200);
    assert.equal(await config(page), CONFIG.replace('[linux]', 'show_whitespace = true\n[linux]'),
      'one line is added before the first table, and no other byte moves');
    assert.equal(await marks(), true, 'the Source pane shows whitespace at once');
    assert.equal(await page.locator(`${row('show_whitespace')} [data-marxy-dot]`).count(), 1, 'the dot appears');
    assert.equal(await page.locator(`${row('show_whitespace')} [data-marxy-dot]`).getAttribute('aria-label'), 'Reset Show whitespace to its default, Off');
    await page.click(`${row('show_whitespace')} [data-marxy-dot]`);
    await settle(page, 200);
    assert.equal(await config(page), CONFIG, 'the file\'s bytes are exactly what they were');
    assert.equal(await marks(), false);
    assert.equal(await page.locator(`${row('show_whitespace')} [data-marxy-dot]`).count(), 0);
  });
});

test('search finds a setting by its words and by its key, across every category, and says how a key or word matched', async () => {
  await withPage(async (page) => {
    await openByKey(page);
    await search(page, 'font');
    assert.ok((await rowKeys(page)).includes('size'), 'a hidden word of Text size');
    await search(page, 'copy_format');
    assert.deepEqual(await rowKeys(page), ['copy_format']);
    await search(page, 'contrast');
    assert.ok((await rowKeys(page)).includes('contrast'));
    await search(page, 'zzzz');
    assert.deepEqual(await rowKeys(page), []);
    assert.match(await page.locator('[data-marxy-settings] .marxy-settings-pane > .marxy-dnote').textContent(), /No setting matches/);
    // Esc clears the search, and leaves Settings up. A docked drawer is not closed by Esc (frame.ts closes
    // only a drawer over the page; frame-drawer holds that).
    await page.keyboard.press('Escape');
    assert.equal(await page.inputValue(FIELD), '');
    assert.equal(await isOpen(page), true);
  });
});

test('a changed value carries the dot already in the file: size = 22 is changed, the others are not; the nav counts them', async () => {
  await withPage(async (page) => {
    await openByKey(page);
    assert.match(await page.locator('.marxy-settings-count').textContent(), /2 settings changed/);
    await category(page, 'reading');
    assert.equal(await page.locator(`${row('size')} [data-marxy-dot]`).count(), 1);
    assert.equal(await page.locator(`${row('measure')} [data-marxy-dot]`).count(), 0);
    assert.match(await page.locator(`${row('size')} .marxy-setting-meta`).textContent(), /Changed/);
    // Resetting it removes its line, comment and all, and nothing else; Undo puts it back.
    await page.click(`${row('size')} [data-marxy-dot]`);
    await settle(page, 200);
    assert.equal(await config(page), CONFIG.replace('size = 22   # my eyes\n', ''));
    assert.ok((await pillTexts(page)).some((t) => /Reset Text size/.test(t)));
    await page.click('.marxy-notice .marxy-notice-action');
    await settle(page, 200);
    assert.equal(await config(page), CONFIG, 'Undo puts the line back exactly, its comment included');
  });
});

test('Typeset off disables Measure, and the control says why', async () => {
  await withPage(async (page) => {
    await openByKey(page);
    await category(page, 'reading');
    assert.equal(await page.locator(`${row('measure')} input[type="range"]`).isDisabled(), false);
    await page.locator(`${row('typeset')} input[role="switch"]`).uncheck();
    await settle(page, 200);
    assert.match(await config(page), /typeset = false/);
    assert.equal(await page.locator(`${row('measure')} input[type="range"]`).isDisabled(), true);
    const why = await page.locator(`${row('measure')} .marxy-setting-why`).textContent();
    assert.match(why, /Needs Typeset/);
    // The reason is tied to the control for assistive technology.
    const described = await page.locator(`${row('measure')} input[type="range"]`).getAttribute('aria-describedby');
    assert.ok(described.split(' ').some((id) => id.endsWith('-why')));
    await page.locator(`${row('typeset')} input[role="switch"]`).check();
    await settle(page, 200);
    assert.equal(await page.locator(`${row('measure')} input[type="range"]`).isDisabled(), false);
    // The column guide's rule is a sentence, not a switch.
    await category(page, 'source');
    assert.match(await page.locator(`${row('column_guide')} .marxy-setting-note`).textContent(), /\.editorconfig/);
  });
});

test('Measure and Variant are applied at once, and written as one line each', async () => {
  await withPage(async (page) => {
    await openByKey(page);
    await category(page, 'reading');
    await page.locator(`${row('measure')} input[type="range"]`).fill('58');
    await settle(page, 250);
    assert.match(await config(page), /\nmeasure = 58\n/);
    assert.equal(await page.evaluate(() => document.documentElement.style.getPropertyValue('--marxy-measure-chars')), '58');
    await category(page, 'appearance');
    await page.locator(`${row('variant')} input[value="light"]`).check();
    await settle(page, 250);
    assert.match(await config(page), /\nvariant = "light"\n/);
    assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-marxy-variant') ?? document.body.getAttribute('data-marxy-variant')), 'light');
    // Ink is the default: the choice that writes a line is another theme.
    assert.equal(await page.locator(`${row('theme')} select`).inputValue(), '');
    await page.locator(`${row('theme')} select`).selectOption('night-paper');
    await settle(page, 400);
    assert.match(await config(page), /\ntheme = "night-paper"\n/);
    assert.equal(await page.evaluate(async () => (await import('/src/theme/user-theme.ts')).currentThemeName()), 'night-paper');
  });
});

test('a hand edit to config.toml shows on the page at once, and an unknown key is kept and listed under Advanced', async () => {
  await withPage(async (page) => {
    await openByKey(page);
    await category(page, 'source');
    assert.equal(await page.locator(`${row('show_whitespace')} input[role="switch"]`).isChecked(), false);
    await page.evaluate(() => {
      const h = window.__marxyHandle;
      h.shell.plant('/config', new TextEncoder().encode('show_whitespace = true\n# by hand\n'));
      h.shell.emit([{ kind: 'modified', path: '/config' }]);
    });
    await page.waitForFunction(() => document.querySelector('[data-marxy-setting="show_whitespace"] input[role="switch"]')?.checked === true);
    assert.equal(await page.locator(`${row('show_whitespace')} [data-marxy-dot]`).count(), 1);
    await page.evaluate(() => {
      const h = window.__marxyHandle;
      h.shell.plant('/config', new TextEncoder().encode('colour = "teal"\nshow_whitespace = true\n'));
      h.shell.emit([{ kind: 'modified', path: '/config' }]);
    });
    await category(page, 'advanced');
    await page.waitForFunction(() => document.querySelector('.marxy-settings-advanced')?.textContent.includes('colour'));
    assert.match(await page.locator('.marxy-settings-advanced').textContent(), /Kept as they are.*colour/);
    // A change made now writes over the file as it is, so the unknown key survives.
    await category(page, 'source');
    await page.locator(`${row('show_whitespace')} [data-marxy-dot]`).click();
    await settle(page, 200);
    assert.equal(await config(page), 'colour = "teal"\n');
  });
});

test('a config.toml that changed on disk since the page showed it is never overwritten: the change is refused, the page shows the file and says so', async () => {
  await withPage(async (page) => {
    await openByKey(page);
    await category(page, 'source');
    // Another program writes the file and the page has not heard (no event), then the reader changes a setting.
    const theirs = '# written by another program\nsize = 30\n';
    await page.evaluate((t) => window.__marxyHandle.shell.plant('/config', new TextEncoder().encode(t)), theirs);
    // One click: `check()` would click again when the control springs back to what the file says.
    await page.locator(`${row('show_whitespace')} input[role="switch"]`).click();
    await settle(page, 300);
    assert.equal(await config(page), theirs, 'not a byte of their file was overwritten');
    assert.ok((await pillTexts(page)).some((t) => /changed on disk/.test(t) && /Show whitespace was not changed/.test(t)), (await pillTexts(page)).join(' | '));
    assert.equal(await page.locator(`${row('show_whitespace')} input[role="switch"]`).isChecked(), false, 'the control shows the file, not the refused change');
    // The page shows the file as it is now: size = 30 is the one change.
    await category(page, 'reading');
    assert.equal(await page.locator(`${row('size')} input[type="range"]`).inputValue(), '30');
  });
});

test('Privacy is computed: each file Marxy keeps with its path and size, what can leave this Mac, and the sentence; Clear all versions asks first and says it is permanent', async () => {
  const sha = 'c'.repeat(40);
  await withPage(async (page) => {
    await openByKey(page);
    await category(page, 'privacy');
    await page.waitForSelector('[data-marxy-stored]');
    const stored = await page.evaluate(() => [...document.querySelectorAll('[data-marxy-stored]')].map((li) => ({
      id: li.getAttribute('data-marxy-stored'),
      name: li.querySelector('.marxy-settings-stored-name').textContent,
      size: li.querySelector('.marxy-settings-stored-size').textContent,
      path: li.querySelector('.marxy-settings-stored-path').textContent,
    })));
    assert.deepEqual(stored.map((s) => s.id), ['config', 'collection', 'positions', 'history', 'trust', 'workspace', 'layout', 'kinds', 'readings', 'index', 'versions']);
    const by = Object.fromEntries(stored.map((s) => [s.id, s]));
    assert.match(by.config.size, /\d+ B$/);
    assert.match(by.positions.size, /^\d+(\.\d)? (B|KB)$/, 'a size as the folder reports it');
    assert.equal(by.kinds.size, 'not written yet', 'a file Marxy has not written says so');
    assert.match(by.versions.size, /^of \d+ files?, /, 'versions are counted by the files they are of');
    assert.ok(by.positions.path.endsWith('/positions.json') && by.positions.path.startsWith('/data'), by.positions.path);
    const leaves = await page.evaluate(() => [...document.querySelectorAll('[data-marxy-leave]')].map((li) => li.getAttribute('data-marxy-leave')));
    assert.deepEqual(leaves, ['open-link', 'remote-image', 'clipboard']);
    // A message's images are fetched through the shell on request now: the row is built and carries no status.
    assert.equal(await page.locator('[data-marxy-leave="remote-image"] .marxy-settings-leave-status').count(), 0);
    assert.equal(await page.locator('.marxy-settings-nothing-else').textContent(), 'Nothing else leaves this Mac.');
    // Read-only: nothing on the page writes a stored file, and the one Clear asks first.
    const before = await page.evaluate(async (v) => (await window.__marxyHandle.shell.readFile(`/data/versions-${v}.json`)).length, sha);
    await page.click('[data-marxy-clear="ask"]');
    const ask = await page.locator('.marxy-settings-clear-ask').textContent();
    assert.match(ask, /permanent/);
    assert.match(ask, /Your documents are not touched/);
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('data-marxy-clear')), 'cancel', 'Cancel is the default');
    await page.click('[data-marxy-clear="cancel"]');
    assert.equal(await page.evaluate(async (v) => (await window.__marxyHandle.shell.readFile(`/data/versions-${v}.json`)).length, sha), before, 'cancelled: nothing cleared');
    assert.equal(await page.locator('.marxy-settings-clear-ask').count(), 0);
  }, {
    data: {
      '/data/positions.json': ' '.repeat(1024),
      [`/data/versions-${sha}.json`]: '{"version":1}',
      [`/data/versions-${sha}-01`]: 'hello',
    },
  });
});

test('the versions row in Privacy: turning it off writes versions = false and its dot restores the file', async () => {
  await withPage(async (page) => {
    await openByKey(page);
    await category(page, 'privacy');
    await page.locator(`${row('versions')} input[role="switch"]`).uncheck();
    await settle(page, 200);
    assert.match(await config(page), /\nversions = false\n/);
    await page.click(`${row('versions')} [data-marxy-dot]`);
    await settle(page, 200);
    assert.equal(await config(page), CONFIG);
  });
});

test('Advanced opens config.toml itself in Source', async () => {
  await withPage(async (page) => {
    await openByKey(page);
    await category(page, 'advanced');
    await page.click('[data-marxy-advanced="open-source"]');
    await page.waitForFunction(() => document.body.dataset.marxyMode === 'source');
    // The drawer is beside the pane, so there are no panes to give back: config.toml is in the pane.
    assert.equal(await page.evaluate(() => window.__marxyHandle.currentPath()), '/config');
  });
});

test('the panes come back as they were: the reading position survives the round trip, and the text under the page never moved', async () => {
  await withPage(async (page) => {
    await page.evaluate(() => window.__marxyHandle.frame().unfold());
    await settle(page, 300);
    await page.evaluate(() => window.scrollTo(0, 420));
    await settle(page, 150);
    const before = await page.evaluate(() => ({ y: window.scrollY, top: [...document.querySelectorAll('#doc p')].find((p) => p.getBoundingClientRect().top > 0)?.getBoundingClientRect().top }));
    await openByKey(page);
    await category(page, 'reading');
    // A docked drawer closes by its own chord (Esc closes only one over the page).
    await page.keyboard.press('ControlOrMeta+Comma');
    await page.waitForFunction(() => document.querySelector('[data-marxy-settings]') === null);
    await settle(page, 150);
    const after = await page.evaluate(() => ({ y: window.scrollY, top: [...document.querySelectorAll('#doc p')].find((p) => p.getBoundingClientRect().top > 0)?.getBoundingClientRect().top }));
    assert.deepEqual(after, before);
  });
});

test('with no config.toml the page shows the defaults and the first change creates the file', async () => {
  await withPage(async (page) => {
    await openByKey(page);
    assert.match(await page.locator('.marxy-settings-count').textContent(), /nothing changed/);
    await category(page, 'advanced');
    assert.equal(await page.locator('[data-marxy-advanced="open-source"]').isDisabled(), true, 'there is no file to open yet');
    await category(page, 'source');
    await page.locator(`${row('show_whitespace')} input[role="switch"]`).check();
    await settle(page, 200);
    assert.equal(await config(page), 'show_whitespace = true\n');
    await category(page, 'advanced');
    assert.equal(await page.locator('[data-marxy-advanced="open-source"]').isDisabled(), false);
  }, { config: null });
});

test('a hand-written multi-line value survives: resetting External editor takes the whole string out, and a toggle never lands inside an array', async () => {
  const text = 'external_editor = """\ncode --goto {file}\n[not_a_table]\n"""\nmatrix = [\n  [1, 2],\n  [3, 4]\n]\nsize = 22\n';
  await withPage(async (page) => {
    await openByKey(page);
    await search(page, 'external editor');
    await page.click(`${row('external_editor')} [data-marxy-dot]`);
    await settle(page, 250);
    assert.equal(await config(page), 'matrix = [\n  [1, 2],\n  [3, 4]\n]\nsize = 22\n', 'the whole string went, nothing else');
    await search(page, 'whitespace');
    await page.locator(`${row('show_whitespace')} input[role="switch"]`).click();
    await settle(page, 250);
    assert.equal(await config(page), 'matrix = [\n  [1, 2],\n  [3, 4]\n]\nsize = 22\nshow_whitespace = true\n', 'appended after the array, not inside it');
  }, { config: text });
});

test('a config.toml that is not valid TOML is never written to, from any category, and the page says so once', async () => {
  const bad = 'size = 22\nname = "unterminated\n# c\n';
  await withPage(async (page) => {
    await openByKey(page);
    assert.ok((await pillTexts(page)).some((t) => /cannot be read/.test(t) && /nothing will be written|Nothing will be written/.test(t)), (await pillTexts(page)).join(' | '));
    for (const [cat, key, selector] of [['source', 'show_whitespace', 'input[role="switch"]'], ['reading', 'typeset', 'input[role="switch"]']]) {
      await category(page, cat);
      assert.match(await page.locator('.marxy-settings-warning').textContent(), /not valid TOML/, `the warning is under ${cat} too`);
      await page.locator(`${row(key)} ${selector}`).click();
      await settle(page, 200);
      assert.equal(await config(page), bad, `${key}: not a byte written`);
    }
    await search(page, 'whitespace');
    assert.match(await page.locator('.marxy-settings-warning').textContent(), /not valid TOML/, 'and in search results');
    assert.equal((await pillTexts(page)).filter((t) => /cannot be read/.test(t)).length, 1, 'one notice, however many attempts');
  }, { config: bad });
});

test('a measure the reader wrote applies to every kind, over the kind\'s own; unset, each kind keeps its own', async () => {
  const widths = {};
  for (const [name, config] of [['unset', null], ['50', 'measure = 50\n'], ['80', 'measure = 80\n']]) {
    await withPage(async (page) => {
      widths[name] = await page.evaluate(async () => {
        const out = {};
        for (const kind of ['article', 'readme', 'report', 'transcript']) {
          for (const el of document.querySelectorAll('[data-marxy-kind]')) el.setAttribute('data-marxy-kind', kind);
          await new Promise((r) => setTimeout(r, 60));
          out[kind] = document.querySelector('#doc > p').getBoundingClientRect().width;
        }
        return out;
      });
    }, { config });
  }
  for (const kind of ['article', 'readme', 'report', 'transcript']) {
    const ratio = widths['80'][kind] / widths['50'][kind];
    assert.ok(ratio > 1.5 && ratio < 1.7, `${kind}: 80 characters is about 1.6 times 50 (${widths['50'][kind]} px to ${widths['80'][kind]} px)`);
    assert.notEqual(Math.round(widths.unset[kind]), Math.round(widths['50'][kind]), `${kind}: unset is not 50`);
  }
  // Unset, the kinds keep their own measures, read against the 50 in the same kind. Every prose kind has one
  // setting, 66 average characters (packages/theme/default/theme.css).
  const own = { article: 66, readme: 66, report: 66, transcript: 66 };
  for (const [kind, chars] of Object.entries(own)) {
    const effective = (50 * widths.unset[kind]) / widths['50'][kind];
    assert.ok(Math.abs(effective - chars) < 3, `${kind} keeps its own measure unset: about ${chars} characters, measured ${effective.toFixed(1)}`);
  }
});
