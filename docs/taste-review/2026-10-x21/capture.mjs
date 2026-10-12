// X-21 capture: the real app (Vite harness, memory shell, WebKit, headless) and the mock-v2 pages, the same states at the
// same sizes, in Night and Paper. The app reads the mock's own corpus (mock-v2/shared/corpus.js) at the same paths.
// Run from apps/desktop (so Playwright and Vite resolve): node <this file> <worktree> <outdir> [app|mock|both] [state-regex]
// The mock loads its web fonts from a CDN. U-00 lifts this into scripts/.
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const WT = process.argv[2];
const OUT = process.argv[3];
const WHICH = process.argv[4] ?? 'both';
const ONLY = process.argv[5] ? new RegExp(process.argv[5]) : null;
mkdirSync(OUT, { recursive: true });

const { launchWebkit } = await import(join(WT, 'scripts/playwright-webkit.mjs'));
const support = await import(join(WT, 'apps/desktop/test/support/two-pane.mjs'));
const MOCK = join(WT, 'docs/plan/direction-2026-10/mock-v2');

// The mock's own corpus, so the app reads the very documents the mock draws.
const ctx = { window: {} };
vm.runInNewContext(readFileSync(join(MOCK, 'shared/corpus.js'), 'utf8'), ctx);
const docs = ctx.window.Marxy.docs;
const toPath = (p) => p.replace(/^~/, '/Users/reader');
const files = Object.fromEntries(docs.filter((d) => d.src).map((d) => [toPath(d.path), d.src]));
const PLAN = toPath(docs.find((d) => d.id === 'pg16-plan').path);
const HANDOFF = toPath(docs.find((d) => d.id === 'auth-handoff').path);
const RS = toPath(docs.find((d) => d.id === 'indexer-rs').path);
const ARTICLE = toPath(docs.find((d) => d.id === 'ragged-right').path);
const entries = docs.filter((d) => d.src).map((d, i) => ({
  path: toPath(d.path),
  root: toPath(d.path).split('/').slice(0, 4).join('/'),
  title: d.title,
  headings: [...d.src.matchAll(/^(#{1,6}) (.*)$/gm)].map((m, k) => ({ level: m[1].length, text: m[2], byteOffset: k })),
  mtimeMs: Date.now() - (i + 1) * 3_600_000,
  size: new TextEncoder().encode(d.src).length,
  kind: /\.(md|markdown)$/.test(d.path) ? 'markdown' : 'source',
  readerKind: d.kind,
}));

const W = 1440, H = 900, NARROW = 760;
const THEMES = [
  { id: 'dark', scheme: 'dark', mock: 'night' },
  { id: 'light', scheme: 'light', mock: 'paper' },
];
const settle = (page, ms) => page.waitForTimeout(ms);

// ---------- the app ----------
async function bootApp(browser, theme, { width = W, height = H, open = PLAN } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, colorScheme: theme.scheme, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const base = await support.harnessBase();
  const { style, body } = support.shippedSkeleton();
  await page.route(`${base}app.html`, async (route) => {
    const response = await route.fetch();
    const html = (await response.text())
      .replace('</head>', `<style>${style}</style></head>`)
      .replace(/<body[^>]*>/, `<body data-marxy-mode="rendered" data-marxy-variant="${theme.scheme}">`)
      .replace('<article id="doc" class="marxy-article"></article>', body);
    await route.fulfill({ response, body: html });
  });
  await page.goto(`${base}app.html`);
  await page.waitForFunction(() => typeof window.marxyApp?.start === 'function');
  const all = theme.scheme === 'light' ? { ...files, '/config': 'variant = "light"\n' } : files;
  const encoded = Object.fromEntries(Object.entries(all).map(([p, t]) => [p, support.b64(t)]));
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
      window.__cmd = async (id) => {
        const { commands } = await import('/src/commands/index.ts');
        const c = commands().find((x) => x.id === id);
        if (!c) throw new Error('no command ' + id);
        return c.run({});
      };
    },
    { encoded, entries, open },
  );
  await settle(page, 1200);
  return { context, page };
}
const unfold = (page) => page.evaluate(() => window.__marxyHandle.workspace().unfold());
const openDoc = (page, p) => page.evaluate((p) => window.__marxyHandle.open(p), p);
async function unfoldedWithTabs(page) {
  await unfold(page);
  await openDoc(page, HANDOFF);
  await settle(page, 300);
  await openDoc(page, RS);
  await settle(page, 300);
  await openDoc(page, PLAN);
  await settle(page, 700);
}

const APP_STATES = {
  async '01-folded'(page) {},
  async '01-unfolded'(page) { await unfoldedWithTabs(page); },
  async '02-source'(page) { await unfoldedWithTabs(page); await page.evaluate(() => window.__cmd('view.mode-source')); await settle(page, 800); },
  async '02-source-folded'(page) { await page.evaluate(() => window.__cmd('view.mode-source')); await settle(page, 800); },
  async '03-split'(page) { await unfoldedWithTabs(page); await page.evaluate(() => window.__cmd('view.mode-split')); await settle(page, 1000); },
  async '03-code'(page) { await openDoc(page, RS); await settle(page, 900); },
  async '04-palette'(page) {
    await openDoc(page, HANDOFF); await settle(page, 200); await openDoc(page, RS); await settle(page, 200); await openDoc(page, PLAN); await settle(page, 500);
    await page.keyboard.press('Meta+KeyP');
    await page.waitForSelector('#marxy-palette[open]');
    await settle(page, 500);
  },
  async '04-palette-commands'(page) {
    await page.keyboard.press('Meta+Shift+KeyP');
    await page.waitForSelector('#marxy-palette[open] .marxy-palette-row');
    await settle(page, 500);
  },
  async '05-library'(page) {
    await unfoldedWithTabs(page);
    await page.evaluate((e) => window.__marxyHandle.palette.setIndexEntries(e), entries);
    await page.evaluate(() => window.__cmd('library.open'));
    await page.waitForSelector('[data-marxy-library]');
    await settle(page, 600);
  },
  async '06-transform-sheet'(page) {
    await unfoldedWithTabs(page);
    await page.keyboard.press('Meta+Slash');
    await page.waitForSelector('#marxy-palette[open] .marxy-palette-row');
    await page.locator('#marxy-palette .marxy-palette-query').fill('>Transform: Remove front matter');
    const row = page.locator('#marxy-palette .marxy-palette-title').filter({ hasText: /^Transform: Remove front matter$/ });
    await row.waitFor();
    await row.click();
    await page.waitForSelector('#marxy-transform[open]');
    await settle(page, 900);
  },
  async '07-notice'(page) {
    await unfoldedWithTabs(page);
    await page.evaluate(async () => {
      const { notify } = await import('/src/notices/index.ts');
      notify({ kind: 'info', text: 'Copied as Markdown, 3.1 KB.' });
    });
    await settle(page, 400);
  },
  async '07-notice-folded'(page) {
    await page.evaluate(async () => {
      const { notify } = await import('/src/notices/index.ts');
      notify({ kind: 'info', text: 'Copied as Markdown, 3.1 KB.' });
    });
    await settle(page, 400);
  },
  async '08-narrow'(page) { await unfoldedWithTabs(page); },
};
const APP_OPTS = { '08-narrow': { width: NARROW }, '03-code': {} };

// ---------- the mock ----------
async function openMock(browser, theme, file, { width = W, height = H, hash = '' } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, colorScheme: theme.scheme, deviceScaleFactor: 1 });
  await context.addInitScript((t) => {
    try {
      localStorage.setItem('marxy.prefs', JSON.stringify({ theme: t }));
      localStorage.setItem('marxy.foldHint', 'true');
    } catch {}
  }, theme.mock);
  const page = await context.newPage();
  await page.goto(`file://${join(MOCK, file)}${hash}`);
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.evaluate(() => document.fonts.ready);
  await settle(page, 900);
  return { context, page };
}
const mockUnfold = (page) => page.evaluate(() => window.Marxy.fold.unfold());
// The template literal inside 01-workspace.html's resultSheet(), so the sheet is drawn from the mock's own markup.
const SHEET_TEMPLATE = (() => {
  const html = readFileSync(join(MOCK, '01-workspace.html'), 'utf8');
  const m = html.match(/function resultSheet[\s\S]*?G\.el\((`[\s\S]*?`)\);/);
  if (!m) throw new Error('capture: 01-workspace.html has no resultSheet template');
  return m[1];
})();
const MOCK_STATES = {
  '01-folded': { file: '01-workspace.html', run: async () => {} },
  '01-unfolded': { file: '01-workspace.html', run: async (page) => { await mockUnfold(page); await page.keyboard.press('Meta+Digit1'); await settle(page, 600); } },
  '02-source': { file: '02-source.html', run: async () => {} },
  '02-source-folded': { file: '01-workspace.html', run: async (page) => { await page.keyboard.press('Meta+Digit3'); await settle(page, 600); } },
  '03-split': { file: '01-workspace.html', run: async (page) => { await mockUnfold(page); await page.keyboard.press('Meta+Digit2'); await settle(page, 700); } },
  '03-code': { file: '01-workspace.html', hash: '#doc=indexer-rs', run: async () => {} },
  '04-palette': { file: '01-workspace.html', run: async (page) => { await page.evaluate(() => window.Marxy.palette.open('')); await settle(page, 600); } },
  '04-palette-commands': { file: '01-workspace.html', run: async (page) => { await page.evaluate(() => window.Marxy.palette.open('>')); await settle(page, 600); } },
  '05-library': { file: '05-collections.html', run: async () => {} },
  '06-transform-sheet': {
    file: '01-workspace.html',
    run: async (page) => {
      await mockUnfold(page);
      await settle(page, 400);
      // The result sheet's own template, read from 01-workspace.html (`resultSheet`): since round 7 nothing calls it.
      await page.evaluate((tpl) => {
        const G = window.Marxy;
        const before = G.docs.find((d) => d.id === 'pg16-plan').src;
        const after = G.transform('strip-frontmatter', before);
        const build = new Function('G', 'esc', 'ic', 'fmt', 'title', 'before', 'after', `return ${tpl};`);
        const sc = G.el(build(G, G.esc, G.ic, G.fmt, 'Remove front matter', before, after));
        document.body.appendChild(sc);
        if (G.icons) G.icons(sc);
      }, SHEET_TEMPLATE);
      await settle(page, 500);
    },
  },
  '07-notice': { file: '01-workspace.html', run: async (page) => { await mockUnfold(page); await settle(page, 300); await page.evaluate(() => window.Marxy.toast('Copied as Markdown · 3.1 KB', { icon: 'copy', ms: 60000 })); await settle(page, 500); } },
  '07-notice-folded': { file: '01-workspace.html', run: async (page) => { await page.evaluate(() => window.Marxy.toast('Copied as Markdown · 3.1 KB', { icon: 'copy', ms: 60000 })); await settle(page, 500); } },
  '08-narrow': { file: '01-workspace.html', width: NARROW, run: async (page) => { await mockUnfold(page); await settle(page, 500); } },
};

