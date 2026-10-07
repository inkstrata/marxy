// A launch with no document (MARXY-257): the real app in Playwright WebKit through the MARXY-95
// harness, with Commonplace pieces injected so the test holds whatever the corpus (MARXY-256) holds.
// The pieces below are written for this test; they are not from the corpus.
import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { after, before, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { build } from 'vite';
import { fileURLToPath } from 'node:url';

/**
 * A job without Playwright's WebKit (CI's `fast` job) skips the browser cases and says why, unless
 * MARXY_BROWSER_TESTS_REQUIRED=1, where a missing browser is a failure as it should be.
 */
const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip }, fn);

const EM = ' ';
const LONG_LINE = 'A line written long on purpose so that it cannot fit the measure and has to turn over onto a second line, where it must hang';
const COLOPHON = 'Written for the MARXY-257 test and not taken from anywhere. This colophon runs long enough to fill more than one line at the caption size, so that the typesetter has a paragraph of prose to set on the page, which shows that it ran over the piece while leaving the verse above alone.';

const verse = [
  '---',
  'title: Test of lines',
  'author: Nobody',
  'date: "2026"',
  'form: verse',
  'languages: [en]',
  'source: "This test"',
  'rights: public-domain',
  '---',
  '',
  '# Test of lines',
  '',
  'The first line, with *italic* in it,\\',
  `${EM}indented once and carried on,\\`,
  `${EM}${EM}indented twice.`,
  '',
  '⋮',
  '',
  `${LONG_LINE}\\`,
  'and end.',
  '',
  '---',
  '',
  COLOPHON,
  '',
  'Translated for Marxy and released with it under the MIT licence.',
  '',
].join('\n');

const bilingual = [
  '---',
  'title: Zwei Sprachen',
  'form: prose',
  'languages: [de, en]',
  'rights: public-domain-original+marxy-translation',
  '---',
  '',
  '# Zwei Sprachen',
  '',
  '## Deutsch',
  '',
  'Ein Absatz auf Deutsch, für diesen Test geschrieben.',
  '',
  '## English',
  '',
  'A paragraph in English, written for this test.',
  '',
  '---',
  '',
  'Written for the MARXY-257 test.',
  '',
  'Translated for Marxy, line for line, and released with it under the MIT licence.',
  '',
].join('\n');

const code = [
  '---',
  'title: A loop',
  'form: code',
  'languages: [en]',
  '---',
  '',
  '# A loop',
  '',
  '```c',
  'for (;;) {',
  '\tputs("again");',
  '}',
  '```',
  '',
  '---',
  '',
  'Written for the MARXY-257 test.',
  '',
].join('\n');

const docMd = Buffer.from('# Opened\n\nA document the palette opened.\n').toString('base64');

const outDir = mkdtempSync(join(tmpdir(), 'marxy-frontispiece-'));
let server;
let base;
let browser;

before(async () => {
  if (skip) return;
  await build({ root: fileURLToPath(new URL('..', import.meta.url)), logLevel: 'silent', build: { outDir, emptyOutDir: true } });
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
  browser = await launchWebkit();
});
after(async () => {
  await browser?.close();
  server?.close();
});

/** A page with the app booted with no document against `pieces`; `window.__handle` is the handle. */
async function boot(pieces, { files = {}, width = 1100 } = {}) {
  const page = await browser.newPage({ viewport: { width, height: 800 } });
  await page.goto(`${base}app.html`);
  await page.waitForFunction(() => typeof window.marxyApp?.start === 'function');
  await page.evaluate(async ({ files, pieces }) => {
    const handle = await window.marxyApp.start(files, [], pieces);
    await handle.ready;
    window.__handle = handle;
  }, { files, pieces });
  return page;
}

/** Mark names, and the no_document detail, the launch has emitted so far. */
function marks(page) {
  return page.evaluate(() => {
    const calls = window.__handle.shell.calls.filter((c) => c.method === 'mark');
    return { names: calls.map((c) => c.args[0]), noDocument: calls.find((c) => c.args[0] === 'no_document')?.args[2] ?? null };
  });
}

