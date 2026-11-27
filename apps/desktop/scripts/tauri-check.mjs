// The built Tauri app on Windows, driven for real: `pnpm build`, then `node scripts/tauri-check.mjs [marxy.exe]`. The app is
// launched with WebView2's debugging port open and Playwright connects to its window; a second launch with a file goes to the
// running app (single instance), as a double-click in Explorer does. Checks the window (the rail and its
// panels, the tab row, the pane head's crumbs) and its grammar (a part copied with j and c, x-ray, Alt and a number, the
// Line's scopes and its Tab into Search through the Rust side's search, the Studio, a staged change read as unsaved and
// saved), the readings, Settings, character names, the window answering while a read stalls on a share, diagrams, a save by rename and its comparison page, afolder's page,
// Versions, an image, a HEIC through the system decoder (or the card that names it), a PSD's preview and an SVGZ, and a 2 GB video through marxy-file:// with Range and a path outside what the reader opened refused,
// a PNG as the image page and the 2 GB video, which has no reading, as the file card whose hex view reaches its last byte,
// a PDF drawn by pdf.js from ranges with Find reaching its text, a save from Source, and a Ruby file in Source coloured from Shiki's runs (the last ones in a temporary folder, so the demo
// is never written), and that the index of a folder
// that is gone was swept; then closes the window as its X does, launches again, checks the drawer's panel and the place
// came back, and drags a tab by the mouse. Prints PASS or FAIL for each, and exits with the number of
// failures. The app runs on a data folder of its own (MARXY_DATA_DIR, a new temporary folder each run, removed after), so the
// reader's history, layout, Versions and WebView2 profile are never read or written. WKWebView (macOS) has no such port:
// Windows only.
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { crc32, deflateRawSync } from 'node:zlib';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { newDataFolder, removeDataFolder, webviewsGone } from './data-folder.mjs';
import { frameColour, writeLargeMp4 } from './large-video.mjs';
import { longPdf } from './pdf-fixture.mjs';
import { describeDifference, embeddedSignature, largeLog, minimalPe, treeMemory, utf16LeWithBom, utf8WithBom } from './real-window-fixtures.mjs';
import { takeLock } from '../../../scripts/lib/machine-lock.mjs';

if (process.platform !== 'win32') {
  console.log('tauri-check: drives WebView2, so Windows only; on macOS use the smoke check (pnpm verify:cli)');
  process.exit(0);
}

// One run per machine: port 9333 and the single-instance lock are shared by every checkout. MARXY_LOCK_WAIT_SEC waits for a running one.
try {
  await takeLock('check-tauri', { waitMs: Number(process.env.MARXY_LOCK_WAIT_SEC ?? 0) * 1000, log: (m) => console.log(`tauri-check: ${m}`) });
} catch (e) {
  console.error(`tauri-check: ${e.message}`);
  process.exit(1);
}

const desktop = fileURLToPath(new URL('..', import.meta.url));
const exe = process.argv[2] ?? join(desktop, 'src-tauri', 'target', 'release', 'marxy.exe');
const demo = join(desktop, '..', '..', 'fixtures', 'demo');
const port = 9333;
const dataDir = newDataFolder('marxy-data-');
// The window is driven, not watched: a window another one covers must not stop drawing frames, or Playwright's clicks wait
// forever for an element to be stable (seen on a loaded machine: the rail's buttons found, on top, and never clicked).
const env = {
  ...process.env,
  MARXY_DATA_DIR: dataDir,
  WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --disable-features=CalculateNativeWinOcclusion --disable-backgrounding-occluded-windows --disable-renderer-backgrounding`,
};
const launch = (file) => spawn(exe, [join(demo, file)], { env, stdio: 'ignore' });
// A deadline already past arrives here as a negative count: it is expired, not a timeout for Node to correct.
const wait = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));
const results = [];
/** A zip of `[name, text]`, each deflated: the archive the check lists and opens an entry of. */
function zipOf(entries) {
  const locals = [];
  const central = [];
  let at = 0;
  for (const [name, text] of entries) {
    const raw = Buffer.from(text);
    const packed = deflateRawSync(raw);
    const n = Buffer.from(name);
    const fields = (b, o) => {
      b.writeUInt16LE(8, o);
      b.writeUInt16LE(0x8000, o + 2);
      b.writeUInt16LE(0x5b4e, o + 4);
      b.writeUInt32LE(crc32(raw), o + 6);
      b.writeUInt32LE(packed.length, o + 10);
      b.writeUInt32LE(raw.length, o + 14);
      b.writeUInt16LE(n.length, o + 18);
    };
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    fields(head, 8);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    fields(cd, 10);
    cd.writeUInt32LE(at, 42);
    locals.push(head, n, packed);
    central.push(cd, n);
    at += 30 + n.length + packed.length;
  }
  const cdBytes = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cdBytes.length, 12);
  end.writeUInt32LE(at, 16);
  return Buffer.concat([...locals, cdBytes, end]);
}

const check = (name, ok, detail = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` · ${detail}` : ''}`);

// Two index snapshots for the sweep to judge: one whose folder is gone (its parent, the data folder, is there to say so) and
// one whose folder is the demo. Neither name is the hash of a root the app holds, so the app never reads them.
const indexOf = (name, root) => {
  const file = join(dataDir, `index-${createHash('sha1').update(name).digest('hex')}.json`);
  writeFileSync(file, JSON.stringify({ version: 1, root: root.replaceAll('\\', '/'), generatedAtMs: Date.now(), entries: [] }));
  return file;
};
const goneIndex = indexOf('tauri-check gone', join(dataDir, 'gone-folder'));
const keptIndex = indexOf('tauri-check kept', demo);
const SWEEP_AFTER_MS = 23000; // INDEX_SWEEP_DELAY in src-tauri/src/data_dir.rs, and a margin

