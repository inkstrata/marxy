// Copy operations: Mod+C, palette, and clipboard shape (MARXY-42).
import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { after, before, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { build } from 'vite';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { createBuffer, parseMarkdown, sectionRange, textOf } from '../../../packages/core/src/index.ts';
import { fileURLToPath } from 'node:url';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip }, fn);

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const desktopRoot = fileURLToPath(new URL('..', import.meta.url));
const corpusDir = join(repoRoot, 'fixtures', 'corpus');
const outDir = mkdtempSync(join(tmpdir(), 'marxy-ops-copy-'));
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
      rollupOptions: {
        input: {
          app: join(desktopRoot, 'app.html'),
          paletteBoot: join(desktopRoot, 'test/palette-boot.html'),
        },
      },
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
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}/`;
});
after(() => server?.close());

function b64(path) {
  return readFileSync(path).toString('base64');
}

async function bootPalette(page, files, argv) {
  await page.goto(`${base}test/palette-boot.html`);
  await page.waitForFunction(() => typeof window.marxyPaletteBoot?.start === 'function');
  await page.evaluate(async ({ files, argv }) => {
    window.__marxyOpsBoot = await window.marxyPaletteBoot.start(files, argv, []);
  }, { files, argv });
  await page.waitForFunction(() => typeof window.marxySelection?.getSelectionState === 'function');
}

function modKey(platform) {
  return platform === 'MacIntel' ? 'Meta' : 'Control';
}

test('Mod+C on the Install section copies markdown source and sanitised html', async () => {
  const file = '02-readme-real-world.md';
  const docPath = `/corpus/${file}`;
  const bytes = readFileSync(join(corpusDir, file));
  const ast = parseMarkdown(bytes, { file });
  const buffer = createBuffer(file, bytes);
  const installHeading = ast.children.find((n) => n.type === 'heading' && n.children?.[0]?.type === 'text' && n.children[0].value === 'Install');
  assert.ok(installHeading);
  const range = sectionRange(ast, installHeading);
  // The clipboard is the source slice less its trailing blank lines (MARXY-230, MARXY-337): the last
  // content line keeps its own ending and no byte is added.
  const expectedText = textOf(buffer, range).replace(/(?:\r?\n[ \t]*)+$/, (m) => (/\n[ \t]*\n/.test(m) ? m.slice(0, m.indexOf('\n') + 1) : m));

  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 900 } });
    await bootPalette(page, { [docPath]: b64(join(corpusDir, file)) }, [docPath]);
    await page.locator('#doc h2').filter({ hasText: 'Install' }).click();
    const mod = modKey(await page.evaluate(() => navigator.platform));
    await page.keyboard.press(`${mod}+KeyC`);
    const copies = await page.evaluate(() =>
      window.__marxyOpsBoot.handle.shell.calls.filter((c) => c.method === 'clipboardWrite'),
    );
    assert.equal(copies.length, 1);
    const payload = copies[0].args[0];
    assert.equal(payload.text, expectedText);
    assert.ok(typeof payload.html === 'string' && payload.html.length > 0);
    assert.ok(!payload.html.includes('data-marxy-'));
    assert.ok(!/<script/i.test(payload.html));
  } finally {
    await browser.close();
  }
});

test('Mod+C on a code block copies plain source without fences or highlight markup', async () => {
  const file = '19-source-file.md';
  const docPath = `/corpus/${file}`;
  const bytes = readFileSync(join(corpusDir, file));
  const ast = parseMarkdown(bytes, { file });
  const block = ast.children.find((n) => n.type === 'codeBlock');
  assert.ok(block && block.type === 'codeBlock');

  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 900 } });
    await bootPalette(page, { [docPath]: b64(join(corpusDir, file)) }, [docPath]);
    await page.locator('#doc pre[data-marxy-s]').first().click();
    const mod = modKey(await page.evaluate(() => navigator.platform));
    await page.keyboard.press(`${mod}+KeyC`);
    const copies = await page.evaluate(() =>
      window.__marxyOpsBoot.handle.shell.calls.filter((c) => c.method === 'clipboardWrite'),
    );
    assert.equal(copies.length, 1);
    const payload = copies[0].args[0];
    assert.equal(payload.text, block.value);
    assert.ok(!payload.text.includes('```'));
    assert.ok(!payload.text.includes('marxy-tok-'));
    assert.equal(payload.html, undefined);
  } finally {
    await browser.close();
  }
});

