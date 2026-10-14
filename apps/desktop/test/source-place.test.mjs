// Source's place and rows (V-12, ADR-0067; L-07's column): the numbers share their rows' tops, a code line scrolls and
// a Markdown line hangs, the text sits on the window's axis with the numbers hung left of it, on the page ground.
import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { after, before, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { build } from 'vite';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip }, fn);

const repoRoot = new URL('../../../', import.meta.url).pathname;
const appRoot = join(repoRoot, 'apps', 'desktop');
const outDir = mkdtempSync(join(tmpdir(), 'marxy-source-place-'));
let server;
let base;

before(async () => {
  if (skip) return;
  await build({ root: appRoot, logLevel: 'silent', build: { outDir, emptyOutDir: true } });
  const types = { '.html': 'text/html', '.ttf': 'font/ttf', '.js': 'text/javascript', '.txt': 'text/plain', '.css': 'text/css' };
  server = createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const path = join(outDir, pathname.endsWith('/') ? `${pathname}index.html` : pathname);
    if (!existsSync(path)) { res.statusCode = 404; return res.end(); }
    res.setHeader('Content-Type', types[extname(path)] ?? 'application/octet-stream');
    res.end(readFileSync(path));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}/`;
});
after(() => server?.close());

/** A Python file the first 200 lines of which hold what grows a row: a 300-character line, emoji, CJK, a tab, box drawing and a byte that is not UTF-8. */
function python() {
  const out = ['"""A module."""', 'import os', ''];
  for (let i = 0; i < 70; i++) out.push(`def f${i}(a, b):`, `    # note ${i}`, `    return a + b * ${i}`, '');
  out[10] = 'LONG = "' + 'abcdefghi '.repeat(30) + '"';
  out[20] = 'EMOJI = "😀 🎉 ✨ 🚀 ok"  # 😀';
  out[30] = 'CJK = "日本語のテキストと中文字符和한국어"  # 日本語';
  out[40] = '\tprint("tab")   # box ┌──┐ │ └──┘';
  const head = out.slice(0, 50).join('\n') + '\n# stray ';
  const tail = '\n' + out.slice(51).join('\n') + '\n';
  return Buffer.concat([Buffer.from(head), Buffer.from([0xe9]), Buffer.from(tail)]);
}

const MD = [
  '# A title',
  '',
  'A long Markdown paragraph that wraps across several rows of the editor, because it is longer than one column of text. '.repeat(4),
  '',
  '- a list item that is long enough to wrap onto a second row of the editor, and then a third, so the hang can be measured, and then a fourth row as well',
  '    - a nested item that is long enough to wrap onto a second row of the editor, and then a third, so the hang can be measured, and a fourth too',
  '',
].join('\n');

const TS_LONG = ['export const a = 1;', `export const long = "${'word '.repeat(60)}";`, 'export const b = 2;', ''].join('\n');

async function boot(page, path, body) {
  await page.goto(`${base}app.html`);
  await page.waitForFunction(() => typeof window.marxyApp?.start === 'function');
  await page.evaluate(async ({ files, argv }) => {
    const handle = await window.marxyApp.start(files, argv);
    await handle.ready;
    window.__marxyHandle = handle;
  }, { files: { [path]: Buffer.from(body).toString('base64') }, argv: [path] });
}

const sourceReady = async (page) => {
  await page.waitForSelector('#marxy-source .cm-editor .cm-line');
  await page.evaluate(() => document.fonts.ready);
};

const setVariant = (page, variant) => page.evaluate((v) => document.documentElement.setAttribute('data-marxy-variant', v), variant);

/** What a CSS colour computes to, resolved in the page the way the editor resolves it. */
const colourOf = (page, css) => page.evaluate((c) => {
  const el = document.createElement('i');
  el.style.color = c;
  document.body.appendChild(el);
  const v = getComputedStyle(el).color;
  el.remove();
  return v;
}, css);

