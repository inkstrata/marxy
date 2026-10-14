// Source fills its pane (F-100, from X-33's measurements and the author's note: "in general we want to fill the window
// with our editor"). Folded, unfolded and in Split, the gutter sits at the pane's own edge (the frame's hairline and the
// pane's inset, at most 16 px), the text runs to the other edge or wraps at it, and the editor is as tall as the pane
// allows. Rendered keeps its measure. Every case runs under the dev harness (no policy) and under the release style
// policy (as source-csp.test.mjs does), in Night and Paper; the second is where the editor is only styled since F-98.
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
import { b64, closeHarness, harnessBase, routeSkeleton, shippedSkeleton } from './support/two-pane.mjs';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip, timeout: 180_000 }, fn);

const repoRoot = new URL('../../../', import.meta.url).pathname;
const desktopRoot = join(repoRoot, 'apps', 'desktop');
const outDir = mkdtempSync(join(tmpdir(), 'marxy-source-fill-'));
const NONCE = 'f100nonce';
/** The card's bound: the gutter and the editor's far edge are within the pane's own padding token, at most 16 px. */
const BOUND = 16;
let server;
let releaseBase;
let devBase;

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
  releaseBase = `http://127.0.0.1:${server.address().port}/`;
  devBase = await harnessBase();
});
after(async () => {
  server?.close();
  await closeHarness();
});

/** A short document: 20 short lines, line 7 blank. A long one: 400 lines, line 12 a 299-character line. */
const LONG_LINE = 'long line '.repeat(30).trim();
const shortLines = Array.from({ length: 20 }, (_, i) => `line ${i + 1} ${'ab'.repeat((i % 4) + 1)}`);
shortLines[6] = '';
const SHORT = shortLines.join('\n');
const longLines = Array.from({ length: 400 }, (_, i) => `row ${i + 1} ${'cd'.repeat((i % 5) + 1)}`);
longLines[11] = LONG_LINE;
const LONG = longLines.join('\n');

const MODES = [
  { name: 'dev harness', base: () => devBase, release: false },
  { name: 'release CSP', base: () => releaseBase, release: true },
];

/** Boots the app (memory shell) at `width` x `height`, in Night or Paper, on `files`, and opens `open`. */
async function boot(browser, mode, { files, open, width = 1000, height = 800, paper = false, numbers = true }) {
  const context = await browser.newContext({ viewport: { width, height }, colorScheme: paper ? 'light' : 'dark', deviceScaleFactor: 1 });
  const page = await context.newPage();
  const config = `line_numbers = ${numbers}\n${paper ? 'variant = "light"\n' : ''}`;
  const encoded = Object.fromEntries(Object.entries({ '/config': config, ...files }).map(([p, t]) => [p, b64(t)]));
  if (mode.release) {
    await page.goto(`${mode.base()}app.html`);
    await page.waitForFunction(() => typeof window.marxyApp?.start === 'function');
    await page.evaluate(async ({ files, argv }) => {
      const handle = await window.marxyApp.start(files, argv);
      await handle.ready;
      window.__marxyHandle = handle;
    }, { files: encoded, argv: [open] });
  } else {
    await routeSkeleton(page, mode.base());
    await page.addInitScript((variant) => { document.documentElement.dataset.marxyVariant = variant; }, paper ? 'light' : 'dark');
    await page.goto(`${mode.base()}app.html`);
    await page.waitForFunction(() => typeof window.marxyApp?.start === 'function');
    await page.evaluate(async ({ files, argv }) => {
      const handle = await window.marxyApp.start(files, argv);
      await handle.ready;
      window.__marxyHandle = handle;
    }, { files: encoded, argv: [open] });
  }
  return { page, context };
}

/** Cmd+3 (Source), then the first frames and the mono face. */
async function openSource(page) {
  await page.keyboard.press('Meta+Digit3');
  await page.waitForSelector('.marxy-source-mount .cm-content .cm-line');
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.waitForTimeout(400);
}

