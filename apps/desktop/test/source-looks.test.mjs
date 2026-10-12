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
  assert.equal(seen.got, want, `${text} should carry ${tokenVar} (${seen.got} vs ${want}; text ${seen.text})`);
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
    await expectToken(page2, 'link', '--marxy-tok-link');
  } finally {
    await browser.close();
  }
});

const PY = [
  '@decorator(1)',
  'class Foo(Base):',
  '    """Doc."""',
  '    def run(self, x: int = 3):',
  '        s = "a\\n"',
  '        print(f"{x}", self.y, None)',
  '        return len([1])  # done',
  '',
].join('\n');
const MD_FULL = ['# One', '', '## Two', '', '### Three', '', 'Text with `code` and [a link](https://example.com/x).', '', '> quoted', '', '- item', '', '1. first', '', '---', ''].join('\n');

/** Computed colour and line box of every painted span in Source, keyed by its text. */
const spansOf = (page) => page.evaluate(() => {
  const out = {};
  for (const el of document.querySelectorAll('#marxy-source .cm-line span')) {
    if (el.children.length === 0) out[el.textContent] ??= getComputedStyle(el).color;
  }
  return { spans: out, text: getComputedStyle(document.querySelector('#marxy-source .cm-content')).color };
});

test('V-13 Source: a Python file uses at least nine token colours and leaves no keyword, decorator, class name or escape in the text colour', async () => {
  const browser = await launchWebkit();
  try {
    for (const variant of ['dark', 'light']) {
      const page = await browser.newPage({ viewport: { width: 960, height: 800 } });
      await boot(page, '/src/a.py', PY);
      await setVariant(page, variant);
      const { spans, text } = await spansOf(page);
      const colours = new Set(Object.values(spans));
      assert.ok(colours.size >= 9, `${variant}: ${colours.size} token colours`);
      for (const word of ['class', 'def', 'return', 'Foo', 'run', '@', '\\n']) {
        const hit = Object.entries(spans).find(([k]) => k === word);
        assert.ok(hit, `${variant}: no span for ${word}`);
        assert.notEqual(hit[1], text, `${variant}: ${word} is left in the text colour ${JSON.stringify(spans)}`);
      }
      await page.close();
    }
  } finally {
    await browser.close();
  }
});

test('V-13 Source: Markdown headings, link, URL, code, list and quote marks take token colours, and every row stays one line box', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 800 } });
    await page.goto(`${base}app.html`);
    await page.waitForFunction(() => typeof window.marxyApp?.start === 'function');
    await page.evaluate(async ({ files, argv }) => {
      const handle = await window.marxyApp.start(files, argv);
      await handle.ready;
    }, { files: { '/doc/a.md': Buffer.from(MD_FULL).toString('base64') }, argv: ['/doc/a.md'] });
    await page.keyboard.press('Meta+E');
    await page.waitForSelector('#marxy-source .cm-editor .cm-line');
    const { spans, text } = await spansOf(page);
    for (const word of [' One', ' Two', ' Three', 'a link', 'https://example.com/x', 'code', '>', '-', '1.', '---']) {
      const hit = Object.entries(spans).find(([k]) => k === word || k.trim() === word.trim());
      assert.ok(hit, `no span for ${JSON.stringify(word)}`);
      assert.notEqual(hit[1], text, `${JSON.stringify(word)} is left in the text colour`);
    }
    const heights = await page.evaluate(() => [...document.querySelectorAll('#marxy-source .cm-line')].map((l) => l.getBoundingClientRect().height));
    assert.equal(new Set(heights.map((h) => Math.round(h))).size, 1, `rows differ in height: ${[...new Set(heights)]}`);
  } finally {
    await browser.close();
  }
});

/**
 * Sets the text size the way the reader does (Mod+= and Mod+-), one step at a time, until the root says `px`.
 * The size properties the reader's choice sets (`--marxy-size-body` and the rest) are what Source follows.
 */
