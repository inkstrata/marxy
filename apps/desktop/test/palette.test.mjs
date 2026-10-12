// Palette view: real document mount, ADR-0011 tab-bar assertion, keys, and keystroke perf (MARXY-87).
import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { build } from 'vite';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { updateRecord } from '../../../scripts/lib/perf-record.mjs';
import { togglePin, recordOpen, emptySession, goBack, goForward } from '../src/palette/session.ts';
import { paletteResults } from '../src/palette/search.ts';
import { historyDirection } from '../src/palette/keys.ts';

const desktopRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = join(desktopRoot, '..', '..');

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip }, fn);

const outDir = mkdtempSync(join(tmpdir(), 'marxy-palette-'));
let server;
let base;

const HEADING_DOC = `# Doc

${'Long line of prose to push the heading down the page.\n\n'.repeat(80)}## Acceptance

Body under the heading.
`;

function machineFactor() {
  const run = () => {
    const started = performance.now();
    let sink = 0;
    for (let round = 0; round < 3000; round++) {
      let line = '';
      for (const word of 'the quick brown fox jumps over the lazy dog'.split(' ')) {
        line += `${word} *${word}* \`${word}\` `;
      }
      for (const match of line.matchAll(/[*`]\w+[*`]/g)) sink += match.index ?? 0;
    }
    return performance.now() - started;
  };
  run();
  const runs = [run(), run(), run(), run(), run()].sort((a, b) => a - b);
  return Math.max(1, runs[2] / 4.3);
}

function makeEntry(i) {
  const dir = i % 200;
  return {
    path: `/repo/d${dir}/file-${i}.md`,
    root: i % 19 === 0 ? '/other' : '/repo',
    title: `Title ${i % 97} document ${i}`,
    headings: [
      { level: 2, text: `Heading ${i % 53} section`, byteOffset: 16 },
      { level: 3, text: `Detail ${i % 31}`, byteOffset: 48 },
    ],
    mtimeMs: 1_700_000_000_000 + i,
    size: 200 + (i % 500),
    kind: 'markdown',
  };
}

function modChord(platform) {
  return platform === 'MacIntel' ? 'Meta' : 'Control';
}

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
          index: join(desktopRoot, 'index.html'),
          app: join(desktopRoot, 'app.html'),
          paletteBoot: join(desktopRoot, 'test/palette-boot.html'),
        },
      },
    },
  });
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

nodeTest('production desktop sources omit MiniNode and a hand-written selector engine', () => {
  const forbidden = ['MiniNode', 'splitSelectors', 'class MiniNode', 'function walk('];
  const walkDir = (dir) => {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, name.name);
      if (name.isDirectory()) {
        if (name.name === 'node_modules' || name.name === 'test') continue;
        walkDir(full);
        continue;
      }
      if (!/\.(ts|tsx|mjs|js)$/.test(name.name) || /\.test\.(ts|mjs)$/.test(name.name)) continue;
      const text = readFileSync(full, 'utf8');
      for (const token of forbidden) {
        assert.ok(!text.includes(token), `${full} must not contain ${token}`);
      }
    }
  };
  walkDir(join(desktopRoot, 'src'));
});

nodeTest('empty query lists pinned paths before MRU (model)', () => {
  let session = emptySession('/repo');
  session = recordOpen(session, '/repo/old.md');
  session = recordOpen(session, '/repo/mid.md');
  session = recordOpen(session, '/repo/new.md');
  session = togglePin(session, '/repo/old.md');
  const entries = [
    { path: '/repo/old.md', root: '/repo', title: 'Old', headings: [], mtimeMs: 1, size: 1, kind: 'markdown' },
    { path: '/repo/mid.md', root: '/repo', title: 'Mid', headings: [], mtimeMs: 1, size: 1, kind: 'markdown' },
    { path: '/repo/new.md', root: '/repo', title: 'New', headings: [], mtimeMs: 1, size: 1, kind: 'markdown' },
  ];
  const hits = paletteResults('', entries, session);
  assert.deepEqual(
    hits.map((hit) => hit.entry.path),
    ['/repo/old.md', '/repo/new.md', '/repo/mid.md'],
  );
});

test('bootApplication mounts dialog#marxy-palette; Mod+P summons input and list', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 760 } });
    await page.goto(`${base}test/palette-boot.html`);
    await page.waitForFunction(() => typeof window.marxyPaletteBoot?.start === 'function');
    await page.evaluate(async ({ doc, argv }) => {
      await window.marxyPaletteBoot.start(
        { '/docs/readme.md': doc },
        argv,
        [{ path: '/docs/readme.md', root: '/docs', title: 'Readme', headings: [{ level: 2, text: 'Acceptance', byteOffset: 10 }], mtimeMs: 1, size: 1, kind: 'markdown' }],
      );
    }, { doc: Buffer.from(HEADING_DOC).toString('base64'), argv: ['/docs/readme.md'] });

    const mod = modChord(await page.evaluate(() => navigator.platform));
    await page.keyboard.press(`${mod}+KeyP`);
    const summoned = await page.evaluate(() => {
      const dialog = document.querySelector('#marxy-palette');
      return {
        open: dialog?.open === true,
        input: dialog?.querySelector('input') !== null,
        list: dialog?.querySelector('ol.marxy-palette-results') !== null,
        tabBar: document.querySelector('[role=tablist], [role=tab], .tab-bar, #marxy-tabs'),
      };
    });
    assert.equal(summoned.open, true);
    assert.equal(summoned.input, true);
    assert.equal(summoned.list, true);
    assert.equal(summoned.tabBar, null);
  } finally {
    await browser.close();
  }
});

