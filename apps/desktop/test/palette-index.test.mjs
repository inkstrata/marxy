// Palette index from idle loadIndex + memory readDir (MARXY-196): heading search and open at byte offset.
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { after, before, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { build } from 'vite';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { LOAD_INDEX_EMPTY_MUTATION } from '../src/startup/idle-work.ts';
import { createMemoryShell } from '../src/shell/memory.ts';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip }, fn);

const desktopRoot = new URL('..', import.meta.url).pathname;
const outDir = mkdtempSync(join(tmpdir(), 'marxy-palette-index-'));
let server;
let base;

const filler = `${'word '.repeat(40)}\n\n`;
// Landing puts the heading on the reading line, 40% down the viewport, which needs the page to
// scroll: text above the heading so it starts below that line, and text after it so there is room
// to scroll it up. With one paragraph above, the heading sat above the line at scroll 0 and the
// offset read back was the next paragraph's, a fact about the theme's top padding (MARXY-272).
const aboveHeading = filler.repeat(8);
const guideBody = `# Guide\n\n${aboveHeading}## Installing\n\n${filler.repeat(8)}Done\n`;
const installingOffset = Buffer.byteLength(`# Guide\n\n${aboveHeading}`, 'utf8');

const repoFiles = () => ({
  '/repo/.git/HEAD': Buffer.from('ref: refs/heads/main\n'),
  '/repo/README.md': Buffer.from('# Home\n'),
  '/repo/docs/guide.md': Buffer.from(guideBody),
  '/repo/node_modules/x/README.md': Buffer.from('# Secret\n\n## Installing\n'),
});

const toB64 = (files) =>
  Object.fromEntries([...Object.entries(files)].map(([path, bytes]) => [path, bytes.toString('base64')]));

before(async () => {
  if (skip) return;
  await build({
    root: desktopRoot,
    logLevel: 'silent',
    build: {
      outDir,
      emptyOutDir: true,
      rollupOptions: { input: { paletteBoot: join(desktopRoot, 'test/palette-boot.html') } },
    },
  });
  const types = { '.html': 'text/html', '.ttf': 'font/ttf', '.js': 'text/javascript', '.txt': 'text/plain', '.css': 'text/css' };
  server = createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const path = join(outDir, pathname.endsWith('/') ? `${pathname}index.html` : pathname);
    if (!existsSync(path)) { res.statusCode = 404; return res.end(); }
    res.setHeader('Content-Type', types[extname(path)] ?? 'application/octet-stream');
    res.end(readFileSync(path));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}/`;
});
after(() => server?.close());

nodeTest('loadIndex walks the memory repo and finds two markdown entries', async () => {
  const files = repoFiles();
  const shell = createMemoryShell(files);
  const { loadIndex } = await import('../src/startup/idle-work.ts');
  const { entries } = await loadIndex(shell, '/repo/README.md');
  assert.equal(entries.length, 2);
  const guide = entries.find((e) => e.path === '/repo/docs/guide.md');
  assert.ok(guide?.headings.some((h) => h.text === 'Installing'));
});

nodeTest(`mutation ${LOAD_INDEX_EMPTY_MUTATION}: loadIndex returns no entries`, async () => {
  const prev = process.env.MARXY_196_MUTATION;
  process.env.MARXY_196_MUTATION = LOAD_INDEX_EMPTY_MUTATION;
  try {
    const shell = createMemoryShell(repoFiles());
    const { loadIndex } = await import('../src/startup/idle-work.ts');
    const { entries } = await loadIndex(shell, '/repo/README.md');
    assert.equal(entries.length, 0);
  } finally {
    if (prev === undefined) delete process.env.MARXY_196_MUTATION;
    else process.env.MARXY_196_MUTATION = prev;
  }
});

nodeTest(`mutation ${LOAD_INDEX_EMPTY_MUTATION} makes the two-entry loadIndex assertion fail`, () => {
  const probe = `
    import assert from 'node:assert/strict';
    import { loadIndex, LOAD_INDEX_EMPTY_MUTATION } from './src/startup/idle-work.ts';
    import { createMemoryShell } from './src/shell/memory.ts';
    process.env.MARXY_196_MUTATION = LOAD_INDEX_EMPTY_MUTATION;
    const shell = createMemoryShell({
      '/repo/.git/HEAD': new TextEncoder().encode('ref: main\\n'),
      '/repo/README.md': new TextEncoder().encode('# Home\\n'),
      '/repo/docs/guide.md': new TextEncoder().encode('# Guide\\n\\n## Installing\\n'),
    });
    const { entries } = await loadIndex(shell, '/repo/README.md');
    assert.equal(entries.length, 2);
  `;
  const result = spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', probe], {
    cwd: desktopRoot,
    encoding: 'utf8',
    env: process.env,
  });
  assert.notEqual(result.status, 0, 'empty-index mutation must fail the entry-count assertion');
});

test('typing Installing finds guide.md, not node_modules; Enter opens at the heading byte offset', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 800 } });
    await page.goto(`${base}test/palette-boot.html`);
    await page.waitForFunction(() => typeof window.marxyPaletteBoot?.start === 'function');
    const marks = await page.evaluate(async ({ files }) => {
      const { handle, marks } = await window.marxyPaletteBoot.start(files, ['/repo/README.md']);
      window.__h = handle;
      return marks;
    }, { files: toB64(repoFiles()) });

    const firstText = marks.find((m) => m.args[0] === 'first_text');
    const indexLoaded = marks.find((m) => m.args[0] === 'index_loaded');
    assert.ok(firstText && indexLoaded, 'expected first_text and index_loaded marks');
    assert.ok(firstText.args[1] < indexLoaded.args[1], 'first_text must precede index_loaded');
    assert.match(String(indexLoaded.args[2] ?? ''), /entries=2/);

    const mod = (await page.evaluate(() => navigator.platform)) === 'MacIntel' ? 'Meta' : 'Control';
    await page.keyboard.press(`${mod}+KeyP`);
    await page.fill('#marxy-palette .marxy-palette-query', 'Installing');
    await page.keyboard.press('Tab');
    const rows = await page.$$eval('#marxy-palette .marxy-palette-row', (els) =>
      els.map((el) => el.textContent ?? ''),
    );
    assert.ok(rows.some((text) => text.includes('Installing')));
    assert.ok(!rows.some((text) => text.includes('node_modules')));

    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.title.includes('guide.md'));
    await page.waitForTimeout(600);
    const harness = await page.evaluate(() => window.__h.sourceHarness());
    assert.equal(harness?.byteOffset, installingOffset);
  } finally {
    await browser.close();
  }
});
