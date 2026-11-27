// A grant that lands while a large document is read in slices beside another pane reaches that pane's page. WebKit.
import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { after, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { generateLarge } from '../../../scripts/perf-harness.mjs';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { bootTwoPanes, closeHarness } from './support/two-pane.mjs';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip, timeout: 240_000 }, fn);
after(() => closeHarness());

async function withPage(fn, viewport = { width: 1470, height: 900 }) {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport });
    await fn(page);
  } finally {
    await browser.close();
  }
}

const toText = (bytes) => Buffer.from(bytes).toString('utf8');

test('a grant made while the second pane reads a large page in slices leaves that pane showing the page under the grant', async () => {
  const raw = '<details><summary>Raw more</summary>raw html in the big page</details>\n\n';
  const big = `# Big\n\n${raw}${toText(generateLarge(600 * 1024))}`;
  await withPage(async (page) => {
    await bootTwoPanes(page, { files: { '/r/big.md': big }, open: ['/r/big.md'] });
    const offer = '[data-marxy-pane="0"] button.marxy-notice-action';
    await page.waitForFunction((sel) => [...document.querySelectorAll(sel)].some((el) => /HTML/.test(el.textContent ?? '')), offer);
    const midRead = await page.evaluate(async (sel) => {
      const panes = window.__marxyHandle.panes();
      // Slices hand the loop back through a message port (startup/yield.ts): the test holds those messages, so the second
      // pane stops at its first slice with its page still empty, however fast or slow the parse runs. Only once its view
      // holds the store: the open path yields through the same port before the render starts, and a grant landing there
      // is read by the render as the policy it starts with, which is not the case under test.
      const proto = MessagePort.prototype;
      const post = proto.postMessage;
      const held = [];
      let gate = true;
      const rendering = () => panes.panes[1]?.view.store() != null;
      proto.postMessage = function (...args) {
        if (!gate || !rendering()) return post.apply(this, args);
        held.push(() => post.apply(this, args));
        return undefined;
      };
      const until = async (done, what) => {
        for (let i = 0; i < 2500 && !done(); i++) await new Promise((resolve) => setTimeout(resolve, 2));
        if (!done()) throw new Error(what);
      };
      let empty = false;
      try {
        const opening = panes.openIn('other', '/r/big.md');
        await until(() => held.length > 0, 'the second pane never gave the loop back while rendering');
        empty = panes.panes[1].article.childElementCount === 0;
        [...document.querySelectorAll(sel)].find((el) => /HTML/.test(el.textContent ?? '')).click();
        // The grant is written before it re-renders the first pane: its page showing the HTML means the policy has moved,
        // while the second pane is still held at its first slice.
        await until(() => document.querySelector('#doc details'), 'the grant never reached the first pane');
        gate = false;
        for (const release of held.splice(0)) release();
        await opening;
      } finally {
        gate = false;
        proto.postMessage = post;
        for (const release of held.splice(0)) release();
      }
      return empty;
    }, offer);
    assert.equal(midRead, true, 'the grant came while the second pane was still reading');
    // The grant re-renders the pane it landed on mid-read, so how many times a page completes is not fixed: wait for what the reader sees.
    await page.waitForFunction(() => document.querySelector('#doc details') && document.querySelector('#doc-2 details'), null, { timeout: 120_000 });
    const shown = await page.evaluate(() => ({ left: document.querySelectorAll('#doc details').length, right: document.querySelectorAll('#doc-2 details').length }));
    assert.deepEqual(shown, { left: 1, right: 1 }, 'both panes show the granted HTML, none keeps the page as it was before the grant');
  });
});