async function setTextSize(page, px) {
  const read = () => page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--marxy-size-body')));
  for (let i = 0; i < 40; i++) {
    const now = await read();
    if (now === px) return;
    await page.keyboard.press(now < px ? 'Meta+Equal' : 'Meta+Minus');
    await page.waitForFunction((was) => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--marxy-size-body')) !== was, now);
  }
  throw new Error(`could not reach text size ${px}`);
}

test('V-12 Source sets its own type: 14 on 21 at the default, scaling with the reader\'s text size (K-R1 a, ADR-0067)', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 800 } });
    await boot(page, '/src/a.ts', TS);
    // Seven-tenths of the body to the half pixel, and a line of one and a half times that to the pixel.
    const want = { 16: [11, 17], 20: [14, 21], 26: [18, 27] };
    for (const size of [16, 20, 26]) {
      await setTextSize(page, size);
      const seen = await page.evaluate(() => {
        const root = getComputedStyle(document.documentElement);
        const content = getComputedStyle(document.querySelector('#marxy-source .cm-content'));
        const line = getComputedStyle(document.querySelector('#marxy-source .cm-line'));
        return {
          sizeToken: root.getPropertyValue('--marxy-size-source').trim(),
          lineToken: root.getPropertyValue('--marxy-line-box-source').trim(),
          fontSize: content.fontSize,
          lineHeight: line.lineHeight,
          rowHeight: document.querySelector('#marxy-source .cm-line').getBoundingClientRect().height,
          proseBox: root.getPropertyValue('--marxy-line-box-code').trim(),
        };
      });
      const [px, lineBox] = want[size];
      assert.equal(seen.sizeToken, `${px}px`, `--marxy-size-source at ${size}`);
      assert.equal(seen.lineToken, `${lineBox}px`, `--marxy-line-box-source at ${size}`);
      assert.equal(seen.fontSize, `${px}px`, `.cm-content font size at ${size}`);
      assert.equal(seen.lineHeight, `${lineBox}px`, `.cm-line line height at ${size}`);
      assert.equal(seen.rowHeight, lineBox, `a row is one line box at ${size}`);
      // Rendered's code blocks keep their own metrics: 18 on 30 at the default, on the prose grid.
      if (size === 20) assert.equal(seen.proseBox, '30px');
    }
  } finally {
    await browser.close();
  }
});

test('V-12 the gutter takes its padding from the line box, not CodeMirror\'s 3px and 5px; the numbers are tabular and secondary', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 800 } });
    await boot(page, '/src/a.ts', TS);
    for (const size of [20, 26]) {
      await setTextSize(page, size);
      const seen = await page.evaluate(`(() => {
        const probe = ${probe};
        const el = [...document.querySelectorAll('#marxy-source .cm-lineNumbers .cm-gutterElement')].find((e) => e.textContent === '2');
        const cs = getComputedStyle(el);
        return {
          line: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--marxy-line-box-source')),
          left: cs.paddingLeft, right: cs.paddingRight,
          align: cs.textAlign, numeric: cs.fontVariantNumeric, color: cs.color,
          want: probe('var(--marxy-color-text-secondary)', 'color'),
        };
      })()`);
      assert.equal(seen.left, `${seen.line / 2}px`, `left padding at ${size}`);
      assert.equal(seen.right, `${seen.line / 2}px`, `right padding at ${size}`);
      assert.equal(seen.align, 'right');
      assert.match(seen.numeric, /tabular-nums/);
      assert.equal(seen.color, seen.want);
    }
  } finally {
    await browser.close();
  }
});

test('V-12 Source takes the article\'s weight: the body weight token plus the platform offset, not 400', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 800 } });
    await boot(page, '/src/a.ts', TS);
    for (const variant of ['dark', 'light']) {
      await setVariant(page, variant);
      const seen = await page.evaluate(() => {
        const root = getComputedStyle(document.documentElement);
        return {
          want: parseFloat(root.getPropertyValue('--marxy-weight-body')) + parseFloat(root.getPropertyValue('--marxy-weight-offset') || '0'),
          content: getComputedStyle(document.querySelector('#marxy-source .cm-content')).fontWeight,
          gutter: getComputedStyle(document.querySelector('#marxy-source .cm-lineNumbers .cm-gutterElement')).fontWeight,
          axis: getComputedStyle(document.querySelector('#marxy-source .cm-content')).fontVariationSettings,
        };
      });
      assert.equal(seen.content, String(seen.want), `.cm-content weight in ${variant}`);
      assert.equal(seen.gutter, String(seen.want), `gutter weight in ${variant}`);
      assert.ok(seen.axis.includes(String(seen.want)), `the wght axis follows the weight in ${variant}: ${seen.axis}`);
    }
    // The dark ground sets its body weight below 400 (a face reads heavier on dark), so Source is lighter than the 400 it wore.
    await setVariant(page, 'dark');
    assert.ok(parseFloat(await page.evaluate(() => getComputedStyle(document.querySelector('#marxy-source .cm-content')).fontWeight)) < 400);
  } finally {
    await browser.close();
  }
});

