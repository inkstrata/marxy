// Typeset defaults in the app readers open (MARXY-137): hyphenation and left-edge hanging
// follow the package defaults, proven through the MARXY-95 harness rather than the typeset one.
import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { after, before, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { build } from 'vite';

/**
 * A job without Playwright's WebKit (CI's `fast` job) skips the browser cases and says why, unless
 * MARXY_BROWSER_TESTS_REQUIRED=1, where a missing browser is a failure as it should be.
 */
const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip }, fn);

const repoRoot = new URL('../../../', import.meta.url).pathname;
const longTechnical = readFileSync(join(repoRoot, 'fixtures', 'corpus', '01-long-technical.md'));
const outDir = mkdtempSync(join(tmpdir(), 'marxy-typeset-defaults-'));
let server;
let base;

before(async () => {
  if (skip) return;
  await build({ root: new URL('..', import.meta.url).pathname, logLevel: 'silent', build: { outDir, emptyOutDir: true } });
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

/** Normalised attach() option literals from a source file (app.ts or headless.ts). */
function attachOptionsFrom(src) {
  const match = src.match(/attach\(article, \{([^}]+)\}\)/);
  assert.ok(match, 'source still calls attach(article, { … })');
  return match[1].replace(/\s+/g, ' ').trim();
}

function attachOptionsApp() {
  return attachOptionsFrom(readFileSync(join(repoRoot, 'apps', 'desktop', 'src', 'app.ts'), 'utf8'));
}

function attachOptionsHeadless() {
  const src = readFileSync(join(repoRoot, 'apps', 'desktop', 'src', 'render', 'headless.ts'), 'utf8');
  assert.doesNotMatch(src, /hyphenate and hanging stay\s*\n\s*off until MARXY-24/, 'stale MARXY-24 comment must be gone from headless.ts');
  return attachOptionsFrom(src);
}

async function startDoc(page, files, argv) {
  await page.goto(`${base}app.html`);
  await page.waitForFunction(() => typeof window.marxyApp?.start === 'function');
  return page.evaluate(async ({ files, argv }) => {
    const handle = await window.marxyApp.start(files, argv);
    await handle.ready;
    return handle.shell.calls.filter((c) => c.method === 'mark').map((c) => ({ name: c.args[0], data: c.args[2] }));
  }, { files, argv });
}

test('app.ts and headless.ts pass attach() the same option set', () => {
  const app = attachOptionsApp();
  const headless = attachOptionsHeadless();
  const keys = (opts) => [...opts.matchAll(/(\w+):/g)].map((m) => m[1]).sort();
  assert.deepEqual(keys(app), keys(headless), 'attach() property names must match');
  for (const opts of [app, headless]) {
    assert.doesNotMatch(opts, /\bhyphenate\b/);
    assert.doesNotMatch(opts, /\bhanging\b/);
    assert.match(opts, /glueStretchEm:\s*0\.6/);
    assert.match(opts, /lastLineMinWidth:\s*0\.33/);
    assert.match(opts, /onPass:/);
  }
});

test('app.ts attach() does not pass hyphenate or hanging, and no other argument changes', () => {
  const opts = attachOptionsApp();
  assert.doesNotMatch(opts, /\bhyphenate\b/, 'hyphenate must not be passed; the package default is true');
  assert.doesNotMatch(opts, /\bhanging\b/, "hanging must not be passed; the package default is 'left'");
  assert.match(opts, /\blineBox\b/);
  assert.match(opts, /glueStretchEm:\s*0\.6/);
  assert.match(opts, /lastLineMinWidth:\s*0\.33/);
  assert.match(opts, /onPass:\s*\(\)\s*=>\s*snap\(article\)/);
});

test('01-long-technical.md through the app ends a line on the generated hyphen, which is not selectable text', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 800 } });
    const marks = await startDoc(page, { '/doc/01-long-technical.md': longTechnical.toString('base64') }, ['/doc/01-long-technical.md']);
    const result = await page.evaluate(() => {
      const hyphens = [...document.querySelectorAll('.marxy-lb.marxy-hyphen')];
      const first = hyphens[0];
      let selected = null;
      if (first !== undefined) {
        const range = document.createRange();
        range.selectNode(first);
        getSelection().removeAllRanges();
        getSelection().addRange(range);
        selected = getSelection().toString();
        getSelection().removeAllRanges();
      }
      const painted = first !== undefined && [...first.getClientRects()].some((r) => r.width > 0);
      const before = first ? getComputedStyle(first, '::before').content : '';
      return {
        hyphenCount: hyphens.length,
        empty: first?.textContent === '',
        selected,
        painted,
        before,
      };
    });
    const writes = marks.filter((m) => m.name === 'error');
    assert.equal(writes.length, 0, 'the document must paint without error');
    const viewport = marks.find((m) => m.name === 'typeset_viewport');
    const viewportMs = Number(/ms=([\d.]+)/.exec(String(viewport?.data ?? ''))?.[1]);
    assert.ok(Number.isFinite(viewportMs) && viewportMs < 100, `typeset_viewport ${viewportMs} ms must stay under 100`);
    assert.ok(result.hyphenCount > 0, `expected a generated hyphen on 01-long-technical.md, got ${result.hyphenCount}`);
    assert.equal(result.empty, true, 'the hyphen span is empty: the glyph is generated content, not a document byte');
    assert.equal(result.selected, '', `selecting the hyphen span must yield no text, got ${JSON.stringify(result.selected)}`);
    assert.equal(result.painted, true, 'the generated hyphen at the line end must be visible');
    assert.match(result.before, /-/);
  } finally {
    await browser.close();
  }
});

