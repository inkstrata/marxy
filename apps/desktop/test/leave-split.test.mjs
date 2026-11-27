// Leaving Split: Read, Source and Split again from Split end in one pane. The real app over the
// memory shell in WebKit, driven by the real chords. There is no toolbar Read/Split/Source control: Split is
// Mod+2 (or the palette), and each pane's head has its own Read / Source switch, which must agree with its pane.
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

const para = (word) => `${word} runs long enough to wrap across several lines of the column, so the page has real paragraphs. `;
const files = {
  '/r/A.md': `# Alpha\n\n${para('Alpha').repeat(20)}\n\n## Later\n\n${para('Later').repeat(20)}\n`,
  '/r/B.md': `# Bravo\n\n${para('Bravo').repeat(4)}\n`,
};

async function boot(browser, { data = {}, open = '/r/A.md' } = {}) {
  const page = await browser.newPage({ viewport: { width: 1470, height: 900 } });
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
  const encoded = Object.fromEntries(Object.entries({ ...files, ...data }).map(([p, t]) => [p, b64(t)]));
  await page.evaluate(
    async ({ encoded, open }) => {
      const bytes = {};
      for (const [path, text] of Object.entries(encoded)) bytes[path] = Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
      const { createMemoryShell } = await import('/src/shell/memory.ts');
      const { bootApplication } = await import('/src/main.ts');
      const handle = await bootApplication(createMemoryShell(bytes), { argv: open ? [open] : [] });
      await handle.ready;
      window.__marxyHandle = handle;
    },
    { encoded, open },
  );
  await page.evaluate(() => window.__marxyHandle.frame().unfold());
  return page;
}

async function withPage(fn, opts) {
  const browser = await launchWebkit();
  try {
    const page = await boot(browser, opts);
    const mod = (await page.evaluate(() => navigator.platform.toUpperCase().includes('MAC'))) ? 'Meta' : 'Control';
    await fn(page, mod, browser);
  } finally {
    await browser.close();
  }
}

/**
 * The panes, their modes, and the window's state as the old control said it (`radios`: Split when one document is shown
 * twice, else the focused pane's mode), read from each pane's head switch, which must agree with its pane.
 */
const state = (page) =>
  page.evaluate(() => {
    const set = window.__marxyHandle.panes();
    const heads = set.panes.map((p) => {
      const head = document.querySelector(`[data-marxy-head="${p.slot}"]`);
      return { read: head?.querySelector('.marxy-rs-read')?.getAttribute('aria-pressed'), source: head?.querySelector('.marxy-rs-source')?.getAttribute('aria-pressed') };
    });
    const paths = set.panes.map((p) => p.path());
    const modes = set.panes.map((p) => p.view.mode);
    const split = paths.length === 2 && paths[0] !== null && paths[0] === paths[1];
    const focused = set.focused.view.mode;
    const radios = { Read: String(!split && focused === 'rendered'), Split: String(split), Source: String(!split && focused === 'source') };
    return { paths, modes, heads, radios };
  });
const CHORD = { Read: '1', Split: '2', Source: '3' };
/** What the control's press did: the chord of `label` (Mod+1, Mod+2, Mod+3). */
const press = async (page, label) => {
  const mod = (await page.evaluate(() => navigator.platform.toUpperCase().includes('MAC'))) ? 'Meta' : 'Control';
  await page.keyboard.press(`${mod}+${CHORD[label]}`);
};
/** Each pane's head switch says its own pane's mode. */
const headsAgree = (s) =>
  assert.deepEqual(s.heads, s.modes.map((m) => ({ read: String(m === 'rendered'), source: String(m === 'source') })), 'each head says the mode of its own pane');
const settled = (page, n, mode) =>
  page.waitForFunction(
    ([n, mode]) => {
      const set = window.__marxyHandle.panes();
      return set.panes.length === n && set.panes[0].view.mode === mode;
    },
    [n, mode],
  );
const goSplit = async (page) => {
  await press(page, 'Split');
  await page.waitForFunction(() => window.__marxyHandle.panes().panes.length === 2 && window.__marxyHandle.panes().panes[1].view.mode === 'source');
};

test('in Split, Read returns to one pane in Read, and the control agrees at every step', async () => {
  await withPage(async (page) => {
    let s = await state(page);
    assert.equal(s.radios.Read, 'true');
    headsAgree(s);
    await goSplit(page);
    s = await state(page);
    assert.deepEqual(s.radios, { Read: 'false', Split: 'true', Source: 'false' });
    headsAgree(s);
    await press(page, 'Read');
    await settled(page, 1, 'rendered');
    s = await state(page);
    assert.deepEqual(s.paths, ['/r/A.md']);
    assert.deepEqual(s.radios, { Read: 'true', Split: 'false', Source: 'false' });
    headsAgree(s);
  });
});