for (const [name, len] of [['a line over 1,000 characters', 1508], ['a line of 1,000 characters or fewer', 400]]) {
  test(`F-01: drag-select and Mod+C over ${name} copies exactly the file's characters`, async () => {
    const line = Array.from({ length: len }, (_, i) => 'abcdefghij'[i % 10]).join('');
    const docPath = '/long-line.md';
    const body = `# T\n\n\`\`\`text\n${line}\n\`\`\`\n`;
    const browser = await launchWebkit();
    try {
      const page = await browser.newPage({ viewport: { width: 960, height: 900 } });
      await bootPalette(page, { [docPath]: Buffer.from(body, 'utf8').toString('base64') }, [docPath]);
      await page.waitForFunction(() => {
        const c = document.querySelector('#doc pre code');
        return c && (c.dataset.marxyDone === 'highlight' || c.dataset.marxyDone === 'lines');
      }, undefined, { timeout: 15_000 });
      const hasElision = await page.evaluate(() => Boolean(document.querySelector('#doc .marxy-elided')));
      assert.equal(hasElision, len > 1000);
      const bb = await page.locator('#doc pre').boundingBox();
      await page.mouse.move(bb.x + 2, bb.y + 2);
      await page.mouse.down();
      await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2, { steps: 5 });
      await page.mouse.move(bb.x + bb.width - 1, bb.y + bb.height - 2, { steps: 5 });
      await page.mouse.up();
      // Cover the whole line regardless of where the pointer landed.
      await page.evaluate(() => {
        const span = document.querySelector('#doc .marxy-line');
        const r = document.createRange();
        r.selectNodeContents(span);
        const s = getSelection();
        s.removeAllRanges();
        s.addRange(r);
        document.dispatchEvent(new Event('selectionchange'));
      });
      const mod = modKey(await page.evaluate(() => navigator.platform));
      await page.keyboard.press(`${mod}+KeyC`);
      const copies = await page.evaluate(() =>
        window.__marxyOpsBoot.handle.shell.calls.filter((c) => c.method === 'clipboardWrite'),
      );
      assert.equal(copies.length, 1);
      assert.equal(copies[0].args[0].text, line);
    } finally {
      await browser.close();
    }
  });
}

test('Mod+C in the palette query copies the query text, not the selected section', async () => {
  const file = '02-readme-real-world.md';
  const docPath = `/corpus/${file}`;
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 900 } });
    await bootPalette(page, { [docPath]: b64(join(corpusDir, file)) }, [docPath]);
    await page.locator('#doc h2').filter({ hasText: 'Install' }).click();
    const mod = modKey(await page.evaluate(() => navigator.platform));
    await page.keyboard.press(`${mod}+KeyP`);
    const query = page.locator('#marxy-palette .marxy-palette-query');
    await query.fill('install');
    await query.selectText();
    await page.keyboard.press(`${mod}+KeyC`);
    const copies = await page.evaluate(() =>
      window.__marxyOpsBoot.handle.shell.calls.filter((c) => c.method === 'clipboardWrite'),
    );
    assert.equal(copies.length, 0);
    const kind = await page.evaluate(() => window.marxySelection.getSelectionState().selection.kind);
    assert.notEqual(kind, 'none', 'the article selection survives copying in the query');
  } finally {
    await browser.close();
  }
});

test('palette lists no copy operations for a paragraph selection', async () => {
  const file = '02-readme-real-world.md';
  const docPath = `/corpus/${file}`;
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 900 } });
    await bootPalette(page, { [docPath]: b64(join(corpusDir, file)) }, [docPath]);
    await page.locator('#doc p[data-marxy-s]').first().click();
    const mod = modKey(await page.evaluate(() => navigator.platform));
    await page.keyboard.press(`${mod}+KeyP`);
    await page.locator('#marxy-palette .marxy-palette-query').fill('> copy');
    const labels = await page.locator('#marxy-palette .marxy-palette-row').allTextContents();
    assert.ok(!labels.some((t) => /copy section/i.test(t)));
    assert.ok(!labels.some((t) => /copy code/i.test(t)));
  } finally {
    await browser.close();
  }
});

test('palette Copy code runs on Enter, closes, and shows Copied', async () => {
  const file = '19-source-file.md';
  const docPath = `/corpus/${file}`;
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 900 } });
    await bootPalette(page, { [docPath]: b64(join(corpusDir, file)) }, [docPath]);
    await page.locator('#doc pre[data-marxy-s]').first().click();
    const mod = modKey(await page.evaluate(() => navigator.platform));
    await page.keyboard.press(`${mod}+KeyP`);
    // Narrowed: a bare `>` now lists every applicable command (Save first), not only operations.
    await page.locator('#marxy-palette .marxy-palette-query').fill('> copy code');
    await page.waitForSelector('#marxy-palette .marxy-palette-row');
    const labels = await page.locator('#marxy-palette .marxy-palette-row').allTextContents();
    assert.ok(labels.some((t) => /copy code/i.test(t)));
    await page.keyboard.press('Enter');
    await page.waitForFunction(
      () => {
        const dialog = document.getElementById('marxy-palette');
        return dialog instanceof HTMLDialogElement && !dialog.open;
      },
      undefined,
      { timeout: 5000 },
    );
    const notice = await page.locator('#marxy-notices .marxy-notice-text').textContent();
    assert.equal(notice?.trim(), 'Copied');
    const copies = await page.evaluate(() =>
      window.__marxyOpsBoot.handle.shell.calls.filter((c) => c.method === 'clipboardWrite'),
    );
    assert.ok(copies.length >= 1);
  } finally {
    await browser.close();
  }
});

