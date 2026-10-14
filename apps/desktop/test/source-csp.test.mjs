// Source and the block editor are styled in the release build (F-98, found by X-33). CodeMirror styles itself with runtime
// <style> elements (style-mod); the shipped policy has `style-src 'self'` and Tauri adds a per-load nonce, so a <style>
// without that nonce is refused, no CodeMirror rule applies, `.cm-scroller` is `display: block` and the fold gutter, the
// numbers and the text stack one under another. The dev harness has no CSP, so source-gutter.test.mjs never saw it.
// This file serves the built app under the release style policy (as release-csp.test.mjs does) and measures the layout.
import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { after, before, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { build } from 'vite';
import { injectStyleNonces, loadConfiguredCsp, releaseStyleCsp } from '../../../scripts/check-csp.mjs';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { shippedSkeleton } from './support/two-pane.mjs';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);

const repoRoot = new URL('../../../', import.meta.url).pathname;
const desktopRoot = join(repoRoot, 'apps', 'desktop');
const outDir = mkdtempSync(join(tmpdir(), 'marxy-source-csp-'));
const NONCE = 'f98nonce';
let server;
let base;

before(async () => {
  if (skip) return;
  await build({ root: desktopRoot, logLevel: 'silent', build: { outDir, emptyOutDir: true, rollupOptions: { input: { app: join(desktopRoot, 'app.html') } } } });
  const csp = releaseStyleCsp(loadConfiguredCsp(), NONCE);
  const { style, body } = shippedSkeleton();
  const types = { '.html': 'text/html', '.ttf': 'font/ttf', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' };
  server = createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const path = join(outDir, pathname.endsWith('/') ? `${pathname}index.html` : pathname);
    if (!existsSync(path)) { res.statusCode = 404; return res.end(); }
    const ext = extname(path);
    res.setHeader('Content-Type', types[ext] ?? 'application/octet-stream');
    if (ext === '.html') {
      res.setHeader('Content-Security-Policy', csp);
      const html = readFileSync(path, 'utf8')
        .replace('</head>', `<style>${style}</style></head>`)
        .replace(/<body[^>]*>/, '<body data-marxy-mode="rendered" data-marxy-variant="dark">')
        .replace('<article id="doc" class="marxy-article"></article>', body);
      return res.end(injectStyleNonces(html, NONCE));
    }
    res.end(readFileSync(path));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}/`;
});
after(() => server?.close());

const b64 = (text) => Buffer.from(text, 'utf8').toString('base64');
/** About 20 short lines, line 7 blank, no trailing newline (CodeMirror counts 20). */
const LINES = Array.from({ length: 20 }, (_, i) => `line ${i + 1} ${'ab'.repeat((i % 4) + 1)}`);
LINES[6] = '';
const DOC = LINES.join('\n');

/** Boots the built app on `files` and opens `argv`; collects every CSP refusal (event and console). */
async function boot(browser, files, argv, viewport = { width: 1000, height: 800 }) {
  const page = await browser.newPage({ viewport });
  const refusals = [];
  await page.addInitScript(() => {
    window.__cspRefusals = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      window.__cspRefusals.push(`${e.violatedDirective} ${e.blockedURI} ${(e.sample ?? '').slice(0, 40)}`);
    });
  });
  page.on('console', (m) => {
    if (/Refused to apply|Refused to load|Content Security Policy/i.test(m.text()) && !/data:font\//i.test(m.text())) refusals.push(m.text().slice(0, 140));
  });
  await page.goto(`${base}app.html`);
  await page.waitForFunction(() => typeof window.marxyApp?.start === 'function');
  const encoded = Object.fromEntries(Object.entries(files).map(([p, t]) => [p, b64(t)]));
  await page.evaluate(async ({ files, argv }) => {
    const handle = await window.marxyApp.start(files, argv);
    await handle.ready;
    window.__marxyHandle = handle;
  }, { files: encoded, argv });
  return {
    page,
    refusals: async () => [...refusals, ...(await page.evaluate(() => window.__cspRefusals))],
  };
}

/**
 * Cmd+3 (Source), then the editor's first frames and the mono face. No screenshot: Playwright injects a <style> of its own
 * for one, which the release policy refuses and a test counting refusals would blame on the app (the two "unattributed"
 * refusals X-33 saw were its two screenshots).
 */
async function openSource(page) {
  await page.keyboard.press('Meta+Digit3');
  await page.waitForSelector('.marxy-source-mount .cm-content .cm-line');
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.waitForTimeout(500);
}

/** Boxes of the Source editor, in CSS px. */
function measure(page, selector = '.marxy-source-mount') {
  return page.evaluate((selector) => {
    const root = document.querySelector(selector);
    const box = (el) => { const r = el.getBoundingClientRect(); return { top: r.top, left: r.left, bottom: r.bottom, right: r.right, height: r.height }; };
    const lines = [...root.querySelectorAll('.cm-content > .cm-line')].map(box);
    const rows = [...root.querySelectorAll('.cm-lineNumbers .cm-gutterElement')]
      .filter((el) => getComputedStyle(el).visibility !== 'hidden' && /^\d+$/.test(el.textContent.trim()))
      .map((el) => ({ n: Number(el.textContent), ...box(el) }));
    const folds = [...root.querySelectorAll('.cm-foldGutter .cm-gutterElement')]
      .filter((el) => getComputedStyle(el).visibility !== 'hidden' && el.textContent.trim() !== '')
      .map(box);
    const gutters = root.querySelector('.cm-gutters');
    const content = root.querySelector('.cm-content');
    const scroller = root.querySelector('.cm-scroller');
    const editor = root.querySelector('.cm-editor');
    return {
      lines,
      rows,
      folds,
      gutters: gutters ? box(gutters) : null,
      content: box(content),
      editor: box(editor),
      scrollerDisplay: getComputedStyle(scroller).display,
      contentFont: getComputedStyle(content).fontFamily,
    };
  }, selector);
}

/** The card's geometry, asserted for one mounted editor holding `lineCount` lines. */
function assertAligned(m, lineCount, label) {
  assert.equal(m.scrollerDisplay, 'flex', `${label}: .cm-scroller is ${m.scrollerDisplay}, not flex (CodeMirror's base theme did not apply)`);
  assert.match(m.contentFont, /mono/i, `${label}: content font is ${m.contentFont}`);
  assert.equal(m.rows.length, lineCount, `${label}: numbered rows ${m.rows.length}, lines ${lineCount}`);
  assert.deepEqual(m.rows.map((r) => r.n), Array.from({ length: lineCount }, (_, i) => i + 1), `${label}: numbers are 1..${lineCount}`);
  assert.equal(m.lines.length, lineCount, `${label}: rendered lines ${m.lines.length}`);
  for (let i = 0; i < lineCount; i++) {
    assert.ok(Math.abs(m.rows[i].top - m.lines[i].top) <= 1, `${label}: number ${i + 1} top ${m.rows[i].top} vs line top ${m.lines[i].top}`);
  }
  assert.ok(m.gutters, `${label}: no gutters`);
  assert.ok(m.gutters.left < m.content.left, `${label}: gutter left ${m.gutters.left} is not left of content ${m.content.left}`);
  assert.ok(m.gutters.right <= m.content.left + 1, `${label}: gutter (right ${m.gutters.right}) overlaps the text (left ${m.content.left})`);
  for (const r of m.rows) assert.ok(r.right <= m.content.left + 1, `${label}: number ${r.n} (right ${r.right}) overlaps the text (left ${m.content.left})`);
  // No stray block above line 1: the first line starts within one row of the editor's top, not a gutter-height below it.
  assert.ok(m.lines[0].top - m.editor.top < 60, `${label}: line 1 is ${m.lines[0].top - m.editor.top} px below the editor's top`);
  // A fold chevron sits on its own line's row.
  for (const f of m.folds) {
    assert.ok(m.lines.some((l) => Math.abs(l.top - f.top) <= 1), `${label}: a fold marker at ${f.top} is on no line`);
  }
}

test('Source with line numbers on a Markdown file: gutter and text are one aligned editor, zero CSP refusals', async () => {
  const browser = await launchWebkit();
  try {
    const { page, refusals } = await boot(browser, { '/config': 'line_numbers = true\n', '/w/doc.md': DOC }, ['/w/doc.md']);
    await openSource(page);
    assertAligned(await measure(page), 20, 'markdown');
    assert.deepEqual(await refusals(), [], 'style refusals under the release policy');
  } finally {
    await browser.close();
  }
});

test('Source with line numbers on a code file (numbers on by default): aligned, zero CSP refusals', async () => {
  const browser = await launchWebkit();
  try {
    const rs = LINES.map((l, i) => (l === '' ? '' : i === 0 ? 'fn main() {' : `    let x${i} = ${i};`)).join('\n');
    const { page, refusals } = await boot(browser, { '/w/doc.rs': rs }, ['/w/doc.rs']);
    await openSource(page);
    assertAligned(await measure(page), 20, 'code');
    assert.deepEqual(await refusals(), []);
  } finally {
    await browser.close();
  }
});

test('an Untitled document in Source with line numbers (the author\'s case) is aligned in a narrow and a wide window', async () => {
  const browser = await launchWebkit();
  try {
    for (const width of [800, 1400]) {
      const { page, refusals } = await boot(browser, { '/w/other.md': '# Other\n' }, ['/w/other.md'], { width, height: 800 });
      await page.evaluate((t) => window.__marxyHandle.openScratch(t), DOC);
      await page.waitForTimeout(300);
      await openSource(page);
      assertAligned(await measure(page), 20, `untitled ${width}`);
      assert.deepEqual(await refusals(), []);
      await page.close();
    }
  } finally {
    await browser.close();
  }
});

test('the find panel and the block editor in Rendered are styled under the release policy', async () => {
  const browser = await launchWebkit();
  try {
    const { page, refusals } = await boot(browser, { '/w/doc.md': `# Title\n\n${LINES.slice(0, 3).join(' ')}\n\nAfter.\n` }, ['/w/doc.md']);
    // The block editor: select a block, Cmd+Enter.
    await page.waitForFunction(() => document.querySelector('#doc [data-marxy-s]') !== null);
    const start = await page.evaluate(() => Number(document.querySelector('#doc p[data-marxy-s]').dataset.marxyS.split(',')[0]));
    await page.evaluate((b) => window.__marxyHandle.selection.selectBlockAtByte(b), start);
    await page.keyboard.press('Meta+Enter');
    await page.waitForSelector('.marxy-block-editor .cm-content');
    await page.waitForTimeout(300);
    const block = await page.evaluate(() => {
      const scroller = document.querySelector('.marxy-block-editor .cm-scroller');
      const content = document.querySelector('.marxy-block-editor .cm-content');
      return { display: getComputedStyle(scroller).display, font: getComputedStyle(content).fontFamily };
    });
    assert.equal(block.display, 'flex', 'block editor: CodeMirror base theme did not apply');
    assert.match(block.font, /mono/i);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelector('.marxy-block-editor') === null);
    // The find panel, in Source.
    await openSource(page);
    await page.click('.marxy-source-mount .cm-content');
    await page.keyboard.press('Meta+f');
    await page.waitForSelector('.marxy-source-mount .cm-panels .cm-search, .cm-panels .cm-search');
    const panel = await page.evaluate(() => {
      const p = document.querySelector('.cm-panels');
      return { position: getComputedStyle(p).position, field: getComputedStyle(document.querySelector('.cm-search input')).fontFamily };
    });
    assert.notEqual(panel.position, 'static', 'find panel: CodeMirror panel rules did not apply');
    assert.deepEqual(await refusals(), []);
  } finally {
    await browser.close();
  }
});

test('walking Rendered, Source, Split and the find and replace sheets logs no CSP refusal (the audit of every runtime style)', async () => {
  const browser = await launchWebkit();
  try {
    const { page, refusals } = await boot(browser, { '/config': 'line_numbers = true\n', '/w/doc.md': `# Title\n\n${DOC}\n\n\`\`\`rs\nfn main() {}\n\`\`\`\n` }, ['/w/doc.md'], { width: 1500, height: 800 });
    await page.waitForFunction(() => document.querySelector('#doc [data-marxy-s]') !== null);
    assert.deepEqual(await refusals(), [], 'Rendered');
    await page.keyboard.press('Meta+Digit2');
    await page.waitForSelector('.cm-content .cm-line');
    await page.waitForTimeout(500);
    assert.deepEqual(await refusals(), [], 'Split');
    const split = await page.evaluate(() => getComputedStyle(document.querySelector('.cm-scroller')).display);
    assert.equal(split, 'flex', 'the Source half of Split is styled');
    await openSource(page);
    await page.click('.marxy-source-mount .cm-content');
    await page.keyboard.press('Meta+f');
    await page.waitForSelector('.cm-panels .cm-search');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Meta+Digit1');
    await page.waitForTimeout(300);
    assert.deepEqual(await refusals(), [], 'Source, find, back to Rendered');
  } finally {
    await browser.close();
  }
});

// The nonce reaches the page only if Tauri puts it there: it marks every <style> of the HTML it serves (tauri-utils
// `inject_nonce_token`, "style" selector) unless `dangerousDisableAssetCspModification` turns that off for style-src.
// `pageStyleNonce` reads it back from those elements, so the shipped page must keep at least one and the config must not
// disable the injection. (The smoke driver, scripts/smoke-built-app.mjs, is Linux only; this is the part a Mac can check.)
test('the shipped page keeps a <style> for Tauri to nonce, and the config leaves the injection on', () => {
  const html = readFileSync(join(desktopRoot, 'index.html'), 'utf8');
  assert.match(html, /<style\b/, 'index.html has no inline <style>: pageStyleNonce would find no nonce in a release build');
  const conf = JSON.parse(readFileSync(join(desktopRoot, 'src-tauri', 'tauri.conf.json'), 'utf8'));
  const off = conf?.app?.security?.dangerousDisableAssetCspModification;
  assert.ok(off === undefined || off === false || (Array.isArray(off) && !off.includes('style-src')), `Tauri's style nonce injection is disabled: ${JSON.stringify(off)}`);
});

test('the gutter keeps its column for 3, 120 and 1,200 lines (the text does not move) and the numbers stay on their rows', async () => {
  const browser = await launchWebkit();
  try {
    const lefts = [];
    for (const count of [3, 120, 1200]) {
      const doc = Array.from({ length: count }, (_, i) => (i === 1 ? '' : `row ${i + 1}`)).join('\n');
      const { page, refusals } = await boot(browser, { '/config': 'line_numbers = true\n', '/w/doc.md': doc }, ['/w/doc.md']);
      await openSource(page);
      const m = await measure(page);
      assert.equal(m.scrollerDisplay, 'flex');
      assert.equal(m.rows[0].n, 1, `${count} lines: the first number`);
      assert.equal(m.rows.length, m.lines.length, `${count} lines: numbered rows against rendered lines`);
      for (let i = 0; i < m.rows.length; i++) {
        assert.equal(m.rows[i].n, i + 1);
        assert.ok(Math.abs(m.rows[i].top - m.lines[i].top) <= 1, `${count} lines: number ${i + 1} is off its line`);
        assert.ok(m.rows[i].right <= m.content.left + 1, `${count} lines: number ${i + 1} overlaps the text`);
      }
      lefts.push(Math.round(m.content.left));
      assert.deepEqual(await refusals(), []);
      await page.close();
    }
    assert.equal(new Set(lefts).size, 1, `the text's left edge moved with the digit count: ${lefts}`);
  } finally {
    await browser.close();
  }
});