test('V-12 every row is one line box, and each number shares its row\'s top, over a long line, emoji, CJK, a tab and a stray byte', async () => {
  const browser = await launchWebkit();
  try {
    // Tall, so the editor draws the first 200 lines without scrolling.
    const page = await browser.newPage({ viewport: { width: 1280, height: 4800 } });
    await boot(page, '/src/a.py', python());
    await sourceReady(page);
    const seen = await page.evaluate(() => {
      const line = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--marxy-line-box-source'));
      const lines = [...document.querySelectorAll('#marxy-source .cm-line')].slice(0, 200);
      const tops = lines.map((l) => l.getBoundingClientRect().top);
      const numbers = [...document.querySelectorAll('#marxy-source .cm-lineNumbers .cm-gutterElement')].filter((e) => e.style.visibility !== 'hidden');
      const folds = [...document.querySelectorAll('#marxy-source .cm-foldGutter .cm-gutterElement')].filter((e) => e.style.visibility !== 'hidden');
      return {
        line,
        count: lines.length,
        numbers: numbers.length,
        rows: lines.map((l, i) => [i + 1, l.getBoundingClientRect().height]).filter(([, h]) => Math.abs(h - line) > 0.01),
        drift: lines.map((l, i) => [i + 1, numbers[i] ? numbers[i].getBoundingClientRect().top - l.getBoundingClientRect().top : NaN]).filter(([, d]) => !(Math.abs(d) <= 0.5)),
        // A fold marker exists only for a line that folds: each one sits on the top of some line.
        foldDrift: folds.filter((f) => f.textContent !== '').map((f) => f.getBoundingClientRect().top).filter((t) => !tops.some((top) => Math.abs(top - t) <= 0.5)),
        folds: folds.filter((f) => f.textContent !== '').length,
        marker: document.querySelectorAll('#marxy-source .marxy-stray-byte').length,
        text: lines.slice(0, 12).map((l) => l.textContent.slice(0, 12)),
      };
    });
    assert.ok(Number.isFinite(seen.line) && seen.line > 0, 'Source has a line box token of its own');
    assert.ok(seen.count >= 200, `the first 200 lines are drawn (${seen.count})`);
    assert.ok(seen.numbers >= 200, `a number for each (${seen.numbers})`);
    assert.equal(seen.marker, 1, 'the stray byte is shown as a marker, inside the fixture\'s first lines');
    assert.deepEqual(seen.rows, [], `every row is exactly one line box (${seen.line}px), none taller`);
    assert.deepEqual(seen.drift, [], 'every number\'s top is its line\'s top');
    assert.ok(seen.folds > 20, `the file has fold markers (${seen.folds})`);
    assert.deepEqual(seen.foldDrift, [], 'every fold marker\'s top is a line\'s top');
  } finally {
    await browser.close();
  }
});

test('V-12 a code line does not wrap: it scrolls inside the editor, and the numbers stay on the left', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 800 } });
    await boot(page, '/src/a.ts', TS_LONG);
    await sourceReady(page);
    const m = await page.evaluate(() => {
      const lines = [...document.querySelectorAll('#marxy-source .cm-line')];
      const scroller = document.querySelector('#marxy-source .cm-scroller');
      return {
        heights: lines.map((l) => l.getBoundingClientRect().height),
        line: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--marxy-line-box-source')),
        wide: scroller.scrollWidth > scroller.clientWidth,
        wraps: Boolean(document.querySelector('#marxy-source .cm-lineWrapping')),
      };
    });
    assert.equal(m.wraps, false, 'a code file has no wrapping class');
    assert.ok(m.heights.length >= 3);
    for (const h of m.heights) assert.equal(h, m.line, 'a 300-character line is one row');
    assert.ok(m.wide, 'the editor scrolls sideways');
    await page.evaluate(() => { document.querySelector('#marxy-source .cm-scroller').scrollLeft = 400; });
    await page.waitForFunction(() => document.querySelector('#marxy-source .cm-scroller').scrollLeft > 100);
    const pinned = await page.evaluate(() => {
      const g = document.querySelector('#marxy-source .cm-gutters').getBoundingClientRect();
      const s = document.querySelector('#marxy-source .cm-scroller').getBoundingClientRect();
      return { gutter: g.left, scroller: s.left, bg: getComputedStyle(document.querySelector('#marxy-source .cm-gutters')).backgroundColor };
    });
    assert.ok(Math.abs(pinned.gutter - pinned.scroller) <= 0.5, `the gutter stays at the editor's left edge (${pinned.gutter} vs ${pinned.scroller})`);
    assert.notEqual(pinned.bg, 'rgba(0, 0, 0, 0)', 'the gutter has a ground, so text scrolls under it, not through it');
  } finally {
    await browser.close();
  }
});

