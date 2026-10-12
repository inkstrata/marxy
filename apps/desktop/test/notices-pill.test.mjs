// U-02: news as pills off the reading column. A notice is a pill at the foot of the pane it is about, centred, with a glyph
// and a word for its kind; outcomes fade at 4 s (held under the pointer or focus), refusals and errors stay until dismissed,
// a decision stays until answered and takes focus; one key focuses the newest notice and Esc dismisses a focused one; three
// show at most. The real app over the memory shell on the shipped skeleton, in WebKit (test/support/two-pane.mjs). That a
// notice moves no text is test/no-displacement.test.mjs's.
import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { after, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { paneChordFor } from '../src/pane/keys.ts';
import { bootTwoPanes, closeHarness } from './support/two-pane.mjs';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);
after(() => closeHarness());

const para = (word) =>
  `${word} runs long enough to wrap across several lines of the column, so that the typesetter has ` +
  'real paragraphs to break and the page is tall enough to scroll. ';
const paras = (word, n) => Array.from({ length: n }, () => para(word)).join('\n\n');
const files = {
  '/r/A.md': `# Alpha\n\n${paras('Alpha', 24)}\n\n- [ ] alpha task\n`,
  '/r/B.md': `# Bravo\n\n${paras('Bravo', 24)}\n\n- [ ] bravo task\n`,
};

async function withApp(fn, { open = ['/r/A.md'], unfolded = false, viewport = { width: 1280, height: 900 } } = {}) {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport });
    await bootTwoPanes(page, { files, open, guard: true });
    if (unfolded) await page.evaluate(() => window.__marxyHandle.workspace().unfold());
    await page.evaluate(() => (document.querySelector('#marxy-main[data-marxy-split]') ? document.querySelector('.marxy-pane').scrollTo(0, 900) : window.scrollTo(0, 900)));
    await fn(page);
  } finally {
    await browser.close();
  }
}

/** Says `input` through the app's own `notify`, in pane `slot` (0 or 1). `actions` are labels; each counts into `window.__acted`. */
const raise = (page, input, slot = 0) =>
  page.evaluate(
    async ({ input, slot }) => {
      const { notify } = await import('/src/notices/index.ts');
      window.__acted = [];
      const pane = document.querySelectorAll('section.marxy-pane')[slot];
      const actions = (input.actions ?? []).map((label) => ({ label, onClick: () => window.__acted.push(label) }));
      return notify({ ...input, actions }, { pane });
    },
    { input, slot },
  );
const count = (page) => page.evaluate(() => document.querySelectorAll('.marxy-notice').length);
const shown = (page) =>
  page.evaluate(() => [...document.querySelectorAll('.marxy-notice')].filter((n) => getComputedStyle(n).display !== 'none').map((n) => n.querySelector('.marxy-notice-text').textContent));
const gone = (page, timeout = 6000) => page.waitForFunction(() => document.querySelector('.marxy-notice') === null, undefined, { timeout });

/** Where the pill, its region and its pane are, and whether the pill is in the article's flow. */
const geometry = async (page, slot = 0) => {
  // The pill slides in over 160 ms; measure it where it comes to rest.
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
  return page.evaluate((slot) => {
    const pane = document.querySelectorAll('section.marxy-pane')[slot];
    const region = pane.querySelector(':scope > [role="status"]');
    const pill = region.querySelector('.marxy-notice');
    const r = (el) => {
      const b = el.getBoundingClientRect();
      return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, width: b.width, height: b.height };
    };
    return {
      pane: r(pane),
      region: r(region),
      pill: r(pill),
      regionPosition: getComputedStyle(region).position,
      inArticle: pill.closest('article') !== null,
      lastChild: pane.lastElementChild === region,
      vh: window.innerHeight,
      statusH: parseFloat(getComputedStyle(document.body).getPropertyValue('--marxy-ws-status-h')) || 0,
    };
  }, slot);
};
const centred = (g) => Math.abs((g.pill.left + g.pill.right) / 2 - (g.pane.left + g.pane.right) / 2);

