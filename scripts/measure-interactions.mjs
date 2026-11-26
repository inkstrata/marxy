// What the reader feels on an ordinary long document, in numbers anyone can take before and after a change.
//
// It starts this tree's source in its own Vite server over the in-memory shell (the way
// `apps/desktop/scripts/shots.mjs` does) and drives it in headless Edge through Playwright, because Chromium
// reports what the main thread did: `Performance.getMetrics` gives task, script, layout and style-recalc
// time and the layout and recalc counts, attributed by the browser rather than by a wall clock. It plants
// `fixtures/corpus/32-long-reference.md` (195 KB, 30 footnotes) and a 25 KB document and, for each,
// measures:
//   open       time to first content, main-thread time until the page stops changing, the longest task, nodes
//   key        a cursor key (`j`), twenty presses spaced so they do not queue: per-key work and counts
//   click      the first click on a paragraph
//   undo       one small block edit, then undo: work, and how many top-level nodes of the article were taken
//              out and put in
//   reload     a line appended on disk and reloaded: the same
// Durations run from the action until the main thread has been idle for about a second, so they include
// the typesetting that follows; the table's legend says what each one covers.
//   tab        away to another tab and back
//   mode       Source to Read (and Read to Source) with nothing edited
// Every number is the median of its repetitions. Launch time is `measure-startup.mjs`'s job, not this one's.
//
// A measurement, not a gate: it exits non-zero only when a number it was asked for could not be taken.
// It writes nothing inside the repository unless given a path.
//
// usage: node scripts/measure-interactions.mjs [--runs N] [--keys N] [--docs long-reference,short-document] [--doc <path>] [--browser msedge|chrome|chromium]
//                                              [--record <path>] [--compare <record>] [--against <record>]
//   --runs N           repetitions of the open, and of each step after it that repeats (default 3)
//   --keys N           cursor key presses per document (default 20)
//   --docs a,b         `long-reference` (195 KB), `long-reference-plain` (the same with its footnote and link definitions
//                      escaped, so the page can be updated in place; open, undo and reload only) and `short-document`
//                      (25 KB); default all three
//   --doc <path>       also measure this file, under its own name (repeatable; alone, it replaces the default set)
//   --record <path>    write one JSON record: commit, date, machine class, Edge version, the numbers
//   --compare <record> print this run against a saved record, with the change in each number
//   --against <record> with --compare: compare two saved records and run nothing
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { arch, cpus, platform, totalmem } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { STEPS, buildRecord, formatCompare, formatTable, medians, neutraliseDefinitions } from './lib/interactions-record.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const DESKTOP = join(ROOT, 'apps/desktop');
const USAGE =
  'usage: node scripts/measure-interactions.mjs [--runs N] [--keys N] [--docs long-reference,long-reference-plain,short-document] [--doc <path>] [--browser msedge|chrome|chromium] [--record <path>] [--compare <record>] [--against <record>]';
const BROWSERS = ['msedge', 'chrome', 'chromium'];

/** The documents, by the name a record keeps them under. */
export const DOCUMENTS = {
  'long-reference': { file: 'fixtures/corpus/32-long-reference.md', path: '/demo/reading/long-reference.md', tab: 'long-reference.md' },
  // The same page with its 30 footnote definitions neutralised: beside `long-reference`, what the notes cost
  // an in-place page update, which only the edit steps tell apart.
  'long-reference-plain': {
    file: 'fixtures/corpus/32-long-reference.md',
    transform: neutraliseDefinitions,
    path: '/demo/reading/long-reference-plain.md',
    tab: 'long-reference-plain.md',
    steps: ['open', 'undo', 'reload'],
  },
  'short-document': { file: 'fixtures/demo/tidemark/docs/specs/incremental-indexing.md', path: '/demo/reading/short-document.md', tab: 'short-document.md' },
};

/** The documents a run measures: the named ones, then each `--doc` file under its own name. */
export function documentsFor(o) {
  const out = {};
  for (const name of o.docs) out[name] = DOCUMENTS[name];
  for (const file of o.files) {
    const name = basename(file);
    if (name in out || name in DOCUMENTS) throw new Error(`--doc ${file}: the name ${name} is already a document of the run`);
    out[name] = { abs: resolve(file), path: `/demo/reading/${name}`, tab: name };
  }
  return out;
}

