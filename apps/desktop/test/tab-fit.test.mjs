// The tab row fits by fair share: nothing is cut while the names fit; past that every cut tab is one width and
// pressing a tab moves no other; the wheel scrolls the strip, the door counts the tabs out of view, two files of
// one name say their folders, a dragged tab shows where it lands, and a closed tab comes back. Playwright WebKit.
import { strict as assert } from 'node:assert';
import { after, test as nodeTest } from 'node:test';
import { closeHarness } from './support/two-pane.mjs';
import { skip, withFrame } from './support/frame.mjs';

const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);
after(() => closeHarness());

const doc = (name) => `# ${name}\n\nSome words.\n`;
const LONG = [
  '/w/2026-10-01-quarterly-database-migration-readiness-review.md',
  '/w/auth-refactor-handoff.md',
  '/w/release-0.5-handoff.md',
  '/w/build-2026-10-14.log',
  '/w/meeting-2026-10-13.md',
  '/w/on-the-measure.md',
  '/w/fix-refresh-header.patch',
  '/w/2026-10-13-deploy.txt',
  '/w/2026-10-14.md',
  '/w/tide-table.txt',
  '/w/p95-latency.csv',
  '/w/release.json',
  '/w/ci.yaml',
  '/w/pg16-upgrade-plan.md',
];
const files = (list) => Object.fromEntries(list.map((p) => [p, doc(p)]));
const openHere = (page, path) => page.evaluate((p) => window.__marxyHandle.open(p), path);
const settle = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 120)))));

async function openAll(page, list) {
  for (const p of list.slice(1)) await openHere(page, p);
  await page.waitForFunction((n) => document.querySelectorAll('.marxy-tabbar .marxy-tab').length === n, list.length);
  await page.mouse.move(600, 500);
  await settle(page);
}

const row = (page) =>
  page.evaluate(() => {
    const strip = document.querySelector('.marxy-tabbar .marxy-tabs').getBoundingClientRect();
    return [...document.querySelectorAll('.marxy-tabbar .marxy-tab')].map((t) => {
      const r = t.getBoundingClientRect();
      const name = t.querySelector('.marxy-tab-name');
      const head = name.querySelector('.marxy-tab-head');
      return {
        path: t.dataset.marxyTabPath,
        text: name.textContent,
        cut: name.hasAttribute('data-marxy-cut'),
        overflows: name.scrollWidth > name.clientWidth + 1,
        head: head?.textContent ?? null,
        tail: name.querySelector('.marxy-tab-tail')?.textContent ?? null,
        left: r.left,
        width: r.width,
        inView: r.left >= strip.left - 1 && r.right <= strip.right + 1,
      };
    });
  });

test('no name is cut while the names fit', async () => {
  const list = ['/s/Alpha.md', '/s/release-0.5-handoff.md', '/s/2026-10-01-quarterly-planning-review.md', '/s/ملاحظات.md'];
  await withFrame({ files: files(list), open: [list[0]], viewport: { width: 1280, height: 800 } }, async (page) => {
    await openAll(page, list);
    for (const t of await row(page)) {
      assert.equal(t.cut, false, `${t.text} is not cut`);
      assert.equal(t.overflows, false, `${t.text} is drawn whole`);
      assert.equal(t.inView, true);
    }
    assert.equal(await page.isVisible('.marxy-tabbar .marxy-tabs-all'), false, 'no door while every tab is in view');
  });
});

test('past the room, every cut tab is one width, its whole name still its text, its tail kept whole', async () => {
  await withFrame({ files: files(LONG), open: [LONG[0]], viewport: { width: 1024, height: 768 } }, async (page) => {
    await openAll(page, LONG);
    const tabs = await row(page);
    const cut = tabs.filter((t) => t.cut);
    assert.ok(cut.length >= 4, `some names are cut: ${JSON.stringify(tabs.map((t) => t.text))}`);
    const width = cut[0].width;
    for (const t of cut) assert.ok(Math.abs(t.width - width) < 0.6, `${t.text} is ${t.width}px, not ${width}px`);
    for (const t of tabs) {
      assert.equal(t.text, t.path.slice(3), 'the name holds the whole file name');
      if (t.cut) assert.equal(t.head + t.tail, t.text, 'head and tail join to the whole name');
      // A tab narrower than the common width keeps its own width: it is not cut.
      if (!t.cut) assert.ok(t.width <= width + 0.6, `${t.text} (${t.width}px) is no wider than the cut ones`);
    }
    const extended = cut.filter((t) => /\.[a-z0-9]{1,5}$/.test(t.text) && t.tail !== '');
    for (const t of extended) assert.ok(t.tail.endsWith(t.text.slice(t.text.lastIndexOf('.'))), `${t.text}: the extension stays whole in ${t.tail}`);
    // The ellipsis touches the tail: the head box ends where its last glyph and the ellipsis do.
    const air = await page.evaluate(() =>
      [...document.querySelectorAll('.marxy-tabbar .marxy-tab-name[data-marxy-cut]')].map((n) => {
        const headEl = n.querySelector('.marxy-tab-head');
        // An unseen head (a start shared with another name): the tail, led by its ellipsis, starts the name.
        const head = headEl.classList.contains('marxy-tab-nohead') ? { right: n.getBoundingClientRect().left } : headEl.getBoundingClientRect();
        const tail = n.querySelector('.marxy-tab-tail').getBoundingClientRect();
        return tail.left - head.right;
      }),
    );
    for (const gap of air) assert.ok(Math.abs(gap) < 0.5, `no air between the head and its tail: ${air}`);
  });
});