test('in Split, Source returns to one pane in Source', async () => {
  await withPage(async (page) => {
    await goSplit(page);
    await press(page, 'Source');
    await settled(page, 1, 'source');
    const s = await state(page);
    assert.deepEqual(s.radios, { Read: 'false', Split: 'false', Source: 'true' });
  });
});

test('pressing Split again toggles back to Read in one pane', async () => {
  await withPage(async (page, mod) => {
    await goSplit(page);
    await page.keyboard.press(`${mod}+2`);
    await settled(page, 1, 'rendered');
    await goSplit(page);
    await press(page, 'Split');
    await settled(page, 1, 'rendered');
    assert.deepEqual((await state(page)).radios, { Read: 'true', Split: 'false', Source: 'false' });
  });
});

test('Read and Source chords leave Split too, including from inside the Source editor', async () => {
  await withPage(async (page, mod) => {
    await goSplit(page);
    await page.locator('section.marxy-pane').nth(1).locator('.cm-content').click();
    await page.keyboard.press(`${mod}+1`);
    await settled(page, 1, 'rendered');
    await goSplit(page);
    await page.keyboard.press(`${mod}+3`);
    await settled(page, 1, 'source');
  });
});

test('Source text typed in the closing pane is folded into the survivor, nothing lost', async () => {
  await withPage(async (page) => {
    await goSplit(page);
    await page.locator('section.marxy-pane').nth(1).locator('.cm-content').click();
    await page.keyboard.type('TYPED-IN-SOURCE ');
    await press(page, 'Read');
    await settled(page, 1, 'rendered');
    const text = await page.evaluate(() => window.__marxyHandle.panes().panes[0].article.textContent);
    assert.ok(text.includes('TYPED-IN-SOURCE'), 'the typed text shows in the surviving Read pane');
    await press(page, 'Source');
    await settled(page, 1, 'source');
    const src = await page.evaluate(() => document.querySelector('.cm-content').textContent);
    assert.ok(src.includes('TYPED-IN-SOURCE'));
  });
});

test('the reading place survives leaving Split', async () => {
  await withPage(async (page) => {
    await page.evaluate(() => window.scrollTo(0, 1800));
    await page.waitForTimeout(300);
    await goSplit(page);
    const before = await page.evaluate(() => window.__marxyHandle.panes().panes[0].view.position().byteOffset);
    assert.ok(before > 200, `scrolled: ${before}`);
    await press(page, 'Read');
    await settled(page, 1, 'rendered');
    await page.waitForTimeout(400);
    const after = await page.evaluate(() => window.__marxyHandle.panes().panes[0].view.position().byteOffset);
    assert.ok(Math.abs(after - before) < 600, `place ${before} became ${after}`);
  });
});

test('two different documents are never closed by Read, Source or Split: the notice stays and Read sets the focused mode', async () => {
  await withPage(async (page, mod) => {
    await page.evaluate(() => window.__marxyHandle.panes().openIn('other', '/r/B.md'));
    await page.keyboard.press(`${mod}+2`);
    await page.waitForTimeout(400);
    let s = await state(page);
    assert.deepEqual(s.paths, ['/r/A.md', '/r/B.md']);
    const notice = await page.evaluate(() => document.body.textContent.includes('Split shows one document twice'));
    assert.ok(notice);
    await page.keyboard.press(`${mod}+3`);
    await page.waitForFunction(() => window.__marxyHandle.panes().focused.view.mode === 'source');
    s = await state(page);
    assert.deepEqual(s.paths, ['/r/A.md', '/r/B.md']);
    assert.equal(s.radios.Split, 'false');
  });
});

test('quitting after leaving Split relaunches with one pane (the stuck layout)', async () => {
  await withPage(async (page, _mod, browser) => {
    const layout = async (p) =>
      p.evaluate(async () => new TextDecoder().decode(await window.__marxyHandle.shell.readFile('/data/layout.json')));
    await goSplit(page);
    await press(page, 'Read');
    await settled(page, 1, 'rendered');
    await page.waitForTimeout(600);
    await page.evaluate(() => window.__marxyHandle.shell.quit(0));
    const saved = await layout(page);
    assert.equal(JSON.parse(saved).columns.length, 1, saved);
    const again = await boot(browser, { data: { '/data/layout.json': saved }, open: null });
    await again.waitForFunction(() => window.__marxyHandle.panes().panes[0].path() !== null);
    const s = await state(again);
    assert.deepEqual(s.paths, ['/r/A.md']);
    assert.equal(s.radios.Read, 'true');
  });
});
