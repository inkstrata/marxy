// K-07.1, the wiring: a malformed [[kind]] or [strip] in config.toml reaches the reader as a refusal through the real
// launch (theme/app-config.ts) and through the strip's own re-read (workspace/kind-chip.ts), not only through the reporter.
// The real app over the memory shell, in WebKit (test/support/two-pane.mjs).
import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { after, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { launchWebkit } from '../../../../scripts/playwright-webkit.mjs';
import { bootTwoPanes, closeHarness } from '../../test/support/two-pane.mjs';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);
after(() => closeHarness());

const prose = '# Title\n\nA paragraph of plain prose, long enough to be a document and no more than that.\n';
const files = { '/r/a.md': prose, '/r/b.md': prose };

async function withPage(config, fn) {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await bootTwoPanes(page, { files: { ...files, '/config': config }, open: ['/r/a.md'] });
    await fn(page);
  } finally {
    await browser.close();
  }
}

const refusals = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('.marxy-notice[data-notice-kind="refused"]')]
      .map((n) => n.textContent.trim())
      .filter((t) => /config\.toml/.test(t) && /\[\[kind\]\]|\[strip\]/.test(t)),
  );

test('launch: a malformed [[kind]] rule is shown as a refusal that names the rule and the file', async () => {
  await withPage('[[kind]]\nglob = "**/*.md"\nis = "report"\n\n[[kind]]\nis = "report"\n', async (page) => {
    await page.waitForFunction(() => document.querySelector('.marxy-notice[data-notice-kind="refused"]') !== null);
    const shown = await refusals(page);
    assert.equal(shown.length, 1, shown.join(' | '));
    assert.match(shown[0], /\[\[kind\]\] rule 2/);
  });
});

test('launch: a malformed [strip] entry is shown as a refusal that names the entry', async () => {
  await withPage('[strip]\nreport = ["outline", "nope"]\n', async (page) => {
    await page.waitForFunction(() => document.querySelector('.marxy-notice[data-notice-kind="refused"]') !== null);
    const shown = await refusals(page);
    assert.equal(shown.length, 1, shown.join(' | '));
    assert.match(shown[0], /\[strip\] report/);
  });
});

test('strip re-read: a [strip] that goes wrong after launch is shown when the strip next reads config.toml', async () => {
  await withPage('size = 20\n', async (page) => {
    assert.deepEqual(await refusals(page), []);
    await page.evaluate(async () => {
      const h = window.__marxyHandle;
      h.workspace().unfold();
      await h.shell.writeFileAtomic('/config', new TextEncoder().encode('[strip]\nreport = ["outline", "nope"]\n'));
      await h.open('/r/b.md');
    });
    await page.waitForFunction(() => document.querySelector('.marxy-notice[data-notice-kind="refused"]') !== null);
    const shown = await refusals(page);
    assert.equal(shown.length, 1, shown.join(' | '));
    assert.match(shown[0], /\[strip\] report/);
  });
});
