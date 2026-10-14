// Opening a 2 MB Markdown file in Source keeps the page live (F-94, WebKit): once the first line is up, the main thread is
// never held for long, so typing, scrolling and the palette answer while the rest of the file's work goes on. The file is
// the shape of V-04's, 2 MB of prose, made in Rendered first and then sent to Source with the command, as a reader does.
//
// What held the page for 4 s and then for 7 s was the Rendered page behind Source, not Source: the article stayed in the
// page (hidden) with the typesetter, the grid passes and the mount going on over it, and a hidden element keeps no computed
// style, so every paragraph they read was styled from nothing; and the editor's style sheet restyled every paragraph of the
// article still showing. WebKit styles a long run of sibling paragraphs in time that grows with the square of their number
// (base.css's `p:has(+ pre.language-…)`), so 27 thousand of them is seconds in one task. The margin: the fix leaves a worst
// hold under 100 ms on the machine this was written on and the fault held it for 4,000 to 12,000, so the bound of 500 ms is
// a slow runner's allowance and not room for a regression.
import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { after, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { bootTwoPanes, closeHarness } from './support/two-pane.mjs';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip, timeout: 180_000 }, fn);
after(() => closeHarness());

/** The longest the main thread may be held at once after the first line, in milliseconds. */
const HELD_MS = 500;

test('F-94 a 2 MB Markdown file opened in Source never holds the page for long once its first line is up', async () => {
  const para = 'A paragraph of ordinary prose that fills a line of the file with words.\n\n';
  const big = `# Big\n\n${para.repeat(Math.ceil(2_000_000 / para.length))}\n#### Skips\n\n\`\`\`\nnever closed\n`;
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
    await bootTwoPanes(page, { files: { '/r/big.md': big }, open: ['/r/big.md'], guard: true });
    await page.waitForFunction(() => window.__marxyHandle !== undefined);
    // The page is still being made in Rendered when Source is asked for: that is when the fault was worst.
    await page.waitForTimeout(300);
    const seen = await page.evaluate(async () => {
      const t0 = performance.now();
      const out = { text: null, longest: 0, at: 0, last: 0 };
      let beat = performance.now();
      const timer = setInterval(() => {
        const now = performance.now();
        const held = now - beat - 10;
        if (out.text !== null && held > out.longest) {
          out.longest = held;
          out.at = beat - t0;
        }
        beat = now;
      }, 10);
      const look = () => {
        if (out.text === null && document.querySelector('#marxy-source .cm-line')) out.text = performance.now() - t0;
      };
      new MutationObserver(look).observe(document.body, { subtree: true, childList: true });
      const { commands } = await import('/src/commands/index.ts');
      const { buildAppContext } = await import('/src/selection/bind.ts');
      await commands().find((c) => c.id === 'view.mode-source').run(buildAppContext(window.__marxyHandle));
      // Long enough to cover where the fault held the page: its first hold began with the first line and its second ran to 12 s.
      await new Promise((r) => setTimeout(r, 14_000));
      look();
      clearInterval(timer);
      out.last = performance.now() - t0;
      return out;
    });
    console.log(`F-94 2 MB file in Source: first line ${Math.round(seen.text)} ms, the page was held at most ${Math.round(seen.longest)} ms at a time after it (at ${Math.round(seen.at)} ms)`);
    assert.ok(seen.text !== null, 'Source shows its first line');
    assert.ok(seen.longest < HELD_MS, `the page was held ${Math.round(seen.longest)} ms at ${Math.round(seen.at)} ms, after the first line at ${Math.round(seen.text)} ms`);
    // Typing is live: a character typed now is in the text at once.
    const typed = await page.evaluate(async () => {
      const { activeSourceEditor } = await import('/src/source/editor.ts');
      const { view } = activeSourceEditor();
      const t0 = performance.now();
      view.dispatch({ changes: { from: 0, insert: 'x' } });
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return { ms: performance.now() - t0, first: view.state.doc.line(1).text.slice(0, 1) };
    });
    assert.equal(typed.first, 'x');
    assert.ok(typed.ms < HELD_MS, `a typed character took ${Math.round(typed.ms)} ms to show`);
  } finally {
    await browser.close();
  }
});
