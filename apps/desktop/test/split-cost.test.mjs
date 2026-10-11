// What two panes cost (D-14; docs/research/audit-2026-10/05-performance-audit.md §11.4, ADR-0032).
// The assertions here are the ones a slow runner cannot flake: a count of typesetters and observers after
// twenty split-and-close cycles, one parse and one store for the same file twice, two panes' background
// passes not starving each other, and the left pane's viewport typeset not run again when the right opens.
// The numbers (split_open, each pane's typeset_viewport, the longest frame while the second pane opens) are
// printed and never judged: ADR-0032 puts timing in the nightly record, and the report-back thresholds of
// 04-phase-d.md D-14 are read by a person. Booted on the shipped skeleton over the memory shell
// (test/support/two-pane.mjs); the large files are generated here from corpus text and not committed.
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { after, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { generateLarge } from '../../../scripts/perf-harness.mjs';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { bootTwoPanes, closeHarness } from './support/two-pane.mjs';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip, timeout: 600_000 }, fn);
after(() => closeHarness());

const corpus = (name) => readFileSync(new URL(`../../../fixtures/corpus/${name}`, import.meta.url), 'utf8');
const SMALL = corpus('01-long-technical.md'); // 20,378 bytes
const SECOND = corpus('16-api-reference.md');
const toText = (bytes) => Buffer.from(bytes).toString('utf8');
const files = {
  '/r/small.md': SMALL,
  '/r/other.md': SECOND,
  '/r/a.md': `# A\n\n${'The first document of a pair. '.repeat(40)}\n`,
  '/r/b.md': `# B\n\n${'The second document of a pair. '.repeat(40)}\n`,
  '/r/c.md': `# C\n\n${'The third document of a pair. '.repeat(40)}\n`,
};
const RUNS = Math.max(1, Number.parseInt(process.env.MARXY_COST_RUNS ?? '', 10) || 5);

async function withPage(fn, viewport = { width: 1470, height: 900 }) {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport });
    await fn(page);
  } finally {
    await browser.close();
  }
}

const marks = (page, name) =>
  page.evaluate((n) => window.__marxyHandle.shell.calls.filter((c) => c.method === 'mark' && c.args[0] === n).map((c) => c.args[2] ?? ''), name);
const settle = (page, ms = 400) => page.waitForTimeout(ms);

test('twenty open-split-close cycles leave one typesetter and one observer per pane, never a leaked one', async () => {
  await withPage(async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/small.md'] });
    const seen = await page.evaluate(async () => {
      const handle = window.__marxyHandle;
      const panes = handle.panes();
      const out = [handle.debugCounts()];
      for (let i = 0; i < 20; i++) {
        await panes.openIn('other', i % 2 === 0 ? '/r/other.md' : '/r/a.md');
        out.push({ ...handle.debugCounts(), panes: panes.panes.length });
        // Alternate which pane goes: the left (the survivor becomes the first pane) and the right.
        await panes.close(panes.panes[i % 4 < 2 ? 1 : 0]);
        await new Promise((resolve) => setTimeout(resolve, 0));
        out.push({ ...handle.debugCounts(), panes: panes.panes.length });
      }
      return out;
    });
    assert.deepEqual(seen[0], { typesetters: 1, resizeObservers: 1 });
    for (const [i, s] of seen.slice(1).entries()) {
      const want = i % 2 === 0 ? 2 : 1;
      assert.deepEqual(
        { typesetters: s.typesetters, resizeObservers: s.resizeObservers, panes: s.panes },
        { typesetters: want, resizeObservers: want, panes: want },
        `step ${i} (${i % 2 === 0 ? 'split' : 'closed'}): ${JSON.stringify(s)}`,
      );
    }
    // The same cycles with the same file in both panes: the store is shared, the views are not.
    const same = await page.evaluate(async () => {
      const handle = window.__marxyHandle;
      const panes = handle.panes();
      const out = [];
      for (let i = 0; i < 20; i++) {
        await panes.openIn('other', handle.currentPath());
        out.push({ split: handle.debugCounts() });
        await panes.close(panes.panes[i % 2]);
        await new Promise((resolve) => setTimeout(resolve, 0));
        out.push({ closed: handle.debugCounts() });
      }
      return out;
    });
    for (const [i, s] of same.entries()) {
      const want = i % 2 === 0 ? 2 : 1;
      assert.deepEqual(Object.values(s)[0], { typesetters: want, resizeObservers: want }, `same-file step ${i}: ${JSON.stringify(s)}`);
    }
  });
});

