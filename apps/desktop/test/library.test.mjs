// The library view (Q-03), as the reader sees it: the full app on the shipped skeleton and CSS over the memory shell,
// in WebKit. The palette's own feed is the library's (`handle.palette.setIndexEntries`), so the view is reached the way
// a reader reaches it: the command `library.open` from the unfolded window. The evaluator's rules are
// query-eval.test.ts; the scopes, rows and the bounded reader have their own node tests beside them.
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
  '/r/plans/cache-plan.md': `# Cache plan\n\n## Cache layout\n\nWe keep the cache warm.\n\n- [ ] size the cache\n`,
  '/r/plans/notes.md': `# Planning notes\n\nBefore anything, the cache is warm by default.\nA second line that mentions the CACHE in capitals.\n`,
  '/r/plans/big-report.md': `# Big report\n\n${'word '.repeat(900)}\n`,
  '/r/plans/small-report.md': `# Small report\n\nfew words here\n`,
  '/r/plans/long-report.md': `# Long report\n\n${'word '.repeat(70_000)}\n`,
  '/r/src/app.ts': 'export const a = 1;\n',
  '/r/standup.md': '# Standup\n\nnothing\n',
};
const KINDS = { 'big-report': 'report', 'small-report': 'report', 'long-report': 'report', 'cache-plan': 'report', notes: 'notes', 'app.ts': 'code' };
const entries = Object.keys(files).map((path, i) => {
  const name = path.split('/').pop().replace(/\.md$/, '');
  return {
    path,
    root: '/r',
    title: files[path].match(/^# (.*)$/m)?.[1] ?? name,
    headings: [...files[path].matchAll(/^(#{1,6}) (.*)$/gm)].map((m, k) => ({ level: m[1].length, text: m[2], byteOffset: k })),
    mtimeMs: Date.now() - (i + 1) * 3_600_000,
    size: new TextEncoder().encode(files[path]).length,
    kind: path.endsWith('.ts') ? 'source' : 'markdown',
    readerKind: KINDS[name] ?? 'article',
  };
});

async function withPage(fn, { width = 1280, height = 900, open = '/r/A.md', extraEntries = [], data = {} } = {}) {
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
    const encoded = Object.fromEntries(Object.entries({ ...files, ...data }).map(([path, text]) => [path, b64(text)]));
    await page.evaluate(
      async ({ encoded, entries, open, extra }) => {
        const bytes = {};
        for (const [path, text] of Object.entries(encoded)) bytes[path] = Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
        const { createMemoryShell } = await import('/src/shell/memory.ts');
        const { bootApplication } = await import('/src/main.ts');
        const handle = await bootApplication(createMemoryShell(bytes), { argv: [open] });
        await handle.ready;
        window.__marxyHandle = handle;
        handle.palette.setIndexEntries([...entries, ...extra]);
        await handle.collection?.loaded;
        window.__library = async () => {
          const { commands } = await import('/src/commands/index.ts');
          return commands().find((c) => c.id === 'library.open');
        };
      },
      { encoded, entries, open, extra: extraEntries },
    );
    await fn(page);
  } finally {
    await browser.close();
  }
}

const unfold = (page) => page.evaluate(() => window.__marxyHandle.workspace().unfold());
const settle = (page, ms = 250) => page.evaluate((t) => new Promise((r) => setTimeout(r, t)), ms);
const commandOffered = (page) => page.evaluate(async () => (await window.__library()).when({}));
const openLibrary = async (page) => {
  await page.evaluate(async () => (await window.__library()).run({}));
  await page.waitForSelector('[data-marxy-library]');
  await settle(page, 60);
};
const view = (page) => page.evaluate(() => document.querySelector('[data-marxy-library]') !== null);
const type = async (page, text) => {
  await page.fill('.marxy-library-field', text);
  await settle(page);
};
const rowsOf = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('[data-marxy-library-row]')].map((r) => ({
      path: r.getAttribute('data-marxy-library-row'),
      title: r.querySelector('.marxy-library-row-name').textContent,
      why: [...r.querySelectorAll('.marxy-library-row-why')].map((w) => w.textContent),
      marks: [...r.querySelectorAll('.marxy-library-mark')].map((m) => m.textContent),
    })),
  );
const calls = (page, ...names) => page.evaluate((n) => window.__marxyHandle.shell.calls.filter((c) => n.includes(c.method)).map((c) => ({ method: c.method, path: c.args[0] })), names);
const paths = (page) => page.evaluate(() => window.__marxyHandle.panes().panes.map((p) => p.path()));

test('folded, the command is not offered and there is no library element; unfolded, it shows the view and hides the panes', async () => {
  await withPage(async (page) => {
    assert.equal(await commandOffered(page), false, 'folded: not offered');
    assert.equal(await page.evaluate(() => document.querySelectorAll('[data-marxy-library], .marxy-library').length), 0);
    await unfold(page);
    assert.equal(await commandOffered(page), true);
    await openLibrary(page);
    const state = await page.evaluate(() => {
      const main = document.getElementById('marxy-main');
      const lib = document.querySelector('[data-marxy-library]');
      const r = lib.getBoundingClientRect();
            const at = document.elementFromPoint(r.x + r.width / 2, r.y + 100);
      return { hidden: main.hidden, inert: main.inert, visibility: getComputedStyle(main).visibility, covered: lib.contains(at), libHeight: r.height, libWidth: r.width, name: lib.getAttribute('aria-label'), focus: document.activeElement.getAttribute('aria-label') };
    });
    assert.equal(state.hidden, true);
    assert.equal(state.inert, true);
    assert.equal(state.visibility, 'hidden', 'the panes keep their box and lose their paint');
    assert.equal(state.covered, true, 'what is at the centre of the cell is the library, not a pane');
    assert.ok(state.libHeight > 300 && state.libWidth > 600, `the view fills the panes' cell (${state.libWidth} x ${state.libHeight})`);
    assert.equal(state.name, 'Library');
    assert.equal(state.focus, 'Search the library', 'the field has focus');
    await page.evaluate(() => window.__marxyHandle.workspace().fold());
    assert.equal(await view(page), false, 'folding closes it');
    assert.equal(await page.evaluate(() => document.getElementById('marxy-main').hidden), false);
    assert.equal(await commandOffered(page), false);
  });
});

test('the panes come back as they were: a scroll position and an unsaved edit survive the round trip', async () => {
  await withPage(async (page) => {
    await unfold(page);
    await page.evaluate(() => window.scrollTo(0, 700));
    await settle(page, 100);
    const before = await page.evaluate(() => window.scrollY);
    assert.ok(before > 300, `scrolled (${before})`);
    const edited = await page.evaluate(async () => {
      const h = window.__marxyHandle;
      const store = h.panes().focused.content.store();
      const snap = store.snapshot();
      await h.dispatch({ type: 'apply', range: { start: snap.buffer.bytes.length, end: snap.buffer.bytes.length }, replacement: '\nTyped in the library test.\n', label: 'type', baseVersion: snap.version });
      return h.panes().focused.content.hasUnsavedChanges();
    });
    assert.equal(edited, true);
    await openLibrary(page);
    // While the view shows, the reading place is not written over: a quit now keeps the reader's place.
    const placeOnDisk = () => page.evaluate(async () => JSON.parse(new TextDecoder().decode(await window.__marxyHandle.shell.readFile('/data/positions.json'))).positions['/r/A.md']?.byteOffset);
    await settle(page, 2300);
    const during = await placeOnDisk().catch(() => 'none');
    assert.ok(during === 'none' || during > 0, `the place kept under the view (${during})`);
    assert.equal(await page.evaluate(() => window.scrollY), before, 'the window does not scroll or clamp under the view');
    await page.keyboard.press('Escape');
    await settle(page, 100);
    assert.equal(await view(page), false);
    assert.equal(await page.evaluate(() => window.scrollY), before, 'the page is where it was');
    assert.equal(await page.evaluate(() => window.__marxyHandle.panes().focused.content.hasUnsavedChanges()), true, 'the edit is still unsaved');
    assert.match(await page.evaluate(() => new TextDecoder().decode(window.__marxyHandle.panes().focused.content.store().snapshot().buffer.bytes)), /Typed in the library test/);
    assert.equal(await page.evaluate(() => document.getElementById('marxy-main').inert), false);
  });
});

test('a dirty Source pane keeps its text and its focus', async () => {
  await withPage(async (page) => {
    await unfold(page);
    await page.evaluate(() => window.__marxyHandle.toggleMode());
    await page.waitForSelector('.cm-content');
    await page.click('.cm-content');
    await page.keyboard.press('ControlOrMeta+ArrowUp');
    await page.keyboard.type('SOURCE-TYPED ');
    await settle(page, 100);
    await openLibrary(page);
    assert.equal(await page.evaluate(() => document.activeElement.className), 'marxy-library-field');
    await page.keyboard.press('Escape');
    await settle(page, 150);
    assert.equal(await view(page), false);
    const after = await page.evaluate(() => ({
      text: document.querySelector('.cm-content').textContent,
      focusInEditor: document.activeElement?.closest('.cm-editor') !== null,
      mode: window.__marxyHandle.panes().focused.view.mode,
    }));
    assert.match(after.text, /SOURCE-TYPED/);
    assert.equal(after.mode, 'source');
    assert.equal(after.focusInEditor, true, 'focus is back in the pane that had it');
    await page.keyboard.type('MORE');
    assert.match(await page.evaluate(() => document.querySelector('.cm-content').textContent), /SOURCE-TYPED.*MORE|MORE.*SOURCE-TYPED/, 'typing goes on in the editor');
  });
});

test('typing "cache" lists files by title, path, heading and a line, each with its reason', async () => {
  await withPage(async (page) => {
    await unfold(page);
    await openLibrary(page);
    assert.equal((await rowsOf(page)).length, entries.length, 'with nothing typed, every file');
    await type(page, 'cache');
    const rows = await rowsOf(page);
    const byPath = Object.fromEntries(rows.map((r) => [r.path, r.why]));
    assert.deepEqual(Object.keys(byPath).sort(), ['/r/plans/cache-plan.md', '/r/plans/notes.md']);
    assert.deepEqual(byPath['/r/plans/cache-plan.md'].slice(0, 3), ['title', 'path', 'heading "Cache layout"']);
    assert.match(byPath['/r/plans/cache-plan.md'][3], /^line 1: # Cache plan$/, 'the first line holding the word');
    assert.ok(byPath['/r/plans/notes.md'].some((w) => /^line 3: Before anything, the cache is warm/.test(w)), `a line with its number: ${byPath['/r/plans/notes.md']}`);
    assert.equal(rows[0].path, '/r/plans/cache-plan.md', 'relevance: the title match first');
    assert.match(await page.textContent('.marxy-library-status'), /2 of \d+ files/);
  });
});

test('a chip appears for kind:report, and its x removes the token and runs again', async () => {
  await withPage(async (page) => {
    await unfold(page);
    await openLibrary(page);
    await type(page, 'cache kind:report');
    const chips = await page.evaluate(() => [...document.querySelectorAll('[data-marxy-query-chip]')].map((c) => c.querySelector('.marxy-query-chip-text').textContent));
    assert.deepEqual(chips, ['cache', 'kind:report']);
    assert.deepEqual((await rowsOf(page)).map((r) => r.path), ['/r/plans/cache-plan.md']);
    await page.click('[aria-label="Remove kind:report"]');
    await settle(page);
    assert.equal(await page.inputValue('.marxy-library-field'), 'cache');
    assert.equal((await rowsOf(page)).length, 2);
    assert.equal(await page.evaluate(() => document.activeElement.className), 'marxy-library-field', 'the field keeps focus');
  });
});

test('an unknown key is an amber chip searched as text; is:archived says it is not available yet and matches nothing', async () => {
  await withPage(async (page) => {
    await unfold(page);
    await openLibrary(page);
    await type(page, 'model:x');
    let chip = await page.evaluate(() => {
      const c = document.querySelector('[data-marxy-query-chip]');
      return { flag: c.getAttribute('data-marxy-query-chip'), text: c.textContent, title: c.title };
    });
    assert.equal(chip.flag, 'flagged');
    assert.match(chip.text, /searched as text/);
    assert.equal((await rowsOf(page)).length, 0, 'nothing is called model:x');
    await type(page, 'is:archived');
    chip = await page.evaluate(() => ({ text: document.querySelector('[data-marxy-query-chip]').textContent }));
    assert.match(chip.text, /not available yet/);
    assert.equal((await rowsOf(page)).length, 0);
    // Q-06: is:dup is a filter now, not a flagged chip (this fixture holds no near copies).
    await type(page, 'is:dup');
    await settle(page, 300);
    chip = await page.evaluate(() => ({ flag: document.querySelector('[data-marxy-query-chip]').getAttribute('data-marxy-query-chip'), text: document.querySelector('[data-marxy-query-chip]').textContent }));
    assert.doesNotMatch(chip.text, /not available yet/);
    assert.equal(chip.flag, '');
    assert.equal((await rowsOf(page)).length, 0);
    await type(page, 'words:>');
    assert.match(await page.evaluate(() => document.querySelector('[data-marxy-query-chip]').textContent), /ignored/);
    assert.equal((await rowsOf(page)).length, entries.length, 'an incomplete value filters nothing');
  });
});

test('completions: a key is offered after a word, Tab accepts, arrows move', async () => {
  await withPage(async (page) => {
    await unfold(page);
    await openLibrary(page);
    await page.fill('.marxy-library-field', 'kin');
    await page.dispatchEvent('.marxy-library-field', 'click');
    const items = () => page.evaluate(() => [...document.querySelectorAll('.marxy-library-suggest-item')].map((i) => i.firstChild.textContent));
    assert.deepEqual(await items(), ['kind:']);
    await page.keyboard.press('Tab');
    assert.equal(await page.inputValue('.marxy-library-field'), 'kind:');
    assert.ok((await items()).includes('report'), `values after the key: ${await items()}`);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    const active = await page.evaluate(() => document.getElementById(document.querySelector('.marxy-library-field').getAttribute('aria-activedescendant')).textContent);
    assert.ok(active.length > 0);
    await page.keyboard.press('Tab');
    assert.match(await page.inputValue('.marxy-library-field'), /^kind:\w+$/);
  });
});

test('Return opens the row in the focused pane and closes the view; Alt+Return opens it in the other pane', async () => {
  // Wide enough for the docked panels and two columns.
  await withPage(async (page) => {
    await unfold(page);
    await openLibrary(page);
    await type(page, 'standup');
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), 'Results');
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-activedescendant')), 'marxy-library-row-0');
    await page.keyboard.press('Enter');
    await settle(page, 400);
    assert.equal(await view(page), false, 'closed');
    assert.deepEqual(await paths(page), ['/r/standup.md']);

    await openLibrary(page);
    await type(page, 'cache-plan');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Alt+Enter');
    await settle(page, 600);
    assert.equal(await view(page), false);
    assert.deepEqual(await paths(page), ['/r/standup.md', '/r/plans/cache-plan.md'], 'beside, in the other pane');
    assert.equal(await page.evaluate(() => window.__marxyHandle.panes().focused.slot), 1);
  }, { width: 1900 });
});

