// Focus between two panes (D-06): `Mod+1`/`Mod+2` and `Mod+Alt+Left`/`Right` move it, a press or a wheel
// gesture after a pause over the other pane moves it, and the selection, copy and undo act on the focused
// pane. Booted on the shipped skeleton and CSS (test/support/two-pane.mjs), over the memory shell.
import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { after, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { bootTwoPanes, closeHarness } from './support/two-pane.mjs';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip }, fn);
after(() => closeHarness());

const para = (word) =>
  `${word} runs long enough to wrap across several lines of the column, so that the typesetter has ` +
  'real paragraphs to break and the page is tall enough to scroll a heading to the reading line. ';
const files = {
  '/r/A.md': `# Alpha\n\nAlpha opens [the third](C.md) here.\n\n${para('Alpha').repeat(6)}\n\n- [ ] alpha task\n`,
  '/r/B.md': `# Bravo\n\nBravo is the second document and its first paragraph.\n\n${para('Bravo').repeat(6)}\n\nBravo links [to a page](https://example.com/page).\n\n- [ ] bravo task\n`,
  '/r/C.md': `# Charlie\n\n${para('Charlie').repeat(4)}\n`,
};

async function withTwoPanes(fn) {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 1470, height: 900 } });
    await bootTwoPanes(page, { files, open: ['/r/A.md', '/r/B.md'] });
    const mod = (await page.evaluate(() => navigator.platform)) === 'MacIntel' ? 'Meta' : 'Control';
    // Every focus change the set emits: a chord that ran its command twice shows as two.
    await page.evaluate(() => {
      window.__focusEvents = 0;
      window.__marxyHandle.panes().onChange((e) => {
        if (e.kind === 'focus') window.__focusEvents += 1;
      });
    });
    await fn(page, mod);
  } finally {
    await browser.close();
  }
}

/** Which pane is focused, by the attribute, by `activeElement` and by the handle. */
const focusState = (page) =>
  page.evaluate(() => {
    const hosts = [...document.querySelectorAll('#marxy-main > section.marxy-pane')];
    const handle = window.__marxyHandle;
    return {
      marked: hosts.filter((h) => h.hasAttribute('data-marxy-focus')).map((h) => h.getAttribute('data-marxy-pane')),
      active: hosts.findIndex((h) => h.contains(document.activeElement)),
      focused: handle.panes().focused.slot,
      path: handle.currentPath(),
    };
  });

const LEFT = { marked: ['0'], active: 0, focused: 0, path: '/r/A.md' };
const RIGHT = { marked: ['1'], active: 1, focused: 1, path: '/r/B.md' };

/** The centre of `selector`'s first match once it has stopped moving (the typeset pass may still shift it). */
const stillCentre = (page, selector) =>
  page.evaluate(async (selector) => {
    const el = document.querySelector(selector);
    if (!el) throw new Error(`no ${selector}`);
    el.scrollIntoView({ block: 'center' });
    const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
    const at = () => { const r = el.getBoundingClientRect(); return `${r.x},${r.y}`; };
    let last = at();
    for (let same = 0, frames = 0; same < 3; frames += 1) {
      if (frames >= 300) throw new Error(`${selector} never held still`);
      await frame();
      const now = at();
      same = now === last ? same + 1 : 0;
      last = now;
    }
    const r = el.getBoundingClientRect();
    return [r.x + Math.min(r.width / 2, 40), r.y + r.height / 2];
  }, selector);

const clickOn = async (page, selector) => {
  const [x, y] = await stillCentre(page, selector);
  await page.mouse.click(x, y);
};

test('Mod+2 focuses the right pane and Mod+1 the left: one marked pane, activeElement in it, its path on the handle', async () => {
  await withTwoPanes(async (page, mod) => {
    assert.deepEqual({ ...(await focusState(page)), active: 0 }, LEFT);
    await page.keyboard.press(`${mod}+2`);
    assert.deepEqual(await focusState(page), RIGHT);
    // The window title follows (D-01's listener; asserted here so the chord's whole effect is pinned).
    assert.equal(await page.evaluate(() => document.title), 'B.md — Marxy');
    await page.keyboard.press(`${mod}+1`);
    assert.deepEqual(await focusState(page), LEFT);
  });
});

test('a pane chord runs its command once, not again in the registry dispatcher', async () => {
  await withTwoPanes(async (page, mod) => {
    await page.keyboard.press(`${mod}+2`);
    await page.keyboard.press(`${mod}+1`);
    await page.keyboard.press(`${mod}+Alt+ArrowRight`);
    assert.equal(await page.evaluate(() => window.__focusEvents), 3);
  });
});