test('Mod+K and Mod+P toggle the palette; Mod+Shift+P opens it on commands and Mod+/ on the transforms (W-19, W-21), from Rendered and from Source', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 760 } });
    await page.goto(`${base}test/palette-boot.html`);
    await page.waitForFunction(() => typeof window.marxyPaletteBoot?.start === 'function');
    await page.evaluate(async ({ doc, argv }) => {
      await window.marxyPaletteBoot.start({ '/docs/readme.md': doc }, argv, []);
    }, { doc: Buffer.from(HEADING_DOC).toString('base64'), argv: ['/docs/readme.md'] });
    const mod = modChord(await page.evaluate(() => navigator.platform));
    const state = () =>
      page.evaluate(() => ({
        open: document.querySelector('#marxy-palette')?.open === true,
        query: document.querySelector('#marxy-palette .marxy-palette-query')?.value,
        rows: document.querySelectorAll('#marxy-palette .marxy-palette-row').length,
        mode: document.body.dataset.marxyMode,
      }));
    const press = async (chord) => { await page.keyboard.press(chord); await page.waitForTimeout(50); };

    for (const where of ['rendered', 'source']) {
      if (where === 'source') {
        await press(`${mod}+KeyE`);
        await page.waitForSelector('#marxy-source .cm-content');
        await page.click('#marxy-source .cm-content');
        assert.equal((await state()).mode, 'source');
      }
      for (const chord of [`${mod}+KeyK`, `${mod}+KeyP`]) {
        await press(chord);
        assert.equal((await state()).open, true, `${chord} opens in ${where}`);
        await press(chord);
        assert.equal((await state()).open, false, `${chord} again closes in ${where}`);
      }
      // Mod+Shift+P opens on every command; Mod+/ on the transforms (W-21).
      for (const [chord, query] of [[`${mod}+Shift+KeyP`, '>'], [`${mod}+Slash`, '>Transform']]) {
        await press(chord);
        const opened = await state();
        assert.equal(opened.open, true, `${chord} opens in ${where}`);
        assert.equal(opened.query, query, `${chord} types ${query} in ${where}`);
        assert.ok(opened.rows > 0, `${chord} lists commands in ${where}`);
        await press(chord);
        assert.equal((await state()).open, false, `${chord} again closes in ${where}`);
      }
    }
    // In Source, Mod+/ opened the palette and did not toggle a comment: the document is unchanged.
    const lines = await page.evaluate(() => [...document.querySelectorAll('#marxy-source .cm-line')].map((l) => l.textContent));
    assert.equal(lines[0], '# Doc');
    assert.ok(lines.every((l) => !l.includes('<!--')), 'no comment was toggled');
  } finally {
    await browser.close();
  }
});

test('the palette chords work from the find field and with a typed query open (W-19.1)', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 760 } });
    await page.goto(`${base}test/palette-boot.html`);
    await page.waitForFunction(() => typeof window.marxyPaletteBoot?.start === 'function');
    await page.evaluate(async ({ doc, argv }) => {
      await window.marxyPaletteBoot.start({ '/docs/readme.md': doc }, argv, []);
    }, { doc: Buffer.from(HEADING_DOC).toString('base64'), argv: ['/docs/readme.md'] });
    const mod = modChord(await page.evaluate(() => navigator.platform));
    const state = () =>
      page.evaluate(() => ({
        open: document.querySelector('#marxy-palette')?.open === true,
        query: document.querySelector('#marxy-palette .marxy-palette-query')?.value,
      }));
    const press = async (chord) => { await page.keyboard.press(chord); await page.waitForTimeout(50); };

    // From inside the find field each chord still opens the palette.
    await press(`${mod}+KeyF`);
    await page.waitForSelector('.marxy-find input');
    for (const [chord, query] of [[`${mod}+KeyK`, ''], [`${mod}+KeyP`, ''], [`${mod}+Shift+KeyP`, '>'], [`${mod}+Slash`, '>Transform']]) {
      await page.focus('.marxy-find input');
      await press(chord);
      const opened = await state();
      assert.equal(opened.open, true, `${chord} opens from the find field`);
      assert.equal(opened.query, query, `${chord} opens on ${JSON.stringify(query)} from the find field`);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(50);
      assert.equal((await state()).open, false);
    }

    // With the palette open on a typed query, Mod+/ and Mod+Shift+P reset it, and Mod+K closes it.
    await press(`${mod}+KeyK`);
    await page.keyboard.type('doc');
    await press(`${mod}+Slash`);
    assert.deepEqual(await state(), { open: true, query: '>Transform' });
    await press(`${mod}+Shift+KeyP`);
    assert.deepEqual(await state(), { open: true, query: '>' });
    await press(`${mod}+KeyK`);
    assert.equal((await state()).open, false);
  } finally {
    await browser.close();
  }
});

test('a row shows the kind its index entry recorded (K-05a); the path decides only for an entry that records none', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 800 } });
    await page.goto(`${base}test/palette-boot.html`);
    await page.waitForFunction(() => typeof window.marxyPaletteBoot?.start === 'function');
    await page.evaluate(async ({ doc }) => {
      await window.marxyPaletteBoot.start({ '/docs/readme.md': doc }, ['/docs/readme.md'], []);
      const entry = (name, extra) => ({ path: `/docs/${name}`, root: '/docs', title: name, headings: [], mtimeMs: 1, size: 1, kind: 'markdown', ...extra });
      window.__marxyPalette.setIndexEntries([
        entry('session.md', { readerKind: 'transcript' }),
        entry('plain.md'),
      ]);
    }, { doc: Buffer.from(HEADING_DOC).toString('base64') });
    const mod = modChord(await page.evaluate(() => navigator.platform));
    await page.keyboard.press(`${mod}+KeyP`);
    await page.fill('#marxy-palette .marxy-palette-query', 'm');
    const kinds = await page.$$eval('#marxy-palette .marxy-palette-row', (els) =>
      Object.fromEntries(els.map((el) => [el.dataset.rowKey, el.querySelector('svg')?.dataset.marxyKind ?? null])));
    assert.equal(kinds['/docs/session.md:doc'], 'transcript', 'the recorded kind, not the path\'s article');
    assert.equal(kinds['/docs/plain.md:doc'], 'article', 'no recorded kind falls back to the path');
  } finally {
    await browser.close();
  }
});

