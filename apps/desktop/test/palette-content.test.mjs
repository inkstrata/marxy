// `/` in the palette searches file contents and lands at the match (C-17). Real WebKit, the memory shell's
// content search (C-16), two roots (C-10).
import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { build } from 'vite';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';

const desktopRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip }, fn);

const outDir = mkdtempSync(join(tmpdir(), 'marxy-palette-content-'));
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
      rollupOptions: { input: { paletteBoot: join(desktopRoot, 'test/palette-boot.html') } },
    },
  });
  const types = { '.html': 'text/html', '.ttf': 'font/ttf', '.js': 'text/javascript', '.css': 'text/css' };
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

const filler = `${'word '.repeat(40)}\n\n`;
const before_ = `# Guide\n\n${filler.repeat(8)}`;
const guideBody = `${before_}- Keep the baseline grid in the list item.\n\n${filler.repeat(8)}Done\n`;
const guideOffset = Buffer.byteLength(`${before_}- Keep the `, 'utf8');

// A line that lies: an RLO reverses what follows it on screen, an isolate hides, a zero-width space splits a word.
const BIDI_LINE = 'A zebra crossing, access \u202e{ nimda_si }\u2066 and pass\u200bword.';
// Far past the progressive threshold (64 KiB), so the match is in a part the first mount does not hold.
const BIG_FILLER = 'Plain filler words to make the page long enough for progressive mounting.\n\n';
const bigBody = `# Big\n\n${BIG_FILLER.repeat(3000)}The needle-at-the-very-end sits here.\n\n${BIG_FILLER.repeat(5)}`;
const bigOffset = Buffer.byteLength(`# Big\n\n${BIG_FILLER.repeat(3000)}The `, 'utf8');

const FILES = {
  '/other/trojan.md': `# Trojan\n\n${BIDI_LINE}\n`,
  '/repo/big.md': bigBody,
  '/repo/README.md': '# Home\n\nThe baseline grid sets the rhythm.\n',
  '/repo/docs/guide.md': guideBody,
  '/other/notes.md': '# Notes\n\nA baseline grid, in another root.\n',
};
const entry = (path, root, title) => ({ path, root, title, headings: [], mtimeMs: 1, size: 1, kind: 'markdown' });
const ENTRIES = [
  entry('/other/trojan.md', '/other', 'Trojan'),
  entry('/repo/big.md', '/repo', 'Big'),
  entry('/other/notes.md', '/other', 'Notes'),
  entry('/repo/README.md', '/repo', 'Home'),
  entry('/repo/docs/guide.md', '/repo', 'Guide'),
];

async function boot(browser) {
  const page = await browser.newPage({ viewport: { width: 960, height: 800 } });
  await page.goto(`${base}test/palette-boot.html`);
  await page.waitForFunction(() => typeof window.marxyPaletteBoot?.start === 'function');
  await page.evaluate(async ({ files, entries }) => {
    const r = await window.marxyPaletteBoot.start(files, ['/repo/README.md'], entries);
    window.__h = r.handle;
  }, { files: Object.fromEntries(Object.entries(FILES).map(([k, v]) => [k, Buffer.from(v, 'utf8').toString('base64')])), entries: ENTRIES });
  return page;
}

const modOf = async (page) => ((await page.evaluate(() => navigator.platform)) === 'MacIntel' ? 'Meta' : 'Control');

test('/baseline grid lists hits from both roots, the current root first; Enter opens the file at the match with its block selected; nothing is written', async () => {
  const browser = await launchWebkit();
  try {
    const page = await boot(browser);
    await page.keyboard.press(`${await modOf(page)}+KeyP`);
    const scoredBefore = await page.evaluate(() => window.marxyPaletteBoot.prepareStats.rowsScored);
    const writeCount = () => page.evaluate(() => window.__h.shell.calls.filter((c) => c.method === 'writeFileAtomic').length);
    const writesBefore = await writeCount();
    await page.locator('#marxy-palette .marxy-palette-query').pressSequentially('/baseline grid');
    await page.waitForSelector('#marxy-palette .marxy-palette-hit');
    assert.equal(await writeCount(), writesBefore, 'the search itself writes nothing');

    const rows = await page.$$eval('#marxy-palette .marxy-palette-hit', (els) =>
      els.map((el) => ({ text: el.textContent ?? '', mark: el.querySelector('mark.marxy-palette-match')?.textContent })),
    );
    assert.equal(rows.length, 3);
    assert.ok(rows.every((r) => r.mark === 'baseline grid'), 'the match is marked in every preview');
    assert.ok(rows.every((r) => /· line \d+/.test(r.text)));
    assert.match(rows[0].text, /Home|Guide/, 'the current root (/repo) comes first');
    assert.match(rows[2].text, /Notes/, 'the other root comes last');
    assert.match(await page.textContent('#marxy-palette .marxy-palette-notice'), /^3 matches in 3 files$/);

    // Typing in the content phase never runs the fuzzy matcher.
    const scoredAfter = await page.evaluate(() => window.marxyPaletteBoot.prepareStats.rowsScored);
    assert.equal(scoredAfter, scoredBefore, 'no fuzzy scan while typing a content query');

    await page.locator('#marxy-palette .marxy-palette-hit', { hasText: 'Guide' }).click();
    await page.waitForFunction(() => document.title.includes('guide.md'));
    await page.waitForFunction(() => document.querySelector('#doc .marxy-selected') !== null);
    const selected = await page.evaluate(() => {
      const el = document.querySelector('#doc .marxy-selected');
      return { s: Number(el.getAttribute('data-marxy-s')), e: Number(el.getAttribute('data-marxy-e')), text: el.textContent };
    });
    assert.ok(selected.s <= guideOffset && guideOffset < selected.e, `${selected.s} <= ${guideOffset} < ${selected.e}`);
    assert.match(selected.text, /baseline grid/);

    // Marxy's own state files may be written when a document is opened; a document never is.
    const documentWrites = await page.evaluate(() =>
      window.__h.shell.calls.filter((c) => c.method === 'writeFileAtomic' && /\.md$/.test(String(c.args[0]))).length);
    assert.equal(documentWrites, 0, 'no document is written');
  } finally {
    await browser.close();
  }
});

