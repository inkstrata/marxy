// The Outline of a Markdown file with thousands of headings: only the rows near the panel's view are drawn, the panel's
// one scrollbar still measures the whole list, and every row still says where it stands in it. The keys reach the last
// row, the page cursor moving far down brings its row into the panel marked current, and a click there goes to its
// heading. Playwright WebKit.
import { strict as assert } from 'node:assert';
import { after, test as nodeTest } from 'node:test';
import { closeHarness } from './support/two-pane.mjs';
import { showPanel, skip, withFrame } from './support/frame.mjs';

const test = (name, fn) => nodeTest(name, { skip, timeout: 240_000 }, fn);
after(() => closeHarness());

const N = 4000;
const BIG = '/w/many.md';
const text = Array.from({ length: N }, (_, i) => `${'#'.repeat(i % 200 === 0 ? 1 : i % 20 === 0 ? 2 : 3)} Heading ${i}\n\nA short paragraph under heading ${i}.\n`).join('\n');
const FILES = { '/w/.git/HEAD': 'ref: refs/heads/main\n', [BIG]: text };

/** Rows drawn in the Outline now. */
const drawnRows = (page) => page.evaluate(() => document.querySelectorAll('.marxy-drawer .marxy-l-body .marxy-l-row').length);
const cur = (page) => page.evaluate(() => document.querySelector('.marxy-drawer .marxy-l-prow.marxy-l-cur')?.dataset.marxyLeftRow ?? null);
/** Whether row `k` is drawn inside the visible part of the panel's body. */
const inPanel = (page, k) =>
  page.evaluate((k) => {
    const row = document.querySelector(`.marxy-drawer .marxy-l-prow[data-marxy-left-row="${k}"]`);
    if (!row) return false;
    const r = row.getBoundingClientRect();
    const b = document.querySelector('.marxy-drawer .marxy-l-body').getBoundingClientRect();
    return r.height > 0 && r.top >= b.top - 1 && r.bottom <= b.bottom + 1;
  }, k);
/**
 * How the Outline's rows lie now: the list box's height, each shape's height as a row of it lays itself out (a level-one
 * or level-two row and a smaller level-three row copied out of the window, in flow, at their own height), and the drawn
 * rows that overlap the next or hold more than their box.
 */
const rowsLie = (page) =>
  page.evaluate(() => {
    const body = document.querySelector('.marxy-drawer .marxy-l-body');
    const natural = (sel) => {
      const copy = body.querySelector(sel).cloneNode(true);
      copy.removeAttribute('data-marxy-left-row');
      copy.removeAttribute('id');
      copy.style.position = 'static';
      copy.style.height = '';
      copy.style.top = '';
      body.append(copy);
      const height = copy.getBoundingClientRect().height;
      copy.remove();
      return height;
    };
    const rows = [...body.querySelectorAll('.marxy-l-rows > .marxy-l-prow')].sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
    const bad = [];
    rows.forEach((r, i) => {
      const box = r.getBoundingClientRect();
      if (r.scrollHeight > r.clientHeight + 1) bad.push(`${r.dataset.marxyLeftRow} holds ${r.scrollHeight}px in ${r.clientHeight}px`);
      const next = rows[i + 1]?.getBoundingClientRect();
      if (next && box.bottom > next.top + 0.5 && next.top - box.top < 3 * box.height) bad.push(`${r.dataset.marxyLeftRow} overlaps the next row`);
    });
    return { list: body.querySelector('.marxy-l-rows').getBoundingClientRect().height, scroll: body.scrollHeight, top: natural('.marxy-l-rows > .marxy-l-prow:not(.marxy-l-sub)'), sub: natural('.marxy-l-rows > .marxy-l-prow.marxy-l-sub'), bad };
  });
const settle = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

async function openOutline(page) {
  await showPanel(page, 'outline');
  await page.waitForSelector('.marxy-drawer [data-marxy-left-row="h:heading-0"]');
}

