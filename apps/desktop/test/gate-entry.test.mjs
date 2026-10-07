// The aesthetics gate's app entry (B-01): gate.html boots the real app over a memory shell, renders a
// corpus file at a width, variant and size from the config file, and returns the layout-shift report.
// The app's `typeset_done` mark is checked here too. Playwright WebKit only.
import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { build } from 'vite';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);

const desktop = fileURLToPath(new URL('..', import.meta.url));
const corpus = fileURLToPath(new URL('../../../fixtures/corpus/', import.meta.url));
const technical = readFileSync(join(corpus, '01-long-technical.md'), 'utf8');
const prose = 'A paragraph long enough to take several lines at any width the gate renders, so the typesetter has a real paragraph to break and sets it rather than leaving a single short line to the engine. '.repeat(4).trim();
/**
 * Over A-02's 64 KiB threshold, so it is mounted in idle chunks after first text. Its paragraphs are
 * at the two ends and only headings lie between, so the typesetter runs out of work on the first
 * screens long before the last chunk brings the closing paragraph: a mark on the first `done` would
 * come before `content_complete` and before that paragraph is set.
 */
const gapped = [
  ...Array.from({ length: 6 }, () => prose),
  ...Array.from({ length: 1500 }, (_, i) => `### Section ${i + 1}`),
  `The closing paragraph. ${prose}`,
].join('\n\n') + '\n';
const image = readFileSync(join(corpus, 'image.png'));
const outDir = mkdtempSync(join(tmpdir(), 'marxy-gate-entry-'));
let server;
let base;
let browser;

