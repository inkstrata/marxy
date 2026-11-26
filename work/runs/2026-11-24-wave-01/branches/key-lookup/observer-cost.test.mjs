// Reviewer's measurement: what the reading-root observer in parts/reading-parts.ts is handed and what it costs across an
// open of the 195 KB reference page, then six `j` presses. Run from the worktree root:
//   node scripts/browser-tests.mjs --jobs 1 C:/Dev/reader/work/wave1/key-lookup/observer-cost.test.mjs
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
const WT = 'file:///C:/Dev/reader/worktrees/key-lookup/';
const { launchWebkit } = await import(`${WT}scripts/playwright-webkit.mjs`);
const { bootTwoPanes, closeHarness } = await import(`${WT}apps/desktop/test/support/two-pane.mjs`);

const LONG = readFileSync(new URL(`${WT}fixtures/corpus/32-long-reference.md`), 'utf8');

test('observer cost over an open of the long reference', { timeout: 300_000 }, async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.addInitScript(() => {
      const Orig = window.MutationObserver;
      const m = (window.__mo = { made: 0, calls: 0, records: 0, cbMs: 0, takes: 0, takeRecs: 0, takeMs: 0, maxCbMs: 0, allMade: 0 });
      window.MutationObserver = class extends Orig {
        constructor(cb) {
          const mine = /reading-parts/.test(new Error().stack ?? '');
          m.allMade++;
          if (!mine) {
            super(cb);
            return;
          }
          m.made++;
          super((rs, o) => {
            m.calls++;
            m.records += rs.length;
            // WebKit's clock is too coarse for one call: replay a copy of mayChangeRoot over the same records 50 times.
            const PAGE = '[data-marxy-reading], [data-marxy-derived], pre.language-log.marxy-run, pre.language-diff.marxy-run';
            const W = `${PAGE}, .marxy-part, pre[data-marxy-part]`;
            const may = (r) => {
              if (r.type === 'childList') {
                for (const n of r.addedNodes) if (n.nodeType === 1 && (n.matches(W) || n.querySelector(W) !== null)) return true;
                return false;
              }
              if (r.attributeName === 'class') {
                const t = r.target;
                return t.localName === 'pre' || (r.oldValue ?? '').split(/\s+/).includes('marxy-part') !== t.classList.contains('marxy-part');
              }
              return true;
            };
            const N = 50;
            const t = performance.now();
            for (let k = 0; k < N; k++) for (const r of rs) may(r);
            const d = (performance.now() - t) / N;
            m.cbMs += d;
            if (d > m.maxCbMs) m.maxCbMs = d;
            m.kinds ??= {};
            for (const r of rs) m.kinds[r.type + (r.attributeName ? ':' + r.attributeName : '')] = (m.kinds[r.type + (r.attributeName ? ':' + r.attributeName : '')] ?? 0) + 1;
            cb(rs, o);
          });
          this.__mine = true;
        }
        takeRecords() {
          if (!this.__mine) return super.takeRecords();
          const t = performance.now();
          const rs = super.takeRecords();
          m.takes++;
          m.takeRecs += rs.length;
          // The caller's `some(mayChangeRoot)` runs after this returns; its cost is timed by the readingRoot wrapper below.
          m.takeMs += performance.now() - t;
          return rs;
        }
      };
    });
    await bootTwoPanes(page, { files: { '/r/long.md': LONG }, open: ['/r/long.md'], full: true });
    const quiet = () =>
      page.evaluate(
        () =>
          new Promise((done) => {
            const a = document.querySelector('[data-marxy-pane="0"] .marxy-article');
            let q = 0;
            const obs = new MutationObserver(() => (q = 0));
            obs.observe(a, { childList: true, subtree: true, attributes: true });
            const tick = () => (++q >= 30 ? (obs.disconnect(), done()) : requestAnimationFrame(tick));
            requestAnimationFrame(tick);
          }),
      );
    await quiet();
    const open = await page.evaluate(() => ({ ...window.__mo, nodes: document.querySelector('[data-marxy-pane="0"] .marxy-article').getElementsByTagName('*').length }));
    await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
    for (let i = 0; i < 6; i++) await page.keyboard.press('j');
    await quiet();
    const keys = await page.evaluate(() => ({ ...window.__mo }));
    const scan = await page.evaluate(() => {
      const a = document.querySelector('[data-marxy-pane="0"] .marxy-article');
      const PAGE = '[data-marxy-reading], [data-marxy-derived], pre.language-log.marxy-run, pre.language-diff.marxy-run';
      const t = performance.now();
      for (let k = 0; k < 50; k++) for (const el of a.querySelectorAll(PAGE)) el.closest('.marxy-part, pre[data-marxy-part]');
      return (performance.now() - t) / 50;
    });
    console.log('ONE OLD SCAN ms', scan);
    console.log('AFTER OPEN', JSON.stringify(open));
    console.log('AFTER 6 j', JSON.stringify(keys));
  } finally {
    await browser.close();
    await closeHarness();
  }
});