test('the same file twice is one parse and one store', async () => {
  await withPage(async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/small.md'] });
    const before = (await marks(page, 'parsed')).length;
    assert.equal(before, 1);
    await page.evaluate(() => window.__marxyHandle.panes().openIn('other', '/r/small.md'));
    await settle(page);
    const state = await page.evaluate(() => {
      const [a, b] = window.__marxyHandle.panes().panes;
      const calls = window.__marxyHandle.shell.calls;
      return {
        same: a.view.store() === b.view.store(),
        parsed: calls.filter((c) => c.method === 'mark' && c.args[0] === 'parsed').length,
        paths: [a.path(), b.path()],
      };
    });
    assert.deepEqual(state, { same: true, parsed: 1, paths: ['/r/small.md', '/r/small.md'] });
  });
});

test('the right pane opening does not run the left pane\'s viewport typeset again, and each pane typesets its own once', async () => {
  await withPage(async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/small.md'] });
    await page.waitForFunction(() => window.__marxyHandle.shell.calls.some((c) => c.method === 'mark' && c.args[0] === 'typeset_done'));
    assert.equal((await marks(page, 'typeset_viewport')).length, 1);
    await page.evaluate(() => window.__marxyHandle.panes().openIn('other', '/r/other.md'));
    await page.waitForFunction(() => window.__marxyHandle.shell.calls.filter((c) => c.method === 'mark' && c.args[0] === 'typeset_viewport').length >= 2);
    await settle(page, 1500);
    assert.equal((await marks(page, 'typeset_viewport')).length, 2, 'one viewport typeset per pane: the left was not re-run by the right opening');
    assert.equal((await marks(page, 'typeset_done')).length, 2);
    // Resizing the divider is the left pane's own relayout, not a new viewport typeset either.
    await page.evaluate(() => window.__marxyHandle.commands().find((c) => c.id === 'view.split-wider').run({}));
    await settle(page, 600);
    assert.equal((await marks(page, 'typeset_viewport')).length, 2);
  });
});

test('two panes\' grid snap timers do not starve each other: both panes are put back on the grid after each is knocked off it, with the other scheduling snaps every frame', async () => {
  const code = (n) => `\`\`\`js\nconst value${n} = ${n};\nfunction f${n}(x) { return x + ${n}; }\n\`\`\`\n`;
  const prose = (w, i) => `${w} paragraph ${i} runs long enough to wrap across several lines of the column, so that the typesetter has real lines to set. `.repeat(3);
  const doc = (w) => `# ${w}\n\n${Array.from({ length: 40 }, (_, i) => (i % 5 === 0 ? code(i) : `${prose(w, i)}\n`)).join('\n')}`;
  const offGrid = () =>
    window.__marxyHandle.panes().panes.map((pane) => {
      const article = pane.article;
      const unit = parseFloat(getComputedStyle(article).lineHeight) / 2;
      const origin = article.getBoundingClientRect().top;
      let bad = 0;
      for (const el of article.querySelectorAll('[data-marxy-s]')) {
        if (!['block', 'table', 'list-item', 'flow-root'].includes(getComputedStyle(el).display)) continue;
        const r = (((el.getBoundingClientRect().top - origin) % unit) + unit) % unit;
        if (r > 0.5 && r < unit - 0.5) bad++;
      }
      return bad;
    });
  await withPage(async (page) => {
    await bootTwoPanes(page, { files: { '/r/l.md': doc('Left'), '/r/r.md': doc('Right') }, open: ['/r/l.md', '/r/r.md'] });
    await page.waitForFunction(() => window.__marxyHandle.shell.calls.filter((c) => c.method === 'mark' && c.args[0] === 'typeset_done').length >= 2);
    // The first fences coloured first: a late highlight snaps its pane by another road, and would hide a starved timer.
    await page.waitForFunction(() =>
      window.__marxyHandle.panes().panes.every((pane) => {
        // The fences in reach of the first screens: the app colours those and leaves the rest until they are near.
        const fences = [...pane.article.querySelectorAll('pre > code.language-js')].slice(0, 1);
        return fences.length === 1 && fences.every((c) => c.dataset.marxyDone === 'highlight');
      }), null, { timeout: 30_000 });
    await settle(page, 800);
    assert.deepEqual(await page.evaluate(offGrid), [0, 0], 'both panes start on the grid');
    // Knock both off the grid with a 7px spacer, then ask for a snap the way a late-loading face does
    // (every view's own `loadingdone` listener schedules one), and keep the faces "loading" every frame for
    // a second so a timer shared between the views, or cancelled by the other's, would never fire.
    const knocked = await page.evaluate(
      async (offGridSource) => {
        const probe = new Function(`return (${offGridSource})`)();
        for (const pane of window.__marxyHandle.panes().panes) {
          const spacer = document.createElement('div');
          spacer.style.cssText = 'height:7px';
          spacer.dataset.spacer = '1';
          pane.article.insertBefore(spacer, pane.article.children[2]);
        }
        const off = probe();
        const end = performance.now() + 1000;
        while (performance.now() < end) {
          document.fonts.dispatchEvent(new Event('loadingdone'));
          await new Promise((r) => requestAnimationFrame(r));
        }
        return off;
      },
      offGrid.toString(),
    );
    assert.ok(knocked.every((n) => n > 0), `the spacer put blocks off the grid in both panes: ${knocked}`);
    await settle(page, 800);
    assert.deepEqual(await page.evaluate(offGrid), [0, 0], 'each pane\'s own snap ran and put its blocks back on the grid');
  });
});