test('Alt+Return in a window too narrow for two columns says so in the view and opens nothing', async () => {
  await withPage(async (page) => {
    await unfold(page);
    await openLibrary(page);
    await type(page, 'cache-plan');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Alt+Enter');
    await settle(page, 200);
    assert.equal(await view(page), true, 'still open');
    assert.match(await page.textContent('.marxy-library-status'), /needs a window at least \d+ px wide/);
    assert.deepEqual(await paths(page), ['/r/A.md']);
  }, { width: 1280 });
});

test('Esc clears the field, then closes the view with focus on the pane that had it', async () => {
  await withPage(async (page) => {
    await unfold(page);
    await openLibrary(page);
    await type(page, 'cache');
    await page.keyboard.press('Escape');
    await settle(page);
    assert.equal(await view(page), true, 'the first Esc clears');
    assert.equal(await page.inputValue('.marxy-library-field'), '');
    assert.equal((await rowsOf(page)).length, entries.length);
    await page.keyboard.press('Escape');
    await settle(page, 100);
    assert.equal(await view(page), false, 'the second closes');
    assert.equal(await page.evaluate(() => window.__marxyHandle.workspace().mode), 'unfolded', 'and does not also fold the window');
    assert.equal(await page.evaluate(() => document.activeElement === window.__marxyHandle.panes().focused.host), true);
  });
});