test('Tab toggles documents and headings; Enter on a heading scrolls to the reading line', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 800 } });
    await page.goto(`${base}test/palette-boot.html`);
    await page.waitForFunction(() => typeof window.marxyPaletteBoot?.start === 'function');
    await page.evaluate(async ({ doc }) => {
      await window.marxyPaletteBoot.start({ '/docs/readme.md': doc }, ['/docs/readme.md'], []);
      const byteOffset = Number(document.querySelector('#doc h2')?.getAttribute('data-marxy-s') ?? 0);
      window.__marxyPalette.setIndexEntries([
        {
          path: '/docs/readme.md',
          root: '/docs',
          title: 'Doc',
          headings: [{ level: 2, text: 'Acceptance', byteOffset }],
          mtimeMs: 1,
          size: 1,
          kind: 'markdown',
        },
      ]);
    }, { doc: Buffer.from(HEADING_DOC).toString('base64') });

    const mod = modChord(await page.evaluate(() => navigator.platform));
    await page.keyboard.press(`${mod}+KeyP`);
    await page.fill('#marxy-palette .marxy-palette-query', 'accept');
    await page.keyboard.press('Tab');
    const rows = await page.$$eval('#marxy-palette .marxy-palette-row', (els) => els.map((el) => el.textContent));
    assert.ok(rows.length > 0 && rows.some((row) => row.includes('Acceptance')));
    const before = await page.evaluate(() => {
      document.documentElement.scrollTop = 0;
      const target = document.querySelector('#doc h2');
      const line = 0.4 * window.innerHeight;
      return target instanceof HTMLElement
        ? Math.abs(target.getBoundingClientRect().top - line)
        : Number.POSITIVE_INFINITY;
    });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(250);
    const after = await page.evaluate(() => {
      const target = document.querySelector('#doc h2');
      const line = 0.4 * window.innerHeight;
      return {
        scrollTop: document.documentElement.scrollTop,
        delta: target instanceof HTMLElement ? Math.abs(target.getBoundingClientRect().top - line) : null,
      };
    });
    assert.ok(
      after.delta !== null && after.scrollTop > 80 && after.delta < before * 0.2,
      `heading should move to the reading line (before=${before}, scrollTop=${after.scrollTop}, delta=${after.delta})`,
    );
  } finally {
    await browser.close();
  }
});

test('Mod+. with no hit selected does not pin an empty path', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 800 } });
    await page.goto(`${base}test/palette-boot.html`);
    await page.waitForFunction(() => typeof window.marxyPaletteBoot?.start === 'function');
    await page.evaluate(async ({ doc }) => {
      // No index entries at all: the palette's document-phase hits are always [].
      await window.marxyPaletteBoot.start({ '/docs/readme.md': doc }, ['/docs/readme.md'], []);
    }, { doc: Buffer.from(HEADING_DOC).toString('base64') });

    const mod = modChord(await page.evaluate(() => navigator.platform));
    await page.keyboard.press(`${mod}+KeyP`);
    await page.keyboard.press(`${mod}+Period`);
    const pinned = await page.evaluate(() => window.__marxyPalette.session.pinned);
    assert.deepEqual(pinned, []);
  } finally {
    await browser.close();
  }
});

nodeTest('Mod+[ / Mod+] map to history and the session stack walks back and forward', () => {
  assert.equal(
    historyDirection({ key: '[', metaKey: false, ctrlKey: true, altKey: false, shiftKey: false }),
    'back',
  );
  assert.equal(
    historyDirection({ key: ']', metaKey: false, ctrlKey: true, altKey: false, shiftKey: false }),
    'forward',
  );
  let session = emptySession('/docs');
  session = recordOpen(session, '/docs/a.md');
  session = recordOpen(session, '/docs/b.md');
  session = recordOpen(session, '/docs/c.md');
  const back = goBack(session);
  assert.equal(back?.path, '/docs/b.md');
  const forward = goForward(back.session);
  assert.equal(forward?.path, '/docs/c.md');
});

test('keystroke to rows painted p95 stays under 16 ms on a 20k index', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 760 } });
    await page.goto(`${base}test/palette-boot.html`);
    await page.waitForFunction(() => typeof window.marxyPaletteBoot?.start === 'function');
    const entries = Array.from({ length: 20_000 }, (_, i) => makeEntry(i));
    await page.evaluate(async ({ doc, indexEntries }) => {
      await window.marxyPaletteBoot.start({ '/docs/readme.md': doc }, ['/docs/readme.md'], indexEntries);
    }, { doc: Buffer.from(HEADING_DOC).toString('base64'), indexEntries: entries });

    const mod = modChord(await page.evaluate(() => navigator.platform));
    await page.keyboard.press(`${mod}+KeyP`);
    const samples = await page.evaluate(async () => {
      const input = document.querySelector('#marxy-palette .marxy-palette-query');
      if (!(input instanceof HTMLInputElement)) throw new Error('missing palette input');
      const queries = ['title 1', 'file-300', 'heading 12', 'detail', 'document 99', 'section', 't', 'md'];
      const lat = [];
      for (let i = 0; i < 50; i++) {
        const q = queries[i % queries.length];
        const t0 = performance.now();
        input.value = q;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        lat.push(performance.now() - t0);
      }
      lat.sort((a, b) => a - b);
      const p95 = lat[Math.min(lat.length - 1, Math.ceil(0.95 * lat.length) - 1)];
      return { p95, lat };
    });
    // Recorded, not a CI failure (ADR-0032): the 16 ms product budget is printed beside the number.
    // What does fail is a measurement that did not happen — too few samples, or no number at all.
    const budget = 16 * Math.max(machineFactor(), 2.5);
    assert.equal(samples.lat.length, 50, 'every keystroke was measured');
    assert.ok(Number.isFinite(samples.p95) && samples.p95 > 0, `palette keystroke p95 was not measured (${samples.p95})`);
    console.log(`palette keystroke p95 ${samples.p95.toFixed(1)} ms (16 ms product budget, ${budget.toFixed(1)} ms envelope here; recorded, ADR-0032)`);
    // Written whole (temp file, then rename): core's parse test updates the same file at the same time.
    updateRecord(join(repoRoot, 'results/perf.json'), (record) => ({
      env_class: record.env_class ?? 'reference',
      palette_keystroke_ms: Math.round(samples.p95 * 100) / 100,
    }));
  } finally {
    await browser.close();
  }
});

