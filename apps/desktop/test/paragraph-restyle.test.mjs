// A long run of paragraphs restyles in bounded time (F-96.1, WebKit). A document of 27,000 short paragraphs with one
// mermaid fence at its end is opened in Rendered, then the whole page is restyled by changing its colour variant (the
// `:root[data-marxy-variant]` tokens every paragraph inherits), and the next frame is awaited. With the old
// `p:has(+ pre.language-mermaid)` rule in base.css WebKit took 13 to 15 s here, growing with the square of the run
// (F-96); with the caption marked by class it takes about 50 ms. The bound of 2,000 ms is 40 times the measured 50 ms:
// a slow runner has room in it, a quadratic regression does not.
import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { after, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { bootTwoPanes, closeHarness } from './support/two-pane.mjs';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip, timeout: 240_000 }, fn);
after(() => closeHarness());

/** The longest a full restyle of the page may take, from the change to the next frame, in milliseconds. */
const RESTYLE_MS = 2_000;
const PARAGRAPHS = 27_000;

test('F-96.1 a 27,000-paragraph page with a diagram fence restyles in bounded time in Rendered', async () => {
  const lines = [];
  for (let i = 0; i < PARAGRAPHS; i++) lines.push(`Paragraph ${i}, a short line of ordinary prose.`);
  const md = `# Long run\n\n${lines.join('\n\n')}\n\n\`\`\`mermaid\nflowchart LR\n  A --> B\n\`\`\`\n`;
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
    await bootTwoPanes(page, { files: { '/r/long.md': md }, open: ['/r/long.md'] });
    // A document this long is appended in idle chunks, which take minutes on a loaded runner. The test is about the
    // restyle, not the chunks, so the rest of the article goes in now, in one step, and the test waits for it to settle.
    await page.evaluate(async (byte) => {
      window.__marxyHandle.mountThrough(byte);
      await window.__marxyHandle.contentComplete();
    }, Buffer.byteLength(md));
    await page.waitForFunction(
      (n) => document.querySelectorAll('#doc p').length >= n && document.querySelector('pre.language-mermaid') !== null,
      PARAGRAPHS,
      { timeout: 60_000 },
    );
    const runs = await page.evaluate(async () => {
      const root = document.documentElement;
      const sample = document.querySelector('#doc p');
      const out = [];
      for (let k = 0; k < 3; k++) {
        const before = getComputedStyle(sample).color;
        const next = root.getAttribute('data-marxy-variant') === 'dark' ? 'light' : 'dark';
        const t0 = performance.now();
        root.setAttribute('data-marxy-variant', next);
        // Reading a layout box forces the style and layout of the whole page now, as the restyle does.
        document.getElementById('doc').getBoundingClientRect();
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        out.push({ ms: performance.now() - t0, changed: getComputedStyle(sample).color !== before });
      }
      return out;
    });
    const worst = Math.max(...runs.map((r) => r.ms));
    console.log(`F-96.1 restyle of ${PARAGRAPHS} paragraphs, three runs: ${runs.map((r) => Math.round(r.ms)).join(', ')} ms`);
    assert.ok(runs.every((r) => r.changed), 'the colour variant change restyled the paragraphs (their colour changed)');
    assert.ok(worst < RESTYLE_MS, `a full restyle took ${Math.round(worst)} ms; the bound is ${RESTYLE_MS} ms`);
  } finally {
    await browser.close();
  }
});
