// Big Markdown read as lines: a 6 MB Markdown file opens as Lines, not parsed, its Outline the headings a scan of its lines
// found, each going to its line; `g r` shows it rendered with the full Outline, and `g r` again comes back to lines; under
// 5 MB Markdown opens as its page as before. Playwright WebKit over the app harness (src/harness/web.ts); the files are
// made in the page and planted in the memory shell, so no large fixture is kept.
import { strict as assert } from 'node:assert';
import { after, before, test as nodeTest } from 'node:test';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { closeHarness, harnessBase } from './support/two-pane.mjs';
import { skip } from './support/frame.mjs';

const test = (name, fn) => nodeTest(name, { skip, timeout: 420_000 }, fn);
let browser = null;
before(async () => {
  if (!skip) browser = await launchWebkit();
});
after(async () => {
  await browser?.close();
  await closeHarness();
});

/** Opens a Markdown file of about `mb` MB: a title, then numbered sections with a fence holding a `#` line now and then. */
async function withMarkdown(mb, fn) {
  const base = await harnessBase();
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  const problems = [];
  page.on('pageerror', (e) => problems.push(e.message));
  try {
    await page.goto(`${base}?open=${encodeURIComponent('logs/build-2026-10-14.log')}`);
    await page.waitForFunction(() => window.marxy?.handle);
    const made = await page.evaluate(async (size) => {
      const parts = ['# The big book', ''];
      // A section about a kilobyte long, so the file holds a few thousand headings, well under what the scan keeps.
      const prose = 'More words that make a paragraph of an ordinary length, as a book would have them. '.repeat(10);
      let n = 0;
      let sections = 0;
      for (let i = 0; n < size * 1024 * 1024; i++) {
        const chunk =
          `## Section ${i}\n\nSome *prose* with a [link](http://example.com/${i}) and \`code\`, long enough to wrap once or twice in a window.\n\n${prose}\n\n` +
          (i % 5 === 0 ? '```sh\n# not a heading\necho hi\n```\n\n' : '');
        parts.push(chunk);
        n += chunk.length;
        sections++;
      }
      parts.push('Last words\n==========\n\nThe end.');
      const bytes = new TextEncoder().encode(parts.join('\n'));
      await window.marxy.shell.plant('/demo/big.md', bytes);
      await window.marxy.handle.open('/demo/big.md');
      return { sections, bytes: bytes.length };
    }, mb);
    await page.waitForFunction(() => document.title.startsWith('big.md'));
    await fn(page, made);
  } finally {
    await page.close();
  }
  assert.deepEqual(problems, []);
}

/**
 * Presses `g r` once the page has drawn a second of short frames. Playwright sends `r` only after `g` is handled, and a
 * frame of the 6 MB page that lands between them takes seconds: the two keys then fall outside the sequence's window and
 * `r` alone opens Read as.
 */
