// The geometry table (view/block-geometry.ts) against the page: after each kind of change, once the page is quiet,
// every entry's top and height equal a fresh measurement of the article's children, and the reading position and the
// scroll offset that puts a place back, read from the table, equal those read from a block list built over the whole
// page. The table shadows the page here; nothing in the view reads it yet. Counted reads, not times. WebKit, over the
// shipped skeleton and the memory shell.
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { after, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { closeHarness, harnessBase, routeSkeleton } from './support/two-pane.mjs';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip, timeout: 400_000 }, fn);
after(() => closeHarness());

const sentence = (n) => `Sentence ${n} of the reader keeps a place on the page while paragraphs are set line by line and the rag is balanced.`;
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="317"><rect width="300" height="317" fill="#888"/></svg>';
const MATHS = ['$$', String.raw`\sum_{k=1}^{n} k = \frac{n(n+1)}{2}`, '$$'].join('\n');
const CODE = ['```js', 'const x = 1;', 'const y = 2;', '```'].join('\n');

/** Prose with images, maths, code, lists and quotes among it: every kind of block that changes height after it is first drawn. */
function mixed(count = 700) {
  const out = [];
  for (let n = 0; n < count; n++) {
    out.push(
      n % 30 === 0 ? `## Part ${n}`
        : n % 37 === 0 ? `![pic](./pic${n}.svg)`
        : n % 41 === 0 ? MATHS
        : n % 13 === 0 ? `- ${sentence(n)}\n- ${sentence(n + 1)} ${sentence(n + 2)}\n- ${sentence(n + 3)}`
        : n % 19 === 0 ? `> ${sentence(n)}\n>\n> ${sentence(n + 1)}`
        : n % 23 === 0 ? CODE
        : Array.from({ length: 4 }, (_, i) => sentence(n + i)).join(' '),
    );
  }
  return `${out.join('\n\n')}\n`;
}

const frames = (page, n = 3) => page.evaluate((n) => new Promise((res) => {
  const step = (k) => (k === 0 ? res() : requestAnimationFrame(() => step(k - 1)));
  step(n);
}), n);

async function boot(page, files, first) {
  const base = await harnessBase();
  await routeSkeleton(page, base);
  await page.goto(`${base}app.html`);
  await page.waitForFunction(() => typeof window.marxyApp?.start === 'function');
  await page.evaluate(async ({ files, first }) => {
    const { createMemoryShell } = await import('/src/shell/memory.ts');
    const { startApp } = await import('/src/app.ts');
    const bytes = Object.fromEntries(Object.entries(files).map(([path, text]) => [path, new TextEncoder().encode(text)]));
    window.__typesetDone = 0;
    const shell = createMemoryShell(bytes);
    const mark = shell.mark.bind(shell);
    shell.mark = async (name, t, data) => {
      if (name === 'typeset_done') window.__typesetDone += 1;
      return mark(name, t, data);
    };
    const handle = await startApp(shell, { argv: [first] });
    window.__marxyHandle = handle;
    await handle.ready;
    await handle.contentComplete();
  }, { files, first });
  await page.waitForFunction(() => window.__typesetDone > 0, null, { timeout: 300_000, polling: 250 });
  await page.evaluate(() => document.fonts.ready);
  // The table, made over the page as it stands, kept from then on by notifications alone.
  await page.evaluate(async () => {
    const { createBlockGeometry } = await import('/src/view/block-geometry.ts');
    const { buildBlocks, innerBlocks } = await import('/src/render/post.ts');
    const { currentPosition, positionNear, scrollTopNear } = await import('/src/position/position.ts');
    const view = window.__marxyHandle.panes().panes[0].view;
    const article = document.getElementById('doc');
    const map = () => view.document()?.nodeMap ?? new Map();
    const table = createBlockGeometry(article, { inner: (el) => innerBlocks(el, map()) });
    window.__table = table;
    /** Where the table and the page disagree, as a list of differences; empty when they agree. */
    window.__compare = () => {
      const out = [];
      const origin = article.getBoundingClientRect().top;
      const entries = table.entries();
      const children = [...article.children].filter((el) => {
        if (el.hasAttribute('data-marxy-s')) return true;
        const p = getComputedStyle(el).position;
        return p !== 'absolute' && p !== 'fixed';
      });
      if (entries.length !== children.length) out.push(`entries ${entries.length}, in-flow children ${children.length}`);
      for (let i = 0; i < Math.min(entries.length, children.length); i++) {
        const e = entries[i];
        const el = children[i];
        if (e.el !== el) { out.push(`entry ${i} is ${e.el.tagName}, the child is ${el.tagName}`); break; }
        const laidOut = el.getClientRects().length > 0;
        const r = el.getBoundingClientRect();
        if (laidOut && (Math.abs(e.top - (r.top - origin)) > 0.5 || Math.abs(e.height - r.height) > 0.5)) {
          out.push(`entry ${i} (${el.tagName} ${e.start}): table ${e.top.toFixed(1)}+${e.height.toFixed(1)}, page ${(r.top - origin).toFixed(1)}+${r.height.toFixed(1)}`);
          if (out.length > 5) break;
        }
      }
      // The inner blocks the table's windows read are the whole page's block list, cut into its top-level blocks.
      const whole = buildBlocks(article, map());
      const cut = children.flatMap((el) => innerBlocks(el, map()));
      if (cut.length !== whole.length || cut.some((el, i) => el !== whole[i].el)) out.push(`inner blocks ${cut.length}, whole list ${whole.length}`);
      // Positions at many scroll offsets, and the offsets that put places back.
      const scroller = view.scroller;
      const offset = article.getBoundingClientRect().top - (scroller === document.documentElement ? 0 : scroller.getBoundingClientRect().top) + scroller.scrollTop;
      const max = scroller.scrollHeight - scroller.clientHeight;
      for (let k = 1; k <= 60; k++) {
        const geometry = { scrollTop: Math.round((max * k) / 61), clientHeight: scroller.clientHeight };
        const want = currentPosition(geometry, whole, 'p', 'rendered', offset);
        const got = positionNear(geometry, table, 'p', 'rendered', offset);
        if (want.byteOffset !== got.byteOffset || Math.abs(want.fraction - got.fraction) > 0.002 || Math.abs((want.lead ?? 0) - (got.lead ?? 0)) > 0.5) {
          out.push(`at ${geometry.scrollTop}: whole ${JSON.stringify(want)}, table ${JSON.stringify(got)}`);
          if (out.length > 10) break;
        }
        const back = scrollTopNear(table, want, geometry.clientHeight, offset);
        if (Math.abs(back - geometry.scrollTop) > 1 && want.fraction > 0 && want.fraction < 1) out.push(`back from ${JSON.stringify(want)}: ${back.toFixed(1)}, was ${geometry.scrollTop}`);
      }
      return out;
    };
  });
}

