// Source mode looks (L-06): the palette, the grid, the active line, the live theme, the search panel.
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
const outDir = mkdtempSync(join(tmpdir(), 'marxy-source-looks-'));
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

const TS = [
  'export function greet(name: string): number {',
  '  // say hello',
  '  const text = "hello";',
  '  return 42;',
  '}',
  '',
].join('\n');
/** What the appearance commands do to the root (`applyReaderConfig`), without the config write. */
const setVariant = (page, variant) => page.evaluate((v) => document.documentElement.setAttribute('data-marxy-variant', v), variant);

const MD = '# Title\n\nSome `inline` code and a [link](https://example.com).\n\n- item\n';

async function boot(page, path, body) {
  await page.goto(`${base}app.html`);
  await page.waitForFunction(() => typeof window.marxyApp?.start === 'function');
  await page.evaluate(async ({ files, argv }) => {
    const handle = await window.marxyApp.start(files, argv);
    await handle.ready;
    window.__marxyHandle = handle;
  }, { files: { [path]: Buffer.from(body).toString('base64') }, argv: [path] });
  await page.waitForSelector('#marxy-source .cm-editor .cm-line');
  await page.evaluate(() => document.fonts.ready);
}

/** Computed colour of what `css` paints, resolved in the page the way the editor resolves it. */
const probe = `(css, prop) => {
  const el = document.createElement('i');
  el.style[prop] = css;
  document.body.appendChild(el);
  const v = getComputedStyle(el)[prop];
  el.remove();
  return v;
}`;

const tokenColour = (text) => `(() => {
  const probe = ${probe};
  const spans = [...document.querySelectorAll('#marxy-source .cm-line span')];
  const el = spans.find((s) => s.textContent === ${JSON.stringify(text)});
  return el ? { got: getComputedStyle(el).color, text: getComputedStyle(document.querySelector('#marxy-source .cm-content')).color } : null;
})()`;

async function expectToken(page, text, tokenVar) {
  const want = await page.evaluate(`(${probe})('var(${tokenVar})', 'color')`);
  const seen = await page.evaluate(tokenColour(text));
  assert.ok(seen, `no token span with text ${text}`);
  assert.equal(seen.got, want, `${text} should carry ${tokenVar}`);
}

test('L-06.1 Source tokens carry the --marxy-tok-* colours (TypeScript and Markdown, both variants)', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 800 } });
    await boot(page, '/src/a.ts', TS);
    const lightStrings = [];
    for (const variant of ['dark', 'light']) {
      await setVariant(page, variant);
      await expectToken(page, '"hello"', '--marxy-tok-string');
      await expectToken(page, '42', '--marxy-tok-number');
      await expectToken(page, '// say hello', '--marxy-tok-comment');
      await expectToken(page, 'greet', '--marxy-tok-function');
      lightStrings.push(await page.evaluate(`(${probe})('var(--marxy-tok-string)', 'color')`));
    }
    // The two variants differ for strings, so the checks above are not satisfied by one fixed colour.
    assert.notEqual(lightStrings[0], lightStrings[1]);

    const page2 = await browser.newPage({ viewport: { width: 960, height: 800 } });
    await page2.goto(`${base}app.html`);
    await page2.waitForFunction(() => typeof window.marxyApp?.start === 'function');
    await page2.evaluate(async ({ files, argv }) => {
      const handle = await window.marxyApp.start(files, argv);
      await handle.ready;
    }, { files: { '/doc/a.md': Buffer.from(MD).toString('base64') }, argv: ['/doc/a.md'] });
    await page2.keyboard.press('Meta+E');
    await page2.waitForSelector('#marxy-source .cm-editor .cm-line');
    await expectToken(page2, 'inline', '--marxy-tok-string');
    await expectToken(page2, 'link', '--marxy-tok-function');
  } finally {
    await browser.close();
  }
});

test('L-06.2 every code line is a whole number of grid units tall', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 640, height: 800 } });
    await boot(page, '/src/a.ts', TS + 'const long = "' + 'word '.repeat(60) + '";\n');
    const m = await page.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      const unit = parseFloat(root.getPropertyValue('--marxy-line-box')) / 2;
      const code = parseFloat(root.getPropertyValue('--marxy-line-box-code'));
      return {
        unit,
        code,
        lineHeights: [...document.querySelectorAll('#marxy-source .cm-line')].map((l) => l.getBoundingClientRect().height),
        lineHeightCss: getComputedStyle(document.querySelector('#marxy-source .cm-line')).lineHeight,
      };
    });
    assert.equal(m.lineHeightCss, `${m.code}px`);
    assert.ok(m.lineHeights.length > 5);
    for (const h of m.lineHeights) {
      assert.equal(h % m.unit, 0, `line height ${h} is not a multiple of ${m.unit}`);
    }
    assert.ok(m.lineHeights.some((h) => h > m.code), 'the wrapped line should be taller than one code line');
  } finally {
    await browser.close();
  }
});

