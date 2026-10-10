// Clipboard payload to markdown (E-14): the golden pairs, the semantic property, the hostile payloads
// and the promise that a conversion touches nothing in the live document. Playwright WebKit drives
// `window.marxyPaste`, because the converter needs a DOM.
import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { after, before, test as nodeTest } from 'node:test';
import { fileURLToPath } from 'node:url';
import { webkit } from 'playwright';
import { build } from 'vite';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { renderSafeHtml } from '../../../packages/core/src/render/pipeline.ts';
import { DEFAULT_POLICY, sanitizeHtml } from '../../../packages/core/src/sanitize/index.ts';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip }, fn);

const desktopRoot = fileURLToPath(new URL('..', import.meta.url));
const fixtures = join(desktopRoot, 'test/fixtures/paste');
const outDir = mkdtempSync(join(tmpdir(), 'marxy-paste-'));
const pairs = readdirSync(fixtures).filter((f) => f.endsWith('.html')).sort().map((f) => ({
  name: f.slice(0, -5),
  html: readFileSync(join(fixtures, f), 'utf8'),
  md: readFileSync(join(fixtures, `${f.slice(0, -5)}.md`), 'utf8'),
}));

let server;
let browser;
let page;

before(async () => {
  if (skip) return;
  await build({
    root: desktopRoot,
    configFile: false,
    logLevel: 'silent',
    build: {
      outDir,
      emptyOutDir: true,
      lib: { entry: join(desktopRoot, 'src/paste/index.ts'), formats: ['es'], fileName: 'paste' },
    },
  });
  const types = { '.html': 'text/html', '.js': 'text/javascript' };
  server = createServer((req, res) => {
    const pathname = new URL(req.url, 'http://x').pathname;
    if (pathname === '/') {
      res.setHeader('Content-Type', 'text/html');
      return res.end('<!doctype html><html><body><p id="keep">live</p></body></html>');
    }
    const path = join(outDir, pathname);
    if (!existsSync(path)) { res.statusCode = 404; return res.end(); }
    res.setHeader('Content-Type', types[extname(path)] ?? 'application/octet-stream');
    res.end(readFileSync(path));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/`;
  browser = await launchWebkit();
  page = await browser.newPage();
  // Anything the converter let reach the network would show here: the page may only load itself.
  page.on('request', (r) => { if (!r.url().startsWith(base) && !r.url().startsWith('data:')) requested.push(r.url()); });
  await page.goto(base);
  await page.addScriptTag({ type: 'module', url: `${base}paste.js` });
  await page.waitForFunction(() => !!window.marxyPaste);
});
after(async () => {
  await browser?.close();
  server?.close();
});
const requested = [];

const convert = (html) => page.evaluate((h) => window.marxyPaste.htmlToMarkdown(h), html);
const textOfHtml = (html) => page.evaluate((h) => new DOMParser().parseFromString(h, 'text/html').body.textContent, html);
// Whitespace is not what this property is about (the converter decides where lines break): the words are.
const norm = (s) => s.replace(/\s+/g, '');
// What the sanitiser leaves of the original: the default allow-list, with a clipboard's document shell unwrapped.
const SHELL_POLICY = { ...DEFAULT_POLICY, transparent: [...DEFAULT_POLICY.transparent, 'html', 'head', 'body'] };
const sanitisedOriginal = (html) => sanitizeHtml(html.replace(/<!\[if !supportLists\]>[\s\S]*?<!\[endif\]>/gi, ''), SHELL_POLICY).html;

test('there are golden pairs for every shape the card names', () => {
  const names = pairs.map((p) => p.name);
  for (const need of ['headings-inline', 'nested-lists', 'code', 'table', 'div-soup', 'hostile-page', 'google-docs', 'word'])
    assert.ok(names.includes(need), need);
});

for (const pair of pairs) {
  test(`golden pair ${pair.name}: htmlToMarkdown(html) is md, byte for byte`, async () => {
    assert.equal(await convert(pair.html), pair.md);
  });

  test(`golden pair ${pair.name}: the same payload gives the same bytes again`, async () => {
    assert.equal(await convert(pair.html), await convert(pair.html));
  });

  test(`semantic property ${pair.name}: the markdown renders to the text of the sanitised HTML`, async () => {
    const original = norm(await textOfHtml(sanitisedOriginal(pair.html)));
    const md = await convert(pair.html);
    const rendered = norm(await textOfHtml(renderSafeHtml(md).html));
    assert.equal(rendered, original);
  });
}

test('the hostile pair: no script, handler, javascript: URL or remote reference survives', async () => {
  const md = await convert(pairs.find((p) => p.name === 'hostile-page').html);
  for (const bad of ['<script', 'javascript:', 'onerror', 'onclick', 'onload', 'onmouseover', 'evil.example', 'track.example',
    'cdn.example', 'data:text', 'alert(', 'steal', 'fetch(', '<svg', '<img', '<iframe', 'style='])
    assert.ok(!md.toLowerCase().includes(bad.toLowerCase()), `${bad} in ${md}`);
  assert.ok(md.includes('https://example.com/ok'), 'the harmless link stays');
});

test('hostile one-liners convert to text and nothing else', async () => {
  const cases = {
    // A relative src is a local reference, the one kind of image the sanitiser keeps; the handler is gone.
    '<img src=x onerror=alert(1)>': '![](x)\n',
    '<p><img src="https://t.example/p.gif" width=1 height=1></p>': '',
    '<a href="javascript:alert(1)">click</a>': 'click\n',
    '<a href="&#x6A;avascript:alert(1)">click</a>': 'click\n',
    '<svg><script>alert(1)</script></svg>': '',
    '<svg><a xlink:href="javascript:alert(1)"><text>t</text></a></svg><p>kept</p>': null,
    '<p>a<script>alert(1)</script>b</p>': 'ab\n',
    '<div onclick="x()">hi</div>': 'hi\n',
    '<style>p{background:url(https://e.example/x)}</style><p>s</p>': 's\n',
    '<p>x</p><iframe srcdoc="<script>alert(1)</script>"></iframe>': 'x\n',
  };
  for (const [html, want] of Object.entries(cases)) {
    const got = await convert(html);
    if (want !== null) assert.equal(got, want, html);
    for (const bad of ['<script', 'javascript:', 'onerror', 'alert(', 'e.example'])
      assert.ok(!got.includes(bad), `${bad} in ${JSON.stringify(got)} for ${html}`);
  }
});

test('converting never touches the live document and never goes to the network', async () => {
  const before = await page.evaluate(() => document.body.innerHTML);
  const headBefore = await page.evaluate(() => document.head.innerHTML);
  for (const pair of pairs) await convert(pair.html);
  await page.evaluate(() => window.marxyPaste.convertClipboard({ html: '<script>window.__pwned=1</script><img src=x onerror="window.__pwned=1"><p>hi</p>' }));
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => document.body.innerHTML), before);
  assert.equal(await page.evaluate(() => document.head.innerHTML), headBefore);
  assert.equal(await page.evaluate(() => window.__pwned), undefined);
  assert.deepEqual(requested, []);
});

test('convertClipboard: markdown beside html is kept byte for byte; html converts; json is fenced', async () => {
  const run = (p) => page.evaluate((x) => window.marxyPaste.convertClipboard(x), p);
  const md = '# Title\r\n\r\n- a\r\n- b\r\n';
  assert.deepEqual(await run({ text: md, html: '<h1>Title</h1><ul><li>a</li><li>b</li></ul>' }), { kind: 'markdown', markdown: md });
  assert.deepEqual(await run({ text: 'Title a b', html: '<h1>Title</h1><p>a <b>b</b></p>' }), { kind: 'html', markdown: '# Title\n\na **b**\n' });
  assert.deepEqual(await run({ text: '{"a":1}' }), { kind: 'json', markdown: '```json\n{"a":1}\n```\n' });
  assert.deepEqual(await run({ text: 'hello' }), { kind: 'text', markdown: 'hello' });
  assert.deepEqual(await run({ text: ' ' }), { kind: 'empty', markdown: '' });
  // Nothing readable survives the sanitiser: fall back to the text flavour.
  assert.deepEqual(await run({ text: 'fallback', html: '<div><script>1</script></div>' }), { kind: 'text', markdown: 'fallback' });
});
