// X-33: Source's layout matrix. Boots the real app (Vite harness over the memory shell, shipped skeleton, WebKit,
// headless), puts a 20-line document (one blank line, one long line) into Source in each configuration, and records
// box offsets plus a screenshot per cell. Investigation only: nothing here is product code.
//
//   node docs/taste-review/2026-10-14-source-layout/matrix.mjs [--only id,id] [--out dir]
//
// Writes <out>/results.json, <out>/matrix.md (the table findings.md quotes) and <out>/shots/<cell>.png.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname } from 'node:path';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../../..');
const { launchWebkit } = await import(join(root, 'scripts/playwright-webkit.mjs'));
const support = await import(join(root, 'apps/desktop/test/support/two-pane.mjs'));
const csp = await import(join(root, 'scripts/check-csp.mjs'));

const args = process.argv.slice(2);
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const OUT = opt('--out') ?? here;
const ONLY = opt('--only')?.split(',') ?? null;
mkdirSync(join(OUT, 'shots'), { recursive: true });

// ---- the document: 20 lines, line 7 blank, line 12 long ------------------------------------------------------------
const LONG = 'long line '.repeat(30).trim(); // 299 characters
const lines = Array.from({ length: 20 }, (_, i) => `line ${i + 1} ${'ab'.repeat((i % 4) + 1)}`);
lines[6] = '';
lines[11] = LONG;
const DOC = lines.join('\n'); // no trailing newline: CodeMirror counts 20 lines
const SPECIAL = DOC.replace('line 3 ababab', 'line 3​ ab\u0007 ab ab\tab').replace('line 4 abababab', 'line 4\ttabbed‮');
// A large file (over 2 MiB, language.ts LARGE_FILE_BYTES = 2,097,152): the same 20 lines, with lines 5 and 12 padded to ~1.06 MB each.
const PAD = 'x'.repeat(1_060_000);
const LARGE = lines.map((l, i) => (i === 4 || i === 11 ? `${l} ${PAD}` : l)).join('\n');
const OTHER = '# Other pane\n\nA second document, so two panes are open.\n';

const THEMES = { night: { scheme: 'dark', config: '' }, paper: { scheme: 'light', config: 'variant = "light"\n' } };