test('Enter on the selected row opens it; Tab does nothing; a fuzzy query still scores rows', async () => {
  const browser = await launchWebkit();
  try {
    const page = await boot(browser);
    await page.keyboard.press(`${await modOf(page)}+KeyP`);
    const input = page.locator('#marxy-palette .marxy-palette-query');
    await input.pressSequentially('/baseline grid');
    await page.waitForSelector('#marxy-palette .marxy-palette-hit');
    await page.keyboard.press('Tab');
    assert.equal(await input.inputValue(), '/baseline grid');
    assert.equal((await page.$$('#marxy-palette .marxy-palette-hit')).length, 3);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.title.includes('notes.md'));
    await page.waitForFunction(() => document.querySelector('#doc .marxy-selected') !== null);

    // Control: a fuzzy query does run the matcher.
    await page.keyboard.press(`${await modOf(page)}+KeyP`);
    const scoredBefore = await page.evaluate(() => window.marxyPaletteBoot.prepareStats.rowsScored);
    await input.fill('guide');
    assert.ok((await page.evaluate(() => window.marxyPaletteBoot.prepareStats.rowsScored)) > scoredBefore);
  } finally {
    await browser.close();
  }
});

test('"/" alone shows the hint, and a stale answer cannot replace a newer query', async () => {
  const browser = await launchWebkit();
  try {
    const page = await boot(browser);
    await page.keyboard.press(`${await modOf(page)}+KeyP`);
    const input = page.locator('#marxy-palette .marxy-palette-query');
    await input.fill('/');
    assert.equal(await page.textContent('#marxy-palette .marxy-palette-notice'), 'Type to search file contents');
    await input.fill('/zzzz-nothing');
    await page.waitForFunction(() => document.querySelector('#marxy-palette .marxy-palette-notice')?.textContent === 'No matches');
  } finally {
    await browser.close();
  }
});

test('bidi controls and zero-width characters in a preview are marked, never painted raw (commitment 4)', async () => {
  const browser = await launchWebkit();
  try {
    const page = await boot(browser);
    await page.keyboard.press(`${await modOf(page)}+KeyP`);
    await page.locator('#marxy-palette .marxy-palette-query').pressSequentially('/zebra crossing');
    await page.waitForSelector('#marxy-palette .marxy-palette-hit');
    const row = await page.evaluate(() => {
      const el = [...document.querySelectorAll('#marxy-palette .marxy-palette-hit')].find((r) => r.textContent.includes('Trojan'));
      const raw = /[\u202a-\u202e\u2066-\u2069\u200b-\u200d\u2060\ufeff]/u;
      // The marker's own isolated character is aria-hidden display; everything else must carry none.
      const clone = el.cloneNode(true);
      clone.querySelectorAll('.marxy-invisible-byte').forEach((n) => n.remove());
      return {
        markers: [...el.querySelectorAll('.marxy-invisible-glyph')].map((n) => n.textContent),
        rawOutsideMarkers: raw.test(clone.textContent),
        rawInLabel: raw.test(el.getAttribute('aria-label')),
        label: el.getAttribute('aria-label'),
        bytesAriaHidden: [...el.querySelectorAll('.marxy-invisible-byte')].every((n) => n.getAttribute('aria-hidden') === 'true'),
      };
    });
    assert.deepEqual(row.markers, ['202E', '2066', '200B']);
    assert.equal(row.rawOutsideMarkers, false, 'no raw bidi or zero-width character outside a marker');
    assert.equal(row.rawInLabel, false, 'the accessible name carries none either');
    assert.match(row.label, /U\+202E.*U\+2066.*U\+200B/);
    assert.ok(row.bytesAriaHidden);
  } finally {
    await browser.close();
  }
});

test('a hit deep in a document long enough to mount progressively lands on its block', async () => {
  const browser = await launchWebkit();
  try {
    const page = await boot(browser);
    await page.keyboard.press(`${await modOf(page)}+KeyP`);
    await page.locator('#marxy-palette .marxy-palette-query').pressSequentially('/needle-at-the-very-end');
    await page.waitForSelector('#marxy-palette .marxy-palette-hit');
    await page.locator('#marxy-palette .marxy-palette-hit', { hasText: 'Big' }).click();
    await page.waitForFunction(() => document.title.includes('big.md'));
    await page.waitForFunction(() => document.querySelector('#doc .marxy-selected') !== null);
    const selected = await page.evaluate(() => {
      const el = document.querySelector('#doc .marxy-selected');
      return { s: Number(el.getAttribute('data-marxy-s')), e: Number(el.getAttribute('data-marxy-e')), text: el.textContent };
    });
    assert.ok(selected.s <= bigOffset && bigOffset < selected.e, `${selected.s} <= ${bigOffset} < ${selected.e}`);
    assert.match(selected.text, /needle-at-the-very-end/);
  } finally {
    await browser.close();
  }
});