test('a launch with no document shows a piece, emits no_document and never first_text, and opens nothing', async () => {
  const page = await boot({ 'test-of-lines': verse });
  try {
    const shown = await page.evaluate(() => {
      const h = window.__handle;
      const root = document.querySelector('#doc > .marxy-frontispiece');
      return {
        root: root !== null,
        form: root?.classList.contains('marxy-frontispiece-verse') ?? false,
        lang: root?.getAttribute('lang') ?? null,
        title: root?.querySelector('h1')?.textContent ?? '',
        hint: document.querySelector('.marxy-empty') !== null,
        path: h.currentPath(),
        source: h.sourceHarness(),
        open: h.openDocument(),
        frontMatterShown: document.querySelector('#doc dl') !== null
          || document.getElementById('doc').textContent.includes('Nobody')
          || document.getElementById('doc').textContent.includes('Translated for Marxy'),
      };
    });
    assert.deepEqual(shown, {
      root: true, form: true, lang: 'en', title: 'Test of lines', hint: false,
      path: null, source: null, open: null, frontMatterShown: false,
    });
    const { names, noDocument } = await marks(page);
    assert.ok(names.includes('no_document'), `no no_document mark: ${names.join(', ')}`);
    assert.equal(noDocument, 'piece=test-of-lines');
    for (const name of ['first_text', 'painted', 'render', 'file_read']) {
      assert.ok(!names.includes(name), `a launch with no document emitted ${name}: ${names.join(', ')}`);
    }
    const reads = await page.evaluate(() => window.__handle.shell.calls.filter((c) => (c.method === 'readFile' && c.args[0] !== '/config') || c.method === 'watch').length);
    assert.equal(reads, 0, 'the piece is not a file: nothing may be read or watched for it (config.toml aside, A-14)');
    const configReads = await page.evaluate(() => window.__handle.shell.calls.filter((c) => c.method === 'readFile' && c.args[0] === '/config').length);
    assert.equal(configReads, 1, 'config.toml is read exactly once on a launch with no document (A-14)');
    // Cmd+E has no buffer to show in Source mode.
    await page.keyboard.press('Meta+e');
    assert.equal(await page.evaluate(() => document.body.dataset.marxyMode ?? 'rendered'), 'rendered');
  } finally {
    await page.close();
  }
});

test('verse keeps every line, turns EM SPACE runs into indent levels, hangs turnovers past them, and is never typeset', async () => {
  const page = await boot({ 'test-of-lines': verse });
  try {
    // The colophon is prose: the typesetter setting it is the proof it ran over this page.
    await page.waitForFunction(() => document.querySelector('.marxy-frontispiece-colophon .marxy-set') !== null, null, { timeout: 10_000 });
    const verseState = await page.evaluate(() => {
      const stanzas = [...document.querySelectorAll('.marxy-frontispiece-page > p.marxy-verse')];
      const lines = stanzas.map((p) => [...p.children].map((span) => ({
        cls: span.className,
        // The render pass ties a short last word to the one before it; that space is not at issue here.
        text: span.textContent.replaceAll('\u00a0', ' '),
      })));
      const firstLeft = (el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        return range.getClientRects()[0].left;
      };
      const all = [...document.querySelectorAll('.marxy-verse-line')];
      const long = all.find((el) => el.textContent.startsWith('A line written long'));
      const range = document.createRange();
      range.selectNodeContents(long);
      const rows = [...range.getClientRects()].filter((r) => r.width > 0);
      const em = parseFloat(getComputedStyle(long).fontSize);
      return {
        lines,
        brs: document.querySelectorAll('.marxy-verse br').length,
        emSpaces: document.getElementById('doc').textContent.includes(' '),
        elision: document.querySelector('.marxy-frontispiece-elision')?.textContent.trim() ?? null,
        indentStep: [firstLeft(all[1]) - firstLeft(all[0]), firstLeft(all[2]) - firstLeft(all[0])].map((d) => Math.round(d / em * 100) / 100),
        rows: rows.length,
        depth: document.querySelector('.marxy-frontispiece').classList.contains('marxy-verse-depth-2'),
        hang: Math.round((rows[rows.length - 1].left - rows[0].left) / em * 100) / 100,
        setInVerse: document.querySelectorAll('.marxy-verse .marxy-set, .marxy-verse .marxy-lb, .marxy-verse .marxy-hang').length,
        style: (() => {
          const cs = getComputedStyle(stanzas[0]);
          return { align: cs.textAlign, hyphens: cs.webkitHyphens || cs.hyphens };
        })(),
      };
    });
    assert.deepEqual(verseState.lines, [
      [
        { cls: 'marxy-verse-line', text: 'The first line, with italic in it,' },
        { cls: 'marxy-verse-line marxy-verse-indent-1', text: 'indented once and carried on,' },
        { cls: 'marxy-verse-line marxy-verse-indent-2', text: 'indented twice.' },
      ],
      [
        { cls: 'marxy-verse-line', text: LONG_LINE },
        { cls: 'marxy-verse-line', text: 'and end.' },
      ],
    ]);
    assert.equal(verseState.brs, 0, 'a <br> left between block lines draws a blank line');
    assert.equal(verseState.emSpaces, false, 'an EM SPACE reached the page instead of becoming an indent');
    assert.equal(verseState.elision, '⋮');
    assert.deepEqual(verseState.indentStep, [1, 2], 'each indent level is 1em');
    assert.ok(verseState.rows >= 2, 'the long line was meant to turn over at this width');
    // The poem indents two levels deep, so a turnover hangs at 3em: past every indented line.
    assert.equal(verseState.depth, true);
    assert.equal(verseState.hang, 3, 'a turned-over line hangs 1em deeper than the deepest indent');
    assert.equal(verseState.setInVerse, 0, 'the typesetter set verse');
    assert.equal(verseState.style.align, 'start');
    assert.equal(verseState.style.hyphens, 'manual');
    const colophon = await page.evaluate(() => {
      const el = document.querySelector('.marxy-frontispiece-colophon');
      const hr = document.querySelector('.marxy-frontispiece-page > hr');
      const body = getComputedStyle(document.querySelector('.marxy-verse'));
      const cs = getComputedStyle(el);
      return {
        afterRule: el.previousElementSibling === hr,
        // Tied short last words and typesetter hyphens aside, the colophon is the text after the rule.
        text: el.textContent.replace(/[\u00a0\s]+/g, ' ').replaceAll('\u00ad', '').trim(),
        smaller: parseFloat(cs.fontSize) < parseFloat(body.fontSize),
        secondary: cs.color !== body.color,
        ruleShown: getComputedStyle(hr).display !== 'none',
      };
    });
    assert.deepEqual(colophon, { afterRule: true, text: COLOPHON, smaller: true, secondary: true, ruleShown: false });
  } finally {
    await page.close();
  }
});