// ---- cells ---------------------------------------------------------------------------------------------------------
// Baseline BASE: a saved Markdown file, folded window, one pane, Source, line numbers on (config), folding on, no aids,
// Night, 1000 x 800. Every cell is BASE with one change, except those marked `combo`.
const base = { path: '/w/doc.md', text: DOC, ln: true, width: 1000, height: 800, theme: 'night', mode: 'source', unfold: false, two: false };
const C = (id, change, note = '') => ({ ...base, id, note, ...change });
const cells = [
  C('base-night', {}, 'baseline'),
  C('base-paper', { theme: 'paper' }, 'baseline, Paper'),
  // axis: kind / metrics (V-12): a Markdown or text file wraps (prose look), code scrolls (code look)
  C('kind-txt', { path: '/w/doc.txt' }),
  C('kind-rs', { path: '/w/doc.rs' }, 'code file; opens in Source by default'),
  C('kind-json', { path: '/w/doc.json' }),
  C('kind-py', { path: '/w/doc.py' }),
  C('kind-log', { path: '/w/doc.log' }),
  C('kind-csv', { path: '/w/doc.csv' }),
  C('kind-noext', { path: '/w/doc' }, 'no extension'),
  // axis: line numbers
  C('ln-off', { ln: false }),
  C('ln-off-rs', { ln: false, path: '/w/doc.rs' }),
  C('ln-default-md', { ln: null }, 'no line_numbers key: the per-path default (off for Markdown)'),
  C('ln-default-rs', { ln: null, path: '/w/doc.rs' }, 'no key: on for code'),
  C('ln-toggled-on-md', { ln: null, after: 'toggle-ln' }, 'saved Markdown, numbers switched on from the palette command after Source is mounted'),
  C('ln-toggled-off-on-rs', { ln: null, path: '/w/doc.rs', after: 'toggle-ln,toggle-ln' }, 'code file, numbers off then on again at run time'),
  // axis: folding (folding is off only in large-file mode, editor.ts gutterExtensions(!isLargeSourceFile))
  C('large-md', { text: LARGE }, 'large-file mode: no fold gutter, no wrap, no grammar', ),
  C('large-rs', { text: LARGE, path: '/w/doc.rs' }),
  C('large-ln-off', { text: LARGE, ln: false }),
  // axis: view aids (V-08) and special characters
  C('aid-whitespace', { after: 'toggle-ws' }, 'show whitespace on'),
  C('aid-column-guide', { after: 'toggle-guide' }, 'column guide on'),
  C('aid-both-rs', { path: '/w/doc.rs', after: 'toggle-ws,toggle-guide' }),
  C('special-md', { text: SPECIAL }, 'zero-width, BEL, nbsp, tab, bidi override in the text'),
  C('special-rs', { text: SPECIAL, path: '/w/doc.rs' }),
  // axis: untitled vs saved. The screenshot's case: Untitled, line numbers on.
  C('untitled-typed-ln-on', { untitled: 'typed' }, 'Cmd+N, Source, typed; line_numbers = true in config (the screenshot case)'),
  C('untitled-typed-ln-default', { untitled: 'typed', ln: null }, 'Cmd+N, Source, typed; no key'),
  C('untitled-typed-ln-off', { untitled: 'typed', ln: false }),
  C('untitled-typed-toggle', { untitled: 'typed', ln: null, after: 'toggle-ln' }, 'Cmd+N, typed, numbers switched on from the palette command after typing'),
  C('untitled-typed-toggle-twice', { untitled: 'typed', ln: false, after: 'toggle-ln,toggle-ln,toggle-ln' }, 'off, on, off, on at run time'),
  C('untitled-scratch-ln-on', { untitled: 'scratch' }, 'handle.openScratch(text), numbers on'),
  C('untitled-typed-paper', { untitled: 'typed', theme: 'paper' }),
  // axis: window state and panes
  C('unfolded', { unfold: true }),
  C('unfolded-untitled', { untitled: 'typed', unfold: true }),
  C('unfolded-rs', { unfold: true, path: '/w/doc.rs' }),
  C('split-mode', { unfold: true, mode: 'split', width: 1500 }, 'Split in the unfolded window (needs 1433 px; at 1000 it refuses with a notice): Read and Source of the same file'),
  C('split-mode-folded', { mode: 'split' }, 'Split in the folded window: Read and Source of the same file'),
  C('two-panes-folded', { two: true }, 'folded window, two panes: doc.md in Source, other.md in Read'),
  C('two-panes-folded-both-source', { two: true, otherPath: '/w/other.rs', otherText: DOC, otherMode: 'source' }, 'folded window, two panes, both Source (md left, rs right)'),
  // axis: width (1000 is the baseline). F-100 is measured at 1000.
  C('w800', { width: 800 }),
  C('w1400', { width: 1400 }),
  C('w1920', { width: 1920 }),
  C('w1400-rs', { width: 1400, path: '/w/doc.rs' }),
  C('w1920-rs', { width: 1920, path: '/w/doc.rs' }),
  C('w800-untitled', { width: 800, untitled: 'typed' }),
  C('w1400-untitled', { width: 1400, untitled: 'typed' }),
  C('h600', { height: 600 }),
  // combinations the screenshot's case needs
  C('combo-untitled-unfolded-ws', { untitled: 'typed', unfold: true, after: 'toggle-ws' }, 'combo'),
  C('combo-untitled-guide', { untitled: 'typed', after: 'toggle-guide' }, 'combo'),
  C('combo-untitled-w1400-paper', { untitled: 'typed', width: 1400, theme: 'paper' }, 'combo'),
  // axis: the shipped CSP. The built renderer is served under the release policy (tauri.conf.json csp, plus the style nonce
  // Tauri adds), which refuses a runtime <style>; CodeMirror styles itself with <style> tags (style-mod).
  C('csp-base', { csp: true }, 'baseline under the release CSP'),
  C('csp-untitled', { csp: true, untitled: 'scratch' }, 'the screenshot case under the release CSP (a scratch document; Cmd+N is not wired in the built harness)'),
  C('csp-rs', { csp: true, path: '/w/doc.rs' }),
];