for (const windowState of ['folded', 'unfolded']) {
  test(`${windowState}: a notice is a pill at the foot of its pane, centred, off the article's flow, and it stays there as the page scrolls`, () =>
    withApp(
      async (page) => {
        await raise(page, { kind: 'refused', text: 'A pill, raised for its place.' });
        const g = await geometry(page);
        assert.equal(g.inArticle, false);
        assert.equal(g.lastChild, true, 'the region is the pane\'s last child');
        assert.equal(g.region.height, 0, 'the region takes no room');
        assert.ok(centred(g) <= 1, `centred on the pane (${centred(g)}px off)`);
        assert.ok(g.pill.bottom <= g.vh - g.statusH - 4, 'above the window foot, and the status bar if there is one');
        assert.ok(g.pill.bottom >= g.vh - g.statusH - 90, `near the foot (bottom at ${g.pill.bottom} of ${g.vh})`);
        assert.ok(g.pill.width < g.pane.width * 0.8, 'a pill, not a bar');
        // The page scrolls under it: it holds its place.
        await page.evaluate(() => window.scrollTo(0, 2400));
        const scrolled = await geometry(page);
        assert.equal(scrolled.pill.bottom, g.pill.bottom);
        await page.evaluate(() => window.scrollTo(0, 0));
        assert.equal((await geometry(page)).pill.bottom, g.pill.bottom);
      },
      { unfolded: windowState === 'unfolded' },
    ));
}

test('split: each pane has its own pills at its own foot, and one pane\'s news is not drawn in the other', () =>
  withApp(
    async (page) => {
      await raise(page, { kind: 'done', text: 'Left news.' }, 0);
      await raise(page, { kind: 'refused', text: 'Right news.' }, 1);
      for (const slot of [0, 1]) {
        const g = await geometry(page, slot);
        assert.ok(centred(g) <= 1, `pane ${slot}: centred`);
        assert.ok(g.pill.left >= g.pane.left && g.pill.right <= g.pane.right, `pane ${slot}: inside its pane`);
        assert.ok(g.pill.bottom <= g.pane.bottom - 4 && g.pill.bottom >= g.pane.bottom - 90, `pane ${slot}: at its foot`);
      }
      const texts = await page.evaluate(() => [...document.querySelectorAll('section.marxy-pane')].map((p) => [...p.querySelectorAll('.marxy-notice-text')].map((t) => t.textContent)));
      assert.deepEqual(texts, [['Left news.'], ['Right news.']]);
    },
    { open: ['/r/A.md', '/r/B.md'], viewport: { width: 1470, height: 900 } },
  ));

test('every kind says what it is with a glyph and a word, and a decision is an alert dialog', () =>
  withApp(async (page) => {
    const expected = { done: 'Done', refused: 'Not done', error: 'Not done', decision: 'Needs you', info: 'Note', blocked: 'Note' };
    for (const [kind, word] of Object.entries(expected)) {
      await raise(page, { kind, text: `A ${kind} notice.`, actions: kind === 'decision' ? ['Choose'] : [] });
    }
    const seen = await page.evaluate(() =>
      [...document.querySelectorAll('.marxy-notice')].map((n) => ({
        kind: n.dataset.noticeKind,
        word: n.querySelector('.marxy-notice-kind')?.textContent,
        glyph: n.querySelector('.marxy-notice-glyph svg')?.getAttribute('aria-hidden'),
        shape: [...n.querySelectorAll('.marxy-notice-glyph path')].map((p) => p.getAttribute('d')).join('|'),
        role: n.getAttribute('role'),
      })),
    );
    assert.equal(seen.length, 6);
    for (const n of seen) {
      assert.equal(n.word, expected[n.kind], n.kind);
      assert.equal(n.glyph, 'true', `${n.kind}: a glyph, hidden from assistive technology`);
      assert.equal(n.role, n.kind === 'decision' ? 'alertdialog' : null, `${n.kind}: role`);
    }
    // Told apart without colour: no two kinds share a glyph.
    assert.equal(new Set(seen.map((n) => n.shape)).size, 6, 'six kinds, six glyphs');
    // The region stays a polite live region.
    assert.equal(await page.evaluate(() => document.querySelector('.marxy-pane > [role="status"]').getAttribute('role')), 'status');
  }));