test('in a poem with no indents a turnover hangs the familiar 1em', async () => {
  const flat = ['---', 'form: verse', 'languages: [en]', '---', '', '# Flat', '', `${LONG_LINE}\\`, 'and end.', ''].join('\n');
  const page = await boot({ flat });
  try {
    const hang = await page.evaluate(() => {
      const line = document.querySelector('.marxy-verse-line');
      const range = document.createRange();
      range.selectNodeContents(line);
      const rows = [...range.getClientRects()].filter((r) => r.width > 0);
      const em = parseFloat(getComputedStyle(line).fontSize);
      return { rows: rows.length, hang: Math.round((rows[rows.length - 1].left - rows[0].left) / em * 100) / 100, depth: [...document.querySelector('.marxy-frontispiece').classList].filter((c) => c.startsWith('marxy-verse-depth')) };
    });
    assert.ok(hang.rows >= 2, 'the long line was meant to turn over at this width');
    assert.deepEqual({ hang: hang.hang, depth: hang.depth }, { hang: 1, depth: [] });
  } finally {
    await page.close();
  }
});

test('two languages sit side by side on a wide window, stacked on a narrow one, each with its lang', async () => {
  const page = await boot({ 'zwei-sprachen': bilingual }, { width: 1500 });
  try {
    const layout = () => page.evaluate(() => {
      const sections = [...document.querySelectorAll('.marxy-frontispiece-parallel > .marxy-frontispiece-lang')];
      const boxes = sections.map((s) => s.getBoundingClientRect());
      return {
        langs: sections.map((s) => [s.lang, s.dir, s.querySelector('h2') !== null, s.textContent.replaceAll('\u00a0', ' ').trim()]),
        notice: document.getElementById('doc').textContent.includes('Translated for Marxy'),
        head: document.querySelector('#doc dl') !== null,
        sideBySide: boxes.length === 2 && Math.abs(boxes[0].top - boxes[1].top) < 1 && boxes[1].left > boxes[0].right,
        stacked: boxes.length === 2 && boxes[1].top >= boxes[0].bottom && Math.abs(boxes[0].left - boxes[1].left) < 1,
        // The pair is centred in the article, and the title starts on the first column's left edge.
        centred: (() => {
          const article = document.getElementById('doc').getBoundingClientRect();
          const left = Math.min(...boxes.map((b) => b.left)) - article.left;
          const right = article.right - Math.max(...boxes.map((b) => b.right));
          const title = document.querySelector('.marxy-frontispiece-page > h1').getBoundingClientRect();
          return left > 16 && Math.abs(left - right) <= 2 && Math.abs(title.left - boxes[0].left) <= 1;
        })(),
      };
    });
    const wide = await layout();
    assert.deepEqual(wide.langs, [
      ['de', 'ltr', false, 'Ein Absatz auf Deutsch, für diesen Test geschrieben.'],
      ['en', 'ltr', false, 'A paragraph in English, written for this test.'],
    ]);
    assert.equal(wide.notice, false, 'the translation line is metadata, not the text');
    assert.equal(wide.head, false, 'front matter is metadata, not the text');
    assert.equal(wide.sideBySide, true, 'two languages on a 1500 px window should be side by side');
    assert.equal(wide.centred, true, 'short parallel text should sit centred, not against the left edge');
    await page.setViewportSize({ width: 640, height: 800 });
    const narrow = await layout();
    assert.equal(narrow.stacked, true, 'two languages on a 640 px window should be stacked');
  } finally {
    await page.close();
  }
});