test('a document opened from the palette while the library shows closes the view and lands in the pane', async () => {
  await withPage(async (page) => {
    await unfold(page);
    await openLibrary(page);
    await page.keyboard.press('ControlOrMeta+p');
    await page.keyboard.type('standup');
    await settle(page, 300);
    await page.keyboard.press('Enter');
    await settle(page, 600);
    assert.equal(await view(page), false);
    assert.deepEqual(await paths(page), ['/r/standup.md']);
    assert.equal(await page.evaluate(() => document.getElementById('marxy-main').hidden || document.getElementById('marxy-main').inert), false);
    assert.equal(await page.evaluate(() => document.getElementById('marxy-palette').open), false);
  });
});

test('/ and the find chord focus the field from the list', async () => {
  await withPage(async (page) => {
    await unfold(page);
    await openLibrary(page);
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), 'Results');
    await page.keyboard.press('/');
    assert.equal(await page.evaluate(() => document.activeElement.className), 'marxy-library-field');
    assert.equal(await page.inputValue('.marxy-library-field'), '', 'the slash is a key, not text');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ControlOrMeta+f');
    assert.equal(await page.evaluate(() => document.activeElement.className), 'marxy-library-field');
    assert.equal(await page.evaluate(() => document.getElementById('marxy-find')?.hidden ?? true), true, 'the pane find did not open under it');
  });
});

test('nothing is read at launch or on opening, and none for index keys; the lines and the measures read only what the keys left', async () => {
  await withPage(async (page) => {
    await unfold(page);
    const launch = await calls(page, 'readHead', 'readFile', 'searchContent');
    await page.evaluate(() => { window.__marxyHandle.shell.calls.length = 0; });
    await openLibrary(page);
    await type(page, 'kind:report is:recent modified:<1d size:>1');
    assert.deepEqual(await calls(page, 'readHead', 'readFile', 'searchContent'), [], `no read for index keys (launch read ${launch.length})`);
    await type(page, 'kind:report words:>500');
    await settle(page, 600);
    const reads = await calls(page, 'readHead');
    assert.deepEqual(reads.map((r) => r.path).sort(), ['/r/plans/big-report.md', '/r/plans/cache-plan.md', '/r/plans/long-report.md', '/r/plans/small-report.md'], 'only the reports');
    assert.equal(new Set(reads.map((r) => r.path)).size, reads.length, 'each read once');
    assert.equal((await calls(page, 'readFile')).length, 0, 'readFile arms the stale-write guard and is not used');
    const rows = await rowsOf(page);
    assert.deepEqual(rows.map((r) => r.path).sort(), ['/r/plans/big-report.md', '/r/plans/long-report.md']);
    const long = rows.find((r) => r.path === '/r/plans/long-report.md');
    assert.ok(long.why.some((w) => /words:>500 \(≥[\d,]+ words\)/.test(w)), `a file over 256 KB reads "at least": ${long.why}`);
    // Typing on with the same keys reads nothing again.
    await type(page, 'kind:report words:>800');
    await settle(page, 400);
    assert.equal((await calls(page, 'readHead')).length, reads.length);
    await type(page, 'warm');
    await settle(page, 400);
    assert.ok((await calls(page, 'searchContent')).length >= 1, 'words ask the shell to search lines');
    // Marxy's own state (/data: the index snapshot, positions) is not the reader's files; nothing else is written.
    assert.deepEqual(await page.evaluate(() => window.__marxyHandle.shell.calls.filter((c) => c.method === 'writeFileAtomic' && !String(c.args[0]).startsWith('/data/')).map((c) => c.args[0])), [], 'the library writes none of the reader\'s files');
  });
});

