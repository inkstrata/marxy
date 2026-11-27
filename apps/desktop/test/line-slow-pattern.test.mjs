// The Line's / find with a regular expression that backtracks without end (`/(a+)+$/` over forty lines of a run of a and
// a final !; WebKit gives up on each line after about half a second, Chromium never does): a key is answered, the Line
// says the pattern is too slow instead of listing matches, and a plain-text find after it still lists its lines.
import { strict as assert } from 'node:assert';
import { after, test as nodeTest } from 'node:test';
import { closeHarness } from './support/two-pane.mjs';
import { skip, withFrame } from './support/frame.mjs';

const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);
after(() => closeHarness());

const FILES = { '/r/evil.txt': `${`${'a'.repeat(40)}!\n`.repeat(40)}the second line\n` };

/** Rejects when `p` is not answered in `ms`: a stalled window fails here, as a clean assertion. */
const within = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`STALLED: ${what} not answered in ${ms} ms`)), ms))]);
const notice = (page) => page.evaluate(() => document.querySelector('#marxy-palette .marxy-palette-notice')?.textContent ?? '');

test('Line: a backtracking / find is called too slow and the window stays alive', async () => {
  await withFrame({ files: FILES, open: ['/r/evil.txt'] }, async (page) => {
    await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
    await page.keyboard.press('Slash');
    await page.waitForSelector('#marxy-palette[open]');
    await within(page.keyboard.type('/(a+)+$/'), 5000, 'the keys of the pattern');
    await within(page.keyboard.press('End'), 5000, 'a key press while the pattern searches');
    await within(page.waitForFunction(() => /too slow/.test(document.querySelector('#marxy-palette .marxy-palette-notice')?.textContent ?? ''), null, { timeout: 8000 }), 9000, 'the too-slow note');
    assert.match(await notice(page), /This pattern is too slow to search: simplify it/);
    assert.equal(await page.locator('#marxy-palette .marxy-palette-row').count(), 0, 'no matches are listed');
    await within(page.evaluate(() => 1), 2000, 'the page after the note');

    await page.fill('#marxy-palette .marxy-palette-query', '/second');
    await page.waitForFunction(() => document.querySelectorAll('#marxy-palette .marxy-palette-row').length === 1, null, { timeout: 8000 });
  });
});

test('Line: Enter while a / find is still searching does not run the pattern on the page', async () => {
  await withFrame({ files: FILES, open: ['/r/evil.txt'] }, async (page) => {
    await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
    await page.keyboard.press('Slash');
    await page.waitForSelector('#marxy-palette[open]');
    await within(page.keyboard.type('/(a+)+$/'), 5000, 'the keys of the pattern');
    const t0 = Date.now();
    await within(page.keyboard.press('Enter'), 5000, 'Enter while the pattern searches');
    await within(page.evaluate(() => new Promise((r) => setTimeout(() => r(1), 50))), 3000, 'the page after Enter');
    const took = Date.now() - t0;
    assert.ok(took < 1000, `Enter and the next answer took ${took} ms`);
  });
});