// ---- driving -------------------------------------------------------------------------------------------------------
const settle = (page, ms) => page.waitForTimeout(ms);
const CMD = { 'toggle-ln': 'view.toggle-line-numbers', 'toggle-ws': 'view.toggle-show-whitespace', 'toggle-guide': 'view.toggle-column-guide' };

let built = null;
async function builtServer() {
  if (built) return built;
  const { build } = await import(join(root, 'apps/desktop/node_modules/vite/dist/node/index.js'));
  const desktop = join(root, 'apps/desktop');
  const outDir = mkdtempSync(join(tmpdir(), 'marxy-source-layout-'));
  await build({ root: desktop, logLevel: 'silent', build: { outDir, emptyOutDir: true, rollupOptions: { input: { app: join(desktop, 'app.html') } } } });
  const NONCE = 'x33nonce';
  const policy = csp.releaseStyleCsp(csp.loadConfiguredCsp(), NONCE);
  const { style, body } = support.shippedSkeleton();
  const types = { '.html': 'text/html', '.ttf': 'font/ttf', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' };
  const server = createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const path = join(outDir, pathname.endsWith('/') ? `${pathname}index.html` : pathname);
    if (!existsSync(path)) { res.statusCode = 404; return res.end(); }
    const ext = extname(path);
    res.setHeader('Content-Type', types[ext] ?? 'application/octet-stream');
    if (ext === '.html') {
      res.setHeader('Content-Security-Policy', policy);
      const html = readFileSync(path, 'utf8')
        .replace('</head>', `<style>${style}</style></head>`)
        .replace(/<body[^>]*>/, '<body data-marxy-mode="rendered" data-marxy-variant="dark">')
        .replace('<article id="doc" class="marxy-article"></article>', body);
      return res.end(csp.injectStyleNonces(html, NONCE));
    }
    res.end(readFileSync(path));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  built = { base: `http://127.0.0.1:${server.address().port}/`, server };
  return built;
}

async function bootCsp(browser, cell) {
  const { base } = await builtServer();
  const theme = THEMES[cell.theme];
  const context = await browser.newContext({ viewport: { width: cell.width, height: cell.height }, colorScheme: theme.scheme, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.cspMessages = [];
  page.on('console', (m) => { if (/Refused to apply|Content Security Policy/i.test(m.text())) page.cspMessages.push(`${m.text().slice(0, 60)} @ ${m.location().url.split('/').pop()}:${m.location().lineNumber}`); });
  await page.goto(`${base}app.html`);
  await page.waitForFunction(() => typeof window.marxyApp?.start === 'function');
  const config = `${theme.config}${cell.ln === null ? '' : `line_numbers = ${cell.ln}\n`}`;
  const files = { '/config': config, [cell.path]: cell.text, '/w/other.md': OTHER };
  const encoded = Object.fromEntries(Object.entries(files).map(([p, t]) => [p, support.b64(t)]));
  const open = cell.untitled ? '/w/other.md' : cell.path;
  await page.evaluate(async ({ files, argv }) => {
    const handle = await window.marxyApp.start(files, argv);
    await handle.ready;
    window.__marxyHandle = handle;
    window.__cmd = (id) => window.marxyRunCommand(id);
  }, { files: encoded, argv: [open] });
  await settle(page, 800);
  return { context, page };
}

async function boot(browser, cell) {
  if (cell.csp) return bootCsp(browser, cell);
  const theme = THEMES[cell.theme];
  const context = await browser.newContext({ viewport: { width: cell.width, height: cell.height }, colorScheme: theme.scheme, deviceScaleFactor: 1 });
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
  const config = `${theme.config}${cell.ln === null ? '' : `line_numbers = ${cell.ln}\n`}`;
  const files = { '/config': config, [cell.path]: cell.text, '/w/other.md': OTHER, ...(cell.otherPath ? { [cell.otherPath]: cell.otherText } : {}) };
  const encoded = Object.fromEntries(Object.entries(files).map(([p, t]) => [p, support.b64(t)]));
  const open = cell.untitled ? '/w/other.md' : cell.path;
  await page.evaluate(
    async ({ encoded, open }) => {
      const bytes = {};
      for (const [path, text] of Object.entries(encoded)) bytes[path] = Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
      const { createMemoryShell } = await import('/src/shell/memory.ts');
      const { bootApplication } = await import('/src/main.ts');
      const handle = await bootApplication(createMemoryShell(bytes), { argv: [open] });
      await handle.ready;
      window.__marxyHandle = handle;
      window.__cmd = async (id) => {
        const { commands } = await import('/src/commands/index.ts');
        const c = commands().find((x) => x.id === id);
        if (!c) throw new Error('no command ' + id);
        return c.run({ showNotice: (m) => (window.__notices ??= []).push(m) });
      };
    },
    { encoded, open },
  );
  await settle(page, 800);
  return { context, page };
}

// The dev harness runs any registry command; the built page has only the Source view commands (marxyRunCommand) and keys.
async function run(page, cell, id) {
  if (!cell.csp) return page.evaluate((id) => window.__cmd(id), id);
  if (id === 'document.new') return page.keyboard.press('Meta+KeyN');
  if (id === 'view.mode-source') return page.keyboard.press('Meta+Digit3');
  if (id === 'view.mode-split') return page.keyboard.press('Meta+Digit2');
  return page.evaluate((id) => window.marxyRunCommand(id), id);
}

async function arrange(page, cell) {
  if (cell.unfold) { await page.evaluate(() => window.__marxyHandle.workspace().unfold()); await settle(page, 300); }
  if (cell.two) {
    // Open the second pane first: openIn refuses once the first pane holds Source (cell.paneInfo records what happened).
    cell.paneInfo = await page.evaluate(async (p) => {
      const panes = window.__marxyHandle.panes();
      const r = await panes.openIn('other', p);
      return { opened: r !== null, count: panes.panes.length };
    }, cell.otherPath ?? '/w/other.md');
    await settle(page, 600);
    await page.evaluate(async ({ left, right }) => {
      const [a, b] = window.__marxyHandle.panes().panes;
      await a.view.setMode(left);
      if (b) await b.view.setMode(right);
    }, { left: cell.mode, right: cell.otherMode ?? 'rendered' });
    await settle(page, 800);
  } else if (cell.untitled === 'typed') {
    await run(page, cell, 'document.new');
    await settle(page, 400);
    await run(page, cell, 'view.mode-source');
    await page.waitForSelector('.marxy-source-mount .cm-content');
    await page.click('.marxy-source-mount .cm-content');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]) await page.keyboard.insertText(lines[i]);
      if (i < lines.length - 1) await page.keyboard.press('Enter');
    }
    await settle(page, 400);
  } else if (cell.untitled === 'scratch') {
    await page.evaluate((t) => window.__marxyHandle.openScratch(t), DOC);
    await settle(page, 500);
    await run(page, cell, 'view.mode-source');
    await settle(page, 500);
  } else {
    await run(page, cell, cell.mode === 'split' ? 'view.mode-split' : 'view.mode-source');
    await settle(page, 700);
  }
  for (const step of (cell.after ?? '').split(',').filter(Boolean)) {
    await run(page, cell, CMD[step]);
    await settle(page, 450);
  }
  await settle(page, 500);
}