/** Scrolls through the page a screen at a time, as a reader would, letting each frame paint. */
async function scrollThrough(page, steps = 30) {
  for (let i = 0; i < steps; i++) {
    await page.evaluate(() => {
      window.__marxyHandle.panes().panes[0].view.scroller.scrollTop += 1400;
    });
    await frames(page, 2);
  }
}

/** Until the typesetter has gone quiet again and two frames have painted: when the table must equal the page. */
async function quiet(page) {
  await page.waitForFunction(() => {
    const done = window.__typesetDone;
    return new Promise((res) => setTimeout(() => res(window.__typesetDone === done), 400));
  }, null, { timeout: 120_000, polling: 100 });
  await frames(page, 3);
}

async function agrees(page, step) {
  await quiet(page);
  const diff = await page.evaluate(() => window.__compare());
  assert.deepEqual(diff, [], `after ${step}`);
}

test('the table equals the page after opening, chunks, typesetting, colour, images, a splice, width changes, a theme change, a margin-only change and Source and back', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const files = { '/r/long.md': mixed(), '/r/other.md': mixed(120) };
    for (let n = 0; n < 700; n++) if (n % 37 === 0) files[`/r/pic${n}.svg`] = SVG;
    await boot(page, files, '/r/long.md');
    await agrees(page, 'opening');
    await scrollThrough(page);
    await agrees(page, 'scrolling through, images sized and type set as it came near');

    await page.setViewportSize({ width: 820, height: 900 });
    await agrees(page, 'a narrower pane');
    await page.setViewportSize({ width: 1400, height: 900 });
    await agrees(page, 'a wider pane');

    // A paragraph written by an outside editor: the blocks around it are replaced and every block below moves.
    await page.evaluate(async () => {
      const handle = window.__marxyHandle;
      const path = handle.currentPath();
      const text = new TextDecoder().decode(await handle.shell.readFile(path));
      const added = 'A new paragraph an outside editor wrote, long enough to wrap a line or two on the page when it is set.\n\n';
      await handle.shell.writeFileAtomic(path, new TextEncoder().encode(text.replace('## Part 300\n', `${added}## Part 300\n`)));
      handle.shell.emit([{ kind: 'modified', path }]);
    });
    await page.waitForFunction(() => document.getElementById('doc').textContent.includes('an outside editor wrote'));
    await agrees(page, 'a splice from outside');

    // A block taken out, above blocks that keep their size.
    await page.evaluate(async () => {
      const handle = window.__marxyHandle;
      const path = handle.currentPath();
      const text = new TextDecoder().decode(await handle.shell.readFile(path));
      await handle.shell.writeFileAtomic(path, new TextEncoder().encode(text.replace(/A new paragraph an outside editor wrote[^\n]*\n\n/, '')));
      handle.shell.emit([{ kind: 'modified', path }]);
    });
    await page.waitForFunction(() => !document.getElementById('doc').textContent.includes('an outside editor wrote'));
    await agrees(page, 'a block taken out');

    // A theme that changes the size of the type: every block changes size.
    await page.evaluate(() => {
      const style = document.createElement('style');
      style.id = 'test-theme';
      style.textContent = '#doc { font-size: 19px; line-height: 1.6; }';
      document.head.append(style);
    });
    await agrees(page, 'a theme change');
    // A rule that moves headings down by whole lines and changes no block's size.
    await page.evaluate(() => {
      const style = document.createElement('style');
      style.textContent = '#doc > h2 { margin-top: 96px; }';
      document.head.append(style);
    });
    await agrees(page, 'a margin-only change');

    const boxes = () => page.evaluate(() => window.__table.entries().map((e) => [e.top, e.height]));
    const shown = await boxes();
    await page.evaluate(async () => {
      const view = window.__marxyHandle.panes().panes[0].view;
      await view.toggleMode();
    });
    await page.waitForFunction(() => document.body.dataset.marxyMode === 'source');
    await page.evaluate(() => document.getElementById('test-theme').remove());
    await frames(page, 3);
    // Hidden, every block reports a size of nothing: the table keeps the page as it was last shown, for the return.
    assert.deepEqual(await boxes(), shown, 'the table while the page is hidden for Source');
    await page.evaluate(async () => {
      const view = window.__marxyHandle.panes().panes[0].view;
      await view.toggleMode();
    });
    await page.waitForFunction(() => document.body.dataset.marxyMode !== 'source' && !document.getElementById('doc').hidden);
    await agrees(page, 'Source and back, the theme changed while the page was hidden');

    await page.evaluate(() => window.__marxyHandle.open('/r/other.md'));
    await page.waitForFunction(() => document.getElementById('doc').children.length < 200 && document.getElementById('doc').textContent.includes('Part 90'));
    await agrees(page, 'another document in the same article');
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test('notes in the margin are kept out of the table, and the place on a long reference with notes is the place a whole list gives', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 2200, height: 1000 } });
    const ref = readFileSync(new URL('../../../fixtures/corpus/32-long-reference.md', import.meta.url), 'utf8');
    await boot(page, { '/r/ref.md': ref }, '/r/ref.md');
    await page.waitForFunction(() => document.querySelector('#doc > .marxy-note-margin'), null, { timeout: 60_000 });
    await scrollThrough(page, 60);
    await agrees(page, 'notes set in the margin of a long reference');
    const r = await page.evaluate(() => ({
      notes: document.querySelectorAll('#doc > .marxy-note-margin').length,
      inTable: window.__table.entries().filter((e) => e.el.classList.contains('marxy-note-margin')).length,
    }));
    assert.ok(r.notes > 0, 'the page has notes in its margin');
    assert.equal(r.inTable, 0);
  } finally {
    await browser.close();
  }
});