// A-12: `>` lists every command whose `when` holds, each with its key.
const CMD_DOC = '# Title\n\nParagraph with **bold** text.\n';
const HTML_DOC = '# Title\n\n<details><summary>More</summary>Hidden body.</details>\n';

async function bootCommands(page, files, argv) {
  await page.goto(`${base}test/palette-boot.html`);
  await page.waitForFunction(() => typeof window.marxyPaletteBoot?.start === 'function');
  await page.evaluate(async ({ files, argv }) => {
    window.__b = await window.marxyPaletteBoot.start(files, argv, []);
  }, { files, argv });
  return modChord(await page.evaluate(() => navigator.platform));
}

async function commandRows(page, mod, query = '>') {
  if (!(await page.evaluate(() => document.getElementById('marxy-palette').open))) {
    await page.keyboard.press(`${mod}+KeyP`);
  }
  await page.fill('#marxy-palette .marxy-palette-query', query);
  return page.$$eval('#marxy-palette .marxy-palette-row', (els) =>
    els.map((el) => ({
      title: el.querySelector('.marxy-palette-title')?.textContent ?? el.textContent,
      key: el.querySelector('.marxy-palette-key')?.textContent ?? null,
    })),
  );
}

const b64Doc = (text) => Buffer.from(text).toString('base64');

test('with a document open, > lists Save with its key and Toggle line numbers in Source', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 760 } });
    const mod = await bootCommands(page, { '/docs/readme.md': b64Doc(CMD_DOC) }, ['/docs/readme.md']);
    const rows = await commandRows(page, mod);
    const save = rows.find((r) => r.title === 'Save');
    assert.ok(save, `Save is listed: ${JSON.stringify(rows)}`);
    assert.match(save.key, /^(⌘S|Ctrl\+S)$/);
    assert.ok(rows.some((r) => r.title === 'Toggle line numbers in Source'));
    const filtered = await commandRows(page, mod, '>line num');
    assert.deepEqual(filtered.map((r) => r.title), ['Toggle line numbers in Source']);
  } finally {
    await browser.close();
  }
});

test('> lists Revoke after a trust grant', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 760 } });
    const docPath = '/docs/html.md';
    const trust = JSON.stringify({ version: 1, documents: { [docPath]: { html: true, imageHosts: [], at: 1 } } });
    const mod = await bootCommands(
      page,
      { [docPath]: b64Doc(HTML_DOC), '/data/trust.json': b64Doc(`${trust}\n`) },
      [docPath],
    );
    await page.waitForFunction(() => document.querySelector('#doc details'));
    const rows = await commandRows(page, mod);
    assert.ok(rows.some((r) => /^Stop showing HTML/.test(r.title)), JSON.stringify(rows));
  } finally {
    await browser.close();
  }
});

test('> lists Jump to source once a block is selected', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 760 } });
    const mod = await bootCommands(page, { '/docs/readme.md': b64Doc(CMD_DOC) }, ['/docs/readme.md']);
    assert.ok(!(await commandRows(page, mod)).some((r) => r.title === 'Jump to source'));
    await page.keyboard.press('Escape');
    await page.locator('#doc p[data-marxy-s]').first().click();
    const rows = await commandRows(page, mod);
    assert.ok(rows.some((r) => r.title === 'Jump to source'), JSON.stringify(rows));
  } finally {
    await browser.close();
  }
});

test('with no document, > lists no Save and throws nothing', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 760 } });
    const errors = [];
    page.on('pageerror', (err) => errors.push(String(err)));
    const mod = await bootCommands(page, {}, []);
    const rows = await commandRows(page, mod);
    assert.ok(!rows.some((r) => r.title === 'Save' || r.title === 'Save as'), JSON.stringify(rows));
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test('running Toggle line numbers in Source from the palette shows the gutter', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 760 } });
    const mod = await bootCommands(page, { '/docs/readme.md': b64Doc(CMD_DOC) }, ['/docs/readme.md']);
    // The command reconfigures the editor the app made; it makes none of its own (F-12), so Source is entered first.
    await page.evaluate(async () => { await window.__b.handle.toggleMode(); });
    await page.waitForFunction(() => document.body.dataset.marxyMode === 'source' && document.querySelector('#marxy-source .cm-content'));
    assert.equal(await page.evaluate(() => document.querySelector('#marxy-source .cm-lineNumbers') !== null), false);
    await commandRows(page, mod, '>line numbers');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('#marxy-source .cm-lineNumbers') !== null, null, { timeout: 5000 });
    assert.equal(await page.evaluate(() => document.getElementById('marxy-palette').open), false);
  } finally {
    await browser.close();
  }
});

test('opening a hit in root /b makes /b current, and /b hits then sort first (A-06)', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 800 } });
    await page.goto(`${base}test/palette-boot.html`);
    await page.waitForFunction(() => typeof window.marxyPaletteBoot?.start === 'function');
    const doc = Buffer.from(HEADING_DOC).toString('base64');
    await page.evaluate(async ({ doc }) => {
      await window.marxyPaletteBoot.start(
        { '/a/guide.md': doc, '/b/guide.md': doc, '/a/start.md': doc },
        ['/a/start.md'],
        [],
      );
      const entry = (path, root) => ({ path, root, title: 'guide', headings: [], mtimeMs: 1, size: 1, kind: 'markdown' });
      window.__marxyPalette.setIndexEntries([entry('/a/guide.md', '/a'), entry('/b/guide.md', '/b')]);
    }, { doc });

    const mod = modChord(await page.evaluate(() => navigator.platform));
    const keys = () => page.$$eval('#marxy-palette .marxy-palette-row', (els) => els.map((el) => el.dataset.rowKey));
    await page.keyboard.press(`${mod}+KeyP`);
    await page.fill('#marxy-palette .marxy-palette-query', 'guide');
    assert.deepEqual(await keys(), ['/a/guide.md:doc', '/b/guide.md:doc']);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(250);
    assert.equal(await page.evaluate(() => window.__marxyPalette.session.currentRoot), '/b');

    await page.keyboard.press(`${mod}+KeyP`);
    await page.fill('#marxy-palette .marxy-palette-query', 'guide');
    assert.deepEqual(await keys(), ['/b/guide.md:doc', '/a/guide.md:doc']);
  } finally {
    await browser.close();
  }
});

