// U-00: one command makes the app-beside-mock pair for a screen (ADR-0070). Lifted from X-21's capture.mjs.
// The real app (Vite harness over the memory shell, WebKit, headless) and the mock-v2 pages, the same state at the same
// size, in Night and Paper, written as <out>/<screen>-<night|paper>-{app,mock}.png plus an index.html. The app reads
// the mock's own corpus (mock-v2/shared/corpus.js) at the same paths. The mock loads its web fonts from a CDN; the app
// page never does. Local tooling for a human to look at: it is not on the pull-request path and compares no pixels.
//   node scripts/mock-pair.mjs <screen...|all> --out <dir> [--theme night|paper|ink|dusk|sepia|fjord|hc-dark|hc-light] [--side app|mock] [--list]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MOCK = join(ROOT, 'docs/plan/direction-2026-10/mock-v2');

const W = 1440, H = 900, NARROW = 760;
// `app` is the `theme` line the app's config gets (H-05): none for Night and Paper, a bundled name for the rest.
export const THEMES = [
  { id: 'night', scheme: 'dark', mock: 'night', label: 'Night' },
  { id: 'paper', scheme: 'light', mock: 'paper', label: 'Paper' },
  { id: 'ink', scheme: 'dark', mock: 'ink', label: 'Ink', app: 'ink' },
  { id: 'dusk', scheme: 'dark', mock: 'dusk', label: 'Dusk', app: 'warm' },
  { id: 'sepia', scheme: 'light', mock: 'sepia', label: 'Sepia', app: 'warm' },
  { id: 'fjord', scheme: 'dark', mock: 'fjord', label: 'Fjord', app: 'fjord' },
  { id: 'hc-dark', scheme: 'dark', mock: 'hc-dark', label: 'High contrast dark', app: 'high-contrast' },
  { id: 'hc-light', scheme: 'light', mock: 'hc-light', label: 'High contrast light', app: 'high-contrast' },
];
/** What `all` and a bare run use: Night and Paper, as before. The others are named with --theme. */
export const DEFAULT_THEMES = ['night', 'paper'];
/** The bytes of the app's /config for a theme. */
export function configFor(theme) {
  const lines = [];
  if (theme.scheme === 'light') lines.push('variant = "light"');
  if (theme.app) lines.push(`theme = "${theme.app}"`);
  return lines.length ? `${lines.join('\n')}\n` : null;
}
/** The screens, with the mock page each moves toward and a one-line caption for the index. */
export const SCREENS = {
  '01-folded': 'Folded: the reading page alone (mock 01-workspace)',
  '01-unfolded': 'Unfolded: toolbar, tabs, strip, sidebar (mock 01-workspace)',
  '02-source': 'Source, unfolded (mock 02-source)',
  '02-source-folded': 'Source, folded (mock 01-workspace, Source)',
  '03-split': 'Split view (mock 01-workspace, Split)',
  '03-code': 'A code file in the reader (mock 01-workspace, doc=indexer-rs)',
  '03-transcript': 'A Markdown transcript in the reader (mock 01-workspace, doc=indexer-chat)',
  '03-log': 'A log in the reader (mock 01-workspace, doc=build-log)',
  '03-diff': 'A diff in the reader (the mock has no diff page: mock 01-workspace, doc=indexer-rs, shows the same chrome around code)',
  '03-article': 'An article with a byline and a dek in the reader (mock 01-workspace, doc=ragged-right)',
  '04-palette': 'The palette, files (mock 04-palette)',
  '04-palette-commands': 'The palette, commands (mock 04-palette)',
  '05-library': 'The library (mock 05-collections)',
  '06-transform-sheet': 'The transform result sheet (mock 01-workspace)',
  '07-notice': 'A notice, unfolded (mock toast)',
  '07-notice-folded': 'A notice, folded (mock toast)',
  '08-narrow': 'The narrow window, 760 px (mock 01-workspace)',
};

/** The file names one screen produces: <screen>-<theme>-{app,mock}.png. */
export function pairFiles(screen, theme) {
  return { app: `${screen}-${theme}-app.png`, mock: `${screen}-${theme}-mock.png` };
}

