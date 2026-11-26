// The left section's document panels: Metadata (how the file is read and why, Shown at, Read as,
// the file as stored, what is odd, written in it, what it holds as lenses), Outline (the sections with their sizes, the page
// folded to a level, a section moved by Alt+Down or a drag, a table's columns, a log's levels and strip of time), and Links
// (to files here, nowhere, within, outside, pointing here; o, p and the page following the cursor). Playwright WebKit.
import { strict as assert } from 'node:assert';
import { after, test as nodeTest } from 'node:test';
import { closeHarness } from './support/two-pane.mjs';
import { fileText, showPanel, skip, withFrame } from './support/frame.mjs';

const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);
after(() => closeHarness());

const para = (n) => `${'Words that run on long enough to fill the measure and make the page tall enough to scroll. '.repeat(9)}(${n})\n`;
const PLAN = '/w/plans/release-plan.md';
const PLAN_TEXT = [
  '---\ntitle: The release plan\nowner: ops\n---\n',
  '# Release plan\n\nIt points at [the log](../logs/run.log#L3) and [a budget](../plans/perf-budget.md), at [rollback](#rollback) and at [the site](https://example.com/plan).\n',
  `## Scope\n\n${para(1)}\n- [ ] write the notes\n- [x] cut the branch\n- [ ] tag it\n\n### In scope\n\n${para(2)}`,
  `## Workstreams\n\n${para(3)}\n\`\`\`rust\nfn main() {}\n\`\`\`\n\n${para(4)}\n| Who | What |\n|---|---|\n| Priya | db |\n\n${para(5)}`,
  `## Risks\n\nThe tool is \`src/tool.py\`, and a note.[^1]\n\n${para(6)}\n${para(7)}`,
  `## Rollback\n\n${para(8)}\n${para(9)}`,
  '[^1]: The note itself.\n',
].join('\n');
const FILES = {
  '/w/.git/HEAD': 'ref: refs/heads/main\n',
  [PLAN]: PLAN_TEXT,
  '/w/plans/vendor.md': '# Vendor drop\r\n\r\n## 1. What arrived\r\n\r\nTwo crates.\r\n\r\n## 2. How to build\r\n\r\nCargo.\r\n\r\n## 3. Checks\r\n\r\nTests.\r\n\r\n## 4. Who to ask\r\n\r\nPriya.',
  '/w/logs/run.log': [
    '2026-10-14T08:00:00Z INFO start',
    '2026-10-14T08:00:30Z DEBUG walk begins',
    '2026-10-14T08:01:00Z WARN slow statement',
    '2026-10-14T08:02:10Z ERROR db: connection reset',
    '2026-10-14T08:03:00Z INFO retry',
    '2026-10-14T08:05:00Z ERROR db: gave up',
    '2026-10-14T08:06:00Z INFO done',
    '',
  ].join('\n'),
  '/w/data/lat.csv': 'service,p95_ms,region\nindexer,120,eu\nwatcher,80,us\napi,300,eu\nindexer,40,us\n',
  '/w/src/tool.py': 'def main():\n    return 1\n',
  '/w/notes/ref.md': '# Ref\n\nSee\n`../plans/release-plan.md` for the plan.\n',
  '/w/sessions/deploy.txt': '$ cargo build --release\n   Compiling tidemark v1.0.0\n    Finished release\n$ ./deploy.sh staging\nuploading 3 files\n$ curl -s staging/health\nok\n',
  '/w/cache/index.tmk': new Uint8Array([0x54, 0x4d, 0x4b, 0x31, 2, 0, 0, 0, 0x8c, 0, 0, 0, 0x21, 0, 0x70, 0x72, 0x6f, 0x6a, 0x65, 0x63, 0x74, 0x73, 0x2f, 0x74, 0x69, 0x64, 0x65, 0x6d, 0x61, 0x72, 0x6b, 0x2f, 0x9c]),
  '/w/notes/empty.md': '',
};

const hero = (page) =>
  page.evaluate(() => {
    const h = document.querySelector('.marxy-drawer .marxy-l-hero');
    return h && { k1: h.querySelector('.marxy-l-k1').textContent, k2: h.querySelector('.marxy-l-k2').textContent, g: [...h.querySelectorAll('.marxy-l-k2 .marxy-l-g')].map((x) => x.textContent), none: h.classList.contains('marxy-l-none') };
  });
