// What a closed document leaves running. Every listener, observer and interval the app installs is counted by a
// wrapper put on the page before the app loads; after opening documents of many kinds, splitting and closing panes
// and starting the app again, the counts are what they were. Only what can hold a closed document counts: a listener
// on the window, the document or its faces, or on an element still in the page; an observer watching an element still
// in the page; an interval not cleared. One on an element that has left the page goes with it. Last, a closed pane's
// view, page and document, and a document replaced in a pane, are shown to be collectable through WeakRefs.
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { after, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { bootTwoPanes, closeHarness } from './support/two-pane.mjs';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip, timeout: 600_000 }, fn);
after(() => closeHarness());

const demo = (path) => readFileSync(new URL(`../../../fixtures/demo/${path}`, import.meta.url));
const para = (word) => `${word} runs long enough to wrap across several lines of the column. `.repeat(6);
const files = {
  '/r/a.md': `# A\n\n${para('Alpha')}\n\n| x | y |\n| - | - |\n| 1 | 2 |\n\n\`\`\`js\nconst a = 1;\n\`\`\`\n`,
  '/r/b.md': `# B\n\n${para('Bravo')}\n\n- [ ] a task\n`,
  '/r/c.txt': `${para('Plain')}\n`.repeat(20),
  '/r/d.csv': demo('data/p95-latency.csv'),
  '/r/e.json': demo('data/release.json'),
  '/r/f.png': demo('images/tidemark-icon.png'),
  '/r/g.svg': demo('images/sketch.svg'),
  '/r/h.eml': demo('mail/re-gauge-readings.eml'),
  '/r/i.ttf': demo('fonts/TidemarkSans-Regular.ttf'),
  '/r/j.tar.gz': demo('archives/notes-backup.tar.gz'),
  '/r/k.ipynb': demo('notebooks/tide-heights.ipynb'),
  '/r/l.yaml': demo('data/ci.yaml'),
};
const ORDER = Object.keys(files);

/** Put on the page before any of its scripts: the counting wrapper. */
function installCounter() {
  const ids = new WeakMap();
  let next = 0;
  const idOf = (fn) => {
    if (fn === null || (typeof fn !== 'function' && typeof fn !== 'object')) return 'none';
    if (!ids.has(fn)) ids.set(fn, ++next);
    return ids.get(fn);
  };
  /** The app's own frame that made a listener or an observer: named when a count grows. */
  const where = () => (new Error().stack ?? '').split('\n').find((l) => l.includes('/src/') && !l.includes('installCounter'))?.replace(/^.*\/src\//, '').replace(/\?[^:]*/, '') ?? '?';
  /** Each target's live listeners, by type, capture and listener. */
  const byTarget = new WeakMap();
  const targets = new Set();
  const capture = (o) => (typeof o === 'boolean' ? o : Boolean(o?.capture));
  const add = EventTarget.prototype.addEventListener;
  const remove = EventTarget.prototype.removeEventListener;
  EventTarget.prototype.addEventListener = function (type, fn, opts) {
    add.call(this, type, fn, opts);
    if (fn == null || (typeof opts === 'object' && opts?.once) || opts?.signal?.aborted) return;
    const key = `${type}|${capture(opts)}|${idOf(fn)}`;
    let keys = byTarget.get(this);
    if (!keys) {
      keys = new Map();
      byTarget.set(this, keys);
      targets.add(new WeakRef(this));
    }
    keys.set(key, { type, at: where() });
    opts?.signal?.addEventListener?.('abort', () => keys.delete(key), { once: true });
  };
  EventTarget.prototype.removeEventListener = function (type, fn, opts) {
    remove.call(this, type, fn, opts);
    byTarget.get(this)?.delete(`${type}|${capture(opts)}|${idOf(fn)}`);
  };
  const kindOf = (t) => {
    if (t === window) return 'window';
    if (t === document) return 'document';
    if (t === document.fonts) return 'fonts';
    if (t instanceof Node) return t.isConnected ? 'element' : null;
    return null;
  };
  const observers = new Set();
  for (const name of ['ResizeObserver', 'MutationObserver', 'IntersectionObserver']) {
    const Base = window[name];
    if (typeof Base !== 'function') continue;
    window[name] = class extends Base {
      constructor(...args) {
        super(...args);
        this.__targets = [];
        this.__kind = name;
        this.__at = where();
        observers.add(new WeakRef(this));
      }
      observe(target, ...rest) {
        this.__targets.push(new WeakRef(target));
        return super.observe(target, ...rest);
      }
      unobserve(target) {
        this.__targets = this.__targets.filter((r) => r.deref() !== target);
        return super.unobserve(target);
      }
      disconnect() {
        this.__targets = [];
        return super.disconnect();
      }
    };
  }
  const intervals = new Set();
  const setI = window.setInterval.bind(window);
  const clearI = window.clearInterval.bind(window);
  window.setInterval = (...args) => {
    const id = setI(...args);
    intervals.add(id);
    return id;
  };
  window.clearInterval = (id) => {
    intervals.delete(id);
    clearI(id);
  };
  window.__lifetimes = () => {
    const out = { window: 0, document: 0, fonts: 0, element: 0, observers: 0, intervals: intervals.size };
    const detail = {};
    for (const ref of targets) {
      const t = ref.deref();
      if (!t) {
        targets.delete(ref);
        continue;
      }
      const kind = kindOf(t);
      const keys = byTarget.get(t);
      if (!kind || !keys) continue;
      out[kind] += keys.size;
      const label = kind === 'element' ? `element ${t.tagName?.toLowerCase()}.${String(t.className?.baseVal ?? t.className ?? '').split(' ')[0]}` : kind;
      for (const { type, at } of keys.values()) detail[`${label} ${type} ${at}`] = (detail[`${label} ${type} ${at}`] ?? 0) + 1;
    }
    for (const ref of observers) {
      const o = ref.deref();
      if (!o) {
        observers.delete(ref);
        continue;
      }
      if (o.__targets.some((r) => r.deref()?.isConnected)) {
        out.observers += 1;
        detail[`observer ${o.__kind} ${o.__at}`] = (detail[`observer ${o.__kind} ${o.__at}`] ?? 0) + 1;
      }
    }
    return { counts: out, detail };
  };
}

async function withPage(fn) {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 1470, height: 900 } });
    await page.addInitScript(installCounter);
    await fn(page);
  } finally {
    await browser.close();
  }
}