// C-12: the empty palette shows Pinned, Changed since you read and Recent, each row with its age.
const EMPTY_DOC = '# Doc\n\nBody.\n';

async function bootEmptyState(page) {
  await page.goto(`${base}test/palette-boot.html`);
  await page.waitForFunction(() => typeof window.marxyPaletteBoot?.start === 'function');
  return page.evaluate(async ({ doc }) => {
    const files = Object.fromEntries(
      ['readme', 'pin-doc', 'ch1', 'ch2', 'old-doc', 'far'].map((name) => [`/docs/${name}.md`, doc]),
    );
    files['/far/far.md'] = doc;
    const boot = await window.marxyPaletteBoot.start(files, ['/docs/readme.md'], []);
    window.__b = boot;
    const now = Date.now();
    // The reader's folder is watched and was first indexed an hour ago; /far is not watched at all.
    boot.handle.index.isWatched = (root) => root === '/docs';
    boot.handle.index.baselineMs = (root) => (root === '/docs' ? now - 3_600_000 : undefined);
    const entry = (path, root, mtimeMs) => ({ path, root, title: path.split('/').pop().replace('.md', ''), headings: [], mtimeMs, size: 1, kind: 'markdown' });
    window.__marxyPalette.setIndexEntries([
      entry('/docs/readme.md', '/docs', now - 5 * 86_400_000),
      entry('/docs/pin-doc.md', '/docs', now - 9 * 86_400_000),
      entry('/docs/ch1.md', '/docs', now - 125_000),
      entry('/docs/ch2.md', '/docs', now - 2_400_000),
      entry('/docs/old-doc.md', '/docs', now - 20 * 86_400_000),
      entry('/far/far.md', '/far', now - 60_000),
    ]);
    return now;
  }, { doc: b64Doc(EMPTY_DOC) });
}

const listShape = (page) =>
  page.$$eval('#marxy-palette .marxy-palette-section, #marxy-palette .marxy-palette-row', (els) =>
    els.map((el) => (el.classList.contains('marxy-palette-section') ? `label:${el.textContent}` : `row:${el.dataset.rowKey}`)),
  );
const selectedKey = (page) =>
  page.$eval('#marxy-palette [aria-selected]', (el) => el.dataset.rowKey);