/**
 * One measured open: a small document in the left pane, `other` opened beside it. Returns the numbers the
 * card asks for. The frame gap is the longest rAF-to-rAF interval from the command to two frames after the
 * second pane's first text, so a parse of the large file that blocked the page shows as one long frame.
 */
async function measurePair(name, text) {
  const result = {};
  await withPage(async (page) => {
    await bootTwoPanes(page, { files: { '/r/small.md': SMALL, '/r/big.md': text }, open: ['/r/small.md'] });
    await page.waitForFunction(() => window.__marxyHandle.shell.calls.some((c) => c.method === 'mark' && c.args[0] === 'typeset_done'));
    result.left = (await marks(page, 'typeset_viewport'))[0];
    await settle(page, 300);
    result.gap = await page.evaluate(async () => {
      let last = performance.now();
      let max = 0;
      let running = true;
      const tick = (t) => {
        max = Math.max(max, t - last);
        last = t;
        if (running) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      await window.__marxyHandle.panes().openIn('other', '/r/big.md');
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      running = false;
      return max;
    });
    await page.waitForFunction(() => window.__marxyHandle.shell.calls.filter((c) => c.method === 'mark' && c.args[0] === 'typeset_viewport').length >= 2, null, { timeout: 60_000 });
    const open = (await marks(page, 'split_open'))[0] ?? '';
    const right = (await marks(page, 'typeset_viewport'))[1] ?? '';
    result.splitOpen = Number(/ms=([\d.]+)/.exec(open)?.[1]);
    result.right = Number(/ms=([\d.]+)/.exec(right)?.[1]);
    result.leftMs = Number(/ms=([\d.]+)/.exec(result.left)?.[1]);
    assert.equal((await marks(page, 'typeset_viewport')).length, 2, `${name}: the left pane's viewport typeset was not run again`);
  });
  return result;
}

const median = (values) => {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  return v.length === 0 ? Number.NaN : v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
};

test('records split_open, each pane\'s typeset_viewport and the longest frame for a 20 KB pair, 20 KB + 256 KB and 20 KB + 1 MB (printed, not judged)', async () => {
  const pairs = [
    ['20 KB + 20 KB', SMALL],
    ['20 KB + 256 KB', toText(generateLarge(256 * 1024))],
    ['20 KB + 1 MB', toText(generateLarge(1024 * 1024))],
  ];
  const runs = new Map(pairs.map(([name]) => [name, []]));
  // Interleaved: run 1 of every pair, then run 2 of every pair, so drift in the machine is spread across them.
  for (let run = 1; run <= RUNS; run++) {
    for (const [name, text] of pairs) runs.get(name).push(await measurePair(name, text));
  }
  for (const [name] of pairs) {
    const rs = runs.get(name);
    const m = (key) => median(rs.map((r) => r[key]));
    for (const [i, r] of rs.entries()) {
      console.log(`split_cost ${name} run ${i + 1}: split_open ms=${r.splitOpen} left typeset_viewport ms=${r.leftMs} right typeset_viewport ms=${r.right} longest frame ms=${r.gap.toFixed(1)}`);
    }
    console.log(
      `split_cost ${name} median of ${RUNS}: split_open ms=${m('splitOpen').toFixed(1)} left typeset_viewport ms=${m('leftMs').toFixed(1)} right typeset_viewport ms=${m('right').toFixed(1)} longest frame ms=${m('gap').toFixed(1)}`,
    );
    assert.ok(rs.every((r) => Number.isFinite(r.splitOpen) && Number.isFinite(r.right)), `${name}: every run reported split_open and the second pane's typeset_viewport`);
  }
});
