// A large Markdown open's first text does not wait on the panel (the remaining 2 MB stall): past 1 MB the panel
// reads the page after it is painted, and the Links card's links are found then, never by a scan of the whole text for
// paths; the Links panel's rows come once they are. Playwright WebKit, the whole frame.
import { strict as assert } from 'node:assert';
import { after, test as nodeTest } from 'node:test';
import { closeHarness } from './support/two-pane.mjs';
import { showPanel, skip, withFrame } from './support/frame.mjs';

const test = (name, fn) => nodeTest(name, { skip, timeout: 240_000 }, fn);
after(() => closeHarness());

const para = (i) => `Paragraph ${i} reads on past [the harbour notes](https://tides.example/notes/${i}) and the quay, as a page of prose runs, with enough words to wrap twice over in the measure.\n\n`;
let text = '# A long page\n\n';
for (let i = 0; text.length < 1.1 * 1024 * 1024; i++) text += `${i % 40 === 0 ? `## Part ${i / 40}\n\n` : ''}${para(i)}`;
const FILES = { '/r/README.md': '# Here\n', '/r/long.md': text };

test('a 1.1 MB page is painted before the panel reads it, and its links come after in the Links panel, every one counted', async () => {
  await withFrame({ files: FILES, open: ['/r/README.md'] }, async (page) => {
    await showPanel(page, 'links');
    await page.evaluate(() => {
      window.__seen = {};
      const look = () => {
        const now = performance.now();
        if (!window.__seen.text && [...document.querySelectorAll('.marxy-article p')].some((p) => p.textContent.startsWith('Paragraph 0 '))) window.__seen.text = now;
        if (!window.__seen.links && document.querySelector('.marxy-drawer [data-marxy-left-row^="w:"]')) window.__seen.links = now;
      };
      new MutationObserver(look).observe(document.body, { childList: true, subtree: true });
    });
    await page.evaluate(() => window.__marxyHandle.open('/r/long.md'));
    const probe = () => page.evaluate(() => ({ now: Math.round(performance.now()), seen: window.__seen, ps: document.querySelectorAll('.marxy-article p').length, kids: document.getElementById('doc')?.childElementCount, rows: document.querySelectorAll('.marxy-drawer [data-marxy-left-row]').length, body: (document.querySelector('.marxy-drawer .marxy-l-body')?.textContent ?? '').slice(0, 80) })).then((v) => console.log('PROBE', JSON.stringify(v))).catch(() => {});
    const timer = setInterval(probe, 10_000);
    try {
      await page.waitForFunction(() => window.__seen.text && window.__seen.links, null, { timeout: 200_000 });
    } finally {
      clearInterval(timer);
    }
    const seen = await page.evaluate(() => window.__seen);
    console.log('SEEN', JSON.stringify(seen));
    assert.ok(seen.links > seen.text, `the Links card came at ${Math.round(seen.links)} ms, the first text at ${Math.round(seen.text)} ms`);
    const count = Number((await page.textContent('.marxy-drawer .marxy-l-fld .marxy-l-v')).replace(/ in all$/, '').replace(/,/g, ''));
    assert.equal(count, (text.match(/\]\(https:/g) ?? []).length);
  });
});