test('an outcome fades after 4 s; a refusal and an error stay until dismissed', () =>
  withApp(async (page) => {
    await raise(page, { kind: 'done', text: 'Copied as Markdown, 3.1 KB' });
    await raise(page, { kind: 'refused', text: 'Nothing was pasted.' });
    await raise(page, { kind: 'error', text: 'Could not save.' });
    const t0 = Date.now();
    await page.waitForTimeout(2000);
    assert.equal((await shown(page)).length, 3, 'all three are up at 2 s');
    await page.waitForFunction(() => ![...document.querySelectorAll('.marxy-notice-text')].some((t) => t.textContent.startsWith('Copied')), undefined, { timeout: 6000 });
    const took = Date.now() - t0;
    assert.ok(took >= 3500 && took < 5500, `the outcome went at ${took} ms`);
    await page.waitForTimeout(1500);
    assert.deepEqual(await shown(page), ['Nothing was pasted.', 'Could not save.'], 'the refusal and the error are still up');
    // A reader's Dismiss takes one.
    await page.locator('.marxy-notice[data-notice-kind="error"] .marxy-notice-dismiss').click();
    assert.deepEqual(await shown(page), ['Nothing was pasted.']);
  }));

test('an outcome is held while the pointer is on it, and goes after it leaves', () =>
  withApp(async (page) => {
    await raise(page, { kind: 'done', text: 'Held by the pointer.' });
    const g = await geometry(page);
    await page.mouse.move((g.pill.left + g.pill.right) / 2, (g.pill.top + g.pill.bottom) / 2);
    await page.waitForTimeout(5000);
    assert.equal(await count(page), 1, 'still up after 5 s under the pointer');
    await page.mouse.move(5, 5);
    await gone(page);
  }));

test('an outcome is held while focus is in it, and goes after focus leaves', () =>
  withApp(async (page) => {
    await raise(page, { kind: 'done', text: 'Held by focus.' });
    await page.keyboard.press('ControlOrMeta+Alt+n');
    await page.waitForFunction(() => document.activeElement?.classList.contains('marxy-notice'));
    await page.waitForTimeout(5000);
    assert.equal(await count(page), 1, 'still up after 5 s with focus in it');
    await page.evaluate(() => document.activeElement.blur());
    await gone(page);
  }));

test('one key focuses the newest notice, Tab reaches its action, and Esc dismisses it and gives focus back', () =>
  withApp(async (page) => {
    await raise(page, { kind: 'refused', text: 'Older news.' });
    await raise(page, { kind: 'info', text: 'Newest news.', actions: ['Do it'] });
    // Focus is on something real, so that it can be seen to come back.
    await page.evaluate(() => {
      const b = document.createElement('button');
      b.id = 'marxy-test-anchor';
      document.body.append(b);
      b.focus();
    });
    // Esc with focus outside any notice leaves the notices alone.
    await page.keyboard.press('Escape');
    assert.equal(await count(page), 2);
    await page.keyboard.press('ControlOrMeta+Alt+n');
    const focused = () => page.evaluate(() => ({ cls: document.activeElement?.className, text: document.activeElement?.closest('.marxy-notice')?.querySelector('.marxy-notice-text')?.textContent }));
    assert.deepEqual(await focused(), { cls: 'marxy-notice', text: 'Newest news.' });
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Do it');
    await page.keyboard.press('Enter');
    assert.deepEqual(await page.evaluate(() => window.__acted), ['Do it'], 'the action runs from the keyboard');
    await page.keyboard.press('Escape');
    assert.deepEqual(await shown(page), ['Older news.'], 'Esc dismissed the focused notice and only that');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'marxy-test-anchor', 'focus went back to where it was');
    // With none left to focus the key does nothing.
    await page.keyboard.press('ControlOrMeta+Alt+n');
    await page.keyboard.press('Escape');
    await page.keyboard.press('ControlOrMeta+Alt+n');
    await page.keyboard.press('Escape');
    assert.equal(await count(page), 0);
    await page.keyboard.press('ControlOrMeta+Alt+n');
    assert.equal(await page.evaluate(() => document.activeElement?.closest('.marxy-notice') ?? null), null);
  }));

