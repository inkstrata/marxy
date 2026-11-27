// Full screen over the memory shell: F11 takes the window full screen with the page alone, the chrome wakes on intent and
// goes again, the Line still opens, and Esc and F11 bring the frame back. Playwright WebKit.
import { strict as assert } from 'node:assert';
import { after, test as nodeTest } from 'node:test';
import { closeHarness } from './support/two-pane.mjs';
import { savedFrame, skip, withFrame } from './support/frame.mjs';

const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);
after(() => closeHarness());

const DOC = '/r/plan.md';
const FILES = { [DOC]: '# The plan\n\nA paragraph to read.\n\n## First\n\nMore words here.\n', '/r/notes.md': '# Notes\n\nSecond.\n' };

// The handle's shell is a copy of the memory shell, so its `fullscreen` flag is stale there: the calls are the window's history.
const blur = (page) => page.evaluate(() => document.activeElement?.blur());
const state = (page) =>
  page.evaluate(() => ({
    window: (window.__marxyHandle.shell.calls.filter((c) => c.method === 'setFullscreen').at(-1)?.args[0] === true),
    attr: document.body.hasAttribute('data-marxy-fullscreen'),
    frame: document.body.getAttribute('data-marxy-frame'),
    rail: !!document.querySelector('.marxy-rail')?.checkVisibility({ visibilityProperty: true }),
    tabs: !!document.querySelector('.marxy-tabbar')?.checkVisibility({ visibilityProperty: true }),
    head: Number(getComputedStyle(document.querySelector('.marxy-head')).opacity),
  }));
const fullScreenCalls = (page) => page.evaluate(() => window.__marxyHandle.shell.calls.filter((c) => c.method === 'setFullscreen').map((c) => c.args[0]));
const inFullScreen = (page, on) => page.waitForFunction((on) => (window.__marxyHandle.shell.calls.filter((c) => c.method === 'setFullscreen').at(-1)?.args[0] === true) === on && document.body.hasAttribute('data-marxy-fullscreen') === on, on);

test('F11 enters full screen with the chrome out of sight; opening the Line works; Esc closes it first, then leaves', async () => {
  await withFrame({ files: FILES, open: [DOC] }, async (page, { mod }) => {
    const rest = await state(page);
    assert.deepEqual([rest.window, rest.frame, rest.rail, rest.tabs], [false, 'unfolded', true, true]);
    await blur(page);
    await page.keyboard.press('F11');
    await inFullScreen(page, true);
    await page.waitForFunction(() => document.body.getAttribute('data-marxy-frame') === 'folded');
    await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('.marxy-head')).opacity) === 0);
    await new Promise((r) => setTimeout(r, 800));
    assert.notEqual(await savedFrame(page).then((f) => f.folded, () => false), true, 'full screen is never stored as a fold');
    const alone = await state(page);
    assert.deepEqual([alone.rail, alone.tabs, alone.head], [false, false, 0], 'the page alone: no rail, tabs or head at rest');

    await page.keyboard.press(`${mod}+KeyK`);
    await page.waitForSelector('dialog[open]');
    await page.keyboard.press('Escape');
    await page.waitForSelector('dialog[open]', { state: 'detached' });
    assert.equal((await state(page)).window, true, 'Esc closed the Line and stayed full screen');

    await blur(page);
    await page.keyboard.press('Escape');
    await inFullScreen(page, false);
    await page.waitForFunction(() => document.body.getAttribute('data-marxy-frame') === 'unfolded');
    const back = await state(page);
    assert.deepEqual([back.rail, back.tabs], [true, true], 'the chrome is back');
    assert.deepEqual(await fullScreenCalls(page), [true, false]);
  });
});

test('the pointer at the top wakes the head and it goes again; the left edge peeks the rail', async () => {
  await withFrame({ files: FILES, open: [DOC] }, async (page) => {
    await blur(page);
    await page.keyboard.press('F11');
    await inFullScreen(page, true);
    await page.mouse.move(700, 300);
    await page.mouse.move(700, 10);
    await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('.marxy-head')).opacity) === 1);
    await page.mouse.move(700, 400);
    await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('.marxy-head')).opacity) === 0, null, { timeout: 5000 });
    await page.mouse.move(0, 300);
    await page.waitForFunction(() => document.body.getAttribute('data-marxy-peek') === 'left');
    assert.equal((await state(page)).rail, true);
    await page.mouse.move(900, 300);
    await page.waitForFunction(() => !document.body.hasAttribute('data-marxy-peek'));
    assert.equal((await state(page)).rail, false, 'the rail went again');
    assert.equal((await state(page)).window, true);
  });
});