/** Opens every kind in the first pane, then, for each, one beside it that is closed again. */
async function cycle(page) {
  await page.evaluate(async (order) => {
    const panes = window.__marxyHandle.panes();
    const quiet = () => new Promise((resolve) => setTimeout(resolve, 60));
    for (const path of order) {
      await panes.openIn(panes.panes[0].slot, path);
      await quiet();
    }
    for (const [i, path] of order.entries()) {
      await panes.openIn('other', path);
      await quiet();
      await panes.close(panes.panes[i % 2]);
      await quiet();
    }
    await panes.openIn(panes.panes[0].slot, order[0]);
    await new Promise((resolve) => setTimeout(resolve, 400));
  }, ORDER);
}

const counted = (page) => page.evaluate(() => window.__lifetimes());

/** Which lines of `detail` grew from `before` to `after`. */
function grown(before, after) {
  return Object.entries(after.detail)
    .filter(([key, n]) => n > (before.detail[key] ?? 0))
    .map(([key, n]) => `${key}: ${before.detail[key] ?? 0} -> ${n}`);
}

test('documents of every kind opened, split beside and closed leave no listener, observer or interval behind', async () => {
  await withPage(async (page) => {
    await bootTwoPanes(page, { files, open: [ORDER[0]] });
    // The first round is the warm-up: what a kind installs once for the app's life (a lazy module's listener) is in the baseline.
    await cycle(page);
    const before = await counted(page);
    for (let i = 0; i < 3; i++) await cycle(page);
    const afterCycles = await counted(page);
    console.log(`lifetimes after a warm-up: ${JSON.stringify(before.counts)}; after three more rounds: ${JSON.stringify(afterCycles.counts)}`);
    assert.deepEqual(afterCycles.counts, before.counts, `grew over three rounds of ${ORDER.length} documents:\n${grown(before, afterCycles).join('\n')}`);
  });
});

test('starting the app again leaves nothing of the first instance listening', async () => {
  await withPage(async (page) => {
    await bootTwoPanes(page, { files, open: [ORDER[0]] });
    const restart = () =>
      page.evaluate(async (path) => {
        const { startApp } = await import('/src/app.ts');
        const handle = await startApp(window.__marxyHandle.shell, { argv: [path] });
        await handle.ready;
        window.__marxyHandle = handle;
        await new Promise((resolve) => setTimeout(resolve, 400));
      }, ORDER[0]);
    await restart();
    const before = await counted(page);
    for (let i = 0; i < 3; i++) await restart();
    const afterRestarts = await counted(page);
    console.log(`lifetimes after a restart: ${JSON.stringify(before.counts)}; after three more: ${JSON.stringify(afterRestarts.counts)}`);
    assert.deepEqual(afterRestarts.counts, before.counts, `grew over three restarts:\n${grown(before, afterRestarts).join('\n')}`);
  });
});

