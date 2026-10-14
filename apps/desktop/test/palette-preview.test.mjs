// The palette shows what you are about to open (W-13): a preview column beside the results that follows the
// highlighted row after a pause. Real WebKit on the shipped skeleton over the memory shell, with the real palette,
// and the shell's call record as the read log. What it holds: the first lines of a file appear after about 200 ms and
// not on the keystroke; holding an arrow key over fifty rows reads no file until the key is released; one read per
// preview, at `readHead`'s 256 KB and no more; a file over the large-file limit is not read; a Markdown file with a
// remote image fetches nothing; `@` finds a heading in any document and its preview is the section; commands and
// transforms are previewed; a narrow palette has no column; the page under the palette does not move; and looking at
// previews, then closing, changes no state and writes nothing.
import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { after, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { b64, closeHarness, harnessBase, shippedSkeleton } from './support/two-pane.mjs';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip, timeout: 60_000 }, fn);
after(() => closeHarness());

const READ_CAP = 256 * 1024;
const LARGE = 2 * 1024 * 1024;
const lines = (n, f) => Array.from({ length: n }, (_, i) => f(i + 1)).join('\n');

const GUIDE = '# Guide\n\nIntro words.\n\n## Install\n\nRun the installer, then restart.\n\n### Flags\n\nUse -f to force.\n\n## Use\n\nUse it daily.\n';
const guideOffset = (s) => Buffer.byteLength(GUIDE.slice(0, GUIDE.indexOf(s)), 'utf8');
const FAQ = '# FAQ\n\n## How do I install it?\n\nSee the guide.\n';
const REMOTE = '# Remote\n\nBefore ![the logo](https://example.com/logo.png) and <img src="https://cdn.example.net/x.png" alt="tracker"> and ![local](./pic.png) after.\n\nA [link](https://example.org/away) too.\n';
const LONG_MD = `# Long\n\n${'A sentence that fills the page with words. '.repeat(8000)}\n`; // about 340 KB

const files = {
  '/r/docs/guide.md': GUIDE,
  '/r/docs/faq.md': FAQ,
  '/r/src/lib.py': lines(80, (i) => `x${i} = ${i}`),
  '/r/logs/build.log': `${lines(30, (i) => `2026-10-12 12:00:${String(i).padStart(2, '0')} INFO step ${i} done`)}\n2026-10-12 12:01:00 ERROR the build failed\n`,
  '/r/img/remote.md': REMOTE,
  '/r/big/long.md': LONG_MD,
  '/r/big/huge.txt': 'only the index knows how big this is\n',
  '/r/notes/doc.md': `# Notes\n\n${lines(120, (i) => `Paragraph ${i} of the notes.\n`)}`,
  ...Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`/r/many/m${String(i + 1).padStart(2, '0')}.md`, `# Doc ${i + 1}\n\n## Section ${i + 1}\n\nBody ${i + 1}.\n`])),
};
const md = (path, title, extra = {}) => ({ path, root: '/r', title, headings: [], mtimeMs: 1_700_000_000_000, size: Buffer.byteLength(files[path] ?? '', 'utf8'), kind: 'markdown', readerKind: 'article', ...extra });
const entries = [
  md('/r/docs/guide.md', 'Guide', {
    headings: [
      { level: 1, text: 'Guide', byteOffset: 0 },
      { level: 2, text: 'Install', byteOffset: guideOffset('## Install') },
      { level: 3, text: 'Flags', byteOffset: guideOffset('### Flags') },
      { level: 2, text: 'Use', byteOffset: guideOffset('## Use') },
    ],
  }),
  md('/r/docs/faq.md', 'FAQ', { headings: [{ level: 2, text: 'How do I install it?', byteOffset: Buffer.byteLength('# FAQ\n\n', 'utf8') }] }),
  md('/r/src/lib.py', 'lib.py', { kind: 'source', readerKind: 'code' }),
  md('/r/logs/build.log', 'build.log', { kind: 'source', readerKind: 'log' }),
  md('/r/img/remote.md', 'Remote'),
  md('/r/big/long.md', 'Long', { size: 340_000 }),
  md('/r/big/huge.txt', 'huge.txt', { kind: 'text', size: LARGE + 1 }),
  md('/r/notes/doc.md', 'Notes'),
  ...Array.from({ length: 50 }, (_, i) => {
    const path = `/r/many/m${String(i + 1).padStart(2, '0')}.md`;
    return md(path, `Doc ${i + 1}`, { headings: [{ level: 2, text: `Section ${i + 1}`, byteOffset: Buffer.byteLength(`# Doc ${i + 1}\n\n`, 'utf8') }] });
  }),
];