/** The boxes of every Source editor on screen, each against the pane (the Source mount) that holds it. */
function measure(page) {
  return page.evaluate(() => {
    const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { top: r.top, left: r.left, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
    return [...document.querySelectorAll('.marxy-source-mount .cm-editor')]
      .filter((ed) => ed.getBoundingClientRect().width > 0)
      .map((ed) => {
        const mount = ed.closest('.marxy-source-mount');
        const scroller = ed.querySelector('.cm-scroller');
        const content = ed.querySelector('.cm-content');
        const lines = [...content.querySelectorAll(':scope > .cm-line')];
        return {
          pane: box(mount),
          editor: box(ed),
          scroller: box(scroller),
          gutters: box(ed.querySelector('.cm-gutters')),
          content: box(content),
          firstLine: box(lines[0]),
          lastLine: box(lines[lines.length - 1]),
          display: getComputedStyle(scroller).display,
          wraps: ed.querySelector('.cm-lineWrapping') !== null,
          scrollWidth: scroller.scrollWidth,
          clientWidth: scroller.clientWidth,
          body: box(ed.closest('.marxy-source-body')),
          frame: box(ed.closest('.marxy-source-frame')),
          bottomBar: box(ed.closest('.marxy-source-frame')?.querySelector('.marxy-source-bottom')),
        };
      });
  });
}

/** The card's geometry for one editor: the gutter at the pane's left edge, the editor to its right edge, both within `BOUND`. */
function assertFills(m, label) {
  assert.equal(m.display, 'flex', `${label}: the editor is not styled (scroller ${m.display})`);
  assert.ok(m.gutters, `${label}: no gutter`);
  const left = m.gutters.left - m.pane.left;
  const right = m.pane.right - m.editor.right;
  assert.ok(left >= 0 && left <= BOUND, `${label}: the gutter starts ${left.toFixed(1)} px from the pane's left edge (bound ${BOUND})`);
  assert.ok(right >= 0 && right <= BOUND, `${label}: the editor ends ${right.toFixed(1)} px from the pane's right edge (bound ${BOUND})`);
}

for (const mode of MODES) {
  for (const [kind, path, text] of [['prose', '/w/doc.md', SHORT], ['code', '/w/doc.rs', SHORT.replace(/^line/gm, 'let')]]) {
    test(`${mode.name}: folded ${kind} Source fills a 1,000 and a 1,400 px window, in Night and Paper`, async () => {
      const browser = await launchWebkit();
      try {
        for (const [width, paper] of [[1000, false], [1400, false], [1400, true]]) {
          const { page, context } = await boot(browser, mode, { files: { [path]: text }, open: path, width, paper });
          await openSource(page);
          const [m, ...rest] = await measure(page);
          assert.equal(rest.length, 0);
          assertFills(m, `${kind} ${width}${paper ? ' Paper' : ''}`);
          await context.close();
        }
      } finally {
        await browser.close();
      }
    });
  }

  test(`${mode.name}: an Untitled document in folded Source fills the window`, async () => {
    const browser = await launchWebkit();
    try {
      const { page } = await boot(browser, mode, { files: { '/w/other.md': '# Other\n' }, open: '/w/other.md', width: 1400 });
      await page.evaluate((t) => window.__marxyHandle.openScratch(t), SHORT);
      await page.waitForTimeout(300);
      await openSource(page);
      const [m] = await measure(page);
      assertFills(m, 'untitled 1400');
    } finally {
      await browser.close();
    }
  });

  test(`${mode.name}: the editor is as tall as the pane, and a click below the last line puts the caret on it`, async () => {
    const browser = await launchWebkit();
    try {
      for (const [path, text] of [['/w/doc.md', SHORT], ['/w/doc.rs', SHORT]]) {
        const { page, context } = await boot(browser, mode, { files: { [path]: text }, open: path, width: 1000, height: 800 });
        await openSource(page);
        const [m] = await measure(page);
        // The frame's body is what the bars leave; the editor is that tall, and the text is at least as tall as the editor.
        assert.ok(Math.abs(m.editor.bottom - m.body.bottom) <= 1 && Math.abs(m.editor.top - m.body.top) <= 1, `${path}: the editor (${m.editor.top}..${m.editor.bottom}) is not its body (${m.body.top}..${m.body.bottom})`);
        assert.ok(m.pane.bottom - m.bottomBar.bottom <= BOUND, `${path}: the frame ends ${m.pane.bottom - m.bottomBar.bottom} px above the pane's foot`);
        assert.ok(m.content.height >= m.scroller.height - 1, `${path}: the text (${m.content.height}) is shorter than the editor (${m.scroller.height}); a click below the last line lands on nothing`);
        assert.ok(m.lastLine.bottom < m.editor.bottom - 100, `${path}: the document is not shorter than the window`);
        const y = Math.round((m.lastLine.bottom + m.editor.bottom) / 2);
        await page.mouse.click(Math.round(m.content.left + 40), y);
        const caret = await page.evaluate(() => {
          const node = window.getSelection()?.anchorNode ?? null;
          const el = node === null ? null : node.nodeType === 1 ? node : node.parentElement;
          const line = el?.closest?.('.cm-line') ?? null;
          const lines = [...document.querySelectorAll('.marxy-source-mount .cm-content > .cm-line')];
          return { index: line ? lines.indexOf(line) : -1, count: lines.length };
        });
        assert.equal(caret.index, caret.count - 1, `${path}: the caret is on line ${caret.index + 1} of ${caret.count} after a click below the text`);
        await context.close();
      }
    } finally {
      await browser.close();
    }
  });

  test(`${mode.name}: wrapping breaks at the pane's right edge; code scrolls sideways with the gutter fixed`, async () => {
    const browser = await launchWebkit();
    try {
      const prose = await boot(browser, mode, { files: { '/w/doc.md': LONG }, open: '/w/doc.md', width: 1400 });
      await openSource(prose.page);
      const [p] = await measure(prose.page);
      assert.equal(p.wraps, true, 'Markdown wraps');
      assert.ok(p.scrollWidth <= p.clientWidth + 1, `wrapped text scrolls sideways (${p.scrollWidth} > ${p.clientWidth})`);
      // The text runs to the editor's right edge (less a line box clear of the marks strip), not to a centred measure.
      const wrapped = await prose.page.evaluate(() => {
        const line = [...document.querySelectorAll('.marxy-source-mount .cm-content > .cm-line')].find((l) => l.textContent.startsWith('long line'));
        const r = line.getBoundingClientRect();
        return { rows: Math.round(r.height / parseFloat(getComputedStyle(line).lineHeight)), right: r.right };
      });
      assert.ok(wrapped.rows >= 2, '299 characters wrap at 1,400 px');
      assert.ok(wrapped.right <= p.editor.right + 0.5, 'a wrapped line stays inside the editor');
      assert.ok(p.editor.right - wrapped.right <= 24, `the wrapped line ends ${p.editor.right - wrapped.right} px short of the editor's right edge`);
      await prose.context.close();

      const code = await boot(browser, mode, { files: { '/w/doc.rs': LONG }, open: '/w/doc.rs', width: 1000 });
      await openSource(code.page);
      const [c] = await measure(code.page);
      assert.equal(c.wraps, false, 'code does not wrap');
      assert.ok(c.scrollWidth > c.clientWidth + 100, `the 299-character line makes the editor scroll (${c.scrollWidth} vs ${c.clientWidth})`);
      const scrolled = await code.page.evaluate(() => {
        const scroller = document.querySelector('.marxy-source-mount .cm-scroller');
        scroller.scrollLeft = 200;
        return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r({
          scrollLeft: scroller.scrollLeft,
          gutterLeft: document.querySelector('.marxy-source-mount .cm-gutters').getBoundingClientRect().left,
        }))));
      });
      assert.ok(scrolled.scrollLeft > 100, 'the editor scrolls sideways');
      assert.ok(Math.abs(scrolled.gutterLeft - c.gutters.left) <= 0.5, `the gutter moved from ${c.gutters.left} to ${scrolled.gutterLeft} while the text scrolled`);
      await code.context.close();
    } finally {
      await browser.close();
    }
  });

  test(`${mode.name}: with the numbers off the text starts where it does with them on, a gutter's width in from the edge`, async () => {
    const browser = await launchWebkit();
    try {
      const lefts = [];
      for (const numbers of [true, false]) {
        const { page, context } = await boot(browser, mode, { files: { '/w/doc.md': SHORT }, open: '/w/doc.md', width: 1400, numbers });
        await openSource(page);
        const [m] = await measure(page);
        assert.equal(Boolean(m.gutters), numbers, `numbers ${numbers}: gutter present`);
        lefts.push(m.firstLine.left - m.pane.left);
        await context.close();
      }
      assert.ok(Math.abs(lefts[0] - lefts[1]) <= 0.5, `the text moved when the numbers were toggled: ${lefts}`);
      assert.ok(lefts[0] < 120, `the text starts ${lefts[0]} px from the pane's edge`);
    } finally {
      await browser.close();
    }
  });

  test(`${mode.name}: unfolded Source and Split place the gutter at the pane's own edge`, async () => {
    const browser = await launchWebkit();
    try {
      const one = await boot(browser, mode, { files: { '/w/doc.md': SHORT }, open: '/w/doc.md', width: 1000, height: 800 });
      await one.page.evaluate(() => window.__marxyHandle.workspace().unfold());
      await one.page.waitForTimeout(300);
      await openSource(one.page);
      assertFills((await measure(one.page))[0], 'unfolded');
      await one.context.close();

      const split = await boot(browser, mode, { files: { '/w/doc.md': SHORT }, open: '/w/doc.md', width: 1500, height: 800 });
      await split.page.evaluate(() => window.__marxyHandle.workspace().unfold());
      await split.page.waitForTimeout(300);
      await split.page.keyboard.press('Meta+Digit2');
      await split.page.waitForSelector('.marxy-source-mount .cm-content .cm-line');
      await split.page.waitForTimeout(700);
      const editors = await measure(split.page);
      assert.equal(editors.length, 1, 'Split holds one Source half');
      assertFills(editors[0], 'split');
      await split.context.close();
    } finally {
      await browser.close();
    }
  });

  test(`${mode.name}: Rendered keeps its measure at 1,400 px`, async () => {
    const browser = await launchWebkit();
    try {
      const { page } = await boot(browser, mode, { files: { '/w/doc.md': `# Title\n\n${'A sentence of prose that runs on. '.repeat(40)}\n` }, open: '/w/doc.md', width: 1400 });
      await page.waitForSelector('#doc p');
      await page.waitForTimeout(300);
      const p = await page.evaluate(() => {
        const r = document.querySelector('#doc p').getBoundingClientRect();
        return { left: r.left, right: r.right, width: r.width };
      });
      assert.ok(p.width < 900 && p.width > 400, `Rendered's measure is ${p.width} px wide`);
      assert.ok(p.left > 150 && 1400 - p.right > 150, `Rendered's column is centred with margins (${p.left}, ${1400 - p.right})`);
    } finally {
      await browser.close();
    }
  });
}
