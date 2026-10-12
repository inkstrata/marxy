// A code file opens straight into Source (V-11). Nothing Markdown-shaped is painted for it, a Mod+E is never
// lost, reordered or applied to a document it was not pressed on, an empty file still gets Source, and a Source
// whose grammar will not load stays Source, uncoloured (V-14 round 1). Each test fails on the commit before V-11.
import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
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
const test = (name, fn) => nodeTest(name, { skip }, fn);

const desktopRoot = fileURLToPath(new URL('..', import.meta.url));
const outDir = mkdtempSync(join(tmpdir(), 'marxy-code-open-'));
let server;
let base;
let browser;
/** The built chunk that holds the Python grammar: the test makes its import fail. */
let pythonChunk = null;

before(async () => {
  if (skip) return;
  await build({
    root: desktopRoot,
    logLevel: 'silent',
    build: { outDir, emptyOutDir: true, rollupOptions: { input: { paletteBoot: join(desktopRoot, 'test/palette-boot.html') } } },
  });
  const assets = join(outDir, 'assets');
  const holding = readdirSync(assets).filter((f) => f.endsWith('.js') && readFileSync(join(assets, f), 'utf8').includes('PassStatement'));
  assert.equal(holding.length, 1, `exactly one chunk holds the Python grammar, found ${holding.join(', ') || 'none'}`);
  pythonChunk = holding[0];
  const types = { '.html': 'text/html', '.ttf': 'font/ttf', '.js': 'text/javascript', '.css': 'text/css' };
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

const PY = '# a comment that Markdown would call a heading\n\ndef main():\n    # another\n    return 1\n';
const FILES = {
  '/repo/.git/HEAD': 'ref: refs/heads/main\n',
  '/repo/x.py': PY,
  '/repo/y.py': `# y\n${PY}`,
  '/repo/empty.py': '',
  '/repo/note.md': '# Note\n\nSome words to read.\n',
  '/repo/other.md': '# Other\n\nMore words to read.\n',
};
const b64 = (files) => Object.fromEntries(Object.entries(files).map(([k, v]) => [k, Buffer.from(v, 'utf8').toString('base64')]));

/**
 * A page with the app's harness loaded and nothing started. `page.hold()` holds every script chunk requested
 * from then on (Source's code among them) until `page.release()`, so a test can act while Source is still on
 * its way; `failPython` makes the Python grammar's chunk fail to load.
 */
async function freshPage({ failPython = false } = {}) {
  const page = await browser.newPage({ viewport: { width: 960, height: 800 } });
  await page.goto(`${base}test/palette-boot.html`);
  await page.waitForFunction(() => typeof window.marxyPaletteBoot?.start === 'function');
  const gate = { promise: null, release: () => {}, hits: 0 };
  page.hold = () => {
    gate.hits = 0;
    gate.promise = new Promise((resolve) => { gate.release = resolve; });
  };
  page.release = () => {
    gate.release();
    gate.promise = null;
  };
  /** Resolves once a chunk is being held: Source's code is on its way and has not arrived. */
  page.held = async () => {
    for (let i = 0; i < 200 && gate.hits === 0; i++) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.ok(gate.hits > 0, 'no chunk was requested while held');
  };
  await page.route('**/assets/*.js', async (route) => {
    if (failPython && route.request().url().endsWith(`/${pythonChunk}`)) return route.abort();
    if (gate.promise) {
      gate.hits += 1;
      await gate.promise;
    }
    return route.continue();
  });
  return page;
}

/**
 * Starts the app on `argv` without waiting for it, with a frame sampler running first: for every animation
 * frame, whether an `h1` of the Markdown page was painted and whether Source's editor existed.
 */
async function startSampled(page, files, argv) {
  await page.evaluate(({ f, a }) => {
    window.__frames = [];
    const sample = () => {
      // The heading of a Markdown page made from a code file; the Markdown files' own headings are not it.
      const h1 = [...document.querySelectorAll('#doc h1')].find((h) => !['Note', 'Other'].includes(h.textContent));
      window.__frames.push({
        painted: h1 !== undefined && h1.getClientRects().length > 0,
        editor: document.querySelector('.cm-editor') !== null,
      });
      if (!window.__sampling) return;
      requestAnimationFrame(sample);
    };
    window.__sampling = true;
    requestAnimationFrame(sample);
    window.__started = window.marxyPaletteBoot.start(f, a).then((r) => {
      window.__h = r.handle;
      window.__marks = r.marks;
    });
  }, { f: b64(files), a: argv });
}
const started = (page) => page.evaluate(() => window.__started);
const frames = (page) => page.evaluate(() => window.__frames);
const paintedBeforeEditor = (all) => all.filter((f) => f.painted && !f.editor).length;
const mode = (page) => page.evaluate(() => window.__h.panes().focused.view.mode);
const modifier = (page) => page.evaluate(() => (navigator.platform === 'MacIntel' ? 'Meta' : 'Control'));
const editorShown = (page) =>
  page.evaluate(() => {
    const e = document.querySelector('.cm-editor');
    return e !== null && e.getClientRects().length > 0;
  });
const notices = (page) => page.evaluate(() => [...document.querySelectorAll('.marxy-notice-text')].map((n) => n.textContent));
/** Waits until nothing the mode toggles queued is left to do. */
const drained = (page) => page.evaluate(() => window.__h.panes().focused.view.serially(async () => {}));

test('opening a .py at launch never paints a Markdown heading before Source mounts', async () => {
  const page = await freshPage();
  await startSampled(page, FILES, ['/repo/x.py']);
  await started(page);
  await page.waitForSelector('.cm-editor');
  await page.waitForTimeout(100);
  const all = await frames(page);
  assert.ok(all.length > 3, `frames were sampled (${all.length})`);
  assert.equal(paintedBeforeEditor(all), 0, 'an h1 was painted before .cm-editor appeared');
  assert.equal(await mode(page), 'source');
  assert.equal(await editorShown(page), true);
  assert.equal(await page.evaluate(() => document.querySelector('#doc').children.length), 0, 'the article holds no page');
  assert.equal(await page.evaluate(() => window.__h.document().parsed()), false, 'the Markdown parse of a code file waits for the first ask for Rendered');
  assert.equal(await page.evaluate(() => window.__h.openDocument().path), '/repo/x.py');
  assert.equal(await page.evaluate(() => window.__h.document().parsed()), false, 'asking what is open does not parse it');
  await page.close();
});

test('opening a .py over a Markdown page never paints a heading before Source mounts', async () => {
  const page = await freshPage();
  await startSampled(page, FILES, ['/repo/note.md']);
  await started(page);
  await page.waitForSelector('#doc h1');
  await page.evaluate(() => { window.__frames = []; window.__opened = window.__h.open('/repo/x.py'); });
  await page.evaluate(() => window.__opened);
  await page.waitForSelector('.cm-editor');
  await page.waitForTimeout(100);
  const all = await frames(page);
  assert.ok(all.length > 0);
  assert.equal(paintedBeforeEditor(all), 0, 'an h1 was painted while x.py opened');
  assert.equal(await mode(page), 'source');
  assert.equal(await page.evaluate(() => document.querySelector('.cm-content').textContent.includes('def main')), true);
  assert.equal(await page.evaluate(() => window.__h.document().parsed()), false, 'an open parses a code file no more than a launch does');
  await page.close();
});

test('Mod+E pressed while a .py is still opening does not flip it to Rendered afterwards', async () => {
  const page = await freshPage();
  page.hold();
  await startSampled(page, FILES, ['/repo/x.py']);
  await page.held();
  assert.equal(await page.evaluate(() => document.querySelector('.cm-editor') !== null), false, 'Source had not mounted yet');
  await page.keyboard.press(`${await modifier(page)}+KeyE`);
  page.release();
  await started(page);
  await page.waitForSelector('.cm-editor');
  await drained(page);
  await page.waitForTimeout(150);
  assert.equal(await mode(page), 'source', 'a press made during the open must not undo the mode it opened in');
  assert.equal(await editorShown(page), true);
  await page.close();
});

test('Mod+E pressed while another file is opening is not applied to it', async () => {
  const page = await freshPage();
  await startSampled(page, FILES, ['/repo/note.md']);
  await started(page);
  await page.waitForSelector('#doc h1');
  page.hold();
  await page.evaluate(() => { window.__opened = window.__h.open('/repo/y.py'); });
  await page.held();
  await page.keyboard.press(`${await modifier(page)}+KeyE`);
  page.release();
  await page.evaluate(() => window.__opened);
  await drained(page);
  await page.waitForTimeout(150);
  assert.equal(await mode(page), 'source');
  assert.equal(await editorShown(page), true);
  await page.close();
});

test('two Mod+E presses before Source has mounted end in Rendered', async () => {
  const page = await freshPage();
  await startSampled(page, FILES, ['/repo/note.md']);
  await started(page);
  await page.waitForSelector('#doc h1');
  const mod = await modifier(page);
  page.hold();
  await page.keyboard.press(`${mod}+KeyE`);
  await page.held();
  assert.equal(await page.evaluate(() => document.querySelector('.cm-editor') !== null), false, 'Source had not mounted yet');
  await page.keyboard.press(`${mod}+KeyE`);
  page.release();
  await drained(page);
  await page.waitForTimeout(150);
  assert.equal(await mode(page), 'rendered');
  assert.equal(await editorShown(page), false);
  assert.equal(await page.evaluate(() => document.querySelector('#doc').hidden), false);
  await page.close();
});

for (const [name, file, expected] of [['.md', '/repo/note.md', 'rendered'], ['.py', '/repo/x.py', 'source']]) {
  test(`ten Mod+E presses on a ${name} end where ten flips end`, async () => {
    const page = await freshPage();
    await startSampled(page, FILES, [file]);
    await started(page);
    const mod = await modifier(page);
    assert.equal(await mode(page), expected);
    // Leaving Source folds the editor's text into the store: made slow, a press arrives while the one before it
    // is still under way, as it does when the machine is busy.
    await page.evaluate(() => {
      const store = window.__h.document();
      const commit = store.commitSource.bind(store);
      store.commitSource = async (text) => {
        await new Promise((resolve) => setTimeout(resolve, 60));
        return commit(text);
      };
    });
    // A Markdown file's first Source needs its code, which is held while the presses arrive.
    if (expected === 'rendered') page.hold();
    for (let i = 0; i < 10; i++) await page.keyboard.press(`${mod}+KeyE`);
    if (expected === 'rendered') {
      await page.held();
      page.release();
    }
    await drained(page);
    await page.waitForTimeout(150);
    assert.equal(await mode(page), expected, 'ten flips end where they began');
    assert.equal(await editorShown(page), expected === 'source');
    assert.equal(await page.evaluate(() => document.querySelector('#doc').hidden), expected === 'source');
    await page.close();
  });
}

test('Mod+3 pressed twice before Source has mounted still ends in Source', async () => {
  const page = await freshPage();
  await startSampled(page, FILES, ['/repo/note.md']);
  await started(page);
  const mod = await modifier(page);
  page.hold();
  await page.keyboard.press(`${mod}+Digit3`);
  await page.held();
  await page.keyboard.press(`${mod}+Digit3`);
  page.release();
  await drained(page);
  await page.waitForTimeout(150);
  assert.equal(await mode(page), 'source', 'Source is a mode, not a toggle');
  assert.equal(await editorShown(page), true);
  await page.keyboard.press(`${mod}+Digit1`);
  await page.keyboard.press(`${mod}+Digit1`);
  await drained(page);
  assert.equal(await mode(page), 'rendered');
  await page.close();
});

test('an odd number of presses on a .py ends in Rendered, and Rendered is made then', async () => {
  const page = await freshPage();
  await startSampled(page, FILES, ['/repo/x.py']);
  await started(page);
  const mod = await modifier(page);
  assert.equal(await page.evaluate(() => document.querySelector('#doc').children.length), 0);
  assert.equal(await page.evaluate(() => window.__h.document().parsed()), false);
  for (let i = 0; i < 3; i++) await page.keyboard.press(`${mod}+KeyE`);
  await drained(page);
  assert.equal(await mode(page), 'rendered');
  assert.ok(await page.evaluate(() => document.querySelector('#doc').children.length) > 0, 'the page is made on the first ask for Rendered');
  assert.equal(await page.evaluate(() => window.__h.document().parsed()), true, 'and the parse with it');
  assert.equal(await page.evaluate(() => document.querySelector('#doc').hidden), false);
  await page.close();
});

test('a .py changed on disk while Source shows is reloaded without making a page', async () => {
  const page = await freshPage();
  await startSampled(page, FILES, ['/repo/x.py']);
  await started(page);
  await page.evaluate(async () => {
    const shell = window.__h.shell;
    await shell.writeFileAtomic('/repo/x.py', new TextEncoder().encode('# changed on disk\nvalue = 2\n'));
    shell.emit([{ kind: 'modified', path: '/repo/x.py' }]);
  });
  await page.waitForFunction(() => document.querySelector('.cm-content')?.textContent.includes('value = 2'));
  await page.waitForTimeout(200);
  assert.equal(await mode(page), 'source');
  assert.equal(await page.evaluate(() => document.querySelector('#doc').children.length), 0, 'no page was made for a file nobody is reading as a page');
  await page.keyboard.press(`${await modifier(page)}+KeyE`);
  await drained(page);
  assert.equal(await mode(page), 'rendered');
  assert.ok((await page.evaluate(() => document.querySelector('#doc').textContent)).includes('changed on disk'), 'Rendered is made from the new bytes');
  await page.close();
});

test('an empty .py mounts Source, at launch and by open', async () => {
  const launch = await freshPage();
  await startSampled(launch, FILES, ['/repo/empty.py']);
  await started(launch);
  await launch.waitForSelector('.cm-editor');
  assert.equal(await mode(launch), 'source');
  assert.equal(await editorShown(launch), true);
  await launch.close();

  const opened = await freshPage();
  await startSampled(opened, FILES, ['/repo/note.md']);
  await started(opened);
  await opened.evaluate(() => window.__h.open('/repo/empty.py'));
  await opened.waitForSelector('.cm-editor');
  assert.equal(await mode(opened), 'source');
  assert.equal(await editorShown(opened), true);
  await opened.close();
});

test('a .py launch reports first text from Source', async () => {
  const page = await freshPage();
  await startSampled(page, FILES, ['/repo/x.py']);
  await started(page);
  const names = await page.evaluate(() => window.__marks.map((m) => m.args[0]));
  assert.ok(names.includes('painted'), `marks: ${names.join(', ')}`);
  assert.ok(names.includes('first_text'), `marks: ${names.join(', ')}`);
  assert.ok(names.indexOf('first_text') < names.indexOf('position_restored'), 'first text comes before the rest of the open');
  await page.close();
});

// V-14 round 1: a grammar that will not load costs the colour and nothing else. Source mounts with the exact text.
const editorText = (page) =>
  page.evaluate(() => [...document.querySelectorAll('.cm-content .cm-line')].map((l) => l.textContent).join('\n'));

test('when a grammar will not load, opening a .py still opens Source with the exact text and no notice', async () => {
  const page = await freshPage({ failPython: true });
  await startSampled(page, FILES, ['/repo/note.md']);
  await started(page);
  await page.evaluate(() => window.__h.open('/repo/x.py'));
  await page.waitForSelector('.cm-editor');
  assert.equal(await mode(page), 'source');
  assert.equal(await editorText(page), PY.replace(/\n$/, '\n'));
  assert.equal(await page.evaluate(() => document.querySelector('#doc pre code')), null, 'not the plain-text fallback');
  assert.ok(!(await notices(page)).some((n) => n.includes('Source could not open')), 'no failure notice');
  await page.close();
});

test('when a grammar will not load, a .py launch shows Source with the exact text', async () => {
  const page = await freshPage({ failPython: true });
  await startSampled(page, FILES, ['/repo/x.py']);
  await started(page);
  await page.waitForSelector('.cm-editor');
  assert.equal(await mode(page), 'source');
  assert.equal(await editorText(page), PY);
  assert.ok(!(await notices(page)).some((n) => n.includes('Source could not open')), 'no failure notice');
  await page.close();
});

test('when a grammar will not load, Mod+E still moves between Source and Rendered, with no unhandled rejection', async () => {
  const page = await freshPage({ failPython: true });
  await startSampled(page, FILES, ['/repo/x.py']);
  await started(page);
  await page.waitForSelector('.cm-editor');
  const rejections = [];
  await page.exposeFunction('__rejection', (m) => rejections.push(m));
  await page.evaluate(() => window.addEventListener('unhandledrejection', (e) => window.__rejection(String(e.reason))));
  await page.keyboard.press(`${await modifier(page)}+KeyE`);
  await drained(page);
  assert.equal(await mode(page), 'rendered');
  await page.keyboard.press(`${await modifier(page)}+KeyE`);
  await drained(page);
  assert.equal(await mode(page), 'source');
  assert.equal(await editorText(page), PY);
  assert.deepEqual(rejections, []);
  await page.close();
});

for (const [what, breakIt] of [
  ['watched', (shell) => { shell.watch = async () => { throw new Error('too many watchers'); }; }],
  ['found', (shell) => { shell.configPaths = async () => { throw new Error('no config directory'); }; }],
]) {
  test(`a theme folder that cannot be ${what} does not fail the open`, async () => {
    const page = await freshPage();
    const quiet = (name) => readFileSync(join(desktopRoot, '../../fixtures/themes/quiet', name), 'utf8');
    const files = { ...FILES, '/config': 'theme = "/t/quiet"\n', '/t/quiet/theme.toml': quiet('theme.toml'), '/t/quiet/theme.css': quiet('theme.css') };
    await startSampled(page, files, ['/repo/note.md']);
    await started(page);
    await page.waitForFunction(() => window.__h.shell.calls.some((c) => c.method === 'mark' && c.args[0] === 'user_theme'));
    await page.evaluate(`(${breakIt.toString()})(window.__h.shell)`);
    await page.evaluate(() => window.__h.open('/repo/y.py'));
    await page.waitForSelector('.cm-editor');
    assert.equal(await mode(page), 'source');
    assert.equal(await page.evaluate(() => window.__h.openDocument()?.path), '/repo/y.py');
    const shown = await page.evaluate(() => document.querySelector('#doc').textContent);
    assert.ok(!/Error|no config directory|too many watchers/.test(shown), `the page says: ${shown}`);
    assert.equal(await editorShown(page), true);
    await page.close();
  });
}

test('Rendered of a .py is the code, byte for byte, in one highlighted block with no heading (V-10)', async () => {
  const page = await freshPage();
  const py = '# Inventory\n\n## section one\ndef f():\n\t# tab comment *not emphasis*\n    return 1  # _x_\n';
  await startSampled(page, { ...FILES, '/repo/inv.py': py }, ['/repo/inv.py']);
  await started(page);
  for (let i = 0; i < 3; i++) await page.keyboard.press(`${await modifier(page)}+KeyE`);
  await drained(page);
  assert.equal(await mode(page), 'rendered');
  await page.waitForFunction(() => document.querySelector('#doc pre > code')?.dataset.marxyDone === 'highlight', null, { timeout: 15000 });
  const seen = await page.evaluate(() => ({
    headings: document.querySelectorAll('#doc h1, #doc h2, #doc h3').length,
    blocks: document.querySelectorAll('#doc pre').length,
    others: [...document.querySelector('#doc').children].filter((c) => c.tagName !== 'PRE').map((c) => c.tagName),
    text: document.querySelector('#doc pre > code').textContent,
    lang: document.querySelector('#doc pre > code').className,
    ranges: [document.querySelector('#doc pre > code').dataset.marxyS, document.querySelector('#doc pre > code').dataset.marxyE],
    coloured: document.querySelectorAll('#doc pre > code span[class^="marxy-tok-"]').length,
  }));
  assert.equal(seen.headings, 0, 'a # comment is not a heading');
  assert.equal(seen.blocks, 1, 'one block covers the file');
  assert.deepEqual(seen.others, []);
  assert.equal(seen.text, py, 'the file text, byte for byte, tabs and underscores kept');
  assert.match(seen.lang, /language-python/);
  assert.deepEqual(seen.ranges, ['0', String(new TextEncoder().encode(py).length)]);
  assert.ok(seen.coloured > 0, 'the code is coloured by role');
  assert.equal(await page.evaluate(() => document.querySelectorAll('.marxy-outline-item, #outline li').length), 0, 'a code file has no outline yet (K-13)');
  await page.close();
});

/** The article's top-level elements, by tag. */
const pageTags = (page) => page.evaluate(() => [...document.querySelector('#doc').children].map((c) => c.tagName));

test('Save As that makes a Markdown page a code file, or the reverse, sets the page again (V-10)', async () => {
  const page = await freshPage();
  await startSampled(page, FILES, ['/repo/note.md']);
  await started(page);
  await page.waitForSelector('#doc h1');
  const key = await modifier(page);
  await page.evaluate(() => window.__h.shell.queueSaveDialog('/repo/note2.py'));
  await page.keyboard.press(`${key}+Shift+KeyS`);
  await page.waitForFunction(() => window.__h.openDocument().path === '/repo/note2.py');
  await drained(page);
  await page.waitForFunction(() => document.querySelector('#doc pre') !== null);
  assert.deepEqual(await pageTags(page), ['PRE'], 'a .py is code, not the Markdown page it was');
  assert.equal(await page.evaluate(() => document.querySelectorAll('#doc h1').length), 0);
  await page.evaluate(() => window.__h.shell.queueSaveDialog('/repo/note3.md'));
  await page.keyboard.press(`${key}+Shift+KeyS`);
  await page.waitForFunction(() => window.__h.openDocument().path === '/repo/note3.md');
  await drained(page);
  await page.waitForFunction(() => document.querySelector('#doc h1') !== null);
  assert.deepEqual(await pageTags(page), ['H1', 'P'], 'a .md is read as Markdown again');
  await page.close();
});

test('a long .py is pieces of 200 lines drawn as one block, and .log and .html stay as they were (V-10)', async () => {
  const page = await freshPage();
  const long = Array.from({ length: 450 }, (_, i) => `x${i} = ${i}  # line`).join('\n') + '\n';
  const files = { ...FILES, '/repo/long.py': long, '/repo/a.log': '# not a heading\nline\n', '/repo/a.html': '<h2>Hello</h2>\n' };
  await startSampled(page, files, ['/repo/long.py']);
  await started(page);
  for (let i = 0; i < 3; i++) await page.keyboard.press(`${await modifier(page)}+KeyE`);
  await drained(page);
  await page.waitForSelector('#doc pre.marxy-run');
  const seen = await page.evaluate(() => {
    const pres = [...document.querySelectorAll('#doc pre')];
    const gap = pres.length > 1 ? pres[1].getBoundingClientRect().top - pres[0].getBoundingClientRect().bottom : null;
    return { n: pres.length, runs: pres.every((p) => p.classList.contains('marxy-run')), gap, text: pres.map((p) => p.textContent).join('') };
  });
  assert.equal(seen.n, 3);
  assert.ok(seen.runs);
  assert.equal(seen.gap, 0, 'the pieces meet with no gap');
  assert.equal(seen.text, long, 'the pieces together are the file');
  for (const [path, check] of [['/repo/a.log', () => document.querySelectorAll('#doc h1').length], ['/repo/a.html', () => document.querySelectorAll('#doc h2').length]]) {
    await page.evaluate((p) => window.__h.open(p), path);
    await drained(page);
    if ((await mode(page)) === 'source') for (let i = 0; i < 1; i++) await page.keyboard.press(`${await modifier(page)}+KeyE`);
    await drained(page);
    assert.equal(await page.evaluate(() => document.querySelectorAll('#doc pre.marxy-run').length), 0, `${path} is not read as code`);
  }
  await page.close();
});

test('text typed in a .py before the parse was ever made is saved as typed, and Rendered parses it', async () => {
  const page = await freshPage();
  await startSampled(page, FILES, ['/repo/x.py']);
  await started(page);
  await page.locator('.cm-content').click();
  await page.keyboard.press(`${await modifier(page)}+ArrowUp`);
  await page.keyboard.type('# typed\n');
  await page.keyboard.press(`${await modifier(page)}+KeyE`);
  await drained(page);
  assert.equal(await mode(page), 'rendered');
  assert.ok((await page.evaluate(() => document.querySelector('#doc').textContent)).includes('typed'));
  const bytes = await page.evaluate(() => new TextDecoder().decode(window.__h.document().snapshot().buffer.bytes));
  assert.equal(bytes, `# typed\n${PY}`);
  await page.close();
});