async function withPage(fn, { width = 1440 } = {}) {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    // A wait that cannot be met fails in seconds, not at the suite's cap.
    page.setDefaultTimeout(15_000);
    await fn(page);
  } finally {
    await browser.close();
  }
}

/** Boots the real app and palette on the shipped skeleton over the memory shell, with `open[0]` on screen. */
async function boot(page, { open = '/r/docs/guide.md' } = {}) {
  const base = await harnessBase();
  const { style, body } = shippedSkeleton();
  await page.route(`${base}app.html`, async (route) => {
    const response = await route.fetch();
    const html = (await response.text())
      .replace('</head>', `<style>${style}</style></head>`)
      .replace(/<body[^>]*>/, '<body data-marxy-mode="rendered" data-marxy-variant="dark">')
      .replace('<article id="doc" class="marxy-article"></article>', body);
    await route.fulfill({ response, body: html });
  });
  await page.goto(`${base}app.html`);
  await page.waitForFunction(() => typeof window.marxyApp?.start === 'function');
  const encoded = Object.fromEntries(Object.entries(files).map(([path, text]) => [path, b64(text)]));
  await page.evaluate(
    async ({ encoded, entries, open }) => {
      const bytes = {};
      for (const [path, text] of Object.entries(encoded)) bytes[path] = Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
      const { createMemoryShell } = await import('/src/shell/memory.ts');
      const { bootApplication } = await import('/src/main.ts');
      const handle = await bootApplication(createMemoryShell(bytes), { argv: [open] });
      await handle.ready;
      window.__marxyHandle = handle;
      handle.palette.setIndexEntries(entries);
    },
    { encoded, entries, open },
  );
}

/** The shell calls made since `mark`, as `method path`. */
const callsSince = (page, mark) =>
  page.evaluate((from) => window.__marxyHandle.shell.calls.slice(from).map((c) => ({ method: c.method, path: String(c.args[0]), max: c.args[1] })), mark);
const callCount = (page) => page.evaluate(() => window.__marxyHandle.shell.calls.length);
const reads = (calls) => calls.filter((c) => c.method === 'readHead' || c.method === 'readFile');
const aside = (page) => page.evaluate(() => document.querySelector('#marxy-palette .marxy-palette-aside')?.textContent ?? '');
const waitAside = (page, text) =>
  page.waitForFunction((t) => (document.querySelector('#marxy-palette .marxy-palette-aside')?.textContent ?? '').includes(t), text, { timeout: 8000 });
const openPalette = async (page, query = '') => {
  await page.keyboard.press('ControlOrMeta+KeyP');
  await page.waitForSelector('#marxy-palette[open] .marxy-palette-row');
  if (query !== '') await page.locator('#marxy-palette .marxy-palette-query').fill(query);
};
const selectedRow = (page) =>
  page.evaluate(() => {
    const row = document.querySelector('#marxy-palette .marxy-palette-row[aria-selected="true"]');
    return row === null ? null : { key: row.dataset.rowKey, title: row.querySelector('.marxy-palette-title')?.textContent };
  });