/** Selects from the start of `from` to the end of `to` (selectors in #doc), as a drag would, and marks it a drag. */
async function dragSelect(page, from, to) {
  await page.locator(from).first().scrollIntoViewIfNeeded();
  const box = await page.locator(from).first().boundingBox();
  await page.mouse.move(box.x + 1, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 1, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  await page.evaluate(({ from, to }) => {
    const r = document.createRange();
    r.setStartBefore(document.querySelector(from));
    r.setEndAfter([...document.querySelectorAll(to)].at(-1));
    const s = getSelection();
    s.removeAllRanges();
    s.addRange(r);
    document.querySelector('#doc').dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  }, { from, to });
  assert.equal(await page.evaluate(() => window.marxySelection.getSelectionState().selection.kind), 'text');
}

test('C-06: Mod+C on a drag across bold text and a link copies sanitised rich text and plain text in one write', async () => {
  const file = '02-readme-real-world.md';
  const docPath = `/corpus/${file}`;
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 900 } });
    await bootPalette(page, { [docPath]: b64(join(corpusDir, file)) }, [docPath]);
    await dragSelect(page, '#doc strong', '#doc a[href]');
    const mod = modKey(await page.evaluate(() => navigator.platform));
    await page.keyboard.press(`${mod}+KeyC`);
    const copies = await page.evaluate(() =>
      window.__marxyOpsBoot.handle.shell.calls.filter((c) => c.method === 'clipboardWrite'),
    );
    assert.equal(copies.length, 1);
    const { text, html } = copies[0].args[0];
    assert.ok(typeof text === 'string' && text.includes('Fast, tiny widgets'), text);
    assert.ok(typeof html === 'string', 'html beside the text');
    assert.match(html, /<strong>/);
    assert.match(html, /<a href=/);
    assert.ok(!html.includes('data-marxy-'), html);
    assert.ok(!html.includes('class='), html);
    assert.ok(!/<script/i.test(html), html);
    assert.ok(!html.includes('\u00ad'), 'no soft hyphen');
    assert.ok(!/<img[^>]*\ssrc=/i.test(html), 'no image source leaves the page');
    const names = [...html.matchAll(/<[a-z][a-z0-9]*((?:\s+[^\s=>/]+(?:="[^"]*")?)*)\s*\/?>/gi)]
      .flatMap((m) => [...m[1].matchAll(/\s([^\s=>/]+)/g)].map((a) => a[1]));
    assert.ok(names.length > 0, 'the link keeps its target');
    for (const name of names) assert.ok(['href', 'title', 'alt', 'colspan', 'rowspan', 'start'].includes(name), `attribute ${name}`);
  } finally {
    await browser.close();
  }
});

test('C-06: Mod+Shift+C on a drag inside one paragraph copies its exact source bytes', async () => {
  const file = '02-readme-real-world.md';
  const docPath = `/corpus/${file}`;
  const bytes = readFileSync(join(corpusDir, file));
  const buffer = createBuffer(file, bytes);
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 900 } });
    await bootPalette(page, { [docPath]: b64(join(corpusDir, file)) }, [docPath]);
    const para = page.locator('#doc > p[data-marxy-s]').filter({ hasText: 'widgetlib authors' });
    const range = {
      file,
      start: Number(await para.getAttribute('data-marxy-s')),
      end: Number(await para.getAttribute('data-marxy-e')),
    };
    await para.scrollIntoViewIfNeeded();
    const box = await para.boundingBox();
    await page.mouse.move(box.x + 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 5 });
    await page.mouse.up();
    assert.equal(await page.evaluate(() => window.marxySelection.getSelectionState().selection.kind), 'text');
    const mod = modKey(await page.evaluate(() => navigator.platform));
    await page.keyboard.press(`${mod}+Shift+KeyC`);
    const copies = await page.evaluate(() =>
      window.__marxyOpsBoot.handle.shell.calls.filter((c) => c.method === 'clipboardWrite'),
    );
    assert.equal(copies.length, 1);
    assert.deepEqual(copies[0].args[0], { text: textOf(buffer, range) });
    assert.equal(textOf(buffer, range), 'MIT © the widgetlib authors');
  } finally {
    await browser.close();
  }
});