/** Parses argv (without node and script). Throws an Error with a usable message on a bad argument. */
export function parseArgs(argv) {
  const opts = { screens: [], out: null, themes: [...DEFAULT_THEMES], sides: ['app', 'mock'], list: false, label: '' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      if (i + 1 >= argv.length) throw new Error(`${a} needs a value`);
      return argv[++i];
    };
    if (a === '--out') opts.out = value();
    else if (a === '--theme') {
      const t = value();
      if (!THEMES.some((x) => x.id === t)) throw new Error(`unknown theme "${t}"; themes: ${THEMES.map((x) => x.id).join(', ')}`);
      opts.themes = [t];
    } else if (a === '--side') {
      const s = value();
      if (s !== 'app' && s !== 'mock') throw new Error(`unknown side "${s}"; sides: app, mock`);
      opts.sides = [s];
    } else if (a === '--label') opts.label = value();
    else if (a === '--list') opts.list = true;
    else if (a.startsWith('--')) throw new Error(`unknown option ${a}`);
    else opts.screens.push(a);
  }
  const names = Object.keys(SCREENS);
  if (opts.screens.includes('all')) opts.screens = names;
  const bad = opts.screens.filter((s) => !names.includes(s));
  if (bad.length) throw new Error(`unknown screen ${bad.map((b) => `"${b}"`).join(', ')}; screens: ${names.join(', ')}`);
  if (!opts.list) {
    if (!opts.screens.length) throw new Error(`name a screen (or "all"); screens: ${names.join(', ')}`);
    if (!opts.out) throw new Error('--out <dir> is required');
  }
  return opts;
}