test('L-06.3 active line is a colour-mix of theme tokens; the fold gutter shows only with line numbers', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 800 } });
    await boot(page, '/src/a.ts', TS);
    await page.click('#marxy-source .cm-line >> nth=2');
    const seen = await page.evaluate(`(() => {
      const probe = ${probe};
      const el = document.querySelector('#marxy-source .cm-activeLine');
      return {
        got: el && getComputedStyle(el).backgroundColor,
        want: probe('color-mix(in srgb, var(--marxy-color-selection) 40%, transparent)', 'backgroundColor'),
      };
    })()`);
    assert.ok(seen.got, 'an active line');
    assert.equal(seen.got, seen.want);
    const gutters = () => page.evaluate(() => ({
      numbers: Boolean(document.querySelector('#marxy-source .cm-lineNumbers')),
      fold: Boolean(document.querySelector('#marxy-source .cm-foldGutter')),
    }));
    assert.deepEqual(await gutters(), { numbers: true, fold: true });
    await page.evaluate(() => window.marxyRunCommand('view.toggle-line-numbers'));
    await page.waitForFunction(() => !document.querySelector('#marxy-source .cm-lineNumbers'));
    assert.deepEqual(await gutters(), { numbers: false, fold: false });
    await page.evaluate(() => window.marxyRunCommand('view.toggle-line-numbers'));
    await page.waitForSelector('#marxy-source .cm-lineNumbers');
    assert.deepEqual(await gutters(), { numbers: true, fold: true });
  } finally {
    await browser.close();
  }
});

test('L-06.4 changing variant or size re-themes the same editor, keeping selection and undo', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 800 } });
    await boot(page, '/src/a.ts', TS);
    await setVariant(page, 'dark');
    await page.click('#marxy-source .cm-line >> nth=3');
    await page.keyboard.type('XYZ');
    await page.evaluate(() => {
      document.querySelector('#marxy-source .cm-editor').dataset.sentinel = 'same';
    });
    const snap = () => page.evaluate(() => {
      const ed = document.querySelector('#marxy-source .cm-editor');
      return {
        sentinel: ed.dataset.sentinel,
        cls: ed.className.replace(/\bcm-focused\b/, '').trim(),
        bg: getComputedStyle(ed).backgroundColor,
        text: document.querySelector('#marxy-source .cm-content').textContent,
        padTop: getComputedStyle(document.querySelector('#marxy-source .cm-content')).paddingTop,
        sel: window.getSelection().anchorOffset,
      };
    });
    const before = await snap();
    await setVariant(page, 'light');
    await page.waitForFunction((bg) => getComputedStyle(document.querySelector('#marxy-source .cm-editor')).backgroundColor !== bg, before.bg);
    const after = await snap();
    assert.equal(after.sentinel, 'same', 'the editor must not be remounted');
    assert.notEqual(after.cls, before.cls, 'the editor must be told it is now a light theme');
    assert.equal(after.text, before.text);
    assert.equal(after.sel, before.sel);
    await page.evaluate(() => {
      document.documentElement.style.setProperty('--marxy-size-body', '24px');
      document.documentElement.style.setProperty('--marxy-line-box', '36px');
    });
    await page.waitForFunction((pad) => getComputedStyle(document.querySelector('#marxy-source .cm-content')).paddingTop !== pad, after.padTop);
    assert.equal((await snap()).sentinel, 'same');
    await page.keyboard.press('Meta+Z');
    assert.ok(!(await snap()).text.includes('XYZ'), 'undo still reaches the typing made before the re-theme');
  } finally {
    await browser.close();
  }
});

test('L-06.5 the search panel is painted from tokens', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 800 } });
    await boot(page, '/src/a.ts', TS);
    await page.click('#marxy-source .cm-line >> nth=1');
    await page.keyboard.press('Meta+F');
    await page.waitForSelector('#marxy-source .cm-search input');
    const seen = await page.evaluate(`(() => {
      const probe = ${probe};
      const cs = (sel) => getComputedStyle(document.querySelector(sel));
      return {
        panel: cs('#marxy-source .cm-panels').backgroundColor,
        panelWant: probe('var(--marxy-color-notice)', 'backgroundColor'),
        text: cs('#marxy-source .cm-search input').color,
        textWant: probe('var(--marxy-color-text)', 'color'),
        font: cs('#marxy-source .cm-search input').fontFamily,
        fontWant: cs('#marxy-source .cm-content').fontFamily,
      };
    })()`);
    assert.equal(seen.panel, seen.panelWant);
    assert.equal(seen.text, seen.textWant);
    assert.equal(seen.font, seen.fontWant);
  } finally {
    await browser.close();
  }
});

test('L-11 a search match carries the edge; the current match is outlined', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 800 } });
    await boot(page, '/src/a.ts', TS);
    await page.click('#marxy-source .cm-line >> nth=1');
    await page.keyboard.press('Meta+F');
    await page.waitForSelector('#marxy-source .cm-search input');
    await page.keyboard.type('e');
    await page.keyboard.press('Enter');
    await page.waitForSelector('#marxy-source .cm-searchMatch-selected');
    const seen = await page.evaluate(`(() => {
      const probe = ${probe};
      const all = [...document.querySelectorAll('#marxy-source .cm-searchMatch')];
      const other = all.find((e) => !e.classList.contains('cm-searchMatch-selected'));
      const cur = document.querySelector('#marxy-source .cm-searchMatch-selected');
      const s = (e) => getComputedStyle(e);
      return {
        edgeWant: probe('var(--marxy-color-find-edge)', 'color'),
        otherEdge: s(other).borderBottomColor, otherW: s(other).borderBottomWidth,
        curEdge: s(cur).borderBottomColor,
        outline: s(cur).outlineColor, outlineW: s(cur).outlineWidth,
        outlineWant: probe('var(--marxy-color-code-text)', 'color'),
      };
    })()`);
    assert.equal(seen.otherEdge, seen.edgeWant);
    assert.equal(seen.otherW, '2px');
    assert.equal(seen.curEdge, seen.edgeWant);
    assert.equal(seen.outline, seen.outlineWant);
    assert.equal(seen.outlineW, '2px');
  } finally {
    await browser.close();
  }
});
