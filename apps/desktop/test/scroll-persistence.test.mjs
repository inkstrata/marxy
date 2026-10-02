// Scrolling in Rendered records the reading position without a flush (A-13 step 6): WebKit fires the
// viewport scroll at the Document, so the listener has to be there.
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { createServer } from 'vite';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip }, fn);

const repoRoot = new URL('../../../', import.meta.url).pathname;
const longMd = readFileSync(join(repoRoot, 'fixtures', 'corpus', '01-long-technical.md'));
let serverPromise;
let closeServer = () => {};
after(() => closeServer());

async function base() {
  serverPromise ??= (async () => {
    const root = join(repoRoot, 'apps', 'desktop');
    const server = await createServer({
      root,
      configFile: join(root, 'vite.config.ts'),
      logLevel: 'silent',
      server: { port: 0, strictPort: false, host: '127.0.0.1' },
    });
    await server.listen();
    closeServer = () => server.close();
    return `http://127.0.0.1:${server.config.server.port}/`;
  })();
  return serverPromise;
}

async function boot(page) {
  await page.addInitScript(() => { globalThis.process = { env: {} }; });
  await page.goto(`${await base()}test/palette-boot.html`);
  await page.waitForFunction(() => typeof window.marxyPaletteBoot?.start === 'function', undefined, { timeout: 15_000 });
  await page.evaluate(async ({ b64 }) => {
    const { handle } = await window.marxyPaletteBoot.start({ '/r/long.md': b64 }, ['/r/long.md']);
    window.__h = handle;
  }, { b64: longMd.toString('base64') });
}

const stored = (page) =>
  page.evaluate(async () => {
    try {
      return new TextDecoder().decode(await window.__h.shell.readFile('/data/positions.json'));
    } catch {
      return null;
    }
  });

test('scrolling records the position and writes it after the debounce, with no quit or document switch', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 800 } });
    await boot(page);
    await page.evaluate(() => window.scrollTo(0, 4000));
    await page.waitForTimeout(1200);
    const offset = await page.evaluate(() => window.__h.sourceHarness().byteOffset);
    assert.ok(offset > 0);
    const text = await stored(page);
    assert.ok(text?.includes(`"byteOffset":${offset}`) || text?.match(new RegExp(`"byteOffset":\\s*${offset}\\b`)), `positions.json: ${text?.slice(0, 300)}`);
  } finally {
    await browser.close();
  }
});

test('pagehide flushes the pending position at once', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 800 } });
    await boot(page);
    await page.evaluate(() => window.scrollTo(0, 5000));
    await page.waitForTimeout(100);
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    await page.waitForTimeout(100);
    const offset = await page.evaluate(() => window.__h.sourceHarness().byteOffset);
    const text = await stored(page);
    assert.ok(offset > 0 && text?.match(new RegExp(`"byteOffset":\\s*${offset}\\b`)), `positions.json: ${text?.slice(0, 300)}`);
  } finally {
    await browser.close();
  }
});