test('V-12 nothing at rest: no tinted line without the caret, and a fold chevron only over the gutter', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 800 } });
    await boot(page, '/src/a.ts', TS);
    const rest = () => page.evaluate(() => {
      const line = document.querySelector('#marxy-source .cm-activeLine');
      const chevrons = [...document.querySelectorAll('#marxy-source .cm-foldGutter .marxy-fold-open')];
      return {
        line: line && getComputedStyle(line).backgroundColor,
        chevrons: chevrons.length,
        shown: chevrons.filter((c) => getComputedStyle(c).opacity !== '0').length,
        focused: Boolean(document.querySelector('#marxy-source .cm-editor.cm-focused')),
      };
    });
    await page.mouse.move(700, 600);
    const at = await rest();
    assert.equal(at.focused, false, 'the editor does not hold focus on open');
    assert.ok(at.line, 'there is an active line to tint');
    assert.match(at.line, /rgba\(0, 0, 0, 0\)|transparent/, `active line at rest: ${at.line}`);
    assert.ok(at.chevrons > 0, 'a block line has a fold chevron in the DOM');
    assert.equal(at.shown, 0, 'no chevron is drawn at rest');
    await page.hover('#marxy-source .cm-gutters');
    assert.ok((await rest()).shown > 0, 'a chevron shows over the gutter');
    await page.mouse.move(700, 600);
    await page.click('#marxy-source .cm-line >> nth=2');
    const focused = await rest();
    assert.doesNotMatch(focused.line, /rgba\(0, 0, 0, 0\)/, 'the line is tinted while the caret is in the editor');
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
    await setTextSize(page, 24);
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

test('H-05: a theme that is dark under the light variant gives Source the dark base theme, and the head is not watched in a loop', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 800 } });
    await boot(page, '/src/a.ts', TS);
    const editorClass = () => page.evaluate(() => document.querySelector('#marxy-source .cm-editor').className);
    await setVariant(page, 'dark');
    await page.waitForTimeout(150);
    const dark = await editorClass();
    await setVariant(page, 'light');
    await page.waitForTimeout(150);
    const light = await editorClass();
    // CodeMirror marks its base theme on the editor: ͼ3 is the dark base theme, ͼ2 the light one.
    const base = (cls) => (cls.split(' ').includes('ͼ3') ? 'dark' : cls.split(' ').includes('ͼ2') ? 'light' : 'none');
    assert.deepEqual([base(dark), base(light)], ['dark', 'light']);
    // What applyTheme does for Fjord: a sheet that keeps color-scheme dark under the light variant, then the marker is rewritten.
    // Count what lands in the head meanwhile: a reconfigure injects a style, so a loop shows as a count that keeps growing.
    const added = await page.evaluate(async () => {
      let count = 0;
      new MutationObserver((records) => { for (const r of records) count += r.addedNodes.length; }).observe(document.head, { childList: true });
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(':root[data-marxy-variant="light"] { color-scheme: dark; }');
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
      const marker = document.getElementById('marxy-theme') ?? document.head.appendChild(Object.assign(document.createElement('template'), { id: 'marxy-theme' }));
      marker.textContent = ':root[data-marxy-variant="light"] { color-scheme: dark; }';
      await new Promise((r) => setTimeout(r, 600));
      return count;
    });
    assert.ok(added <= 4, `${added} nodes were added to the head after one theme change`);
    assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme), 'dark');
    assert.equal(base(await editorClass()), 'dark', 'Source wears the dark base theme under Fjord with the light variant');
    // Stable: no further reconfigure after it settled.
    const later = await page.evaluate(async () => {
      let count = 0;
      new MutationObserver((records) => { for (const r of records) count += r.addedNodes.length; }).observe(document.head, { childList: true });
      await new Promise((r) => setTimeout(r, 500));
      return count;
    });
    assert.equal(later, 0);
  } finally {
    await browser.close();
  }
});
