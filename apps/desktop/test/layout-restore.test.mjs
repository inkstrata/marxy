// Remember the layout and each pane's place, and restore them at launch (D-12). Booted on the shipped
// skeleton and CSS (test/support/two-pane.mjs) over the memory shell: the panes, modes, ratio and focus
// are what `startApp` puts back from /data/layout.json, and positions.json is written by the pane the
// writer rule names.
import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { after, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { b64, closeHarness, harnessBase, shippedSkeleton } from './support/two-pane.mjs';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip }, fn);
after(() => closeHarness());

const para = (word) =>
  `${word} runs long enough to wrap across several lines of the column, so that the typesetter has ` +
  'real paragraphs to break and the page is tall enough to scroll a heading to the reading line. ';
const doc = (word) =>
  `# ${word}\n\n${Array.from({ length: 12 }, (_, i) => para(`${word} ${i + 1}`).repeat(2).trim()).join('\n\n')}\n`;
const files = { '/r/A.md': doc('Alpha'), '/r/B.md': doc('Bravo'), '/r/C.md': doc('Charlie') };
const layout = (columns, ratio = 0.4, focused = 1, version = 1) =>
  JSON.stringify({ version, columns, ratio, focused });
const rendered = (path) => ({ path, mode: 'rendered' });
const source = (path) => ({ path, mode: 'source' });

const WIDE = { width: 1470, height: 700 };
const NARROW = { width: 900, height: 700 };

async function withBrowser(fn) {
  const browser = await launchWebkit();
  try {
    await fn(browser);
  } finally {
    await browser.close();
  }
}

/** A page with the shipped skeleton, the app started on `files` (path to text) with `argv`. */
async function boot(browser, { files: given, argv = [], viewport = WIDE }) {
  const page = await browser.newPage({ viewport });
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
  const encoded = Object.fromEntries(Object.entries(given).map(([path, text]) => [path, b64(text)]));
  await page.evaluate(
    async ({ encoded, argv }) => {
      const bytes = {};
      for (const [path, e] of Object.entries(encoded)) {
        const raw = atob(e);
        const out = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
        bytes[path] = out;
      }
      const { createMemoryShell } = await import('/src/shell/memory.ts');
      const { startApp } = await import('/src/app.ts');
      const shell = createMemoryShell(bytes);
      const handle = await startApp(shell, { argv });
      await handle.ready;
      window.__marxyHandle = handle;
    },
    { encoded, argv },
  );
  return page;
}

/** What the panes show, left to right, and the mode, ratio and focus. */
const shown = (page) =>
  page.evaluate(() => {
    const set = window.__marxyHandle.panes();
    return {
      paths: set.panes.map((p) => p.path()),
      modes: set.panes.map((p) => p.view.mode),
      ratio: set.ratio,
      focused: set.focused.slot,
    };
  });

/** Writes the shell has seen to `path`. */
const writesTo = (page, path) =>
  page.evaluate(
    (path) => window.__marxyHandle.shell.calls.filter((c) => c.method === 'writeFileAtomic' && c.args[0] === path).length,
    path,
  );

/** The reader's data as the shell holds it: what a relaunch on the same machine would find. */
const dataOf = (page) =>
  page.evaluate(async () => {
    const out = {};
    for (const name of ['layout.json', 'positions.json']) {
      try {
        const bytes = await window.__marxyHandle.shell.readFile(`/data/${name}`);
        out[`/data/${name}`] = new TextDecoder().decode(bytes);
      } catch {}
    }
    return out;
  });

const quit = (page) => page.evaluate(() => window.__marxyHandle.shell.quit(0));
const wait = (page, ms) => page.waitForTimeout(ms);

test('two documents, modes, ratio and focus come back, and first text came before the second pane', async () => {
  await withBrowser(async (browser) => {
    const first = await boot(browser, { files, argv: ['/r/A.md'] });
    await first.evaluate(async () => {
      const set = window.__marxyHandle.panes();
      await set.openIn('other', '/r/B.md');
      await set.panes[1].view.toggleMode();
      set.setRatio(0.4);
      set.focus(set.panes[1]);
    });
    await quit(first);
    const saved = await dataOf(first);
    assert.deepEqual(JSON.parse(saved['/data/layout.json']), {
      version: 1,
      columns: [rendered('/r/A.md'), source('/r/B.md')],
      ratio: 0.4,
      focused: 1,
    });

    const second = await boot(browser, { files: { ...files, ...saved }, argv: [] });
    const now = await shown(second);
    assert.deepEqual(now.paths, ['/r/A.md', '/r/B.md']);
    assert.deepEqual(now.modes, ['rendered', 'source']);
    assert.equal(now.ratio, 0.4);
    assert.equal(now.focused, 1);
    const marks = await second.evaluate(() =>
      window.__marxyHandle.shell.calls.filter((c) => c.method === 'mark').map((c) => c.args[0]),
    );
    assert.ok(marks.includes('first_text') && marks.includes('split_open'), `marks: ${marks}`);
    assert.ok(marks.indexOf('first_text') < marks.indexOf('split_open'), `first_text before split_open: ${marks}`);
    // Nothing of the second document (not even a probe) is touched before first text.
    const order = await second.evaluate(() =>
      window.__marxyHandle.shell.calls.map((c) => (c.method === 'mark' ? `mark:${c.args[0]}` : `${c.method}:${c.args[0]}`)),
    );
    const firstText = order.indexOf('mark:first_text');
    const secondTouched = order.findIndex((e) => /^(readFile|readHead|stat):\/r\/B\.md$/.test(e));
    assert.ok(firstText >= 0 && secondTouched > firstText, `B.md was touched before first_text: ${order.slice(0, secondTouched + 1)}`);
  });
});

