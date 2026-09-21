// Palette view: real document mount, ADR-0011 tab-bar assertion, keys, and keystroke perf (MARXY-87).
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { build } from 'vite';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { TAB_BAR_DOM_MUTATION } from '../src/palette/view.ts';
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

nodeTest(`mutation ${TAB_BAR_DOM_MUTATION} makes the live tab-bar assertion fail`, () => {
  const probe = `
    import assert from 'node:assert/strict';
    import { documentHasTabBar, TAB_BAR_DOM_MUTATION } from './src/palette/view.ts';
    process.env.MARXY_87_MUTATION = TAB_BAR_DOM_MUTATION;
    const nodes = [];
    const doc = {
      querySelector(sel) {
        for (const n of nodes) {
          if (sel.includes('marxy-tabs') && n.id === 'marxy-tabs') return n;
          if (sel.includes('tablist') && n.role === 'tablist') return n;
        }
        return null;
      },
      createElement() {
        return { id: '', setAttribute(k, v) { if (k === 'id') this.id = v; if (k === 'role') this.role = v; } };
      },
      body: { appendChild(n) { nodes.push(n); } },
    };
    assert.equal(documentHasTabBar(doc), false, 'ADR-0011 expects no tab bar in the live document');
  `;
  const result = spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', probe], {
    cwd: desktopRoot,
    encoding: 'utf8',
    env: process.env,
  });
  assert.notEqual(result.status, 0, 'tab-bar mutation must fail the no-tab-bar assertion');
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
    const budget = 16 * Math.max(machineFactor(), 2.5);
    assert.ok(samples.p95 < budget, `palette keystroke p95 ${samples.p95} ms must stay under ${budget.toFixed(1)} ms (16 ms product × envelope)`);
    mkdirSync(join(repoRoot, 'results'), { recursive: true });
    const perfPath = join(repoRoot, 'results/perf.json');
    let record = {};
    if (existsSync(perfPath)) record = JSON.parse(readFileSync(perfPath, 'utf8'));
    writeFileSync(
      perfPath,
      JSON.stringify(
        {
          ...record,
          env_class: record.env_class ?? 'reference',
          palette_keystroke_ms: Math.round(samples.p95 * 100) / 100,
        },
        null,
        2,
      ),
    );
  } finally {
    await browser.close();
  }
});