const browser = await launchWebkit();
const log = [];
try {
  for (const theme of THEMES) {
    for (const state of Object.keys(APP_STATES)) {
      if (ONLY && !ONLY.test(state)) continue;
      const name = `${state}-${theme.id}`;
      if (WHICH !== 'mock') {
        const t0 = Date.now();
        const { context, page } = await bootApp(browser, theme, APP_OPTS[state] ?? {});
        try {
          await APP_STATES[state](page);
          await page.screenshot({ path: join(OUT, `${name}-app.png`) });
          log.push(`${name}-app ok ${Date.now() - t0} ms`);
        } catch (e) {
          log.push(`${name}-app FAILED ${e.message.split('\n')[0]}`);
          await page.screenshot({ path: join(OUT, `${name}-app.png`) }).catch(() => {});
        } finally {
          await context.close();
        }
      }
      if (WHICH !== 'app') {
        const m = MOCK_STATES[state];
        const { context, page } = await openMock(browser, theme, m.file, { width: m.width ?? W, hash: m.hash ?? '' });
        try {
          await m.run(page);
          await page.screenshot({ path: join(OUT, `${name}-mock.png`) });
          log.push(`${name}-mock ok`);
        } catch (e) {
          log.push(`${name}-mock FAILED ${e.message.split('\n')[0]}`);
        } finally {
          await context.close();
        }
      }
      console.log(log.at(-1));
    }
  }
} finally {
  await browser.close();
  await support.closeHarness();
}
console.log(log.join('\n'));
