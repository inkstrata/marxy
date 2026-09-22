// User theme in the real app harness (docs/design/05-theme.md §App side). MARXY-177.
import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { after, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { build } from 'vite';
import { setTopLevelKey } from '../../../packages/theme/src/config.ts';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip }, fn);

const repoRoot = new URL('../../../', import.meta.url).pathname;
const fixtureMd = readFileSync(join(repoRoot, 'fixtures', 'corpus', '02-readme-real-world.md'));
const quietToml = readFileSync(join(repoRoot, 'fixtures', 'themes', 'quiet', 'theme.toml'));
const quietCss = readFileSync(join(repoRoot, 'fixtures', 'themes', 'quiet', 'theme.css'));
const contractToml = readFileSync(join(repoRoot, 'fixtures', 'themes', 'contract-2', 'theme.toml'));
const contractCss = readFileSync(join(repoRoot, 'fixtures', 'themes', 'contract-2', 'theme.css'));

let harnessPromise;
let closeHarness = () => {};
async function harnessBase() {
  if (!harnessPromise) {
    harnessPromise = (async () => {
      const outDir = mkdtempSync(join(tmpdir(), 'marxy-user-theme-'));
      await build({ root: join(repoRoot, 'apps', 'desktop'), logLevel: 'silent', build: { outDir, emptyOutDir: true } });
      const types = { '.html': 'text/html', '.ttf': 'font/ttf', '.js': 'text/javascript', '.txt': 'text/plain', '.css': 'text/css' };
      const server = createServer((req, res) => {
        const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
        const path = join(outDir, pathname.endsWith('/') ? `${pathname}index.html` : pathname);
        if (!existsSync(path)) { res.statusCode = 404; return res.end(); }
        res.setHeader('Content-Type', types[extname(path)] ?? 'application/octet-stream');
        res.end(readFileSync(path));
      });
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      closeHarness = () => server.close();
      return `http://127.0.0.1:${server.address().port}/`;
    })();
  }
  return harnessPromise;
}
after(() => closeHarness());

function b64(bytes) {
  return Buffer.from(bytes).toString('base64');
}

async function boot(page, files, argv) {
  const base = await harnessBase();
  await page.goto(`${base}app.html`);
  await page.waitForFunction(() => typeof window.marxyApp?.start === 'function');
  await page.evaluate(async ({ files, argv }) => {
    const handle = await window.marxyApp.start(files, argv);
    await handle.ready;
    window.__marxyHandle = handle;
  }, { files, argv });
}

test('config theme applies after first_text with #marxy-theme and keeps scroll position', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 800 } });
    const config = new TextEncoder().encode('theme = "/t/quiet"\n');
    await boot(page, {
      '/config': b64(config),
      '/docs/README.md': b64(fixtureMd),
      '/t/quiet/theme.toml': b64(quietToml),
      '/t/quiet/theme.css': b64(quietCss),
    }, ['/docs/README.md']);

    const result = await page.evaluate(() => {
      const marks = window.__marxyHandle.shell.calls.filter((c) => c.method === 'mark').map((c) => c.args[0]);
      const firstText = marks.indexOf('first_text');
      const userTheme = marks.indexOf('user_theme');
      const style = document.getElementById('marxy-theme');
      const bg = style ? getComputedStyle(document.documentElement).getPropertyValue('--marxy-color-bg').trim() : '';
      return {
        hasThemeStyle: Boolean(style?.textContent),
        quietBg: bg,
        firstBeforeTheme: firstText >= 0 && userTheme > firstText,
        marks,
      };
    });

    assert.equal(result.hasThemeStyle, true);
    assert.equal(result.quietBg, '#121210');
    assert.equal(result.firstBeforeTheme, true, result.marks.join(','));

    await page.evaluate(() => {
      document.documentElement.scrollTop = 400;
    });
    const before = await page.evaluate(() => document.documentElement.scrollTop);
    await page.evaluate(() => {
      window.__marxyHandle.shell.emit([{ kind: 'modified', path: '/t/quiet/theme.css' }]);
    });
    await page.waitForFunction(() => {
      const marks = window.__marxyHandle?.shell?.calls?.filter((c) => c.method === 'mark' && c.args[0] === 'user_theme') ?? [];
      return marks.length >= 2;
    }, { timeout: 2000 });
    const after = await page.evaluate(() => document.documentElement.scrollTop);
    assert.ok(Math.abs(after - before) < 8, `scroll jumped ${before} → ${after}`);
  } finally {
    await browser.close();
  }
});