test('the list is a grid with aria-activedescendant; every control has a name; status marks have words', async () => {
  await withPage(async (page) => {
    await unfold(page);
    // Pin a file the way a reader does, from the palette, before the library is opened.
    await page.keyboard.press('ControlOrMeta+p');
    await page.keyboard.type('standup');
    await settle(page, 200);
    await page.keyboard.press('ControlOrMeta+.');
    await page.keyboard.press('Escape');
    await settle(page, 100);
    await openLibrary(page);
    const audit = await page.evaluate(() => {
      const unnamed = [...document.querySelectorAll('[data-marxy-library] button, [data-marxy-library] input, [data-marxy-library] select, [data-marxy-library] [role=grid]')].filter((c) => {
        const label = c.getAttribute('aria-label') || c.textContent.trim() || c.labels?.[0]?.textContent.trim() || c.getAttribute('placeholder');
        return !label;
      }).map((c) => c.outerHTML.slice(0, 80));
      const list = document.querySelector('.marxy-library-results');
      return { unnamed, role: list.getAttribute('role'), options: [...document.querySelectorAll('[data-marxy-library-row]')].every((r) => r.getAttribute('role') === 'row' && r.getAttribute('aria-selected') !== null && r.getAttribute('aria-label')) };
    });
    assert.deepEqual(audit.unnamed, []);
    assert.equal(audit.role, 'grid');
    assert.equal(audit.options, true);
    const marks = await page.evaluate(() => [...document.querySelectorAll('[data-marxy-library-row="/r/standup.md"] .marxy-library-mark')].map((m) => m.textContent));
    assert.deepEqual(marks, ['Pinned'], 'an icon with a name');
    const label = await page.getAttribute('[data-marxy-library-row="/r/standup.md"]', 'aria-label');
    assert.match(label, /Pinned/);
    const scopeCount = await page.evaluate(() => [...document.querySelectorAll('.marxy-library-scope')].map((b) => b.textContent));
    assert.ok(scopeCount.some((t) => t.startsWith('Pinned') && t.endsWith('1')), `the Pinned scope counts it: ${scopeCount}`);
    await page.click('.marxy-library-scope:has-text("Pinned")');
    await settle(page);
    assert.deepEqual((await rowsOf(page)).map((r) => r.path), ['/r/standup.md']);
  });
});

test('switching scope clears the query and the selection', async () => {
  await withPage(async (page) => {
    await unfold(page);
    await page.evaluate(() => window.__marxyHandle.open('/r/standup.md'));
    await settle(page, 300);
    await openLibrary(page);
    await type(page, 'cache');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.click('.marxy-library-scope:has-text("Recent")');
    await settle(page);
    assert.equal(await page.inputValue('.marxy-library-field'), '');
    assert.equal(await page.textContent('.marxy-library-title'), 'Recent');
    assert.deepEqual((await rowsOf(page)).map((r) => r.path), ['/r/standup.md'], 'only what this session opened');
    assert.equal(await page.evaluate(() => document.querySelector('[data-marxy-library-row][aria-selected="true"]')?.getAttribute('data-marxy-library-row')), '/r/standup.md', 'the selection starts again at the top');
  });
});

test('20,000 entries: only the first screenful has nodes, and the time to it is recorded', async () => {
  const many = Array.from({ length: 20_000 }, (_, i) => ({
    path: `/big/f${i}.md`, root: '/big', title: `File ${i}`, headings: [], mtimeMs: 1_000_000 + i, size: 100, kind: 'markdown', readerKind: 'article',
  }));
  await withPage(async (page) => {
    await unfold(page);
    const ms = await page.evaluate(async () => {
      const t0 = performance.now();
      await (await window.__library()).run({});
      await new Promise((r) => requestAnimationFrame(() => r()));
      return performance.now() - t0;
    });
    const nodes = await page.evaluate(() => document.querySelectorAll('[data-marxy-library-row]').length);
    const scrolled = await page.evaluate(async () => {
      const list = document.querySelector('.marxy-library-results');
      list.scrollTop = list.scrollHeight;
      await new Promise((r) => setTimeout(r, 100));
      return [...document.querySelectorAll('[data-marxy-library-row]')].length;
    });
    console.log(`library: first screenful of 20,000 entries in ${ms.toFixed(1)} ms (${nodes} rows built; ${scrolled} at the bottom)`);
    assert.ok(nodes > 5 && nodes < 80, `windowed (${nodes})`);
    assert.ok(scrolled < 80);
    assert.match(await page.textContent('.marxy-library-status'), /20,00\d files|20,001 files/);
  }, { extraEntries: many });
});

// --- the table (U-10) ----------------------------------------------------------------------------------------------

test('the table has real column headers, 30 px rows, no invented Measure column, and a header of true facts', async () => {
  await withPage(async (page) => {
    await unfold(page);
    await openLibrary(page);
    const t = await page.evaluate(() => {
      const grid = document.querySelector('.marxy-library-results');
      const row = document.querySelector('[data-marxy-library-row]');
      const heads = [...grid.querySelectorAll('[role=columnheader]')].map((h) => h.textContent.trim());
      const plain = [...document.querySelectorAll('[data-marxy-library-row]')].find((r) => r.querySelector('.marxy-library-row-whys') === null);
      return {
        heads,
        rowsCount: Number(grid.getAttribute('aria-rowcount')),
        rowH: plain.getBoundingClientRect().height,
        cells: [...plain.querySelectorAll('[role=gridcell]')].length,
        stats: [...document.querySelectorAll('.marxy-library-stat')].map((x) => x.textContent),
        rowIndex: row.getAttribute('aria-rowindex'),
      };
    });
    assert.deepEqual(t.heads, ['Name', 'Path', 'Modified', 'Status'], 'Measure is left out: no measure exists per entry');
    assert.equal(Math.round(t.rowH), 30, 'rows are 30 px at the 13 px chrome size');
    assert.equal(t.cells, 4);
    assert.equal(t.rowIndex, '2', 'the header is row 1');
    assert.equal(t.rowsCount - 1, entries.length, 'rowcount counts the header');
    assert.equal(t.stats[0], `${entries.length} files`, 'the header counts what the list draws');
    assert.equal(t.stats.length >= 3, true);
    const state = await page.evaluate(() => window.__marxyHandle.index.watchState());
    assert.equal(t.stats.at(-1), state === 'live' ? 'Watching' : 'Not watching', `the header says what the watch is, not what was declared: ${t.stats}`);
    const rows = await rowsOf(page);
    assert.equal(rows.length, entries.length, 'unfiltered, the header count equals the rows');
  });
});