test('highlighting a file row for 200 ms shows its first forty lines, set as code; the keystroke itself reads and redraws nothing, and moves nothing', async () => {
  await withPage(async (page) => {
    await boot(page);
    await page.waitForTimeout(400);
    const before = await page.evaluate(() => document.querySelector('#doc h1').getBoundingClientRect().top);
    const mark = await callCount(page);
    await openPalette(page);
    // The keystroke: the column keeps what it showed (dimmed) and no file is read when the query is typed.
    const atKeystroke = await page.evaluate((from) => {
      const col = document.querySelector('#marxy-palette .marxy-palette-aside');
      const prior = col.textContent;
      const input = document.querySelector('#marxy-palette .marxy-palette-query');
      input.value = 'lib.py';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return {
        unchanged: col.textContent === prior && !col.textContent.includes('x1 = 1'),
        pending: col.hasAttribute('data-marxy-pending'),
        reads: window.__marxyHandle.shell.calls.slice(from).filter((c) => c.method === 'readHead' && c.args[0] === '/r/src/lib.py').length,
      };
    }, mark);
    assert.deepEqual(atKeystroke, { unchanged: true, pending: true, reads: 0 }, 'nothing is read, and nothing redrawn, on the keystroke');
    await waitAside(page, 'x40 = 40');
    const col = await aside(page);
    assert.ok(col.includes('x1 = 1'), 'the first line is shown');
    assert.ok(!col.includes('x41 = 41'), 'and the forty-first is not');
    assert.ok(col.includes('Code') && col.includes('80 lines'), `kind and lines chips: ${col.slice(0, 80)}`);
    // The page's own highlighter coloured it.
    await page.waitForFunction(() => document.querySelector('#marxy-palette .marxy-palette-aside pre [class*="marxy-tok-"]') !== null, null, { timeout: 8000 });
    const shown = await page.evaluate(() => {
      const c = document.querySelector('#marxy-palette .marxy-palette-aside');
      const r = c.getBoundingClientRect();
      return { wide: r.width > 300, pending: c.hasAttribute('data-marxy-pending') };
    });
    assert.deepEqual(shown, { wide: true, pending: false });
    const during = await page.evaluate(() => document.querySelector('#doc h1').getBoundingClientRect().top);
    assert.equal(during, before, 'the text under the palette did not move');
  });
});

test('holding the arrow key over fifty rows reads no file until the key is released', async () => {
  await withPage(async (page) => {
    await boot(page);
    await page.waitForTimeout(400);
    await openPalette(page, '@section');
    await page.waitForFunction(() => document.querySelectorAll('#marxy-palette .marxy-palette-row').length === 50);
    // Let the first row's own preview come and go.
    await waitAside(page, 'Body');
    const mark = await callCount(page);
    const during = await page.evaluate(async (from) => {
      const input = document.querySelector('#marxy-palette .marxy-palette-query');
      // Forty-nine presses in one task, faster than any pause; then a look at the read log inside the pause.
      for (let i = 0; i < 49; i++) input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
      await new Promise((resolve) => setTimeout(resolve, 100));
      return window.__marxyHandle.shell.calls.slice(from).filter((c) => c.method === 'readHead' || c.method === 'readFile').length;
    }, mark);
    assert.equal(during, 0, 'no file was read while the key was held');
    const last = await selectedRow(page);
    assert.equal(last.title, 'Section 50' === last.title ? 'Section 50' : last.title);
    await page.waitForFunction((from) => window.__marxyHandle.shell.calls.slice(from).some((c) => c.method === 'readHead'), mark, { timeout: 8000 });
    await page.waitForTimeout(500);
    const after_ = reads(await callsSince(page, mark));
    assert.equal(after_.length, 1, 'one read, once the key was released');
    assert.equal(`${after_[0].path}`, last.key.slice(0, last.key.lastIndexOf(':')), 'and it was of the row the highlight stopped on');
  });
});

test('a file preview reads at most readHead\'s 256 KB of the highlighted file and nothing else', async () => {
  await withPage(async (page) => {
    await boot(page);
    await page.waitForTimeout(400);
    await openPalette(page);
    const mark = await callCount(page);
    await page.locator('#marxy-palette .marxy-palette-query').fill('long');
    await waitAside(page, 'A sentence that fills the page');
    await page.waitForTimeout(400);
    const calls = await callsSince(page, mark);
    // Marxy's own data directory is not the reader's file: only the reader's documents (`/r/`) are in question.
    const touched = calls.filter((c) => c.path.startsWith('/r/') || c.method === 'readFile' || c.method === 'readDir');
    assert.deepEqual(touched.map((c) => [c.method, c.path, c.max]), [['readHead', '/r/big/long.md', READ_CAP]]);
    const col = await aside(page);
    assert.match(col, /\d[\d,]*\+ words/, 'a read that stopped short says its count is a floor');
  });
});