before(async () => {
  if (skip) return;
  await build({
    root: desktop,
    logLevel: 'silent',
    build: { outDir, emptyOutDir: true, rollupOptions: { input: { gate: join(desktop, 'gate.html') } } },
  });
  const types = { '.html': 'text/html', '.ttf': 'font/ttf', '.js': 'text/javascript', '.txt': 'text/plain', '.css': 'text/css', '.png': 'image/png' };
  server = createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const path = pathname === '/image.png' ? join(corpus, 'image.png') : join(outDir, pathname.endsWith('/') ? `${pathname}gate.html` : pathname);
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

/** One fresh page per render, as the gate loads them; returns the report and what the page shows. */
async function render(source, opts) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  try {
    await page.goto(`${base}gate.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.marxyGate?.render === 'function');
    return await page.evaluate(async ({ source, opts }) => {
      const { stats } = await window.marxyGate.render(source, opts);
      const doc = document.getElementById('doc');
      const marks = window.marxyGate.calls().filter((c) => c.method === 'mark').map((c) => ({ name: c.args[0], data: c.args[2] ?? null }));
      return {
        stats,
        marks,
        heading: doc.querySelector('h1')?.textContent?.trim() ?? '',
        fontFamily: getComputedStyle(doc).fontFamily,
        fontSize: getComputedStyle(doc).fontSize,
        variant: document.documentElement.getAttribute('data-marxy-variant'),
        mainWidth: document.getElementById('marxy-main').getBoundingClientRect().width,
        image: doc.querySelector('img[alt="Image alt"]')?.getAttribute('src') ?? null,
        lastParagraphSet: [...doc.querySelectorAll('p')].at(-1)?.classList.contains('marxy-set') ?? false,
      };
    }, { source, opts });
  } finally {
    await page.close();
  }
}

function markNames(marks) {
  return marks.map((m) => m.name);
}

/** `typeset_done` exactly once, after `first_text` and `typeset_viewport`. */
function assertTypesetDoneOrder(marks) {
  const names = markNames(marks);
  const done = names.flatMap((n, i) => (n === 'typeset_done' ? [i] : []));
  assert.equal(done.length, 1, `one typeset_done per document; marks: ${names.join(' ')}`);
  const firstText = names.indexOf('first_text');
  const viewport = names.indexOf('typeset_viewport');
  assert.ok(firstText >= 0 && viewport >= 0, `first_text and typeset_viewport were marked; marks: ${names.join(' ')}`);
  assert.ok(firstText < done[0], 'typeset_done comes after first_text');
  assert.ok(viewport < done[0], 'typeset_done comes after typeset_viewport');
  assert.match(marks[done[0]].data, /^set=\d+$/);
  return done[0];
}

test('marxyGate.render reports observed layout shift for 01-long-technical at 960 dark 20', async () => {
  const r = await render(technical, { variant: 'dark', width: 960, size: 20 });
  assert.equal(r.stats.observed, true);
  assert.ok(r.stats.snapshots >= 4, `snapshots ${r.stats.snapshots}`);
  assert.equal(typeof r.stats.cls, 'number');
  assert.equal(r.heading, 'Stack evaluation');
  assert.match(r.fontFamily, /Literata/);
  assert.equal(r.variant, 'dark');
  assert.equal(r.fontSize, '20px');
  assert.equal(r.mainWidth, 960);
  const i = assertTypesetDoneOrder(r.marks);
  assert.ok(Number(r.marks[i].data.slice(4)) > 0, 'the typesetter set some paragraphs');
  console.log(`# 01-long-technical 960 dark 20: cls=${r.stats.cls} font=${r.stats.fontWindow} settle=${r.stats.settleWindow} ${r.marks[i].data}`);
});

test('the light variant from the config file reaches the page', async () => {
  const r = await render(technical, { variant: 'light', width: 960, size: 20 });
  assert.equal(r.variant, 'light');
  assert.equal(r.stats.observed, true);
  assertTypesetDoneOrder(r.marks);
});

test('a 24 px size from the config file reaches the page', async () => {
  const r = await render(technical, { variant: 'dark', width: 960, size: 24 });
  assert.equal(r.fontSize, '24px');
  assert.equal(r.stats.observed, true);
  assertTypesetDoneOrder(r.marks);
  // Phase A applies size before first text, so no 20 → 24 reflow lands in a measured window.
  console.log(`# 01-long-technical 960 dark 24: cls=${r.stats.cls} font=${r.stats.fontWindow} settle=${r.stats.settleWindow}`);
});

test('a relative image resolves beside the document', async () => {
  const r = await render('# Image\n\n![Image alt](image.png "Image title")\n', { variant: 'dark', width: 960, size: 20, image: image.toString('base64') });
  assert.ok(r.image?.startsWith('blob:'), `image src ${r.image}`);
});

test('a progressive document marks typeset_done only once its last chunk is in and set', async () => {
  const r = await render(gapped, { variant: 'dark', width: 960, size: 20 });
  const names = markNames(r.marks);
  const done = assertTypesetDoneOrder(r.marks);
  const complete = names.indexOf('content_complete');
  assert.ok(complete >= 0, `the document is mounted in chunks (A-02); marks: ${names.join(' ')}`);
  assert.ok(complete < done, `typeset_done comes after content_complete; marks: ${names.join(' ')}`);
  assert.equal(r.lastParagraphSet, true, 'the closing paragraph, in the last chunk, is set by typeset_done');
  assert.equal(r.stats.observed, true);
  console.log(`# chunked 960 dark 20: cls=${r.stats.cls} ${r.marks[done].data}`);
});

/**
 * B-02, from B-01's review: the stale-document guards in app.ts's typesetDocument. A large first
 * document is still being mounted in idle chunks when a second is opened over it; only the second, the
 * live document, may mark `typeset_done`, once. A cancelled mount or a replaced typesetter emits nothing.
 */
test('a second open while the first document\'s chunks are pending marks typeset_done once, for the live document', async () => {
  const large = [
    ...Array.from({ length: 6 }, () => prose),
    ...Array.from({ length: 6000 }, (_, i) => `### Section ${i + 1}`),
    `The closing paragraph. ${prose}`,
  ].join('\n\n') + '\n';
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  try {
    await page.goto(`${base}gate.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.marxyGate?.render === 'function');
    const r = await page.evaluate(async ({ large, technical }) => {
      const { stats } = await window.marxyGate.render(large, { variant: 'dark', width: 960, size: 20, reopen: technical });
      // Long enough for the first document's typesetter to reach its last paragraph, had it lived on.
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const marks = window.marxyGate.calls().filter((c) => c.method === 'mark').map((c) => ({ name: c.args[0], data: c.args[2] ?? null }));
      return { stats, marks, heading: document.querySelector('#doc h1')?.textContent?.trim() ?? '' };
    }, { large, technical });
    const names = markNames(r.marks);
    const reads = r.marks.flatMap((m, i) => (m.name === 'file_read' ? [{ i, bytes: m.data }] : []));
    assert.deepEqual(reads.map((x) => x.bytes), [`bytes=${Buffer.byteLength(large)}`, `bytes=${Buffer.byteLength(technical)}`], `two opens; marks: ${names.join(' ')}`);
    const secondOpen = reads[1].i;
    assert.equal(names.slice(0, secondOpen).includes('content_complete'), false, `the first document was still being mounted when the second opened; marks: ${names.join(' ')}`);
    const done = names.flatMap((n, i) => (n === 'typeset_done' ? [i] : []));
    assert.equal(done.length, 1, `exactly one typeset_done; marks: ${names.join(' ')}`);
    assert.ok(done[0] > secondOpen, `typeset_done belongs to the live document; marks: ${names.join(' ')}`);
    assert.equal(r.heading, 'Stack evaluation', 'the second document is on screen');
    assert.equal(r.stats.observed, true);
  } finally {
    await page.close();
  }
});

/**
 * The same guard for a document mounted at once: its typesetter is still setting paragraphs in idle
 * time when the second document replaces it, and a destroyed typesetter must not mark `typeset_done`.
 */
test('a second open while the first document is still being set marks typeset_done once, for the live document', async () => {
  const many = Array.from({ length: 60 }, (_, i) => `${i + 1}. ${prose}`).join('\n\n') + '\n';
  assert.ok(Buffer.byteLength(many) < 64 * 1024, 'under the progressive threshold: mounted at once');
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  try {
    await page.goto(`${base}gate.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.marxyGate?.render === 'function');
    const r = await page.evaluate(async ({ many, technical }) => {
      await window.marxyGate.render(many, { variant: 'dark', width: 960, size: 20, reopen: technical });
      await new Promise((resolve) => setTimeout(resolve, 1500));
      return window.marxyGate.calls().filter((c) => c.method === 'mark').map((c) => ({ name: c.args[0], data: c.args[2] ?? null }));
    }, { many, technical });
    const names = markNames(r);
    const secondOpen = names.lastIndexOf('file_read');
    assert.equal(names.filter((n) => n === 'file_read').length, 2, `two opens; marks: ${names.join(' ')}`);
    assert.equal(names.indexOf('content_complete'), -1, `neither document is chunked; marks: ${names.join(' ')}`);
    const done = names.flatMap((n, i) => (n === 'typeset_done' ? [i] : []));
    assert.equal(done.length, 1, `exactly one typeset_done; marks: ${names.join(' ')}`);
    assert.ok(done[0] > secondOpen, `typeset_done belongs to the live document; marks: ${names.join(' ')}`);
  } finally {
    await page.close();
  }
});

test('an empty document renders: the app marks no_text and typesets nothing, so the render does not wait for typeset_done', async () => {
  const r = await render('', { variant: 'dark', width: 960, size: 20 });
  const names = markNames(r.marks);
  assert.ok(names.includes('no_text'), `marks: ${names.join(' ')}`);
  assert.equal(names.includes('typeset_done'), false);
  assert.equal(r.stats.observed, true);
});