test('C-06: the drag\'s rich copy drops display marks, soft hyphens, image sources and every attribute but the allowed ones', async () => {
  const file = '02-readme-real-world.md';
  const docPath = `/corpus/${file}`;
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 900 } });
    await bootPalette(page, { [docPath]: b64(join(corpusDir, file)) }, [docPath]);
    // A paragraph carrying every mark the page adds, built in the article, then selected whole.
    await page.evaluate(() => {
      const h = (tag, attrs, ...kids) => {
        const el = document.createElement(tag);
        for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
        el.append(...kids);
        return el;
      };
      const p = h('p', { id: 'probe', style: 'color: red', lang: 'fr', dir: 'ltr', class: 'marxy-set', 'data-marxy-s': '0', 'data-marxy-e': '1' },
        'Hy\u00adphen',
        h('span', { class: 'marxy-lb' }),
        ' ',
        h('span', { class: 'marxy-hang' }, '“'),
        h('em', { class: 'marxy-x', 'data-marxy-s': '0' }, 'quote'),
        ' ',
        h('a', { href: 'https://example.invalid/', title: 't', target: '_blank', rel: 'noopener' }, 'link', h('span', { class: 'marxy-link-dest' }, 'example.invalid')),
        h('span', { class: 'marxy-invisible-glyph' }, 'ZWSP'),
        h('img', { src: 'https://example.invalid/x.png', alt: 'pic', width: '3' }),
        h('input', { type: 'checkbox' }),
        h('td', { colspan: '2', bgcolor: 'red' }, 'cell'),
      );
      document.querySelector('#doc').prepend(p);
      const r = document.createRange();
      r.selectNodeContents(p);
      const s = getSelection();
      s.removeAllRanges();
      s.addRange(r);
      document.querySelector('#doc').dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    const mod = modKey(await page.evaluate(() => navigator.platform));
    await page.keyboard.press(`${mod}+KeyC`);
    const copies = await page.evaluate(() =>
      window.__marxyOpsBoot.handle.shell.calls.filter((c) => c.method === 'clipboardWrite'),
    );
    assert.equal(copies.length, 1);
    const { html } = copies[0].args[0];
    assert.ok(html.includes('Hyphen'), html);
    assert.ok(!html.includes('\u00ad'), 'no soft hyphen');
    assert.ok(html.includes('Hyphen \u201c<em>quote</em>'), `hanging punctuation unwrapped: ${html}`);
    assert.ok(!html.includes('example.invalid</'), `no link destination label: ${html}`);
    assert.ok(!html.includes('ZWSP'), `no invisible-glyph label: ${html}`);
    assert.ok(!/<input/i.test(html), html);
    assert.ok(!/\ssrc=/i.test(html), html);
    assert.match(html, /<a href="https:\/\/example\.invalid\/" title="t">link<\/a>/);
    assert.match(html, /alt="pic"/);
    for (const banned of ['id=', 'style=', 'lang=', 'dir=', 'class=', 'data-marxy-', 'target=', 'rel=', 'width=', 'bgcolor=']) {
      assert.ok(!html.includes(banned), `${banned} in ${html}`);
    }
  } finally {
    await browser.close();
  }
});

test('C-06: the palette shows Mod+C on the selection\'s default verb and Mod+Shift+C on its markdown copy, and opens on a given query', async () => {
  const file = '02-readme-real-world.md';
  const docPath = `/corpus/${file}`;
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 900 } });
    await bootPalette(page, { [docPath]: b64(join(corpusDir, file)) }, [docPath]);
    const para = page.locator('#doc > p[data-marxy-s]').filter({ hasText: 'widgetlib authors' });
    await para.scrollIntoViewIfNeeded();
    await para.click();
    await page.evaluate(() => window.__marxyOpsBoot.handle.palette.open('>'));
    const query = page.locator('#marxy-palette .marxy-palette-query');
    assert.equal(await query.inputValue(), '>');
    await query.press('End');
    await query.type(' copy');
    await page.waitForSelector('#marxy-palette .marxy-palette-row[data-row-key="op.copy-rich"]');
    const keys = await page.evaluate(() =>
      Object.fromEntries(
        [...document.querySelectorAll('#marxy-palette .marxy-palette-row')].map((row) => [
          row.dataset.rowKey,
          row.querySelector('.marxy-palette-key')?.textContent ?? null,
        ]),
      ),
    );
    const mac = (await page.evaluate(() => navigator.platform)) === 'MacIntel';
    assert.equal(keys['op.copy-rich'], mac ? '⌘C' : 'Ctrl+C');
    assert.equal(keys['op.copy-source'], mac ? '⇧⌘C' : 'Ctrl+Shift+C');
    assert.equal(keys['op.copy-plain'], null, 'only the default verbs carry a chord');
  } finally {
    await browser.close();
  }
});