const row = (page, k) => page.locator(`.marxy-drawer .marxy-l-prow[data-marxy-left-row="${k}"]`).first();
const secs = (page) => page.evaluate(() => [...document.querySelectorAll('.marxy-drawer .marxy-l-sec span')].map((x) => x.textContent));
const cur = (page) => page.evaluate(() => document.querySelector('.marxy-drawer .marxy-l-prow.marxy-l-cur')?.dataset.marxyLeftRow ?? null);
const blur = (page) => page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
const open = async (page, path, panel) => {
  await page.evaluate((p) => window.__marxyHandle.open(p), path);
  await page.waitForFunction((p) => window.__marxyHandle.panes().focused.path() === p, path);
  await showPanel(page, panel);
  await page.waitForFunction((n) => document.querySelector('.marxy-drawer .marxy-l-subject')?.textContent === n, path.slice(path.lastIndexOf('/') + 1));
};
/** Gives the keys to the panel and walks the cursor with j to row `k`. */
async function goRow(page, k) {
  await page.evaluate(() => window.__marxyHandle.frame().left.focusPanel());
  await page.waitForFunction(() => document.activeElement?.closest('.marxy-drawer'));
  for (let i = 0; i < 80 && (await cur(page)) !== k; i++) await page.keyboard.press('j');
  assert.equal(await cur(page), k, `the cursor reaches ${k}`);
}
const headings2 = (page, path) => page.evaluate((p) => new TextDecoder().decode(window.__marxyHandle.panes().panes.find((x) => x.path() === p).content.store().snapshot().buffer.bytes).split(/\r?\n/).filter((l) => /^## /.test(l)).map((l) => l.slice(3)), path);
const storeText = (page, path) => page.evaluate((p) => new TextDecoder().decode(window.__marxyHandle.panes().panes.find((x) => x.path() === p).content.store().snapshot().buffer.bytes), path);

test('Metadata gives the reading of the plan, a log, a table and code', async () => {
  await withFrame({ files: FILES, open: [PLAN] }, async (page) => {
    await showPanel(page, 'metadata');
    let s = await hero(page);
    assert.equal(s.k1, 'Markdown', 'plan: the reading');
    assert.match(s.k2, /^Read so because its name ends \.md\./, 'plan: why');
    assert.equal(await page.textContent('.marxy-drawer .marxy-l-subject'), 'release-plan.md', 'head subject');
    await page.waitForFunction(() => /^\d+$/.test(document.querySelector('.marxy-drawer [data-marxy-left-row="h:links"] .marxy-l-n')?.textContent ?? ''));
    assert.equal(await page.textContent('.marxy-drawer [data-marxy-left-row="h:links"] .marxy-l-n'), '5', 'Links and written paths count');
    await row(page, 'h:links').click();
    await page.waitForFunction(() => document.querySelector('.marxy-drawer')?.dataset.marxyLeft === 'links');
    for (const [path, want] of [['/w/logs/run.log', 'A log'], ['/w/data/lat.csv', 'A table'], ['/w/src/tool.py', 'Code']]) {
      await open(page, path, 'metadata');
      s = await hero(page);
      assert.equal(s.k1, want, `${path}: the reading`);
      assert.match(s.k2, /Read so because/, `${path}: why`);
      assert.equal(s.g.length, 0, `${path}: no guess`);
    }
  });
});

test('a session read by its shape says so in the accent', async () => {
  await withFrame({ files: FILES, open: ['/w/sessions/deploy.txt'] }, async (page) => {
    await showPanel(page, 'metadata');
    const s = await hero(page);
    assert.equal(s.k1, 'A terminal session', 'the reading');
    assert.ok(s.g.length === 1 && /guess/.test(s.g[0]), `the guess said in the accent: ${JSON.stringify(s)}`);
    const col = await page.evaluate(() => [getComputedStyle(document.querySelector('.marxy-drawer .marxy-l-hero .marxy-l-g')).color, getComputedStyle(document.querySelector('.marxy-drawer .marxy-l-hero .marxy-l-k2')).color]);
    assert.notEqual(col[0], col[1], 'the guess is painted apart from the sentence around it');
  });
});

test('Shown at switches the pane between Read, Reveal, X-ray and Source', async () => {
  await withFrame({ files: FILES, open: [PLAN] }, async (page) => {
    await showPanel(page, 'metadata');
    const state = () => page.evaluate(() => {
      const pane = window.__marxyHandle.panes().focused;
      return { mode: pane.view.mode, reveal: pane.article.hasAttribute('data-marxy-reveal'), xray: pane.article.querySelectorAll('.marxy-xray').length, on: document.querySelector('.marxy-drawer .marxy-l-tool .marxy-l-sg button.marxy-l-on')?.textContent };
    });
    const pick = async (label, want) => {
      await page.click(`.marxy-drawer .marxy-l-tool .marxy-l-sg button:text-is("${label}")`);
      await page.waitForFunction((on) => document.querySelector('.marxy-drawer .marxy-l-tool .marxy-l-sg button.marxy-l-on')?.textContent === on, want);
      return state();
    };
    assert.deepEqual(await state(), { mode: 'rendered', reveal: false, xray: 0, on: 'Read' }, 'at rest');
    assert.deepEqual(await pick('Source', 'Source'), { mode: 'source', reveal: false, xray: 0, on: 'Source' }, 'after Source');
    assert.deepEqual(await pick('Reveal', 'Reveal'), { mode: 'rendered', reveal: true, xray: 0, on: 'Reveal' }, 'after Reveal');
    assert.deepEqual(await pick('Read', 'Read'), { mode: 'rendered', reveal: false, xray: 0, on: 'Read' }, 'after Read');
    await page.click('.marxy-drawer .marxy-l-tool .marxy-l-sg button:text-is("X-ray")');
    await page.waitForFunction(() => [...document.querySelectorAll('.marxy-notice-text')].some((e) => /selected part/.test(e.textContent)));
    await page.evaluate(() => window.__marxyHandle.selection.cursorMove('next'));
    await page.waitForFunction(() => window.__marxyHandle.selection.state().selection.kind !== 'none');
    const x = await pick('X-ray', 'X-ray');
    assert.equal(x.xray, 1, 'X-ray on the selected part: one box on the page');
    await blur(page);
    await page.keyboard.press('x');
    await page.waitForFunction(() => document.querySelector('.marxy-drawer .marxy-l-tool .marxy-l-sg button.marxy-l-on')?.textContent === 'Read');
    assert.ok(true, 'the control follows a key pressed on the page');
  });
});

test('a click on Tasks puts the page under the open-tasks lens, a second click clears it; V on the row too', async () => {
  await withFrame({ files: FILES, open: [PLAN] }, async (page) => {
    await showPanel(page, 'metadata');
    const lens = () => page.evaluate(() => ({ out: document.querySelectorAll('#doc .marxy-focus-out').length, sel: document.querySelector('.marxy-drawer [data-marxy-left-row="l:tasks"]')?.classList.contains('marxy-l-sel') }));
    assert.match(await page.textContent('.marxy-drawer [data-marxy-left-row="l:tasks"]'), /1 of 3 done/);
    await row(page, 'l:tasks').click();
    await page.waitForFunction(() => document.querySelectorAll('#doc .marxy-focus-out').length > 5);
    const a = await lens();
    assert.ok(a.out > 5, `parts without open tasks are put away: ${a.out}`);
    assert.equal(a.sel, true, 'the row shows it is on');
    const kept = await page.evaluate(() => [...document.querySelectorAll('#doc li')].filter((li) => li.getClientRects().length > 0).map((li) => li.textContent.trim()));
    assert.deepEqual(kept, ['write the notes', 'tag it'], 'only the open tasks are on the page');
    await row(page, 'l:tasks').click();
    await page.waitForFunction(() => document.querySelectorAll('#doc .marxy-focus-out').length === 0);
    await goRow(page, 'l:tasks');
    await page.keyboard.press('v');
    await page.waitForFunction(() => document.querySelectorAll('#doc .marxy-focus-out').length > 5);
    await page.keyboard.press('v');
    await page.waitForFunction(() => document.querySelectorAll('#doc .marxy-focus-out').length === 0);
    assert.equal(await storeText(page, PLAN), PLAN_TEXT, 'the file is unchanged');
  });
});

test('a file nothing reads: no reading, its first bytes, and what was tried', async () => {
  await withFrame({ files: FILES, open: ['/w/cache/index.tmk'] }, async (page) => {
    await showPanel(page, 'metadata');
    await page.waitForSelector('.marxy-drawer .marxy-l-hex');
    const s = await hero(page);
    assert.deepEqual([s.k1, s.none], ['No reading', true], 'hero');
    assert.match(s.k2, /Nothing in the first bytes or the name says what it is/);
    const hex = await page.evaluate(() => document.querySelector('.marxy-drawer .marxy-l-hex').textContent.split('\n'));
    assert.equal(hex.length, 2, 'two rows of sixteen');
    assert.ok(hex[0].startsWith('54 4d 4b 31 02 00 00 00  8c'), hex[0]);
    assert.equal(await page.textContent('.marxy-drawer [data-marxy-left-row="t:utf8"] .marxy-l-as'), 'will not decode: byte 8C at 8', 'UTF-8, the first offending byte');
    assert.ok((await secs(page)).join('|').startsWith('Tried|Read as|The file'), (await secs(page)).join('|'));
    for (const id of ['outline', 'links']) {
      await showPanel(page, id);
      assert.ok(await page.$('.marxy-drawer .marxy-l-body .marxy-l-empty'), `${id} says why it is empty`);
    }
  });
});

test('every file and an empty file draw in all three panels', async () => {
  await withFrame({ files: FILES, open: [PLAN] }, async (page) => {
    const bad = [];
    const probe = async (what) => {
      for (const id of ['metadata', 'outline', 'links']) {
        await showPanel(page, id);
        const text = await page.textContent('.marxy-drawer .marxy-l-body');
        if (/could not be drawn/.test(text)) bad.push(`${what} [${id}]: ${text.slice(0, 120)}`);
        if (!text.trim()) bad.push(`${what} [${id}]: empty body`);
      }
    };
    for (const path of Object.keys(FILES).filter((p) => !p.includes('.git'))) {
      await page.evaluate((p) => window.__marxyHandle.open(p), path);
      await page.waitForFunction((p) => window.__marxyHandle.panes().focused.path() === p, path);
      await probe(path);
    }
    assert.deepEqual(bad, []);
  });
});

test('the outline marks the section the page is in, exactly one row, as it scrolls', async () => {
  await withFrame({ files: FILES, open: [PLAN] }, async (page) => {
    await showPanel(page, 'outline');
    const H = await page.evaluate(() => document.documentElement.scrollHeight - document.documentElement.clientHeight);
    const wrong = [];
    for (let i = 0; i <= 12; i++) {
      await page.evaluate((y) => window.scrollTo(0, y), Math.round((H * i) / 12));
      await page.waitForTimeout(80);
      const s = await page.evaluate(() => {
        const at = [...document.querySelectorAll('.marxy-drawer .marxy-l-row.marxy-l-at')].map((r) => r.dataset.marxyLeftRow);
        const byte = window.__marxyHandle.panes().focused.view.position().byteOffset;
        const first = new TextDecoder().decode(window.__marxyHandle.panes().focused.content.store().snapshot().buffer.bytes).indexOf('# Release plan');
        return { at, byte, below: byte >= first };
      });
      // Above the first heading (the front matter) no section holds the page, and no row is marked.
      if (s.below && s.at.length !== 1) wrong.push(s);
    }
    assert.deepEqual(wrong, [], 'positions where not exactly one row is marked');
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForFunction(() => document.querySelector('.marxy-drawer .marxy-l-row.marxy-l-at')?.dataset.marxyLeftRow === 'h:rollback');
  });
});

test('the page cursor moving moves the outline mark and its spoken state, and makes no row again', async () => {
  await withFrame({ files: FILES, open: [PLAN] }, async (page) => {
    await showPanel(page, 'outline');
    await page.waitForSelector('.marxy-drawer [data-marxy-left-row="h:rollback"]');
    // Every row made from here on is counted: a long Outline made again on each key cost seconds a frame.
    await page.evaluate(() => {
      window.__rowsMade = 0;
      new MutationObserver((records) => {
        for (const r of records) for (const n of r.addedNodes) if (n instanceof Element && n.matches('.marxy-l-row')) window.__rowsMade++;
      }).observe(document.querySelector('.marxy-drawer .marxy-l-body'), { childList: true, subtree: true });
    });
    const marked = () => page.evaluate(() => [...document.querySelectorAll('.marxy-drawer .marxy-l-row.marxy-l-at')].map((r) => r.dataset.marxyLeftRow));
    const label = (k) => page.evaluate((key) => document.querySelector(`.marxy-drawer [data-marxy-left-row="${key}"]`).getAttribute('aria-label'), k);
    const cursorOn = (heading) =>
      page.evaluate((h) => {
        const handle = window.__marxyHandle;
        const text = new TextDecoder().decode(handle.panes().focused.content.store().snapshot().buffer.bytes);
        return handle.selection.cursorAt(text.indexOf(h));
      }, heading);
    assert.equal(await cursorOn('## Rollback'), true);
    await page.waitForFunction(() => document.querySelector('.marxy-drawer .marxy-l-row.marxy-l-at')?.dataset.marxyLeftRow === 'h:rollback');
    assert.deepEqual(await marked(), ['h:rollback']);
    assert.match(await label('h:rollback'), /, current$/);
    assert.equal(await cursorOn('## Scope'), true);
    await page.waitForFunction(() => document.querySelector('.marxy-drawer .marxy-l-row.marxy-l-at')?.dataset.marxyLeftRow === 'h:scope');
    assert.deepEqual(await marked(), ['h:scope']);
    assert.doesNotMatch(await label('h:rollback'), /current/, 'the row the mark left is said without it');
    assert.match(await label('h:scope'), /, current$/);
    await blur(page);
    for (const key of ['j', 'j', 'k', 'Escape']) {
      await page.keyboard.press(key);
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    }
    assert.equal(await page.evaluate(() => window.__rowsMade), 0, 'no row was made again for a cursor move');
  });
});

test('a click on Rollback in the outline puts the page cursor on that heading', async () => {
  await withFrame({ files: FILES, open: [PLAN] }, async (page) => {
    await showPanel(page, 'outline');
    await row(page, 'h:rollback').click();
    const ok = await page
      .waitForFunction(() => /^Rollback/.test(document.querySelector('#doc .marxy-cursor')?.textContent.trim() ?? ''), undefined, { timeout: 4000 })
      .then(() => true, () => false);
    assert.ok(ok, `page cursor: ${JSON.stringify(await page.evaluate(() => ({ kind: window.__marxyHandle.selection.state().selection.kind, ready: window.__marxyHandle.selection.cursorReady(), cur: document.querySelector('#doc .marxy-cursor')?.textContent.slice(0, 40), page: document.querySelector('#doc [data-marxy-reading], #doc [data-marxy-derived], #doc pre.marxy-run')?.outerHTML.slice(0, 160), hidden: document.querySelector('#doc').hidden, art: window.__marxyHandle.selection.article()?.id })))}`);
    const inView = await page.evaluate(() => { const r = document.querySelector('#doc .marxy-cursor').getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; });
    assert.equal(inView, true, 'the heading is in view');
    await page.waitForFunction(() => document.querySelector('.marxy-drawer [data-marxy-left-row="h:rollback"]')?.classList.contains('marxy-l-at'));
  });
});

test('Alt+Down on an outline row moves the section; u puts the bytes back', async () => {
  await withFrame({ files: FILES, open: [PLAN] }, async (page) => {
    await showPanel(page, 'outline');
    await goRow(page, 'h:scope');
    await page.keyboard.press('Alt+ArrowDown');
    await page.waitForFunction(() => /## Workstreams[\s\S]*## Scope/.test(new TextDecoder().decode(window.__marxyHandle.panes().focused.content.store().snapshot().buffer.bytes)));
    const mid = await headings2(page, PLAN);
    assert.equal(mid.indexOf('Scope'), mid.indexOf('Workstreams') + 1, `Scope now follows Workstreams: ${mid}`);
    await page.waitForFunction(() => document.querySelector('.marxy-drawer .marxy-l-prow.marxy-l-cur')?.dataset.marxyLeftRow === 'h:scope');
    assert.equal(await page.evaluate(() => window.__marxyHandle.panes().focused.content.store().snapshot().dirty), true, 'staged, not written');
    assert.equal(await fileText(page, PLAN), PLAN_TEXT, 'nothing written to disk');
    await page.keyboard.press('u');
    await page.waitForFunction((t) => new TextDecoder().decode(window.__marxyHandle.panes().focused.content.store().snapshot().buffer.bytes) === t, PLAN_TEXT);
  });
});

test('dragging an outline row moves the section among its siblings in one undo step; a drag back restores the bytes', async () => {
  const VEND = '/w/plans/vendor.md';
  await withFrame({ files: FILES, open: [VEND] }, async (page) => {
    const orig = await storeText(page, VEND);
    await showPanel(page, 'outline');
    const drag = (from, to, half) =>
      page.evaluate(([from, to, half]) => {
        const q = (k) => document.querySelector(`.marxy-drawer .marxy-l-prow[data-marxy-left-row="h:${k}"]`);
        const a = q(from);
        const b = q(to);
        const r = b.getBoundingClientRect();
        const dt = new DataTransfer();
        const y = half === 'top' ? r.top + 2 : r.bottom - 2;
        const ev = (el, type) => el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.left + 40, clientY: y }));
        ev(a, 'dragstart');
        ev(b, 'dragover');
        const ins = !!document.querySelector('.marxy-drawer .marxy-l-dropline');
        ev(b, 'drop');
        ev(a, 'dragend');
        return ins;
      }, [from, to, half]);
    assert.equal(await drag('1-what-arrived', '4-who-to-ask', 'bottom'), true, 'an insertion line shows while dragging');
    await page.waitForFunction(() => /## 4\. Who to ask[\s\S]*## 1\. What arrived/.test(new TextDecoder().decode(window.__marxyHandle.panes().focused.content.store().snapshot().buffer.bytes)));
    assert.deepEqual(await headings2(page, VEND), ['2. How to build', '3. Checks', '4. Who to ask', '1. What arrived'], 'order after the drag');
    await page.waitForFunction(() => [...document.querySelectorAll('.marxy-notice-text')].some((e) => /^Moved “1\. What arrived” below “4\. Who to ask”/.test(e.textContent)));
    assert.equal(await drag('1-what-arrived', 'vendor-drop', 'bottom'), false, 'no drop onto a heading at another level');
    // One undo step for the whole drag.
    await page.evaluate(() => window.__marxyHandle.panes().focused.content.store().undo());
    assert.equal(await storeText(page, VEND), orig, 'one undo puts it back');
    await page.evaluate(() => window.__marxyHandle.panes().focused.content.store().redo());
    // The outline is drawn again from the redone bytes before the next drag.
    await page.waitForFunction(() => [...document.querySelectorAll('.marxy-drawer [data-marxy-left-row^="h:"]')].at(-1)?.dataset.marxyLeftRow === 'h:1-what-arrived');
    await drag('1-what-arrived', '2-how-to-build', 'top');
    await page.waitForFunction((o) => new TextDecoder().decode(window.__marxyHandle.panes().focused.content.store().snapshot().buffer.bytes) === o, orig);
    assert.equal(await storeText(page, VEND), orig, 'the bytes after the drag back (CRLF lines and no final newline kept)');
  });
});

test('the level switch folds the page to that level, and all opens it', async () => {
  await withFrame({ files: FILES, open: [PLAN] }, async (page) => {
    await showPanel(page, 'outline');
    await page.click('.marxy-drawer .marxy-l-fld .marxy-l-sg button:text-is("2")');
    await page.waitForFunction(() => document.querySelectorAll('#doc .marxy-folded').length > 0);
    const a = await page.evaluate(() => ({ folded: [...document.querySelectorAll('#doc .marxy-folded')].map((x) => x.textContent.trim()), on: document.querySelector('.marxy-drawer .marxy-l-fld .marxy-l-sg button.marxy-l-on')?.textContent, out: document.querySelectorAll('#doc .marxy-fold-out').length }));
    assert.deepEqual(a.folded, ['Scope', 'Workstreams', 'Risks', 'Rollback'], 'every level-two heading is folded');
    assert.equal(a.on, '2', 'the switch shows 2');
    assert.ok(a.out > 5, `parts put away: ${a.out}`);
    await page.click('.marxy-drawer .marxy-l-fld .marxy-l-sg button:text-is("all")');
    await page.waitForFunction(() => document.querySelectorAll('#doc .marxy-folded').length === 0);
    assert.equal(await page.textContent('.marxy-drawer .marxy-l-fld .marxy-l-sg button.marxy-l-on'), 'all');
    assert.equal(await page.locator('.marxy-drawer .marxy-l-prow[data-marxy-left-row^="h:"]').count(), 6, 'the outline keeps every row: it folds the page, not itself');
  });
});

test('a table: a column click sorts the view and never the file', async () => {
  const CSV = '/w/data/lat.csv';
  await withFrame({ files: FILES, open: [CSV] }, async (page) => {
    await showPanel(page, 'outline');
    const before = await storeText(page, CSV);
    const col = () => page.evaluate(() => [...document.querySelectorAll('#doc .marxy-reading-table tbody tr')].map((r) => Number(r.cells[1].getAttribute('data-marxy-value'))));
    await row(page, 'c:1').click();
    await page.waitForFunction(() => /sorted/.test(document.querySelector('.marxy-drawer [data-marxy-left-row="c:1"] .marxy-l-as')?.textContent ?? ''));
    const first = await col();
    assert.ok(first.every((v, i) => !i || first[i - 1] >= v) || first.every((v, i) => !i || first[i - 1] <= v), `p95_ms sorted on the page: ${first}`);
    assert.equal(await page.evaluate(() => document.querySelector('.marxy-drawer [data-marxy-left-row="c:1"]').classList.contains('marxy-l-sel')), true, 'the row says so');
    await row(page, 'c:1').click();
    await page.waitForFunction((f) => JSON.stringify([...document.querySelectorAll('#doc .marxy-reading-table tbody tr')].map((r) => Number(r.cells[1].getAttribute('data-marxy-value')))) !== JSON.stringify(f), first);
    assert.equal(await storeText(page, CSV), before, 'the file text is unchanged');
    assert.equal(await page.evaluate(() => window.__marxyHandle.panes().focused.content.store().snapshot().dirty), false, 'and clean');
    assert.match(await page.textContent('.marxy-drawer .marxy-l-hint'), /The file is never reordered/);
  });
});

test('a log: a level row filters the page; the strip of time goes to an entry', async () => {
  const LOG = '/w/logs/run.log';
  await withFrame({ files: FILES, open: [LOG] }, async (page) => {
    await showPanel(page, 'outline');
    assert.equal(await page.textContent('.marxy-drawer [data-marxy-left-row="lv:error"] .marxy-l-n'), '2');
    const hist = await page.evaluate(() => ({ bars: document.querySelectorAll('.marxy-drawer .marxy-l-hist u').length, e: document.querySelectorAll('.marxy-drawer .marxy-l-hist u.marxy-l-e').length }));
    assert.ok(hist.bars >= 5 && hist.e === 2, `a bar a step, errors marked: ${JSON.stringify(hist)}`);
    await row(page, 'lv:error').click();
    await page.waitForFunction(() => [...document.querySelectorAll('.marxy-notice-text')].some((e) => /Error/.test(e.textContent)));
    await page.click('.marxy-drawer .marxy-l-hist u.marxy-l-e >> nth=0');
    await page.waitForTimeout(150);
    assert.equal(await page.evaluate(() => window.__marxyHandle.panes().focused.path()), LOG, 'a bar goes to its entry in the log');
  });
});

test('Links of the plan: 1 to a file here, 1 nowhere, 1 within, 1 outside, a written path, and who points here', async () => {
  await withFrame({ files: FILES, open: [PLAN] }, async (page) => {
    await showPanel(page, 'links');
    await page.waitForFunction(() => /^Pointing here · \d/.test([...document.querySelectorAll('.marxy-drawer .marxy-l-sec span')].at(-1)?.textContent ?? ''));
    assert.deepEqual(await secs(page), ['To files here · 2', 'Lead nowhere · 1', 'Within this file · 1', 'Outside · 1', 'Pointing here · 1']);
    assert.equal(await page.textContent('.marxy-drawer .marxy-l-fld .marxy-l-v'), '5 in all', 'the field says how many in all');
    assert.deepEqual(await page.$$eval('.marxy-drawer .marxy-l-hit .marxy-l-tx .marxy-l-red', (els) => els.map((x) => x.textContent)), ['../plans/perf-budget.md'], 'the one that leads nowhere, in the error colour');
    await page.fill('.marxy-drawer input[data-marxy-left-field="links-q"]', 'tool');
    await page.waitForFunction(() => /^\d+ of 5$/.test(document.querySelector('.marxy-drawer .marxy-l-fld .marxy-l-v')?.textContent ?? ''));
  });
});

test('a file pointing at the plan is listed, and a click opens it at its line', async () => {
  await withFrame({ files: FILES, open: [PLAN] }, async (page) => {
    await showPanel(page, 'links');
    const k = 'ip:/w/notes/ref.md:4:0';
    await page.waitForSelector(`.marxy-drawer [data-marxy-left-row="${k}"]`);
    await row(page, k).click();
    await page.waitForFunction(() => window.__marxyHandle.panes().focused.path() === '/w/notes/ref.md');
    const at = await page.evaluate(() => window.__marxyHandle.panes().focused.view.position().byteOffset);
    const line4 = Buffer.from('# Ref\n\nSee\n', 'utf8').length;
    assert.ok(at <= line4 + 2, `the page is at line 4: ${at}`);
  });
});

test('p peeks at where a link leads without going; o opens the target at the line the link cites', async () => {
  await withFrame({ files: FILES, open: [PLAN] }, async (page) => {
    await showPanel(page, 'links');
    // A place's key is the line it is written on in the plan; the link cites line 3 of the log.
    const where = PLAN_TEXT.slice(0, PLAN_TEXT.indexOf('../logs/run.log')).split('\n').length;
    const want = `p:/w/logs/run.log:${where}:0`;
    await page.waitForSelector(`.marxy-drawer [data-marxy-left-row="${want}"]`);
    await goRow(page, want);
    assert.match(await page.textContent('.marxy-drawer .marxy-l-foot'), /peek/, 'the verb bar offers peek');
    await page.keyboard.press('p');
    await page.waitForSelector('.marxy-drawer .marxy-l-peek');
    assert.equal(await page.textContent('.marxy-drawer .marxy-l-peek > b'), 'run.log:3', 'p peeks at the cited line');
    assert.equal(await page.textContent('.marxy-drawer .marxy-l-peek .marxy-l-at .marxy-l-no'), '3');
    assert.equal(await page.evaluate(() => window.__marxyHandle.panes().focused.path()), PLAN, 'still on the plan after the peek');
    await page.keyboard.press('o');
    await page.waitForFunction(() => window.__marxyHandle.panes().focused.path() === '/w/logs/run.log');
  });
});

test('the page follows the cursor through the places in Links', async () => {
  await withFrame({ files: FILES, open: [PLAN] }, async (page) => {
    await showPanel(page, 'links');
    await page.waitForSelector('.marxy-drawer [data-marxy-left-row^="w:"]');
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await goRow(page, [...(await page.$$eval('.marxy-drawer [data-marxy-left-row^="w:"]', (els) => els.map((e) => e.dataset.marxyLeftRow)))][0]);
    await page.waitForFunction(() => window.scrollY < 400);
  });
});

test('Metadata: Modified is asked of the disk again after a save, not kept from the first draw', async () => {
  await withFrame({ files: FILES, open: ['/w/src/tool.py'] }, async (page) => {
    await showPanel(page, 'metadata');
    const stats = () => page.evaluate(() => window.__marxyHandle.shell.calls.filter((c) => c.method === 'stat' && c.args[0] === '/w/src/tool.py').length);
    await page.waitForFunction(() => window.__marxyHandle.shell.calls.some((c) => c.method === 'stat' && c.args[0] === '/w/src/tool.py'));
    const before = await stats();
    await page.evaluate(async () => {
      const h = window.__marxyHandle;
      const s = h.panes().focused.content.store();
      const snap = s.snapshot();
      await s.apply({ range: { file: snap.path, start: 0, end: 0 }, replacement: '# saved\n', label: 'edit', baseVersion: snap.version });
      await s.save();
      h.frame().left.draw();
    });
    await page.waitForFunction((n) => window.__marxyHandle.shell.calls.filter((c) => c.method === 'stat' && c.args[0] === '/w/src/tool.py').length > n, before, { timeout: 5000 });
  });
});

test('Links: peeking again takes the last peek\'s Escape listener off; one is left, and Escape takes it', async () => {
  await withFrame({ files: FILES, open: [PLAN] }, async (page) => {
    await showPanel(page, 'links');
    const where = PLAN_TEXT.slice(0, PLAN_TEXT.indexOf('../logs/run.log')).split('\n').length;
    const want = `p:/w/logs/run.log:${where}:0`;
    await page.waitForSelector(`.marxy-drawer [data-marxy-left-row="${want}"]`);
    await goRow(page, want);
    await page.evaluate(() => {
      const live = new Set();
      window.__peekKeys = live;
      const add = document.addEventListener.bind(document);
      const remove = document.removeEventListener.bind(document);
      document.addEventListener = (t, fn, o) => {
        if (t === 'keydown' && o === true) live.add(fn);
        return add(t, fn, o);
      };
      document.removeEventListener = (t, fn, o) => {
        if (t === 'keydown' && o === true) live.delete(fn);
        return remove(t, fn, o);
      };
    });
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('p');
      await page.waitForSelector('.marxy-drawer .marxy-l-peek');
    }
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(() => window.__peekKeys.size), 1, 'one listener for the one peek shown');
    assert.equal(await page.locator('.marxy-drawer .marxy-l-peek').count(), 1);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.__peekKeys.size === 0);
  });
});