test('at most three pills show; the older wait and come up as the newer go, and a decision always shows', () =>
  withApp(async (page) => {
    for (const n of [1, 2, 3, 4, 5]) await raise(page, { kind: 'info', text: `News ${n}.` });
    assert.deepEqual(await shown(page), ['News 3.', 'News 4.', 'News 5.']);
    assert.equal(await count(page), 5, 'none was thrown away');
    await page.locator('.marxy-notice', { hasText: 'News 5.' }).locator('.marxy-notice-dismiss').click();
    assert.deepEqual(await shown(page), ['News 2.', 'News 3.', 'News 4.']);
    await raise(page, { kind: 'decision', text: 'Choose now.', actions: ['Yes'] });
    assert.deepEqual(await shown(page), ['News 3.', 'News 4.', 'Choose now.'], 'the decision shows, with the two newest');
  }));

test('the unsaved-changes decision floats, takes focus on its first button, and is answered from the keyboard alone', () =>
  withApp(
    async (page) => {
      await page.evaluate(() => {
        const panes = window.__marxyHandle.panes();
        panes.focus(panes.panes[1]);
        panes.panes[1].article.querySelector('input[type=checkbox]').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      });
      await page.waitForFunction(() => window.__marxyHandle.panes().panes[1].view.store()?.snapshot().dirty === true);
      await page.keyboard.press('ControlOrMeta+Shift+Backslash');
      await page.waitForSelector('.marxy-notice[data-notice-kind="decision"]');
      const state = await page.evaluate(() => {
        const line = document.querySelector('.marxy-notice[data-notice-kind="decision"]');
        return {
          role: line.getAttribute('role'),
          inPane1: line.closest('section.marxy-pane') === document.querySelectorAll('section.marxy-pane')[1],
          focused: document.activeElement?.textContent,
          buttons: [...line.querySelectorAll('button')].map((b) => b.textContent),
        };
      });
      assert.equal(state.role, 'alertdialog');
      assert.equal(state.inPane1, true);
      assert.deepEqual(state.buttons.slice(-1), ['Dismiss']);
      assert.equal(state.focused, state.buttons[0], 'focus is on the first button, the safe one');
      // It does not fade.
      await page.waitForTimeout(4600);
      assert.equal(await count(page), 1);
      // Tab to the second button, Enter answers it.
      await page.keyboard.press('Tab');
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => window.__marxyHandle.panes().panes.length === 1);
      assert.equal(await count(page), 0);
    },
    { open: ['/r/A.md', '/r/B.md'], viewport: { width: 1470, height: 900 } },
  ));

test('a decision dismissed with Esc stops the action: the document is not lost and the pane stays', () =>
  withApp(
    async (page) => {
      await page.evaluate(() => {
        const panes = window.__marxyHandle.panes();
        panes.focus(panes.panes[1]);
        panes.panes[1].article.querySelector('input[type=checkbox]').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      });
      await page.waitForFunction(() => window.__marxyHandle.panes().panes[1].view.store()?.snapshot().dirty === true);
      await page.keyboard.press('ControlOrMeta+Shift+Backslash');
      await page.waitForSelector('.marxy-notice[data-notice-kind="decision"]');
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => document.querySelector('.marxy-notice[data-notice-kind="decision"]') === null);
      assert.equal(await page.evaluate(() => window.__marxyHandle.panes().panes.length), 2, 'the pane did not close');
      assert.equal(await page.evaluate(() => window.__marxyHandle.panes().panes[1].view.store()?.snapshot().dirty), true, 'the edit is still unsaved, and still there');
    },
    { open: ['/r/A.md', '/r/B.md'], viewport: { width: 1470, height: 900 } },
  ));