test('the header facts follow the live state: a refused watch, a walk in progress, the real byte sum and the feed\'s count', async () => {
  await withPage(async (page) => {
    await unfold(page);
    const stub = (watch, busy) => page.evaluate(([w, b]) => {
      const index = window.__marxyHandle.index;
      index.watchState = () => w;
      index.indexing = () => b;
    }, [watch, busy]);
    const stats = () => page.evaluate(() => [...document.querySelectorAll('.marxy-library-stat')].map((x) => x.textContent));
    const reopen = async () => {
      if (await view(page)) await page.keyboard.press('Escape');
      await openLibrary(page);
      return stats();
    };
    await stub('refused', false);
    let s = await reopen();
    assert.ok(s.some((x) => x.startsWith('Not watching:')), `refused: ${s}`);
    assert.ok(!s.includes('Watching'));
    await stub('live', true);
    s = await reopen();
    assert.ok(s.includes('Indexing') && !s.includes('Indexed'), `walking: ${s}`);
    assert.ok(s.includes('Watching'));
    await stub('none', false);
    s = await reopen();
    assert.ok(s.includes('Indexed') && s.includes('Not watching'), `idle, unwatched: ${s}`);
    const fed = await page.evaluate(() => window.__marxyHandle.palette.feed.entries());
    assert.equal(s[0], `${fed.length.toLocaleString('en-US')} files`, 'the count is the feed\'s');
    const bytes = fed.reduce((n, e) => n + e.size, 0);
    assert.ok(bytes > 1024, 'the fixture is big enough to read as KB');
    assert.equal(s[1], `${(bytes / 1024).toFixed(1)} KB`, 'the size is the sum of the listed files');
    // A walk that ends while the view is open redraws the header.
    await page.evaluate(() => { window.__marxyHandle.index.indexing = () => true; });
    await page.evaluate(() => window.__marxyHandle.palette.setIndexEntries(window.__marxyHandle.palette.feed.entries()));
    await settle(page, 300);
    assert.ok((await stats()).includes('Indexing'), 'a feed change redraws from the live state');
  });
});

test('a column header sorts like the Sort control and announces it with aria-sort', async () => {
  await withPage(async (page) => {
    await unfold(page);
    await openLibrary(page);
    const sort = () => page.evaluate(() => ({ select: document.querySelector('.marxy-library-sort select').value, heads: Object.fromEntries([...document.querySelectorAll('[role=columnheader]')].map((h) => [h.textContent.trim(), h.getAttribute('aria-sort')])) }));
    assert.equal((await sort()).heads.Modified, 'descending');
    assert.equal((await sort()).heads.Status, null, 'Status does not sort');
    await page.click('[role=columnheader] button:has-text("Name")');
    await settle(page);
    const s = await sort();
    assert.equal(s.select, 'name');
    assert.equal(s.heads.Name, 'ascending');
    assert.equal(s.heads.Modified, 'none');
    const titles = (await rowsOf(page)).map((r) => r.title);
    assert.deepEqual(titles, [...titles].sort((a, b) => a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' })));
  });
});

test('filter menus only write query text, offer only what the scope holds, and toggle off', async () => {
  await withPage(async (page) => {
    await unfold(page);
    await openLibrary(page);
    const buttons = await page.evaluate(() => [...document.querySelectorAll('.marxy-library-facet-button')].map((b) => b.textContent.replace(/\s+/g, ' ').trim()));
    assert.ok(buttons.includes('Kind') && buttons.includes('Modified'), `menus: ${buttons}`);
    assert.ok(!buttons.includes('Status'), 'nothing pinned, recent or changed: that menu is not drawn');
    await page.click('.marxy-library-facet-button:has-text("Kind")');
    const items = await page.evaluate(() => [...document.querySelectorAll('.marxy-library-facet-item')].filter((i) => i.offsetParent !== null).map((i) => i.firstChild.textContent));
    assert.deepEqual(items.sort(), ['article', 'code', 'notes', 'report']);
    await page.click('.marxy-library-facet-item:has-text("report")');
    await settle(page);
    assert.equal(await page.inputValue('.marxy-library-field'), 'kind:report');
    assert.equal((await rowsOf(page)).length, 4);
    assert.match(await page.textContent('.marxy-library-status'), /4 of \d+ files/);
    await page.click('.marxy-library-facet-button:has-text("Kind")');
    await page.click('.marxy-library-facet-item[aria-checked=true]');
    await settle(page);
    assert.equal(await page.inputValue('.marxy-library-field'), '');
    assert.equal((await rowsOf(page)).length, entries.length);
  });
});

test('arrow keys move through rows of the grid and Return opens', async () => {
  await withPage(async (page) => {
    await unfold(page);
    await openLibrary(page);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    const sel = await page.evaluate(() => ({ at: document.querySelector('[data-marxy-library-row][aria-selected=true]').getAttribute('aria-rowindex'), ad: document.querySelector('.marxy-library-results').getAttribute('aria-activedescendant') }));
    assert.equal(sel.at, '3');
    assert.equal(sel.ad, 'marxy-library-row-1');
  });
});

// --- a tab click while the view shows (the review of #609) ---------------------------------------------------------

const clickTab = (page, path) => page.click(`[data-marxy-tab="${path}"] [role=tab]`);

test('a click on a tab closes the view and shows that document in the focused pane', async () => {
  await withPage(async (page) => {
    await unfold(page);
    await page.evaluate(() => window.__marxyHandle.open('/r/standup.md'));
    await page.waitForSelector('[data-marxy-tab="/r/A.md"] [role=tab]');
    assert.deepEqual(await paths(page), ['/r/standup.md']);
    await openLibrary(page);
    await clickTab(page, '/r/A.md');
    await settle(page, 400);
    assert.equal(await view(page), false, 'the view is closed');
    assert.deepEqual(await paths(page), ['/r/A.md'], 'the tab shows its document');
    assert.equal(await page.evaluate(() => { const m = document.getElementById('marxy-main'); return m.hidden || m.inert; }), false, 'the panes are back');
    assert.equal(await page.locator('#marxy-main').isVisible(), true);
  });
});

test('over a pane with unsaved edits a tab click closes the view first, so the prompt is seen, and Dismiss keeps the text', async () => {
  await withPage(async (page) => {
    await unfold(page);
    await page.evaluate(() => window.__marxyHandle.open('/r/standup.md'));
    await page.evaluate(() => window.__marxyHandle.toggleMode());
    await page.waitForSelector('.cm-content');
    await page.click('.cm-content');
    await page.keyboard.press('ControlOrMeta+ArrowUp');
    await page.keyboard.type('SOURCE-TYPED ');
    await settle(page, 150);
    await openLibrary(page);
    await clickTab(page, '/r/A.md');
    await settle(page, 400);
    assert.equal(await view(page), false, 'the view is closed');
    const open = page.locator('.marxy-notice button', { hasText: 'Open without saving' });
    assert.equal(await open.isVisible(), true, 'the prompt can be seen: it is not under the view');
    assert.equal(await page.locator('#marxy-main').isVisible(), true);
    assert.deepEqual(await paths(page), ['/r/standup.md'], 'nothing opened yet');
    await page.locator('.marxy-notice button', { hasText: 'Dismiss' }).click();
    await settle(page, 200);
    assert.deepEqual(await paths(page), ['/r/standup.md']);
    assert.match(await page.evaluate(() => document.querySelector('.cm-content').textContent), /SOURCE-TYPED/, 'Dismiss keeps the text');
  });
});

test('a tab command from the palette closes the view too', async () => {
  await withPage(async (page) => {
    await unfold(page);
    await page.evaluate(() => window.__marxyHandle.open('/r/standup.md'));
    await page.waitForSelector('[data-marxy-tab="/r/A.md"] [role=tab]');
    await openLibrary(page);
    await page.evaluate(async () => {
      const { commands } = await import('/src/commands/index.ts');
      await commands().find((c) => c.id === 'tab.next').run({});
    });
    await settle(page, 400);
    assert.equal(await view(page), false);
    assert.deepEqual(await paths(page), ['/r/A.md']);
  });
});

// --- limits the reader is told about -----------------------------------------------------------------------------

test('a query of 5,000 terms is cut to its first 64 with a notice, and answers at once', async () => {
  await withPage(async (page) => {
    await unfold(page);
    await openLibrary(page);
    const text = Array.from({ length: 5_000 }, (_, i) => `OR kind:note${i}`).join(' ');
    const ms = await page.evaluate(async (q) => {
      const field = document.querySelector('.marxy-library-field');
      const t0 = performance.now();
      field.value = q;
      field.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((r) => requestAnimationFrame(() => r()));
      return performance.now() - t0;
    }, text);
    await settle(page, 400);
    assert.ok(ms < 3000, `the window answered the long query in ${ms.toFixed(0)} ms`);
    assert.match(await page.textContent('.marxy-library-status'), /the query is long: only the first 64 terms used/);
    assert.ok((await page.locator('[data-marxy-query-chip]').count()) <= 64, 'no more chips than terms used');
    await type(page, 'cache');
    assert.doesNotMatch(await page.textContent('.marxy-library-status'), /the query is long/, 'a short query has no notice');
  });
});

test('past 20,000 files the line search says it stopped at 20,000', async () => {
  const many = Array.from({ length: 20_005 }, (_, i) => ({
    path: `/big/f${i}.md`, root: '/big', title: `File ${i}`, headings: [], mtimeMs: 1_000_000 + i, size: 100, kind: 'markdown', readerKind: 'article',
  }));
  await withPage(async (page) => {
    await unfold(page);
    await openLibrary(page);
    await type(page, 'zzzzz');
    await page.waitForFunction(() => /line search covers the first 20,000 of 20,0\d\d files/.test(document.querySelector('.marxy-library-status').textContent), null, { timeout: 60_000 });
    await type(page, 'cache');
    await page.waitForFunction(() => /line search covers the first 20,000 of/.test(document.querySelector('.marxy-library-status').textContent), null, { timeout: 60_000 });
  }, { extraEntries: many });
});

// --- Save as smart collection (Q-07) ------------------------------------------------------------------------

/** A reader's file: CRLF, comments, a key Marxy does not know, an unusual spacing, and one saved query already. */
const HAND = '# my smart collections\r\nunknown = 1   # kept\r\n\r\n[[root]]\r\npath  =   "/r"   # spaced\r\n\r\n[[query]]\r\nname = "Old"\r\nq = "is:pinned"\r\n';
const diskOf = (page, path = '/collection.toml') =>
  page.evaluate(async (p) => {
    try {
      return new TextDecoder().decode(await window.__marxyHandle.shell.readFile(p));
    } catch {
      return null;
    }
  }, path);
const writesTo = (page, path = '/collection.toml') => page.evaluate((p) => window.__marxyHandle.shell.calls.filter((c) => c.method === 'writeFileAtomic' && c.args[0] === p).length, path);
const saveButton = (page) => page.locator('[data-marxy-library-save]');
const saveForm = (page) => page.locator('[data-marxy-library-save-form]');
const nameField = (page) => page.locator('[data-marxy-library-save-form] input');
const pills = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('[data-marxy-library] .marxy-notice')].map((n) => ({ kind: n.dataset.noticeKind, text: n.querySelector('.marxy-notice-text').textContent })),
  );