test('pressing another tab moves no tab', async () => {
  await withFrame({ files: files(LONG), open: [LONG[0]], viewport: { width: 1440, height: 800 } }, async (page) => {
    await openAll(page, LONG.slice(0, 9));
    const before = await row(page);
    const target = before.find((t) => t.inView && t.path !== LONG[8] && t.cut) ?? before.find((t) => t.inView && t.path !== LONG[8]);
    await page.click(`.marxy-tabbar .marxy-tab[data-marxy-tab-path="${target.path}"] .marxy-tab-open`);
    await page.waitForFunction((p) => window.__marxyHandle.panes().focused.path() === p, target.path);
    await page.mouse.move(600, 500);
    await settle(page);
    const now = await row(page);
    for (const [i, t] of before.entries()) {
      assert.ok(Math.abs(now[i].left - t.left) < 0.6 && Math.abs(now[i].width - t.width) < 0.6, `${t.text}: ${t.left}+${t.width} became ${now[i].left}+${now[i].width}`);
    }
  });
});

test('the wheel over the row scrolls the strip, never the page; the door counts the tabs out of view and lists folders', async () => {
  await withFrame({ files: files(LONG), open: [LONG[0]], viewport: { width: 760, height: 700 } }, async (page) => {
    await openAll(page, LONG);
    const state = () =>
      page.evaluate(() => {
        const strip = document.querySelector('.marxy-tabbar .marxy-tabs');
        const r = strip.getBoundingClientRect();
        const out = [...strip.querySelectorAll('.marxy-tab')].filter((t) => {
          const b = t.getBoundingClientRect();
          return b.left < r.left - 1 || b.right > r.right + 1;
        }).length;
        return { left: strip.scrollLeft, out, count: document.querySelector('.marxy-tabs-all-n').textContent, page: window.scrollY, fade: [strip.style.getPropertyValue('--lb-fade-start'), strip.style.getPropertyValue('--lb-fade-end')] };
      });
    assert.equal(await page.isVisible('.marxy-tabbar .marxy-tabs-all'), true, 'the door shows while tabs are out of view');
    const at = await state();
    assert.equal(at.count, String(at.out), 'the door says how many tabs are not wholly in view');
    const box = await page.locator('.marxy-tabbar .marxy-tabs').boundingBox();
    await page.mouse.move(box.x + 40, box.y + box.height / 2);
    await page.mouse.wheel(0, -3000);
    await settle(page);
    const start = await state();
    assert.equal(start.left, 0);
    assert.deepEqual(start.fade, ['0px', '24px'], 'only the edge with tabs beyond it fades');
    await page.mouse.wheel(0, 200);
    await settle(page);
    const moved = await state();
    assert.ok(moved.left > 0, 'a vertical wheel scrolls the strip sideways');
    assert.equal(moved.page, start.page, 'the page under the row stays');
    assert.deepEqual(moved.fade, ['24px', '24px']);
    assert.equal(moved.count, String(moved.out));
    await page.click('.marxy-tabbar .marxy-tabs-all');
    await page.waitForSelector('.marxy-verb-menu');
    const listed = await page.$$eval('.marxy-verb-menu [role="menuitem"]', (els) => els.map((e) => e.textContent));
    assert.equal(listed.length, LONG.length, 'the door lists every tab');
    assert.ok(listed.every((t) => t.includes('w')), `each with its folder: ${listed.join(' | ')}`);
    await page.keyboard.press('Escape');
  });
});