test('Mod+Alt+ArrowRight and Mod+Alt+ArrowLeft move focus too, and Alt+ArrowLeft alone still goes back', async () => {
  await withTwoPanes(async (page, mod) => {
    await page.keyboard.press(`${mod}+Alt+ArrowRight`);
    assert.deepEqual(await focusState(page), RIGHT);
    await page.keyboard.press(`${mod}+Alt+ArrowLeft`);
    assert.deepEqual(await focusState(page), LEFT);
    // A link followed in the left pane, then history back: the left pane goes back, focus stays.
    await clickOn(page, '#doc a[href="C.md"]');
    await page.waitForFunction(() => window.__marxyHandle.panes().panes[0].path() === '/r/C.md');
    await page.keyboard.press('Alt+ArrowLeft');
    await page.waitForFunction(() => window.__marxyHandle.panes().panes[0].path() === '/r/A.md');
    const after = await focusState(page);
    assert.deepEqual([after.focused, after.path], [0, '/r/A.md']);
    assert.equal(await page.evaluate(() => window.__marxyHandle.panes().panes[1].path()), '/r/B.md');
  });
});

test('a click in the unfocused pane focuses it and selects the block under it; a wheel after stillness focuses the other', async () => {
  await withTwoPanes(async (page) => {
    await clickOn(page, '#doc-2 p');
    assert.deepEqual(await focusState(page), RIGHT);
    const selected = await page.evaluate(() => ({
      kind: window.__marxyHandle.selection.state().selection.kind,
      inRight: document.querySelectorAll('#doc-2 .marxy-selected').length,
      inLeft: document.querySelectorAll('#doc .marxy-selected').length,
      // The typesetter's soft hyphens and spaces aside, the words of the paragraph clicked.
      text: (document.querySelector('#doc-2 .marxy-selected')?.textContent ?? '').replace(/\u00ad/g, '').replace(/\s+/g, ' '),
    }));
    assert.deepEqual(selected, { kind: 'node', inRight: 1, inLeft: 0, text: 'Bravo is the second document and its first paragraph.' });

    // The pointer over the left pane, still for longer than the gap: the first wheel event focuses it.
    await page.mouse.move(300, 450);
    await page.waitForTimeout(300);
    await page.mouse.wheel(0, 40);
    await page.waitForFunction(() => window.__marxyHandle.panes().focused.slot === 0);
    // Straight on over the right pane, inside the same gesture: focus stays where the gesture began.
    await page.mouse.move(1100, 450);
    await page.mouse.wheel(0, 40);
    await page.mouse.wheel(0, 40);
    await page.waitForTimeout(50);
    assert.equal(await page.evaluate(() => window.__marxyHandle.panes().focused.slot), 0);
  });
});

test('focusing the other pane clears the selection; Mod+C copies the focused pane\'s selected block', async () => {
  await withTwoPanes(async (page, mod) => {
    await clickOn(page, '#doc p:nth-of-type(2)');
    assert.equal(await page.evaluate(() => document.querySelectorAll('#doc .marxy-selected').length), 1);
    await page.keyboard.press(`${mod}+2`);
    const cleared = await page.evaluate(() => ({
      kind: window.__marxyHandle.selection.state().selection.kind,
      marked: document.querySelectorAll('.marxy-selected').length,
    }));
    assert.deepEqual(cleared, { kind: 'none', marked: 0 });

    await clickOn(page, '#doc-2 p');
    await page.keyboard.press(`${mod}+c`);
    await page.waitForFunction(() => window.__marxyHandle.shell.calls.some((c) => c.method === 'clipboardWrite'));
    const copied = await page.evaluate(() =>
      window.__marxyHandle.shell.calls.filter((c) => c.method === 'clipboardWrite').map((c) => c.args[0].text),
    );
    assert.deepEqual(copied, ['Bravo is the second document and its first paragraph.']);
  });
});

test('Mod+2 from inside the left pane\'s Source editor still moves focus; Mod+1 gives it back to the editor', async () => {
  await withTwoPanes(async (page, mod) => {
    await page.evaluate(() => window.__marxyHandle.toggleMode());
    await page.waitForSelector('#marxy-source .cm-content');
    await page.focus('#marxy-source .cm-content');
    assert.equal(await page.evaluate(() => document.activeElement.classList.contains('cm-content')), true);
    await page.keyboard.press(`${mod}+2`);
    assert.deepEqual(await focusState(page), RIGHT);
    await page.keyboard.press(`${mod}+1`);
    const back = await page.evaluate(() => ({
      focused: window.__marxyHandle.panes().focused.slot,
      inEditor: document.querySelector('#marxy-source .cm-content') === document.activeElement,
    }));
    assert.deepEqual(back, { focused: 0, inEditor: true });
  });
});