test('a file over the large-file limit says "Too large to preview" from the index and is not read', async () => {
  await withPage(async (page) => {
    await boot(page);
    await page.waitForTimeout(400);
    await openPalette(page);
    const mark = await callCount(page);
    await page.locator('#marxy-palette .marxy-palette-query').fill('huge.txt');
    await waitAside(page, 'Too large to preview');
    await page.waitForTimeout(300);
    assert.deepEqual(reads(await callsSince(page, mark)).filter((c) => c.path === '/r/big/huge.txt'), []);
    const col = await aside(page);
    assert.ok(col.includes('2.0 MB') || col.includes('MB'), `its size, from the index: ${col}`);
  });
});

test('a preview of a Markdown file with a remote image fetches nothing and leaves no image or link behind', async () => {
  await withPage(async (page) => {
    const external = [];
    const base = await harnessBase();
    await page.route('**/*', async (route) => {
      const url = route.request().url();
      if (url.startsWith(base) || url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('about:')) return route.fallback();
      external.push(url);
      return route.abort();
    });
    await boot(page);
    // The control: the page can be seen making a request, so a quiet list below means something.
    await page.evaluate(() => fetch('https://control.invalid/x').catch(() => {}));
    await page.waitForTimeout(200);
    assert.ok(external.some((u) => u.includes('control.invalid')), 'the harness sees a request when one is made');
    external.length = 0;
    await openPalette(page);
    await page.locator('#marxy-palette .marxy-palette-query').fill('remote');
    await waitAside(page, 'Before');
    await page.waitForTimeout(500);
    assert.deepEqual(external, [], 'nothing left the machine');
    const requested = await page.evaluate(() => performance.getEntriesByType('resource').map((e) => e.name).filter((n) => /logo\.png|x\.png|pic\.png|away/.test(n)));
    assert.deepEqual(requested, [], 'no image was asked for, local or remote');
    const inert = await page.evaluate(() => {
      const col = document.querySelector('#marxy-palette .marxy-palette-aside');
      return { imgs: col.querySelectorAll('img').length, hrefs: col.querySelectorAll('[href], [src]').length, text: col.textContent };
    });
    assert.equal(inert.imgs, 0);
    assert.equal(inert.hrefs, 0, 'no address in the column');
    assert.ok(inert.text.includes('the logo'), 'the image is its alt text');
  });
});

test('`@install` lists each document\'s Install heading with its document, shows the section, and Enter opens the document there; `#install` is this document only', async () => {
  await withPage(async (page) => {
    await boot(page, { open: '/r/docs/guide.md' });
    await page.waitForTimeout(400);
    await openPalette(page, '@install');
    await page.waitForFunction(() => document.querySelectorAll('#marxy-palette .marxy-palette-row').length === 2);
    const rows = await page.evaluate(() =>
      [...document.querySelectorAll('#marxy-palette .marxy-palette-row')].map((r) => [r.querySelector('.marxy-palette-title').textContent, r.querySelector('.marxy-palette-sub').textContent]),
    );
    assert.deepEqual(rows[0], ['Install', 'Guide · r/docs']);
    assert.deepEqual(rows[1], ['How do I install it?', 'FAQ · r/docs']);
    const group = await page.evaluate(() => document.querySelector('#marxy-palette .marxy-palette-section').textContent);
    assert.equal(group, 'Sections everywhere');
    // The section: its heading and text, up to the next heading of its level; not the next section's.
    await waitAside(page, 'Run the installer');
    const col = await aside(page);
    assert.ok(col.includes('Use -f to force'), 'its sub-heading is part of it');
    assert.ok(!col.includes('Use it daily'), 'the next section is not');
    // `#` is this document's headings.
    await page.locator('#marxy-palette .marxy-palette-query').fill('#install');
    await page.waitForFunction(() => document.querySelectorAll('#marxy-palette .marxy-palette-row').length === 1);
    assert.equal(await page.evaluate(() => document.querySelector('#marxy-palette .marxy-palette-title').textContent), 'Install');
    // Enter on the other document's heading opens that document at its heading.
    await page.locator('#marxy-palette .marxy-palette-query').fill('@install');
    await page.waitForFunction(() => document.querySelectorAll('#marxy-palette .marxy-palette-row').length === 2);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.__marxyHandle.currentPath() === '/r/docs/faq.md', null, { timeout: 8000 });
    await page.waitForFunction(() => !document.getElementById('marxy-palette').open);
  });
});