test('the colophon is set by the typesetter but never hyphenated: it is names and titles', async () => {
  // Long words on a narrow window, so a hyphenating typesetter would have to break some of them.
  const words = 'Internationalization responsibility Clarendon demonstration Isabella extraordinarily Robertson interdisciplinary Metropolitan characteristically';
  const piece = verse.replace(COLOPHON, `${words} ${words} ${words}.`);
  const page = await boot({ 'test-of-lines': piece }, { width: 420 });
  try {
    await page.waitForFunction(() => document.querySelector('.marxy-frontispiece-colophon .marxy-set') !== null, null, { timeout: 10_000 });
    const state = await page.evaluate(() => ({
      hyphens: document.querySelectorAll('.marxy-frontispiece-colophon .marxy-hyphen').length,
      style: getComputedStyle(document.querySelector('.marxy-frontispiece-colophon')).hyphens,
    }));
    assert.deepEqual(state, { hyphens: 0, style: 'none' });
  } finally {
    await page.close();
  }
});

test('a code piece renders its fence as a code block', async () => {
  const page = await boot({ 'a-loop': code });
  try {
    const pre = await page.evaluate(() => {
      const el = document.querySelector('.marxy-frontispiece-code pre > code');
      return el ? { lang: el.className, text: el.textContent } : null;
    });
    assert.ok(pre, 'no code block in the frontispiece');
    assert.match(pre.lang, /language-c\b/);
    assert.equal(pre.text, 'for (;;) {\n\tputs("again");\n}\n');
  } finally {
    await page.close();
  }
});

test('with no pieces the launch shows the one-line hint, as before', async () => {
  const page = await boot({});
  try {
    const state = await page.evaluate(() => ({
      hint: document.querySelector('#doc > p.marxy-empty')?.textContent ?? null,
      frontispiece: document.querySelector('.marxy-frontispiece') !== null,
    }));
    assert.deepEqual(state, { hint: 'Open a markdown file: marxy README.md', frontispiece: false });
    const { names, noDocument } = await marks(page);
    assert.ok(names.includes('no_document'));
    assert.equal(noDocument, null);
    assert.ok(!names.includes('first_text'));
  } finally {
    await page.close();
  }
});

test('an open replaces the piece with the document and leaves one typesetter', async () => {
  const page = await boot({ 'test-of-lines': verse }, { files: { '/docs/opened.md': docMd } });
  try {
    const after = await page.evaluate(async () => {
      const h = window.__handle;
      const widthBefore = getComputedStyle(document.getElementById('doc')).maxWidth;
      await h.open('/docs/opened.md');
      return {
        path: h.currentPath(),
        frontispiece: document.querySelector('.marxy-frontispiece') !== null,
        heading: document.querySelector('#doc h1')?.textContent ?? '',
        counts: h.debugCounts(),
        widthKept: getComputedStyle(document.getElementById('doc')).maxWidth === widthBefore,
      };
    });
    assert.deepEqual(after, {
      path: '/docs/opened.md',
      frontispiece: false,
      heading: 'Opened',
      counts: { typesetters: 1, resizeObservers: 1 },
      widthKept: true,
    });
  } finally {
    await page.close();
  }
});