test('a one-document session writes one column and restores one pane', async () => {
  await withBrowser(async (browser) => {
    const first = await boot(browser, { files, argv: ['/r/A.md'] });
    await quit(first);
    const saved = await dataOf(first);
    assert.deepEqual(JSON.parse(saved['/data/layout.json']).columns, [rendered('/r/A.md')]);
    const second = await boot(browser, { files: { ...files, ...saved }, argv: [] });
    const now = await shown(second);
    assert.deepEqual(now.paths, ['/r/A.md']);
  });
});

test('a deleted column is left out with a notice; both deleted is the normal empty state', async () => {
  await withBrowser(async (browser) => {
    const saved = layout([rendered('/r/A.md'), rendered('/r/B.md')]);
    const { '/r/B.md': _gone, ...withoutB } = files;
    const one = await boot(browser, { files: { ...withoutB, '/data/layout.json': saved }, argv: [] });
    assert.deepEqual((await shown(one)).paths, ['/r/A.md']);
    const notice = await one.evaluate(() => document.querySelector('#marxy-notices')?.textContent ?? '');
    assert.match(notice, /B\.md is no longer there, so it was left out of the layout\./);
    // The file is not touched while the reader changes nothing.
    await quit(one);
    assert.equal(await writesTo(one, '/data/layout.json'), 0);

    const { '/r/A.md': _a, ...neither } = withoutB;
    const none = await boot(browser, { files: { ...neither, '/data/layout.json': saved }, argv: [] });
    const now = await shown(none);
    assert.deepEqual(now.paths, [null]);
    const text = await none.evaluate(() => document.querySelector('#marxy-notices')?.textContent ?? '');
    assert.match(text, /A\.md is no longer there/);
    assert.match(text, /B\.md is no longer there/);
  });
});

test('a corrupt layout.json is quarantined and the app starts normally', async () => {
  await withBrowser(async (browser) => {
    const page = await boot(browser, { files: { ...files, '/data/layout.json': '{{ not json' }, argv: [] });
    assert.deepEqual((await shown(page)).paths, [null]);
    const kept = await page.evaluate(async () => {
      const shell = window.__marxyHandle.shell;
      const bad = shell.calls.filter((c) => c.method === 'writeFileAtomic' && /layout\.json\.bad-/.test(c.args[0]));
      return bad.length === 1 ? new TextDecoder().decode(await shell.readFile(bad[0].args[0])) : null;
    });
    assert.equal(kept, '{{ not json');
  });
});

test('a layout from a newer version is restored and left on disk as it was', async () => {
  await withBrowser(async (browser) => {
    const future = layout([rendered('/r/A.md'), rendered('/r/B.md')], 0.5, 0, 2);
    const page = await boot(browser, { files: { ...files, '/data/layout.json': future }, argv: [] });
    assert.deepEqual((await shown(page)).paths, ['/r/A.md', '/r/B.md']);
    await page.evaluate(async () => {
      const set = window.__marxyHandle.panes();
      set.focus(set.panes[1]);
      set.setRatio(0.3);
    });
    await quit(page);
    await wait(page, 700);
    assert.equal((await dataOf(page))['/data/layout.json'], future);
    assert.equal(await writesTo(page, '/data/layout.json'), 0);
  });
});

test('at 900 px one pane (the focused column) is shown and nothing is written; a later change writes', async () => {
  await withBrowser(async (browser) => {
    const saved = layout([rendered('/r/A.md'), rendered('/r/B.md')], 0.4, 1);
    const page = await boot(browser, { files: { ...files, '/data/layout.json': saved }, argv: [], viewport: NARROW });
    assert.deepEqual((await shown(page)).paths, ['/r/B.md']);
    await wait(page, 1000);
    assert.equal(await writesTo(page, '/data/layout.json'), 0, 'restoring wrote layout.json');
    await quit(page);
    assert.equal(await writesTo(page, '/data/layout.json'), 0, 'quitting wrote layout.json');

    // The window widens and a second document is opened beside (what `Mod+\` ends in).
    await page.setViewportSize(WIDE);
    await wait(page, 300);
    await page.evaluate(() => window.__marxyHandle.panes().openIn('other', '/r/C.md'));
    await wait(page, 800);
    assert.equal(await writesTo(page, '/data/layout.json'), 1);
    const written = JSON.parse((await dataOf(page))['/data/layout.json']);
    assert.deepEqual(written.columns.map((c) => c.path), ['/r/B.md', '/r/C.md']);
  });
});