const bytesOf = doc => {
  const raw = readFileSync(doc.abs ?? join(ROOT, doc.file));
  return doc.transform ? Buffer.from(doc.transform(raw.toString('utf8')), 'utf8') : raw;
};

/** The page the app lands on, and so the tab the measured document switches to and from. */
const LANDING = { open: 'reading/on-the-measure.md', tab: 'on-the-measure.md' };

/** Parsed command line; throws an Error with a message for a bad one. */
export function parseArgs(argv) {
  const o = { runs: 3, keys: 20, docs: null, files: [], browser: 'msedge', record: null, compare: null, against: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    let a = argv[i];
    let inline = null;
    const eq = a.indexOf('=');
    if (a.startsWith('--') && eq > 0) {
      inline = a.slice(eq + 1);
      a = a.slice(0, eq);
    }
    const take = () => {
      if (inline !== null) return inline;
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) throw new Error(`${a} needs a value`);
      return v;
    };
    switch (a) {
      case '--runs': o.runs = Number(take()); break;
      case '--keys': o.keys = Number(take()); break;
      case '--docs': o.docs = take().split(',').filter(Boolean); break;
      case '--doc': o.files.push(take()); break;
      case '--browser': o.browser = take(); break;
      case '--record': o.record = take(); break;
      case '--compare': o.compare = take(); break;
      case '--against': o.against = take(); break;
      case '--help': case '-h': o.help = true; break;
      default: throw new Error(`unknown argument ${a}`);
    }
  }
  if (!Number.isInteger(o.runs) || o.runs < 1) throw new Error('--runs is a whole number of 1 or more');
  if (!Number.isInteger(o.keys) || o.keys < 1) throw new Error('--keys is a whole number of 1 or more');
  // Files given with --doc stand alone unless --docs also names some.
  if (o.docs === null) o.docs = o.files.length ? [] : Object.keys(DOCUMENTS);
  for (const d of o.docs) if (!(d in DOCUMENTS)) throw new Error(`--docs names ${Object.keys(DOCUMENTS).join(', ')}, not ${d}`);
  if (o.docs.length + o.files.length === 0) throw new Error('--docs names at least one document');
  if (!BROWSERS.includes(o.browser)) throw new Error(`--browser is one of ${BROWSERS.join(', ')}, not ${o.browser}`);
  if (o.against && !o.compare) throw new Error('--against goes with --compare');
  return o;
}

const STEP_NAMES = STEPS.map(s => s.step);
const wait = ms => new Promise(r => setTimeout(r, ms));
const METRICS = ['TaskDuration', 'ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration', 'LayoutCount', 'RecalcStyleCount'];

/** Installed before the app's scripts run: long tasks, and the time the handlers of a key or a click took. */
function installProbes() {
  window.__lt = [];
  window.__h = { keydown: [] };
  window.__ev = [];
  try {
    new PerformanceObserver(l => { for (const e of l.getEntries()) window.__lt.push(e.duration); }).observe({ type: 'longtask', buffered: true });
  } catch {}
  // Event Timing reports only events of 16 ms or more, so a click that costs less than that adds nothing.
  try {
    new PerformanceObserver(l => { for (const e of l.getEntries()) window.__ev.push({ name: e.name, ms: e.processingEnd - e.processingStart }); }).observe({ type: 'event', durationThreshold: 16 });
  } catch {}
  // A message posted from the capture listener arrives after the target's own handlers and their microtasks.
  for (const type of Object.keys(window.__h)) {
    window.addEventListener(type, () => {
      const t0 = performance.now();
      const mc = new MessageChannel();
      mc.port1.onmessage = () => { window.__h[type].push(performance.now() - t0); };
      mc.port2.postMessage(0);
    }, true);
  }
}