for (const windowState of ['folded', 'unfolded']) {
  test(`${windowState}: in Source a notice floats at the foot of the window and the editor does not move`, () =>
  withApp(async (page) => {
    await page.keyboard.press('ControlOrMeta+e');
    await page.waitForSelector('#marxy-source .cm-content .cm-line');
    await page.evaluate(() => document.querySelector('#marxy-source').scrollTo(0, 400));
    const place = () =>
      page.evaluate(() => {
        const scroller = document.querySelector('#marxy-source');
        const first = [...document.querySelectorAll('#marxy-source .cm-line')].find((l) => l.getBoundingClientRect().top >= 0);
        const b = first.getBoundingClientRect();
        return { scrollTop: scroller.scrollTop, line: first.textContent.slice(0, 30), top: b.top, left: b.left };
      });
    const before = await place();
    assert.ok(before.scrollTop > 0);
    await raise(page, { kind: 'refused', text: 'News over Source.' });
    assert.deepEqual(await place(), before);
    const g = await geometry(page);
    assert.ok(centred(g) <= 1);
    assert.ok(g.pill.bottom <= g.vh - g.statusH - 4 && g.pill.bottom >= g.vh - g.statusH - 90, `at the window's foot (bottom at ${g.pill.bottom} of ${g.vh}, bar ${g.statusH})`);
    await page.locator('.marxy-notice-dismiss').click();
    assert.deepEqual(await place(), before);
  }, { unfolded: windowState === 'unfolded' }));
}

test('in a split with Source in one pane, the pill is at that pane\'s foot', () =>
  withApp(
    async (page) => {
      await page.evaluate(() => {
        const panes = window.__marxyHandle.panes();
        panes.focus(panes.panes[1]);
      });
      await page.keyboard.press('ControlOrMeta+e');
      await page.waitForSelector('#marxy-source-2 .cm-content .cm-line');
      await raise(page, { kind: 'refused', text: 'News over the right pane.' }, 1);
      const g = await geometry(page, 1);
      assert.ok(g.pill.left >= g.pane.left && g.pill.right <= g.pane.right);
      assert.ok(centred(g) <= 1);
      assert.ok(g.pill.bottom <= g.pane.bottom - 4 && g.pill.bottom >= g.pane.bottom - 90, `at the pane's foot (bottom ${g.pill.bottom}, pane ${g.pane.bottom})`);
    },
    { open: ['/r/A.md', '/r/B.md'], viewport: { width: 1470, height: 900 } },
  ));

test('reduced motion removes the pill\'s slide and its fade; forced colours keep its outline', () =>
  withApp(async (page) => {
    await page.emulateMedia({ reducedMotion: 'reduce', forcedColors: 'active' });
    await raise(page, { kind: 'done', text: 'Quiet news.' });
    const style = await page.evaluate(() => {
      const cs = getComputedStyle(document.querySelector('.marxy-notice'));
      return { animation: cs.animationName, transition: cs.transitionDuration, border: cs.borderTopWidth, borderStyle: cs.borderTopStyle };
    });
    assert.equal(style.animation, 'none', 'no slide');
    assert.ok(parseFloat(style.transition) < 0.001, `no fade (${style.transition})`);
    assert.equal(style.borderStyle, 'solid');
    assert.ok(parseFloat(style.border) >= 1, 'an outline in forced colours');
    // The outcome still goes at 4 s, and at once.
    await page.waitForFunction(() => document.querySelector('.marxy-notice') === null, undefined, { timeout: 6000 });
  }));

nodeTest('the notice key is a pane chord on the physical key, so Option rewriting the letter on a Mac does not lose it', () => {
  const press = { code: 'KeyN', key: 'ñ', metaKey: true, ctrlKey: false, altKey: true, shiftKey: false };
  assert.equal(paneChordFor(press, true)?.command, 'notices.focus');
  assert.equal(paneChordFor({ ...press, metaKey: false, ctrlKey: true }, false)?.command, 'notices.focus');
  assert.equal(paneChordFor({ ...press, altKey: false }, true), null, 'Mod+N alone is not it');
});
