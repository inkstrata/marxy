// A mail message and an HTML file open in the sandbox without the engine logging a refused script: the page runs
// nothing, so nothing should try to. WebKit, over the memory shell.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test as nodeTest } from 'node:test';
import { closeHarness } from './support/two-pane.mjs';
import { skip, withFrame } from './support/frame.mjs';

const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);
after(() => closeHarness());

const demo = join(fileURLToPath(new URL('../../../', import.meta.url)), 'fixtures', 'demo');
const MAIL = '/r/mail/low-water-notice.eml';
const PAGE = '/r/site/harbour-notice.html';
const FILES = {
  '/r/README.md': '# Here\n',
  [MAIL]: readFileSync(join(demo, 'mail', 'low-water-notice.eml')),
  [PAGE]: readFileSync(join(demo, 'site', 'harbour-notice.html')),
};

for (const [name, path, viewer] of [['a mail message', MAIL, 'mail'], ['an HTML file', PAGE, 'page']]) {
  test(`${name} opens in the sandbox with no refused script in the console`, async () => {
    await withFrame({ files: FILES, open: ['/r/README.md'] }, async (page) => {
      const logged = [];
      page.on('console', (m) => logged.push(`${m.type()}: ${m.text()}`));
      await page.evaluate((p) => window.__marxyHandle.open(p), path);
      await page.waitForSelector(`[data-marxy-viewer="${viewer}"] iframe.marxy-sandbox`);
      await page.waitForFunction(() => (document.querySelector('iframe.marxy-sandbox')?.contentDocument?.body?.children.length ?? 0) > 0);
      await page.waitForTimeout(500);
      const refused = logged.filter((l) => /blocked script|sandboxed/i.test(l));
      assert.deepEqual(refused, [], `console said: ${logged.join(' | ')}`);
    });
  });
}

test('a page nested thousands deep is drawn flat past 256 levels, quickly, and the line above says so', async () => {
  const n = 20_000;
  const deep = `<!doctype html><title>Deep</title>${'<div>'.repeat(n)}the innermost words${'</div>'.repeat(n)}\n`;
  await withFrame({ files: { '/r/README.md': '# Here\n', '/r/deep.html': deep }, open: ['/r/README.md'] }, async (page) => {
    const t0 = Date.now();
    await page.evaluate((p) => window.__marxyHandle.open(p), '/r/deep.html');
    await page.waitForSelector('[data-marxy-viewer="page"] iframe.marxy-sandbox');
    await page.waitForFunction(() => document.querySelector('iframe.marxy-sandbox')?.contentDocument?.body?.textContent?.includes('the innermost words'), null, { timeout: 60_000 });
    const frameHeight = await page.evaluate(() => document.querySelector('iframe.marxy-sandbox').style.height);
    const took = Date.now() - t0;
    console.log(`deep page drawn in ${took} ms`);
    const depth = await page.evaluate(() => {
      let d = 0;
      for (let e = document.querySelector('iframe.marxy-sandbox').contentDocument.querySelector('body div'); e; e = e.firstElementChild) d++;
      return d;
    });
    assert.ok(frameHeight.endsWith('px'));
    assert.equal(depth, 256);
    assert.match(await page.textContent('.marxy-htmlpage .marxy-account-body p'), /nesting past 256 levels flattened/);
    assert.ok(took < 5000, `took ${took} ms`);
  });
});