const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The index.html: one figure per screen and theme, the app beside the mock. Self-contained, no scripts. */
export function indexHtml({ screens, themes, sides, label }) {
  const figs = screens
    .map((s) => {
      const rows = themes
        .map((t) => {
          const th = THEMES.find((x) => x.id === t);
          const f = pairFiles(s, t);
          const cell = (side) =>
            sides.includes(side)
              ? `<a href="${f[side]}"><img src="${f[side]}" alt="${esc(s)}, ${th.label}, the ${side}" loading="lazy"></a>`
              : '<span></span>';
          return `      <figure>\n        <div>${cell('app')}${cell('mock')}</div>\n        <figcaption><span>App${label ? ` (${esc(label)})` : ''}</span><span>Mock v2</span><b>${th.label}</b></figcaption>\n      </figure>`;
        })
        .join('\n');
      return `  <section id="${s}">\n    <h2>${esc(s)}</h2>\n    <p><small>${esc(SCREENS[s])}</small></p>\n${rows}\n  </section>`;
    })
    .join('\n');
  const nav = screens.map((s) => `<a href="#${s}">${s}</a>`).join(' ');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>App beside mock</title>
<style>
  :root { --bg: #f6f5f2; --fg: #1d1d1f; --muted: #5d5f63; --line: #d9d7d2; --card: #ffffff; color-scheme: light dark; }
  @media (prefers-color-scheme: dark) { :root { --bg: #111214; --fg: #e3e5e8; --muted: #9a9ea4; --line: #2a2c30; --card: #17181a; } }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 14px/1.5 -apple-system, system-ui, sans-serif; }
  main { max-width: 1500px; margin: 0 auto; padding: 24px 16px 80px; }
  h1 { font-size: 22px; margin: 0 0 8px; }
  nav { display: flex; flex-wrap: wrap; gap: 6px 14px; margin: 0 0 24px; font-size: 13px; }
  nav a { color: inherit; }
  section { border-top: 1px solid var(--line); padding-top: 18px; margin-top: 28px; }
  h2 { font-size: 17px; margin: 0; }
  small { color: var(--muted); font-size: 12.5px; }
  figure { margin: 12px 0 16px; background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 8px; }
  figure > div { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  figure > div img { width: 100%; height: auto; display: block; border-radius: 4px; border: 1px solid var(--line); }
  figcaption { display: grid; grid-template-columns: 1fr 1fr auto; gap: 8px; font-size: 12px; color: var(--muted); padding-top: 6px; }
</style>
</head>
<body>
<main>
  <h1>App beside mock</h1>
  <nav>${nav}</nav>
${figs}
</main>
</body>
</html>
`;
}

async function run(opts) {
const { launchWebkit } = await import('./playwright-webkit.mjs');
const support = await import('../apps/desktop/test/support/two-pane.mjs');
mkdirSync(opts.out, { recursive: true });
const OUT = opts.out;

// The mock's own corpus, so the app reads the very documents the mock draws.
const ctx = { window: {} };
vm.runInNewContext(readFileSync(join(MOCK, 'shared/corpus.js'), 'utf8'), ctx);
const docs = ctx.window.Marxy.docs;
const toPath = (p) => p.replace(/^~/, '/Users/reader');
const DIFF = '/Users/reader/work/change.diff';
// The corpus's own diff (K-09): the mock has no diff page, so the fixture stands in.
const files = {
  ...Object.fromEntries(docs.filter((d) => d.src).map((d) => [toPath(d.path), d.src])),
  [DIFF]: readFileSync(join(ROOT, 'fixtures/corpus/36-change.diff'), 'utf8'),
};
const PLAN = toPath(docs.find((d) => d.id === 'pg16-plan').path);
const HANDOFF = toPath(docs.find((d) => d.id === 'auth-handoff').path);
const RS = toPath(docs.find((d) => d.id === 'indexer-rs').path);
const CHAT = toPath(docs.find((d) => d.id === 'indexer-chat').path);
const BUILD_LOG = toPath(docs.find((d) => d.id === 'build-log').path);
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

// collection.toml of the app's harness: two saved queries whose counts the index alone can give.
const SAVED_QUERIES = '[[query]]\nname = "Reports"\nq = "kind:report"\n\n[[query]]\nname = "Notes this month"\nq = "kind:notes modified:<30d"\n';

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
  // Two saved queries, so the sidebar draws its Smart collections (Q-07) as the mock does. The memory shell's config is /config.
  const withQueries = { ...files, '/collection.toml': SAVED_QUERIES };
  const config = configFor(theme);
  const all = config === null ? withQueries : { ...withQueries, '/config': config };
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
  async '01-unfolded'(page) {
    await unfoldedWithTabs(page);
    // The whole library is in the feed, so the saved queries have something to count (Q-07).
    await page.evaluate((e) => window.__marxyHandle.palette.setIndexEntries(e), entries);
    await settle(page, 400);
  },
  async '02-source'(page) { await unfoldedWithTabs(page); await page.evaluate(() => window.__cmd('view.mode-source')); await settle(page, 800); },
  async '02-source-folded'(page) { await page.evaluate(() => window.__cmd('view.mode-source')); await settle(page, 800); },
  async '03-split'(page) { await unfoldedWithTabs(page); await page.evaluate(() => window.__cmd('view.mode-split')); await settle(page, 1000); },
  async '03-code'(page) { await openDoc(page, RS); await settle(page, 900); },
  async '03-transcript'(page) { await openDoc(page, CHAT); await settle(page, 900); },
  async '03-log'(page) { await openDoc(page, BUILD_LOG); await settle(page, 900); },
  async '03-diff'(page) { await openDoc(page, DIFF); await settle(page, 900); },
  async '03-article'(page) { await openDoc(page, ARTICLE); await settle(page, 900); },
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
    // A query with a term offers Save as smart collection (Q-07).
    await page.locator('.marxy-library-field').fill('kind:report modified:<30d');
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
      notify({ kind: 'done', text: 'Copied as Markdown, 3.1 KB' });
    });
    await settle(page, 400);
  },
  async '07-notice-folded'(page) {
    await page.evaluate(async () => {
      const { notify } = await import('/src/notices/index.ts');
      notify({ kind: 'done', text: 'Copied as Markdown, 3.1 KB' });
    });
    await settle(page, 400);
  },
  async '08-narrow'(page) { await unfoldedWithTabs(page); },
};
const APP_OPTS = { '08-narrow': { width: NARROW }, '03-code': {}, '03-transcript': {} };

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
  '03-transcript': { file: '01-workspace.html', hash: '#doc=indexer-chat', run: async () => {} },
  '03-log': { file: '01-workspace.html', hash: '#doc=build-log', run: async () => {} },
  '03-diff': { file: '01-workspace.html', hash: '#doc=indexer-rs', run: async () => {} },
  '03-article': { file: '01-workspace.html', hash: '#doc=ragged-right', run: async () => {} },
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
const failures = [];
try {
  for (const screen of opts.screens) {
    for (const theme of THEMES.filter((t) => opts.themes.includes(t.id))) {
      const names = pairFiles(screen, theme.id);
      const t0 = Date.now();
      if (opts.sides.includes('app')) {
        const { context, page } = await bootApp(browser, theme, APP_OPTS[screen] ?? {});
        try {
          await APP_STATES[screen](page);
        } catch (e) {
          failures.push(`${names.app}: ${e.message.split('\n')[0]}`);
        }
        await page.screenshot({ path: join(OUT, names.app) });
        await context.close();
      }
      if (opts.sides.includes('mock')) {
        const m = MOCK_STATES[screen];
        const { context, page } = await openMock(browser, theme, m.file, { width: m.width ?? W, hash: m.hash ?? '' });
        try {
          await m.run(page);
        } catch (e) {
          failures.push(`${names.mock}: ${e.message.split('\n')[0]}`);
        }
        await page.screenshot({ path: join(OUT, names.mock) });
        await context.close();
      }
      console.log(`${screen} ${theme.id} ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    }
  }
} finally {
  await browser.close();
  await support.closeHarness();
}
writeFileSync(join(OUT, 'index.html'), indexHtml(opts));
for (const f of failures) console.error(`FAILED ${f}`);
console.log(`wrote ${join(OUT, 'index.html')}`);
return failures.length ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`mock-pair: ${e.message}`);
    process.exit(2);
  }
  if (opts.list) {
    for (const [s, c] of Object.entries(SCREENS)) console.log(`${s.padEnd(22)}${c}`);
  } else {
    opts.out = resolve(opts.out);
    process.exitCode = await run(opts);
  }
}
