// Follow a link into the neighbour pane (D-09): Cmd-click (Ctrl-click off a Mac) on a relative link opens
// the target in the other pane, made when there is one pane and two columns fit, while the pane clicked
// in keeps its document, its place and its focus. A source file opens beside in Source; a plain click
// still replaces the document in its own pane, and Back walks the history of the pane it is pressed in.
// Booted on the shipped skeleton over the memory shell (test/support/two-pane.mjs).
import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { after, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { bootTwoPanes, closeHarness } from './support/two-pane.mjs';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);
after(() => closeHarness());

const para = (word) =>
  `${word} runs long enough to wrap across several lines of the column, so that the typesetter has ` +
  'real paragraphs to break and the page is tall enough to scroll a heading to the reading line. ';
const files = {
  '/r/plan.md':
    `# Plan\n\n${para('Plan').repeat(3)}\n\n` +
    '[the result](./result.md) and [the source](./src/lib.rs) and [the logo](./logo.png) and ' +
    '[later](#later) and [the site](https://example.com/x) and [section](./result.md#deep).\n\n' +
    `${para('Plan').repeat(14)}\n\n## Later\n\n${para('Later').repeat(10)}\n`,
  '/r/readme.md': `# Readme\n\n${para('Readme').repeat(4)}\n\n- [ ] readme task\n\n[a link](#end)\n\n${para('Readme').repeat(14)}\n\n## End\n\n${para('End').repeat(10)}\n`,
  '/r/result.md': `# Result\n\n${para('Result').repeat(4)}\n\n${para('Result').repeat(14)}\n\n## Deep\n\n${para('Deep').repeat(10)}\n`,
  '/r/src/lib.rs': 'pub fn answer() -> u32 {\n    42\n}\n',
  '/r/logo.png': '\u0089PNG\r\n\u001a\n\u0000\u0000\u0000\rIHDR',
};
const FIT = 'Marxy needs a window at least 929 px wide to show two documents side by side.';

async function withPage(width, fn) {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await fn(page);
  } finally {
    await browser.close();
  }
}

const paths = (page) => page.evaluate(() => window.__marxyHandle.panes().panes.map((p) => p.path()));
const focusedSlot = (page) => page.evaluate(() => window.__marxyHandle.panes().focused.slot);
const modes = (page) => page.evaluate(() => window.__marxyHandle.panes().panes.map((p) => p.view.mode));
const noticeTexts = (page) =>
  page.evaluate(() => [...document.querySelectorAll('.marxy-notice .marxy-notice-text')].map((el) => el.textContent));
const focus = (page, slot) =>
  page.evaluate((s) => {
    const panes = window.__marxyHandle.panes();
    panes.focus(panes.panes[s]);
  }, slot);
/** A pane's reading place and its scroller's offset, with its page and store as references for "left alone". */
const place = (page, slot) =>
  page.evaluate((s) => {
    const pane = window.__marxyHandle.panes().panes[s];
    const key = `__place${s}`;
    window[key] ??= { first: pane.article.firstElementChild, store: pane.view.store() };
    return {
      path: pane.path(),
      byteOffset: pane.view.position().byteOffset,
      scrollTop: pane.view.scroller.scrollTop,
      samePage: pane.article.firstElementChild === window[key].first && pane.article.firstElementChild.isConnected,
      sameStore: pane.view.store() === window[key].store,
    };
  }, slot);
const link = (page, slot, href) => page.locator(`article#${slot === 0 ? 'doc' : 'doc-2'} a[href="${href}"]`);
/** Scrolls the link into the middle of its pane, so a click on it is where the reader is. */
const reveal = (page, slot, href) => link(page, slot, href).evaluate((a) => a.scrollIntoView({ block: 'center' }));
const cmdClick = async (page, slot, href) => {
  await reveal(page, slot, href);
  await page.waitForTimeout(150);
  await link(page, slot, href).click({ modifiers: ['ControlOrMeta'] });
};

test('Cmd-click in the left pane opens the target in the right: the left keeps its place, its page and its focus', async () => {
  await withPage(1470, async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/plan.md', '/r/readme.md'] });
    await reveal(page, 0, './result.md');
    await page.waitForTimeout(200);
    const left = await place(page, 0);
    const right = await place(page, 1);
    await link(page, 0, './result.md').click({ modifiers: ['ControlOrMeta'] });
    await page.waitForFunction(() => window.__marxyHandle.panes().panes[1].path() === '/r/result.md');
    assert.deepEqual(await paths(page), ['/r/plan.md', '/r/result.md']);
    assert.deepEqual(await place(page, 0), left, 'the plan is left alone, at the same byteOffset');
    assert.equal(await focusedSlot(page), 0, 'the pane clicked in keeps focus');
    assert.notEqual((await place(page, 1)).path, right.path);
    assert.deepEqual(await noticeTexts(page), []);
  });
});