test('two open files of one name each say the folders that tell them apart, after the name', async () => {
  const list = ['/p/docs/README.md', '/p/api/docs/README.md', '/p/notes.md'];
  await withFrame({ files: files(list), open: [list[0]] }, async (page) => {
    await openAll(page, list);
    const got = await page.$$eval('.marxy-tabbar .marxy-tab', (tabs) => tabs.map((t) => [t.querySelector('.marxy-tab-name').textContent, t.querySelector('.marxy-tab-where')?.textContent ?? null]));
    assert.deepEqual(got, [['README.md', 'p/docs'], ['README.md', 'api/docs'], ['notes.md', null]]);
  });
});

test('a dragged tab shows where it would land, and the mark goes on drop', async () => {
  const list = ['/r/A.md', '/r/B.md', '/r/C.md'];
  await withFrame({ files: files(list), open: [list[0]] }, async (page) => {
    await openAll(page, list);
    const mark = await page.evaluate(() => {
      const dt = new DataTransfer();
      const tabs = document.querySelectorAll('.marxy-tabbar .marxy-tab');
      tabs[2].dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
      const box = tabs[0].getBoundingClientRect();
      tabs[0].dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: box.left + 3, clientY: box.top + 6 }));
      const drop = document.querySelector('.marxy-tab-drop');
      const shown = !drop.hidden;
      const at = drop.getBoundingClientRect().left + 1 - box.left;
      tabs[0].dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: box.left + 3, clientY: box.top + 6 }));
      tabs[2].dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
      return { shown, at, after: !document.querySelector('.marxy-tab-drop').hidden };
    });
    assert.equal(mark.shown, true, 'the mark shows while dragging');
    assert.ok(Math.abs(mark.at) <= 2, `at the first tab's left edge (${mark.at})`);
    assert.equal(mark.after, false, 'and goes on drop');
  });
});

test('Reopen brings the closed tab back where it was, by its chord and in a tab\'s menu', async () => {
  const list = ['/r/A.md', '/r/B.md', '/r/C.md', '/r/D.md'];
  await withFrame({ files: files(list), open: [list[0]] }, async (page, { mod }) => {
    await openAll(page, list);
    const names = () => page.$$eval('.marxy-tabbar .marxy-tab .marxy-tab-name', (els) => els.map((e) => e.textContent));
    await page.click('.marxy-tabbar .marxy-tab[data-marxy-tab-path="/r/B.md"]', { button: 'right' });
    await page.waitForSelector('.marxy-verb-menu');
    const before = await page.$$eval('.marxy-verb-menu [role="menuitem"]', (els) => els.map((e) => e.textContent));
    assert.ok(before.some((t) => t.startsWith('Close the tabs to the right')));
    assert.ok(!before.some((t) => t.startsWith('Reopen')), 'nothing to reopen yet');
    await page.keyboard.press('Escape');
    await page.hover('.marxy-tabbar .marxy-tab[data-marxy-tab-path="/r/B.md"]');
    await page.click('.marxy-tabbar .marxy-tab[data-marxy-tab-path="/r/B.md"] .marxy-tab-close');
    await page.waitForFunction(() => document.querySelectorAll('.marxy-tabbar .marxy-tab').length === 3);
    await page.mouse.move(600, 500);
    await page.keyboard.press(`${mod}+Shift+KeyT`);
    await page.waitForFunction(() => window.__marxyHandle.panes().focused.path() === '/r/B.md');
    await page.waitForFunction(() => document.querySelectorAll('.marxy-tabbar .marxy-tab').length === 4);
    assert.deepEqual(await names(), ['A.md', 'B.md', 'C.md', 'D.md'], 'in its old place');
    // Close the tabs to the right of A, then reopen from A's menu: the newest closed comes back first.
    await page.click('.marxy-tabbar .marxy-tab[data-marxy-tab-path="/r/A.md"]', { button: 'right' });
    await page.waitForSelector('.marxy-verb-menu');
    await page.click('.marxy-verb-menu [role="menuitem"]:has-text("Close the tabs to the right")');
    await page.waitForFunction(() => document.querySelectorAll('.marxy-tabbar .marxy-tab').length === 1);
    await page.click('.marxy-tabbar .marxy-tab[data-marxy-tab-path="/r/A.md"]', { button: 'right' });
    await page.waitForSelector('.marxy-verb-menu');
    await page.click('.marxy-verb-menu [role="menuitem"]:has-text("Reopen the closed tab")');
    await page.waitForFunction(() => document.querySelectorAll('.marxy-tabbar .marxy-tab').length === 2);
    assert.equal((await names()).length, 2);
  });
});
