// Peeking (W-03): an edge shows one panel, a click or its key docks it, Esc folds. The real app on the shipped
// skeleton and CSS over the memory shell, in WebKit (test/support/two-pane.mjs), as workspace.test.mjs does.
// What this cannot show: whether the webview of the built app gets pointer events in the last pixels at a
// window's edge (macOS keeps the resize handle there). The band is measured inside the client area; only the
// built-app smoke can confirm it.
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { after, test as nodeTest } from 'node:test';
import { fileURLToPath } from 'node:url';
import { webkit } from 'playwright';
import { launchWebkit } from '../../../../scripts/playwright-webkit.mjs';
import { bootTwoPanes, closeHarness } from '../../test/support/two-pane.mjs';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);
const plain = (name, fn) => nodeTest(name, fn);
after(() => closeHarness());

const repo = (rel) => readFileSync(fileURLToPath(new URL(`../../../../${rel}`, import.meta.url)), 'utf8');
const para = (word) => `${word} runs long enough to wrap across several lines of the column, so the page has real paragraphs. `;
const files = { '/r/A.md': `# Alpha\n\n${para('Alpha').repeat(8)}\n\n## Later\n\n${para('Later').repeat(8)}\n` };

async function withPage(fn, { width = 1280, height = 900 } = {}) {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width, height } });
    await bootTwoPanes(page, { files, open: ['/r/A.md'] });
    await fn(page);
  } finally {
    await browser.close();
  }
}

const mac = (page) => page.evaluate(() => navigator.platform.toUpperCase().includes('MAC'));
const mod = async (page) => ((await mac(page)) ? 'Meta' : 'Control');
const ws = (page, code) => page.evaluate(`(() => { const w = window.__marxyHandle.workspace(); return ${code}; })()`);
const mode = (page) => ws(page, 'w.mode');
const peeked = (page) => page.evaluate(() => [...document.querySelectorAll('[data-marxy-workspace-region]')].map((el) => el.getAttribute('data-marxy-workspace-region')));
const column = (page) => page.evaluate(() => {
  const r = document.getElementById('doc').getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
});
/** The pointer comes in from the middle of the page, as it does, so the edge is arrived at, not started on. */
async function rest(page, x, y, ms) {
  await page.mouse.move(640, 450);
  await page.mouse.move(x, y);
  await page.waitForTimeout(ms);
}
const stubFill = (page, region) => page.evaluate((r) => {
  window.__marxyHandle.workspace().fill(r, (el) => { el.textContent = `${r} stub`; });
}, region);

// --- the names ----------------------------------------------------------------------------------------------