async function pressGr(page) {
  await page.evaluate(
    () =>
      new Promise((done) => {
        let last = performance.now();
        let calm = 0;
        const tick = (now) => {
          calm = now - last < 100 ? calm + (now - last) : 0;
          last = now;
          if (calm >= 1000) done();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
  );
  await page.keyboard.press('g');
  await page.keyboard.press('r');
}

const parsed = (page) => page.evaluate(() => window.marxy.handle.panes().focused.content.store().parsed());
const leavePage = (page) => page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
const outlineRows = (page, prefix) =>
  page.evaluate((p) => [...document.querySelectorAll(`.marxy-drawer [data-marxy-left-row^="${p}"]`)].map((r) => r.textContent), prefix);

test('a 6 MB Markdown file opens as lines, its Outline from the scan, and a heading clicked lands on its line', async () => {
  await withMarkdown(6, async (page, made) => {
    await page.waitForSelector('.marxy-article .marxy-lines-row');
    assert.equal(await page.textContent('.marxy-article .marxy-lines .marxy-reading-head'), 'Lines');
    const fold = await page.textContent('.marxy-article .marxy-lines .marxy-account-body');
    assert.match(fold, /Past 5 MB Markdown is shown as lines/);
    assert.match(fold, /Show rendered \(g r\)/);
    assert.equal(await page.textContent('.marxy-article .marxy-lines-text'), '# The big book', 'the first line, as the file writes it');
    // The Metadata panel says why it is lines, with the one press that renders it.
    await page.evaluate(() => window.marxy.handle.frame().left.show('metadata'));
    await page.waitForFunction(() => [...document.querySelectorAll('.marxy-drawer button.marxy-linkish')].some((b) => b.textContent === 'Show rendered (g r)'), null, { timeout: 90_000 });
    assert.match(await page.textContent('.marxy-drawer .marxy-l-hero'), /Shown as lines, as the file writes it: it is 6\.\d MB/);
    await page.evaluate(() => window.marxy.handle.frame().left.show('outline'));
    await page.waitForFunction(() => document.querySelectorAll('.marxy-drawer [data-marxy-left-row^="s:"]').length > 0, null, { timeout: 90_000 });
    // The title, every section and the setext heading at the end; no line in a fence. The panel draws the first thousand.
    assert.equal(await page.textContent('.marxy-drawer .marxy-l-top .marxy-l-v'), `${(made.sections + 2).toLocaleString('en-GB')} headings`);
    const rows = await outlineRows(page, 's:');
    assert.equal(rows.length, 1000);
    assert.match(rows[0], /The big book/);
    assert.match(rows[1], /Section 0/);
    assert.equal(await parsed(page), false, 'nothing parsed the whole file');
    // A section far down the file, found by the field: its row goes to its line, on screen.
    const target = Math.floor(made.sections * 0.7);
    await page.fill('[data-marxy-left-field="outline-q"]', `Section ${target}`);
    await page.waitForSelector(`.marxy-drawer [data-marxy-left-row="s:${target + 1}"]`);
    assert.equal((await outlineRows(page, 's:')).length, 1);
    await page.fill('[data-marxy-left-field="outline-q"]', 'Last words');
    await page.waitForFunction(() => /Last words/.test(document.querySelector('.marxy-drawer [data-marxy-left-row^="s:"]')?.textContent ?? ''));
    await page.fill('[data-marxy-left-field="outline-q"]', `Section ${target}`);
    await page.waitForSelector(`.marxy-drawer [data-marxy-left-row="s:${target + 1}"]`);
    await page.click(`.marxy-drawer [data-marxy-left-row="s:${target + 1}"]`);
    await page.waitForFunction(
      (t) =>
        [...document.querySelectorAll('.marxy-article .marxy-lines-row')].some((r) => {
          const box = r.getBoundingClientRect();
          return r.querySelector('.marxy-lines-text')?.textContent === `## Section ${t}` && box.top >= 0 && box.bottom <= innerHeight;
        }),
      target,
    );
    // A click on the page, the cursor's keys and find work on the lines, and none of them parses the file.
    await page.mouse.click(700, 400);
    for (const key of ['j', 'j', 'k']) await page.keyboard.press(key);
    await page.keyboard.press('Control+f');
    await page.keyboard.type('Section 1200');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => [...document.querySelectorAll('.marxy-article .marxy-lines-text')].some((t) => t.textContent === '## Section 1200'));
    assert.equal(await parsed(page), false);
  });
});

test('g r shows it rendered and the Outline becomes the parsed one; g r again comes back to lines', async () => {
  await withMarkdown(6, async (page, made) => {
    await page.waitForSelector('.marxy-article .marxy-lines-row');
    await page.evaluate(() => window.marxy.handle.frame().left.show('outline'));
    await page.waitForFunction(() => document.querySelectorAll('.marxy-drawer [data-marxy-left-row^="s:"]').length > 0, null, { timeout: 90_000 });
    await leavePage(page);
    await pressGr(page);
    // The notice says what it costs, by size, while the page is made.
    await page.waitForFunction(() => [...document.querySelectorAll('.marxy-notice-text')].some((n) => /Rendering 6\.\d MB of Markdown/.test(n.textContent)));
    await page.waitForFunction(() => document.querySelector('.marxy-article h1')?.textContent.includes('The big book'), null, { timeout: 120_000 });
    assert.equal(await page.$('.marxy-article .marxy-lines-row'), null);
    await page.waitForFunction(() => document.querySelectorAll('.marxy-drawer [data-marxy-left-row^="h:"]').length > 0, null, { timeout: 120_000 });
    assert.equal(await page.$('.marxy-drawer [data-marxy-left-row^="s:"]'), null, 'the scanned list is gone');
    assert.equal(await parsed(page), true);
    await page.waitForFunction(() => ![...document.querySelectorAll('.marxy-notice-text')].some((n) => /Rendering/.test(n.textContent)));
    // Read as says the page was asked for.
    const ways = await page.evaluate(async () => (await import('/src/read-as/ladder.ts')).readingsFor('/demo/big.md').map((w) => `${w.id}:${w.current}`));
    assert.ok(ways.includes('rendered:true'), ways.join(' '));
    // `g r` has one owner, offered now; the palette's own way back is Show as lines, and Show rendered is not offered.
    const offered = await page.evaluate(async () => {
      const { buildAppContext } = await import('/src/selection/bind.ts');
      const ctx = buildAppContext(window.marxy.handle);
      const all = window.marxy.handle.commands();
      const keyed = all.filter((c) => c.key === 'g r' && c.when(ctx)).map((c) => c.id);
      const ways = all.filter((c) => /^reading\.show-/.test(c.id) && c.when(ctx)).map((c) => c.id);
      return { keyed, ways };
    });
    assert.deepEqual(offered, { keyed: ['reading.toggle-rendered'], ways: ['reading.show-lines'] });
    await pressGr(page);
    await page.waitForSelector('.marxy-article .marxy-lines-row', { timeout: 180_000 });
    await page.evaluate(() => window.marxy.handle.frame().left.show('outline'));
    await page.waitForFunction(() => document.querySelectorAll('.marxy-drawer [data-marxy-left-row^="s:"]').length > 0, null, { timeout: 90_000 });
    assert.equal(await page.textContent('.marxy-drawer .marxy-l-top .marxy-l-v'), `${(made.sections + 2).toLocaleString('en-GB')} headings`);
  });
});

test('under 5 MB Markdown opens as its page, with the parsed Outline, as before', async () => {
  await withMarkdown(4, async (page) => {
    await page.waitForFunction(() => document.querySelector('.marxy-article h1')?.textContent.includes('The big book'), null, { timeout: 120_000 });
    assert.equal(await page.$('.marxy-article .marxy-lines'), null);
    await page.evaluate(() => window.marxy.handle.frame().left.show('outline'));
    await page.waitForFunction(() => document.querySelectorAll('.marxy-drawer [data-marxy-left-row^="h:"]').length > 0, null, { timeout: 120_000 });
    const offered = await page.evaluate(async () => (await import('/src/read-as/ladder.ts')).readingsFor('/demo/big.md').some((w) => w.id === 'rendered'));
    assert.equal(offered, false, 'no Show rendered under the tier');
  });
});
