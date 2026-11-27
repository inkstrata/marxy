// Search over many files with a short, common word: the panel draws a bounded list in time, redraws quickly while the
// reader works, draws more files on asking, and a click on a found line opens that file without reading every file again.
import { strict as assert } from 'node:assert';
import { after, test as nodeTest } from 'node:test';
import { closeHarness } from './support/two-pane.mjs';
import { drawerShows, skip, withFrame } from './support/frame.mjs';

const test = (name, fn) => nodeTest(name, { skip, timeout: 180_000 }, fn);
after(() => closeHarness());

const N = 1500;
const LINES = 40;
const FILES = { '/w/.git/HEAD': 'ref: refs/heads/main\n', '/w/start.md': '# Start\n\nNothing here.\n' };
for (let i = 0; i < N; i++) {
  const body = [];
  for (let l = 0; l < LINES; l++) body.push(`Line ${l} of the doc ${i}: see the docs and the doctor.`);
  FILES[`/w/notes/d${String(i).padStart(4, '0')}/note-${i}.md`] = `# Note ${i}\n\n${body.join('\n')}\n`;
}

const show = (page, id, arg) => page.evaluate(([id, arg]) => window.__marxyHandle.frame().left.show(id, arg), [id, arg]);
const heading = (page) => page.evaluate(() => document.querySelector('.marxy-drawer .marxy-l-body .marxy-l-sec span')?.textContent ?? '');
const groupRows = (page) => page.evaluate(() => document.querySelectorAll('.marxy-drawer [data-marxy-left-row^="g:"]').length);

test('Search: a common word over many files draws its count, a bounded list, and a click opens the line', async () => {
  await withFrame({ files: FILES, open: ['/w/start.md'] }, async (page) => {
    await show(page, 'search', { q: 'doc', scope: 'grep' });
    await drawerShows(page, 'search');
    await page.waitForFunction(() => /match/.test(document.querySelector('.marxy-drawer .marxy-l-body .marxy-l-sec span')?.textContent ?? ''), null, { timeout: 60_000 });
    assert.match(await heading(page), /^60,000 matches in 1,500 files/, 'every file is counted');
    const rows = await page.evaluate(() => document.querySelectorAll('.marxy-drawer .marxy-l-body .marxy-l-prow').length);
    assert.ok(rows <= 400, `the list draws a bounded number of rows, not ${rows}`);
    assert.equal(await groupRows(page), 100, 'a hundred files at first');
    assert.match(await page.textContent('.marxy-drawer [data-marxy-left-row="m:files"]'), /1,400 more files/);

    // A redraw, as each key or click makes, stays quick.
    const redraw = await page.evaluate(() => {
      const t = performance.now();
      window.__marxyHandle.frame().left.show('search');
      return performance.now() - t;
    });
    assert.ok(redraw < 300, `a redraw takes ${Math.round(redraw)} ms`);

    await page.locator('.marxy-drawer [data-marxy-left-row="m:files"]').click();
    await page.waitForFunction(() => document.querySelectorAll('.marxy-drawer [data-marxy-left-row^="g:"]').length === 200);
    assert.match(await page.textContent('.marxy-drawer [data-marxy-left-row="m:files"]'), /1,300 more files/);

    // Count the files read from here on: opening a found file is no reason to search every file again.
    await page.evaluate(() => {
      const shell = window.__marxyHandle.shell;
      window.__reads = 0;
      for (const k of ['peekFile', 'readFile']) {
        const f = shell[k];
        if (f) shell[k] = (...a) => (window.__reads++, f.apply(shell, a));
      }
    });
    const target = await page.evaluate(() => document.querySelectorAll('.marxy-drawer .marxy-l-hit.marxy-l-prow')[3]?.dataset.marxyLeftRow ?? null);
    assert.ok(target, 'a hit row is drawn');
    const [, path] = /^h:(.*):(\d+)$/.exec(target);
    await page.locator(`.marxy-drawer [data-marxy-left-row="${target}"]`).click();
    await page.waitForFunction((p) => window.__marxyHandle.panes().focused.path() === p, path, { timeout: 15_000 });
    await page.waitForTimeout(800);
    const reads = await page.evaluate(() => window.__reads);
    assert.ok(reads < 20, `opening one found file read ${reads} files`);
    assert.match(await heading(page), /^60,000 matches in 1,500 files/, 'the result stands');
  });
});