test('V-12 (F-100) a Markdown line wraps at the editor\'s right edge, with its continuation hung past its own indent', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 640, height: 900 } });
    await boot(page, '/doc/a.md', MD);
    await page.waitForSelector('#doc .marxy-article, #doc');
    await page.keyboard.press('Meta+E');
    await sourceReady(page);
    const m = await page.evaluate(() => {
      const content = document.querySelector('#marxy-source .cm-content');
      const c = content.getBoundingClientRect();
      const e = document.querySelector('#marxy-source .cm-editor').getBoundingClientRect();
      const ch = parseFloat(getComputedStyle(content).fontSize) * 0.6;
      /** The rows of one line: each client rect of its text, merged by top. */
      const rows = (line) => {
        const range = document.createRange();
        range.selectNodeContents(line);
        const tops = new Map();
        for (const r of range.getClientRects()) {
          const key = Math.round(r.top);
          const row = tops.get(key) ?? { left: Infinity, right: -Infinity };
          row.left = Math.min(row.left, r.left);
          row.right = Math.max(row.right, r.right);
          tops.set(key, row);
        }
        return [...tops.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
      };
      const lines = [...document.querySelectorAll('#marxy-source .cm-line')];
      const pick = (needle) => lines.find((l) => l.textContent.includes(needle));
      return {
        ch,
        content: { left: c.left, right: c.right, width: c.width },
        editor: { left: e.left, right: e.right },
        paragraph: rows(pick('A long Markdown paragraph')),
        item: rows(pick('a list item')),
        nested: rows(pick('a nested item')),
      };
    });
    // Source fills its pane (F-100): the text runs from a gutter's width in (84 px at 14 px) to the editor's right edge, not to Rendered's measure.
    assert.ok(Math.abs(m.content.left - (m.editor.left + 84)) <= 1, `the text starts a gutter's width in (${m.content.left - m.editor.left})`);
    assert.ok(Math.abs(m.content.right - m.editor.right) <= 1, `the column runs to the editor's right edge (${m.content.right} vs ${m.editor.right})`);
    for (const [name, rows, indent] of [['paragraph', m.paragraph, 0], ['list item', m.item, 0], ['nested item', m.nested, 4]]) {
      assert.ok(rows.length >= 3, `${name} wraps onto several rows (${rows.length})`);
      assert.ok(Math.abs(rows[0].left - m.content.left) <= 0.5, `${name}: the first row starts at the text's edge`);
      for (const row of rows) assert.ok(row.right <= m.editor.right + 0.5, `${name}: no row runs past the editor`);
      for (const row of rows.slice(1)) {
        assert.ok(Math.abs(row.left - (m.content.left + (indent + 2) * m.ch)) <= 1, `${name}: a continuation hangs ${indent + 2} columns past the column's edge, got ${(row.left - m.content.left) / m.ch}`);
      }
    }
  } finally {
    await browser.close();
  }
});

test('V-12 (F-100) the Markdown text starts a gutter in from the pane\'s edge with numbers on or off, at any width; the numbers hang left of it', async () => {
  const browser = await launchWebkit();
  try {
    const starts = [];
    for (const width of [960, 1280]) {
      const page = await browser.newPage({ viewport: { width, height: 800 } });
      await boot(page, '/doc/a.md', MD);
      await page.keyboard.press('Meta+E');
      await sourceReady(page);
      const place = () => page.evaluate(() => {
        const c = document.querySelector('#marxy-source .cm-content').getBoundingClientRect();
        const e = document.querySelector('#marxy-source .cm-editor').getBoundingClientRect();
        const g = document.querySelector('#marxy-source .cm-gutters')?.getBoundingClientRect() ?? null;
        const numbers = [...document.querySelectorAll('#marxy-source .cm-lineNumbers .cm-gutterElement')].filter((n) => n.style.visibility !== 'hidden');
        return {
          left: c.left - e.left,
          right: e.right - c.right,
          gutterLeft: g ? g.left - e.left : null,
          gutterRight: g ? g.right : null,
          numberRight: numbers.length ? Math.max(...numbers.map((n) => n.getBoundingClientRect().right)) : null,
          abs: c.left,
        };
      });
      const off = await place();
      assert.equal(off.gutterRight, null, 'Markdown opens without numbers');
      assert.ok(Math.abs(off.left - 84) <= 1, `${width}: the text starts a gutter's width in with numbers off (${off.left})`);
      assert.ok(Math.abs(off.right) <= 1, `${width}: and runs to the editor's right edge (${off.right})`);
      await page.evaluate(() => window.marxyRunCommand('view.toggle-line-numbers'));
      await page.waitForSelector('#marxy-source .cm-lineNumbers');
      const on = await place();
      assert.equal(on.left, off.left, `${width}: turning the numbers on does not move the text`);
      assert.ok(Math.abs(on.gutterLeft) <= 0.5, `${width}: the gutter is at the editor's left edge (${on.gutterLeft})`);
      assert.ok(on.gutterRight <= on.abs + 0.01, `${width}: the gutter ends at the text's left edge (${on.gutterRight} vs ${on.abs})`);
      assert.ok(on.numberRight <= on.abs + 0.01, `${width}: the numbers are at or left of the text`);
      starts.push(on.left);
      await page.close();
    }
    assert.equal(starts[0], starts[1], 'the text starts at the same place at both widths: no centred column');
  } finally {
    await browser.close();
  }
});