// Runs in the page: every Source editor on screen, with the boxes the card asks for.
function measure() {
  const r = (el) => {
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { top: +b.top.toFixed(1), left: +b.left.toFixed(1), right: +b.right.toFixed(1), bottom: +b.bottom.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1) };
  };
  const cs = (el, ...props) => (el ? Object.fromEntries(props.map((p) => [p, getComputedStyle(el)[p]])) : null);
  const editors = [...document.querySelectorAll('.cm-editor')].filter((e) => e.getBoundingClientRect().width > 0);
  return {
    mode: document.body.dataset.marxyMode,
    editors: editors.map((ed) => {
      const pane = ed.closest('[data-marxy-pane]') ?? ed.closest('main') ?? document.body;
      const mount = ed.closest('.marxy-source-mount');
      const frame = ed.closest('.marxy-source-frame');
      const scroller = ed.querySelector('.cm-scroller');
      const gutters = ed.querySelector('.cm-gutters');
      const ln = ed.querySelector('.cm-lineNumbers');
      const fold = ed.querySelector('.cm-foldGutter');
      const content = ed.querySelector('.cm-content');
      const cmLines = [...ed.querySelectorAll('.cm-line')];
      const numEls = ln ? [...ln.querySelectorAll('.cm-gutterElement')].filter((e) => getComputedStyle(e).visibility !== 'hidden' && /^\d+$/.test(e.textContent.trim())) : [];
      const foldEls = fold ? [...fold.querySelectorAll('.cm-gutterElement')].filter((e) => getComputedStyle(e).visibility !== 'hidden') : [];
      const chevrons = fold ? [...fold.querySelectorAll('.marxy-fold-open, .marxy-fold-closed')].length : 0;
      // Row-by-row: each numbered row against the .cm-line at the same index (a wrapped line is one .cm-line, one number).
      const n = Math.min(numEls.length, cmLines.length);
      let maxDy = 0;
      let worst = null;
      for (let i = 0; i < n; i++) {
        const dy = Math.abs(numEls[i].getBoundingClientRect().top - cmLines[i].getBoundingClientRect().top);
        if (dy > maxDy) { maxDy = dy; worst = { row: i + 1, number: numEls[i].textContent, lineText: cmLines[i].textContent.slice(0, 20) }; }
      }
      const pr = r(pane);
      const er = r(ed);
      const bar = (sel) => frame?.querySelector(sel)?.textContent?.replace(/\s+/g, ' ').trim() ?? null;
      return {
        pane: pr,
        frame: r(frame),
        editor: er,
        scroller: r(scroller),
        scrollerStyle: cs(scroller, 'display', 'flexDirection', 'overflowX', 'overflowY'),
        gutters: r(gutters),
        guttersStyle: cs(gutters, 'display', 'position', 'flexDirection', 'marginInlineStart', 'width'),
        lineNumbers: r(ln),
        foldGutter: r(fold),
        firstNumber: r(numEls[0]),
        firstFoldRow: r(foldEls[0]),
        content: r(content),
        firstLine: r(cmLines[0]),
        gutterCount: ed.querySelectorAll('.cm-gutter').length,
        lineNumbersCount: ed.querySelectorAll('.cm-lineNumbers').length,
        foldGutterCount: ed.querySelectorAll('.cm-foldGutter').length,
        numberedRows: numEls.length,
        renderedLines: cmLines.length,
        foldChevrons: chevrons,
        maxRowDy: +maxDy.toFixed(1),
        worstRow: worst,
        numberTops: numEls.map((x) => Math.round(x.getBoundingClientRect().top)),
        lineTops: cmLines.map((x) => Math.round(x.getBoundingClientRect().top)),
        lineHeights: cmLines.map((x) => Math.round(x.getBoundingClientRect().height)),
        numberHeights: numEls.map((x) => Math.round(x.getBoundingClientRect().height)),
        gutterLeftInset: pr && er ? +(r(gutters)?.left - pr.left).toFixed(1) : null,
        editorRightGap: pr && er ? +(pr.right - er.right).toFixed(1) : null,
        editorLeftGap: pr && er ? +(er.left - pr.left).toFixed(1) : null,
        topBar: bar('.marxy-source-top'),
        bottomBar: bar('.marxy-source-bottom'),
        mountClass: mount?.className ?? null,
        contentFont: getComputedStyle(content).fontFamily.slice(0, 40),
        cmStyleTags: [...document.head.querySelectorAll('style')].filter((s) => s.textContent.includes('.cm-')).length,
        lookWraps: !!ed.querySelector('.cm-lineWrapping'),
        marxyPaneIsMain: pane?.id ?? null,
      };
    }),
  };
}