const problems = [];
// Console errors a step causes on purpose (the refusals), each forgiven once.
const expectedConsole = [];
let app;
let browser;
let page;
let ev;
let launchedAt;
const start = async () => {
  launchedAt = Date.now();
  app = launch('plans/pg16-upgrade-plan.md');
  browser = undefined;
  for (let i = 0; i < 60 && !browser; i++) {
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    } catch {
      await wait(500);
    }
  }
  if (!browser) return false;
  page = browser.contexts()[0].pages()[0];
  page.on('pageerror', (e) => problems.push(`[pageerror] ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const forgiven = expectedConsole.findIndex((re) => re.test(m.text()));
    if (forgiven >= 0) expectedConsole.splice(forgiven, 1);
    else problems.push(`[console] ${m.text()}`);
  });
  ev = (fn, arg) => page.evaluate(fn, arg);
  // The app is one page that never navigates (main.rs refuses every navigation, and the check makes one refused on purpose),
  // so a click is never followed by a navigation to wait for. After that refused one, Playwright waited for one on clicks
  // late in the run ("waiting for scheduled navigations to finish") though CDP reported none: the wait is left out.
  const click = page.click.bind(page);
  page.click = (selector, options) => click(selector, { noWaitAfter: true, ...options });
  return true;
};
const stop = () => {
  if (app?.exitCode === null) execFileSync('taskkill', ['/PID', String(app.pid), '/T', '/F'], { stdio: 'ignore' });
};
if (!(await start())) {
  console.log(`tauri-check: no WebView2 debugging port at ${port}; is ${exe} built?`);
  stop();
  await removeDataFolder(dataDir);
  process.exit(1);
}
let dir;
let outside;
let realDir;
const realExtra = [];
// The left section's drawer shows one panel; a card is read after its panel is shown. Clicking the shown panel's icon shuts
// the drawer, so the icon is clicked only when the drawer is not already showing that panel.
const PANEL_NAME = { places: 'Places', metadata: 'Metadata', outline: 'Outline', links: 'Links', search: 'Search', transforms: 'Transforms', export: 'Export', versions: 'Versions' };
const showLeft = async (id) => {
  const shown = () => ev((id) => document.body.getAttribute('data-marxy-drawer') !== 'closed' && document.querySelector('.marxy-drawer')?.dataset.marxyLeft === id, id);
  if (!(await shown())) {
    // A click that cannot land says why (Playwright's call log), rather than the bare timeout.
    await page.click(`.marxy-rail .marxy-l-rb[aria-label="${PANEL_NAME[id]}"]`, { timeout: 8000 }).catch((e) => {
      throw new Error(`showing ${id}: ${String(e).replace(/\s*\n\s*/g, ' | ').slice(0, 900)}`);
    });
  }
  await page.waitForFunction((id) => document.querySelector('.marxy-drawer')?.dataset.marxyLeft === id && !!document.querySelector('.marxy-drawer .marxy-l-body'), id, { timeout: 8000 }).catch(() => {});
};
const cardTitles = () => ev(() => [...document.querySelectorAll('.marxy-drawer .marxy-card-head span')].map((e) => e.textContent));
// Every card a viewer hosts in Metadata, Outline and Links (its own markup), in that order.
const allCardTitles = async () => {
  const out = [];
  for (const id of ['metadata', 'outline', 'links']) {
    await showLeft(id);
    out.push(...(await cardTitles()));
  }
  return out;
};

try {
  await page.waitForSelector('.marxy-article h1', { timeout: 20000 });
  check('the window is the Tauri app', await ev(() => '__TAURI_INTERNALS__' in window), await ev(() => location.href));
  check('the plan is set', await ev(() => document.querySelector('.marxy-article h1')?.textContent.includes('Postgres 14')));
  check('frame: rail, tab row, pane head, drawer', await ev(() => !!document.querySelector('.marxy-rail .marxy-l-rb') && !!document.querySelector('.marxy-tabbar') && !!document.querySelector('.marxy-head .marxy-crumbs') && !!document.querySelector('.marxy-drawer')));
  const docked = await ev(() => document.body.getAttribute('data-marxy-drawer') === 'docked');
  // Outline is rows: a Markdown file's sections, each keyed by `h:`.
  const outlineRows = (prefix) => ev((p) => document.querySelectorAll(`.marxy-drawer .marxy-l-body[data-marxy-left="outline"] .marxy-l-prow[data-marxy-left-row^="${p}"]`).length, prefix);
  if (docked) {
    await showLeft('outline');
    await page.waitForFunction(() => document.querySelector('.marxy-drawer .marxy-l-body[data-marxy-left="outline"] .marxy-l-prow[data-marxy-left-row^="h:"]'), null, { timeout: 8000 }).catch(() => {});
    check('panel: Outline lists the plan\'s sections', (await outlineRows('h:')) > 3, `${await outlineRows('h:')} rows`);
  } else check('drawer: at the edge (the window leaves it no room), so its panels are not checked', true);
  check('paths reach the page without a Windows verbatim prefix', !(await ev(() => document.title + location.href)).includes('//?/'));

  // The cursor, depths, panels and the Line in the real window. Every selector is the WebKit suite's: cursor.test.mjs,
  // depths.test.mjs, window.test.mjs, left-frame.test.mjs, line.test.mjs, close-joins.test.mjs.
  const blurPage = () => ev(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  const notices = () => ev(() => [...document.querySelectorAll('.marxy-notice-text')].map((n) => n.textContent).join(' | '));
  await blurPage();
  await page.keyboard.press('j');
  await page.waitForSelector('[data-marxy-pane="0"] .marxy-cursor', { timeout: 5000 }).catch(() => {});
  await page.keyboard.press('c');
  await page.waitForFunction(() => [...document.querySelectorAll('.marxy-notice-text')].some((n) => /as written/.test(n.textContent)), null, { timeout: 5000 }).catch(() => {});
  // Windows' own clipboard, read by the system: the native pasteboard commands are macOS only (pasteboard/mod.rs answers
  // `unsupported` here, and the app's paste takes the paste event's text instead), so the page cannot read it back itself.
  let pasted;
  try {
    pasted = execFileSync('powershell', ['-NoProfile', '-Command', '[Console]::OutputEncoding = [Text.Encoding]::UTF8; [Console]::Out.Write((Get-Clipboard -Raw))'], { encoding: 'utf8' });
  } catch (e) {
    pasted = `refused ${String(e).slice(0, 60)}`;
  }
  // The notice says how many bytes were copied; the clipboard holds exactly that many (CRLF and all).
  const copiedBytes = Number(/as written, ([\d,]+) B/.exec(await notices())?.[1]?.replace(/,/g, '') ?? -1);
  check('j puts the cursor on a part and c copies its bytes to the clipboard', copiedBytes > 0 && !pasted.startsWith('refused') && new TextEncoder().encode(pasted).length === copiedBytes, `${JSON.stringify(pasted.slice(0, 40))}; ${(await notices()).slice(0, 80)}`);
  await page.keyboard.press('x');
  await page.waitForSelector('[data-marxy-pane="0"] .marxy-xray', { timeout: 5000 }).catch(() => {});
  check('x x-rays the part: its stored lines in place of it', await ev(() => !!document.querySelector('[data-marxy-pane="0"] .marxy-xray')));
  await page.keyboard.press('x');
  await page.keyboard.press('Escape');
  const rowNow = await ev(() => ({ tabs: document.querySelectorAll('.marxy-tabbar .marxy-tab').length, current: document.querySelector('.marxy-tabbar .marxy-tab[aria-selected="true"] .marxy-tab-name')?.textContent ?? '' }));
  check('the tab row holds the plan as its current tab', rowNow.tabs >= 1 && rowNow.current === 'pg16-upgrade-plan.md', JSON.stringify(rowNow));
  await page.click('[data-marxy-head="0"] .marxy-crumb:text-is("plans")').catch(() => {});
  await page.waitForSelector('.marxy-verb-menu [role="menuitem"]', { timeout: 5000 }).catch(() => {});
  const crumbMenu = await ev(() => [...document.querySelectorAll('.marxy-verb-menu [role="menuitem"]')].map((e) => e.textContent.trim()));
  check('a folder crumb opens a menu of its folder', crumbMenu.some((r) => r.startsWith('Read this folder as a page')) && crumbMenu.some((r) => /^pg16-upgrade-plan\.md\s*here/.test(r)), crumbMenu.slice(0, 4).join(' | '));
  await page.keyboard.press('Escape');
  await blurPage();
  await page.keyboard.press('Alt+2');
  await page.waitForFunction(() => document.querySelector('.marxy-drawer .marxy-l-body[data-marxy-left="metadata"]'), null, { timeout: 8000 }).catch(() => {});
  check('Alt+2 shows Metadata in the drawer', await ev(() => document.querySelector('.marxy-drawer')?.dataset.marxyLeft === 'metadata' && document.body.getAttribute('data-marxy-drawer') !== 'closed'));
  await page.keyboard.press('Control+k');
  await page.waitForSelector('#marxy-palette[open]', { timeout: 5000 }).catch(() => {});
  await page.keyboard.type('>larger text');
  await wait(400);
  const commandsLine = await ev(() => ({ scope: document.querySelector('#marxy-palette .marxy-palette-scope')?.textContent ?? '', rows: [...document.querySelectorAll('#marxy-palette .marxy-palette-row')].map((r) => r.textContent.trim()) }));
  check('Ctrl+K opens the Line, and > is its commands', commandsLine.scope === 'Commands' && commandsLine.rows.some((r) => r.startsWith('Text larger') || r.startsWith('Larger text')), JSON.stringify({ ...commandsLine, rows: commandsLine.rows.slice(0, 3) }));
  // # searches the text of every file through the Rust side; Tab keeps the hit under its cursor in Search.
  await page.fill('#marxy-palette .marxy-palette-query', '#regproc');
  await page.waitForFunction(() => document.querySelectorAll('#marxy-palette .marxy-palette-row').length > 0, null, { timeout: 30000 }).catch(() => {});
  const grepScope = await ev(() => document.querySelector('#marxy-palette .marxy-palette-scope')?.textContent ?? '');
  const grepRows = await ev(() => document.querySelectorAll('#marxy-palette .marxy-palette-row').length);
  check('# in the Line finds a word inside files, through the Rust side', grepScope === 'Search the workspace' && grepRows > 0, `${grepScope}: ${grepRows} rows`);
  await page.keyboard.press('Tab');
  await page.waitForFunction(() => document.querySelector('.marxy-drawer .marxy-l-body[data-marxy-left="search"] .marxy-l-prow.marxy-l-cur'), null, { timeout: 30000 }).catch(() => {});
  const kept = await ev(() => ({ cur: document.querySelector('.marxy-drawer .marxy-l-prow.marxy-l-cur')?.dataset.marxyLeftRow ?? '', said: document.querySelector('.marxy-drawer')?.textContent.match(/\d[\d,]* match\w* in \d+ files?/)?.[0] ?? '' }));
  check('Tab keeps it in Search, the panel cursor on the hit', kept.cur.startsWith('h:') && kept.said !== '', JSON.stringify(kept));
  await page.keyboard.press('Escape');
  await blurPage();
  await page.keyboard.press('Shift+A');
  await page.waitForSelector('dialog.marxy-studio[open]', { timeout: 8000 }).catch(() => {});
  const studioOpen = await ev(() => !!document.querySelector('dialog.marxy-studio[open]'));
  await page.keyboard.press('Escape');
  await page.waitForSelector('dialog.marxy-studio', { state: 'detached', timeout: 5000 }).catch(() => {});
  check('A opens the Studio and Esc closes it', studioOpen && !(await ev(() => !!document.querySelector('dialog.marxy-studio'))));

  const openOther = async (file, selector) => {
    const second = launch(file);
    await new Promise((r) => second.on('exit', r));
    await page.waitForFunction((sel) => !!document.querySelector(sel), selector, { timeout: 15000 }).catch(() => {});
    await wait(500);
  };
  await openOther('data/release.json', '.marxy-article [data-marxy-reading="tree"]');
  check('a second launch opens release.json in the running app, as a data tree', await ev(() => !!document.querySelector('.marxy-article [data-marxy-reading="tree"]')));
  await openOther('data/p95-latency.csv', '.marxy-article [data-marxy-reading="table"]');
  await page.click('th[data-marxy-sort="3"]');
  check('CSV: a column name sorts the rows', await ev(() => document.querySelector('th[aria-sort]')?.getAttribute('aria-sort') === 'descending'));
  await openOther('logs/build-2026-10-14.log', '.marxy-log-time');
  if (docked) {
    // A log's Outline: its levels, each a row keyed `lv:`.
    await showLeft('outline');
    await page.waitForFunction(() => document.querySelector('.marxy-drawer .marxy-l-body[data-marxy-left="outline"] .marxy-l-prow[data-marxy-left-row^="lv:"]'), null, { timeout: 8000 }).catch(() => {});
    check('log: Outline lists its levels', (await outlineRows('lv:')) > 0, `${await outlineRows('lv:')} levels`);
  }

  await page.click('.marxy-rail .marxy-l-rb[aria-label="Settings"]');
  await wait(600);
  check('Settings: the eleven proposals', (await ev(() => document.querySelectorAll('[data-marxy-setting^="proposals."]').length)) === 11);
  await page.click('.marxy-rail .marxy-l-rb[aria-label="Settings"]');
  await wait(600);

  // Every character's name comes from the table compiled into the Rust side.
  check('a character\'s Unicode name through the Rust side', (await ev(() => window.__TAURI_INTERNALS__.invoke('char_name', { code: 0x2014 }))) === 'em dash');

  // The page may start only a [[command]] config.toml names, by its name, and may call no plugin (its capability).
  // A raw body is made in the page: a typed array does not survive evaluate's serialisation.
  const refused = (cmd, args, options) => ev(([c, a, o]) => window.__TAURI_INTERNALS__.invoke(c, a ?? new Uint8Array(0), o).then(() => 'ran', (e) => (typeof e === 'string' ? e : e?.code ?? JSON.stringify(e))), [cmd, args, options]);
  const unknownRun = await refused('run_command', null, { headers: { 'x-marxy-run': encodeURIComponent(JSON.stringify({ id: 'marxy-no-such-command', cwd: null })) } });
  check('run_command refuses a command id config.toml does not name', unknownRun === 'invalid', unknownRun);
  const dialog = await refused('plugin:dialog|open', { options: {} });
  check('a plugin command the capability does not grant is refused', dialog !== 'ran', String(dialog).slice(0, 80));
  // A release build is never the dev server, so a local server on any port is somewhere else (main.rs navigation_allowed).
  const originBefore = await ev(() => location.origin);
  await ev(() => { location.href = 'http://localhost:1234/'; }).catch(() => {});
  await wait(800);
  const originAfter = await ev(() => (document.querySelector('.marxy-rail') ? location.origin : 'no app')).catch((e) => String(e).slice(0, 60));
  check('the window refuses to navigate to http://localhost:1234', originAfter === originBefore, `${originBefore} -> ${originAfter}`);

  // A read on a share that never answers (TEST-NET-1 stalls about 25 s here) must not hold the main thread: another command
  // is answered at once. A fresh host each run, because Windows remembers a host that failed and then fails it fast.
  const stall = await ev(async (path) => {
    const tauri = window.__TAURI_INTERNALS__;
    let settled = false;
    tauri.invoke('read_file', { path }).catch(() => {}).finally(() => { settled = true; });
    await new Promise((r) => setTimeout(r, 300));
    const t0 = performance.now();
    const name = await tauri.invoke('char_name', { code: 0x2014 });
    return { stalled: !settled, answeredMs: Math.round(performance.now() - t0), name };
  }, `//192.0.2.${2 + Math.floor(Math.random() * 250)}/marxy-stall/a.md`);
  check('the window answers while a read on an unreachable share stalls', stall.name === 'em dash' && stall.answeredMs < 1000,
    `${stall.answeredMs} ms, ${stall.answeredMs >= 1000 ? 'the command waited for the read' : stall.stalled ? 'the read was still stalled' : 'the share failed fast, so the probe proves nothing'}`);

  // A mermaid fence is drawn by the renderer, loaded under the app's CSP.
  await openOther('tidemark/docs/architecture.md', 'pre[data-marxy-diagram="drawn"]');
  check('a mermaid fence is drawn as a diagram', await ev(() => !!document.querySelector('pre[data-marxy-diagram="drawn"] svg')));

  // A file saved by another program the way editors save (a temporary file renamed over it) reloads, and what changed is a
  // comparison page with both sides numbered. The file is a copy in the temporary folder; the demo is not touched.
  dir = mkdtempSync(join(tmpdir(), 'marxy-check-'));
  const copy = join(dir, 'plan.md');
  copyFileSync(join(demo, 'plans', 'pg16-upgrade-plan.md'), copy);
  const second = spawn(exe, [copy], { env, stdio: 'ignore' });
  await new Promise((r) => second.on('exit', r));
  await page.waitForFunction(() => document.title.includes('plan.md'), null, { timeout: 15000 }).catch(() => {});
  await wait(800);
  const text = readFileSync(copy, 'utf8');
  writeFileSync(`${copy}.tmp`, text.replace('under 4 minutes', 'under 3 minutes'));
  renameSync(`${copy}.tmp`, copy);
  await page.waitForFunction(() => document.querySelector('.marxy-article')?.textContent.includes('under 3 minutes'), null, { timeout: 15000 }).catch(() => {});
  check('a save by rename over the open file reloads it', await ev(() => document.querySelector('.marxy-article')?.textContent.includes('under 3 minutes')));
  await page.keyboard.press('Control+p');
  await page.fill('#marxy-palette .marxy-palette-query', '>Show what changed on disk');
  await wait(300);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('.marxy-article')?.textContent.includes('The comparison you asked for'), null, { timeout: 15000 }).catch(() => {});
  check('what changed on disk is a comparison page', await ev(() => document.querySelector('.marxy-article')?.textContent.includes('The comparison you asked for')));
  await page.waitForFunction(() => document.querySelectorAll('.marxy-article [data-marxy-a]').length > 0, null, { timeout: 15000 }).catch(() => {});
  check('its patch is numbered on both sides', await ev(() => document.querySelectorAll('.marxy-article [data-marxy-a]').length > 0 && document.querySelectorAll('.marxy-article [data-marxy-b]').length > 0));

  // A folder opens as a page from Places (Ctrl+click on a folder row, or `o` on the place's own row), through the Rust side's listing.
  await showLeft('places');
  await page.waitForSelector('.marxy-drawer .marxy-l-row.marxy-l-dir, .marxy-drawer [data-marxy-left-row^="g:root:"]', { timeout: 8000 }).catch(() => {});
  if (await page.$('.marxy-drawer .marxy-l-row.marxy-l-dir')) await page.click('.marxy-drawer .marxy-l-row.marxy-l-dir', { modifiers: ['Control'] });
  else {
    await page.click('.marxy-drawer [data-marxy-left-row^="g:root:"]');
    await page.keyboard.press('o');
  }
  await page.waitForSelector('.marxy-apppage .marxy-folderpage-row', { timeout: 8000 }).catch(() => {});
  check('a folder opens as a page listing what is on disk', (await ev(() => document.querySelectorAll('.marxy-apppage .marxy-folderpage-row').length)) > 0);
  await page.keyboard.press('Escape');
  await wait(400);

  // The copy read before the reload is kept, and Versions lists it. The comparison is in front: the copy's file is
  // brought back first, by launching it again, as a double-click would.
  const again = spawn(exe, [copy], { env, stdio: 'ignore' });
  await new Promise((r) => again.on('exit', r));
  await page.waitForFunction(() => document.title.includes('plan.md') && !document.title.includes('Compare'), null, { timeout: 10000 }).catch(() => {});
  await showLeft('versions');
  await page.waitForSelector('.marxy-drawer [data-marxy-left-row^="c:"]', { timeout: 8000 }).catch(() => {});
  check('Versions lists the copy kept before the file changed', (await ev(() => document.querySelectorAll('.marxy-drawer [data-marxy-left-row^="c:"]').length)) > 0);
  await page.click('.marxy-rail .marxy-l-rb[aria-label="Versions"]');
  await wait(300);

  // A staged change: `d` takes the part under the cursor out, the pane head says Unsaved and nothing is
  // written; Ctrl+S writes it through the Rust side's atomic write (joins.test.mjs, changes.test.mjs).
  const onDisk = readFileSync(copy, 'utf8');
  await blurPage();
  await page.keyboard.press('j');
  await page.waitForSelector('[data-marxy-pane="0"] .marxy-cursor', { timeout: 5000 }).catch(() => {});
  await page.keyboard.press('d');
  await page.waitForSelector('[data-marxy-head="0"] .marxy-head-chip[data-marxy-chip="unsaved"]:not([hidden])', { timeout: 5000 }).catch(() => {});
  const chip = await ev(() => document.querySelector('[data-marxy-head="0"] .marxy-head-chip[data-marxy-chip="unsaved"]:not([hidden])')?.textContent ?? '');
  check('a staged change shows the unsaved chip and writes nothing', /Unsaved · 1 place/.test(chip) && readFileSync(copy, 'utf8') === onDisk, chip);
  await page.keyboard.press('Control+s');
  for (let i = 0; i < 20 && readFileSync(copy, 'utf8') === onDisk; i++) await wait(250);
  await page.waitForSelector('[data-marxy-head="0"] .marxy-head-chip[data-marxy-chip="unsaved"]', { state: 'hidden', timeout: 5000 }).catch(() => {});
  const saved = readFileSync(copy, 'utf8');
  check('Save writes the staged change to disk, and the chip goes', saved !== onDisk && saved.length < onDisk.length && !(await ev(() => !!document.querySelector('[data-marxy-head="0"] .marxy-head-chip[data-marxy-chip="unsaved"]:not([hidden])'))), `${onDisk.length} -> ${saved.length} bytes`);

  // An image beside a document is read through marxy-file://, which serves only what the reader opened.
  copyFileSync(join(desktop, 'src-tauri', 'icons', '128x128.png'), join(dir, 'mark.png'));
  writeFileSync(join(dir, 'pictured.md'), '# Pictured\n\n![the mark](mark.png)\n');
  const third = spawn(exe, [join(dir, 'pictured.md')], { env, stdio: 'ignore' });
  await new Promise((r) => third.on('exit', r));
  await page.waitForSelector('.marxy-article img', { timeout: 15000 }).catch(() => {});
  await page.waitForFunction(() => (document.querySelector('.marxy-article img')?.naturalWidth ?? 0) > 0, null, { timeout: 15000 }).catch(() => {});
  check('an image beside the document is shown', (await ev(() => document.querySelector('.marxy-article img')?.naturalWidth ?? 0)) === 128);
  const imageSrc = await ev(() => document.querySelector('.marxy-article img')?.getAttribute('src') ?? '');
  check('the image comes through marxy-file://', imageSrc.startsWith('http://marxy-file.localhost/'), imageSrc.slice(0, 48));
  const fetched = (url, range) => ev(async ([u, r]) => {
    try {
      const res = await fetch(u, r ? { headers: { Range: r } } : {});
      const body = await res.arrayBuffer();
      return { status: res.status, type: res.headers.get('content-type'), range: res.headers.get('content-range'), length: body.byteLength };
    } catch (e) {
      return { status: 0, error: String(e) };
    }
  }, [url, range]);
  const fileUrl = (path) => `http://marxy-file.localhost/${encodeURIComponent(path.replaceAll('\\', '/'))}`;
  const pngSize = readFileSync(join(dir, 'mark.png')).length;
  const head = await fetched(imageSrc, 'bytes=0-15');
  check('marxy-file:// answers a Range with 206, its Content-Range and the type', head.status === 206 && head.length === 16 && head.range === `bytes 0-15/${pngSize}` && head.type === 'image/png', JSON.stringify(head));

  // A local SVG is read for its size by the Rust side and drawn by <img> only, never as markup.
  writeFileSync(join(dir, 'vector.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="48"><script>top.__svgRan = true</script><rect width="96" height="48" fill="#36c"/></svg>');
  writeFileSync(join(dir, 'vectored.md'), '# Vectored\n\n![the vector](vector.svg)\n');
  const vectored = spawn(exe, [join(dir, 'vectored.md')], { env, stdio: 'ignore' });
  await new Promise((r) => vectored.on('exit', r));
  await page.waitForFunction(() => (document.querySelector('.marxy-article img[alt="the vector"]')?.naturalWidth ?? 0) > 0, null, { timeout: 15000 }).catch(() => {});
  const vector = await ev(() => {
    const img = document.querySelector('.marxy-article img[alt="the vector"]');
    const box = img?.getBoundingClientRect();
    return { tag: img?.tagName, w: box?.width ?? 0, h: box?.height ?? 0, attrs: [img?.getAttribute('width'), img?.getAttribute('height')], inline: document.querySelectorAll('.marxy-article object, .marxy-article embed, .marxy-article iframe, .marxy-article svg').length, ran: window.__svgRan ?? null };
  });
  check('a local SVG is drawn by an <img> with a size from its root', vector.tag === 'IMG' && vector.w > 0 && vector.h > 0 && vector.attrs.join('x') === '96x48', JSON.stringify(vector));
  check('the SVG is not inlined and its script never ran', vector.inline === 0 && vector.ran === null);
  const back = spawn(exe, [join(dir, 'pictured.md')], { env, stdio: 'ignore' });
  await new Promise((r) => back.on('exit', r));
  await page.waitForFunction(() => document.querySelector('.marxy-article img')?.getAttribute('alt') === 'the mark', null, { timeout: 15000 }).catch(() => {});

  // What the reader did not open is refused: a file in another folder, a `..` out of the open one, a system file.
  outside = mkdtempSync(join(tmpdir(), 'marxy-outside-'));
  writeFileSync(join(outside, 'secret.txt'), 'not opened');
  const refusals = [];
  // Each refusal is logged by the webview as a failed load; forgiven before it can arrive.
  for (let i = 0; i < 3; i++) expectedConsole.push(/status of 403 \(Forbidden\)/);
  for (const p of [join(outside, 'secret.txt'), `${dir}/../${basename(outside)}/secret.txt`, 'C:/Windows/win.ini']) refusals.push((await fetched(fileUrl(p))).status);
  check('marxy-file:// refuses a path outside what the reader opened (403)', refusals.every((s) => s === 403), refusals.join(' '));

  // A TIFF, which WebView2 cannot show, comes back decoded in Rust as a PNG through `?decoded`.
  const images = join(desktop, 'src-tauri', 'tests', 'fixtures', 'images');
  copyFileSync(join(images, 'tiny.tiff'), join(dir, 'scan.tiff'));
  copyFileSync(join(images, 'rotated.jpg'), join(dir, 'rotated.jpg'));
  const decoded = await ev(async (u) => {
    try {
      const res = await fetch(u);
      const body = new Uint8Array(await res.arrayBuffer());
      const shown = await new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(`${img.naturalWidth}x${img.naturalHeight}`);
        img.onerror = () => resolve('error');
        img.src = u;
      });
      return { status: res.status, type: res.headers.get('content-type'), magic: [...body.slice(0, 4)].join(','), shown };
    } catch (e) {
      return { status: 0, error: String(e) };
    }
  }, `${fileUrl(join(dir, 'scan.tiff'))}?decoded`);
  check('a TIFF through marxy-file://...?decoded comes back a PNG the webview shows', decoded.status === 200 && decoded.type === 'image/png' && decoded.magic === '137,80,78,71' && decoded.shown === '6x4', JSON.stringify(decoded));

  // The facts of a JPEG stored on its side: its stored size, EXIF orientation 6, the camera and where it was taken.
  const facts = await ev((path) => window.__TAURI_INTERNALS__.invoke('image_facts', { path }).catch((e) => ({ error: e?.code ?? String(e) })), join(dir, 'rotated.jpg'));
  check('image_facts reads a rotated JPEG\'s size, orientation, EXIF and location', facts?.format === 'jpeg' && facts.width === 8 && facts.height === 4 && facts.orientation === 6 && facts.show === 'webview' && facts.exif?.camera === 'Marxy Test Camera' && facts.exif?.exposure === '1/250 s' && facts.colorProfile === 'sRGB built-in' && Math.abs((facts.location?.lat ?? 0) - 51.5006) < 0.001, JSON.stringify(facts));
  copyFileSync(join(images, 'rotated.jpg'), join(outside, 'rotated.jpg'));
  const outsideFacts = await ev((path) => window.__TAURI_INTERNALS__.invoke('image_facts', { path }).then(() => 'read', (e) => e?.code ?? String(e)), join(outside, 'rotated.jpg'));
  check('image_facts refuses a file outside what the reader opened', outsideFacts === 'permission', outsideFacts);

  // A real MP4 past 2 GB, sparse, its frames after a 2.2 GB gap: the video element reads it by Range and seeks to a frame
  // without the file being read whole. The frames are encoded here in the page, VP9 by WebCodecs.
  const FRAMES = 40;
  const encoded = await ev(async (n) => {
    const canvas = new OffscreenCanvas(128, 96);
    const g = canvas.getContext('2d');
    const chunks = [];
    let failure = null;
    const encoder = new VideoEncoder({
      output: (c) => {
        const b = new Uint8Array(c.byteLength);
        c.copyTo(b);
        chunks.push(b);
      },
      error: (e) => {
        failure = String(e);
      },
    });
    encoder.configure({ codec: 'vp09.00.10.08', width: 128, height: 96, bitrate: 1_000_000, framerate: 10 });
    for (let i = 0; i < n; i++) {
      g.fillStyle = `hsl(${(i * 360) / n}, 100%, 50%)`;
      g.fillRect(0, 0, 128, 96);
      const frame = new VideoFrame(canvas, { timestamp: i * 100_000, duration: 100_000 });
      encoder.encode(frame, { keyFrame: true });
      frame.close();
    }
    await encoder.flush();
    const base64 = (b) => {
      let s = '';
      for (const x of b) s += String.fromCharCode(x);
      return btoa(s);
    };
    return { failure, frames: chunks.map(base64) };
  }, FRAMES);
  if (encoded.failure || encoded.frames.length !== FRAMES) throw new Error(`VP9 encode in the page: ${encoded.failure ?? `${encoded.frames.length} frames`}`);
  const video = join(dir, 'long.mp4');
  const { size: videoSize, samplesAt } = writeLargeMp4(video, { width: 128, height: 96, fps: 10, frames: encoded.frames.map((f) => Buffer.from(f, 'base64')), gap: 2_200_000_000 });
  const served = [];
  const onResponse = async (res) => {
    if (!res.url().includes('long.mp4')) return;
    const headers = await res.request().allHeaders().catch(() => ({}));
    served.push({ status: res.status(), asked: headers.range ?? null, sent: res.headers()['content-range'] ?? null });
  };
  page.on('response', onResponse);
  const seeks = await ev(async ({ src, targets }) => {
    const v = document.createElement('video');
    v.crossOrigin = 'anonymous';
    v.muted = true;
    v.preload = 'auto';
    v.style.cssText = 'position:fixed;left:0;top:0;width:128px;height:96px';
    document.body.append(v);
    const once = (name, ms) => new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`no ${name} in ${ms} ms (error ${v.error?.code ?? '-'} ${v.error?.message ?? ''})`)), ms);
      v.addEventListener(name, () => {
        clearTimeout(t);
        resolve();
      }, { once: true });
    });
    try {
      const loaded = once('loadeddata', 20000);
      v.src = src;
      await loaded;
      const canvas = new OffscreenCanvas(128, 96);
      const g = canvas.getContext('2d', { willReadFrequently: true });
      const out = { duration: v.duration, frames: [] };
      for (const i of targets) {
        const seeked = once('seeked', 20000);
        // `seeked` can fire before the frame is presented; the drawn pixel must be the new frame's.
        const presented = new Promise((resolve) => {
          v.requestVideoFrameCallback(() => resolve());
          setTimeout(resolve, 2000);
        });
        const t0 = performance.now();
        v.currentTime = i / 10 + 0.05;
        await seeked;
        await presented;
        g.drawImage(v, 0, 0, 128, 96);
        out.frames.push({ i, ms: Math.round(performance.now() - t0), rgb: [...g.getImageData(64, 48, 1, 1).data.slice(0, 3)] });
      }
      return out;
    } catch (e) {
      return { error: String(e?.message ?? e) };
    } finally {
      v.remove();
    }
  }, { src: fileUrl(video), targets: [30, 5, 39] });
  await wait(300);
  page.off('response', onResponse);
  if (seeks.error) {
    check('a 2 GB video seeks through marxy-file://', false, seeks.error);
  } else {
    const near = (a, b) => a.every((c, k) => Math.abs(c - b[k]) <= 40);
    const shown = seeks.frames.map((f) => ({ ...f, want: frameColour(f.i, FRAMES) }));
    check(`a ${(videoSize / 2 ** 30).toFixed(2)} GB video seeks to frames 30, 5 and 39 and shows each`, Math.abs(seeks.duration - FRAMES / 10) < 0.05 && shown.every((f) => near(f.rgb, f.want)),
      `${seeks.duration} s; ${shown.map((f) => `#${f.i} ${f.ms} ms rgb(${f.rgb}) want rgb(${f.want})`).join(', ')}`);
    const spans = served.map((s) => /^bytes (\d+)-(\d+)\//.exec(s.sent ?? '')).filter(Boolean);
    const total = spans.reduce((a, m) => a + Number(m[2]) - Number(m[1]) + 1, 0);
    const pastGap = spans.filter((m) => Number(m[2]) >= samplesAt).length;
    check('every video request is a Range answered 206, some past 2 GB, and what is sent is a sliver of the file',
      served.length > 0 && served.every((s) => s.status === 206 && s.asked?.startsWith('bytes=')) && pastGap > 0 && total < 64 * 2 ** 20,
      `${served.length} requests, ${pastGap} reaching the samples at byte ${samplesAt}, ${(total / 2 ** 20).toFixed(2)} MB of ${(videoSize / 2 ** 20).toFixed(0)} MB; ${served.slice(0, 5).map((s) => `${s.asked} -> ${s.status} ${s.sent}`).join('; ')}`);
  }

  // An edit in Source is saved through the Rust side's atomic write, its bytes on disk.
  await page.click('.marxy-head .marxy-rs-source');
  await page.waitForSelector('.cm-content', { timeout: 10000 });
  await page.click('.cm-content');
  await page.keyboard.press('Control+End');
  await page.keyboard.type('Saved by the check.\n');
  await page.keyboard.press('Control+s');
  for (let i = 0; i < 20 && !readFileSync(join(dir, 'pictured.md'), 'utf8').includes('Saved by the check.'); i++) await wait(250);
  check('an edit in Source is saved to disk', readFileSync(join(dir, 'pictured.md'), 'utf8').endsWith('Saved by the check.\n'));
  await page.click('.marxy-head .marxy-rs-read');
  await wait(300);

  // Code lands in Read, its coloured code reading; these checks are of Source's colour, one press away.
  // The mode is read once the file's own page is up: the file before it may have been left in Source, and a press
  // made while the open is under way is dropped, so it is pressed again until this file's editor shows.
  const codeToSource = async (lang) => {
    const editor = `.cm-editor[data-marxy-lang="${lang}"]`;
    await page.waitForSelector(`pre[data-marxy-lang="${lang}"], ${editor}`, { timeout: 15000 }).catch(() => {});
    for (let i = 0; i < 10; i++) {
      const shown = await ev((sel) => [...document.querySelectorAll(sel)].some((e) => e.offsetParent !== null) && document.body.dataset.marxyMode === 'source', editor);
      if (shown) return;
      if ((await ev(() => document.body.dataset.marxyMode)) !== 'source') await page.click('.marxy-head .marxy-rs-source').catch(() => {});
      await wait(500);
    }
  };
  // What a file is comes from its head where its name says nothing or says wrong: an extension-less script opens as
  // the Python its shebang names, and a PNG called .txt is binary to the Rust side's detection.
  writeFileSync(join(dir, 'deploy'), '#!/usr/bin/env python3\ndef main():\n    return 42\n');
  copyFileSync(join(dir, 'mark.png'), join(dir, 'mark.txt'));
  const script = spawn(exe, [join(dir, 'deploy')], { env, stdio: 'ignore' });
  await new Promise((r) => script.on('exit', r));
  await codeToSource('python');
  await page.waitForSelector('.cm-editor[data-marxy-lang="python"]', { timeout: 15000 }).catch(() => {});
  const opened = await ev(() => ({
    lang: [...document.querySelectorAll('.cm-editor')].find((e) => e.offsetParent !== null)?.getAttribute('data-marxy-lang') ?? null,
    kind: document.querySelector('section.marxy-pane[data-marxy-kind]')?.getAttribute('data-marxy-kind') ?? null,
  }));
  check('an extension-less script opens as the Python code its shebang names', opened.lang === 'python' && opened.kind === 'code', `${opened.lang}, ${opened.kind}`);
  // One tokenizer for Read and Source: a Ruby file, which no mode coloured before, shows in Source with its
  // keywords coloured from Shiki's runs, read in the highlight worker, in the theme's keyword colour.
  writeFileSync(join(dir, 'greeter.rb'), 'class Greeter\n  def hi(name) # say it\n    "hi #{name}"\n  end\nend\n');
  const ruby = spawn(exe, [join(dir, 'greeter.rb')], { env, stdio: 'ignore' });
  await new Promise((r) => ruby.on('exit', r));
  await codeToSource('ruby');
  await page.waitForSelector('.cm-editor[data-marxy-lang="ruby"] .cm-content .marxy-tok-keyword', { timeout: 15000 }).catch(() => {});
  const rubyKeyword = await ev(() => {
    const editor = [...document.querySelectorAll('.cm-editor[data-marxy-lang="ruby"]')].find((e) => e.offsetParent !== null);
    const word = [...(editor?.querySelectorAll('.cm-content .marxy-tok-keyword') ?? [])].find((s) => s.textContent === 'def');
    const probe = document.createElement('span');
    probe.style.color = 'var(--marxy-tok-keyword)';
    word?.parentElement?.append(probe);
    const want = getComputedStyle(probe).color;
    probe.remove();
    return { word: word?.textContent ?? null, colour: word ? getComputedStyle(word).color : null, want };
  });
  check('a Ruby file shows in Source with its keyword coloured from Shiki\'s runs', rubyKeyword.word === 'def' && rubyKeyword.colour === rubyKeyword.want, JSON.stringify(rubyKeyword));
  if (process.env.MARXY_CHECK_SHOTS) await page.screenshot({ path: join(process.env.MARXY_CHECK_SHOTS, 'tauri-ruby-source.png') });

  // Colour by language: a Rust keyword set in Look › By language is one line in config.toml, in force at once in
  // Source, and in Read when a Markdown file's Rust fence opens after it.
  writeFileSync(join(dir, 'tide.rs'), 'fn main() -> u32 {\n    return 42;\n}\n');
  writeFileSync(join(dir, 'tide.md'), '# Tide\n\nWords.\n\n```rust\nfn main() -> u32 {\n    return 42;\n}\n```\n');
  const tideRs = spawn(exe, [join(dir, 'tide.rs')], { env, stdio: 'ignore' });
  await new Promise((r) => tideRs.on('exit', r));
  await codeToSource('rust');
  await page.waitForSelector('.cm-editor[data-marxy-lang="rust"] .cm-content .marxy-tok-keyword', { timeout: 15000 }).catch(() => {});
  const rustReturn = (root) =>
    ev((root) => {
      const scope = [...document.querySelectorAll(root)].find((e) => e.offsetParent !== null);
      const word = [...(scope?.querySelectorAll('span') ?? [])].find((s) => s.textContent === 'return' && s.children.length === 0);
      return word ? getComputedStyle(word).color : null;
    }, root);
  const shippedRust = await rustReturn('.cm-editor[data-marxy-lang="rust"]');
  // The rail's Look is the Studio; a language's own colours are its Code tab's (lang-palettes.test.mjs).
  await page.click('.marxy-rail .marxy-l-rb[aria-label="Look"]');
  await page.waitForSelector('dialog.marxy-studio[open]', { timeout: 8000 }).catch(() => {});
  await page.locator('.marxy-studio-tab', { hasText: 'Code' }).click().catch(() => {});
  await page.waitForSelector('.marxy-studio [data-marxy-lang-row="rust"]', { timeout: 8000 }).catch(() => {});
  await page.click('.marxy-studio [data-marxy-lang-row="rust"]').catch(() => {});
  await page.waitForSelector('[data-marxy-lang-role="rust:keyword"] input', { timeout: 8000 }).catch(() => {});
  await page.$eval('[data-marxy-lang-role="rust:keyword"] input', (i) => {
    i.value = '#d01f6a';
    i.dispatchEvent(new Event('input', { bubbles: true }));
    i.dispatchEvent(new Event('change', { bubbles: true }));
  }).catch(() => {});
  await page.waitForFunction(() => {
    const scope = [...document.querySelectorAll('.cm-editor[data-marxy-lang="rust"]')].find((e) => e.offsetParent !== null);
    const word = [...(scope?.querySelectorAll('span') ?? [])].find((s) => s.textContent === 'return' && s.children.length === 0);
    return word && getComputedStyle(word).color === 'rgb(208, 31, 106)';
  }, null, { timeout: 8000 }).catch(() => {});
  const lookSource = await rustReturn('.cm-editor[data-marxy-lang="rust"]');
  const configs = readdirSync(dataDir, { recursive: true }).filter((f) => basename(String(f)) === 'config.toml').map((f) => readFileSync(join(dataDir, String(f)), 'utf8'));
  const lines = configs.join('\n').split(/\r?\n/).filter((l) => l.includes('#d01f6a'));
  check('the Studio\'s Code tab: a Rust keyword is one line in config.toml and in force at once in Source', lookSource === 'rgb(208, 31, 106)' && shippedRust !== lookSource && lines.length === 1 && lines[0] === 'keyword = "#d01f6a"' && configs.join('').includes('[syntax.rust]'), `${shippedRust} -> ${lookSource}; ${JSON.stringify(lines)}`);
  await page.keyboard.press('Escape');
  await page.waitForSelector('dialog.marxy-studio', { state: 'detached', timeout: 5000 }).catch(() => {});
  check('the Studio closes on Esc', !(await ev(() => !!document.querySelector('dialog.marxy-studio'))));
  const tideMd = spawn(exe, [join(dir, 'tide.md')], { env, stdio: 'ignore' });
  await new Promise((r) => tideMd.on('exit', r));
  await page.waitForSelector('pre[data-marxy-lang="rust"] .marxy-tok-keyword', { timeout: 15000 }).catch(() => {});
  const lookRead = await rustReturn('pre[data-marxy-lang="rust"]');
  check('the Rust keyword set in the Studio is the same colour in Read', lookRead === 'rgb(208, 31, 106)', String(lookRead));
  // The tiers: a 5 MB JavaScript file opens as plain text and the head says so; colour anyway, from the
  // Reading card, colours what is in view, and the time from the choice to the first coloured token is recorded.
  const bundleLine = 'export function f(a) { return "s" + a * 2; } // a comment\n';
  writeFileSync(join(dir, 'bundle.js'), bundleLine.repeat(Math.ceil(5_000_000 / bundleLine.length)));
  const bundle = spawn(exe, [join(dir, 'bundle.js')], { env, stdio: 'ignore' });
  await new Promise((r) => bundle.on('exit', r));
  await codeToSource('javascript');
  await page.waitForFunction(() => [...document.querySelectorAll('.marxy-head .marxy-guess')].some((g) => !g.hidden && g.textContent === 'Plain text · no colour past 2 MB'), undefined, { timeout: 20000 }).catch(() => {});
  const tierHead = await ev(() => [...document.querySelectorAll('.marxy-head .marxy-guess')].find((g) => !g.hidden)?.textContent ?? null);
  check('a 5 MB JavaScript file opens as plain text, and its head says so', tierHead === 'Plain text · no colour past 2 MB', String(tierHead));
  await showLeft('metadata');
  const anyway = await ev(async () => {
    [...document.querySelectorAll('.marxy-head .marxy-guess')].find((g) => !g.hidden)?.click();
    const wait = async (fn, ms) => {
      const end = performance.now() + ms;
      while (performance.now() < end) {
        const v = fn();
        if (v) return v;
        await new Promise((r) => requestAnimationFrame(r));
      }
      return null;
    };
    const button = await wait(() => [...document.querySelectorAll('.marxy-drawer .marxy-tier button')].find((b) => b.textContent.startsWith('Colour it anyway')), 5000);
    if (!button) return { error: 'no Colour it anyway in the Reading card' };
    const t0 = performance.now();
    button.click();
    const inView = () => [...document.querySelectorAll('.cm-editor[data-marxy-lang="javascript"] .cm-content [class*="marxy-tok-"]')].some((s) => { const r = s.getBoundingClientRect(); return r.width > 0 && r.top < innerHeight && r.bottom > 0; });
    const coloured = await wait(inView, 10000);
    return { ms: coloured ? Math.round(performance.now() - t0) : null, head: [...document.querySelectorAll('.marxy-head .marxy-guess')].find((g) => !g.hidden)?.textContent ?? null };
  });
  check('colour anyway colours what is in view, and the head says it is the reader\'s choice', anyway.ms !== null && anyway.head === 'Coloured as you scroll · your choice', JSON.stringify(anyway));
  const misnamed = await ev((path) => window.__TAURI_INTERNALS__.invoke('detect_files', { paths: [path] }), join(dir, 'mark.txt'));
  check('a PNG named .txt is binary by its magic', misnamed?.[0]?.class === 'binary' && misnamed[0].format === 'png', JSON.stringify(misnamed));

  // Pages of the app's own: a PNG opens as the image page, drawn through marxy-file://; a file with no
  // reading as the card with its bytes beside it, read a window at a time, so a 2 GB file's last byte is one press away.
  const viewOpen = async (file, selector) => {
    const run = spawn(exe, [file], { env, stdio: 'ignore' });
    await new Promise((r) => run.on('exit', r));
    await page.waitForFunction((name) => document.title.startsWith(name), basename(file), { timeout: 15000 }).catch(() => {});
    await page.waitForSelector(selector, { timeout: 15000 }).catch(() => {});
  };
  await viewOpen(join(dir, 'mark.png'), '.marxy-viewer-mount:not([hidden]) .marxy-imgpage');
  await page.waitForFunction(() => (document.querySelector('.marxy-imgpic')?.naturalWidth ?? 0) > 0, null, { timeout: 15000 }).catch(() => {});
  const shownPng = await ev(() => ({
    width: document.querySelector('.marxy-imgpic')?.naturalWidth ?? 0,
    src: document.querySelector('.marxy-imgpic')?.getAttribute('src') ?? '',
    zoom: document.querySelector('.marxy-imgbar-zoom')?.textContent ?? '',
    box: document.querySelector('.marxy-imgbox')?.getBoundingClientRect().width ?? 0,
  }));
  shownPng.cards = await allCardTitles();
  check('a PNG opens as the image page, drawn through marxy-file://, to fit and never enlarged',
    shownPng.width === 128 && shownPng.src.startsWith('http://marxy-file.localhost/') && shownPng.zoom === '100 %' && Math.round(shownPng.box) === 128,
    JSON.stringify(shownPng));
  if (shownPng.cards.length > 0) check('the image page\'s fourth card is Image', shownPng.cards.includes('Image'), shownPng.cards.join(', '));
  // A HEIC: drawn through the system's own decoder where Windows has the HEIF and HEVC extensions, the card naming them
  // where it has not. The sample is 64 x 32, red on the left, written by Windows' own encoder.
  copyFileSync(join(desktop, 'src-tauri', 'src', 'decode', 'probe.heic'), join(dir, 'halves.heic'));
  const heicFacts = await ev((path) => window.__TAURI_INTERNALS__.invoke('image_facts', { path }).catch((e) => ({ error: e?.code ?? String(e) })), join(dir, 'halves.heic'));
  if (heicFacts?.show === 'decoded') {
    await viewOpen(join(dir, 'halves.heic'), '.marxy-viewer-mount:not([hidden]) .marxy-imgpage');
    await page.waitForFunction(() => (document.querySelector('.marxy-viewer-mount:not([hidden]) .marxy-imgpic')?.naturalWidth ?? 0) > 0, null, { timeout: 20000 }).catch(() => {});
    const heic = await ev(() => {
      const img = document.querySelector('.marxy-viewer-mount:not([hidden]) .marxy-imgpic');
      if (!img?.naturalWidth) return { width: 0, src: img?.getAttribute('src') ?? '' };
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0);
      return { width: img.naturalWidth, height: img.naturalHeight, left: [...g.getImageData(2, 16, 1, 1).data.slice(0, 3)], src: img.getAttribute('src') ?? '' };
    });
    check('a HEIC is drawn at its true size through the system decoder (?decoded)', heic.width === 64 && heic.height === 32 && heic.left[0] > 200 && heic.left[2] < 60 && heic.src.includes('decoded'), JSON.stringify(heic));
  } else {
    await viewOpen(join(dir, 'halves.heic'), '.marxy-viewer-mount:not([hidden]) .marxy-fcard');
    const card = await ev(() => document.querySelector('.marxy-viewer-mount:not([hidden]) .marxy-fcard')?.innerText ?? '');
    check('a HEIC on a Windows without the codec is the card naming both Store extensions', heicFacts?.show === 'none' && card.includes('HEIF Image Extension') && card.includes('HEVC Video Extension'), JSON.stringify({ show: heicFacts?.show, card: card.slice(0, 160) }));
  }
  // A Photoshop file's own preview, read by hand in Rust (decode/psd.rs): its flattened image, 8 x 4, red on the left;
  // and an SVGZ unpacked to its SVG, drawn through <img> so its script never runs.
  const pictures = join(desktop, '..', '..', 'fixtures', 'pictures');
  copyFileSync(join(pictures, 'preview.psd'), join(dir, 'layers.psd'));
  copyFileSync(join(pictures, 'tiny.svgz'), join(dir, 'drawing.svgz'));
  const drawn = async (file) => {
    await viewOpen(join(dir, file), '.marxy-viewer-mount:not([hidden]) .marxy-imgpage');
    await page.waitForFunction(() => (document.querySelector('.marxy-viewer-mount:not([hidden]) .marxy-imgpic')?.naturalWidth ?? 0) > 0, null, { timeout: 15000 }).catch(() => {});
    return ev(() => {
      const img = document.querySelector('.marxy-viewer-mount:not([hidden]) .marxy-imgpic');
      if (!img?.naturalWidth) return { width: 0, src: img?.getAttribute('src') ?? '' };
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0);
      return { width: img.naturalWidth, height: img.naturalHeight, left: [...g.getImageData(1, 1, 1, 1).data.slice(0, 3)], src: img.getAttribute('src') ?? '', title: document.title };
    });
  };
  const psdShown = await drawn('layers.psd');
  if (process.env.MARXY_CHECK_SHOTS) await page.screenshot({ path: join(process.env.MARXY_CHECK_SHOTS, 'tauri-psd.png') });
  check('a PSD draws its own flattened image through ?decoded, read by hand in Rust', psdShown.width === 8 && psdShown.height === 4 && psdShown.left[0] > 200 && psdShown.left[2] < 60 && psdShown.src.includes('decoded'), JSON.stringify(psdShown));
  const svgzShown = await drawn('drawing.svgz');
  check('an SVGZ draws as the SVG it unpacks to, its script never run', svgzShown.width === 120 && svgzShown.height === 80 && svgzShown.left[0] > 200 && !svgzShown.title?.startsWith('ran'), JSON.stringify(svgzShown));
  // A video is the media page now; its Source is the same hex view, read a window at a time.
  await viewOpen(video, '.marxy-viewer-mount:not([hidden]) .marxy-mediapage');
  const lastByte = (() => {
    const b = Buffer.alloc(1);
    const fd = openSync(video, 'r');
    try {
      readSync(fd, b, 0, 1, videoSize - 1);
    } finally {
      closeSync(fd);
    }
    return b[0].toString(16).toUpperCase().padStart(2, '0');
  })();
  await showLeft('metadata');
  const mediaSays = await ev(() => ({ line: document.querySelector('.marxy-media-line')?.textContent ?? '', facts: document.querySelector('[data-marxy-card="facts"]')?.innerText ?? '' }));
  check(`a ${(videoSize / 2 ** 30).toFixed(2)} GB video opens as the media page, its facts read from its header`,
    mediaSays.line.startsWith('MP4 · VP9') && mediaSays.facts.includes(`${videoSize.toLocaleString('en-GB')} bytes`), JSON.stringify({ ...mediaSays, facts: mediaSays.facts.slice(0, 80) }));
  const hexSteps = [];
  await page.click('.marxy-rs-source', { timeout: 8000 }).catch((e) => hexSteps.push(`Source: ${String(e).split('\n')[0]}`));
  await page.waitForSelector('.marxy-viewer-mount:not([hidden]) .marxy-hexpage', { timeout: 15000 }).catch(() => {});
  await page.click('.marxy-viewer-mount:not([hidden]) .marxy-hexbar-end', { timeout: 8000 }).catch((e) => hexSteps.push(`end: ${String(e).replace(/\s*\n\s*/g, ' | ').slice(0, 900)}`));
  // Sixteen bytes a row, or eight in a narrow pane.
  const lastRows = [16, 8].map((per) => (Math.floor((videoSize - 1) / per) * per).toString(16).toUpperCase().padStart(8, '0'));
  await page.waitForFunction((v) => document.querySelector('.marxy-viewer-mount:not([hidden]) .marxy-hexrow i[data-marxy-on]')?.textContent === v, lastByte, { timeout: 15000 }).catch(() => {});
  const atEnd = await ev(() => ({
    rows: [...document.querySelectorAll('.marxy-viewer-mount:not([hidden]) .marxy-hexrow .marxy-hex-o')].map((e) => e.textContent),
    on: document.querySelector('.marxy-viewer-mount:not([hidden]) .marxy-hexrow i[data-marxy-on]')?.textContent ?? null,
  }));
  check('the hex view scrolls to the 2 GB file\'s last byte at once, and reads it from disk',
    atEnd.rows.at(-1) !== undefined && lastRows.includes(atEnd.rows.at(-1)) && atEnd.on === lastByte, `${atEnd.rows.at(-1)} (want ${lastRows.join(' or ')}), byte ${atEnd.on} (want ${lastByte})${hexSteps.length ? `; ${hexSteps.join('; ')}` : ''}`);
  await page.click('.marxy-rs-read').catch(() => {});

  // A page of the app's own is watched: written on disk, the card and the bytes are what is there now, at the byte picked.
  const watched = join(dir, 'watched.bin');
  const watchedBytes = Buffer.alloc(4096);
  watchedBytes.write('WTCH', 0);
  writeFileSync(watched, watchedBytes);
  await viewOpen(watched, '.marxy-viewer-mount:not([hidden]) .marxy-fcard');
  check('the card says when the file was made, as Windows keeps it', /created\s+\d{1,2} \w{3} \d{4}, \d\d:\d\d/.test(await ev(() => document.querySelector('.marxy-fcard')?.innerText ?? '')));
  await page.fill('.marxy-viewer-mount:not([hidden]) .marxy-hexbar-input', '0x40').catch(() => {});
  await page.press('.marxy-viewer-mount:not([hidden]) .marxy-hexbar-input', 'Enter').catch(() => {});
  await page.waitForFunction(() => document.querySelector('.marxy-viewer-mount:not([hidden]) .marxy-hex-b [data-marxy-byte="64"]')?.hasAttribute('data-marxy-on'), null, { timeout: 5000 }).catch(() => {});
  const rewritten = Buffer.concat([watchedBytes, Buffer.alloc(4096, 0x41)]);
  rewritten[64] = 0x7a;
  writeFileSync(watched, rewritten);
  await page.waitForFunction(() => document.querySelector('.marxy-viewer-mount:not([hidden]) .marxy-hex-b [data-marxy-byte="64"]')?.textContent === '7A', null, { timeout: 15000 }).catch(() => {});
  const afterWrite = await ev(() => ({
    byte: document.querySelector('.marxy-viewer-mount:not([hidden]) .marxy-hex-b [data-marxy-byte="64"]')?.textContent ?? null,
    on: document.querySelector('.marxy-viewer-mount:not([hidden]) .marxy-hex-b [data-marxy-byte="64"]')?.hasAttribute('data-marxy-on') ?? false,
    size: /8,192 bytes/.test(document.querySelector('.marxy-fcard')?.innerText ?? ''),
  }));
  check('a binary file written on disk is shown as it is now, the byte picked kept', afterWrite.byte === '7A' && afterWrite.on && afterWrite.size, JSON.stringify(afterWrite));

  // A notebook reads as its cells under the app's CSP: its figure drawn from the data URL it carries, its HTML
  // output cleaned, and nothing in it run (a script, an onerror, a JavaScript output would each set the flag).
  copyFileSync(join(demo, 'notebooks', 'tide-heights.ipynb'), join(dir, 'tide-heights.ipynb'));
  await viewOpen(join(dir, 'tide-heights.ipynb'), '.marxy-notebook');
  await page.waitForFunction(() => (document.querySelector('.marxy-nb-img')?.naturalWidth ?? 0) > 0, null, { timeout: 15000 }).catch(() => {});
  await wait(500);
  const notebook = await ev(() => ({
    figure: document.querySelector('.marxy-nb-img')?.naturalWidth ?? 0,
    data: document.querySelector('.marxy-nb-img')?.getAttribute('src')?.startsWith('data:image/png;base64,') ?? false,
    scripts: document.querySelectorAll('.marxy-article script, .marxy-article [onerror], .marxy-article img[src^="http"]').length,
    said: document.querySelector('[data-marxy-cell="6"] .marxy-nb-note')?.textContent ?? '',
    ran: window.__nbRan ?? null,
    ground: document.body.style.background,
  }));
  notebook.cards = await allCardTitles();
  check('a notebook reads as its cells: the figure drawn, no script in the page, nothing run',
    notebook.figure === 600 && notebook.data && notebook.scripts === 0 && notebook.ran === null && notebook.ground === '' && /1 script, 1 event handler, 1 image from the network/.test(notebook.said),
    JSON.stringify({ ...notebook, cards: undefined }));
  if (notebook.cards.length > 0) check('a notebook\'s fourth card is Cells and its metadata slot Notebook', notebook.cards.includes('Cells') && notebook.cards.includes('Notebook'), notebook.cards.join(', '));

  // An archive is a tree of its entries, listed by the Rust side and never extracted: an entry opens into memory in
  // a tab of its own, and a name that climbs out of the archive (`../../escaped.txt`) is never a path on disk.
  writeFileSync(join(dir, 'bundle.zip'), zipOf([['notes/readme.md', '# Packed\n\nRead from memory.\n'], ['../../escaped.txt', 'climbed out\n']]));
  await viewOpen(join(dir, 'bundle.zip'), '.marxy-viewer-mount:not([hidden]) .marxy-atree');
  // The archive's page: its lede says what it is, and a name that climbs out says so in its row.
  const listed = await ev(() => ({
    lede: document.querySelector('.marxy-arch-lede')?.textContent ?? '',
    rows: [...document.querySelectorAll('.marxy-arow .marxy-arch-name')].map((e) => e.textContent),
    note: [...document.querySelectorAll('.marxy-arow')].find((r) => r.querySelector('.marxy-arch-name')?.textContent === 'escaped.txt')?.querySelector('.marxy-arch-reads')?.textContent ?? '',
  }));
  check('a zip lists as the page of its entries, through list_archive', listed.lede.startsWith('A ZIP archive: 2 files in 1 folder') && listed.rows.join() === 'notes/,readme.md,escaped.txt' && listed.note === 'climbs out', JSON.stringify(listed));
  // An entry opens by `o` or a double click (frame-archives.test.mjs).
  await page.dblclick('.marxy-arow:has(.marxy-arch-name:text-is("readme.md"))');
  await page.waitForFunction(() => document.querySelector('.marxy-article h1')?.textContent === 'Packed', null, { timeout: 15000 }).catch(() => {});
  await page.waitForFunction(() => [...document.querySelectorAll('.marxy-notice-text')].some((e) => e.textContent.startsWith('An entry of bundle.zip')), null, { timeout: 10000 }).catch(() => {});
  const entryOpen = await ev(() => ({
    h1: document.querySelector('.marxy-article h1')?.textContent ?? '',
    tabs: [...document.querySelectorAll('.marxy-tabbar .marxy-tab .marxy-tab-name')].map((t) => t.textContent),
    said: [...document.querySelectorAll('.marxy-notice-text')].some((e) => e.textContent.startsWith('An entry of bundle.zip')),
  }));
  check('an entry opens into memory in a tab of its own, read as its name says, with its line', entryOpen.h1 === 'Packed' && entryOpen.tabs.includes('readme.md') && entryOpen.said, JSON.stringify(entryOpen));
  const escaped = await ev((path) => window.__TAURI_INTERNALS__.invoke('read_archive_entry', { path, index: 1, name: 'escaped.txt' }).then((b) => new TextDecoder().decode(new Uint8Array(b)), (e) => `refused ${e?.code ?? e}`), join(dir, 'bundle.zip'));
  const climbed = [join(dir, 'escaped.txt'), join(dirname(dir), 'escaped.txt'), join(dirname(dirname(dir)), 'escaped.txt')].filter((p) => existsSync(p));
  check('a `..` entry reads into memory and is never a path on disk', escaped === 'climbed out\n' && climbed.length === 0, `${JSON.stringify(escaped)}; on disk: ${climbed.join(', ') || 'none'}`);
  copyFileSync(join(dir, 'bundle.zip'), join(outside, 'bundle.zip'));
  const outsideList = await ev((path) => window.__TAURI_INTERNALS__.invoke('list_archive', { path }).then(() => 'listed', (e) => e?.code ?? String(e)), join(outside, 'bundle.zip'));
  check('list_archive refuses an archive outside what the reader opened', outsideList === 'permission', outsideList);
  // An image held in memory (an archive's entry, a message's attachment, a database's BLOB) is drawn from a blob: URL.
  const blobImage = await ev(() => new Promise((resolve) => {
    const c = document.createElement('canvas');
    c.width = 3;
    c.height = 2;
    c.getContext('2d').fillRect(0, 0, 3, 2);
    c.toBlob((b) => {
      const url = URL.createObjectURL(b);
      const img = new Image();
      img.onload = () => resolve(img.naturalWidth);
      img.onerror = () => resolve('refused');
      img.src = url;
    }, 'image/png');
  }));
  check('an image held in memory draws from its blob: URL under the CSP', blobImage === 3, String(blobImage));

  // The archive page through the real shell: the survey opens as its lede and its plan to scale; the preview reads
  // the README from its first bytes (read_archive_heads) and a picture whole (read_archive_entry), into memory only.
  copyFileSync(join(demo, 'archives', 'harbour-survey-2026.zip'), join(dir, 'harbour-survey-2026.zip'));
  await viewOpen(join(dir, 'harbour-survey-2026.zip'), '.marxy-viewer-mount:not([hidden]) .marxy-arch-plan .marxy-arch-cell');
  await page.waitForFunction(() => document.querySelector('.marxy-viewer-mount:not([hidden]) .marxy-arch-pbody h1')?.textContent === 'Harbour survey, autumn 2026', null, { timeout: 15000 }).catch(() => {});
  const survey = await ev(() => {
    const at = (s) => document.querySelector(`.marxy-viewer-mount:not([hidden]) ${s}`);
    return {
      lede: at('.marxy-arch-lede')?.textContent ?? '',
      cells: document.querySelectorAll('.marxy-viewer-mount:not([hidden]) .marxy-arch-cell').length,
      h1: at('.marxy-arch-pbody h1')?.textContent ?? '',
      facts: at('.marxy-arch-pfacts')?.textContent ?? '',
    };
  });
  check('an archive opens as its page: the lede and the plan to scale', /^A ZIP archive: 25 files in 9 folders, all inside harbour-survey-2026\//.test(survey.lede) && survey.cells > 10, JSON.stringify({ ...survey, lede: survey.lede.slice(0, 80) }));
  check('the preview reads the README by its first bytes through read_archive_heads, its checksum checked', survey.h1 === 'Harbour survey, autumn 2026' && / · checksum agrees$/.test(survey.facts), JSON.stringify(survey.facts));
  // A click on a picture's cell in the plan puts the cursor there (by the mouse, where the place matters); the preview
  // follows once the cursor rests, the picture unpacked whole into memory and drawn from a blob: URL.
  // The plan is drawn again as readings and pictures arrive: click once the picture's own cell has its picture, and once
  // more if the cursor did not land.
  const PIC = '.marxy-viewer-mount:not([hidden]) .marxy-arch-cell[title^="pictures/boat-ribs.jpg, "]';
  await page.waitForSelector(`${PIC} .marxy-arch-pic`, { timeout: 15000 }).catch(() => {});
  for (let attempt = 0; attempt < 2; attempt++) {
    const picCell = await page.locator(PIC).boundingBox().catch(() => null);
    if (picCell) await page.mouse.click(picCell.x + picCell.width / 2, picCell.y + picCell.height / 2);
    const landed = await page
      .waitForFunction(() => document.querySelector('.marxy-viewer-mount:not([hidden]) .marxy-arch-pname')?.textContent === 'boat-ribs.jpg', null, { timeout: 5000 })
      .then(() => true)
      .catch(() => false);
    if (landed) break;
  }
  await page.waitForFunction(() => (document.querySelector('.marxy-viewer-mount:not([hidden]) .marxy-arch-pbody img.marxy-imgpic')?.naturalWidth ?? 0) > 0, null, { timeout: 15000 }).catch(() => {});
  const pic = await ev(() => {
    const img = document.querySelector('.marxy-viewer-mount:not([hidden]) .marxy-arch-pbody img.marxy-imgpic');
    return {
      name: document.querySelector('.marxy-viewer-mount:not([hidden]) .marxy-arch-pname')?.textContent ?? '',
      width: img?.naturalWidth ?? 0,
      blob: img?.getAttribute('src')?.startsWith('blob:') ?? false,
      facts: document.querySelector('.marxy-viewer-mount:not([hidden]) .marxy-arch-pfacts')?.textContent ?? '',
    };
  });
  check('walking to a picture previews it, read whole through read_archive_entry and drawn from memory', pic.name === 'boat-ribs.jpg' && pic.width > 0 && pic.blob && /checksum agrees/.test(pic.facts), JSON.stringify(pic));
  const unpacked = readdirSync(dir).filter((n) => /^(README\.md|boat-ribs\.jpg|harbour-survey-2026|pictures)$/i.test(n));
  check('previewing the archive writes nothing beside it', unpacked.length === 0, unpacked.join(', ') || 'nothing');
  // The archive page's steps from here on each start from the survey's own page, as a list, with nothing laid
  // over it, and press a key only while that page is the focused, current view: a key that landed in another document
  // would change it. A step that cannot start fails and touches nothing. The tabs they open are closed at the end.
  const AP = '.marxy-viewer-mount:not([hidden]) .marxy-archpage:not(.marxy-archpage-compact)';
  const onArchive = (name) =>
    ev(([name, ap]) => document.title.startsWith(name) && !document.querySelector('dialog[open], .marxy-verb-menu, .marxy-export-scrim') && document.querySelector(ap) !== null, [name, AP]);
  /** `key` pressed in the archive page `name`, the pane focused first; false (and nothing pressed) when it is not the view. */
  const keyIn = async (name, key) => {
    await blurPage();
    if (!(await onArchive(name))) return false;
    await page.keyboard.press(key);
    return true;
  };
  /** The middle of `selector` clicked by the mouse, once the element there is that one: nothing is scrolled first. */
  const clickOn = async (selector) => {
    const target = page.locator(selector).first();
    const box = await target.boundingBox().catch(() => null);
    if (!box) return false;
    const x = box.x + Math.min(40, box.width / 2);
    const y = box.y + box.height / 2;
    // The element is resolved by Playwright (the selector may use :text-is, which the page's querySelectorAll refuses).
    const hit = await target
      .evaluate((e, [x, y]) => {
        const at = document.elementFromPoint(x, y);
        return !!at && (e === at || e.contains(at));
      }, [x, y])
      .catch(() => false);
    if (!hit) return false;
    await page.mouse.click(x, y);
    return true;
  };
  /**
   * `selector` clicked until `done(arg)` holds in the page, three times at most: a first click can find the pane not yet
   * focused, or the element drawn again between the press and the release.
   */
  const clickUntil = async (selector, done, arg) => {
    for (let i = 0; i < 3; i++) {
      if (await clickOn(selector)) {
        if (await page.waitForFunction(done, arg, { timeout: 3000 }).then(() => true, () => false)) return true;
      }
      await wait(400);
    }
    return false;
  };
  const picked = (name) =>
    ev(([ap, n]) => [...document.querySelectorAll(`${ap} > .marxy-arch-body > .marxy-arch-entries > .marxy-atree .marxy-arow[aria-selected="true"] .marxy-arch-name`)].some((e) => e.textContent === n), [AP, name]);
  /**
   * The survey's entry `name` put under the cursor through the Line's `@`, as a reader types it: a click on a row lands
   * where WebView2 puts the mouse, which in this window is not always where the row is measured. Enter only on its own row.
   */
  let lineSaid = [];
  const pickRow = async (name) => {
    for (let i = 0; i < 2 && !(await picked(name)); i++) {
      await blurPage();
      if (!(await onArchive(SURVEY))) {
        lineSaid = [`not on the survey: ${await ev(() => `${document.title} | ${document.querySelectorAll(".marxy-archpage").length} pages | ${!!document.querySelector("dialog[open], .marxy-verb-menu, .marxy-export-scrim")}`)}`];
        return false;
      }
      await page.keyboard.press('Control+k');
      await page.waitForSelector('#marxy-palette[open]', { timeout: 5000 }).catch(() => {});
      await page.keyboard.type(`@${name}`);
      const want = `entry ${name}`;
      const rowIs = (w) => (document.querySelector('#marxy-palette .marxy-palette-row[aria-selected="true"]')?.textContent ?? '').trim().startsWith(w);
      await page.waitForFunction((w) => [...document.querySelectorAll('#marxy-palette .marxy-palette-row')].some((r) => r.textContent.trim().startsWith(w)), want, { timeout: 8000 }).catch(() => {});
      // Down the rows to the entry's own: another part may hold the name too (its folder's address).
      for (let k = 0; k < 12 && !(await ev(rowIs, want)); k++) await page.keyboard.press('ArrowDown');
      const ours = await ev(rowIs, want);
      lineSaid = [`ours ${ours}`];
      if (!ours) lineSaid = await ev(() => [...document.querySelectorAll('#marxy-palette .marxy-palette-row')].slice(0, 6).map((r) => r.textContent.trim().slice(0, 60)));
      await page.keyboard.press(ours ? 'Enter' : 'Escape');
      await page.waitForFunction(() => document.querySelector('#marxy-palette')?.open !== true, null, { timeout: 5000 }).catch(() => {});
      await page.waitForFunction(([ap, n]) => [...document.querySelectorAll(`${ap} > .marxy-arch-body > .marxy-arch-entries > .marxy-atree .marxy-arow[aria-selected="true"] .marxy-arch-name`)].some((e) => e.textContent === n), [AP, name], { timeout: 5000 }).catch(() => {});
    }
    return picked(name);
  };
  // A tab is found by its aria-label, the file's whole name: a long name is drawn in two halves with an ellipsis between.
  const tabNames = () => ev(() => [...document.querySelectorAll('.marxy-tabbar .marxy-tab')].map((t) => t.getAttribute('aria-label')));
  const tabOf = (name) => page.locator(`.marxy-tabbar .marxy-tab[aria-label="${name}"]`).first();
  const toTab = async (name) => {
    await tabOf(name).locator('.marxy-tab-open').click({ timeout: 5000 }).catch(() => {});
    await page.waitForFunction((n) => document.title.startsWith(n), name, { timeout: 10000 }).catch(() => {});
  };
  const closeTab = async (name) => {
    const tab = tabOf(name);
    if ((await tab.count()) === 0) return;
    // The close button shows on hover: the tab is hovered first, and the click does not wait for it to be seen.
    await tab.hover({ timeout: 5000 }).catch(() => {});
    await tab.locator('.marxy-tab-close').click({ timeout: 5000, force: true }).catch(() => {});
    await page.waitForFunction((n) => !document.querySelector(`.marxy-tabbar .marxy-tab[aria-label="${n}"]`), name, { timeout: 5000 }).catch(() => {});
  };
  const SURVEY = 'harbour-survey-2026.zip';
  const tabsAtSurvey = await tabNames();
  /** Back to the survey's page as a list, with Reveal, an x-ray and the Line gone. */
  const surveyAsList = async () => {
    if (await ev(() => document.querySelector('#marxy-palette')?.open === true)) await page.keyboard.press('Escape');
    if (!(await ev((n) => document.title.startsWith(n), SURVEY))) {
      // An entry opened with o may have taken the survey's tab (a glance is replaced by the next open): it is opened again.
      if ((await tabOf(SURVEY).count()) > 0) await toTab(SURVEY);
      else await viewOpen(join(dir, SURVEY), `${AP} .marxy-arch-plan .marxy-arch-cell`);
    }
    if (await ev((ap) => document.querySelector(`${ap} .marxy-xray`) !== null, AP)) await keyIn(SURVEY, 'x');
    if (await ev((ap) => document.querySelector(`${ap} .marxy-arch-seg`) !== null, AP)) await keyIn(SURVEY, 'Shift+X');
    await page.waitForFunction((ap) => !document.querySelector(`${ap} .marxy-arch-seg, ${ap} .marxy-xray`), AP, { timeout: 5000 }).catch(() => {});
    if (await ev((ap) => document.querySelector(`${ap} > .marxy-arch-body > .marxy-arch-entries > .marxy-arch-sheet`) !== null, AP)) {
      await clickUntil(`${AP} > .marxy-arch-under .marxy-arch-opt:text-is("a list")`, (ap) => document.querySelector(`${ap} > .marxy-arch-body > .marxy-arch-entries > .marxy-atree`) !== null, AP);
    }
    return ev(([ap, n]) => document.title.startsWith(n) && document.querySelector(`${ap} > .marxy-arch-body > .marxy-arch-entries > .marxy-atree .marxy-arow`) !== null, [AP, SURVEY]);
  };

  // Reveal and x-ray through the real shell's read_range: the strip covers every byte of the file once, and x on the
  // cursor's entry (the picture clicked above) shows its local header as stored.
  const surveySize = statSync(join(dir, SURVEY)).size;
  await keyIn(SURVEY, 'Shift+X');
  await page.waitForSelector(`${AP} .marxy-arch-seg[data-marxy-seg="end"]`, { timeout: 10000 }).catch(() => {});
  const strip = await ev((ap) => [...document.querySelectorAll(`${ap} .marxy-arch-seg`)].map((s) => [Number(s.getAttribute('data-marxy-strip-from')), Number(s.getAttribute('data-marxy-strip-to'))]), AP);
  const contiguous = strip.length > 0 && strip.every(([from], i) => from === (i === 0 ? 0 : strip[i - 1][1]));
  check('Reveal draws the file as stored, every byte once, read through read_range', contiguous && strip.at(-1)?.[1] === surveySize, JSON.stringify({ segments: strip.length, last: strip.at(-1), size: surveySize }));
  await keyIn(SURVEY, 'x');
  await page.waitForSelector(`${AP} .marxy-xray`, { timeout: 10000 }).catch(() => {});
  const xrayRow = await ev((ap) => document.querySelector(`${ap} .marxy-xray .marxy-xray-text`)?.textContent ?? '', AP);
  check('x on an entry shows its local header as stored', /^50 4B 03 04 /.test(xrayRow), xrayRow.slice(0, 60));

  // The sheet: "a sheet" under the plan draws every entry as its own page, small, filled as it comes into view, a
  // picture's tile read whole through read_archive_entry and the README's from its first bytes; back to a list after.
  let sheet = { tiles: 0, filled: 0, readme: '', list: true, start: 'the survey was not shown as a list' };
  if (await surveyAsList()) {
    // The sheet is read in the entries region: a folder's preview is drawn as tiles too, in the preview's body.
    const SHEET = `${AP} > .marxy-arch-body > .marxy-arch-entries > .marxy-arch-sheet`;
    const clicked = await clickUntil(`${AP} > .marxy-arch-under .marxy-arch-opt:text-is("a sheet")`, (s) => document.querySelector(s) !== null, SHEET);
    await page.waitForFunction((s) => document.querySelectorAll(`${s} .marxy-arch-tile .marxy-embed`).length > 2, SHEET, { timeout: 15000 }).catch(() => {});
    const atTop = await ev((s) => {
      const tiles = [...document.querySelectorAll(`${s} .marxy-arch-tile`)];
      return { tiles: tiles.length, filled: tiles.filter((t) => t.querySelector('.marxy-embed')).length };
    }, SHEET);
    // The README is at the root, after every folder's tiles: the sheet is scrolled to its end, where it is filled.
    await ev((s) => {
      const sheetEl = document.querySelector(s);
      if (sheetEl) sheetEl.scrollTop = sheetEl.scrollHeight;
    }, SHEET);
    await page.waitForFunction((s) => [...document.querySelectorAll(`${s} .marxy-arch-tile`)].some((t) => t.querySelector('.marxy-arch-tile-name')?.textContent === 'README.md' && t.querySelector('.marxy-embed h1')), SHEET, { timeout: 15000 }).catch(() => {});
    sheet = await ev(([ap, s, top]) => {
      const tiles = [...document.querySelectorAll(`${s} .marxy-arch-tile`)];
      const readme = tiles.find((t) => t.querySelector('.marxy-arch-tile-name')?.textContent === 'README.md');
      return {
        ...top,
        readme: readme?.querySelector('.marxy-embed h1')?.textContent ?? '',
        list: document.querySelector(`${ap} > .marxy-arch-body > .marxy-arch-entries > .marxy-atree`) !== null,
      };
    }, [AP, SHEET, atTop]);
    if (!clicked) sheet.start = '"a sheet" did not show the sheet';
    else delete sheet.start;
  }
  check('the entries as a sheet: each tile its own page drawn small, filled as it comes into view', sheet.tiles > 3 && sheet.filled > 2 && sheet.filled <= sheet.tiles && sheet.readme === 'Harbour survey, autumn 2026' && !sheet.list, JSON.stringify(sheet));

  // The filter, typed into the Line as a reader types it: `= name:.rs` keeps src/indexer.rs and its folder, the lede
  // says so; Esc in the page brings every entry back. Nothing of it is written.
  let filtered = { rows: [], said: '', back: 0, start: 'the survey was not shown as a list' };
  if (await surveyAsList()) {
    const all = await ev((ap) => document.querySelectorAll(`${ap} > .marxy-arch-body > .marxy-arch-entries > .marxy-atree .marxy-arow`).length, AP);
    await blurPage();
    if (await onArchive(SURVEY)) {
      await page.keyboard.press('Control+k');
      await page.waitForSelector('#marxy-palette[open]', { timeout: 5000 }).catch(() => {});
      await page.keyboard.type('= name:.rs');
      await page.waitForFunction(() => [...document.querySelectorAll('#marxy-palette .marxy-palette-row')].some((r) => /Matching/.test(r.textContent)), null, { timeout: 10000 }).catch(() => {});
      const offered = await ev(() => [...document.querySelectorAll('#marxy-palette .marxy-palette-row')].some((r) => /Matching “name:\.rs”/.test(r.textContent)));
      // Enter only on the filter's own row: on anything else it could open a file.
      if (offered) await page.keyboard.press('Enter');
      else await page.keyboard.press('Escape');
      await page.waitForFunction((ap) => document.querySelectorAll(`${ap} > .marxy-arch-body > .marxy-arch-entries > .marxy-atree .marxy-arow`).length === 2, AP, { timeout: 10000 }).catch(() => {});
      filtered = await ev((ap) => ({
        rows: [...document.querySelectorAll(`${ap} > .marxy-arch-body > .marxy-arch-entries > .marxy-atree .marxy-arow .marxy-arch-name`)].map((e) => e.textContent),
        said: document.querySelector(`${ap} .marxy-arch-showing`)?.textContent ?? '',
        back: 0,
      }), AP);
      await keyIn(SURVEY, 'Escape');
      await page.waitForFunction(([ap, n]) => document.querySelectorAll(`${ap} > .marxy-arch-body > .marxy-arch-entries > .marxy-atree .marxy-arow`).length === n, [AP, all], { timeout: 10000 }).catch(() => {});
      filtered.back = (await ev((ap) => document.querySelectorAll(`${ap} > .marxy-arch-body > .marxy-arch-entries > .marxy-atree .marxy-arow`).length, AP)) === all && !(await ev((ap) => document.querySelector(`${ap} .marxy-arch-showing`), AP));
    }
  }
  check('= name:.rs through the Line keeps that entry and its folder, and Esc brings every entry back', filtered.rows.join() === 'src/,indexer.rs' && /^Showing 1 of 25 files, matching “name:\.rs”\.$/.test(filtered.said) && filtered.back === true, JSON.stringify(filtered));

  // An archive inside it: the tar.gz under backups/ is listed in the preview from the bytes the webview holds (core's
  // reader, the webview's DecompressionStream), never sent back to Rust; o opens it as a full page of its own.
  let nestedLede = '';
  let nestedTab = '';
  if (await surveyAsList()) {
    await pickRow('notes-backup.tar.gz');
    await page.waitForSelector(`${AP} > .marxy-arch-body > .marxy-arch-preview > .marxy-arch-pbody .marxy-archpage-compact .marxy-arow`, { timeout: 15000 }).catch(() => {});
    nestedLede = await ev((ap) => document.querySelector(`${ap} > .marxy-arch-body > .marxy-arch-preview > .marxy-arch-pbody .marxy-archpage-compact .marxy-arch-lede`)?.textContent ?? '', AP);
    if (nestedLede && (await keyIn(SURVEY, 'o'))) {
      await page.waitForFunction(() => document.title.startsWith('notes-backup.tar.gz'), null, { timeout: 15000 }).catch(() => {});
      await page.waitForFunction((ap) => /^A tar archive, gzipped/.test(document.querySelector(`${ap} .marxy-arch-lede:not(.marxy-arch-pbody .marxy-arch-lede)`)?.textContent ?? ''), AP, { timeout: 15000 }).catch(() => {});
      nestedTab = await ev((ap) => (document.title.startsWith('notes-backup.tar.gz') ? (document.querySelector(`${ap} .marxy-arch-lede:not(.marxy-arch-pbody .marxy-arch-lede)`)?.textContent ?? '') : ''), AP);
    }
  }
  check('an archive inside the archive lists in the preview from the bytes held in memory', /^A tar archive, gzipped: 5 files in 2 folders, all inside notes\//.test(nestedLede), nestedLede.slice(0, 80) || 'no nested page');
  check('o opens the inner archive as a page of its own, held in memory', /^A tar archive, gzipped/.test(nestedTab), nestedTab.slice(0, 80) || 'not opened');
  const nestedOut = readdirSync(dir).filter((n) => /^(notes|notes-backup\.tar\.gz|2026-10-1\d\.md)$/i.test(n));
  check('the inner archive writes nothing beside the outer one', nestedOut.length === 0, nestedOut.join(', ') || 'nothing');
  await closeTab('notes-backup.tar.gz');

  // A database inside it, opened with o through the real Rust shell: the table page, read from the entry's bytes held
  // in memory, read-only, with nothing made beside the archive.
  // Self-contained: the survey opened again by its path, shown as a list with gauges.sqlite in it, and the cursor set by
  // keys inside that list (g g to backups/, j to data/, l to its first file), whatever the step before left.
  let db = { rows: 0, said: false, start: 'the survey was not shown as a list with gauges.sqlite' };
  await viewOpen(join(dir, SURVEY), `${AP} > .marxy-arch-body > .marxy-arch-entries > .marxy-atree .marxy-arow`);
  const rowsShown = (n) => ev(([ap, n]) => [...document.querySelectorAll(`${ap} > .marxy-arch-body > .marxy-arch-entries > .marxy-atree .marxy-arow .marxy-arch-name`)].some((e) => e.textContent === n), [AP, n]);
  if ((await surveyAsList()) && (await rowsShown('gauges.sqlite'))) {
    const at = () => ev((ap) => [...document.querySelectorAll(`${ap} > .marxy-arch-body > .marxy-arch-entries > .marxy-atree .marxy-arow[aria-selected="true"] .marxy-arch-name`)].map((e) => e.textContent).join(), AP);
    const walk = [];
    for (const [key, want] of [['g', null], ['g', 'backups/'], ['j', 'data/'], ['l', 'gauges.sqlite']]) {
      if (!(await keyIn(SURVEY, key))) break;
      if (want) await page.waitForFunction(([ap, w]) => [...document.querySelectorAll(`${ap} > .marxy-arch-body > .marxy-arch-entries > .marxy-atree .marxy-arow[aria-selected="true"] .marxy-arch-name`)].some((e) => e.textContent === w), [AP, want], { timeout: 3000 }).catch(() => {});
      walk.push(await at());
    }
    // o only with the cursor on the database: on any other entry it would open that one.
    if (!(await picked('gauges.sqlite'))) db.start = `the keys did not reach gauges.sqlite: ${JSON.stringify(walk)}`;
    else if (await keyIn(SURVEY, 'o')) {
      await page.waitForFunction(() => document.title.startsWith('gauges.sqlite'), null, { timeout: 15000 }).catch(() => {});
      await page.waitForSelector('.marxy-viewer-mount:not([hidden])[data-marxy-viewer="sqlite"] .marxy-tbl-grid tbody tr', { timeout: 15000 }).catch(() => {});
      db = await ev(() => {
        const at = document.querySelector('.marxy-viewer-mount:not([hidden])[data-marxy-viewer="sqlite"]');
        return {
          rows: at?.querySelectorAll('.marxy-tbl-grid tbody tr').length ?? 0,
          said: /An entry of an archive, read from its bytes held in memory/.test(at?.textContent ?? ''),
          title: document.title,
        };
      });
    }
  }
  const dbBeside = readdirSync(dir).filter((n) => /^(gauges\.sqlite.*|data)$/i.test(n));
  check('o on a database in the survey opens the table page, read from the entry in memory, writing nothing', db.rows > 0 && db.said && dbBeside.length === 0, JSON.stringify({ ...db, beside: dbBeside }));
  await closeTab('gauges.sqlite');

  // The steps leave the app as they found it: every tab they opened closed, the survey's too, and the plan current.
  for (const name of (await tabNames()).filter((n) => !tabsAtSurvey.includes(n))) await closeTab(name);
  await closeTab(SURVEY);
  await toTab('pg16-upgrade-plan.md');

  // A font is a specimen the webview draws from the file's bytes through FontFace, never installed; its names and
  // axes come from the Rust side, a WOFF2 decoded there; a glyph picked says its number and its Unicode name.
  copyFileSync(join(demo, 'fonts', 'TidemarkSans[wdth,wght].woff2'), join(dir, 'Tidemark.woff2'));
  await viewOpen(join(dir, 'Tidemark.woff2'), '.marxy-viewer-mount:not([hidden]) .marxy-font-spec');
  await page.waitForFunction(() => document.querySelector('.marxy-font-spec')?.style.visibility === '', null, { timeout: 15000 }).catch(() => {});
  await page.click('.marxy-font-glyphs button[aria-label="U+0052"]').catch(() => {});
  await showLeft('metadata');
  await page.waitForFunction(() => /latin capital letter R/.test(document.querySelector('.marxy-drawer [data-marxy-card="now-glyph"]')?.innerText ?? ''), null, { timeout: 10000 }).catch(() => {});
  const fontPage = await ev(() => ({
    drawn: [...document.fonts].some((f) => f.family.replace(/"/g, '').startsWith('marxy-specimen-') && f.status === 'loaded'),
    axes: document.querySelectorAll('.marxy-font-axis').length,
    glyph: document.querySelector('.marxy-drawer [data-marxy-card="now-glyph"]')?.innerText ?? '',
  }));
  await showLeft('outline');
  fontPage.format = await ev(() => document.querySelector('.marxy-drawer [data-marxy-card="contents"]')?.innerText ?? '');
  check('a WOFF2 is drawn by the webview, its names and axes read natively, a glyph named',
    fontPage.drawn && /WOFF2 · Brotli/.test(fontPage.format) && fontPage.axes === 2 && /latin capital letter R/.test(fontPage.glyph) && /number \d+/.test(fontPage.glyph),
    JSON.stringify({ ...fontPage, format: fontPage.format.slice(0, 60) }));

  // Audio and video play in the webview's player through marxy-file:// under the app's CSP, never on their own; a
  // WAV's waveform is read natively from its samples; ProRes, which WebView2 cannot decode, is a facts-only card.
  copyFileSync(join(demo, 'media', 'bell-buoy.wav'), join(dir, 'bell-buoy.wav'));
  await viewOpen(join(dir, 'bell-buoy.wav'), '.marxy-viewer-mount:not([hidden]) audio.marxy-media-player');
  await page.waitForFunction(() => (document.querySelector('audio.marxy-media-player')?.readyState ?? 0) >= 1 && document.querySelector('.marxy-media-wave canvas'), null, { timeout: 15000 }).catch(() => {});
  const wav = await ev(() => {
    const a = document.querySelector('audio.marxy-media-player');
    return { ready: a?.readyState ?? 0, paused: a?.paused ?? null, duration: Math.round((a?.duration ?? 0) * 10) / 10, wave: !!document.querySelector('.marxy-media-wave canvas') };
  });
  check('a WAV plays in the webview through marxy-file://, never on its own, under its waveform', wav.ready >= 1 && wav.paused === true && wav.duration === 5 && wav.wave, JSON.stringify(wav));
  copyFileSync(join(demo, 'media', 'ferry-leaving.mp4'), join(dir, 'ferry-leaving.mp4'));
  await viewOpen(join(dir, 'ferry-leaving.mp4'), '.marxy-viewer-mount:not([hidden]) .marxy-media-line');
  await page.waitForFunction(() => (document.querySelector('video.marxy-media-player')?.readyState ?? 0) >= 1 || document.querySelector('.marxy-media-noplay'), null, { timeout: 15000 }).catch(() => {});
  const mp4 = await ev(() => ({ ready: document.querySelector('video.marxy-media-player')?.readyState ?? 0, noplay: !!document.querySelector('.marxy-media-noplay'), line: document.querySelector('.marxy-media-line')?.textContent ?? '' }));
  check('an MP4 plays in the webview, its facts read from its boxes', mp4.ready >= 1 && !mp4.noplay && /about 18 frames a second/.test(mp4.line), JSON.stringify(mp4));
  copyFileSync(join(demo, 'media', 'interview-prores.mov'), join(dir, 'interview-prores.mov'));
  await viewOpen(join(dir, 'interview-prores.mov'), '.marxy-viewer-mount:not([hidden]) .marxy-media-line');
  await page.waitForFunction(() => document.querySelector('.marxy-media-noplay'), null, { timeout: 15000 }).catch(() => {});
  const prores = await ev(() => ({ noplay: document.querySelector('.marxy-media-title')?.textContent ?? '', head: document.querySelector('[data-marxy-head="0"] .marxy-guess')?.textContent ?? '' }));
  check('ProRes is facts only, said in the head as a tier', prores.noplay === 'This system cannot play Apple ProRes 422 HQ video in a .mov' && prores.head === 'Facts only · cannot play here', JSON.stringify(prores));

  // A PDF is drawn by pdf.js in the page from ranges of the file through marxy-file://, its text layer under the
  // app's CSP (no eval, no WebAssembly); Find in the page reaches its words; a PDF the reader did not open is refused.
  writeFileSync(join(dir, 'essay.pdf'), readFileSync(join(demo, 'reading', 'the-case-for-ragged-lines.pdf')));
  writeFileSync(join(dir, 'long.pdf'), longPdf(400));
  // Outline is the drawer's panel here (the font's step showed it): a PDF opened under it starts at its first page.
  await viewOpen(join(dir, 'essay.pdf'), '.marxy-viewer-mount:not([hidden]) .marxy-pdf-page[data-marxy-page="0"] .marxy-pdf-text span');
  const pdf = await ev(() => {
    const c = document.querySelector('.marxy-viewer-mount:not([hidden]) .marxy-pdf-page[data-marxy-page="0"] canvas');
    let ink = 0;
    if (c) {
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      for (let i = 0; i < d.length; i += 4) if (d[i] < 128) ink++;
    }
    return {
      ink,
      text: document.querySelector('.marxy-viewer-mount:not([hidden]) .marxy-pdf-page[data-marxy-page="0"] .marxy-pdf-text')?.textContent.slice(0, 25) ?? '',
      bar: document.querySelector('.marxy-viewer-mount:not([hidden]) .marxy-pdfbar')?.innerText.replace(/\s+/g, ' ') ?? '',
      pages: [...document.querySelectorAll('.marxy-viewer-mount:not([hidden]) .marxy-pdf-page')].map((p) => `${p.dataset.marxyPage}:${p.querySelector('canvas') ? 'c' : '-'}${p.querySelector('.marxy-pdf-text span') ? 't' : '-'}`).join(' '),
      title: document.title,
      stage: (() => {
        const s = document.querySelector('.marxy-viewer-mount:not([hidden]) .marxy-pdf-stage');
        return s ? `${Math.round(s.scrollTop)}/${s.scrollHeight}/${s.clientHeight}` : 'none';
      })(),
    };
  });
  pdf.cards = await allCardTitles();
  check('a PDF opens as its pages: pdf.js draws them and lays its text over them', pdf.ink > 500 && pdf.text === 'The case for ragged lines' && /of 3/.test(pdf.bar) && /PDF 1\.4 · A5/.test(pdf.bar), JSON.stringify({ ...pdf, cards: undefined }));
  if (pdf.cards.length > 0) check('a PDF\'s fourth card is Pages and its metadata slot Document', pdf.cards.includes('Pages') && pdf.cards.includes('Document'), pdf.cards.join(', '));
  await page.click('.marxy-viewer-mount:not([hidden]) .marxy-pdf-stage');
  await page.keyboard.press('Control+f');
  await page.keyboard.type('rivers');
  await page.waitForFunction(() => document.querySelector('.marxy-find-count')?.textContent === '1 of 2', null, { timeout: 15000 }).catch(() => {});
  const pdfFind = await ev(() => ({ count: document.querySelector('.marxy-find-count')?.textContent ?? '', marked: CSS.highlights?.get('marxy-find-current')?.size ?? 0 }));
  check('Find in the page reaches a PDF\'s text layer and marks the word', pdfFind.count === '1 of 2' && pdfFind.marked === 1, JSON.stringify(pdfFind));
  await page.keyboard.press('Escape');
  await viewOpen(join(dir, 'long.pdf'), '.marxy-viewer-mount:not([hidden]) .marxy-pdf-page[data-marxy-page="0"] .marxy-pdf-text span');
  await page.click('.marxy-viewer-mount:not([hidden]) .marxy-pdf-stage');
  await page.keyboard.press('End');
  await page.waitForFunction(() => document.querySelector('.marxy-viewer-mount:not([hidden]) .marxy-pdf-page[data-marxy-page="399"] .marxy-pdf-text')?.textContent.startsWith('Page 400 of 400'), null, { timeout: 15000 }).catch(() => {});
  const longShown = await ev(() => [...document.querySelectorAll('.marxy-viewer-mount:not([hidden]) .marxy-pdf-page')].map((e) => Number(e.dataset.marxyPage)));
  check('a 400-page PDF draws only the pages near the view, and reaches its last', longShown.includes(399) && longShown.length <= 4, longShown.join(', '));
  writeFileSync(join(outside, 'other.pdf'), readFileSync(join(dir, 'essay.pdf')));
  expectedConsole.push(/status of 403 \(Forbidden\)/);
  const pdfOutside = await fetched(fileUrl(join(outside, 'other.pdf')), 'bytes=0-1023');
  check('marxy-file:// refuses a PDF outside what the reader opened (403)', pdfOutside.status === 403, JSON.stringify(pdfOutside));

  // Once the app has been up long enough, the sweep has removed the index of the folder that is gone and kept the other.
  await wait(SWEEP_AFTER_MS - (Date.now() - launchedAt));
  check('the index of a folder that is gone is swept; one whose folder is there is kept', !existsSync(goneIndex) && existsSync(keptIndex));

  // A replace staged by Search in a file no pane then shows (close-joins.test.mjs case 5): the tab row marks it
  // unsaved, nothing is written, and the quit below asks about it by name.
  const heldFile = join(dir, 'held.md');
  // Built here, never spelled whole: this script sits in an open place, and Search reads every file there.
  const heldWord = ['quill', 'wort'].join('');
  const heldText = `# Held\n\nThe word ${heldWord} is here once.\n`;
  writeFileSync(heldFile, heldText);
  const heldRun = spawn(exe, [heldFile], { env, stdio: 'ignore' });
  await new Promise((r) => heldRun.on('exit', r));
  await page.waitForFunction(() => document.title.startsWith('held.md'), null, { timeout: 15000 }).catch(() => {});
  await blurPage();
  await page.keyboard.press('Control+k');
  await page.waitForSelector('#marxy-palette[open]', { timeout: 5000 }).catch(() => {});
  await page.fill('#marxy-palette .marxy-palette-query', `#${heldWord}`);
  await page.waitForFunction(() => document.querySelectorAll('#marxy-palette .marxy-palette-row').length > 0, null, { timeout: 30000 }).catch(() => {});
  await page.keyboard.press('Tab');
  await page.waitForSelector('.marxy-drawer input[data-marxy-left-field="search-r"]', { timeout: 10000 }).catch(() => {});
  await page.fill('.marxy-drawer input[data-marxy-left-field="search-r"]', 'bladderwort').catch(() => {});
  await page.waitForFunction(() => /^Stage 1 place in 1 file/.test(document.querySelector('.marxy-drawer .marxy-l-btns button.marxy-l-pri')?.textContent ?? ''), null, { timeout: 10000 }).catch(() => {});
  const stageSays = await ev(() => document.querySelector('.marxy-drawer .marxy-l-btns button.marxy-l-pri')?.textContent ?? '');
  await page.click('.marxy-drawer .marxy-l-btns button.marxy-l-pri').catch(() => {});
  await page.waitForFunction(() => [...document.querySelectorAll('.marxy-notice-text')].some((n) => /^Staged/.test(n.textContent)), null, { timeout: 10000 }).catch(() => {});
  check('Search stages a replace in a file found through the Rust side, writing nothing', stageSays.startsWith('Stage 1 place in 1 file') && readFileSync(heldFile, 'utf8') === heldText, stageSays);

  // Closed as the window's X closes it (WM_CLOSE) and launched again on the same data folder, the app brings back the
  // drawer's panel and the place in the plan. The place is scrolled first: a scroll of the page closes an open drawer.
  await openOther('plans/pg16-upgrade-plan.md', '.marxy-article h1');
  const heldTab = await ev(() => !![...document.querySelectorAll('.marxy-tabbar .marxy-tab')].find((t) => t.querySelector('.marxy-tab-name')?.textContent === 'held.md')?.querySelector('.marxy-tab-close[data-marxy-dirty]'));
  check('a file with staged changes no pane shows is a tab marked unsaved', heldTab);
  const scrollerJs = `(() => {
    const article = [...document.querySelectorAll('.marxy-article')].find((a) => a.offsetParent !== null && a.querySelector('h1')?.textContent.includes('Postgres 14'));
    for (let el = article?.parentElement; el; el = el.parentElement) {
      if (el.scrollHeight > el.clientHeight + 100 && /auto|scroll/.test(getComputedStyle(el).overflowY)) return el;
    }
    return document.scrollingElement;
  })()`;
  await page.evaluate(`(${scrollerJs}).scrollTop = (${scrollerJs}).scrollHeight * 0.6`);
  await wait(800);
  await showLeft('links');
  await wait(1000);
  // The block on the reading line (40 % down the scroller), the innermost one there, else the last one above it, with
  // the window's size: the window can come back at another size than it closed at (in one run it had been
  // made 1009 px tall, from 760, by nothing in the app or this script, and opened again at 760), and then the same place is another scrollTop.
  const placeOf = () => page.evaluate(`(() => {
    const s = ${scrollerJs};
    const box = s === document.scrollingElement ? { top: 0, height: innerHeight } : s.getBoundingClientRect();
    const line = box.top + box.height * 0.4;
    const article = [...document.querySelectorAll('.marxy-article')].find((a) => a.offsetParent !== null);
    let on = null;
    let above = null;
    for (const b of article ? article.querySelectorAll('[data-marxy-s]') : []) {
      const r = b.getBoundingClientRect();
      if (r.height === 0 || r.top > line) continue;
      if (r.bottom > line) on = b;
      if (!above || r.top >= above.getBoundingClientRect().top) above = b;
    }
    const b = on ?? above;
    return { top: Math.round(s.scrollTop), height: s.clientHeight, size: innerWidth + 'x' + innerHeight, block: b ? b.getAttribute('data-marxy-s') + ' ' + (b.textContent || '').trim().slice(0, 30) : null };
  })()`);
  const branchOf = () => ev(() => document.querySelector('.marxy-rail .marxy-l-rb[aria-pressed="true"]')?.getAttribute('aria-label') ?? 'none');
  const before = await placeOf();
  const branchBefore = await branchOf();
  const rowPaths = () => ev(() => [...document.querySelectorAll('.marxy-tabbar .marxy-tab')].map((t) => t.dataset.marxyTabPath));
  const rowBefore = await rowPaths();
  execFileSync('powershell', ['-NoProfile', '-Command', `(Get-Process -Id ${app.pid}).CloseMainWindow() | Out-Null`]);
  // The quit asks once about the held file, by name; it is let go, so the file on disk keeps its bytes.
  await page.waitForFunction(() => [...document.querySelectorAll('.marxy-notice-text')].some((n) => /held\.md has changes that are not saved, and no pane shows it/.test(n.textContent)), null, { timeout: 10000 }).catch(() => {});
  const quitAsks = await ev(() => [...document.querySelectorAll('.marxy-notice-text')].map((n) => n.textContent).filter((t) => /no pane shows/.test(t))).catch(() => []);
  check('quitting asks once about the file no pane shows, naming it', quitAsks.length === 1 && /held\.md has changes that are not saved, and no pane shows it/.test(quitAsks[0]), `${quitAsks.length} asked: ${quitAsks.join(' | ')}`);
  // Clicked where it shows, once it has come to rest, by the mouse alone. Playwright's click scrolls its target into view
  // first; the notice sits in a sticky region at the pane's foot, so caught mid-slide that scroll took the page to its
  // end (2106), the close wrote the place there, and the relaunch opened there.
  const quitButton = page.locator('.marxy-notice button', { hasText: 'Close without saving' });
  const restingBox = async () => {
    let last = null;
    for (let i = 0; i < 40; i++) {
      const box = await quitButton.boundingBox({ timeout: 5000 }).catch(() => null);
      if (box && last && box.x === last.x && box.y === last.y && box.y + box.height <= before.height) return box;
      last = box;
      await wait(50);
    }
    return last;
  };
  const quitBox = await restingBox();
  if (quitBox) await page.mouse.click(quitBox.x + quitBox.width / 2, quitBox.y + quitBox.height / 2);
  for (let i = 0; i < 40 && app.exitCode === null; i++) await wait(250);
  check('the window closes on WM_CLOSE once answered, the held file untouched', app.exitCode === 0 && readFileSync(heldFile, 'utf8') === heldText, `exit ${app.exitCode}`);
  await browser.close().catch(() => {});
  stop();
  await webviewsGone(dataDir);
  if (!(await start())) throw new Error('the second launch opened no WebView2 debugging port');
  await page.waitForSelector('.marxy-article h1', { timeout: 20000 });
  await wait(1500);
  const branchAfter = await branchOf();
  check('after a close and a launch, the drawer shows the panel it showed', branchBefore === 'Links' && branchAfter === branchBefore, `${branchBefore} -> ${branchAfter}`);
  const after = await placeOf();
  // The same block on the reading line; or, in a window of the same size, within a third of a screen: the place is a
  // reading line, not a pixel, and the restore may set it a line or so off.
  const samePlace = before.block !== null && after.block === before.block;
  const near = after.size === before.size && Math.abs(after.top - before.top) < before.height / 3;
  check('after a close and a launch, the plan opens at the place it was left', before.top > 0 && (samePlace || near),
    `scrollTop ${before.top} -> ${after.top}, window ${before.size} -> ${after.size}, reading line on ${before.block} -> ${after.block}`);
  // The row comes back from layout.json in its order; scratch pages, bundled pages and archive entries are not kept
  // (frame/tabs.ts isTransient), so it is the row before without them. It is put back after first text.
  const transient = (p) => /^untitled(?::(?:[2-9]|[1-9]\d+))?$/.test(p) || p.startsWith('marxy:') || /^archive-entry:\d+\//.test(p);
  const rowKept = rowBefore.filter((p) => !transient(p));
  await page.waitForFunction((n) => document.querySelectorAll('.marxy-tabbar .marxy-tab').length >= n, Math.max(2, rowKept.length), { timeout: 10000 }).catch(() => {});
  const rowAfter = await rowPaths();
  const layoutSaid = (() => {
    try {
      const file = readdirSync(dataDir, { recursive: true }).map(String).find((f) => basename(f) === 'layout.json');
      const l = file ? JSON.parse(readFileSync(join(dataDir, file), 'utf8')) : null;
      return l ? `layout.json: ${l.columns?.length} columns, ${l.tabs?.length} tabs` : 'no layout.json';
    } catch (e) {
      return `layout.json unreadable: ${String(e).slice(0, 60)}`;
    }
  })();
  check('after a close and a launch, the row of tabs comes back in its order', rowAfter.length >= 2 && rowAfter.join('\n') === rowKept.join('\n'), `${rowBefore.length} tabs -> ${rowAfter.length} (${layoutSaid}): ${rowAfter.join(', ')}`);

  // A tab dragged along its row by the mouse moves there: dragDropEnabled is off on Windows so the page's HTML5 drag
  // starts. The mouse is Playwright's, through CDP into WebView2: it intercepts the drag (Input.setInterceptDrags) and
  // delivers the drop itself, so this proves the page's drag in the real webview, not Windows' OLE drag loop around it.
  const tabRow = () => ev(() => [...document.querySelectorAll('.marxy-tabbar .marxy-tab .marxy-tab-name')].map((t) => t.textContent));
  await openOther('data/release.json', '.marxy-article [data-marxy-reading="tree"]');
  const tabsBefore = await tabRow();
  if (tabsBefore.length < 2) {
    check('a tab dragged by the mouse moves along its row', false, `only ${tabsBefore.length} tabs`);
  } else {
    // The second tab onto the first one's leading edge.
    const tabs = page.locator('.marxy-tabbar .marxy-tab');
    // The row scrolls with its active tab, so it is brought back to its start first.
    await tabs.nth(0).scrollIntoViewIfNeeded();
    await tabs.nth(1).dragTo(tabs.nth(0), { targetPosition: { x: 4, y: 10 } });
    await wait(600);
    const tabsAfter = await tabRow();
    const want = [tabsBefore[1], tabsBefore[0], ...tabsBefore.slice(2)];
    check('a tab dragged by the mouse moves along its row', tabsAfter.join() === want.join(), `${tabsBefore.join(', ')} -> ${tabsAfter.join(', ')}`);
  }

  // Files dropped from Explorer (windows-file-drop): the page posts them as WebView2 additional objects and
  // drop_windows.rs opens each by its path. CDP cannot start an OLE drag carrying files, so the FileList is a file
  // input's, set by path, which WebView2 treats as on disk exactly as a drop's. wry also hands the message to Tauri's
  // IPC parser, which says so on the console once.
  const dropped = join(dir, 'dropped-from-explorer.log');
  writeFileSync(dropped, '2026-11-04 12:00:00 INFO dropped on the window\n');
  await ev(() => {
    const input = Object.assign(document.createElement('input'), { type: 'file', id: 'marxy-check-drop', hidden: true });
    document.body.append(input);
  });
  const cdp = await page.context().newCDPSession(page);
  const { root } = await cdp.send('DOM.getDocument');
  const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#marxy-check-drop' });
  await cdp.send('DOM.setFileInputFiles', { nodeId, files: [dropped] });
  expectedConsole.push(/JSON error: expected value/);
  await ev(() => window.chrome.webview.postMessageWithAdditionalObjects('marxy-drop', document.getElementById('marxy-check-drop').files));
  await page.waitForFunction(() => document.title.includes('dropped-from-explorer.log'), null, { timeout: 8000 }).catch(() => {});
  check('a file dropped from Explorer opens in a tab of its own', (await tabRow()).includes('dropped-from-explorer.log'), (await tabRow()).join(', '));
  await ev(() => document.getElementById('marxy-check-drop')?.remove());
  // Held over the window, files are said; dropped where no file is on disk, the page takes the drop and no view does.
  const hover = await ev(async () => {
    const dt = new DataTransfer();
    dt.items.add(new File(['typed into the page'], 'not-on-disk.txt', { type: 'text/plain' }));
    window.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
    const shown = document.body.hasAttribute('data-marxy-dropping');
    await new Promise((r) => setTimeout(r, 400));
    const gone = !document.body.hasAttribute('data-marxy-dropping');
    const target = document.querySelector('.marxy-article') ?? document.body;
    const drop = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt });
    target.dispatchEvent(drop);
    return { shown, gone, taken: drop.defaultPrevented, text: document.body.innerText.includes('typed into the page') };
  });
  check('files held over the window are said, and the cue goes when they leave', hover.shown && hover.gone, JSON.stringify(hover));
  check('a dropped file is taken by the page, never typed into the document', hover.taken && !hover.text, JSON.stringify(hover));
  // Cases on a real disk and the real shell, each in a folder of its own under one temporary folder. A case that throws is
  // one FAIL named for it, and the next case still runs.
  realDir = mkdtempSync(join(tmpdir(), 'marxy-real-'));
  const real = (name) => join(realDir, name);
  const caseOf = async (name, fn) => {
    // A clean window: menus and the Line closed, focus off any editor.
    for (let i = 0; i < 2; i++) await page.keyboard.press('Escape').catch(() => {});
    await blurPage().catch(() => {});
    try {
      await fn();
    } catch (e) {
      check(name, false, String(e?.message ?? e).replace(/\s*\n\s*/g, ' | ').slice(0, 400));
    }
  };
  const tryRead = (file) => {
    try {
      return readFileSync(file);
    } catch {
      return null;
    }
  };
  const settle = async (read, ok, ms = 6000) => {
    for (let t = 0; t < ms && !ok(read()); t += 250) await wait(250);
    return read();
  };
  const openReal = async (file) => {
    const run = spawn(exe, [file], { env, stdio: 'ignore' });
    await new Promise((r) => run.on('exit', r));
    const opened = await page.waitForFunction((name) => document.title.startsWith(name), basename(file), { timeout: 20000 }).then(() => true, () => false);
    if (!opened) throw new Error(`${basename(file)} did not open; the title is "${await ev(() => document.title)}"`);
    await wait(600);
  };
  const inSource = async () => {
    await page.locator('[data-marxy-head="0"] .marxy-rs-source').first().click({ timeout: 8000, noWaitAfter: true });
    await page.locator('[data-marxy-pane="0"] .cm-content:visible').first().waitFor({ timeout: 10000 });
  };
  const appendText = async (text) => {
    await page.locator('[data-marxy-pane="0"] .cm-content:visible').first().click({ timeout: 8000, noWaitAfter: true });
    await page.keyboard.press('Control+End');
    await page.keyboard.type(text);
  };
  const editorText = () => ev(() => [...document.querySelectorAll('[data-marxy-pane="0"] .cm-content')].find((e) => e.getClientRects().length > 0)?.innerText ?? '');
  const unsaved = () => ev(() => !!document.querySelector('[data-marxy-head="0"] .marxy-head-chip[data-marxy-chip="unsaved"]:not([hidden])'));
  const noticeSaid = (re, ms) =>
    page.waitForFunction((src) => [...document.querySelectorAll('.marxy-notice-text')].some((n) => new RegExp(src).test(n.textContent)), re.source, { timeout: ms }).then(() => true, () => false);
  const runCommand = async (title) => {
    await page.keyboard.press('Control+p');
    await page.fill('#marxy-palette .marxy-palette-query', `>${title}`);
    await wait(300);
    await page.keyboard.press('Enter');
    await wait(600);
  };
  const saveKey = async () => {
    await page.locator('[data-marxy-pane="0"] .cm-content:visible').first().click({ timeout: 8000, noWaitAfter: true });
    await page.keyboard.press('Control+s');
  };

  // A save over a file another program changed: refused, each choice does what docs/using-marxy.md says, and Versions keeps
  // nothing for the refusal. A first ordinary save is the control that Versions does record here.
  await caseOf('save conflict', async () => {
    const f = real('conflict.md');
    const base = '# Conflict\n\nfirst line\n';
    writeFileSync(f, base);
    await openReal(f);
    await inSource();
    const versions = () => readdirSync(dataDir).filter((n) => n.startsWith('versions-')).sort().join(',');
    const v0 = versions();
    await appendText('MINE-ONE');
    await saveKey();
    const first = await settle(() => tryRead(f), (b) => b?.toString() !== base);
    const grew = await settle(versions, (v) => v !== v0, 4000);
    check('a plain save writes the edit and Versions keeps the copy it replaced', first?.toString() === `${base}MINE-ONE` && grew !== v0, `${describeDifference(first, Buffer.from(`${base}MINE-ONE`))}; versions ${v0 === grew ? 'unchanged' : 'grew'}`);

    await appendText('MINE-TWO');
    const other = '# Conflict\n\nwritten by another program\n';
    writeFileSync(f, other);
    const said = await noticeSaid(/Choose "Keep my version as a copy"/, 15000);
    const v1 = versions();
    await saveKey();
    await wait(1500);
    check('a save over a file another program changed is refused: the notice names the choices, the disk keeps the other bytes', said && tryRead(f)?.toString() === other, `notice ${said}; ${describeDifference(tryRead(f), Buffer.from(other))}`);
    check('a refused save adds nothing to Versions and the edits stay unsaved', versions() === v1 && (await unsaved()), `versions ${versions() === v1 ? 'same' : 'changed'}, unsaved ${await unsaved()}`);

    await runCommand('Keep my version as a copy');
    const mine = real('conflict (mine).md');
    const copied = await settle(() => tryRead(mine), (b) => b !== null);
    const shown = await editorText();
    check('"Keep my version as a copy" writes the edits to name (mine).md and takes the disk\'s version', copied?.toString().includes('MINE-TWO') && tryRead(f)?.toString() === other && shown.includes('written by another program') && !shown.includes('MINE-TWO'),
      `copy ${copied ? `${copied.length} bytes` : 'missing'}; editor ${JSON.stringify(shown.slice(0, 60))}`);

    await appendText('MINE-THREE');
    const again = '# Conflict\n\nwritten again\n';
    writeFileSync(f, again);
    await noticeSaid(/Choose "Keep my version as a copy"/, 15000);
    await runCommand('Take the version on disk');
    const shown2 = await editorText();
    check('"Take the version on disk" discards the edits and writes no copy', !existsSync(real('conflict (mine 2).md')) && !tryRead(mine)?.toString().includes('MINE-THREE') && tryRead(f)?.toString() === again && shown2.includes('written again') && !shown2.includes('MINE-THREE') && !(await unsaved()),
      `editor ${JSON.stringify(shown2.slice(0, 60))}, unsaved ${await unsaved()}`);
  });

  // Bytes keep their encoding, BOM and line endings through an edit and a save.
  await caseOf('encoding round trip', async () => {
    const samples = [
      ['UTF-16LE with a BOM', 'wide.md', utf16LeWithBom('# Wide\nsecond line\n'), Buffer.from('EDIT', 'utf16le')],
      ['CRLF UTF-8 with a BOM', 'crlf.md', utf8WithBom('# Crlf\r\nsecond line\r\nthird\r\n'), Buffer.from('EDIT', 'utf8')],
    ];
    for (const [label, name, original, added] of samples) {
      const f = real(name);
      writeFileSync(f, original);
      await openReal(f);
      await inSource();
      await appendText('EDIT');
      await saveKey();
      const expected = Buffer.concat([original, added]);
      const got = await settle(() => tryRead(f), (b) => b !== null && !b.equals(original));
      check(`${label}: an edit and a save keep the file's bytes, BOM and line endings`, got?.equals(expected) === true, describeDifference(got, expected));
    }
  });

  // The open file deleted by another program: Save writes it again from the buffer.
  await caseOf('save after delete', async () => {
    const f = real('gone.md');
    const base = '# Gone\n\nbody\n';
    writeFileSync(f, base);
    await openReal(f);
    await inSource();
    await appendText('EDIT');
    unlinkSync(f);
    const said = await noticeSaid(/was removed from disk/, 15000);
    await saveKey();
    const expected = Buffer.from(`${base}EDIT`);
    const got = await settle(() => tryRead(f), (b) => b !== null);
    check('a file deleted from outside is written again by Save, with the buffer\'s bytes', got?.equals(expected) === true, `notice ${said}; ${describeDifference(got, expected)}`);
  });

  // What the shell answers for: the open file, its unopened neighbour, the folders above, an index root, a rename.
  await caseOf('command scope', async () => {
    const scope = real('scope');
    mkdirSync(scope);
    const opened = join(scope, 'opened.md');
    const sibling = join(scope, 'sibling.md');
    const orig = '# Opened\n\nreadable\n';
    writeFileSync(opened, orig);
    writeFileSync(sibling, '# Sibling\n\nnot opened\n');
    const call = (cmd, args) =>
      ev(async ({ cmd, args }) => {
        try {
          const v = await window.__TAURI_INTERNALS__.invoke(cmd, args);
          return { ok: true, value: v instanceof ArrayBuffer ? v.byteLength : Array.isArray(v) ? v.map((e) => e.path) : v };
        } catch (e) {
          return { code: e?.code ?? String(e).slice(0, 80) };
        }
      }, { cmd, args });
    const writeTo = (path) =>
      ev(async (path) => {
        try {
          await window.__TAURI_INTERNALS__.invoke('write_file_atomic', new TextEncoder().encode('overwritten'), { headers: { 'x-marxy-path': encodeURIComponent(path) } });
          return { ok: true };
        } catch (e) {
          return { code: e?.code ?? String(e).slice(0, 80) };
        }
      }, path);
    const refused = (r) => r.ok !== true && ['outside', 'permission', 'refused'].includes(r.code);
    // The index holds an open file's folder as a read-only root, so a neighbour there reads by design; the refused file is
    // one in a folder nothing opened or chose.
    const elsewhere = mkdtempSync(join(tmpdir(), 'marxy-elsewhere-'));
    realExtra.push(elsewhere);
    const stranger = join(elsewhere, 'stranger.md');
    writeFileSync(stranger, '# Stranger\n');
    await openReal(opened);
    const readOpened = await call('read_file', { path: opened });
    const readStranger = await call('read_file', { path: stranger });
    const listStranger = await call('read_dir', { dir: elsewhere });
    check('the opened file is readable and a file in a folder nobody opened or chose is refused by the shell', readOpened.ok === true && refused(readStranger) && refused(listStranger), `opened ${JSON.stringify(readOpened)}, stranger ${JSON.stringify(readStranger)}, list ${JSON.stringify(listStranger)}`);

    const statAbove = await call('stat_file', { path: scope });
    await page.click(`[data-marxy-head="0"] .marxy-crumb:text-is("scope")`, { timeout: 8000 }).catch(() => {});
    await page.waitForSelector('.marxy-verb-menu [role="menuitem"]', { timeout: 5000 }).catch(() => {});
    const crumbRows = await ev(() => [...document.querySelectorAll('.marxy-verb-menu [role="menuitem"]')].map((e) => e.textContent.trim()));
    await page.keyboard.press('Escape');
    const readChosen = await call('read_file', { path: sibling });
    await call('mark_opened', { path: elsewhere, root: true });
    const listChosen = await call('read_dir', { dir: elsewhere });
    check('the folder crumb lists the open file folder, which then reads; a folder is listed once chosen (as a crumb chooses it)',
      crumbRows.some((r) => r.startsWith('sibling.md')) && readChosen.ok === true && statAbove.ok === true && Array.isArray(listChosen.value) && listChosen.value.some((p) => /stranger\.md$/.test(p)),
      JSON.stringify({ crumbRows: crumbRows.slice(0, 4), readChosen, statAbove, listChosen: listChosen.code ?? 'listed' }));

    const idx = real('index-root');
    mkdirSync(idx);
    const indexed = join(idx, 'indexed.txt');
    writeFileSync(indexed, 'indexed');
    await call('mark_opened', { path: idx, indexed: true });
    const readIndexed = await call('read_file', { path: indexed });
    const writeIndexed = await writeTo(indexed);
    check('an index root is read-only: its file reads and a write into it is refused, the bytes unchanged', readIndexed.ok === true && refused(writeIndexed) && tryRead(indexed)?.toString() === 'indexed', `read ${JSON.stringify(readIndexed)}, write ${JSON.stringify(writeIndexed)}`);
    await call('forget_root', { path: idx });

    await inSource();
    await appendText('EDIT');
    const renamed = join(scope, 'renamed.md');
    renameSync(opened, renamed);
    const followed = await page.waitForFunction(() => document.title.startsWith('renamed.md'), null, { timeout: 15000 }).then(() => true, () => false);
    await saveKey();
    const expected = Buffer.from(`${orig}EDIT`);
    const got = await settle(() => tryRead(renamed), (b) => b?.equals(expected));
    check('a save after the file was renamed lands on the new name and not the old', followed && got?.equals(expected) === true && !existsSync(opened), `followed ${followed}; unsaved ${await unsaved()}; editor ${JSON.stringify((await editorText()).slice(-30))}; notices ${(await ev(() => [...document.querySelectorAll('.marxy-notice-text')].map((n) => n.textContent).join(' | '))).slice(0, 200)}; ${describeDifference(got, expected)}; old name ${existsSync(opened) ? 'recreated' : 'absent'}`);
    // Leave the window clean: a buffer still unsaved here would hold up every later open in this pane.
    if (await unsaved()) {
      await call('mark_opened', { path: renamed });
      await saveKey();
      await page.waitForSelector('[data-marxy-head="0"] .marxy-head-chip[data-marxy-chip="unsaved"]', { state: 'hidden', timeout: 8000 }).catch(() => {});
    }
  });

  // F11 and Esc, read from the window itself (is_fullscreen). The window is put back whatever happens.
  await caseOf('full screen', async () => {
    const fullscreen = () => ev(() => window.__TAURI_INTERNALS__.invoke('is_fullscreen'));
    const lineOpen = () => ev(() => document.querySelector('#marxy-palette')?.open === true);
    const until = async (want) => {
      for (let i = 0; i < 20 && (await fullscreen()) !== want; i++) await wait(250);
      return fullscreen();
    };
    try {
      const was = await fullscreen();
      await blurPage();
      await page.keyboard.press('F11');
      const entered = await until(true);
      await page.keyboard.press('Control+p');
      await wait(400);
      const lineShown = await lineOpen();
      await page.keyboard.press('Escape');
      await wait(500);
      const afterLine = { line: await lineOpen(), full: await fullscreen() };
      await blurPage();
      await page.keyboard.press('/');
      await wait(400);
      const findShown = await lineOpen();
      await page.keyboard.press('Escape');
      await wait(500);
      const afterFind = { line: await lineOpen(), full: await fullscreen() };
      await page.keyboard.press('Escape');
      const left = await until(false);
      await page.keyboard.press('F11');
      const again = await until(true);
      await page.keyboard.press('F11');
      const toggled = await until(false);
      check('F11 enters full screen and the first Esc closes an open Line, not the window',
        was === false && entered === true && lineShown && afterLine.line === false && afterLine.full === true, JSON.stringify({ was, entered, lineShown, afterLine }));
      check('Esc with the Line in its find scope closes the Line first; the next Esc leaves full screen; F11 toggles both ways',
        findShown && afterFind.line === false && afterFind.full === true && left === false && again === true && toggled === false, JSON.stringify({ findShown, afterFind, left, again, toggled }));
    } finally {
      await ev(() => window.__TAURI_INTERNALS__.invoke('set_fullscreen', { on: false })).catch(() => {});
    }
  });

  // A 20 MB log opens as Lines, scrolls to its last line, and the window's processes do not balloon. The memory is the
  // working set of marxy.exe and every WebView2 process under it, read before the open and after the scroll.
  await caseOf('lines on a 20 MB log', async () => {
    const memory = () => {
      try {
        const script = 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,WorkingSetSize,PrivatePageCount | ConvertTo-Json -Compress';
        const rows = JSON.parse(execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', timeout: 30000, maxBuffer: 64 * 2 ** 20 }));
        return treeMemory(rows, app.pid);
      } catch {
        return null;
      }
    };
    const big = real('big-api.log');
    const { bytes, lines } = largeLog(20);
    writeFileSync(big, bytes);
    const before = memory();
    await openReal(big);
    await page.waitForSelector('.marxy-article .marxy-lines-row', { timeout: 60000 });
    const head = await ev(() => document.querySelector('.marxy-article .marxy-lines .marxy-reading-head')?.textContent ?? '');
    const rowsAtTop = await ev(() => document.querySelectorAll('.marxy-article .marxy-lines-row').length);
    for (let i = 0; i < 2; i++) {
      await ev(async () => {
        const body = document.querySelector('.marxy-article .marxy-lines');
        let sc = document.scrollingElement;
        for (let e = body?.parentElement; e && e !== document.body; e = e.parentElement) {
          if (/auto|scroll/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight) {
            sc = e;
            break;
          }
        }
        sc.scrollTop = sc.scrollHeight;
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      });
    }
    await page.waitForFunction((n) => [...document.querySelectorAll('.marxy-article .marxy-lines-no')].some((e) => Number(e.textContent) === n), lines, { timeout: 15000 }).catch(() => {});
    const end = await ev((n) => {
      const rows = [...document.querySelectorAll('.marxy-article .marxy-lines-row')];
      const last = rows.find((r) => Number(r.querySelector('.marxy-lines-no')?.textContent) === n);
      return { drawn: rows.length, last: last?.querySelector('.marxy-lines-text')?.textContent ?? null };
    }, lines);
    check('a 20 MB log opens as Lines with only the rows near the screen, and its end is the last line',
      head === 'Lines' && rowsAtTop > 20 && rowsAtTop < 300 && end.drawn < 300 && /the very last line/.test(end.last ?? ''), JSON.stringify({ head, rowsAtTop, lines, end }));
    await wait(1500);
    const after = memory();
    const BOUND_MB = 600;
    if (!before || !after) check('the window\'s memory with a 20 MB log open is within bound (not measured: the process list could not be read)', true, 'recorded nothing');
    else {
      const grew = after.workingSetMB - before.workingSetMB;
      check(`the window's processes grow by under ${BOUND_MB} MB working set with a 20 MB log open and scrolled to its end`, grew < BOUND_MB,
        `${before.processes} -> ${after.processes} processes; working set ${before.workingSetMB.toFixed(0)} -> ${after.workingSetMB.toFixed(0)} MB (+${grew.toFixed(0)}); private ${before.privateMB.toFixed(0)} -> ${after.privateMB.toFixed(0)} MB`);
    }
  });

  // A program card: what the file claims, "signed, not verified" or "no signature", and nothing started.
  await caseOf('program card', async () => {
    const card = async (file) => {
      await openReal(file);
      await page.waitForSelector('.marxy-fcard', { timeout: 15000 });
      return ev(() => {
        const root = document.querySelector('.marxy-viewer-mount:not([hidden]) .marxy-fcard') ?? document.querySelector('.marxy-fcard');
        const facts = Object.fromEntries([...root.querySelectorAll('.marxy-fact')].map((e) => [e.children[0].textContent.trim().toLowerCase(), e.children[1].innerText.split(/\r?\n/)[0]]));
        const open =[...root.querySelectorAll('button')].find((b) => /Open in default app/.test(b.textContent));
        return { kicker: root.querySelector('.marxy-fcard-kicker')?.textContent ?? '', facts, openDisabled: open ? open.disabled : null };
      });
    };
    const running = (name) => new RegExp(name.replace('.', '\.'), 'i').test(execFileSync('tasklist', ['/FI', `IMAGENAME eq ${name}`, '/NH'], { encoding: 'utf8' }));
    const minimal = real('minimal.exe');
    writeFileSync(minimal, minimalPe());
    const m = await card(minimal);
    check('a minimal program with no resources shows its header claims and "No signature", Open in default app off',
      m.kicker === 'A Windows program' && /x64.*console program/.test(m.facts['built for'] ?? '') && m.facts.signature === 'No signature' && m.openDisabled !== false, JSON.stringify(m));

    const roots = [process.env.SystemRoot ?? 'C:\\Windows', join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application')];
    const candidates = [join(roots[1], 'msedge.exe'), join(roots[0], 'System32', 'mstsc.exe'), join(roots[0], 'System32', 'notepad.exe'), join(roots[0], 'explorer.exe')].filter(existsSync);
    const signedPick = candidates.find((c) => embeddedSignature(readFileSync(c))) ?? candidates[0];
    if (!signedPick) {
      check('a copy of a system program shows its card (skipped: no system program found to copy)', true);
    } else {
      const copy = real('signed-copy.exe');
      copyFileSync(signedPick, copy);
      const embedded = embeddedSignature(readFileSync(copy));
      const s = await card(copy);
      const want = embedded ? /^Signature present, not verified$/ : /^(No signature|Signature present, not verified)$/;
      check(`a copy of ${basename(signedPick)} shows what it claims and its signature as ${embedded ? '"Signature present, not verified"' : 'present or absent, never verified'}`,
        s.kicker === 'A Windows program' && want.test(s.facts.signature ?? '') && /Microsoft/i.test(s.facts.company ?? s.facts.product ?? '') && /x64|ARM64|x86/.test(s.facts['built for'] ?? '') && s.openDisabled !== false, JSON.stringify(s).slice(0, 500));
      check('opening the program cards started no program', !running('signed-copy.exe') && !running('minimal.exe'));
    }
  });
} catch (error) {
  check('the run', false, String(error?.message ?? error).split('\n')[0]);
  if (/Call log/.test(String(error?.message))) console.log(String(error.message).slice(0, 1500));
  // What the window showed when the run stopped, for whoever reads the failure.
  if (process.env.MARXY_CHECK_SHOTS) await page?.screenshot({ path: join(process.env.MARXY_CHECK_SHOTS, 'tauri-check-stopped.png') }).catch(() => {});
}

console.log(results.join('\n'));
console.log(problems.length ? problems.slice(0, 20).join('\n') : 'no page errors');
await browser?.close().catch(() => {});
stop();
await removeDataFolder(dataDir);
if (dir) await removeDataFolder(dir);
if (outside) await removeDataFolder(outside);
if (realDir) await removeDataFolder(realDir);
for (const d of realExtra) await removeDataFolder(d);
process.exit(results.filter((r) => r.startsWith('FAIL')).length + problems.length);