test('Cmd-click in the right pane opens the target in the left pane and the right keeps focus', async () => {
  await withPage(1470, async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/readme.md', '/r/plan.md'] });
    await focus(page, 1);
    await cmdClick(page, 1, './result.md');
    await page.waitForFunction(() => window.__marxyHandle.panes().panes[0].path() === '/r/result.md');
    assert.deepEqual(await paths(page), ['/r/result.md', '/r/plan.md']);
    assert.equal(await focusedSlot(page), 1);
  });
});

test('Cmd-click with a fragment lands the heading in the neighbour', async () => {
  await withPage(1470, async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/plan.md', '/r/readme.md'] });
    await cmdClick(page, 0, './result.md#deep');
    await page.waitForFunction(() => window.__marxyHandle.panes().panes[1].path() === '/r/result.md');
    await page.waitForFunction(() => window.__marxyHandle.panes().panes[1].view.scroller.scrollTop > 100);
    assert.equal(await focusedSlot(page), 0);
  });
});

test('one pane, 1,470 px: Cmd-click makes the second pane with the target; the first stays put', async () => {
  await withPage(1470, async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/plan.md'] });
    await reveal(page, 0, './result.md');
    await page.waitForTimeout(200);
    const before = await place(page, 0);
    await link(page, 0, './result.md').click({ modifiers: ['ControlOrMeta'] });
    await page.waitForFunction(() => window.__marxyHandle.panes().panes[1]?.path() === '/r/result.md');
    assert.deepEqual(await paths(page), ['/r/plan.md', '/r/result.md']);
    assert.equal(await focusedSlot(page), 0);
    assert.equal((await place(page, 0)).byteOffset, before.byteOffset);
    assert.equal((await place(page, 0)).sameStore, true);
  });
});

test('one pane, 900 px: Cmd-click shows the fit notice naming 929 px and opens nothing', async () => {
  await withPage(900, async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/plan.md'] });
    await cmdClick(page, 0, './result.md');
    await page.waitForFunction((t) => [...document.querySelectorAll('.marxy-notice-text')].some((n) => n.textContent === t), FIT);
    assert.deepEqual(await paths(page), ['/r/plan.md']);
    assert.equal(await page.evaluate(() => document.getElementById('marxy-main').hasAttribute('data-marxy-split')), false);
  });
});

test('a plain click replaces the clicked pane only; Mod+[ in it returns to the plan and leaves the other pane alone', async () => {
  await withPage(1470, async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/plan.md', '/r/readme.md'] });
    const right = await place(page, 1);
    await reveal(page, 0, './result.md');
    await link(page, 0, './result.md').click();
    await page.waitForFunction(() => window.__marxyHandle.panes().panes[0].path() === '/r/result.md');
    assert.deepEqual(await paths(page), ['/r/result.md', '/r/readme.md']);
    assert.deepEqual(await place(page, 1), right, 'the right pane is untouched');
    await page.keyboard.press('ControlOrMeta+BracketLeft');
    await page.waitForFunction(() => window.__marxyHandle.panes().panes[0].path() === '/r/plan.md');
    assert.deepEqual(await paths(page), ['/r/plan.md', '/r/readme.md']);
    assert.deepEqual(await place(page, 1), right, 'Back did not move the right pane');
  });
});

test('Back is per pane: a link followed in the right pane is not undone by Mod+[ pressed in the left', async () => {
  await withPage(1470, async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/plan.md', '/r/readme.md'] });
    await focus(page, 1);
    await page.evaluate(() => {
      const a = document.createElement('a');
      a.id = 'x';
      a.setAttribute('href', './result.md');
      a.textContent = 'x';
      window.__marxyHandle.panes().panes[1].article.append(a);
    });
    await page.locator('#doc-2 #x').click();
    await page.waitForFunction(() => window.__marxyHandle.panes().panes[1].path() === '/r/result.md');
    await focus(page, 0);
    await page.keyboard.press('ControlOrMeta+BracketLeft');
    await page.waitForTimeout(300);
    assert.deepEqual(await paths(page), ['/r/plan.md', '/r/result.md'], 'the left pane has no history to walk');
    await focus(page, 1);
    await page.keyboard.press('ControlOrMeta+BracketLeft');
    await page.waitForFunction(() => window.__marxyHandle.panes().panes[1].path() === '/r/readme.md');
    assert.deepEqual(await paths(page), ['/r/plan.md', '/r/readme.md']);
  });
});

