// Built renderer under the release CSP (configured policy + style nonce): palette, KaTeX, hyphen, theme (MARXY-250).
import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { after, before, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { build } from 'vite';
import {
  injectStyleNonces,
  loadConfiguredCsp,
  loadRuntimeStyleSources,
  main as checkCspMain,
  releaseStyleCsp,
  runtimeStyleProblems,
} from '../../../scripts/check-csp.mjs';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip }, fn);

const repoRoot = new URL('../../../', import.meta.url).pathname;
const desktopRoot = join(repoRoot, 'apps', 'desktop');
const mathMd = readFileSync(join(repoRoot, 'fixtures', 'corpus', '06-math.md'));
const longTechnical = readFileSync(join(repoRoot, 'fixtures', 'corpus', '01-long-technical.md'));
const quietToml = readFileSync(join(repoRoot, 'fixtures', 'themes', 'quiet', 'theme.toml'));
const quietCss = readFileSync(join(repoRoot, 'fixtures', 'themes', 'quiet', 'theme.css'));

const outDir = mkdtempSync(join(tmpdir(), 'marxy-release-csp-'));
const NONCE = 'marxy250test';
let server;
let base;

before(async () => {
  if (skip) return;
  await build({
    root: desktopRoot,
    logLevel: 'silent',
    build: {
      outDir,
      emptyOutDir: true,
      rollupOptions: {
        input: {
          app: join(desktopRoot, 'app.html'),
          paletteBoot: join(desktopRoot, 'test/palette-boot.html'),
        },
      },
    },
  });
  const baseCsp = loadConfiguredCsp();
  const csp = releaseStyleCsp(baseCsp, NONCE);
  const types = { '.html': 'text/html', '.ttf': 'font/ttf', '.js': 'text/javascript', '.txt': 'text/plain', '.css': 'text/css' };
  server = createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const path = join(outDir, pathname.endsWith('/') ? `${pathname}index.html` : pathname);
    if (!existsSync(path)) { res.statusCode = 404; return res.end(); }
    const ext = extname(path);
    res.setHeader('Content-Type', types[ext] ?? 'application/octet-stream');
    if (ext === '.html') {
      res.setHeader('Content-Security-Policy', csp);
      res.end(injectStyleNonces(readFileSync(path, 'utf8'), NONCE));
      return;
    }
    res.end(readFileSync(path));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}/`;
});
after(() => server?.close());

function b64(bytes) {
  return Buffer.from(bytes).toString('base64');
}

function modChord(platform) {
  return platform.toUpperCase().includes('MAC') ? 'Meta' : 'Control';
}

function cspViolation(text) {
  return /Refused to apply|Refused to load|Content Security Policy/i.test(text)
    && !/data:font\//i.test(text);
}

test('check-csp selftest and runtime paths refuse <style> creation', () => {
  checkCspMain(['--selftest']);
  assert.deepEqual(runtimeStyleProblems(loadRuntimeStyleSources()), []);
});

test('palette, KaTeX, hyphenation and user theme stay styled with zero CSP violations', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 900 } });
    const violations = [];
    page.on('console', (msg) => {
      const text = msg.text();
      if (cspViolation(text)) violations.push(text);
    });

    await page.goto(`${base}app.html`);
    await page.waitForFunction(() => typeof window.marxyApp?.start === 'function');
    const config = new TextEncoder().encode('theme = "/t/quiet"\n');
    await page.evaluate(async ({ files, argv }) => {
      const handle = await window.marxyApp.start(files, argv);
      await handle.ready;
      window.__marxyHandle = handle;
    }, {
      files: {
        '/config': b64(config),
        '/docs/06-math.md': b64(mathMd),
        '/doc/01-long-technical.md': b64(longTechnical),
        '/t/quiet/theme.toml': b64(quietToml),
        '/t/quiet/theme.css': b64(quietCss),
      },
      argv: ['/docs/06-math.md'],
    });

    const docState = await page.evaluate(() => {
      const katex = document.querySelector('#doc .katex');
      const themeBg = getComputedStyle(document.documentElement).getPropertyValue('--marxy-color-bg').trim();
      return {
        themeBg,
        hasKatex: Boolean(katex?.querySelector('.katex-html')),
        katexHeight: katex?.getBoundingClientRect().height ?? 0,
      };
    });
    assert.equal(docState.themeBg, '#121210', `user theme token missing: ${docState.themeBg}`);
    assert.equal(docState.hasKatex, true, 'KaTeX did not render');
    assert.ok(docState.katexHeight > 0, `KaTeX layout collapsed: height ${docState.katexHeight}`);

    await page.evaluate(async () => {
      await window.__marxyHandle.open('/doc/01-long-technical.md');
    });
    await page.waitForFunction(() => document.querySelectorAll('.marxy-lb.marxy-hyphen').length > 0);
    const hyphen = await page.evaluate(() => {
      const mark = document.querySelector('.marxy-lb.marxy-hyphen');
      return {
        before: mark ? getComputedStyle(mark, '::before').content : '',
        painted: mark ? [...mark.getClientRects()].some((r) => r.width > 0) : false,
      };
    });
    assert.match(hyphen.before, /-/);
    assert.equal(hyphen.painted, true, 'generated hyphen must be visible under release CSP');

    await page.goto(`${base}test/palette-boot.html`);
    await page.waitForFunction(() => typeof window.marxyPaletteBoot?.start === 'function');
    await page.evaluate(async ({ doc }) => {
      await window.marxyPaletteBoot.start({ '/docs/readme.md': doc }, ['/docs/readme.md'], []);
    }, { doc: b64(new TextEncoder().encode('# Doc\n\nBody.\n')) });
    const mod = modChord(await page.evaluate(() => navigator.platform));
    await page.click('body');
    await page.keyboard.press(`${mod}+KeyP`);
    await page.waitForFunction(() => document.querySelector('#marxy-palette')?.open === true);

    const palette = await page.evaluate(() => {
      const el = document.getElementById('marxy-palette');
      return {
        bg: el ? getComputedStyle(el).backgroundColor : '',
        sheet: document.getElementById('marxy-palette-style')?.textContent ?? '',
      };
    });
    assert.notEqual(palette.bg, 'rgba(0, 0, 0, 0)', `palette background missing: ${palette.bg}`);
    assert.match(palette.sheet, /#marxy-palette/, 'palette adopted sheet marker missing');

    assert.deepEqual(violations, [], violations.join('\n'));
  } finally {
    await browser.close();
  }
});