test('Mod+Z undoes the focused pane\'s file only: the right pane\'s tick, then after Mod+1 the left one\'s', async () => {
  await withTwoPanes(async (page, mod) => {
    const text = () =>
      page.evaluate(() =>
        window.__marxyHandle.panes().panes.map((p) => new TextDecoder().decode(p.view.store().snapshot().buffer.bytes)),
      );
    await clickOn(page, '#doc input[type=checkbox]');
    await page.waitForFunction(() => window.__marxyHandle.panes().panes[0].view.store().snapshot().canUndo);
    await clickOn(page, '#doc-2 input[type=checkbox]');
    await page.waitForFunction(() => window.__marxyHandle.panes().panes[1].view.store().snapshot().canUndo);
    let [left, right] = await text();
    assert.ok(left.includes('- [x] alpha task') && right.includes('- [x] bravo task'), `${left}\n${right}`);
    // The tick in the right pane focused it.
    assert.equal(await page.evaluate(() => window.__marxyHandle.panes().focused.slot), 1);

    await page.keyboard.press(`${mod}+z`);
    await page.waitForFunction(() => !window.__marxyHandle.panes().panes[1].view.store().snapshot().canUndo);
    [left, right] = await text();
    assert.ok(left.includes('- [x] alpha task') && right.includes('- [ ] bravo task'), `${left}\n${right}`);

    await page.keyboard.press(`${mod}+1`);
    await page.keyboard.press(`${mod}+z`);
    await page.waitForFunction(() => !window.__marxyHandle.panes().panes[0].view.store().snapshot().canUndo);
    [left, right] = await text();
    assert.ok(left.includes('- [ ] alpha task') && right.includes('- [ ] bravo task'), `${left}\n${right}`);
  });
});

test('one pane: the focus chords do nothing and the palette lists neither focus command', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 1470, height: 900 } });
    await bootTwoPanes(page, { files, open: ['/r/A.md'] });
    const mod = (await page.evaluate(() => navigator.platform)) === 'MacIntel' ? 'Meta' : 'Control';
    await page.keyboard.press(`${mod}+2`);
    const state = await page.evaluate(async () => {
      const { buildAppContext } = await import('/src/selection/bind.ts');
      const ctx = buildAppContext(window.__marxyHandle);
      return {
        panes: window.__marxyHandle.panes().panes.length,
        focused: window.__marxyHandle.panes().focused.slot,
        listed: window.__marxyHandle.commands().filter((c) => c.id.startsWith('view.focus-') && c.when(ctx)).map((c) => c.id),
      };
    });
    assert.deepEqual(state, { panes: 1, focused: 0, listed: [] });
  } finally {
    await browser.close();
  }
});

test('the right pane\'s page is told to the selection: its links show their destinations, and a selection there re-resolves after an edit', async () => {
  await withTwoPanes(async (page) => {
    assert.equal(await page.evaluate(() => document.querySelector('#doc-2 a[href="https://example.com/page"] .marxy-link-dest')?.textContent ?? null), 'example.com');
    await clickOn(page, '#doc-2 p');
    // An edit in the right pane sets its page again: the selected paragraph is found on the new page.
    await page.evaluate(async () => {
      const handle = window.__marxyHandle;
      const text = new TextDecoder().decode(handle.document().snapshot().buffer.bytes);
      const at = new TextEncoder().encode(text.slice(0, text.indexOf('- [ ] bravo'))).length + 2;
      await handle.dispatch({ type: 'apply', range: { file: '/r/B.md', start: at, end: at + 3 }, replacement: '[x]', label: 'tick' });
      await handle.panes().panes[1].view.settled();
    });
    const after = await page.evaluate(() => {
      const sel = window.__marxyHandle.selection.state().selection;
      return { kind: sel.kind, connected: sel.kind === 'node' && sel.el.isConnected, marked: document.querySelectorAll('#doc-2 .marxy-selected').length };
    });
    assert.deepEqual(after, { kind: 'node', connected: true, marked: 1 });
  });
});

test('focusOrigin gives focus back to the pane an overlay opened from', async () => {
  await withTwoPanes(async (page, mod) => {
    await page.keyboard.press(`${mod}+2`);
    const restored = await page.evaluate(async () => {
      const { focusOrigin } = await import('/src/pane/focus.ts');
      const panes = window.__marxyHandle.panes();
      const origin = focusOrigin(panes);
      // An overlay takes the keyboard, and the reader moves focus elsewhere meanwhile.
      panes.focus(panes.panes[0]);
      document.body.focus();
      origin.restore();
      return { focused: panes.focused.slot, active: panes.panes[1].host.contains(document.activeElement) };
    });
    assert.deepEqual(restored, { focused: 1, active: true });
  });
});
