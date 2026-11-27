// The shared kit for browser tests that wait for conditions, not time: one browser per test file, the app booted
// over the memory shell on the shipped skeleton, waits for what the reader sees or the app announces, reads of what is
// on screen, and timings that are recorded rather than failed on.
//
//   const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);
//   test('…', () => withApp({ files, open: ['/r/a.md'] }, async (page, app) => { … }));
//
// `withApp` boots the app on `files` in a fresh page of the file's one browser (a context per test, so no state crosses
// tests) and waits until the first document is complete. Nothing here sleeps: a wait is a `waitForFunction` on a
// condition, polled on animation frames, or a count of painted frames.
import { appendFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { after } from 'node:test';
import { webkit } from 'playwright';
import { launchWebkit } from '../../../../scripts/playwright-webkit.mjs';
import { bootTwoPanes } from './two-pane.mjs';

/** A run without Playwright's WebKit skips the browser cases and says why; MARXY_BROWSER_TESTS_REQUIRED=1 makes that a failure. */
export const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;

/** How long a condition may take before the test fails: far over any run on a hosted runner. */
export const WAIT_MS = 60_000;

let browserPromise = null;

/** The file's one browser. Under `scripts/browser-tests.mjs` it is the runner's own; alone, one launched here. */
export function sharedBrowser() {
  browserPromise ??= launchWebkit();
  return browserPromise;
}

/**
 * A stand-in for `launchWebkit()` in a test that makes its own pages: `newPage` and `newContext` open a context in the
 * file's one browser, and `close` closes the contexts this call opened, not the browser.
 */
export async function openBrowser() {
  const browser = await sharedBrowser();
  const contexts = [];
  const newContext = async (options) => {
    const context = await browser.newContext(options);
    contexts.push(context);
    return context;
  };
  return {
    newContext,
    newPage: async (options) => (await newContext(options)).newPage(),
    close: async () => { await Promise.all(contexts.map((c) => c.close().catch(() => {}))); },
  };
}

/** Closes the file's browser and its server (done by itself when the file's tests end). */
export async function closeKit() {
  const pending = browserPromise;
  browserPromise = null;
  await (await pending)?.close().catch(() => {});
  const { closeHarness } = await import('./two-pane.mjs');
  await closeHarness();
}

// Closes the browser when the importing file's tests are done, so a file need not remember to.
after(() => closeKit());

// ---- waits ----------------------------------------------------------------------------------------------------

/** Waits until `fn(arg)` is truthy in the page; returns its value. */
export function until(page, fn, arg, { timeout = WAIT_MS } = {}) {
  return page.waitForFunction(fn, arg, { timeout, polling: 'raf' }).then((handle) => handle.jsonValue());
}

/** Waits for `n` painted frames. */
export function frames(page, n = 2) {
  return page.evaluate(
    (n) => new Promise((done) => {
      let left = n;
      const tick = () => (--left <= 0 ? done() : requestAnimationFrame(tick));
      requestAnimationFrame(tick);
    }),
    n,
  );
}

/** Waits until the focused pane's whole document is rendered and the fonts it asks for are loaded. */
export async function contentComplete(page) {
  await page.evaluate(async () => {
    await window.__marxyHandle.contentComplete();
    await document.fonts.ready;
  });
}

/**
 * Waits until the shell was told a startup mark, such as `typeset_done` or `content_complete` (`scripts/registry.json`
 * `marks`). With `after`, a mark made once `after` marks of that name were already there (a second render).
 */
export function markSeen(page, name, { after = 0 } = {}) {
  return until(page, ({ name, after }) => window.__marxyHandle.shell.calls.filter((c) => c.method === 'mark' && c.args[0] === name).length > after, { name, after });
}

/** How many times the shell was told mark `name` so far. */
export const markCount = (page, name) =>
  page.evaluate((name) => window.__marxyHandle.shell.calls.filter((c) => c.method === 'mark' && c.args[0] === name).length, name);

/** Waits for an element to be there (and, by default, to show). */
export function present(page, selector, { visible = true } = {}) {
  return until(page, ({ selector, visible }) => {
    const el = document.querySelector(selector);
    return el !== null && (!visible || (el.getClientRects().length > 0 && !el.hidden));
  }, { selector, visible });
}

/** Waits for the element to be gone. */
export const absent = (page, selector) => until(page, (s) => document.querySelector(s) === null, selector);

/**
 * Waits until the scroll position of `selector` (the page when none) held still for `still` frames in a row, and
 * returns it. A scroll by wheel, a jump to a place and a restore all end this way.
 */
export function scrollSettled(page, selector = null, still = 6) {
  return page.evaluate(
    ({ selector, still }) => new Promise((done) => {
      const el = selector ? document.querySelector(selector) : document.scrollingElement;
      let last = NaN;
      let same = 0;
      const tick = () => {
        const now = el.scrollTop;
        same = now === last ? same + 1 : 0;
        last = now;
        if (same >= still) done(now);
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }),
    { selector, still },
  );
}

/**
 * Waits until nothing under `root` changed for `still` frames in a row: the typesetter, a restyle or a lazy chunk
 * that was still writing has finished. It is the way to say "nothing more happens" without a timer.
 */
export function quiet(page, { root = '#doc', still = 30 } = {}) {
  return page.evaluate(
    ({ root, still }) => new Promise((done) => {
      const el = document.querySelector(root);
      let changed = false;
      const observer = new MutationObserver(() => { changed = true; });
      observer.observe(el, { subtree: true, childList: true, characterData: true, attributes: true });
      let calm = 0;
      const tick = () => {
        calm = changed ? 0 : calm + 1;
        changed = false;
        if (calm >= still) { observer.disconnect(); done(); } else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }),
    { root, still },
  );
}

/**
 * Waits until the window stopped changing: nothing under `<body>` was added, removed or restyled for `still` frames.
 * For the step after an action that should change nothing (a key that is a no-op, a dismissed prompt), where no
 * condition can be named: whatever the app was going to do about it has been done.
 */
export const idle = (page, still = 12) => quiet(page, { root: 'body', still });

/** Waits until every paragraph the page will set is set, and the typesetter wrote nothing for a while after. */
export async function typesetIdle(page, { root = '#doc' } = {}) {
  await contentComplete(page);
  await quiet(page, { root });
}

// ---- what the reader sees ------------------------------------------------------------------------------------

/** The window as a reader sees it: the title, the headings and text of each pane's page, the tabs, the notices. */
export function sees(page) {
  return page.evaluate(() => {
    const clean = (s) => (s ?? '').replace(/\s+/g, ' ').trim();
    const handle = window.__marxyHandle;
    return {
      title: document.title,
      mode: document.body.getAttribute('data-marxy-mode'),
      paths: handle.panes().panes.map((p) => p.path()),
      headings: [...document.querySelectorAll('.marxy-article h1, .marxy-article h2, .marxy-article h3')].map((h) => clean(h.textContent)),
      text: clean(document.querySelector('#doc')?.textContent),
      tabs: [...document.querySelectorAll('.marxy-tabbar .marxy-tab-name')].map((t) => clean(t.textContent)),
      notices: [...document.querySelectorAll('.marxy-notice-text')].map((n) => clean(n.textContent)),
    };
  });
}

/** The text of the elements matching `selector`, whitespace collapsed. */
export const textsOf = (page, selector) =>
  page.evaluate((s) => [...document.querySelectorAll(s)].map((e) => (e.textContent ?? '').replace(/\s+/g, ' ').trim()), selector);

/** The bytes of `path` in the memory shell, as text. */
export const fileText = (page, path) =>
  page.evaluate(async (p) => new TextDecoder().decode(await window.__marxyHandle.shell.readFile(p)), path);

// ---- timings --------------------------------------------------------------------------------------------------

/** Multiplies every budget that is held: a slow machine sets MARXY_BUDGET_SCALE above 1. */
const scale = () => (Number(process.env.MARXY_BUDGET_SCALE) > 0 ? Number(process.env.MARXY_BUDGET_SCALE) : 1);

/**
 * Records how long something took: a line in the test's output, and with MARXY_TIMINGS (a file) a line of JSON
 * there, so a run's timings can be kept and compared. It never fails.
 */
export function recordTiming(name, ms, budget) {
  const rounded = Math.round(ms * 10) / 10;
  console.log(`# timing ${name}: ${rounded} ms${budget === undefined ? '' : ` (budget ${budget} ms)`}`);
  if (process.env.MARXY_TIMINGS) {
    try { appendFileSync(process.env.MARXY_TIMINGS, `${JSON.stringify({ name, ms: rounded, budget })}\n`); } catch {}
  }
  return rounded;
}

/**
 * Records a timing and fails when it is over `limit` ms (times MARXY_BUDGET_SCALE). Use it only where the budget is
 * what the test is for, and set `limit` so far above what a hosted runner takes that only a real slowdown crosses it.
 */
export function holdBudget(assert, name, ms, limit) {
  recordTiming(name, ms, limit);
  assert.ok(ms <= limit * scale(), `${name} took ${Math.round(ms)} ms, over its ${limit * scale()} ms budget`);
}

/** Runs `fn`, records how long it took (in the page's clock, wall time) and returns `[result, ms]`. */
export async function timed(name, fn) {
  const t0 = performance.now();
  const result = await fn();
  const ms = performance.now() - t0;
  recordTiming(name, ms);
  return [result, ms];
}

// ---- booting --------------------------------------------------------------------------------------------------

/** A fresh page (its own context, so no state crosses tests) in the file's one browser; the context closes after `fn`. */
export async function inFreshPage({ viewport = { width: 1440, height: 900 }, media } = {}, fn) {
  const browser = await sharedBrowser();
  const context = await browser.newContext({ viewport });
  try {
    const page = await context.newPage();
    if (media) await page.emulateMedia(media);
    return await fn(page);
  } finally {
    await context.close().catch(() => {});
  }
}

/** The platform's Mod key as Playwright presses it. */
export const modKey = async (page) => ((await page.evaluate(() => navigator.platform)) === 'MacIntel' ? 'Meta' : 'Control');

/**
 * Boots the app on `files` with `open[0]` (and `open[1]` beside it) in a fresh page of the file's one browser, waits for
 * the first document to be complete, and runs `fn(page, app)`. `app` holds `mod` (the platform's Mod key as Playwright
 * presses it), `errors` (page errors, any left at the end fail the test) and the waits and reads above bound to the
 * page. `complete: false` skips waiting for the whole document (a very large one). `full` boots through `bootApplication` (the rail, the drawer, the palette), as the shipped app does.
 */
export async function withApp({ files, open, config, frame, viewport = { width: 1440, height: 900 }, media, sparse, full = true, guard = false, complete = true }, fn) {
  await inFreshPage({ viewport, media }, async (page) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const all = { ...files };
    if (config !== undefined) all['/config'] = config;
    if (frame !== undefined) all['/data/frame.json'] = `${JSON.stringify({ version: 1, frame }, null, 2)}\n`;
    await bootTwoPanes(page, { files: all, open, full, sparse, guard });
    if (full) {
      await until(page, () => document.querySelector('.marxy-rail .marxy-l-rb') && (document.body.getAttribute('data-marxy-drawer') !== 'docked' || document.querySelector('.marxy-drawer .marxy-l-body[data-marxy-left], .marxy-drawer[data-marxy-branch]')));
    }
    if (open.length > 0 && complete) await contentComplete(page);
    const app = {
      mod: await modKey(page),
      errors,
      until: (fn, arg, o) => until(page, fn, arg, o),
      frames: (n) => frames(page, n),
      contentComplete: () => contentComplete(page),
      markSeen: (name, o) => markSeen(page, name, o),
      markCount: (name) => markCount(page, name),
      present: (selector, o) => present(page, selector, o),
      absent: (selector) => absent(page, selector),
      scrollSettled: (selector, still) => scrollSettled(page, selector, still),
      quiet: (o) => quiet(page, o),
      idle: (n) => idle(page, n),
      typesetIdle: (o) => typesetIdle(page, o),
      sees: () => sees(page),
      textsOf: (selector) => textsOf(page, selector),
      fileText: (path) => fileText(page, path),
    };
    await fn(page, app);
    if (errors.length > 0) throw new Error(`page errors: ${errors.join(' | ')}`);
  });
}