test('the command keys, the verb bar and the palette chords go with the app that installed them', async () => {
  await withPage(async (page) => {
    await bootTwoPanes(page, { files, open: [ORDER[0]], full: true });
    const restart = () =>
      page.evaluate(async (path) => {
        const old = window.__marxyHandle;
        const { bootApplication } = await import('/src/main.ts');
        const handle = await bootApplication(old.shell, { argv: [path] });
        await handle.ready;
        window.__marxyHandle = handle;
        await new Promise((resolve) => setTimeout(resolve, 400));
      }, ORDER[0]);
    await restart();
    const before = await counted(page);
    const bars = () => page.evaluate(() => document.querySelectorAll('.marxy-verb-bar').length);
    for (let i = 0; i < 3; i++) await restart();
    const after = await counted(page);
    console.log(`lifetimes after a boot: ${JSON.stringify(before.counts)}; after three more: ${JSON.stringify(after.counts)}`);
    assert.deepEqual(after.counts, before.counts, `grew over three boots:\n${grown(before, after).join('\n')}`);
    assert.equal(await bars(), 1, 'one verb bar, not one per boot');
    const owners = ['parts/cursor.ts', 'parts/tree-folds.ts', 'viewers/keys.ts'];
    const held = (counted) => owners.filter((o) => Object.keys(counted.detail).some((key) => key.includes(o)));
    assert.deepEqual(held(after), owners, 'the parts cursor, the tree folds and the viewer keys are listening while the app runs');
    // Ended, the app answers no key: the palette's chord and the registry's keys are gone from the window.
    const reacts = await page.evaluate(async () => {
      window.__marxyHandle.destroy();
      const dialog = document.getElementById('marxy-palette');
      dialog?.close?.();
      const press = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, metaKey: true, bubbles: true, cancelable: true });
      window.dispatchEvent(press);
      await new Promise((resolve) => setTimeout(resolve, 100));
      return { opened: dialog?.open === true, prevented: press.defaultPrevented, bars: document.querySelectorAll('.marxy-verb-bar').length };
    });
    assert.deepEqual(reacts, { opened: false, prevented: false, bars: 0 }, 'a destroyed app still answered Mod+K or kept its verb bar');
    assert.deepEqual(held(await counted(page)), [], 'a destroyed app left the parts cursor, the tree folds or the viewer keys listening');
  });
});

/**
 * Whether each of `refs` (names to WeakRefs) is still held, after allocating until the collector has run. WebKit gives
 * a page no `gc()`; allocation provokes it, and `window.__probe`, made with the refs, shows that it ran. Null when it never did.
 */
async function heldAfterCollection(page) {
  return page.evaluate(async () => {
    const probe = window.__probe;
    const held = () => Object.values(window.__refs).some((ref) => ref.deref() !== undefined);
    // Until every ref has gone, or for long enough that one still held is held: JavaScriptCore scans the stack
    // conservatively, so one collection can keep an object a stale word points at.
    for (let round = 0; round < 150 && (probe.deref() !== undefined || held()); round++) {
      let junk = [];
      for (let i = 0; i < 200; i++) junk.push(new Array(100_000).fill(round));
      junk = null;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (probe.deref() !== undefined) return null;
    return Object.fromEntries(Object.entries(window.__refs).map(([name, ref]) => [name, ref.deref() !== undefined]));
  });
}

test('a closed pane\'s view, page and document, and a replaced document, can be collected', async (t) => {
  await withPage(async (page) => {
    await bootTwoPanes(page, { files, open: [ORDER[0]] });
    await page.evaluate(async (order) => {
      const panes = window.__marxyHandle.panes();
      // Made with the refs, so its going shows a collection that reached objects as old as theirs.
      window.__probe = new WeakRef({ probe: true });
      window.__refs = {};
      // A page and a viewer (an archive's), each in a pane that is closed.
      for (const [name, path] of [['page', order[1]], ['viewer', '/r/j.tar.gz']]) {
        await panes.openIn('other', path);
        const closing = panes.panes[1];
        Object.assign(window.__refs, {
          [`${name} view`]: new WeakRef(closing.view),
          [`${name} article`]: new WeakRef(closing.article),
          ...(name === 'page' ? { [`${name} document`]: new WeakRef(closing.view.store()) } : { [`${name} itself`]: new WeakRef(closing.view.viewer()) }),
        });
        await panes.close(closing);
      }
      // The first pane's own document replaced by others, each of another kind.
      window.__refs.replaced = new WeakRef(panes.panes[0].view.store());
      for (const path of order.slice(2, 6)) await panes.openIn(panes.panes[0].slot, path);
      await new Promise((resolve) => setTimeout(resolve, 400));
    }, ORDER);
    const held = await heldAfterCollection(page);
    if (held === null) return t.skip('the collector did not run under allocation here');
    assert.deepEqual(held, Object.fromEntries(Object.keys(held).map((name) => [name, false])), `still held: ${Object.keys(held).filter((name) => held[name]).join(', ')}`);
  });
});