test('a long Outline draws a bounded number of rows, with a scroll height and set sizes true to the whole list', async () => {
  await withFrame({ files: FILES, open: [BIG] }, async (page) => {
    await openOutline(page);
    const rows = await drawnRows(page);
    assert.ok(rows > 10 && rows < 150, `a bounded number of rows is drawn, not ${rows}`);
    const s = await page.evaluate(() => {
      const body = document.querySelector('.marxy-drawer .marxy-l-body');
      const first = body.querySelector('[data-marxy-left-row="h:heading-0"]');
      const sub = body.querySelector('[data-marxy-left-row="h:heading-1"]');
      return {
        role: body.getAttribute('role'),
        first: [first.getAttribute('role'), first.getAttribute('aria-level'), first.getAttribute('aria-posinset'), first.getAttribute('aria-setsize')],
        sub: [sub.getAttribute('aria-level'), sub.getAttribute('aria-posinset'), sub.getAttribute('aria-setsize')],
      };
    });
    // Two hundred level-one and level-two rows, the rest level three set smaller: each row as tall as it lays itself out.
    const lie = await rowsLie(page);
    assert.ok(lie.top - lie.sub > 0.3, `a level-three row is shorter than a level-one row: ${JSON.stringify(lie)}`);
    const whole = 200 * lie.top + (N - 200) * lie.sub;
    assert.ok(Math.abs(lie.list - whole) < 1 && lie.scroll >= whole, `the body scrolls over all ${N} rows: ${JSON.stringify(lie)}, ${whole}px`);
    assert.deepEqual(lie.bad, []);
    assert.equal(s.role, 'tree');
    // Twenty top-level headings (every 200th); the first holds nineteen level-three headings before its first level two.
    assert.deepEqual(s.first, ['treeitem', '1', '1', '20']);
    assert.deepEqual(s.sub, ['3', '1', '19']);

    // Scrolled to the middle, the rows there are drawn, and still only a bounded number.
    await page.evaluate(() => {
      const body = document.querySelector('.marxy-drawer .marxy-l-body');
      body.scrollTop = body.scrollHeight / 2;
    });
    await page.waitForFunction(() => document.querySelector('.marxy-drawer [data-marxy-left-row="h:heading-2000"]'));
    assert.ok((await drawnRows(page)) < 150);
    assert.equal(await page.evaluate(() => document.querySelector('.marxy-drawer [data-marxy-left-row="h:heading-0"]')), null, 'the first row is no longer drawn');
  });
});

test('keys walk to the far end of a long Outline, its row in view and pointed at for a screen reader', async () => {
  await withFrame({ files: FILES, open: [BIG] }, async (page) => {
    await openOutline(page);
    await page.evaluate(() => window.__marxyHandle.frame().left.focusPanel());
    await page.waitForFunction(() => document.activeElement?.closest('.marxy-drawer'));
    await page.waitForFunction(() => document.querySelector('.marxy-drawer .marxy-l-prow.marxy-l-cur'));
    await page.keyboard.press('End');
    await settle(page);
    assert.equal(await cur(page), `h:heading-${N - 1}`, 'End reaches the last row');
    assert.equal(await inPanel(page, `h:heading-${N - 1}`), true, 'the last row is in the panel');
    await page.keyboard.press('k');
    await settle(page);
    assert.equal(await cur(page), `h:heading-${N - 2}`);
    assert.equal(await inPanel(page, `h:heading-${N - 2}`), true);
    // h goes to the row's parent, far above it.
    await page.keyboard.press('h');
    await settle(page);
    assert.equal(await cur(page), 'h:heading-3980', 'h goes to the section that holds it');
    const pointed = await page.evaluate(() => {
      const body = document.querySelector('.marxy-drawer .marxy-l-body');
      return document.getElementById(body.getAttribute('aria-activedescendant'))?.dataset.marxyLeftRow ?? null;
    });
    assert.equal(pointed, 'h:heading-3980', 'the screen reader is pointed at the cursor row');
    assert.match(await page.getAttribute('.marxy-drawer [data-marxy-left-row="h:heading-3980"]', 'aria-label'), /^Heading 3980 /, 'the row drawn as the cursor reached it is named');
    // The cursor row stays drawn when the panel is scrolled far from it, so the verb bar keeps its row.
    await page.evaluate(() => {
      document.querySelector('.marxy-drawer .marxy-l-body').scrollTop = 0;
    });
    await page.waitForFunction(() => document.querySelector('.marxy-drawer [data-marxy-left-row="h:heading-0"]'));
    assert.equal(await cur(page), 'h:heading-3980');
    assert.equal(await page.evaluate(() => document.querySelector('.marxy-drawer .marxy-l-what')?.textContent), 'Heading 3980');
    assert.ok((await drawnRows(page)) < 150);
    await page.keyboard.press('Home');
    await settle(page);
    assert.equal(await cur(page), 'h:heading-0');
  });
});

