// A tab's name: one that does not fit is cut in its head and keeps its tail (`cutName` in
// frame/tabs.ts, `data-marxy-cut`), so names that differ at their end stay apart; the name is still one run of text, and
// the tab's title is its path. In the unfolded window (the real app, shipped CSS, WebKit).
import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { after, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { bootTwoPanes, closeHarness } from './support/two-pane.mjs';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);
after(() => closeHarness());

const dated = Array.from({ length: 12 }, (_, i) => `/q/2026-10-01-quarterly-planning-review-draft-${i + 1}.md`);
const files = (list) => Object.fromEntries(list.map((p, i) => [p, `# T${i}\n\nbody\n`]));

async function withRow(list, fn, width = 1400) {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await bootTwoPanes(page, { files: files(list), open: [list[0]] });
    await page.evaluate(() => window.__marxyHandle.frame().unfold());
    for (const p of list.slice(1)) {
      await page.evaluate((p) => window.__marxyHandle.open(p), p);
      await page.evaluate(() => new Promise((r) => setTimeout(r, 40)));
    }
    await page.evaluate(() => new Promise((r) => setTimeout(r, 200)));
    await page.mouse.move(5, 500);
    await fn(page);
  } finally {
    await browser.close();
  }
}

/** Each tab of the first pane's row: its path, its name's text, whether it is cut and whether its text overflows. */
const names = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('.marxy-tabbar .marxy-tab')].map((t) => {
      const n = t.querySelector('.marxy-tab-name');
      return {
        path: t.getAttribute('data-marxy-tab-path'),
        title: t.title,
        text: n.textContent,
        label: t.querySelector('.marxy-tab-open').textContent,
        cut: n.hasAttribute('data-marxy-cut'),
        overflows: (() => {
          const h = n.querySelector('.marxy-tab-head') ?? n;
          // A head that would show only a start shared with another name is not drawn at all (`…draft-12.md`).
          return h.classList.contains('marxy-tab-nohead') || h.scrollWidth > h.clientWidth + 1;
        })(),
        tail: n.querySelector('.marxy-tab-tail')?.textContent ?? '',
      };
    }),
  );

test('a long name is cut in its head, its tail kept, and its whole name and path are still the tab\'s', async () => {
  await withRow(dated, async (page) => {
    const tabs = await names(page);
    assert.equal(tabs.length, 12);
    const cut = tabs.filter((t) => t.cut);
    assert.ok(cut.length > 0, 'the dated names do not fit a tab');
    assert.equal(new Set(cut.map((t) => t.tail)).size, cut.length, 'each cut name keeps the end that tells it apart');
    for (const t of tabs) {
      assert.equal(t.cut, t.overflows, `${t.path}: cut exactly when the name does not fit`);
      assert.equal(t.text, t.path.slice(t.path.lastIndexOf('/') + 1), 'the name holds the whole file name, one run, for a copy or a screen reader');
      assert.ok(t.title.startsWith(t.path), `the tab's title is its path: ${t.title}`);
    }
  });
});

test('a name that fits is drawn whole and not cut, at 1400 and 1000 px', async () => {
  for (const width of [1400, 1000]) {
    await withRow(['/s/Alpha.md', '/s/Bravo Tango.md', '/s/ملاحظات.md'], async (page) => {
      const tabs = await names(page);
      assert.equal(tabs.length, 3);
      for (const t of tabs) assert.deepEqual([t.cut, t.overflows], [false, false], `${width}: ${t.text}`);
    }, width);
  }
});

const tabBoxes = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('.marxy-tab')].map((t) => {
      const r = t.getBoundingClientRect();
      return {
        path: t.getAttribute('data-marxy-tab-path'),
        left: r.left,
        width: r.width,
        // The window's one row: the focused pane's tab is the current one.
        active: t.getAttribute('aria-selected') === 'true',
        dot: t.querySelector('.marxy-tab-close')?.hasAttribute('data-marxy-dirty') ?? false,
      };
    }),
  );

// A tab is dirty only while a pane holds its document, so the two tabs to compare are the pane in focus (the active tab) and the
// pane beside it (an inactive one). Leaving a dirty document asks first, which is why the test does not click between tabs.
test('a tab is as wide, and its neighbours as far along, dirty as clean, active or not', async () => {
  for (const list of [['/s/Alpha.md', '/s/Bravo Tango.md'], dated.slice(0, 2)]) {
    const browser = await launchWebkit();
    try {
      const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
      await bootTwoPanes(page, { files: files(list), open: list });
      await page.evaluate(() => window.__marxyHandle.frame().unfold());
      await page.mouse.move(5, 500);
      await page.evaluate(() => new Promise((r) => setTimeout(r, 250)));
      const mod = (await page.evaluate(() => navigator.platform)) === 'MacIntel' ? 'Meta' : 'Control';
      const focusSlot = async (slot) => {
        await page.keyboard.press(`${mod}+Alt+Arrow${slot === 1 ? 'Right' : 'Left'}`);
        await page.waitForFunction((s) => window.__marxyHandle.panes().focused.slot === s, slot);
        await page.mouse.move(5, 500);
        await page.evaluate(() => new Promise((r) => setTimeout(r, 250)));
      };
      const typeInFocused = () =>
        page.evaluate(async () => {
          const h = window.__marxyHandle;
          const snap = h.panes().focused.content.store().snapshot();
          const end = snap.buffer.bytes.length;
          await h.dispatch({ type: 'apply', range: { start: end, end }, replacement: 'x', label: 'type', baseVersion: snap.version });
        });
      // The same tab is active when clean and when dirty, so only the dot differs between the two measures.
      await focusSlot(1);
      const clean = await tabBoxes(page);
      assert.equal(clean.length, 2);
      assert.ok(clean.every((t) => !t.dot), 'no tab is dirty yet');
      await typeInFocused();
      await focusSlot(0);
      await typeInFocused();
      await focusSlot(1);
      await page.evaluate(() => new Promise((r) => setTimeout(r, 250)));
      const dirty = await tabBoxes(page);
      assert.ok(dirty.every((t) => t.dot), `every tab shows its dot: ${JSON.stringify(dirty)}`);
      assert.ok(dirty.some((t) => t.active) && dirty.some((t) => !t.active), 'one active tab, one not');
      for (const [i, c] of clean.entries()) {
        assert.ok(Math.abs(dirty[i].width - c.width) < 0.01, `${c.path} is ${c.width}px clean and ${dirty[i].width}px dirty`);
        assert.ok(Math.abs(dirty[i].left - c.left) < 0.01, `${c.path} starts at ${c.left}px clean and ${dirty[i].left}px dirty`);
      }
    } finally {
      await browser.close();
    }
  }
});