test('one block that grows is read alone: the table reads a handful of boxes, not one per block', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const parts = Array.from({ length: 1200 }, (_, n) => (n % 30 === 0 ? `## Part ${n}` : `${sentence(n)} ${sentence(n + 1)}`));
    await boot(page, { '/r/long.md': `${parts.join('\n\n')}\n` }, '/r/long.md');
    await quiet(page);
    const r = await page.evaluate(async () => {
      const table = window.__table;
      const article = document.getElementById('doc');
      const frame = () => new Promise((res) => requestAnimationFrame(res));
      const before = { reads: table.stats.reads, callbacks: table.stats.callbacks };
      // Count every box the page is asked for while the change is heard.
      let rects = 0;
      const rect = Element.prototype.getBoundingClientRect;
      Element.prototype.getBoundingClientRect = function () {
        rects++;
        return rect.call(this);
      };
      article.children[600].style.paddingBottom = '48px';
      await frame();
      await frame();
      Element.prototype.getBoundingClientRect = rect;
      return { entries: table.entries().length, reads: table.stats.reads - before.reads, callbacks: table.stats.callbacks - before.callbacks, rects, diff: window.__compare() };
    });
    assert.ok(r.entries > 1000, `${r.entries} entries`);
    assert.ok(r.callbacks >= 1, 'the change was heard');
    assert.ok(r.reads <= 8, `${r.reads} boxes read`);
    assert.ok(r.rects <= 12, `${r.rects} boxes asked of the page in all`);
    assert.deepEqual(r.diff, []);
  } finally {
    await browser.close();
  }
});

