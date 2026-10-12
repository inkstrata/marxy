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

async function withPage(fn, { width = 1280, height = 900, open = '/r/A.md', extraEntries = [] } = {}) {
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
    const encoded = Object.fromEntries(Object.entries(files).map(([path, text]) => [path, b64(text)]));
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

test('an unknown key is an amber chip searched as text; is:dup says it is not available yet and matches nothing', async () => {
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
    await type(page, 'is:dup');
    chip = await page.evaluate(() => ({ text: document.querySelector('[data-marxy-query-chip]').textContent }));
    assert.match(chip.text, /not available yet/);
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

test('the list is a listbox with aria-activedescendant; every control has a name; status marks have words', async () => {
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
      const unnamed = [...document.querySelectorAll('[data-marxy-library] button, [data-marxy-library] input, [data-marxy-library] select, [data-marxy-library] [role=listbox]')].filter((c) => {
        const label = c.getAttribute('aria-label') || c.textContent.trim() || c.labels?.[0]?.textContent.trim() || c.getAttribute('placeholder');
        return !label;
      }).map((c) => c.outerHTML.slice(0, 80));
      const list = document.querySelector('.marxy-library-results');
      return { unnamed, role: list.getAttribute('role'), options: [...document.querySelectorAll('[data-marxy-library-row]')].every((r) => r.getAttribute('role') === 'option' && r.getAttribute('aria-selected') !== null && r.getAttribute('aria-label')) };
    });
    assert.deepEqual(audit.unnamed, []);
    assert.equal(audit.role, 'listbox');
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
