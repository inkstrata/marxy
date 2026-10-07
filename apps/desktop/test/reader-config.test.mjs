// A-14: the light variant and text size from config.toml, applied before first text, and changed by
// command with every other byte of the file kept.
import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { build } from 'vite';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { settle } from './settle.mjs';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip }, fn);

const desktopRoot = fileURLToPath(new URL('..', import.meta.url));
const fixture = readFileSync(join(desktopRoot, '../../fixtures/corpus/01-long-technical.md'));
const DOC = '/docs/long.md';
const b64 = (text) => Buffer.from(text).toString('base64');

// Comments, an unknown key, a table, CRLF-free; every byte but the edited line must survive.
const CONFIG = '# my marxy config\nvariant = "light" # easy on the eyes\nsize = 24\nunknown_thing = [1, 2]\n\n[linux]\nweight_offset = 75\n';

const outDir = mkdtempSync(join(tmpdir(), 'marxy-reader-config-'));
let server;
let base;

before(async () => {
  if (skip) return;
  await build({
    root: desktopRoot,
    logLevel: 'silent',
    build: { outDir, emptyOutDir: true, rollupOptions: { input: { paletteBoot: join(desktopRoot, 'test/palette-boot.html') } } },
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

nodeTest('lineBoxFor: 16, 20, 24, 28 give 24, 30, 36, 42; every size gives an even line box', async () => {
  const { lineBoxFor } = await import('../src/theme/reader-config.ts');
  assert.deepEqual([16, 20, 24, 28].map(lineBoxFor), [24, 30, 36, 42]);
  for (let size = 15; size <= 50; size++) assert.equal(lineBoxFor(size) % 2, 0, `size ${size}`);
});

nodeTest('sizeProperties: the default size reproduces tokens.css (20, 30, 18, 30); every size keeps code on the grid', async () => {
  const { sizeProperties, DEFAULT_SIZE } = await import('../src/theme/reader-config.ts');
  assert.deepEqual(sizeProperties(DEFAULT_SIZE), {
    '--marxy-size-body': '20px', '--marxy-line-box': '30px', '--marxy-size-code': '18px', '--marxy-line-box-code': '30px',
  });
  for (let size = 15; size <= 50; size++) {
    const p = sizeProperties(size);
    assert.equal(parseFloat(p['--marxy-line-box-code']) % (parseFloat(p['--marxy-line-box']) / 2), 0, `size ${size}`);
  }
});

/** Boots the app on the palette harness; `config` is the bytes of /config, or null for none. */
async function boot(browser, config) {
  const page = await browser.newPage({ viewport: { width: 960, height: 800 } });
  // Stamps every change of html[data-marxy-variant], on the clock the marks use.
  await page.addInitScript(() => {
    window.__variantAt = [];
    new MutationObserver(() => window.__variantAt.push([document.documentElement.dataset.marxyVariant, Date.now()]))
      .observe(document, { attributes: true, subtree: true, attributeFilter: ['data-marxy-variant'] });
  });
  await page.goto(`${base}test/palette-boot.html`);
  await page.waitForFunction(() => typeof window.marxyPaletteBoot?.start === 'function');
  const files = { [DOC]: fixture.toString('base64') };
  if (config !== null) files['/config'] = b64(config);
  await page.evaluate(async ({ files }) => {
    const { handle } = await window.marxyPaletteBoot.start(files, ['/docs/long.md']);
    window.__h = handle;
  }, { files });
  await settle(page);
  const mod = (await page.evaluate(() => navigator.platform)) === 'MacIntel' ? 'Meta' : 'Control';
  return { page, mod };
}

const variantOf = (page) => page.evaluate(() => document.documentElement.getAttribute('data-marxy-variant'));
const configOf = (page) => page.evaluate(async () => new TextDecoder().decode(await window.__h.shell.readFile('/config')));
const lineHeightOf = (page) => page.evaluate(() => parseFloat(getComputedStyle(document.getElementById('doc')).lineHeight));
const writesOf = (page) => page.evaluate(() => window.__h.shell.calls.filter((c) => c.method === 'writeFileAtomic' && c.args[0] === '/config').length);

/** Every block's top on the half-line grid, as packages/theme/test/grid.test.mjs checks it. */
const offGrid = (page) => page.evaluate(() => {
  const article = document.getElementById('doc');
  const unit = parseFloat(getComputedStyle(article).lineHeight) / 2;
  const origin = article.getBoundingClientRect().top;
  const off = [];
  let seen = 0;
  for (const el of article.querySelectorAll('[data-marxy-s]')) {
    if (!['block', 'table', 'list-item', 'flow-root'].includes(getComputedStyle(el).display)) continue;
    seen += 1;
    const top = el.getBoundingClientRect().top - origin;
    const r = ((top % unit) + unit) % unit;
    if (r > 0.5 && r < unit - 0.5) off.push(`<${el.tagName.toLowerCase()}> top ${top.toFixed(2)} (unit ${unit})`);
  }
  return { off, seen, unit };
});

async function runPaletteCommand(page, mod, query) {
  await page.keyboard.press(`${mod}+KeyP`);
  await page.fill('#marxy-palette .marxy-palette-query', query);
  await page.keyboard.press('Enter');
  await settle(page);
}

test('variant = "light" in config is on the root before the file_read mark', async () => {
  const browser = await launchWebkit();
  try {
    const { page } = await boot(browser, CONFIG);
    const r = await page.evaluate(() => ({
      changes: window.__variantAt,
      fileRead: window.__h.shell.calls.find((c) => c.method === 'mark' && c.args[0] === 'file_read').args[1],
    }));
    const light = r.changes.find(([v]) => v === 'light');
    assert.ok(light, JSON.stringify(r.changes));
    assert.ok(light[1] <= r.fileRead, `light at ${light[1]}, file_read at ${r.fileRead}`);
    assert.equal(await variantOf(page), 'light');
    // The dark first paint never happened: nothing set dark after light.
    assert.equal(r.changes.at(-1)[0], 'light');
  } finally {
    await browser.close();
  }
});

test('size = 24 gives a 36 px line and every block on the 18 px grid', async () => {
  const browser = await launchWebkit();
  try {
    const { page } = await boot(browser, CONFIG);
    assert.equal(await lineHeightOf(page), 36);
    const { off, seen, unit } = await offGrid(page);
    assert.equal(unit, 18);
    assert.ok(seen > 50, `${seen} blocks checked`);
    assert.deepEqual(off, []);
  } finally {
    await browser.close();
  }
});

test('Use dark variant from the palette switches at once and rewrites only the variant line', async () => {
  const browser = await launchWebkit();
  try {
    const { page, mod } = await boot(browser, CONFIG);
    await runPaletteCommand(page, mod, '>dark variant');
    assert.equal(await variantOf(page), 'dark');
    assert.equal(await configOf(page), CONFIG.replace('variant = "light"', 'variant = "dark"'));
    // It holds only when it is not the current variant: now the other one is offered.
    await page.keyboard.press(`${mod}+KeyP`);
    await page.fill('#marxy-palette .marxy-palette-query', '>variant');
    const titles = await page.$$eval('#marxy-palette .marxy-palette-title', (els) => els.map((el) => el.textContent));
    assert.deepEqual(titles, ['Use light variant']);
  } finally {
    await browser.close();
  }
});

test('Mod+= three times writes size = 23, keeps the reader on the line and every block on the grid', async () => {
  const browser = await launchWebkit();
  try {
    const { page, mod } = await boot(browser, 'size = 20 # comment\nunknown = true\n');
    await page.evaluate(() => { document.documentElement.scrollTop = 6000; });
    await settle(page);
    const before = await page.evaluate(() => window.__h.sourceHarness().byteOffset);
    // Each press sets the page again through the app's own relayout.
    await page.evaluate(() => {
      window.__relayouts = 0;
      const relayout = window.__h.relayout;
      window.__h.relayout = (...args) => { window.__relayouts += 1; return relayout(...args); };
    });
    for (let i = 0; i < 3; i++) await page.keyboard.press(`${mod}+Equal`);
    await settle(page);
    assert.equal(await configOf(page), 'size = 23 # comment\nunknown = true\n');
    assert.equal(await page.evaluate(() => window.__relayouts), 3);
    assert.equal(await lineHeightOf(page), lineBoxFor(23));
    const after = await page.evaluate(() => window.__h.sourceHarness().byteOffset);
    // Within one block of where it was: the nearest heading or paragraph either side.
    const text = fixture.toString('utf8');
    const prev = text.lastIndexOf('\n\n', before);
    const next = text.indexOf('\n\n', before);
    assert.ok(after >= prev && after <= next, `reading byte ${before} -> ${after}, outside its block ${prev}..${next}`);
    const { off } = await offGrid(page);
    assert.deepEqual(off, []);
    // The page is set again, not merely restyled: it breaks its lines exactly as a launch at 23 does.
    const shape = () => (p) => p.evaluate(() => [...document.querySelectorAll('#doc p[data-marxy-s]')].slice(0, 40).map((el) => el.getBoundingClientRect().height));
    const live = await shape()(page);
    const fresh = await boot(browser, 'size = 23\n');
    assert.deepEqual(live, await shape()(fresh.page));
    // Mod+0 puts the size back to 20 and the line box to 30; Mod+- goes down by one.
    await page.keyboard.press(`${mod}+Digit0`);
    await settle(page);
    assert.equal(await lineHeightOf(page), 30);
    assert.equal(await configOf(page), 'size = 20 # comment\nunknown = true\n');
    await page.keyboard.press(`${mod}+Minus`);
    await settle(page);
    assert.equal(await configOf(page), 'size = 19 # comment\nunknown = true\n');
  } finally {
    await browser.close();
  }
});

function lineBoxFor(size) { return 2 * Math.round(0.75 * size); }

test('a command writes the key into a file that has none, before the first table, and keeps the rest', async () => {
  const browser = await launchWebkit();
  try {
    const original = '# top\r\nunknown = 1\r\n[linux]\r\nweight_offset = 75\r\n';
    const { page, mod } = await boot(browser, original);
    await runPaletteCommand(page, mod, '>light variant');
    assert.equal(await configOf(page), '# top\r\nunknown = 1\r\nvariant = "light"\r\n[linux]\r\nweight_offset = 75\r\n');
  } finally {
    await browser.close();
  }
});

test('a missing config launches dark at 20 px; a command then creates the file', async () => {
  const browser = await launchWebkit();
  try {
    const { page, mod } = await boot(browser, null);
    assert.equal(await variantOf(page), 'dark');
    assert.equal(await lineHeightOf(page), 30);
    assert.equal(await writesOf(page), 0);
    await page.keyboard.press(`${mod}+Equal`);
    await settle(page);
    assert.equal(await configOf(page), 'size = 21\n');
  } finally {
    await browser.close();
  }
});

test('an unparsable config launches dark at 20 px with only the existing config warnings', async () => {
  const browser = await launchWebkit();
  try {
    const { page } = await boot(browser, 'variant = = light\n[[[\n');
    assert.equal(await variantOf(page), 'dark');
    assert.equal(await lineHeightOf(page), 30);
    assert.equal(await page.evaluate(() => document.querySelectorAll('#marxy-notices > *').length), 0);
    assert.equal(await writesOf(page), 0);
  } finally {
    await browser.close();
  }
});

test('a config that exists but cannot be read is never overwritten: the command says so and writes nothing', async () => {
  const browser = await launchWebkit();
  try {
    const { page, mod } = await boot(browser, CONFIG);
    await page.evaluate(() => {
      const read = window.__h.shell.readFile.bind(window.__h.shell);
      window.__h.shell.readFile = async (path) => {
        if (path === '/config') throw Object.assign(new Error('denied'), { code: 'permission' });
        return read(path);
      };
    });
    await page.keyboard.press(`${mod}+Equal`);
    await settle(page);
    assert.equal(await writesOf(page), 0);
    assert.match(await page.evaluate(() => document.getElementById('marxy-notices').textContent), /config\.toml could not be updated/);
  } finally {
    await browser.close();
  }
});