test('V-12 (F-100) a code file fills the editor: the gutter at its left edge, the text a gutter in, whatever the digits or the width', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await boot(page, '/src/a.ts', 'export const a = 1;\n'.repeat(12));
    await sourceReady(page);
    const read = (p) => p.evaluate(() => {
      const c = document.querySelector('#marxy-source .cm-content').getBoundingClientRect();
      const e = document.querySelector('#marxy-source .cm-editor').getBoundingClientRect();
      const g = document.querySelector('#marxy-source .cm-gutters').getBoundingClientRect();
      return { text: c.left - e.left, gutter: g.left - e.left, gutterRight: g.right, left: c.left, right: e.right - c.right };
    });
    const m = await read(page);
    // The old column was 100 characters wide and centred on the window; now nothing is centred and nothing is capped.
    assert.ok(Math.abs(m.gutter) <= 0.5, `the gutter is at the editor's left edge (${m.gutter})`);
    assert.ok(Math.abs(m.text - 84) <= 1, `the text starts one gutter in (5 digits and a line box each side: 84 px at 14 px), got ${m.text}`);
    assert.ok(Math.abs(m.right) <= 1, `the text runs to the editor's right edge (${m.right})`);
    assert.ok(m.gutterRight <= m.left + 0.01, 'the numbers end where the text begins');
    // A wider window moves only the right edge; a smaller Source size moves nothing the gutter's width does not.
    await page.setViewportSize({ width: 1800, height: 800 });
    await page.waitForTimeout(400);
    const wider = await read(page);
    assert.ok(Math.abs(wider.text - m.text) <= 0.5 && Math.abs(wider.gutter) <= 0.5, `a wider window does not move the text or the gutter (${wider.text}, ${wider.gutter})`);
    // A file with a thousand lines has four digits; the text does not move for them.
    const wide = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await boot(wide, '/src/b.ts', 'export const a = 1;\n'.repeat(1200));
    await sourceReady(wide);
    const left = await wide.evaluate(() => document.querySelector('#marxy-source .cm-content').getBoundingClientRect().left);
    assert.equal(left, m.left, 'four digits take no more room than two');
  } finally {
    await browser.close();
  }
});

test('V-12 (L-07) Source is on the page ground in both variants, numbers included', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 800 } });
    await boot(page, '/src/a.ts', TS_LONG);
    await sourceReady(page);
    const bgs = new Set();
    for (const variant of ['dark', 'light']) {
      await setVariant(page, variant);
      const want = await colourOf(page, 'var(--marxy-color-bg)');
      await page.waitForFunction((w) => getComputedStyle(document.querySelector('#marxy-source .cm-editor')).backgroundColor === w, want);
      const seen = await page.evaluate(() => ({
        editor: getComputedStyle(document.querySelector('#marxy-source .cm-editor')).backgroundColor,
        gutters: getComputedStyle(document.querySelector('#marxy-source .cm-gutters')).backgroundColor,
      }));
      assert.equal(seen.editor, want, `${variant}: the editor`);
      assert.equal(seen.gutters, want, `${variant}: the gutters`);
      bgs.add(want);
    }
    assert.equal(bgs.size, 2, 'the two variants have two grounds');
  } finally {
    await browser.close();
  }
});