/** Types a query, asks for the name field and types `name`; the submit is the caller's. */
async function nameIt(page, query, name) {
  await type(page, query);
  await saveButton(page).click();
  await nameField(page).waitFor();
  await nameField(page).fill(name);
}
const submit = async (page) => {
  await nameField(page).press('Enter');
  await settle(page, 150);
};

test('Save as smart collection is offered for a query with at least one term, and not for an empty one or one the parser ignores', async () => {
  await withPage(async (page) => {
    await unfold(page);
    await openLibrary(page);
    const offered = () => saveButton(page).isVisible();
    assert.equal(await offered(), false, 'no query');
    await type(page, 'kind:');
    assert.equal(await offered(), false, 'an incomplete term is ignored by the search');
    await type(page, 'kind:report');
    assert.equal(await offered(), true);
    assert.equal(await saveButton(page).textContent(), 'Save as smart collection');
    await type(page, '');
    assert.equal(await offered(), false, 'clearing the query takes it away');
    await type(page, 'cache');
    assert.equal(await offered(), true, 'a plain word is a term too');
    assert.equal(await page.evaluate(() => document.querySelector('.marxy-library-save').closest('.marxy-library-chips') !== null), true, 'it ends the row of chips');
  });
});

test('saving "Big plans" appends exactly one [[query]] table and changes no earlier byte of a commented CRLF file; the sidebar row appears', async () => {
  await withPage(async (page) => {
    await unfold(page);
    await openLibrary(page);
    assert.equal(await diskOf(page), HAND);
    await nameIt(page, 'kind:report words:>2000', 'Big plans');
    await submit(page);
    const after = await diskOf(page);
    assert.ok(after.startsWith(HAND), 'every earlier byte survives');
    assert.equal(after.slice(HAND.length), "[[query]]\r\nname = 'Big plans'\r\nq = 'kind:report words:>2000'\r\n");
    assert.equal(await writesTo(page), 1);
    assert.deepEqual(await pills(page), [{ kind: 'done', text: 'Saved "Big plans" as a smart collection' }]);
    assert.equal(await saveForm(page).isVisible(), false, 'the name field is put away');
    assert.equal(await page.evaluate(() => document.activeElement.className), 'marxy-library-field', 'focus returns to the query');
    await page.waitForSelector('[data-marxy-sidebar-row="smart:Big plans"]');
    const names = await page.evaluate(() => [...document.querySelectorAll('[data-marxy-sidebar-section="smart"] .marxy-sidebar-name')].map((n) => n.textContent));
    assert.deepEqual(names, ['Old', 'Big plans']);
    // The library is still on its query.
    assert.equal(await page.evaluate(() => document.querySelector('.marxy-library-field').value), 'kind:report words:>2000');
  }, { data: { '/collection.toml': HAND } });
});