test('the empty palette shows its three labels in order, arrows skip labels, and an opened changed row moves to Recent (C-12)', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 800 } });
    await bootEmptyState(page);
    const mod = modChord(await page.evaluate(() => navigator.platform));
    const input = '#marxy-palette .marxy-palette-query';

    // Open one old file so it is Recent, then pin another through the typed list.
    await page.keyboard.press(`${mod}+KeyP`);
    await page.fill(input, 'old-doc');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => !document.getElementById('marxy-palette').open);
    await page.keyboard.press(`${mod}+KeyP`);
    await page.fill(input, 'pin-doc');
    await page.keyboard.press(`${mod}+Period`);
    await page.fill(input, '');

    const shape = await listShape(page);
    const at = (needle) => shape.findIndex((item) => item.includes(needle));
    assert.deepEqual(
      shape.filter((item) => item.startsWith('label:')),
      ['label:Pinned', 'label:Changed since you read', 'label:Recent', 'label:Suggested'],
    );
    assert.ok(at('label:Pinned') < at('pin-doc') && at('pin-doc') < at('label:Changed'), JSON.stringify(shape));
    assert.deepEqual(shape.slice(at('label:Changed') + 1, at('label:Recent')), ['row:/docs/ch1.md:doc', 'row:/docs/ch2.md:doc'], 'newest change first; the unwatched /far file is not here');
    assert.ok(shape.slice(at('label:Suggested') + 1).every((item) => item.startsWith('row:view.')), `Suggested holds commands: ${JSON.stringify(shape)}`);
    assert.ok(shape.indexOf('row:/docs/old-doc.md:doc') > at('label:Recent'), JSON.stringify(shape));
    assert.ok(!shape.some((item) => item.includes('/far/far.md')), 'a file never opened in an unwatched root is not listed');

    // The accessible structure: the listbox holds named groups; labels are not options; every option
    // says its age, and where it applies that it changed since you read.
    const structure = await page.evaluate(() => ({
      listboxChildren: [...document.querySelector('#marxy-palette [role=listbox]').children].map((el) => el.getAttribute('role')),
      groups: [...document.querySelectorAll('#marxy-palette [role=listbox] [role=group]')].map((el) => document.getElementById(el.getAttribute('aria-labelledby'))?.textContent),
      labels: [...document.querySelectorAll('#marxy-palette .marxy-palette-section')].map((el) => [el.getAttribute('role'), el.hasAttribute('aria-selected')]),
      optionsOutsideGroup: document.querySelectorAll('#marxy-palette [role=listbox] > [role=option]').length,
      names: Object.fromEntries([...document.querySelectorAll('#marxy-palette [role=option]')].map((el) => [el.dataset.rowKey, el.getAttribute('aria-label')])),
    }));
    assert.deepEqual(structure.listboxChildren, ['group', 'group', 'group', 'group']);
    assert.deepEqual(structure.groups, ['Pinned', 'Changed since you read', 'Recent', 'Suggested']);
    assert.deepEqual(structure.labels, [[null, false], [null, false], [null, false], [null, false]]);
    assert.equal(structure.optionsOutsideGroup, 0);
    assert.equal(structure.names['/docs/ch1.md:doc'], 'ch1, 2 minutes ago, changed since you read');
    assert.equal(structure.names['/docs/ch2.md:doc'], 'ch2, 40 minutes ago, changed since you read');
    assert.equal(structure.names['/docs/pin-doc.md:doc'], 'pin-doc, 9 days ago');
    assert.equal(await page.$$eval('#marxy-palette [role=option]', (els) => els.length), shape.filter((item) => item.startsWith('row:')).length);

    // Ages are dim text; the changed rows alone carry the mark.
    const decor = await page.$$eval('#marxy-palette .marxy-palette-row', (els) =>
      Object.fromEntries(els.map((el) => [el.dataset.rowKey, {
        age: el.querySelector('.marxy-palette-age')?.textContent ?? null,
        mark: el.querySelector('.marxy-palette-changed') !== null,
      }])),
    );
    assert.deepEqual(decor['/docs/ch1.md:doc'], { age: '2m', mark: true });
    assert.deepEqual(decor['/docs/ch2.md:doc'], { age: '40m', mark: true });
    assert.deepEqual(decor['/docs/pin-doc.md:doc'], { age: '9d', mark: false });
    assert.deepEqual(decor['/docs/old-doc.md:doc'], { age: '2w', mark: false });

    // K-18: every document row leads with its kind's icon, hidden from a screen reader, and the icon
    // does not change the row's height (measured with the icon removed from layout).
    const glyphs = await page.$$eval('#marxy-palette .marxy-palette-row', (els) =>
      els.filter((el) => el.querySelector('.marxy-kind-glyph') !== null).map((el) => {
        const g = el.querySelector('.marxy-kind-glyph');
        const withIcon = el.getBoundingClientRect().height;
        g.style.display = 'none';
        const without = el.getBoundingClientRect().height;
        g.style.display = '';
        return {
          hidden: g.getAttribute('aria-hidden'),
          svg: g.querySelector('svg[viewBox="0 0 16 16"]') !== null,
          kind: g.querySelector('svg').dataset.marxyKind,
          first: el.firstElementChild === g,
          delta: Math.abs(withIcon - without),
        };
      }),
    );
    assert.ok(glyphs.length > 0);
    for (const g of glyphs) assert.deepEqual({ ...g, delta: g.delta < 0.5 }, { hidden: 'true', svg: true, kind: g.kind, first: true, delta: true });

    // ArrowDown from the last Pinned row lands on the first Changed row; ArrowUp goes back.
    assert.equal(await selectedKey(page), '/docs/pin-doc.md:doc');
    await page.keyboard.press('ArrowDown');
    assert.equal(await selectedKey(page), '/docs/ch1.md:doc');
    await page.keyboard.press('ArrowUp');
    assert.equal(await selectedKey(page), '/docs/pin-doc.md:doc');
    await page.keyboard.press('ArrowDown');

    // Open the changed row: the next summons lists it under Recent, not Changed.
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => !document.getElementById('marxy-palette').open);
    await page.keyboard.press(`${mod}+KeyP`);
    const after = await listShape(page);
    const recentAt = after.indexOf('label:Recent');
    assert.ok(after.indexOf('row:/docs/ch1.md:doc') > recentAt, JSON.stringify(after));
    assert.deepEqual(after.slice(after.indexOf('label:Changed since you read') + 1, recentAt), ['row:/docs/ch2.md:doc']);

    // Command-period pins the selected row's path, and the list moves it under Pinned at once.
    const rowKeys = after.filter((item) => item.startsWith('row:'));
    for (let i = 0; i < rowKeys.length; i++) await page.keyboard.press('ArrowUp'); // to the first row, wherever the last summons left it
    for (let i = 0; i < rowKeys.indexOf('row:/docs/old-doc.md:doc'); i++) await page.keyboard.press('ArrowDown');
    await page.keyboard.press(`${mod}+Period`);
    const pinnedNow = await listShape(page);
    assert.deepEqual(pinnedNow.slice(0, 3), ['label:Pinned', 'row:/docs/old-doc.md:doc', 'row:/docs/pin-doc.md:doc'], JSON.stringify(pinnedNow));

    // Still no tab bar anywhere in the document (ADR-0011).
    assert.equal(await page.evaluate(() => document.querySelector('[role=tablist], [role=tab], .tab-bar, #marxy-tabs')), null);
  } finally {
    await browser.close();
  }
});

test('typed results from a watched folder show the age and the mark; an unwatched folder shows neither (C-12)', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 800 } });
    await bootEmptyState(page);
    const mod = modChord(await page.evaluate(() => navigator.platform));
    await page.keyboard.press(`${mod}+KeyP`);
    await page.fill('#marxy-palette .marxy-palette-query', 'ch1');
    const typed = await page.$$eval('#marxy-palette .marxy-palette-row', (els) =>
      els.map((el) => [el.dataset.rowKey, el.querySelector('.marxy-palette-age')?.textContent ?? null, el.querySelector('.marxy-palette-changed') !== null]),
    );
    assert.deepEqual(typed, [['/docs/ch1.md:doc', '2m', true]]);
    assert.deepEqual(await page.$$eval('#marxy-palette .marxy-palette-section', (els) => els.map((el) => el.textContent)), ['Files'], 'a typed list has the one label, Files');
    await page.fill('#marxy-palette .marxy-palette-query', 'far');
    const far = await page.$$eval('#marxy-palette .marxy-palette-row', (els) =>
      els.filter((el) => el.dataset.rowKey === '/far/far.md:doc').map((el) => [el.querySelector('.marxy-palette-age'), el.querySelector('.marxy-palette-changed')]),
    );
    assert.deepEqual(far, [[null, null]]);
  } finally {
    await browser.close();
  }
});