async function docLines(page) {
  return page.evaluate(async () => {
    const { activeSourceEditor } = await import('/src/source/editor.ts');
    const e = activeSourceEditor();
    return e ? e.view.state.doc.lines : null;
  });
}

// ---- verdict ---------------------------------------------------------------------------------------------------------
function judge(cell, m, lines) {
  const why = [];
  if (m.editors.length === 0) why.push(`no Source editor on screen (mode ${m.mode}${m.notices?.length ? `; notice: ${m.notices.join(' / ')}` : ''})`);
  m.editors.forEach((e, i) => {
    const tag = m.editors.length > 1 ? `pane ${i + 1}: ` : '';
    if (!e.gutters) return;
    const hasNum = e.numberedRows > 0 || e.lineNumbers;
    const dTop = e.firstNumber && e.firstLine ? e.firstNumber.top - e.firstLine.top : e.gutters.top - e.firstLine.top;
    if (Math.abs(dTop) > 1) why.push(`${tag}first number ${dTop.toFixed(0)} px from first line top`);
    if (e.gutters.left > e.content.left + 0.5) why.push(`${tag}gutter right of text`);
    if (e.gutters.right > e.content.left + 1 && e.gutters.top >= e.content.top - 1 && e.gutters.top > e.firstLine.top + 1) why.push(`${tag}gutter stacked above text`);
    if (hasNum && lines !== null && e.numberedRows !== lines && !cell.large) why.push(`${tag}${e.numberedRows} numbers for ${lines} lines`);
    if (e.maxRowDy > 1) why.push(`${tag}rows drift up to ${e.maxRowDy} px`);
    if (e.scrollerStyle?.display !== 'flex') why.push(`${tag}scroller display ${e.scrollerStyle?.display}`);
    if (e.lineNumbersCount > 1 || e.foldGutterCount > 1) why.push(`${tag}duplicate gutters (${e.lineNumbersCount} numbers, ${e.foldGutterCount} folds)`);
  });
  return why;
}

