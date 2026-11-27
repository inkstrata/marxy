// Search with .* on, a pattern that backtracks without end over a line it cannot match (`(a+)+$` over a run of a and a
// final !, on forty lines: WebKit gives up on each line after about half a second, which is still twenty seconds of a
// frozen window; Chromium never gives up): the window stays alive, the panel says the pattern is too slow instead of
// listing matches, and no Replace is offered for it. The real app over the memory shell, in WebKit, with real keys.
import { strict as assert } from 'node:assert';
import { after, test as nodeTest } from 'node:test';
import { closeHarness } from './support/two-pane.mjs';
import { skip, withFrame } from './support/frame.mjs';

const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);
after(() => closeHarness());

const FILES = {
  '/w/.git/HEAD': 'ref: refs/heads/main\n',
  '/w/evil.txt': `${`${'a'.repeat(40)}!\n`.repeat(40)}second line\n`,
  '/w/fine.txt': 'one two\nthree aaa four\n',
};

/** Rejects when `p` is not answered in `ms`: a stalled window fails here, as a clean assertion. */
const within = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`STALLED: ${what} not answered in ${ms} ms`)), ms))]);
const body = (page) => page.evaluate(() => document.querySelector('.marxy-drawer .marxy-l-body')?.textContent ?? '');

test('Search: a backtracking pattern is called too slow, the window stays alive, and no Replace is offered', async () => {
  await withFrame({ files: FILES, open: ['/w/evil.txt'] }, async (page) => {
    await page.evaluate(() => window.__marxyHandle.frame().left.show('search', { q: '', scope: 'grep' }));
    await page.waitForSelector('.marxy-drawer input[data-marxy-left-field="search-q"]');
    await page.locator('.marxy-drawer .marxy-l-opt button', { hasText: '.*' }).click();
    const find = page.locator('.marxy-drawer input[data-marxy-left-field="search-q"]');
    await find.click();
    const t0 = Date.now();
    await find.pressSequentially('(a+)+$');
    // The search settles, then reads: give the window a key to answer while it works, and again once it is done.
    await within(page.keyboard.press('End'), 5000, 'a key press while the pattern searches');
    await within(page.waitForFunction(() => /too slow/.test(document.querySelector('.marxy-drawer .marxy-l-body')?.textContent ?? ''), null, { timeout: 8000 }), 9000, 'the too-slow note');
    assert.match(await body(page), /This pattern is too slow to search: simplify it/);
    assert.ok(Date.now() - t0 < 8000, 'the note arrives within the budget and a little more');
    await within(page.evaluate(() => 1), 2000, 'the page after the note');

    // The panel offers no Replace for a pattern that is too slow, and nothing is staged.
    await page.locator('.marxy-drawer input[data-marxy-left-field="search-r"]').fill('x');
    await within(page.evaluate(() => 1), 2000, 'the page after typing a replacement');
    assert.equal(await page.locator('.marxy-drawer .marxy-l-btns button.marxy-l-pri').count(), 0, 'no Stage button');
    assert.equal(await page.evaluate(() => window.__marxyHandle.panes().focused.content.store()?.snapshot().dirty ?? false), false, 'nothing was staged');

    // A pattern that backtracks no more finds its matches again, and a plain word was never held up.
    await find.fill('a+b?!');
    await page.waitForFunction(() => /40 matches in 1 file/.test(document.querySelector('.marxy-drawer .marxy-l-body')?.textContent ?? ''), null, { timeout: 8000 });
    await page.locator('.marxy-drawer .marxy-l-opt button', { hasText: '.*' }).click();
    await find.fill('second');
    await page.waitForFunction(() => /1 match in 1 file/.test(document.querySelector('.marxy-drawer .marxy-l-body')?.textContent ?? ''), null, { timeout: 8000 });
  });
});
