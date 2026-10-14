// The Settings page (W-12, ADR-0075), as the reader sees it: the full app on the shipped skeleton and CSS over the memory shell, in
// WebKit. It is opened the way a reader opens it (`Mod+,`), searched, changed and reset through its own controls; the file it edits is
// the memory shell's `/config`. The schema's rules are packages/theme/src/settings-schema.test.ts, the privacy table's are
// src/settings/privacy.test.ts, and the byte rules of a line write are config.test.ts and src/settings/page.test.ts.
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
const openByKey = async (page) => {
  await page.keyboard.press('Meta+Comma');
  await page.waitForSelector('[data-marxy-settings]');
  await settle(page, 80);
};
const rowKeys = (page) => page.evaluate(() => [...document.querySelectorAll('[data-marxy-setting]')].map((r) => r.getAttribute('data-marxy-setting')));
const category = async (page, id) => {
  await page.click(`[data-marxy-category="${id}"]`);
  await settle(page, 80);
};
const search = async (page, text) => {
  await page.fill('.marxy-settings-field', text);
  await settle(page, 120);
};
const row = (key) => `[data-marxy-setting="${key}"]`;
const pillTexts = (page) => page.evaluate(() => [...document.querySelectorAll('.marxy-settings-notices .marxy-notice-text')].map((n) => n.textContent));

test('Mod+, opens Settings, unfolding a folded window; the categories are the card\'s, and Collections, which has no key, is not drawn', async () => {
  await withPage(async (page) => {
    assert.equal(await page.evaluate(() => window.__marxyHandle.workspace().mode), 'folded');
    await openByKey(page);
    assert.equal(await page.evaluate(() => window.__marxyHandle.workspace().mode), 'unfolded', 'a folded window is unfolded for it');
    const state = await page.evaluate(() => {
      const main = document.getElementById('marxy-main');
      const page = document.querySelector('[data-marxy-settings]');
      const r = page.getBoundingClientRect();
      const at = document.elementFromPoint(r.x + r.width / 2, r.y + 120);
      return {
        hidden: main.hidden,
        inert: main.inert,
        covered: page.contains(at),
        height: r.height,
        width: r.width,
        categories: [...document.querySelectorAll('[data-marxy-category]')].map((b) => b.querySelector('.marxy-settings-nav-title').textContent),
        focus: document.activeElement.getAttribute('aria-label'),
        name: page.getAttribute('aria-label'),
      };
    });
    assert.deepEqual(state.categories, ['General', 'Appearance', 'Reading', 'Source', 'Content types', 'Accessibility', 'Privacy', 'Advanced']);
    assert.equal(state.hidden, true);
    assert.equal(state.inert, true);
    assert.equal(state.covered, true, 'the page, not a pane, is what is at its centre');
    assert.ok(state.height > 300 && state.width > 600, `the page fills the panes' cell (${state.width} x ${state.height})`);
    assert.equal(state.name, 'Settings');
    assert.equal(state.focus, 'Search settings', 'the search field has focus');
    // Each category shows only keys that exist: the Reading ones are the three of config.toml.
    await category(page, 'reading');
    assert.deepEqual(await rowKeys(page), ['size', 'measure', 'typeset']);
    // The menu's door is the same command: running it again does not open a second page.
    await page.evaluate(() => window.__cmd('view.settings'));
    assert.equal(await page.evaluate(() => document.querySelectorAll('[data-marxy-settings]').length), 1);
    // Folding hides the page with the rest.
    await page.evaluate(() => window.__marxyHandle.workspace().fold());
    assert.equal(await isOpen(page), false);
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
    assert.match(await page.locator('.marxy-settings-empty').textContent(), /No setting matches/);
    // Esc clears the search first, and the next Esc closes the page.
    await page.keyboard.press('Escape');
    assert.equal(await page.inputValue('.marxy-settings-field'), '');
    assert.equal(await isOpen(page), true);
    await page.keyboard.press('Escape');
    assert.equal(await isOpen(page), false);
    assert.equal(await page.evaluate(() => document.getElementById('marxy-main').hidden), false);
  });
});

test('a changed value carries the dot already in the file: size = 22 is changed, the others are not; the nav counts them', async () => {
  await withPage(async (page) => {
    await openByKey(page);
    assert.match(await page.locator('.marxy-settings-count').textContent(), /2 changed/);
    await category(page, 'reading');
    assert.equal(await page.locator(`${row('size')} [data-marxy-dot]`).count(), 1);
    assert.equal(await page.locator(`${row('measure')} [data-marxy-dot]`).count(), 0);
    assert.match(await page.locator(`${row('size')} .marxy-setting-meta`).textContent(), /Changed/);
    // Resetting it removes its line, comment and all, and nothing else; Undo puts it back.
    await page.click(`${row('size')} [data-marxy-dot]`);
    await settle(page, 200);
    assert.equal(await config(page), CONFIG.replace('size = 22   # my eyes\n', ''));
    assert.ok((await pillTexts(page)).some((t) => /Reset Text size/.test(t)));
    await page.click('.marxy-settings-notices .marxy-notice-action');
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
    await page.locator(`${row('theme')} select`).selectOption('ink');
    await settle(page, 400);
    assert.match(await config(page), /\ntheme = "ink"\n/);
    assert.equal(await page.evaluate(async () => (await import('/src/theme/user-theme.ts')).currentThemeName()), 'ink');
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
    assert.deepEqual(stored.map((s) => s.id), ['config', 'collection', 'positions', 'history', 'trust', 'workspace', 'layout', 'kinds', 'index', 'versions']);
    const by = Object.fromEntries(stored.map((s) => [s.id, s]));
    assert.match(by.config.size, /\d+ B$/);
    assert.match(by.positions.size, /^\d+(\.\d)? (B|KB)$/, 'a size as the folder reports it');
    assert.equal(by.kinds.size, 'not written yet', 'a file Marxy has not written says so');
    assert.match(by.versions.size, /^of \d+ files?, /, 'versions are counted by the files they are of');
    assert.ok(by.positions.path.endsWith('/positions.json') && by.positions.path.startsWith('/data'), by.positions.path);
    const leaves = await page.evaluate(() => [...document.querySelectorAll('[data-marxy-leave]')].map((li) => li.getAttribute('data-marxy-leave')));
    assert.deepEqual(leaves, ['open-link', 'remote-image', 'clipboard']);
    assert.equal(await page.locator('[data-marxy-leave="remote-image"] .marxy-settings-leave-status').textContent(), 'Not built yet');
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
    assert.equal(await isOpen(page), false, 'the page gives the panes back');
    assert.equal(await page.evaluate(() => window.__marxyHandle.currentPath()), '/config');
  });
});

test('the panes come back as they were: the reading position survives the round trip, and the text under the page never moved', async () => {
  await withPage(async (page) => {
    await page.evaluate(() => window.__marxyHandle.workspace().unfold());
    await settle(page, 300);
    await page.evaluate(() => window.scrollTo(0, 420));
    await settle(page, 150);
    const before = await page.evaluate(() => ({ y: window.scrollY, top: [...document.querySelectorAll('#doc p')].find((p) => p.getBoundingClientRect().top > 0)?.getBoundingClientRect().top }));
    await page.evaluate(() => window.__cmd('view.settings'));
    await page.waitForSelector('[data-marxy-settings]');
    await category(page, 'reading');
    await page.keyboard.press('Escape');
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