test('an item that grows inside a list padded back to the size it had: positions in the list follow the item', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const parts = Array.from({ length: 200 }, (_, n) => (n === 100
      ? Array.from({ length: 12 }, (_, i) => `- ${sentence(n + i)}`).join('\n')
      : `${sentence(n)} ${sentence(n + 1)}`));
    await boot(page, { '/r/long.md': `${parts.join('\n\n')}\n` }, '/r/long.md');
    await quiet(page);
    const r = await page.evaluate(async () => {
      const { buildBlocks } = await import('/src/render/post.ts');
      const { currentPosition, positionNear } = await import('/src/position/position.ts');
      const table = window.__table;
      const view = window.__marxyHandle.panes().panes[0].view;
      const article = document.getElementById('doc');
      const frame = () => new Promise((res) => requestAnimationFrame(res));
      const list = article.querySelector(':scope > ul');
      const items = list.querySelectorAll('li');
      const scroller = view.scroller;
      const offset = article.getBoundingClientRect().top - (scroller === document.documentElement ? 0 : scroller.getBoundingClientRect().top) + scroller.scrollTop;
      const lineAt = (y) => ({ scrollTop: y + offset - 0.4 * scroller.clientHeight, clientHeight: scroller.clientHeight });
      const listTop = list.getBoundingClientRect().top - article.getBoundingClientRect().top;
      // Read in the list first: its inner blocks are measured and kept.
      positionNear(lineAt(listTop + 10), table, 'p', 'rendered');
      const height = list.getBoundingClientRect().height;
      // The first item grows by 40 px; the list loses 40 px of padding, so its own size is what it was.
      const pad = parseFloat(getComputedStyle(list).paddingBottom);
      items[0].style.paddingBottom = '40px';
      list.style.paddingBottom = `${Math.max(0, pad - 40)}px`;
      list.style.marginBottom = `${parseFloat(getComputedStyle(list).marginBottom) + Math.max(0, 40 - pad)}px`;
      list.style.height = `${height}px`;
      list.style.boxSizing = 'border-box';
      await frame();
      await frame();
      const whole = buildBlocks(article, view.document().nodeMap);
      const off = [];
      for (let y = listTop; y < listTop + height; y += 7) {
        const want = currentPosition(lineAt(y), whole, 'p', 'rendered', offset);
        const got = positionNear(lineAt(y), table, 'p', 'rendered', offset);
        if (want.byteOffset !== got.byteOffset || Math.abs(want.fraction - got.fraction) > 0.002) off.push([y, want, got]);
      }
      return { same: Math.abs(list.getBoundingClientRect().height - height) < 0.5, off: off.slice(0, 3), count: off.length };
    });
    assert.ok(r.same, 'the list kept its size');
    assert.deepEqual(r.off, [], `${JSON.stringify(r.off).slice(0,600)} ${r.count} places in the list differ from a whole list`);
  } finally {
    await browser.close();
  }
});

test('a reader who read the table in the frame before it heard of a change is told the next frame, and only then', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const parts = Array.from({ length: 300 }, (_, n) => (n % 30 === 0 ? `## Part ${n}` : `${sentence(n)} ${sentence(n + 1)}`));
    await boot(page, { '/r/long.md': `${parts.join('\n\n')}\n` }, '/r/long.md');
    await quiet(page);
    const r = await page.evaluate(async () => {
      const { positionNear } = await import('/src/position/position.ts');
      const table = window.__table;
      const view = window.__marxyHandle.panes().panes[0].view;
      const article = document.getElementById('doc');
      const frame = () => new Promise((res) => requestAnimationFrame(res));
      let told = 0;
      const off = table.onMoved(() => { told++; });
      // A change nobody read around: nobody is told.
      article.children[5].style.paddingBottom = '30px';
      await frame();
      await frame();
      await frame();
      const unread = told;
      // Read in this frame, then the page moves under the reading line in the same frame: told next frame.
      view.scroller.scrollTop = 3000;
      positionNear(view.scroller, table, 'p', 'rendered');
      article.children[2].style.paddingBottom = '90px';
      await frame();
      await frame();
      await frame();
      off();
      return { unread, told };
    });
    assert.equal(r.unread, 0, 'nobody had read the table: nobody is told');
    assert.equal(r.told, 1, 'told once, the frame after');
  } finally {
    await browser.close();
  }
});