test('a launch with a file puts it in the focused pane and keeps the other pane', async () => {
  await withBrowser(async (browser) => {
    const right = layout([rendered('/r/A.md'), rendered('/r/B.md')], 0.4, 1);
    const a = await boot(browser, { files: { ...files, '/data/layout.json': right }, argv: ['/r/C.md'] });
    assert.deepEqual((await shown(a)).paths, ['/r/A.md', '/r/C.md']);
    assert.equal((await shown(a)).focused, 1);
    assert.equal((await shown(a)).ratio, 0.4);

    const left = layout([rendered('/r/A.md'), source('/r/B.md')], 0.6, 0);
    const b = await boot(browser, { files: { ...files, '/data/layout.json': left }, argv: ['/r/C.md'] });
    const now = await shown(b);
    assert.deepEqual(now.paths, ['/r/C.md', '/r/B.md']);
    assert.deepEqual(now.modes, ['rendered', 'source']);
    assert.equal(now.focused, 0);
  });
});

test('the focused pane writes a file shown twice; the other does not; a second pane writes its own file', async () => {
  await withBrowser(async (browser) => {
    const page = await boot(browser, { files, argv: ['/r/A.md'] });
    await page.evaluate(() => window.__marxyHandle.panes().openIn('other', '/r/A.md'));
    const scrollPane = (slot) =>
      page.evaluate(async (slot) => {
        const pane = window.__marxyHandle.panes().panes[slot];
        pane.host.scrollTop += 600;
        await new Promise((r) => setTimeout(r, 900));
      }, slot);
    const focus = (slot) =>
      page.evaluate((slot) => {
        const set = window.__marxyHandle.panes();
        set.focus(set.panes[slot]);
      }, slot);
    await wait(page, 900);

    // Pane 0 is focused: scrolling pane 1 (the same file) changes nothing in positions.json.
    await focus(0);
    const before = await writesTo(page, '/data/positions.json');
    await scrollPane(1);
    assert.equal(await writesTo(page, '/data/positions.json'), before, 'the unfocused second view wrote its place');
    await scrollPane(0);
    assert.ok((await writesTo(page, '/data/positions.json')) > before, 'the focused pane did not write its place');

    // Focus moves to pane 1: now it is the writer and pane 0 is not.
    await focus(1);
    const mid = await writesTo(page, '/data/positions.json');
    await scrollPane(0);
    assert.equal(await writesTo(page, '/data/positions.json'), mid, 'the unfocused first view wrote its place');
    await scrollPane(1);
    assert.ok((await writesTo(page, '/data/positions.json')) > mid, 'the focused second pane did not write its place');

    // Two files: each pane writes its own, whichever has focus.
    await page.evaluate(() => window.__marxyHandle.panes().openIn(1, '/r/B.md'));
    await wait(page, 900);
    await focus(0);
    await scrollPane(1);
    const positions = JSON.parse((await dataOf(page))['/data/positions.json']);
    assert.ok(positions.positions['/r/B.md'], 'the second pane did not keep the place of its own file');
  });
});

test('a layout.json over 64 KB is not read whole: the launch goes on with no layout and the file is left alone', async () => {
  await withBrowser(async (browser) => {
    const big = JSON.stringify({ version: 1, columns: [rendered('/r/A.md')], ratio: 0.5, focused: 0, pad: 'x'.repeat(70 * 1024) });
    const page = await boot(browser, { files: { ...files, '/data/layout.json': big }, argv: [] });
    assert.deepEqual((await shown(page)).paths, [null]);
    const seen = await page.evaluate(() => {
      const calls = window.__marxyHandle.shell.calls;
      return {
        wholeReads: calls.filter((c) => c.method === 'readFile' && c.args[0] === '/data/layout.json').length,
        head: calls.filter((c) => c.method === 'readHead' && c.args[0] === '/data/layout.json').map((c) => c.args[1]),
        bad: calls.filter((c) => c.method === 'writeFileAtomic' && /layout\.json\.bad-/.test(c.args[0])).length,
        overwrote: calls.filter((c) => c.method === 'writeFileAtomic' && c.args[0] === '/data/layout.json').length,
      };
    });
    assert.equal(seen.wholeReads, 0);
    assert.deepEqual(seen.head, [64 * 1024 + 1]);
    assert.equal(seen.bad, 1);
    assert.equal(seen.overwrote, 0);
  });
});
