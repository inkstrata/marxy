// A file with one unbroken run of 400 000 characters (a mail line, an RTF run, a Markdown paragraph) opens and
// answers a key: with kerning on, the engine laid such a run out in seconds and held the window for the whole time.
// Each open is raced against a timer, so a freeze fails the test instead of hanging it. The memory shell, in WebKit (the app's engine) and in Chromium (where the cost was largest).
import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { after, test as nodeTest } from 'node:test';
import { closeHarness } from './support/two-pane.mjs';
import { skip, withFrame } from './support/frame.mjs';

const engines = [
  ['WebKit', undefined, skip],
  ['Chromium', () => chromium.launch({ headless: true }), existsSync(chromium.executablePath()) || process.env.MARXY_BROWSER_TESTS_REQUIRED === '1' ? false : 'Playwright Chromium is not installed here'],
];
after(() => closeHarness());

const RUN = 'x'.repeat(400_000);
const OPEN_MS = 8000;
const KEY_MS = 3000;
const FILES = {
  '/r/README.md': '# Here\n',
  '/r/long.eml': `From: a@example.test\r\nSubject: One long line\r\nContent-Type: text/plain\r\n\r\n${RUN}\r\n`,
  '/r/long.rtf': `{\\rtf1\\ansi ${RUN}\\par}`,
  '/r/long.md': `# Long\n\n${RUN}\n`,
};

/** Rejects when `work` has not finished in `ms`: a frozen page never answers, so the test must not wait for it. */
const within = (ms, what, work) =>
  Promise.race([work, new Promise((_, no) => setTimeout(() => no(new Error(`${what}: no answer in ${ms} ms`)), ms))]);

for (const [engine, launch, why] of engines) for (const [path, shown] of [['/r/long.eml', '.marxy-mail-line'], ['/r/long.rtf', '.marxy-article p'], ['/r/long.md', '#doc p']]) {
  nodeTest(`${engine}: ${path.slice(3)} with a 400 000 character run opens and answers a key`, { skip: why, timeout: 120_000 }, async () => {
    await withFrame({ files: FILES, open: ['/r/README.md'], launch }, async (page) => {
      const t0 = Date.now();
      await within(OPEN_MS, 'open', page.evaluate((p) => window.__marxyHandle.open(p), path));
      await within(OPEN_MS, 'first text', page.waitForFunction(([sel, n]) => [...document.querySelectorAll(sel)].some((e) => e.textContent.length >= n), [shown, RUN.length], { timeout: OPEN_MS }));
      const text = await within(OPEN_MS, 'text', page.$$eval(shown, (es) => Math.max(...es.map((e) => e.textContent.length))));
      assert.equal(text, RUN.length, 'every character is there');
      const opened = Date.now() - t0;
      const k0 = Date.now();
      await within(KEY_MS, 'key', (async () => {
        await page.keyboard.press('PageDown');
        await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
      })());
      assert.ok(opened < OPEN_MS && Date.now() - k0 < KEY_MS, `opened in ${opened} ms, key in ${Date.now() - k0} ms`);
    });
  });
}