test('the page cursor moving far down brings its row into the panel marked current; a click there goes to its heading', async () => {
  await withFrame({ files: FILES, open: [BIG] }, async (page) => {
    await openOutline(page);
    const cursorOn = (heading) =>
      page.evaluate((h) => {
        const handle = window.__marxyHandle;
        const t = new TextDecoder().decode(handle.panes().focused.content.store().snapshot().buffer.bytes);
        return handle.selection.cursorAt(new TextEncoder().encode(t.slice(0, t.indexOf(h))).length);
      }, heading);
    assert.equal(await cursorOn('### Heading 3501\n'), true);
    await page.waitForFunction(() => document.querySelector('.marxy-drawer [data-marxy-left-row="h:heading-3501"]')?.classList.contains('marxy-l-at'), null, { timeout: 20_000 });
    assert.equal(await inPanel(page, 'h:heading-3501'), true, `the current row is brought into the panel: ${await page.evaluate(() => JSON.stringify({ top: document.querySelector('.marxy-drawer .marxy-l-body').scrollTop, row: document.querySelector('.marxy-drawer [data-marxy-left-row="h:heading-3501"]')?.style.top }))}`);
    assert.match(await page.getAttribute('.marxy-drawer [data-marxy-left-row="h:heading-3501"]', 'aria-label'), /, current$/);
    assert.equal(await page.evaluate(() => document.querySelectorAll('.marxy-drawer .marxy-l-row.marxy-l-at').length), 1, 'one row is marked');

    // Brought from far, the row stands mid-panel; a row near it, drawn now, goes to its heading on a click.
    assert.equal(await inPanel(page, 'h:heading-3504'), true);
    await page.locator('.marxy-drawer [data-marxy-left-row="h:heading-3504"]').click();
    await page.waitForFunction(() => /^Heading 3504/.test(document.querySelector('#doc .marxy-cursor')?.textContent.trim() ?? ''), null, { timeout: 20_000 });
    await page.waitForFunction(() => document.querySelector('.marxy-drawer [data-marxy-left-row="h:heading-3504"]')?.classList.contains('marxy-l-at'), null, { timeout: 20_000 });
  });
});

test('a panel the reader scrolled away from the current row is left where it is as the page moves on', async () => {
  await withFrame({ files: FILES, open: [BIG] }, async (page) => {
    await openOutline(page);
    const cursorOn = (heading) =>
      page.evaluate((h) => {
        const handle = window.__marxyHandle;
        const t = new TextDecoder().decode(handle.panes().focused.content.store().snapshot().buffer.bytes);
        return handle.selection.cursorAt(new TextEncoder().encode(t.slice(0, t.indexOf(h))).length);
      }, heading);
    await cursorOn('### Heading 3501\n');
    await page.waitForFunction(() => document.querySelector('.marxy-drawer [data-marxy-left-row="h:heading-3501"]')?.classList.contains('marxy-l-at'), null, { timeout: 20_000 });
    await page.evaluate(() => {
      document.querySelector('.marxy-drawer .marxy-l-body').scrollTop = 0;
    });
    await page.waitForFunction(() => document.querySelector('.marxy-drawer [data-marxy-left-row="h:heading-0"]'));
    await cursorOn('### Heading 3510\n');
    await page.waitForTimeout(1500);
    assert.equal(await page.evaluate(() => document.querySelector('.marxy-drawer .marxy-l-body').scrollTop), 0, 'the panel stays where the reader left it');
  });
});

