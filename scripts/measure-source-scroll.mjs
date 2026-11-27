// Scrolling a large file in Source, measured in WebKit: the longest frame and the number of frames over 100 ms while the
// view is stepped down a generated file of long lines. Not a gate: the numbers are printed.
// `node scripts/measure-source-scroll.mjs [--mb 9] [--steps 80]`
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { webkit } from 'playwright';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? fallback : process.argv[i + 1];
};
const mb = Number(arg('mb', '9'));
const steps = Number(arg('steps', '80'));

const desktopRoot = fileURLToPath(new URL('../apps/desktop/', import.meta.url));
// Vite is the desktop package's dependency, so it is resolved from there.
const { build } = await import(pathToFileURL(createRequire(join(desktopRoot, 'package.json')).resolve('vite')).href);

const outDir = mkdtempSync(join(tmpdir(), 'marxy-source-scroll-'));
let server;
let browser;
try {
  await build({
    root: desktopRoot,
    logLevel: 'error',
    build: { outDir, emptyOutDir: true, rollupOptions: { input: { harness: join(desktopRoot, 'src/source/harness-shell.html') } } },
  });
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
  server = createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const path = join(outDir, pathname.replace(/^\//, '') || 'src/source/harness-shell.html');
    if (!existsSync(path)) {
      res.statusCode = 404;
      return res.end('missing');
    }
    res.setHeader('Content-Type', types[extname(path)] ?? 'application/javascript');
    res.end(readFileSync(path));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  const line = `${'x'.repeat(180)}\n`;
  const target = mb * 1024 * 1024;
  let body = '';
  while (Buffer.byteLength(body, 'utf8') < target) body += line;
  const bytesB64 = Buffer.from(body, 'utf8').toString('base64');

  browser = await webkit.launch();
  const page = await browser.newPage({ viewport: { width: 960, height: 800 } });
  await page.goto(`http://127.0.0.1:${server.address().port}/src/source/harness-shell.html`);
  await page.waitForFunction(() => typeof window.marxySourceHarness?.scrollPerf === 'function');
  const stats = await page.evaluate(({ bytesB64, steps }) => window.marxySourceHarness.scrollPerf(bytesB64, '/big.txt', steps), { bytesB64, steps });
  if (!(Number.isFinite(stats.max) && stats.max > 0)) throw new Error(`the scroll was not measured (${stats.max})`);
  console.log(`${mb} MB in Source, ${stats.lines} lines, ${steps} steps: longest frame ${stats.max.toFixed(1)} ms; frames over 100 ms: ${stats.over100}`);
} catch (e) {
  console.error(`measure-source-scroll: ${e.message}`);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server?.close();
  rmSync(outDir, { recursive: true, force: true });
}
