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

const W = 1440, H = 900, NARROW = 760, SHORT = 400, WIDE = 1920;
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
  '02-source-numbers': 'Source with line numbers on, unfolded: the gutter and the text side by side (mock 02-source)',
  '02-source-fill-short': 'Folded Source with line numbers, a short document: the gutter at the window\'s edge, the editor as tall as the window (F-100; the mock\'s frame is 960 px centred, the departure)',
  '02-source-fill-long': 'Folded Source with line numbers, a long document: the text runs to the right edge and scrolls (F-100; the mock\'s frame is 960 px centred, the departure)',
  '03-split': 'Split view (mock 01-workspace, Split)',
  '03-code': 'A code file in the reader (mock 01-workspace, doc=indexer-rs)',
  '03-transcript': 'A Markdown transcript in the reader (mock 01-workspace, doc=indexer-chat)',
  '03-log': 'A log in the reader (mock 01-workspace, doc=build-log)',
  '03-diff': 'A diff in the reader (the mock has no diff page: mock 01-workspace, doc=indexer-rs, shows the same chrome around code)',
  '03-article': 'An article with a byline and a dek in the reader (mock 01-workspace, doc=ragged-right)',
  '03-data': 'A CSV in the table lens (mock 01-workspace, doc=bench-csv)',
  '04-palette': 'The palette, files (mock 04-palette)',
  '04-palette-commands': 'The palette, commands (mock 04-palette)',
  '04-palette-short': 'The palette, search with a preview, in the shortest supported window, 400 px tall (mock 04-palette)',
  '05-library': 'The library (mock 05-collections)',
  '06-transform-sheet': 'The transform result sheet (mock 01-workspace)',
  '07-notice': 'A notice, unfolded (mock toast)',
  '07-notice-folded': 'A notice, folded (mock toast)',
  '08-narrow': 'The narrow window, 760 px (mock 01-workspace)',
  '09-inspector-outline': 'The inspector docked on its Outline tab: headings with the words of each section (mock 01-workspace)',
  '03-terminal': 'A shell session in the reader (mock 01-workspace, doc=shell-session)',
  '09-inspector-versions': 'The inspector docked on its Versions tab: Changed since you read and the earlier versions (mock 01-workspace)',
  '09-inspector-metadata': 'The inspector docked on its Metadata tab: the file, its front matter with values edited in place, detection, what is hidden (mock 01-workspace)',
  '09-metadata-margin': 'Read with the metadata preview on in the left margin, sidebar undocked for room (mock 01-workspace, Metadata toggle on)',
  '03-docs': 'A docs page in the reader (mock 01-workspace, doc=watch-docs)',
  '03-changelog': 'A changelog in the reader (mock 01-workspace, doc=changelog)',
  '10-tabs-hover': 'Twelve tabs in the unfolded window, one hovered (F-99; mock 01-workspace)',
  '10-outline-popup': 'The outline popup (Shift+Cmd+O) at 1,920 x 900 with the inspector docked, over it and under the bands (the mock has no popup: its Outline tab is the reference for the type and the row)',
  '10-kind-chip-menu': 'The kind chip\'s menu open, unfolded: why the file is read as it is, then the Show as choices (mock 01-workspace)',
  '10-empty-window': 'The empty window with a text beside its translation, opened at 800 px and widened to 1,000 (mock 01-workspace, folded; the mock has no empty window)',
  '10-tabs-dated': 'Twelve tabs of dated names that share a long start, unfolded (F-107; mock 01-workspace)',
  '10-split-narrowed': 'A split made at 1,920 px and narrowed to 800 x 600: one pane is given back (F-106; mock 01-workspace at 800 px, one reading column)',
  '08-settings': 'Settings as a page, on Reading, with the text size changed (mock 08-settings; the mock is its own window, the app a page in the workspace)',
  '08-settings-1000': 'Settings on Content types in a 1,000 px unfolded window: the page takes the window less the sidebar (F-102; mock 08-settings, types)',
  '05-library-1000': 'The Library in a 1,000 px unfolded window: whole Name, Path and Modified columns and a preview that leaves the list its width (F-105; mock 05-collections)',
  '03-transcript-jsonl': 'The mock\'s chat as an agent\'s JSONL session, read as turns by a [[kind]] rule (K-12; mock 01-workspace, doc=indexer-chat)',
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
const SHELL_SESSION = toPath(docs.find((d) => d.id === 'shell-session').path);
const WATCH_DOCS = toPath(docs.find((d) => d.id === 'watch-docs').path);
const CHANGELOG = toPath(docs.find((d) => d.id === 'changelog').path);
const ARTICLE = toPath(docs.find((d) => d.id === 'ragged-right').path);
const CSV = toPath(docs.find((d) => d.id === 'bench-csv').path);
const NOTES = toPath(docs.find((d) => d.id === 'notes-1008').path);
// The mock's chat as the JSONL session an agent writes (K-12): the same prompts, replies and tool calls, a line each, with
// the bookkeeping a real log carries. A [[kind]] rule for its folder says read = true, so it opens in Read.
const CHAT_JSONL = '/Users/reader/Work/plans/transcripts/2026-10-07-indexer-perf.jsonl';
const TRANSCRIPT_RULE = '[[kind]]\nglob = "/Users/reader/Work/plans/transcripts/*.jsonl"\nis = "transcript"\nread = true\n';
{
  const j = (o) => JSON.stringify(o);
  const you = (content) => j({ type: 'user', message: { role: 'user', content }, sessionId: 's-1' });
  const agent = (content) => j({ type: 'assistant', message: { role: 'assistant', model: 'm', content }, sessionId: 's-1' });
  const result = (id, content) => you([{ type: 'tool_result', tool_use_id: id, content }]);
  files[CHAT_JSONL] = `${[
    j({ type: 'summary', summary: 'Why is the indexer slow?' }),
    you('The indexer takes 40 seconds on my notes folder. Can you find out why?'),
    agent([{ type: 'text', text: "I'll profile a cold run first, then look at where the time goes." }, { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'cargo run --release -- index ~/Notes --profile' } }]),
    result('t1', 'indexed 932 files in 41.8s\n  parse      2.1s\n  highlight 37.9s\n  write      1.8s'),
    agent([{ type: 'text', text: "Highlighting is 91% of the run. Every file is highlighted on every index, even when it hasn't changed." }, { type: 'tool_use', id: 't2', name: 'Read', input: { file_path: 'src/indexer.rs' } }]),
    result('t2', 'src/indexer.rs (lines 40-58)'),
    you('So cache it?'),
    agent([{ type: 'text', text: 'Yes. Key the highlighted output by the file\'s content hash and skip files whose hash is unchanged. On your folder that should bring a warm run under 2 seconds.' }, { type: 'tool_use', id: 't3', name: 'Edit', input: { file_path: 'src/indexer.rs', old_string: 'let html = highlight(&src, lang)?;', new_string: 'let html = cache.get_or_insert(hash(&src), || highlight(&src, lang))?;' } }]),
    result('t3', 'The file src/indexer.rs has been updated.'),
    j({ type: 'file-history-snapshot', snapshot: {} }),
    you('Run it again.'),
    agent([{ type: 'text', text: 'Warm run: **1.6 s**. Cold run is unchanged at 41 s, which is expected, since the cache starts empty.' }]),
  ].join('\n')}\n`;
}
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
async function bootApp(browser, theme, { width = W, height = H, open = PLAN, piece, rules } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, colorScheme: theme.scheme, deviceScaleFactor: 1 });
  const page = await context.newPage();
  // The empty window's piece is chosen at random: pin it (choosePiece takes floor(random() * count)).
  if (piece !== undefined) await page.addInitScript((k) => { Math.random = () => (k + 0.5) / 38; }, piece);
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
  const themed = configFor(theme);
  const config = rules ? `${themed ?? ''}${rules}` : themed;
  const all = config === null ? withQueries : { ...withQueries, '/config': config };
  const encoded = Object.fromEntries(Object.entries(all).map(([p, t]) => [p, support.b64(t)]));
  await page.evaluate(
    async ({ encoded, entries, open }) => {
      const bytes = {};
      for (const [path, text] of Object.entries(encoded)) bytes[path] = Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
      const { createMemoryShell } = await import('/src/shell/memory.ts');
      const { bootApplication } = await import('/src/main.ts');
      const handle = await bootApplication(createMemoryShell(bytes), { argv: open ? [open] : [] });
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

// Twelve documents of the corpus, in the corpus's order: the tab row's long-names case (F-99). The first stays the one on show.
const TWELVE = docs.slice(0, 12);
// Twelve dated drafts that share their first thirty characters (F-107). Written into the app's files and, for the mock, into its docs.
const DATED = Array.from({ length: 12 }, (_, i) => ({ id: `dated-${i + 1}`, title: `2026-10-01-quarterly-planning-review-draft-${i + 1}.md`, path: `~/Work/plans/2026-10-01-quarterly-planning-review-draft-${i + 1}.md`, src: `# Quarterly planning review, draft ${i + 1}\n\nThe ${i + 1}th pass over the quarter's plan.\n` }));
for (const d of DATED) files[toPath(d.path)] = d.src;
async function foldedSourceNumbers(page) {
  await page.evaluate(() => window.__cmd('view.mode-source'));
  await settle(page, 600);
  await page.evaluate(() => window.__cmd('view.toggle-line-numbers'));
  await settle(page, 800);
}
const APP_STATES = {
  async '10-tabs-dated'(page) {
    await unfold(page);
    for (const d of DATED) { await openDoc(page, toPath(d.path)); await settle(page, 150); }
    await openDoc(page, toPath(DATED[0].path));
    await settle(page, 500);
    await page.locator('.marxy-tab').nth(3).locator('.marxy-tab-open').hover();
    await settle(page, 300);
  },
  async '10-tabs-hover'(page) {
    await unfold(page);
    for (const d of TWELVE.slice(1)) { await openDoc(page, toPath(d.path)); await settle(page, 150); }
    await openDoc(page, toPath(TWELVE[0].path));
    await settle(page, 500);
    await page.locator(`[data-marxy-tab="${toPath(TWELVE[3].path)}"] .marxy-tab-open`).hover();
    await settle(page, 300);
  },
  async '01-folded'(page) {},
  async '01-unfolded'(page) {
    await unfoldedWithTabs(page);
    // The whole library is in the feed, so the saved queries have something to count (Q-07).
    await page.evaluate((e) => window.__marxyHandle.palette.setIndexEntries(e), entries);
    await settle(page, 400);
  },
  async '02-source'(page) { await unfoldedWithTabs(page); await page.evaluate(() => window.__cmd('view.mode-source')); await settle(page, 800); },
  async '02-source-folded'(page) { await page.evaluate(() => window.__cmd('view.mode-source')); await settle(page, 800); },
  // A Markdown file starts with numbers off (L-06.1); the toggle turns them on, as the author did (F-98).
  async '02-source-numbers'(page) {
    await unfoldedWithTabs(page);
    await page.evaluate(() => window.__cmd('view.mode-source'));
    await settle(page, 600);
    await page.evaluate(() => window.__cmd('view.toggle-line-numbers'));
    await settle(page, 800);
  },
  // Folded Source with numbers on (the author's case, F-100): a short document and a long one; the app boots on the document.
  async '02-source-fill-short'(page) { await foldedSourceNumbers(page); },
  async '02-source-fill-long'(page) { await foldedSourceNumbers(page); },
  async '03-split'(page) { await unfoldedWithTabs(page); await page.evaluate(() => window.__cmd('view.mode-split')); await settle(page, 1000); },
  async '03-code'(page) { await openDoc(page, RS); await settle(page, 900); },
  async '03-transcript'(page) { await openDoc(page, CHAT); await settle(page, 900); },
  async '03-transcript-jsonl'(page) { await settle(page, 900); },
  async '03-log'(page) { await openDoc(page, BUILD_LOG); await settle(page, 900); },
  async '03-diff'(page) { await openDoc(page, DIFF); await settle(page, 900); },
  async '03-article'(page) { await openDoc(page, ARTICLE); await settle(page, 900); },
  async '03-data'(page) { await openDoc(page, CSV); await settle(page, 600); await page.evaluate(() => window.__cmd('data.table-lens')); await settle(page, 900); },
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
  async '04-palette-short'(page) {
    await openDoc(page, HANDOFF); await settle(page, 200); await openDoc(page, RS); await settle(page, 200); await openDoc(page, PLAN); await settle(page, 500);
    await page.keyboard.press('Meta+KeyP');
    await page.waitForSelector('#marxy-palette[open]');
    await page.locator('#marxy-palette .marxy-palette-query').fill('a');
    await page.waitForSelector('#marxy-palette .marxy-palette-row');
    await settle(page, 600);
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
  // Made wide (the window is booted at WIDE), then narrowed: the split gives a pane back below two columns (F-106).
  async '10-split-narrowed'(page) {
    await unfoldedWithTabs(page);
    await page.evaluate(() => window.__cmd('view.mode-split'));
    await settle(page, 800);
    await page.setViewportSize({ width: 800, height: 600 });
    await settle(page, 1200);
  },
  async '09-inspector-outline'(page) {
    await unfoldedWithTabs(page);
    await page.evaluate(() => window.__marxyHandle.workspace().setPanel('inspector', true));
    await page.locator('[data-marxy-inspector-tab="outline"]').click();
    await page.waitForSelector('.marxy-outline [data-marxy-outline-row]');
    // Landed in a section, so the row that marks the reading line is drawn.
    await page.evaluate(async ({ plan }) => {
      const store = window.__marxyHandle.document();
      const text = new TextDecoder().decode(store.snapshot().buffer.bytes);
      const at = new TextEncoder().encode(text.slice(0, text.indexOf('## Phases') + 20)).length;
      await window.__marxyHandle.open(plan, { at });
    }, { plan: PLAN });
    await page.waitForSelector('.marxy-outline [aria-current="location"]');
    await settle(page, 600);
  },
  async '10-outline-popup'(page) {
    await unfoldedWithTabs(page);
    await page.evaluate(() => window.__marxyHandle.workspace().setPanel('inspector', true));
    await settle(page, 300);
    await page.evaluate(() => window.__cmd('view.outline'));
    await page.waitForSelector('#marxy-outline[open] .marxy-outline-row');
    await settle(page, 500);
  },
  async '03-terminal'(page) { await openDoc(page, SHELL_SESSION); await settle(page, 900); },
  async '03-docs'(page) { await openDoc(page, WATCH_DOCS); await settle(page, 900); },
  async '03-changelog'(page) { await openDoc(page, CHANGELOG); await settle(page, 900); },
  // Hegel's `Ich, das Wir` (piece 6), opened at 800 px where the columns stack, then the window widened to 1,000 (F-104).
  async '10-empty-window'(page) { await page.setViewportSize({ width: 1000, height: H }); await settle(page, 1500); },
  async '08-settings'(page) {
    // A reader who has made their text larger and shortened the line: two dots, the third row at its default.
    await page.evaluate(() => window.__marxyHandle.shell.plant('/config', new TextEncoder().encode('size = 22\nmeasure = 58\n')));
    await unfoldedWithTabs(page);
    await page.evaluate(() => window.__cmd('view.settings'));
    await page.waitForSelector('[data-marxy-settings]');
    await page.click('[data-marxy-category="reading"]');
    await settle(page, 400);
  },
  async '10-kind-chip-menu'(page) {
    await unfoldedWithTabs(page);
    await page.evaluate(() => window.__cmd('kind.chip'));
    await page.waitForSelector('.marxy-verb-menu');
    await settle(page, 400);
  },
  async '08-settings-1000'(page) {
    await page.evaluate(() => window.__cmd('view.settings'));
    await page.waitForSelector('[data-marxy-settings]');
    await page.click('[data-marxy-category="types"]');
    await settle(page, 400);
  },
  async '05-library-1000'(page) {
    await unfoldedWithTabs(page);
    await page.evaluate((e) => window.__marxyHandle.palette.setIndexEntries(e), entries);
    await page.evaluate(() => window.__cmd('library.open'));
    await page.waitForSelector('[data-marxy-library]');
    await settle(page, 600);
  },
  async '09-inspector-metadata'(page) {
    // The mock's own plan: it has front matter, so the section the card calls editable is drawn.
    await unfoldedWithTabs(page);
    await page.evaluate(() => window.__marxyHandle.workspace().setPanel('inspector', true));
    await page.locator('[data-marxy-inspector-tab="metadata"]').click();
    await page.waitForSelector('.marxy-metadata [data-marxy-metadata-section="front-matter"]');
    await settle(page, 600);
  },
  async '09-metadata-margin'(page) {
    await unfoldedWithTabs(page);
    // The sidebar is undocked for room: unfolded with it, the margin is under the preview's minimum and the command opens the tab.
    await page.evaluate(() => window.__marxyHandle.workspace().setPanel('sidebar', false));
    await page.evaluate(() => window.__marxyHandle.workspace().setPanel('inspector', false));
    await settle(page, 400);
    await page.evaluate(() => window.__cmd('view.metadata'));
    await page.waitForSelector('.marxy-metadata-preview');
    await settle(page, 600);
  },
  async '09-inspector-versions'(page) {
    await unfoldedWithTabs(page);
    // The card's scenario on the plan: read at open, an edit saved, then another program rewrites a line.
    await page.evaluate(async () => {
      const { versionRecorder } = await import('/src/versions/recorder.ts');
      const h = window.__marxyHandle;
      const store = h.document();
      const path = store.snapshot().path;
      const text = new TextDecoder().decode(store.snapshot().buffer.bytes);
      const at = new TextEncoder().encode(text.slice(0, text.indexOf('\n## ') + 1)).length;
      await store.apply({ range: { file: path, start: at, end: at }, replacement: 'A line the reader added and saved.\n\n', label: 'edit' });
      await h.save();
      await versionRecorder()?.settled();
      const saved = new TextDecoder().decode(store.snapshot().buffer.bytes);
      const outside = saved.replace(/\n## [^\n]*\n/, (m) => `${m}\nA paragraph another program wrote while the file was open.\n`);
      await h.shell.writeFileAtomic(path, new TextEncoder().encode(outside));
      h.shell.emit([{ kind: 'modified', path }]);
    });
    await page.waitForFunction(() => new TextDecoder().decode(window.__marxyHandle.document().snapshot().buffer.bytes).includes('another program wrote'));
    await page.evaluate(async () => (await import('/src/versions/recorder.ts')).versionRecorder()?.settled());
    await page.evaluate(() => window.__marxyHandle.workspace().setPanel('inspector', true));
    await page.locator('[data-marxy-inspector-tab="versions"]').click();
    await page.waitForSelector('.marxy-versions [data-marxy-versions-since]');
    await settle(page, 600);
  },
};
const APP_OPTS = { '08-narrow': { width: NARROW }, '04-palette-short': { height: SHORT }, '03-code': {}, '03-transcript': {}, '10-outline-popup': { width: WIDE }, '10-split-narrowed': { width: WIDE }, '10-empty-window': { width: 800, open: null, piece: 6 }, '08-settings-1000': { width: 1000 }, '02-source-fill-short': { open: NOTES }, '02-source-fill-long': { open: PLAN }, '05-library-1000': { width: 1000 }, '03-transcript-jsonl': { open: CHAT_JSONL, rules: TRANSCRIPT_RULE } };

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
  '10-tabs-dated': {
    file: '01-workspace.html',
    run: async (page) => {
      await mockUnfold(page);
      await page.evaluate((list) => {
        const G = window.Marxy;
        const at = G.docs.find((d) => d.id === 'pg16-plan');
        for (const d of list) G.docs.push({ ...at, ...d, unsaved: false });
        for (const d of list) G.openDoc(d.id);
        G.openDoc(list[0].id);
      }, DATED);
      await settle(page, 600);
      await page.locator('.tabs .tab').nth(3).hover();
      await settle(page, 300);
    },
  },
  '10-tabs-hover': {
    file: '01-workspace.html',
    run: async (page) => {
      await mockUnfold(page);
      await page.evaluate((ids) => { for (const id of ids) window.Marxy.openDoc(id); window.Marxy.openDoc(ids[0]); }, TWELVE.map((d) => d.id));
      await settle(page, 600);
      await page.locator(`.tabs .tab[data-id="${TWELVE[3].id}"]`).hover();
      await settle(page, 300);
    },
  },
  '01-folded': { file: '01-workspace.html', run: async () => {} },
  '01-unfolded': { file: '01-workspace.html', run: async (page) => { await mockUnfold(page); await page.keyboard.press('Meta+Digit1'); await settle(page, 600); } },
  '02-source': { file: '02-source.html', run: async () => {} },
  '02-source-folded': { file: '01-workspace.html', run: async (page) => { await page.keyboard.press('Meta+Digit3'); await settle(page, 600); } },
  '02-source-numbers': { file: '02-source.html', run: async () => {} },
  '02-source-fill-short': { file: '01-workspace.html', hash: '#doc=notes-1008', run: async (page) => { await page.keyboard.press('Meta+Digit3'); await settle(page, 600); } },
  '02-source-fill-long': { file: '01-workspace.html', hash: '#doc=pg16-plan', run: async (page) => { await page.keyboard.press('Meta+Digit3'); await settle(page, 600); } },
  '03-split': { file: '01-workspace.html', run: async (page) => { await mockUnfold(page); await page.keyboard.press('Meta+Digit2'); await settle(page, 700); } },
  '03-code': { file: '01-workspace.html', hash: '#doc=indexer-rs', run: async () => {} },
  '03-transcript': { file: '01-workspace.html', hash: '#doc=indexer-chat', run: async () => {} },
  '03-transcript-jsonl': { file: '01-workspace.html', hash: '#doc=indexer-chat', run: async () => {} },
  '03-log': { file: '01-workspace.html', hash: '#doc=build-log', run: async () => {} },
  '03-diff': { file: '01-workspace.html', hash: '#doc=indexer-rs', run: async () => {} },
  '03-article': { file: '01-workspace.html', hash: '#doc=ragged-right', run: async () => {} },
  '03-data': { file: '01-workspace.html', hash: '#doc=bench-csv', run: async () => {} },
  '04-palette': { file: '01-workspace.html', run: async (page) => { await page.evaluate(() => window.Marxy.palette.open('')); await settle(page, 600); } },
  '04-palette-commands': { file: '01-workspace.html', run: async (page) => { await page.evaluate(() => window.Marxy.palette.open('>')); await settle(page, 600); } },
  '04-palette-short': { file: '01-workspace.html', height: SHORT, run: async (page) => { await page.evaluate(() => window.Marxy.palette.open('a')); await settle(page, 600); } },
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
  '09-inspector-outline': { file: '01-workspace.html', run: async (page) => { await mockUnfold(page); await page.click('#insp [data-it="outline"]'); await settle(page, 600); } },
  '03-terminal': { file: '01-workspace.html', hash: '#doc=shell-session', run: async () => {} },
  '09-inspector-versions': { file: '01-workspace.html', run: async (page) => { await mockUnfold(page); await page.click('#insp [data-it="versions"]'); await settle(page, 600); } },
  '03-docs': { file: '01-workspace.html', hash: '#doc=watch-docs', run: async () => {} },
  '03-changelog': { file: '01-workspace.html', hash: '#doc=changelog', run: async () => {} },
  '10-outline-popup': { file: '01-workspace.html', width: WIDE, run: async (page) => { await mockUnfold(page); await page.click('#insp [data-it="outline"]'); await settle(page, 600); } },
  '10-kind-chip-menu': { file: '01-workspace.html', run: async (page) => { await mockUnfold(page); await settle(page, 300); await page.click('#kindchip'); await settle(page, 500); } },
  '10-empty-window': { file: '01-workspace.html', width: 1000, run: async () => {} },
  '10-split-narrowed': { file: '01-workspace.html', width: 800, run: async (page) => { await mockUnfold(page); await settle(page, 500); } },
  '09-inspector-metadata': { file: '01-workspace.html', run: async (page) => { await mockUnfold(page); await page.click('#insp [data-it="meta"]'); await settle(page, 600); } },
  '09-metadata-margin': {
    file: '01-workspace.html',
    run: async (page) => {
      await mockUnfold(page);
      // Read (the mock unfolds into Split), with the sidebar and the inspector away for room, then the preview on.
      await page.keyboard.press('Meta+Digit1');
      await page.evaluate(() => { window.Marxy.fold.away('side'); window.Marxy.fold.away('insp'); });
      await page.evaluate(() => window.Marxy.setPref('showMetadata', true));
      await settle(page, 700);
    },
  },
  '08-settings': { file: '08-settings.html', hash: '#reading', run: async (page) => { await settle(page, 400); } },
  '05-library-1000': { file: '05-collections.html', width: 1000, run: async () => {} },
  '08-settings-1000': { file: '08-settings.html', hash: '#types', width: 1000, run: async (page) => { await settle(page, 400); } },
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
        const { context, page } = await openMock(browser, theme, m.file, { width: m.width ?? W, height: m.height ?? H, hash: m.hash ?? '' });
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