test('a command shows its group and key; a transform shows its result on the first 1,400 characters of the document', async () => {
  await withPage(async (page) => {
    await boot(page, { open: '/r/notes/doc.md' });
    await page.waitForTimeout(400);
    await openPalette(page, '>find in this');
    await waitAside(page, 'Find in this pane');
    const cmd = await aside(page);
    assert.ok(cmd.includes('Find in this pane') && cmd.includes('Enter runs it.'), cmd);
    assert.match(cmd, /Key\s*(⌘F|Ctrl\+F)/);
    await page.locator('#marxy-palette .marxy-palette-query').fill('>Transform: Remove horizontal rules');
    // The first row is the clipboard's twin of the transform; the second is the transform on the document.
    await page.waitForFunction(() => [...document.querySelectorAll('#marxy-palette .marxy-palette-title')].some((e) => e.textContent === 'Transform: Remove horizontal rules'));
    await page.keyboard.press('ArrowDown');
    await waitAside(page, 'Result on the document');
    const result = await page.evaluate(() => document.querySelector('#marxy-palette .marxy-palette-aside').textContent);
    assert.ok(result.includes('the first 1,400 characters of it'), result.slice(0, 200));
    const shown = await page.evaluate(() => document.querySelector('#marxy-palette .marxy-palette-prev-result').textContent);
    assert.ok(shown.length <= 1_400, `the result is of the cut input: ${shown.length}`);
    assert.ok(shown.includes('Paragraph 1 of the notes') && !shown.includes('Paragraph 100 '), 'it begins at the top of the document');
  });
});

test('a narrow palette has no column and reads nothing', async () => {
  await withPage(
    async (page) => {
      await boot(page);
      await page.waitForTimeout(400);
      await openPalette(page);
      const mark = await callCount(page);
      await page.locator('#marxy-palette .marxy-palette-query').fill('lib.py');
      await page.waitForTimeout(700);
      const col = await page.evaluate(() => {
        const el = document.querySelector('#marxy-palette .marxy-palette-aside');
        return { display: getComputedStyle(el).display, text: el.textContent };
      });
      assert.deepEqual(col, { display: 'none', text: '' });
      assert.deepEqual(reads(await callsSince(page, mark)), []);
    },
    { width: 700 },
  );
});

test('looking at previews and closing the palette opens nothing, changes no state and writes nothing', async () => {
  await withPage(async (page) => {
    await boot(page, { open: '/r/docs/guide.md' });
    await page.waitForTimeout(400);
    const state = () => page.evaluate(() => ({ path: window.__marxyHandle.currentPath(), mru: window.__marxyHandle.palette.session.mru, history: window.__marxyHandle.palette.session.history }));
    const before = await state();
    const mark = await callCount(page);
    await openPalette(page, '@section');
    await waitAside(page, 'Body');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(500);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.getElementById('marxy-palette').open);
    assert.deepEqual(await state(), before);
    const written = (await callsSince(page, mark)).filter((c) => /write|rename|remove|mkdir|clipboard/i.test(c.method) && c.path.startsWith('/r/'));
    assert.deepEqual(written, []);
    // And the column is empty again, holding nothing of a document that was only looked at.
    assert.equal(await aside(page), '');
  });
});