test('a long Outline moves a section by a drag, folds a section in the panel and filters to a short list, drawn whole', async () => {
  await withFrame({ files: FILES, open: [BIG] }, async (page) => {
    await openOutline(page);
    // A drag among drawn rows still moves the section, its insertion line placed in the list.
    const line = await page.evaluate(() => {
      const q = (k) => document.querySelector(`.marxy-drawer .marxy-l-prow[data-marxy-left-row="h:${k}"]`);
      const a = q('heading-1');
      const b = q('heading-2');
      const r = b.getBoundingClientRect();
      const dt = new DataTransfer();
      const ev = (el, type) => el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.left + 40, clientY: r.bottom - 2 }));
      ev(a, 'dragstart');
      ev(b, 'dragover');
      const ins = document.querySelector('.marxy-drawer .marxy-l-rows > .marxy-l-dropline');
      const at = ins && Math.round(ins.getBoundingClientRect().top - q('heading-3').getBoundingClientRect().top);
      ev(b, 'drop');
      ev(a, 'dragend');
      return at;
    });
    assert.ok(line !== null && Math.abs(line) <= 2, `the insertion line stands between Heading 2 and Heading 3: ${line}`);
    await page.waitForFunction(() => /### Heading 2\n[\s\S]*### Heading 1\n[\s\S]*### Heading 3\n/.test(new TextDecoder().decode(window.__marxyHandle.panes().focused.content.store().snapshot().buffer.bytes)));
    await page.evaluate(() => window.__marxyHandle.panes().focused.content.store().undo());
    await page.waitForFunction((t) => new TextDecoder().decode(window.__marxyHandle.panes().focused.content.store().snapshot().buffer.bytes) === t, text);
    await page.waitForSelector('.marxy-drawer [data-marxy-left-row="h:heading-0"]');
    await page.locator('.marxy-drawer [data-marxy-left-row="h:heading-0"] .marxy-l-tw').click();
    // Folded, the first section's 199 rows are gone from the list: the next row is the second top-level heading.
    await page.waitForFunction(() => {
      const rows = [...document.querySelectorAll('.marxy-drawer .marxy-l-body .marxy-l-prow')].sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
      return rows[0]?.dataset.marxyLeftRow === 'h:heading-0' && rows[1]?.dataset.marxyLeftRow === 'h:heading-200';
    });
    await page.fill('.marxy-drawer input[data-marxy-left-field="outline-q"]', 'heading 3999');
    await page.waitForFunction(() => document.querySelectorAll('.marxy-drawer .marxy-l-body .marxy-l-row').length === 1);
    assert.equal(await page.evaluate(() => document.querySelector('.marxy-drawer .marxy-l-rows')), null, 'a short list is drawn whole');
    await page.fill('.marxy-drawer input[data-marxy-left-field="outline-q"]', '');
    await page.waitForFunction(() => document.querySelector('.marxy-drawer .marxy-l-rows'));
    assert.ok((await drawnRows(page)) < 150);
  });
});

test('a larger interface size measures the rows again: none overlaps, and the scroll height stays true', async () => {
  await withFrame({ files: FILES, open: [BIG] }, async (page) => {
    await openOutline(page);
    const before = await rowsLie(page);
    // As Settings applies chrome_size: the root's size, then the window laid out again.
    await page.evaluate(async () => {
      const { applyReaderConfig } = await import('/src/theme/reader-config.ts');
      applyReaderConfig(document.documentElement, { chromeSize: 22 });
      await window.__marxyHandle.relayout();
    });
    await settle(page);
    await settle(page);
    const after = await rowsLie(page);
    assert.ok(after.top > before.top + 5, `the rows are taller at 22px: ${before.top}px then ${after.top}px`);
    assert.deepEqual(after.bad, [], 'no row holds more than its box or overlaps the next');
    const whole = 200 * after.top + (N - 200) * after.sub;
    assert.ok(Math.abs(after.list - whole) < 1 && after.scroll >= whole, `the list is as tall as its rows now: ${JSON.stringify(after)}, ${whole}px`);
    // Scrolled, the rows drawn there are placed by the new heights too.
    await page.evaluate(() => {
      const body = document.querySelector('.marxy-drawer .marxy-l-body');
      body.scrollTop = body.scrollHeight / 2;
    });
    await settle(page);
    assert.deepEqual((await rowsLie(page)).bad, []);
  });
});