test('Cmd-click on a source file opens it beside in Source; a binary file says it is not text and opens nothing', async () => {
  await withPage(1470, async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/plan.md', '/r/readme.md'] });
    await cmdClick(page, 0, './src/lib.rs');
    await page.waitForFunction(() => window.__marxyHandle.panes().panes[1].path() === '/r/src/lib.rs');
    await page.waitForFunction(() => window.__marxyHandle.panes().panes[1].view.mode === 'source');
    assert.deepEqual(await modes(page), ['rendered', 'source']);
    assert.equal(await page.evaluate(() => window.__marxyHandle.panes().panes[1].host.getAttribute('data-marxy-mode')), 'source');
    assert.equal(await focusedSlot(page), 0);
    await cmdClick(page, 0, './logo.png');
    await page.waitForFunction(() => [...document.querySelectorAll('.marxy-notice-text')].some((n) => n.textContent === 'That file is not text.'));
    assert.deepEqual(await paths(page), ['/r/plan.md', '/r/src/lib.rs'], 'the neighbour keeps what it had');
  });
});

test('a plain click on a source file keeps the old refusal', async () => {
  await withPage(1470, async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/plan.md', '/r/readme.md'] });
    await reveal(page, 0, './src/lib.rs');
    await link(page, 0, './src/lib.rs').click();
    await page.waitForFunction(() => [...document.querySelectorAll('.marxy-notice-text')].some((n) => n.textContent === 'Only markdown documents open inside Marxy.'));
    assert.deepEqual(await paths(page), ['/r/plan.md', '/r/readme.md']);
  });
});

test('Cmd-click on #heading scrolls the pane it is in and not the other', async () => {
  await withPage(1470, async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/plan.md', '/r/readme.md'] });
    await reveal(page, 0, '#later');
    await page.waitForTimeout(200);
    const left = (await place(page, 0)).scrollTop;
    const rightBefore = await place(page, 1);
    await link(page, 0, '#later').click({ modifiers: ['ControlOrMeta'] });
    await page.waitForFunction((was) => window.__marxyHandle.panes().panes[0].view.scroller.scrollTop > was + 200, left);
    assert.deepEqual(await place(page, 1), rightBefore, 'the right pane did not move');
    assert.deepEqual(await paths(page), ['/r/plan.md', '/r/readme.md']);
    // And in the right pane: only the right moves.
    await focus(page, 1);
    const leftNow = await place(page, 0);
    await cmdClick(page, 1, '#end');
    await page.waitForFunction(() => window.__marxyHandle.panes().panes[1].view.scroller.scrollTop > 200);
    assert.deepEqual(await place(page, 0), leftNow);
  });
});

test('Cmd-click on an https link goes to openExternal and creates no pane', async () => {
  await withPage(1470, async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/plan.md'] });
    await cmdClick(page, 0, 'https://example.com/x');
    await page.waitForFunction(() => window.__marxyHandle.shell.calls.some((c) => c.method === 'openExternal'));
    assert.deepEqual(await page.evaluate(() => window.__marxyHandle.shell.calls.filter((c) => c.method === 'openExternal').map((c) => c.args[0])), ['https://example.com/x']);
    assert.deepEqual(await paths(page), ['/r/plan.md']);
  });
});

test('Cmd-click beside a neighbour with unsaved edits asks first: nothing is replaced until the answer', async () => {
  await withPage(1470, async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/plan.md', '/r/readme.md'] });
    await page.evaluate(() => {
      window.__marxyHandle.panes().panes[1].article.querySelector('input[type=checkbox]').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await page.waitForFunction(() => window.__marxyHandle.panes().panes[1].view.store()?.snapshot().dirty === true);
    await cmdClick(page, 0, './result.md');
    await page.waitForFunction(() => document.querySelector('#marxy-notices-2 .marxy-notice') !== null);
    assert.deepEqual(await paths(page), ['/r/plan.md', '/r/readme.md'], 'the dirty pane keeps its document');
    assert.equal(await page.evaluate(() => window.__marxyHandle.panes().panes[1].view.store().snapshot().dirty), true);
    assert.equal(await page.evaluate(() => window.__marxyHandle.shell.calls.filter((c) => c.method === 'writeFileAtomic' && String(c.args[0]).startsWith('/r/')).length), 0);
  });
});