test('opening a file by any route, or saving it from Marxy, counts as reading it (C-12)', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 800 } });
    await bootEmptyState(page);
    const mod = modChord(await page.evaluate(() => navigator.platform));
    const sections = () => page.$$eval('#marxy-palette .marxy-palette-section, #marxy-palette .marxy-palette-row', (els) => {
      const out = {}; let cur = '';
      for (const el of els) {
        if (el.classList.contains('marxy-palette-section')) { cur = el.textContent; out[cur] = []; } else out[cur].push(el.dataset.rowKey.replace(':doc', ''));
      }
      return out;
    });
    const summon = async () => { await page.keyboard.press(`${mod}+KeyP`); return sections(); };
    let now = await summon();
    assert.deepEqual(now['Changed since you read'], ['/docs/ch1.md', '/docs/ch2.md']);
    await page.keyboard.press('Escape');

    // Opened the way the command line and the menu open: through the app, not the palette.
    await page.evaluate(async () => { await window.__b.handle.open('/docs/ch1.md'); });
    now = await summon();
    assert.deepEqual(now['Changed since you read'], ['/docs/ch2.md'], 'an app open is a read');
    assert.ok(now.Recent.includes('/docs/ch1.md'));
    await page.keyboard.press('Escape');

    // Saved from Marxy: it changes on disk after the read, and the save reads it again.
    await page.evaluate(async () => {
      const entry = (path, mtimeMs) => ({ path, root: '/docs', title: path.split('/').pop().replace('.md', ''), headings: [], mtimeMs, size: 1, kind: 'markdown' });
      await new Promise((r) => setTimeout(r, 30));
      window.__marxyPalette.setIndexEntries([entry('/docs/ch1.md', Date.now()), entry('/docs/ch2.md', Date.now() - 2_400_000)]);
    });
    now = await summon();
    assert.deepEqual(now['Changed since you read'], ['/docs/ch1.md', '/docs/ch2.md'], 'modified after the read: changed again');
    await page.keyboard.press('Escape');
    const order = await page.evaluate(() => window.__marxyPalette.session.mru.slice());
    await page.evaluate(async () => {
      const h = window.__b.handle;
      const snap = h.openDocument().buffer;
      await h.commitEdit({ ...snap, bytes: new TextEncoder().encode('# Edited\n\nBody.\n') });
      await new Promise((r) => setTimeout(r, 30));
      const result = await h.save();
      if (result !== 'saved') throw new Error(`save said ${JSON.stringify(result)}`);
    });
    await page.waitForTimeout(100);
    now = await summon();
    assert.ok(!(now['Changed since you read'] ?? []).includes('/docs/ch1.md'), JSON.stringify(now));
    assert.deepEqual(await page.evaluate(() => window.__marxyPalette.session.mru.slice()), order, 'a save leaves the MRU order alone');
  } finally {
    await browser.close();
  }
});

test('the empty list follows an index publish while the palette is open (C-12)', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 800 } });
    await bootEmptyState(page);
    const mod = modChord(await page.evaluate(() => navigator.platform));
    await page.keyboard.press(`${mod}+KeyP`);
    assert.ok((await listShape(page)).includes('row:/docs/ch1.md:doc'));
    await page.evaluate(() => {
      window.__marxyPalette.setIndexEntries([{ path: '/docs/ch9.md', root: '/docs', title: 'ch9', headings: [], mtimeMs: Date.now() - 1000, size: 1, kind: 'markdown' }]);
    });
    assert.deepEqual((await listShape(page)).slice(0, 2), ['label:Changed since you read', 'row:/docs/ch9.md:doc']);
  } finally {
    await browser.close();
  }
});

// U-04: the palette's field, glyphs, groups, chips and footer.
async function bootDocument(page, width = 1440, height = 900) {
  await page.setViewportSize({ width, height });
  await page.goto(`${base}test/palette-boot.html`);
  await page.waitForFunction(() => typeof window.marxyPaletteBoot?.start === 'function');
  await page.evaluate(async ({ doc }) => {
    await window.marxyPaletteBoot.start({ '/docs/readme.md': doc }, ['/docs/readme.md'], []);
  }, { doc: Buffer.from(HEADING_DOC).toString('base64') });
  return modChord(await page.evaluate(() => navigator.platform));
}

test('the field has its prompt, glyph and Esc button; the chips swap the prefix and keep the query; order is field, chips, list (U-04)', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage();
    const mod = await bootDocument(page);
    await page.keyboard.press(`${mod}+KeyK`);
    await page.waitForSelector('#marxy-palette[open] .marxy-palette-row');

    const shape = await page.evaluate(() => {
      const dialog = document.getElementById('marxy-palette');
      const input = dialog.querySelector('.marxy-palette-query');
      const modes = dialog.querySelector('.marxy-palette-modes');
      const list = dialog.querySelector('[role=listbox]');
      const esc = dialog.querySelector('.marxy-palette-esc');
      const before = (a, b) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
      return {
        width: Math.round(dialog.getBoundingClientRect().width),
        placeholder: input.placeholder,
        name: input.getAttribute('aria-label'),
        role: input.getAttribute('role'),
        controls: input.getAttribute('aria-controls') === list.id,
        glyph: dialog.querySelector('.marxy-palette-field .marxy-palette-glyph svg') !== null,
        escTag: esc.tagName,
        escName: esc.getAttribute('aria-label'),
        order: before(input, modes) && before(modes, list),
        chips: [...modes.querySelectorAll('button')].map((b) => [b.textContent, b.getAttribute('aria-pressed'), b.type]),
        footer: dialog.querySelector('.marxy-palette-foot').textContent,
      };
    });
    assert.equal(shape.width, 860, 'the palette is 860 px wide in a window that holds it');
    assert.ok(/type > for commands, \/ for content/.test(shape.placeholder), shape.placeholder);
    assert.equal(shape.name, 'Search files, commands and content');
    assert.equal(shape.role, 'combobox');
    assert.ok(shape.controls && shape.glyph && shape.order);
    assert.deepEqual([shape.escTag, shape.escName], ['BUTTON', 'Close palette']);
    assert.deepEqual(shape.chips, [['Everything', 'true', 'button'], ['Commands>', 'false', 'button'], ['Headings', 'false', 'button'], ['Content/', 'false', 'button']]);
    assert.ok(/open beside/.test(shape.footer) && /pin/.test(shape.footer) && /transforms/.test(shape.footer), shape.footer);

    const chip = (label) => page.locator('#marxy-palette .marxy-palette-mode', { hasText: label });
    const state = () => page.evaluate(() => ({
      query: document.querySelector('#marxy-palette .marxy-palette-query').value,
      pressed: [...document.querySelectorAll('#marxy-palette .marxy-palette-mode[aria-pressed=true]')].map((b) => b.firstChild.textContent),
      focused: document.activeElement?.className,
    }));
    await page.fill('#marxy-palette .marxy-palette-query', 'doc');
    await chip('Commands').click();
    assert.deepEqual(await state(), { query: '>doc', pressed: ['Commands'], focused: 'marxy-palette-query' });
    await chip('Content').click();
    assert.deepEqual((await state()).query, '/doc');
    assert.deepEqual((await state()).pressed, ['Content']);
    await chip('Headings').click();
    assert.deepEqual(await state(), { query: 'doc', pressed: ['Headings'], focused: 'marxy-palette-query' });
    await chip('Everything').click();
    assert.deepEqual((await state()).pressed, ['Everything']);

    await page.locator('#marxy-palette .marxy-palette-esc').click();
    assert.equal(await page.evaluate(() => document.getElementById('marxy-palette').open), false, 'the Esc button closes the palette');

    // A window narrower than the palette clamps it.
    await page.setViewportSize({ width: 600, height: 700 });
    await page.keyboard.press(`${mod}+KeyK`);
    assert.ok((await page.evaluate(() => document.getElementById('marxy-palette').getBoundingClientRect().width)) <= 600 - 32);
  } finally {
    await browser.close();
  }
});