const cursorAtText = (page, h) =>
  page.evaluate((h) => {
    const handle = window.__marxyHandle;
    const t = new TextDecoder().decode(handle.panes().focused.content.store().snapshot().buffer.bytes);
    return handle.selection.cursorAt(new TextEncoder().encode(t.slice(0, t.indexOf(h))).length);
  }, h);
const sections = (page) => page.evaluate(() => [...document.querySelectorAll('.marxy-drawer .marxy-l-sec')].map((s) => `${s.firstChild.textContent} · ${s.lastChild.textContent}`));
const crumbsNow = (page) => page.$$eval('.marxy-crumbs [data-marxy-crumb="section"]', (els) => els.map((e) => e.textContent));

test('an Outline of more headings than it draws says it lists the first 20,000; the address still names a heading past them', async () => {
  const many = '/w/more.md';
  // Words after the last heading, so the page can bring the cursor's heading up to the reading line.
  const md = `# Top\n\n${Array.from({ length: 20_005 }, (_, i) => `## Heading ${i}\n`).join('\n')}\n${'Closing words.\n\n'.repeat(300)}`;
  await withFrame({ files: { '/w/.git/HEAD': 'ref: refs/heads/main\n', [many]: md }, open: [many] }, async (page) => {
    await showPanel(page, 'outline');
    await page.waitForSelector('.marxy-drawer [data-marxy-left-row="h:heading-0"]', { timeout: 120_000 });
    assert.deepEqual(await sections(page), ['Headings · the first 20,000']);
    await page.fill('.marxy-drawer input[data-marxy-left-field="outline-q"]', 'heading 19998');
    await page.waitForFunction(() => [...document.querySelectorAll('.marxy-drawer .marxy-l-body .marxy-l-row')].map((r) => r.dataset.marxyLeftRow).join() === 'h:heading-19998');
    await page.fill('.marxy-drawer input[data-marxy-left-field="outline-q"]', 'heading 19999');
    await page.waitForFunction(() => document.querySelectorAll('.marxy-drawer .marxy-l-body .marxy-l-row').length === 0);
    // The address reads every heading: the page at the 20,005th names it, not the last row the panel draws.
    assert.equal(await cursorAtText(page, '## Heading 20003\n'), true);
    await page.evaluate(() => [...document.querySelectorAll('.marxy-article h2')].find((e) => e.textContent.trim() === 'Heading 20003').scrollIntoView({ block: 'center' }));
    await page.waitForFunction(() => [...document.querySelectorAll('.marxy-crumbs [data-marxy-crumb="section"]')].some((e) => e.textContent === 'Heading 20003'), null, { timeout: 20_000 });
    assert.deepEqual(await crumbsNow(page), ['Top', 'Heading 20003']);
  });
});

test('a changelog of more releases than the Outline draws says so under Releases', async () => {
  const log = '/w/CHANGELOG.md';
  const md = `# Changelog\n\n${Array.from({ length: 20_005 }, (_, i) => `## 1.0.${20_004 - i}\n\n- a fix\n`).join('\n')}`;
  await withFrame({ files: { '/w/.git/HEAD': 'ref: refs/heads/main\n', [log]: md }, open: [log] }, async (page) => {
    await showPanel(page, 'outline');
    await page.waitForFunction(() => document.querySelectorAll('.marxy-drawer .marxy-l-body .marxy-l-row').length > 0, null, { timeout: 120_000 });
    assert.deepEqual(await sections(page), ['Releases · the first 20,000']);
  });
});