// ---- run -----------------------------------------------------------------------------------------------------------
const browser = await launchWebkit();
const results = [];
try {
  for (const cell of cells) {
    if (ONLY && !ONLY.includes(cell.id)) continue;
    cell.large = cell.text === LARGE;
    const t0 = Date.now();
    const { context, page } = await boot(browser, cell);
    let m = null;
    let error = null;
    let lines = null;
    try {
      await arrange(page, cell);
      // A first paint is what loads the monospace face (font-display); measure after it, or a wrapped line is measured in the fallback face.
      await page.screenshot({ path: join(OUT, 'shots', `${cell.id}.png`) });
      await settle(page, 700);
      m = await page.evaluate(measure);
      lines = await docLines(page).catch(() => null);
      m.notices = await page.evaluate(() => window.__notices ?? []);
    } catch (e) {
      error = e.message.split('\n')[0];
    }
    await page.screenshot({ path: join(OUT, 'shots', `${cell.id}.png`) });
    await context.close();
    const wrong = m ? judge(cell, m, lines) : [`error: ${error}`];
    if (m && page.cspMessages) { m.cspRefusals = page.cspMessages.length; m.cspMessages = page.cspMessages; }

    results.push({ id: cell.id, note: cell.note, path: cell.untitled ? `Untitled (${cell.untitled})` : cell.path, config: { ln: cell.ln, width: cell.width, height: cell.height, theme: cell.theme, unfold: cell.unfold, two: cell.two, mode: cell.mode, after: cell.after ?? '' }, docLines: lines, paneInfo: cell.paneInfo, measured: m, wrong });
    console.log(`${cell.id.padEnd(30)} ${wrong.length ? 'WRONG: ' + wrong.join('; ') : 'ok'} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  }
} finally {
  await browser.close();
  built?.server.close();
  await support.closeHarness();
}

writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 1));
const f = (b) => (b ? `${b.top}/${b.left}` : 'none');
const rows = results.flatMap((c) =>
  (c.measured?.editors ?? [{}]).map((e, i, all) => {
    const id = all.length > 1 ? `${c.id} (pane ${i + 1})` : c.id;
    return `| ${id} | ${c.path.replace('/w/', '')} | ${c.config.width}${c.config.unfold ? ' unf' : ''}${c.config.theme === 'paper' ? ' P' : ''} | ${f(e.gutters)} | ${f(e.firstLine)} | ${e.numberedRows ?? '-'} / ${c.docLines ?? '-'} | ${e.editorLeftGap ?? '-'} / ${e.editorRightGap ?? '-'} | ${i === 0 && c.wrong.length ? c.wrong.join('; ') : i === 0 ? 'ok' : ''} |`;
  }),
);
writeFileSync(
  join(OUT, 'matrix.md'),
  ['| cell | file | width | gutters top/left | first .cm-line top/left | numbered rows / lines | editor left gap / right gap to pane | verdict |', '| --- | --- | --- | --- | --- | --- | --- | --- |', ...rows, ''].join('\n'),
);