test('with no collection.toml yet the first save creates it from the template, the table at the end', async () => {
  await withPage(async (page) => {
    await unfold(page);
    await openLibrary(page);
    assert.equal(await diskOf(page), null);
    await nameIt(page, 'kind:report', 'Reports');
    await submit(page);
    assert.match(await diskOf(page), /^# Folders Marxy searches[\s\S]*\n\[\[query\]\]\nname = 'Reports'\nq = 'kind:report'\n$/);
    await page.waitForSelector('[data-marxy-sidebar-row="smart:Reports"]');
  });
});

test('the file changed on disk between the read and the save: refused with a pill in the view, nothing written', async () => {
  await withPage(async (page) => {
    await unfold(page);
    await openLibrary(page);
    await nameIt(page, 'kind:report', 'Reports');
    const theirs = `${HAND}# a line the reader added in an editor\r\n`;
    await page.evaluate(async (t) => window.__marxyHandle.shell.writeFileAtomic('/collection.toml', new TextEncoder().encode(t)), theirs);
    const writes = await writesTo(page);
    await submit(page);
    assert.equal(await diskOf(page), theirs, 'the file is exactly what the other editor left');
    assert.equal(await writesTo(page), writes, 'no write was attempted');
    const shown = await pills(page);
    assert.equal(shown.length, 1);
    assert.equal(shown[0].kind, 'refused');
    assert.match(shown[0].text, /changed on disk while you were naming this.* · the file is unchanged by this save · /);
    assert.equal(await nameField(page).inputValue(), 'Reports', 'the name is kept for another try');
    // Saving again works against the file as it is now, and keeps their line too.
    await submit(page);
    const after = await diskOf(page);
    assert.ok(after.startsWith(theirs));
    assert.equal(after.slice(theirs.length), "[[query]]\r\nname = 'Reports'\r\nq = 'kind:report'\r\n");
  }, { data: { '/collection.toml': HAND } });
});

test('a duplicate name, an empty name, an empty query and a file that is not TOML are each refused with a pill naming why, the file unchanged', async () => {
  const cases = [
    { toml: HAND, query: 'kind:report', name: 'OLD', why: /A smart collection named "OLD" already exists/ },
    { toml: HAND, query: 'kind:report', name: '   ', why: /needs a name/ },
    { toml: HAND, query: null, name: 'Fresh', why: /no terms yet/ },
    { toml: '[[query\n= =\n', query: 'kind:report', name: 'Fresh', why: /cannot be read as TOML/ },
  ];
  for (const c of cases) {
    await withPage(async (page) => {
      await unfold(page);
      await openLibrary(page);
      await nameIt(page, c.query ?? 'kind:report', c.name);
      // An empty query: the reader clears the search while the name is being typed.
      if (c.query === null) await page.fill('.marxy-library-field', '');
      const writes = await writesTo(page);
      await submit(page);
      assert.equal(await diskOf(page), c.toml, `unchanged: ${JSON.stringify(c)}`);
      assert.equal(await writesTo(page), writes);
      const shown = await pills(page);
      assert.equal(shown.length, 1, JSON.stringify(shown));
      assert.equal(shown[0].kind, 'refused');
      assert.match(shown[0].text, c.why);
      assert.match(shown[0].text, / · .* · /, 'what happened · what is unchanged · what to do');
    }, { data: { '/collection.toml': c.toml } });
  }
});

test('a write that fails says so with an error pill and leaves the file as it was', async () => {
  await withPage(async (page) => {
    await unfold(page);
    await openLibrary(page);
    await nameIt(page, 'kind:report', 'Reports');
    await page.evaluate(() => window.__marxyHandle.shell.rejectNextWrite('io'));
    await submit(page);
    assert.equal(await diskOf(page), HAND);
    const shown = await pills(page);
    assert.deepEqual(shown.map((p) => p.kind), ['error']);
    assert.match(shown[0].text, /could not be saved .* · collection\.toml is unchanged · /);
    assert.equal(await page.evaluate(() => document.querySelectorAll('[data-marxy-sidebar-row="smart:Reports"]').length), 0, 'no row for what was not written');
  }, { data: { '/collection.toml': HAND } });
});

test('Esc in the name field puts it away without clearing the search; the pill takes its own Esc', async () => {
  await withPage(async (page) => {
    await unfold(page);
    await openLibrary(page);
    await nameIt(page, 'kind:report', 'half a nam');
    await nameField(page).press('Escape');
    assert.equal(await saveForm(page).isVisible(), false);
    assert.equal(await page.evaluate(() => document.querySelector('.marxy-library-field').value), 'kind:report', 'the search is kept');
    assert.equal(await saveButton(page).isVisible(), true);
    assert.equal(await page.evaluate(() => document.querySelectorAll('[data-marxy-library]').length), 1, 'the view is still up');
    assert.equal(await diskOf(page), HAND);
    assert.equal(await writesTo(page), 0, 'nothing was written');
  }, { data: { '/collection.toml': HAND } });
});

test('the name field keeps its focus and text while the results redraw around it', async () => {
  await withPage(async (page) => {
    await unfold(page);
    await openLibrary(page);
    await nameIt(page, 'kind:report', 'Rep');
    await page.evaluate((all) => window.__marxyHandle.palette.setIndexEntries(all.map((e) => ({ ...e }))), entries);
    await settle(page, 400);
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), 'Name for this smart collection');
    assert.equal(await nameField(page).inputValue(), 'Rep');
  });
});

test('switching scope clears the query, and with it the name being asked for', async () => {
  await withPage(async (page) => {
    await unfold(page);
    await openLibrary(page);
    await nameIt(page, 'kind:report', 'Reports');
    await page.click('.marxy-library-scope:has-text("Recent")');
    await settle(page, 200);
    assert.equal(await saveForm(page).isVisible(), false);
    assert.equal(await saveButton(page).isVisible(), false, 'no query, no Save');
    assert.equal(await writesTo(page), 0);
  }, { data: { '/collection.toml': HAND } });
});

// --- Broken paths and near-duplicates (Q-06) ------------------------------------------------------------------------