plain('the gate, the registry and the app spell the peek attribute alike', () => {
  assert.equal(repo('scripts/gate-aesthetics.mjs').match(/peekAttribute:\s*'([^']+)'/)[1], 'data-marxy-peek');
  assert.ok(JSON.parse(repo('scripts/registry.json')).dataAttributes.includes('data-marxy-peek'));
  assert.match(repo('apps/desktop/src/workspace/state.ts'), /setAttribute\('data-marxy-peek'/);
});

// --- the top edge --------------------------------------------------------------------------------------------

test('resting 8 px from the top for 150 ms adds the toolbar and nothing moves; leaving takes it away', async () => {
  await withPage(async (page) => {
    const before = await column(page);
    assert.deepEqual(await peeked(page), [], 'at rest there is no peek element');
    await rest(page, 500, 4, 100);
    assert.deepEqual(await peeked(page), [], '100 ms adds nothing');
    await page.waitForTimeout(150);
    assert.deepEqual(await peeked(page), ['toolbar']);
    const during = await column(page);
    assert.equal(await page.evaluate(() => document.body.getAttribute('data-marxy-peek')), 'toolbar');
    assert.equal(await mode(page), 'folded');
    const shown = await page.evaluate(() => {
      const el = document.querySelector('[data-marxy-workspace-region="toolbar"]');
      const r = el.getBoundingClientRect();
      return { fixed: getComputedStyle(el).position, top: r.top, width: r.width, window: document.documentElement.clientWidth, buttons: el.querySelectorAll('button').length, parent: el.parentElement.tagName };
    });
    assert.deepEqual({ fixed: shown.fixed, top: shown.top, wide: shown.width === shown.window, parent: shown.parent }, { fixed: 'fixed', top: 0, wide: true, parent: 'BODY' });
    assert.ok(shown.buttons > 0, 'the toolbar is filled');
    // Staying inside the panel keeps it; the pointer leaving both the band and the panel takes it away.
    await page.mouse.move(500, 30);
    await page.waitForTimeout(50);
    assert.deepEqual(await peeked(page), ['toolbar']);
    await page.mouse.move(500, 400);
    assert.deepEqual(await peeked(page), []);
    assert.equal(await page.evaluate(() => document.body.getAttribute('data-marxy-peek')), null);
    const after = await column(page);
    assert.deepEqual(during, before, 'the article does not move while the toolbar peeks');
    assert.deepEqual(after, before, 'nor after');
  });
});

test('the dwell restarts after a hide, and a pointer that only passes through the band shows nothing', async () => {
  await withPage(async (page) => {
    await rest(page, 500, 4, 250);
    assert.deepEqual(await peeked(page), ['toolbar']);
    await page.mouse.move(500, 400);
    assert.deepEqual(await peeked(page), []);
    await page.mouse.move(500, 4);
    await page.waitForTimeout(100);
    assert.deepEqual(await peeked(page), [], 'back in the band, the wait starts over');
    await page.mouse.move(500, 400);
    await page.waitForTimeout(250);
    assert.deepEqual(await peeked(page), [], 'a pointer that left before the dwell never peeks');
  });
});

test('no peek with a button down, with a dialog open, or for a region with nothing in it', async () => {
  await withPage(async (page) => {
    await page.mouse.move(500, 400);
    await page.mouse.down();
    await page.mouse.move(500, 3);
    await page.waitForTimeout(300);
    assert.deepEqual(await peeked(page), [], 'a drag-select near the edge');
    await page.mouse.up();

    await page.evaluate(() => {
      const d = document.createElement('dialog');
      d.id = 'stray';
      document.body.append(d);
      d.showModal();
    });
    await rest(page, 500, 3, 300);
    assert.deepEqual(await peeked(page), [], 'a dialog is open');
    await page.evaluate(() => document.getElementById('stray').remove());

    await rest(page, 3, 450, 300);
    assert.deepEqual(await peeked(page), [], 'the sidebar has no fill today');
    await rest(page, 1277, 450, 300);
    assert.deepEqual(await peeked(page), [], 'nor the inspector');
    assert.equal(await ws(page, 'w.peek("sidebar")'), false);
  });
});

test('a region with a fill peeks from its edge, and the side bands win at a corner', async () => {
  await withPage(async (page) => {
    await stubFill(page, 'sidebar');
    await stubFill(page, 'inspector');
    await rest(page, 3, 450, 250);
    assert.deepEqual(await peeked(page), ['sidebar']);
    assert.equal(await page.evaluate(() => document.querySelector('[data-marxy-workspace-region]').textContent), 'sidebar stub');
    await page.mouse.move(640, 450);
    await rest(page, 1277, 450, 250);
    assert.deepEqual(await peeked(page), ['inspector']);
    await page.mouse.move(640, 450);
    await rest(page, 2, 2, 250);
    assert.deepEqual(await peeked(page), ['sidebar'], 'the corner is the sidebar');
  });
});

test('under reduced motion the peek has no animation and a transition duration of 0', async () => {
  await withPage(async (page) => {
    const look = () => page.evaluate(() => {
      const s = getComputedStyle(document.querySelector('[data-marxy-workspace-region="toolbar"]'));
      return { animation: s.animationName, shadow: s.boxShadow, transition: s.transitionDuration };
    });
    await rest(page, 500, 4, 250);
    assert.equal((await look()).animation, 'marxy-peek-in');
    await page.mouse.move(500, 400);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await rest(page, 500, 4, 250);
    const reduced = await look();
    assert.equal(reduced.animation, 'none');
    assert.equal(reduced.transition, '0s');
  });
});

// --- docking --------------------------------------------------------------------------------------------------

test('a click inside the peeked toolbar docks it: unfolded with the toolbar shown, and folding again remembers it', async () => {
  await withPage(async (page) => {
    // The toolbar was undocked last time, so docking is a change that has to be remembered.
    await page.evaluate(async () => {
      const w = window.__marxyHandle.workspace();
      await w.unfold();
      w.setPanel('toolbar', false);
      await w.fold();
    });
    await rest(page, 500, 4, 250);
    assert.deepEqual(await peeked(page), ['toolbar']);
    await page.mouse.click(640, 26); // the title takes what the controls leave: an empty stretch of the band
    await page.waitForFunction(() => window.__marxyHandle.workspace().mode === 'unfolded');
    const got = await page.evaluate(() => {
      const w = window.__marxyHandle.workspace();
      return { toolbar: w.arrangement.toolbar, shown: !w.region('toolbar').hidden, peek: document.body.getAttribute('data-marxy-peek'), regions: document.querySelectorAll('[data-marxy-workspace-region="toolbar"]').length };
    });
    assert.deepEqual(got, { toolbar: true, shown: true, peek: null, regions: 1 });
    await ws(page, 'w.fold()');
    assert.equal(await ws(page, 'w.mode'), 'folded');
    const wrote = await page.evaluate(() => window.__marxyHandle.shell.calls.filter((c) => JSON.stringify(c.args).includes('workspace.json')).length);
    assert.ok(wrote > 0, 'workspace.json was written');
    await ws(page, 'w.unfold()');
    assert.equal(await ws(page, 'w.arrangement.toolbar'), true, 'the next unfold has the toolbar');
  });
});

test('the panel keys dock from folded and toggle when unfolded, from inside CodeMirror too', async () => {
  await withPage(async (page) => {
    const m = await mod(page);
    await stubFill(page, 'inspector');
    await page.keyboard.press(`${m}+Alt+i`);
    await page.waitForFunction(() => window.__marxyHandle.workspace().mode === 'unfolded');
    const docked = () => page.evaluate(() => { const a = window.__marxyHandle.workspace().arrangement; return { inspector: a.inspector, toolbar: a.toolbar }; });
    assert.deepEqual(await docked(), { inspector: true, toolbar: true });
    await page.keyboard.press(`${m}+Alt+i`);
    assert.deepEqual(await docked(), { inspector: false, toolbar: true }, 'a second press undocks it');
    assert.equal(await mode(page), 'unfolded');

    // From inside the Source editor.
    await page.keyboard.press(`${m}+3`);
    await page.locator('.cm-content').first().click();
    await page.keyboard.press(`${m}+Alt+i`);
    assert.equal((await docked()).inspector, true, 'from CodeMirror');
    await page.keyboard.press(`${m}+Alt+i`);
    assert.equal((await docked()).inspector, false);

    if (await mac(page)) {
      // The sidebar has no fill: the chord does nothing, and is not Save either.
      await page.keyboard.press('Control+Meta+s');
      assert.equal(await page.evaluate(() => window.__marxyHandle.shell.calls.filter((c) => c.method === 'writeFileAtomic' && JSON.stringify(c.args).includes('A.md')).length), 0, 'Control+Command+S is not Save');
      await stubFill(page, 'sidebar');
      const was = (await ws(page, 'w.arrangement.sidebar'));
      await page.keyboard.press('Control+Meta+s');
      assert.equal(await ws(page, 'w.arrangement.sidebar'), !was, 'toggles the sidebar when unfolded');
      await ws(page, 'w.fold()');
      await page.keyboard.press('Control+Meta+s');
      await page.waitForFunction(() => window.__marxyHandle.workspace().mode === 'unfolded');
      assert.equal(await ws(page, 'w.arrangement.sidebar'), true, 'from folded it unfolds with the sidebar docked');
    }
  });
});

test('a panel with nothing in it has no key: the chord does nothing', async () => {
  await withPage(async (page) => {
    const m = await mod(page);
    await page.keyboard.press(`${m}+Alt+i`);
    await page.waitForTimeout(100);
    assert.equal(await mode(page), 'folded');
  });
});

// --- Esc ------------------------------------------------------------------------------------------------------

test('unfolded, Esc folds; a selection goes first; the palette, find, the outline and the verb menu keep it', async () => {
  await withPage(async (page) => {
    const m = await mod(page);
    await ws(page, 'w.unfold()');
    await page.keyboard.press('Escape');
    assert.equal(await mode(page), 'folded', 'Esc folds');
    await page.keyboard.press('Escape');
    assert.equal(await mode(page), 'folded', 'and does nothing to a folded window');

    // A selection: the first Esc clears it, the next folds.
    await ws(page, 'w.unfold()');
    await page.evaluate(() => window.__marxyHandle.selection.selectBlockAtByte(0));
    await page.waitForFunction(() => window.__marxyHandle.selection.state().selection.kind === 'node');
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => window.__marxyHandle.selection.state().selection.kind), 'none');
    assert.equal(await mode(page), 'unfolded', 'clearing a selection does not fold');
    await page.keyboard.press('Escape');
    assert.equal(await mode(page), 'folded', 'the next one does');

    // Overlays: each takes the Esc that closes it, and the workspace stays.
    await ws(page, 'w.unfold()');
    await page.evaluate(async () => {
      const { mountPaletteFromHandle } = await import('/src/palette/view.ts');
      mountPaletteFromHandle(window.__marxyHandle, { initialPath: null });
    });
    await page.keyboard.press(`${m}+k`);
    await page.waitForSelector('dialog[open]');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('dialog[open]').count(), 0, 'the palette closed');
    assert.equal(await mode(page), 'unfolded', 'with the palette open Esc closes only it');
    // The palette gives focus back a beat after it closes; the next chord is the reader's, from the page.
    await page.evaluate(() => document.activeElement?.blur());

    await page.keyboard.press(`${m}+f`);
    await page.waitForSelector('.marxy-find');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.marxy-find').count(), 0, 'find closed');
    assert.equal(await mode(page), 'unfolded', 'find');

    await page.keyboard.press(`${m}+Shift+o`);
    await page.waitForSelector('dialog[open]');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('dialog[open]').count(), 0, 'the outline closed');
    assert.equal(await mode(page), 'unfolded', 'the outline');

    await page.evaluate(() => window.__marxyHandle.selection.selectBlockAtByte(0));
    await page.waitForFunction(() => window.__marxyHandle.selection.state().selection.kind === 'node');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.marxy-verb-menu');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.marxy-verb-menu').count(), 0, 'the verb menu closed');
    assert.equal(await mode(page), 'unfolded', 'the verb menu');
  });
});

test('in a Source editor Esc does nothing to the workspace', async () => {
  await withPage(async (page) => {
    const m = await mod(page);
    await ws(page, 'w.unfold()');
    await page.keyboard.press(`${m}+3`);
    await page.locator('.cm-content').first().click();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
    assert.equal(await mode(page), 'unfolded');
  });
});