/** The app from this tree's source: a Vite server on a free port and a headless browser. */
async function launch(o) {
  const require = createRequire(join(DESKTOP, 'package.json'));
  const { createServer } = await import(pathToFileURL(require.resolve('vite')).href);
  const { chromium } = await import('playwright');
  const server = await createServer({
    root: DESKTOP,
    configFile: join(DESKTOP, 'vite.config.ts'),
    logLevel: 'error',
    server: { port: 0, strictPort: false, host: '127.0.0.1', hmr: false, watch: null },
  });
  await server.listen();
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({
      ...(o.browser === 'chromium' ? {} : { channel: o.browser }),
      headless: true,
      ignoreDefaultArgs: ['--hide-scrollbars'],
      args: ['--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows'],
    });
  } catch (e) {
    await server.close();
    throw new Error(`cannot start ${o.browser} (is it installed? --browser chrome|chromium for another): ${e.message.split('\n')[0]}`);
  }
  return {
    base,
    version: `${o.browser} ${browser.version()}`,
    /** A fresh window on the landing page, with probes and a metrics session. */
    async page() {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
      const page = await context.newPage();
      page.errors = [];
      page.on('pageerror', e => page.errors.push(String(e)));
      await page.addInitScript(installProbes);
      await page.goto(`${base}/?open=${encodeURIComponent(LANDING.open)}`);
      await page.waitForFunction(() => !!window.marxy?.handle && !!document.title && document.title !== 'Marxy', null, { timeout: 90000 });
      await page.evaluate(() => window.marxy.handle.contentComplete());
      const cdp = await context.newCDPSession(page);
      await cdp.send('Performance.enable');
      const s = { page, cdp, context, errors: page.errors };
      await quiet(s);
      return s;
    },
    async close() {
      await browser.close();
      await server.close();
    },
  };
}

async function metrics(cdp) {
  const { metrics: list } = await cdp.send('Performance.getMetrics');
  const out = {};
  for (const m of list) if (METRICS.includes(m.name)) out[m.name] = m.value;
  return out;
}

const delta = (a, b) => ({
  taskMs: (b.TaskDuration - a.TaskDuration) * 1000,
  scriptMs: (b.ScriptDuration - a.ScriptDuration) * 1000,
  layoutMs: (b.LayoutDuration - a.LayoutDuration) * 1000,
  styleMs: (b.RecalcStyleDuration - a.RecalcStyleDuration) * 1000,
  layouts: b.LayoutCount - a.LayoutCount,
  recalcs: b.RecalcStyleCount - a.RecalcStyleCount,
});

/** Waits until the main thread has done almost nothing for three polls running; false when it never did. */
async function quiet({ cdp }, { capMs = 120000, intervalMs = 300 } = {}) {
  const start = Date.now();
  let calm = 0;
  let last = await metrics(cdp);
  while (Date.now() - start < capMs) {
    await wait(intervalMs);
    const now = await metrics(cdp);
    calm = (now.TaskDuration - last.TaskDuration) * 1000 < 10 ? calm + 1 : 0;
    last = now;
    if (calm >= 3) return true;
  }
  return false;
}

const frames = page => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
const longest = page => page.evaluate(() => Math.max(0, ...window.__lt));
const resetProbes = page => page.evaluate(() => { window.__lt.length = 0; window.__ev.length = 0; for (const k of Object.keys(window.__h)) window.__h[k].length = 0; });
const handlers = (page, ...types) => page.evaluate(t => t.reduce((sum, k) => sum + window.__h[k].reduce((a, b) => a + b, 0), 0), types);

/** The article of the document on show: tabs keep the others, hidden. */
const ARTICLE = `(() => [...document.querySelectorAll('.marxy-article')].find(a => !a.hidden && !a.closest('[hidden]')) ?? document.querySelector('.marxy-article'))()`;

/** Counts what happens to the article's children from now on. */
function watchArticle(page) {
  return page.evaluate(`(() => {
    const art = ${ARTICLE};
    window.__art = art;
    window.__mut = { records: 0, removedTop: 0, addedTop: 0 };
    window.__mo?.disconnect();
    window.__mo = new MutationObserver(rs => {
      for (const r of rs) {
        window.__mut.records++;
        if (r.type !== 'childList' || r.target !== art) continue;
        window.__mut.removedTop += r.removedNodes.length;
        window.__mut.addedTop += r.addedNodes.length;
      }
    });
    window.__mo.observe(art, { subtree: true, childList: true, characterData: true });
  })()`);
}
const mutations = page => page.evaluate(() => window.__mut);

/**
 * Runs `action`, then waits for the page to go quiet, and returns the browser's own account of the work
 * between: task, script, layout and style time, counts, the longest task. With `expect`, the page must
 * also have changed the article (an undo or a reload that did nothing is no sample).
 */
async function measure(s, action, { expect = false } = {}) {
  await resetProbes(s.page);
  if (expect) await watchArticle(s.page);
  const a = await metrics(s.cdp);
  await action();
  if (expect) await s.page.waitForFunction(() => window.__mut.records > 0, null, { timeout: 15000 }).catch(() => {});
  // A page that never went quiet has no end to measure to: no sample rather than a number cut at the cap.
  if (!(await quiet(s))) return null;
  const b = await metrics(s.cdp);
  const out = { ...delta(a, b), longestTaskMs: await longest(s.page) };
  if (expect) {
    const m = await mutations(s.page);
    if (m.records === 0) return null;
    out.removedTop = m.removedTop;
    out.addedTop = m.addedTop;
  }
  return out;
}