test('theme.css change re-applies within 200 ms', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 760 } });
    const config = new TextEncoder().encode('theme = "/t/quiet"\n');
    await boot(page, {
      '/config': b64(config),
      '/docs/README.md': b64(fixtureMd),
      '/t/quiet/theme.toml': b64(quietToml),
      '/t/quiet/theme.css': b64(quietCss),
    }, ['/docs/README.md']);

    const updated = Buffer.from(`${quietCss.toString('utf8')}\n:root { --marxy-color-bg: #010101; }\n`);
    const t0 = await page.evaluate((updatedB64) => {
      const bin = atob(updatedB64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      window.__marxyHandle.shell.writeFileAtomic('/t/quiet/theme.css', bytes);
      const start = performance.now();
      window.__marxyHandle.shell.emit([{ kind: 'modified', path: '/t/quiet/theme.css' }]);
      return start;
    }, b64(updated));

    await page.waitForFunction(
      () => getComputedStyle(document.documentElement).getPropertyValue('--marxy-color-bg').trim() === '#010101',
      { timeout: 200 },
    );
    const elapsed = await page.evaluate((start) => performance.now() - start, t0);
    assert.ok(elapsed < 200, `reload took ${elapsed.toFixed(1)} ms`);
  } finally {
    await browser.close();
  }
});

test('opening theme.css lands in Source with Use this theme writing config', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 800 } });
    await boot(page, {
      '/config': b64(new Uint8Array()),
      '/t/quiet/theme.toml': b64(quietToml),
      '/t/quiet/theme.css': b64(quietCss),
    }, ['/t/quiet/theme.css']);

    const beforeOpen = await page.evaluate(() => ({
      mode: document.body.dataset.marxyMode,
      notice: [...document.querySelectorAll('.marxy-notice-text')].map((el) => el.textContent),
      hasUse: [...document.querySelectorAll('.marxy-notice-action')].some((el) => el.textContent === 'Use this theme'),
    }));
    assert.equal(beforeOpen.mode, 'source');
    assert.ok(beforeOpen.notice.some((t) => t?.includes('marxy theme')));
    assert.equal(beforeOpen.hasUse, true);

    await page.click('button.marxy-notice-action');
    const configBytes = await page.evaluate(async () => {
      const bytes = await window.__marxyHandle.shell.readFile('/config');
      return Array.from(bytes);
    });
    const expected = setTopLevelKey(new Uint8Array(), 'theme', '"/t/quiet"');
    assert.deepEqual(configBytes, [...expected]);
  } finally {
    await browser.close();
  }
});

test('contract-2 theme shows a warning notice and still applies', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 760 } });
    await boot(page, {
      '/config': b64(new TextEncoder().encode('theme = "/t/contract-2"\n')),
      '/docs/README.md': b64(fixtureMd),
      '/t/contract-2/theme.toml': b64(contractToml),
      '/t/contract-2/theme.css': b64(contractCss),
    }, ['/docs/README.md']);

    const result = await page.evaluate(() => ({
      hasTheme: Boolean(document.getElementById('marxy-theme')?.textContent),
      notice: [...document.querySelectorAll('.marxy-notice-text')].map((el) => el.textContent ?? '').join(' '),
    }));
    assert.equal(result.hasTheme, true);
    assert.match(result.notice, /contract 2/i);
  } finally {
    await browser.close();
  }
});

nodeTest('docs/taste-review/queue.md mentions user-applied theme (MARXY-177)', () => {
  const queue = readFileSync(join(repoRoot, 'docs', 'taste-review', 'queue.md'), 'utf8');
  assert.match(queue, /MARXY-177/);
});