test('a hanging quote sits left of the measure; a letter-started line does not', async () => {
  const quoted = [
    '"When the ice finally let go of the harbour wall the whole town seemed to exhale, and the first boats nosed out toward a horizon that had been a rumour all winter, carrying the same stores they had carried every spring and the same arguments about weather."',
    '',
    'Some ordinary sentences begin with a letter and sit flush with the measure even when the typesetter has broken the paragraph into several lines of body text long enough that a later line might also start with a letter rather than a quote.',
  ].join('\n');
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 800 } });
    await startDoc(page, { '/doc/hang.md': Buffer.from(quoted).toString('base64') }, ['/doc/hang.md']);
    const result = await page.evaluate(() => {
      const article = document.getElementById('doc');
      const paragraphs = [...article.querySelectorAll('p.marxy-set')];
      const edge = (p) => {
        const cs = getComputedStyle(p);
        return p.getBoundingClientRect().left + parseFloat(cs.paddingLeft) + parseFloat(cs.borderLeftWidth);
      };
      const firstGrapheme = (p) => {
        const hang = p.querySelector('.marxy-hang');
        if (hang !== null) {
          const range = document.createRange();
          range.selectNodeContents(hang);
          const rects = [...range.getClientRects()].filter((r) => r.width > 0);
          return { text: hang.textContent, left: rects[0]?.left ?? hang.getBoundingClientRect().left };
        }
        const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
          const i = /\S/.exec(node.data);
          if (i === null) continue;
          const range = document.createRange();
          range.setStart(node, i.index);
          range.setEnd(node, i.index + 1);
          const rects = [...range.getClientRects()].filter((r) => r.width > 0);
          return { text: node.data[i.index], left: rects[0]?.left ?? edge(p) };
        }
        return { text: '', left: edge(p) };
      };
      const quoteP = paragraphs.find((p) => /^[“"]/.test(p.textContent ?? ''));
      const letterP = paragraphs.find((p) => /^\p{L}/u.test((p.textContent ?? '').trim()));
      if (!quoteP || !letterP) return { found: false, quote: null, letter: null };
      const quote = firstGrapheme(quoteP);
      const letter = firstGrapheme(letterP);
      return {
        found: true,
        quote: { text: quote.text, delta: edge(quoteP) - quote.left },
        letter: { text: letter.text, delta: edge(letterP) - letter.left },
      };
    });
    assert.equal(result.found, true, 'expected a quoted paragraph and a letter-started paragraph after typeset');
    assert.match(result.quote.text, /[“"]/);
    assert.ok(result.quote.delta > 0, `quoted first grapheme must sit left of the measure (delta ${result.quote.delta})`);
    assert.match(result.letter.text, /^\p{L}/u);
    // Subpixel range-vs-padding noise is not hanging; quotes hang by a glyph's worth.
    assert.ok(result.letter.delta < 1, `letter-started line must not protrude (delta ${result.letter.delta})`);
    assert.ok(result.quote.delta > result.letter.delta + 2, `quote hang ${result.quote.delta} must exceed letter ${result.letter.delta}`);
  } finally {
    await browser.close();
  }
});