test('> lists the commands under group headers that are not options; the arrows walk the rows only; a row is 46 px (U-04)', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage();
    const mod = await bootDocument(page);
    await page.keyboard.press(`${mod}+Shift+KeyP`);
    await page.waitForSelector('#marxy-palette[open] .marxy-palette-row');
    const listing = await page.evaluate(() => {
      const dialog = document.getElementById('marxy-palette');
      const groups = [...dialog.querySelectorAll('[role=listbox] [role=group]')].map((g) => ({
        name: document.getElementById(g.getAttribute('aria-labelledby')).textContent,
        titles: [...g.querySelectorAll('[role=option] .marxy-palette-title')].map((t) => t.textContent),
      }));
      const rows = [...dialog.querySelectorAll('.marxy-palette-row')];
      return {
        groups,
        headersAreOptions: [...dialog.querySelectorAll('.marxy-palette-section')].some((h) => h.getAttribute('role') === 'option' || h.closest('[role=option]')),
        rowCount: rows.length,
        optionCount: dialog.querySelectorAll('[role=option]').length,
        heights: [...new Set(rows.map((r) => Math.round(r.getBoundingClientRect().height)))],
        glyphs: rows.every((r) => r.firstElementChild.getAttribute('aria-hidden') === 'true' && r.firstElementChild.querySelector('svg') !== null),
      };
    });
    const order = ['Navigate', 'File', 'View', 'Copy', 'Source', 'Extract', 'Transform'];
    const names = listing.groups.map((g) => g.name);
    assert.deepEqual(names, order.filter((n) => names.includes(n)), 'the groups are in the written order');
    assert.ok(names.length >= 4, `several command groups show: ${names}`);
    assert.ok(!listing.headersAreOptions);
    assert.equal(listing.rowCount, listing.optionCount);
    assert.deepEqual(listing.heights, [46], 'every row is 46 px');
    assert.ok(listing.glyphs, 'every row leads with a hidden glyph');
    const showAs = listing.groups.flatMap((g) => g.titles).filter((t) => t.startsWith('Show this file as'));
    assert.deepEqual(showAs, ['Show this file as…'], 'the family is one row');
    assert.ok(listing.groups.flatMap((g) => g.titles).filter((t) => t.startsWith('Always open this folder as')).length <= 1);

    // The arrows step through rows only, and the field names the highlighted row.
    const rowIds = await page.$$eval('#marxy-palette .marxy-palette-row', (els) => els.map((el) => el.id));
    assert.equal(new Set(rowIds).size, rowIds.length, 'every row has its own id');
    const walked = [];
    for (let i = 0; i < 40; i++) {
      walked.push(await page.evaluate(() => {
        const input = document.querySelector('#marxy-palette .marxy-palette-query');
        const row = document.getElementById(input.getAttribute('aria-activedescendant'));
        const rows = [...document.querySelectorAll('#marxy-palette .marxy-palette-row')];
        return { index: rows.indexOf(row), role: row.getAttribute('role'), selected: row.getAttribute('aria-selected'), only: document.querySelectorAll('#marxy-palette [aria-selected]').length };
      }));
      await page.keyboard.press('ArrowDown');
    }
    assert.deepEqual(walked.map((w) => w.index), Array.from({ length: 40 }, (_, i) => i), 'each press lands on the next row, a header never takes one');
    assert.ok(walked.every((w) => w.role === 'option' && w.selected === 'true' && w.only === 1));

    // The row that opens a list turns the query into the list.
    await page.fill('#marxy-palette .marxy-palette-query', '>show this file');
    await page.waitForFunction(() => document.querySelectorAll('#marxy-palette .marxy-palette-row').length === 1);
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelectorAll('#marxy-palette .marxy-palette-row').length > 3);
    const opened = await page.evaluate(() => ({
      open: document.getElementById('marxy-palette').open,
      query: document.querySelector('#marxy-palette .marxy-palette-query').value,
      titles: [...document.querySelectorAll('#marxy-palette .marxy-palette-title')].map((t) => t.textContent),
    }));
    assert.equal(opened.open, true);
    assert.equal(opened.query, '>Show this file as ');
    assert.ok(opened.titles.length > 3 && opened.titles.every((t) => t.startsWith('Show this file as')), JSON.stringify(opened.titles));

    // A kind's name lists its rows directly (`>log`, `>show as log`), as main does; no drill row stands in.
    for (const [q, want] of [['>log', ['Show this file as log', 'Always open this folder as log']], ['>show as log', ['Show this file as log']]]) {
      await page.fill('#marxy-palette .marxy-palette-query', q);
      const titles = await page.$$eval('#marxy-palette .marxy-palette-title', (els) => els.map((t) => t.textContent));
      for (const t of want) assert.ok(titles.includes(t), `${q}: ${t} in ${JSON.stringify(titles)}`);
      assert.ok(!titles.some((t) => t.endsWith('…')), `${q}: no drill row`);
    }
  } finally {
    await browser.close();
  }
});