const entryFor = (path, text, over = {}) => ({
  path,
  root: '/r',
  title: text.match(/^# (.*)$/m)?.[1] ?? path.split('/').pop(),
  headings: [],
  mtimeMs: Date.now() - 86_400_000,
  size: new TextEncoder().encode(text).length,
  kind: 'markdown',
  readerKind: 'report',
  ...over,
});
const BROKEN = '# Broken plan\n\nIt builds `src/app.ts` and `src/gone.ts`, and `nowhere/x.ts` is not checked.\n';
/** The sidebar's built-ins run the same checks on their own: unfolded without it, every read below is the library's. */
const unfoldBare = (page) => page.evaluate(() => window.__marxyHandle.workspace().unfold({ sidebar: false }));
const callMark = (page) => page.evaluate(() => window.__marxyHandle.shell.calls.length);
const callsAfter = (page, from, ...names) =>
  page.evaluate(({ from, names }) => window.__marxyHandle.shell.calls.slice(from).filter((c) => names.includes(c.method)).map((c) => ({ method: c.method, path: c.args[0] })), { from, names });
const checksDone = (page) => page.waitForFunction(() => {
  const s = document.querySelector('.marxy-library-status')?.textContent ?? '';
  return !/Checking|Comparing|Looking for/.test(s) && document.querySelector('.marxy-library-results')?.getAttribute('aria-busy') === 'false';
}, undefined, { timeout: 30_000 });

test('is:broken lists the file that names a missing path, with the path under its row; it opens with the Links tab', async () => {
  await withPage(async (page) => {
    await unfoldBare(page);
    await openLibrary(page);
    const mark = await callMark(page);
    await type(page, 'is:broken');
    await checksDone(page);
    const rows = await rowsOf(page);
    assert.deepEqual(rows.map((r) => r.path), ['/r/broken.md']);
    assert.deepEqual(rows[0].why, ['is:broken (1 missing path)', 'missing: src/gone.ts'], 'the existing path and the unchecked one are not named');
    assert.match(await page.evaluate(() => document.querySelector('.marxy-library-preview').textContent), /Missing paths\s*src\/gone\.ts/);
    // Read with readHead, Markdown and text only; never readFile (which arms the stale-write guard); nothing written.
    const reads = await callsAfter(page, mark, 'readHead', 'readFile', 'writeFileAtomic');
    assert.equal(reads.filter((c) => c.method !== 'readHead' && c.path.startsWith('/r/')).length, 0, JSON.stringify(reads));
    assert.ok(reads.some((c) => c.path === '/r/broken.md'));
    assert.equal(reads.some((c) => c.path === '/r/src/app.ts'), false, 'a source file is not read for paths');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('[data-marxy-inspector-tab="links"]')?.getAttribute('aria-selected') === 'true');
    assert.deepEqual(await paths(page), ['/r/broken.md']);
    await page.waitForFunction(() => document.querySelector('[data-marxy-link-row="path"] [data-marxy-link-status="not-found"]') !== null);
  }, { data: { '/r/broken.md': BROKEN }, extraEntries: [entryFor('/r/broken.md', BROKEN)] });
});

const para2 = (seed, n = 45) => Array.from({ length: n }, (_, i) => `${seed}${(i * 7) % 97}w${i}`).join(' ');
const plan = (changed) => ['# Plan', ...Array.from({ length: 12 }, (_, i) => para2(i === 5 && changed ? changed : `p${i}`))].join('\n\n');
const PLANS = {
  '/r/plans/plan.md': [plan(null), 3],
  '/r/plans/plan v2.md': [plan('changed'), 1],
  '/r/plans/plan (copy).md': [plan(null), 2],
};
const planData = Object.fromEntries(Object.entries(PLANS).map(([p, [t]]) => [p, t]));
const planEntries = Object.entries(PLANS).map(([p, [t, age]]) => entryFor(p, t, { mtimeMs: Date.now() - age * 86_400_000 }));

test('is:dup shows each group once, the newest as the row and the others folded under it; the threshold regroups; Compare opens the diff', async () => {
  await withPage(async (page) => {
    await unfoldBare(page);
    await openLibrary(page);
    const mark = await callMark(page);
    await type(page, 'is:dup');
    await checksDone(page);
    let rows = await rowsOf(page);
    assert.deepEqual(rows.map((r) => r.path), ['/r/plans/plan v2.md'], 'one row: the newest');
    assert.equal(rows[0].why[0], 'is:dup (2 near copies)');
    assert.match(rows[0].why[1], /^near copy: plans\/plan \(copy\)\.md \(9\d% alike\)$/);
    assert.match(rows[0].why[2], /^near copy: plans\/plan\.md \(9\d% alike\)$/);
    assert.match(await page.evaluate(() => document.querySelector('.marxy-library-status').textContent), /1 group of near copies, 3 files/);
    // Only the three candidates were read for it (the fixture's other names are all different).
    const read = (await callsAfter(page, mark, 'readHead')).map((c) => c.path);
    assert.deepEqual([...new Set(read)].sort(), Object.keys(PLANS).sort());
    // The banner's threshold: at 99 only the two identical files are copies, and nothing is read again.
    const before = (await calls(page, 'readHead')).length;
    assert.equal(await page.isVisible('select[aria-label="How alike near copies are, at least"]'), true);
    await page.selectOption('select[aria-label="How alike near copies are, at least"]', '99');
    await settle(page);
    rows = await rowsOf(page);
    assert.deepEqual(rows.map((r) => [r.path, r.why]), [['/r/plans/plan (copy).md', ['is:dup (1 near copy)', 'near copy: plans/plan.md (100% alike)']]]);
    assert.equal((await calls(page, 'readHead')).length, before);
    await page.selectOption('select[aria-label="How alike near copies are, at least"]', '85');
    await settle(page);
    // Compare: the older copy against the newer, as E-17's diff in a scratch document.
    await page.click('.marxy-library-preview button[aria-label^="Compare Plan with plans/plan.md"]');
    await page.waitForFunction(() => !document.querySelector('[data-marxy-library]'));
    await page.waitForFunction(() => /Changes in plan v2\.md/.test(document.getElementById('doc')?.textContent ?? ''));
    const text = await page.evaluate(() => document.getElementById('doc').textContent.replace(/\u00ad/g, '').replace(/\s+/g, ' '));
    assert.match(text, /from plan\.md \(older\) to plan v2\.md \(newer\)/);
    assert.deepEqual((await calls(page, 'writeFileAtomic')).filter((c) => c.path.startsWith('/r/')), [], 'none of the reader\'s files written (Marxy\'s own state under /data is)');
  }, { data: planData, extraEntries: planEntries });
});

test('is:dup over 5,000 files reads only the candidate files, and the page keeps answering while it runs', async () => {
  const many = Array.from({ length: 5000 }, (_, i) => entryFor(`/r/many/note-${i}x.md`, `# Note ${i}x\n\nwords\n`));
  await withPage(async (page) => {
    await unfoldBare(page);
    await openLibrary(page);
    const mark = await callMark(page);
    // A probe: the longest the page went without running a 10 ms timer, from the keystroke to the answer.
    await page.evaluate(() => {
      window.__gap = 0;
      let last = performance.now();
      window.__probe = setInterval(() => {
        const now = performance.now();
        window.__gap = Math.max(window.__gap, now - last);
        last = now;
      }, 10);
    });
    await type(page, 'is:dup');
    await checksDone(page);
    const gap = await page.evaluate(() => {
      clearInterval(window.__probe);
      return window.__gap;
    });
    const read = [...new Set((await callsAfter(page, mark, 'readHead')).map((c) => c.path))];
    assert.deepEqual(read.sort(), Object.keys(PLANS).sort(), 'the three plans, and none of the 5,000 notes');
    assert.equal((await rowsOf(page)).length, 1);
    assert.ok(gap < 400, `the page went ${gap.toFixed(0)} ms without a turn`);
  }, { data: planData, extraEntries: [...planEntries, ...many] });
});