test('Esc does not leave while the find field has it; F11 leaves and puts back the fold the reader had', async () => {
  await withFrame({ files: FILES, open: [DOC] }, async (page, { mod }) => {
    await page.evaluate(() => window.__marxyHandle.frame().fold());
    await page.waitForFunction(() => document.body.getAttribute('data-marxy-frame') === 'folded');
    await blur(page);
    await page.keyboard.press('F11');
    await inFullScreen(page, true);
    await page.keyboard.press(`${mod}+KeyF`);
    await page.waitForSelector('.marxy-find-input');
    await page.keyboard.press('Escape');
    await page.waitForSelector('.marxy-find-input', { state: 'detached' });
    assert.equal((await state(page)).window, true, 'Esc closed the find field first');
    await page.keyboard.press('F11');
    await inFullScreen(page, false);
    assert.equal((await state(page)).frame, 'folded', 'the fold from before is back, not the open frame');
  });
});

test('a window the system took out of full screen is followed on the next resize', async () => {
  await withFrame({ files: FILES, open: [DOC] }, async (page) => {
    await blur(page);
    await page.keyboard.press('F11');
    await inFullScreen(page, true);
    await page.evaluate(() => {
      window.__marxyHandle.shell.leaveFullscreen();
      window.dispatchEvent(new Event('resize'));
    });
    await page.waitForFunction(() => !document.body.hasAttribute('data-marxy-fullscreen') && document.body.getAttribute('data-marxy-frame') === 'unfolded');
    assert.deepEqual(await fullScreenCalls(page), [true], 'the window was not asked to leave again');
  });
});

test('a key that opens a panel shows it over the page, and it goes with the pointer; a held F11 acts once', async () => {
  await withFrame({ files: FILES, open: [DOC] }, async (page) => {
    await blur(page);
    await page.keyboard.press('F11');
    await inFullScreen(page, true);
    await blur(page);
    await page.keyboard.press('Alt+3');
    await page.waitForFunction(() => document.body.getAttribute('data-marxy-peek') === 'left');
    assert.equal((await state(page)).rail, true);
    await page.mouse.move(900, 300);
    await page.mouse.move(1000, 300);
    await page.evaluate(() => document.activeElement?.blur());
    await page.mouse.move(1100, 300);
    await page.waitForFunction(() => !document.body.hasAttribute('data-marxy-peek'));
    assert.equal((await state(page)).window, true);
    await page.evaluate(() => {
      for (const repeat of [false, true, true])
        document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "F11", code: "F11", repeat, bubbles: true, cancelable: true }));
    });
    await inFullScreen(page, false);
    await new Promise((r) => setTimeout(r, 200));
    assert.deepEqual(await fullScreenCalls(page), [true, false], 'the repeats did nothing');
  });
});

test('in full screen the quiet button and Mod+\ leave it, with no page-alone notice', async () => {
  await withFrame({ files: FILES, open: [DOC] }, async (page, { mod }) => {
    const notices = () => page.evaluate(() => [...document.querySelectorAll('.marxy-notice-text')].map((n) => n.textContent));
    await blur(page);
    await page.keyboard.press('F11');
    await inFullScreen(page, true);
    await page.mouse.move(700, 300);
    await page.mouse.move(700, 20);
    await page.click('.marxy-quiet');
    await inFullScreen(page, false);
    assert.equal((await state(page)).frame, 'unfolded');
    await blur(page);
    await page.keyboard.press('F11');
    await inFullScreen(page, true);
    await blur(page);
    await page.keyboard.press(`${mod}+Backslash`);
    await inFullScreen(page, false);
    assert.equal((await state(page)).frame, 'unfolded');
    assert.ok(!(await notices()).some((n) => n.startsWith('The page alone')), 'no page-alone notice');
  });
});