/** Opens the planted document and takes the open's numbers. */
async function openOnce(s, doc) {
  const { page } = s;
  await resetProbes(page);
  await page.evaluate(() => {
    window.__lastMut = 0;
    new MutationObserver(() => { window.__lastMut = performance.now(); }).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
  });
  const a = await metrics(s.cdp);
  const r = await page.evaluate(async path => {
    const bytes = await window.marxy.shell.readFile(path).then(x => x.bytes ?? x);
    const text = new TextDecoder().decode(bytes);
    let key = '';
    for (const line of text.split('\n')) {
      const l = line.replace(/^[#>\-*\s|]+/, '').trim();
      if (l.length > 8 && !l.startsWith('<') && !l.startsWith('---') && !/^\w+:/.test(l)) { key = l.slice(0, 20); break; }
    }
    const t0 = performance.now();
    let first = null;
    const check = () => {
      if (first !== null) return;
      const art = [...document.querySelectorAll('.marxy-article')].find(x => !x.hidden && !x.closest('[hidden]'));
      if (art && art.childElementCount > 0 && (!key || (art.textContent || '').includes(key))) first = performance.now() - t0;
    };
    const mo = new MutationObserver(check);
    mo.observe(document, { subtree: true, childList: true, characterData: true });
    await window.marxy.handle.open(path);
    check();
    await window.marxy.handle.contentComplete();
    check();
    mo.disconnect();
    return { t0, first };
  }, doc.path);
  const settled = await quiet(s);
  const b = await metrics(s.cdp);
  const tail = await page.evaluate(t0 => ({ settleMs: window.__lastMut - t0, nodes: document.querySelectorAll('*').length }), r.t0);
  if (r.first === null || !settled) return null;
  return { ...delta(a, b), firstContentMs: r.first, longestTaskMs: await longest(page), settleMs: tail.settleMs, nodes: tail.nodes };
}

async function paragraphPoint(page, index) {
  return page.evaluate(`((index) => {
    const art = ${ARTICLE};
    const ps = [...art.querySelectorAll('p')].filter(p => p.textContent.length > 120 && !p.closest('table,pre,details'));
    const p = ps[Math.min(ps.length - 1, index)];
    p.scrollIntoView({ block: 'center' });
    const r = p.getBoundingClientRect();
    return { x: r.left + 40, y: r.top + 12 };
  })(${index})`);
}

async function click(s, index) {
  await s.page.mouse.click(5, 5).catch(() => {});
  const p = await paragraphPoint(s.page, index);
  await quiet(s);
  const out = await measure(s, () => s.page.mouse.click(p.x, p.y));
  out.handlerMs = await s.page.evaluate(() => window.__ev.filter(e => /^(pointerdown|pointerup|mousedown|mouseup|click)$/.test(e.name)).reduce((a, e) => a + e.ms, 0));
  return out;
}

async function keys(s, count) {
  const per = [];
  for (let i = 0; i < count; i++) {
    await resetProbes(s.page);
    const a = await metrics(s.cdp);
    await s.page.keyboard.press('j');
    await wait(150);
    const b = await metrics(s.cdp);
    per.push({ ...delta(a, b), handlerMs: await handlers(s.page, 'keydown') });
  }
  return per;
}

/** A small edit of a block in the middle of the page, committed; then undo it. */
async function undoOnce(s) {
  const { page } = s;
  const target = await page.evaluate(`(() => {
    const ps = [...${ARTICLE}.querySelectorAll(':scope > p[data-marxy-s]')];
    const p = ps[Math.floor(ps.length * 0.6)];
    p.scrollIntoView({ block: 'center' });
    return +p.getAttribute('data-marxy-s');
  })()`);
  await quiet(s);
  await page.evaluate(b => window.marxy.handle.selection.selectBlockAtByte(b), target);
  await page.keyboard.press('Control+Enter');
  await page.waitForSelector('.marxy-block-editor .cm-content', { timeout: 15000 });
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' ZZ', { delay: 30 });
  await page.keyboard.press('Control+Enter');
  await page.waitForFunction(() => document.querySelector('.marxy-block-editor') === null, null, { timeout: 15000 });
  await quiet(s);
  return measure(s, () => page.keyboard.press('Control+z'), { expect: true });
}

/** A line appended to the file on disk, as another program would, and the watch event for it. */
async function reloadOnce(s, doc, n) {
  return measure(
    s,
    () =>
      s.page.evaluate(async ([path, n]) => {
        const sh = window.marxy.shell;
        const old = await sh.readFile(path).then(x => x.bytes ?? x);
        const add = new TextEncoder().encode(`\n\nLine ${n} appended from outside.\n`);
        const next = new Uint8Array(old.length + add.length);
        next.set(old);
        next.set(add, old.length);
        sh.plant(path, next);
        sh.emit([{ kind: 'modified', path }]);
      }, [doc.path, n]),
    { expect: true },
  );
}

async function switchTo(s, tab) {
  const sel = `.marxy-tabbar .marxy-tab:has(.marxy-tab-name:text-is("${tab}")) .marxy-tab-open`;
  await resetProbes(s.page);
  const a = await metrics(s.cdp);
  const t0 = Date.now();
  await s.page.click(sel);
  await s.page.waitForFunction(t => (window.marxy.handle.currentPath() || '').endsWith(t), tab, { timeout: 15000 });
  await frames(s.page);
  const shownMs = Date.now() - t0;
  await quiet(s);
  const b = await metrics(s.cdp);
  return { ...delta(a, b), shownMs };
}

async function toggle(s) {
  await resetProbes(s.page);
  const a = await metrics(s.cdp);
  const shownMs = await s.page.evaluate(async () => {
    const t0 = performance.now();
    await window.marxy.handle.toggleMode();
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    return performance.now() - t0;
  });
  await quiet(s);
  const b = await metrics(s.cdp);
  return { ...delta(a, b), shownMs };
}

const modeOf = page => page.evaluate(() => document.body.dataset.marxyMode);

/** Every step for one document; `log` says what is running. A step that throws is a step with no number. */
async function measureDocument(host, name, doc, o, log) {
  const bytes = bytesOf(doc);
  const want = step => !doc.steps || doc.steps.includes(step);
  const plant = s => s.page.evaluate(([p, b64]) => window.marxy.shell.plant(p, Uint8Array.from(atob(b64), c => c.charCodeAt(0))), [doc.path, bytes.toString('base64')]);
  const result = {};
  const opens = [];
  let s = null;
  const step = async (label, fn) => {
    log(`${name}: ${label}`);
    try {
      return await fn();
    } catch (e) {
      console.error(`measure-interactions: ${name}: ${label}: ${e.message.split('\n')[0]}`);
      return null;
    }
  };
  for (let i = 0; i < o.runs; i++) {
    s = await host.page();
    await plant(s);
    const r = await step(`open ${i + 1}/${o.runs}`, () => openOnce(s, doc));
    if (r) opens.push(r);
    if (i < o.runs - 1) await s.context.close();
  }
  result.open = medians(opens);
  if (opens.length === 0) { await s.context.close(); return result; }

  const click1 = want('click') && (await step('first click', () => click(s, 3)));
  if (click1) result.click = medians([click1]);

  const k = want('key') && (await step('cursor keys', () => keys(s, o.keys)));
  if (k) result.key = medians(k);

  const undos = [];
  for (let i = 0; i < o.runs; i++) {
    const r = await step(`undo ${i + 1}/${o.runs}`, () => undoOnce(s));
    if (r) undos.push(r);
  }
  result.undo = medians(undos);

  const reloads = [];
  for (let i = 0; i < o.runs; i++) {
    const r = await step(`reload ${i + 1}/${o.runs}`, () => reloadOnce(s, doc, i + 1));
    if (r) reloads.push(r);
  }
  result.reload = medians(reloads);

  const back = [];
  const away = [];
  if (want('tabBack')) await step('tabs', async () => {
    for (let i = 0; i < o.runs; i++) {
      away.push(await switchTo(s, LANDING.tab));
      back.push(await switchTo(s, doc.tab));
    }
  });
  result.tabBack = medians(back);
  result.tabAway = medians(away);

  const toSource = [];
  const toRead = [];
  if (want('toRead')) await step('Source and Read', async () => {
    for (let i = 0; i < o.runs; i++) {
      if ((await modeOf(s.page)) === 'source') throw new Error(`already in Source before round ${i + 1}`);
      toSource.push(await toggle(s));
      toRead.push(await toggle(s));
    }
  });
  result.toSource = medians(toSource);
  result.toRead = medians(toRead);

  if (s.errors.length) console.error(`measure-interactions: ${name}: page errors: ${s.errors.slice(0, 3).join(' | ')}`);
  await s.context.close();
  return result;
}

export function commitOf() {
  const run = args => spawnSync('git', ['-C', ROOT, ...args], { encoding: 'utf8' });
  const head = run(['rev-parse', '--short=8', 'HEAD']);
  if (head.status !== 0) return { commit: null, dirty: false, code: null };
  // The trees of what is measured, so a baseline taken on master plus this tool still says which app it ran.
  const parts = ['apps', 'packages', 'fixtures'];
  // Not `--short`: it implies `--verify`, which takes one name.
  const trees = run(['rev-parse', ...parts.map(p => `HEAD:${p}`)]).stdout.trim().split('\n');
  const code = Object.fromEntries(parts.map((p, i) => [p, trees[i]?.slice(0, 8) || null]));
  code.dirty = run(['status', '--porcelain', '--', ...parts]).stdout.trim() !== '';
  return { commit: head.stdout.trim(), dirty: run(['status', '--porcelain', '--', '.']).stdout.trim() !== '', code };
}

/** `win32-x64, 16 x AMD Ryzen 7, 32 GB`: enough to tell two machines apart. */
export function machineClass() {
  const c = cpus();
  return `${platform()}-${arch()}, ${c.length} x ${(c[0]?.model ?? 'cpu').replace(/\s+/g, ' ').trim()}, ${Math.round(totalmem() / 2 ** 30)} GB`;
}

const readRecord = path => JSON.parse(readFileSync(resolve(path), 'utf8'));

export async function main(argv) {
  let o;
  try {
    o = parseArgs(argv);
  } catch (e) {
    console.error(`measure-interactions: ${e.message}\n${USAGE}`);
    return 2;
  }
  if (o.help) {
    console.log(USAGE);
    return 0;
  }
  let base = null;
  if (o.compare) {
    try {
      base = readRecord(o.compare);
    } catch (e) {
      console.error(`measure-interactions: cannot read ${o.compare}: ${e.message}`);
      return 2;
    }
  }
  if (o.against) {
    try {
      process.stdout.write(formatCompare(base, readRecord(o.against)));
      return 0;
    } catch (e) {
      console.error(`measure-interactions: cannot read ${o.against}: ${e.message}`);
      return 2;
    }
  }

  const log = m => console.error(`  ${m}`);
  let host;
  let record;
  let docs;
  try {
    docs = documentsFor(o);
    host = await launch(o);
    log('warming the dev server');
    const warm = await host.page();
    for (const doc of Object.values(docs)) {
      await warm.page.evaluate(([p, b64]) => window.marxy.shell.plant(p, Uint8Array.from(atob(b64), c => c.charCodeAt(0))), [doc.path, bytesOf(doc).toString('base64')]);
      await warm.page.evaluate(async p => { await window.marxy.handle.open(p); await window.marxy.handle.contentComplete(); }, doc.path);
    }
    await warm.context.close();
    const documents = {};
    for (const [name, doc] of Object.entries(docs)) documents[name] = await measureDocument(host, name, doc, o, log);
    const { commit, dirty, code } = commitOf();
    record = buildRecord({
      meta: { commit, dirty, code, date: new Date().toISOString(), machine: machineClass(), edge: host.version, node: process.version, runs: o.runs, keys: o.keys },
      documents,
      steps: Object.fromEntries(Object.entries(docs).map(([n, d]) => [n, d.steps ?? STEP_NAMES])),
    });
  } catch (e) {
    console.error(`measure-interactions: ${e.stack ?? e.message}`);
    return 1;
  } finally {
    await host?.close().catch(() => {});
  }

  process.stdout.write(formatTable(record));
  if (base) process.stdout.write(`\n${formatCompare(base, record)}`);
  if (o.record) {
    mkdirSync(dirname(resolve(o.record)), { recursive: true });
    writeFileSync(resolve(o.record), `${JSON.stringify(record, null, 2)}\n`);
    console.log(`record written to ${resolve(o.record)}`);
  }
  if (record.missing.length) {
    console.error(`measure-interactions: no number for ${record.missing.join(', ')}`);
    return 1;
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exit(await main(process.argv.slice(2)));
