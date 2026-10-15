// The inspector's Outline tab (W-10), in the real app over the memory shell, in WebKit. What the reader sees: the tab lists the
// document's headings indented by level with the words of each section, a table under its section, and marks the section under
// the reading line (Read) or the caret (Source); a row jumps; ⌥↓ and ⌥↑ move the whole section and one undo puts the exact bytes
// back; the menu offers the four actions and says why one is unavailable; the list follows the document live; "where you are" in
// the status bar opens the tab. The rules are outline-tab.test.ts; the bytes of a move are core's move-section.test.ts.
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { after, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { bootTwoPanes, closeHarness } from './support/two-pane.mjs';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);
after(() => closeHarness());

// fixtures/corpus/32-long-reference.md, repeated until it holds 5,000 headings (a heading outside a fence), and a short one of fifty.
const reference = readFileSync(new URL('../../../fixtures/corpus/32-long-reference.md', import.meta.url), 'utf8');
const headingsIn = (text) => { let fence = false, n = 0; for (const line of text.split('\n')) { if (/^ {0,3}(```|~~~)/.test(line)) fence = !fence; else if (!fence && /^#{1,6}\s/.test(line)) n++; } return n; };
const repeatedTo = (headings) => { const per = headingsIn(reference); return Array.from({ length: Math.ceil(headings / per) }, () => reference).join('\n\n'); };

const para = (i) => `Paragraph ${i} runs long enough to be a paragraph of the reading column and no more than that.`;
const filler = (n, from = 0) => Array.from({ length: n }, (_, i) => para(from + i)).join('\n\n');
// Words by hand: "Plan" 1 + "One two three." 3 + Method 3 + Results 2 (+ the table and filler counted below).
const PLAN = [
  '# Plan', '', 'One two three.', '',
  '## Method', '', 'Alpha beta.', '',
  '| Step | Who |', '|---|---|', '| 1 | me |', '',
  '```sh', '# a comment, not a heading', '```', '',
  filler(30), '',
  '## Results', '', 'Gamma.', '',
  filler(30, 100), '',
  '# Last', '', 'End.', '',
].join('\n');
const SMALL = '# One\n\nfirst words\n\n## One A\n\nA a\n\n## One B\n\nB b\n\n# Two\n\nsecond\n';
const files = {
  '/r/Plan.md': PLAN,
  '/r/Small.md': SMALL,
  '/r/None.md': 'Just a paragraph, no heading at all.\n',
  '/r/crlf.md': '# A\r\n\r\na\r\n\r\n# B\r\n\r\nb',
  '/r/main.rs': 'fn main() {}\n',
  '/r/Front.md': '---\ntitle: Front title\n---\n\nIntro words in the preamble.\n\n## Section\n\ntext here\n',
  '/r/Ref5k.md': repeatedTo(5000),
  '/r/Ref50.md': repeatedTo(50).split('\n').slice(0, 400).join('\n'),
  '/r/Many.md': Array.from({ length: 2000 }, (_, i) => `${i % 4 === 0 ? '#' : '##'} Heading ${i}\n\nword ${i}\n`).join('\n'),
};

async function withPage(fn, { open = ['/r/Small.md'], tab = true, width = 1700 } = {}) {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await bootTwoPanes(page, { files, open });
    await page.evaluate(() => window.__marxyHandle.workspace().unfold());
    if (tab) {
      await page.evaluate(async () => {
        const { selectInspectorTab } = await import('/src/workspace/inspector.ts');
        selectInspectorTab('outline');
      });
      await page.waitForSelector('.marxy-outline');
    }
    await fn(page);
  } finally {
    await browser.close();
  }
}

const frames = (page, n = 2) => page.evaluate((count) => new Promise((resolve) => { let left = count; const tick = () => (--left <= 0 ? resolve() : requestAnimationFrame(tick)); requestAnimationFrame(tick); }), n);
const rowsOf = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('.marxy-outline-item')].map((li) => {
      const row = li.querySelector('[data-marxy-outline-row]');
      return {
        kind: row.getAttribute('data-marxy-outline-row'),
        text: row.querySelector('.marxy-outline-text').textContent,
        words: row.querySelector('.marxy-outline-words')?.textContent ?? null,
        level: row.getAttribute('data-marxy-outline-level'),
        indent: parseFloat(getComputedStyle(row).paddingInlineStart),
        current: row.getAttribute('aria-current'),
        start: Number(row.getAttribute('data-marxy-outline-start')),
      };
    }),
  );
const bytesOf = (page) => page.evaluate(() => new TextDecoder().decode(window.__marxyHandle.document().snapshot().buffer.bytes));
const activeRow = (page) => page.evaluate(() => document.activeElement?.querySelector?.('.marxy-outline-text')?.textContent ?? document.activeElement?.className ?? null);
const modOf = (page) => page.evaluate(() => (navigator.platform.toUpperCase().includes('MAC') ? 'Meta' : 'Control'));
const focusRow = (page, text) =>
  page.evaluate((t) => {
    const row = [...document.querySelectorAll('[data-marxy-outline-row="heading"]')].find((r) => r.querySelector('.marxy-outline-text').textContent === t);
    row.focus();
  }, text);

test('the tab lists the headings by level with the words of each section, a table under its section, and nothing from a fence', async () => {
  await withPage(async (page) => {
    assert.deepEqual((await rowsOf(page)).map((r) => [r.text, r.words, r.level]), [
      ['One', '11', '1'],
      ['One A', '4', '2'],
      ['One B', '4', '2'],
      ['Two', '2', '1'],
    ]);
    const rows = await rowsOf(page);
    assert.ok(rows[1].indent > rows[0].indent && rows[2].indent === rows[1].indent, 'a sub-section is indented, siblings alike');
    assert.equal(await page.evaluate(() => document.querySelector('.marxy-outline-count').textContent), '4 headings');
    assert.equal(await page.evaluate(() => document.querySelector('[data-marxy-outline-row="heading"]').title), '11 words in this section, with its sub-sections');
  });
  await withPage(async (page) => {
    const rows = await rowsOf(page);
    assert.deepEqual(rows.map((r) => (r.kind === 'table' ? r.text : `#${r.text}`)), ['#Plan', '#Method', 'Table: Step, Who', '#Results', '#Last']);
    assert.equal(rows[2].indent > rows[1].indent, true, 'the table sits in from its section');
    const words = Object.fromEntries(rows.filter((r) => r.kind === 'heading').map((r) => [r.text, Number(r.words.replace(/,/g, ''))]));
    assert.equal(words.Method > 5 + 30 * 17 - 1, true, 'the filler is counted in the section that holds it');
    // The bar's measure counts the whole text with the same counter: the outermost section plus what is above it is that number.
    const total = await page.evaluate(() => Number(document.querySelector('[data-marxy-status-item="measure"]').textContent.replace(/[^0-9]/g, '')));
    assert.equal(words.Plan + words.Last, total, 'the sections are the status bar\'s words, split');
  }, { open: ['/r/Plan.md'] });
});

test('a document with no heading says so, and a file that opens in Source says the outline is listed for Markdown', async () => {
  await withPage(async (page) => {
    assert.equal(await page.evaluate(() => document.querySelector('.marxy-outline').textContent), 'No headingsNo headings in this document.');
    assert.equal(await page.evaluate(() => document.querySelector('.marxy-outline-copy')), null, 'nothing to copy');
    await page.evaluate(() => window.__marxyHandle.open('/r/main.rs'));
    await page.waitForFunction(() => document.querySelector('.marxy-outline')?.textContent.includes('listed for Markdown'));
  }, { open: ['/r/None.md'] });
});

test('"where you are" in the status bar opens the Outline tab, and the section under the reading line is marked as the page scrolls', async () => {
  await withPage(async (page) => {
    const where = '[data-marxy-status-item="where"]';
    await page.waitForSelector(`button${where}`);
    await page.click(`button${where}`);
    await page.waitForSelector('.marxy-outline');
    assert.equal(await page.evaluate(() => document.querySelector('[data-marxy-inspector-tab="outline"]').hasAttribute('data-marxy-inspector-tab-active')), true);
    const marked = async () => (await rowsOf(page)).filter((r) => r.current === 'location').map((r) => r.text);
    await page.waitForFunction(() => document.querySelector('[aria-current="location"]'));
    assert.deepEqual(await marked(), ['Plan']);
    await page.evaluate((at) => window.__marxyHandle.open('/r/Plan.md', { at }), PLAN.indexOf('## Results') + 30);
    await page.waitForFunction(() => document.querySelector('[aria-current="location"] .marxy-outline-text')?.textContent === 'Results');
    assert.deepEqual(await marked(), ['Results']);
    // The bar names the same section.
    assert.equal(await page.evaluate(() => document.querySelector('[data-marxy-status-item="where"]').textContent), 'Results');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForFunction(() => document.querySelector('[aria-current="location"] .marxy-outline-text')?.textContent === 'Plan');
  }, { open: ['/r/Plan.md'], tab: false });
});

test('a row jumps to its heading on click and on Enter', async () => {
  await withPage(async (page) => {
    const rows = await rowsOf(page);
    const start = rows.find((r) => r.text === 'Results').start;
    await page.click('[data-marxy-outline-row="heading"][data-marxy-outline-start="' + start + '"]');
    await page.waitForFunction((s) => Math.abs(window.__marxyHandle.sourceHarness().byteOffset - s) < 200, start);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForFunction(() => window.__marxyHandle.sourceHarness().byteOffset < 30);
    await focusRow(page, 'Last');
    await page.keyboard.press('Enter');
    const last = rows.find((r) => r.text === 'Last').start;
    await page.waitForFunction((s) => Math.abs(window.__marxyHandle.sourceHarness().byteOffset - s) < 200, last);
  }, { open: ['/r/Plan.md'] });
});

test('⌥↓ on a row moves its whole section; the row keeps focus; one Mod+Z puts back the original bytes', async () => {
  await withPage(async (page) => {
    const original = await bytesOf(page);
    await focusRow(page, 'One');
    await page.keyboard.press('Alt+ArrowDown');
    await page.waitForFunction(() => document.querySelector('[data-marxy-outline-row="heading"]')?.querySelector('.marxy-outline-text').textContent === 'Two');
    assert.equal(await bytesOf(page), '# Two\n\nsecond\n# One\n\nfirst words\n\n## One A\n\nA a\n\n## One B\n\nB b\n\n', 'the sections traded places, each with its own bytes');
    assert.deepEqual((await rowsOf(page)).map((r) => r.text), ['Two', 'One', 'One A', 'One B']);
    assert.equal(await activeRow(page), 'One', 'focus followed the section');
    await page.keyboard.press(`${await modOf(page)}+KeyZ`);
    await page.waitForFunction((o) => new TextDecoder().decode(window.__marxyHandle.document().snapshot().buffer.bytes) === o, original);
    assert.deepEqual((await rowsOf(page)).map((r) => r.text), ['One', 'One A', 'One B', 'Two'], 'the list follows the undo');
    // Nothing else is in the history: one undo was all it took.
    assert.equal(await page.evaluate(() => window.__marxyHandle.document().snapshot().canUndo), false);
  });
});

test('⌥↑ on the first section of its level changes nothing and says why; the menu\'s unavailable items say the same', async () => {
  await withPage(async (page) => {
    const original = await bytesOf(page);
    await focusRow(page, 'One A');
    await page.keyboard.press('Alt+ArrowUp');
    await page.waitForFunction(() => document.querySelector('.marxy-notice')?.textContent.includes('first section at its level'));
    assert.equal(await bytesOf(page), original);
    assert.equal(await page.evaluate(() => window.__marxyHandle.document().snapshot().canUndo), false);
    // The menu, from the keyboard: four actions, the two that cannot apply are marked and carry their reason.
    await page.keyboard.press('ContextMenu');
    await page.waitForSelector('.marxy-outline-menu');
    const items = await page.evaluate(() => [...document.querySelectorAll('.marxy-outline-menu-item')].map((b) => ({ action: b.getAttribute('data-marxy-outline-action'), disabled: b.getAttribute('aria-disabled') === 'true', title: b.title, name: b.querySelector('.marxy-outline-menu-name').textContent, key: b.querySelector('.marxy-outline-menu-key')?.textContent ?? null })));
    assert.deepEqual(items.map((i) => [i.action, i.disabled]), [['move-up', true], ['move-down', false], ['promote', false], ['demote', false]]);
    assert.match(items[0].title, /first section at its level/);
    assert.deepEqual(items.map((i) => i.name), ['Move section up', 'Move section down', 'Promote heading', 'Demote heading']);
    assert.equal(items[1].key !== null && items[0].key !== null && items[2].key === null, true, 'the two moves show their keys');
    // Esc closes the menu and leaves the workspace unfolded (the order of Esc: the menu first).
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => document.querySelector('.marxy-outline-menu')), null);
    assert.equal(await page.evaluate(() => window.__marxyHandle.workspace().mode), 'unfolded');
    assert.equal(await activeRow(page), 'One A', 'focus is back on the row');
  });
});

test('the menu\'s Demote and Promote change the level of the section, as one undo step each', async () => {
  await withPage(async (page) => {
    await focusRow(page, 'One A');
    await page.keyboard.press('ContextMenu');
    await page.waitForSelector('.marxy-outline-menu');
    await page.click('[data-marxy-outline-action="demote"]');
    await page.waitForFunction(() => document.querySelector('[data-marxy-outline-start]') && [...document.querySelectorAll('[data-marxy-outline-level]')].some((r) => r.getAttribute('data-marxy-outline-level') === '3'));
    assert.equal(await bytesOf(page), SMALL.replace('## One A', '### One A'));
    await page.click('[data-marxy-outline-start]'); // the first row's click is a jump, not an action
    await focusRow(page, 'One A');
    await page.keyboard.press('Shift+F10');
    await page.waitForSelector('.marxy-outline-menu');
    await page.click('[data-marxy-outline-action="promote"]');
    await page.waitForFunction((o) => new TextDecoder().decode(window.__marxyHandle.document().snapshot().buffer.bytes) === o, SMALL);
    assert.equal(await page.evaluate(() => window.__marxyHandle.document().snapshot().canUndo), true);
  });
});

test('the list follows the document: an external change relists it, and so does an edit', async () => {
  await withPage(async (page) => {
    await page.evaluate(async () => {
      const path = window.__marxyHandle.currentPath();
      await window.__marxyHandle.shell.writeFileAtomic(path, new TextEncoder().encode('# Changed outside\n\nfive words are here now\n\n## Second\n\ntwo\n'));
      window.__marxyHandle.shell.emit([{ kind: 'modified', path }]);
    });
    await page.waitForFunction(() => document.querySelector('.marxy-outline-text')?.textContent === 'Changed outside');
    assert.deepEqual((await rowsOf(page)).map((r) => [r.text, r.words]), [['Changed outside', '9'], ['Second', '2']]);
    // An edit through the store (what a Rendered edit or an operation does) relists it too.
    await page.evaluate(async () => {
      const store = window.__marxyHandle.document();
      await store.apply({ range: { file: store.snapshot().path, start: 0, end: 0 }, replacement: '# New first\n\n', label: 'test edit', baseVersion: store.snapshot().version });
    });
    await page.waitForFunction(() => document.querySelector('.marxy-outline-text')?.textContent === 'New first');
    assert.equal((await rowsOf(page)).length, 3);
  });
});

test('in Source the caret\'s section is marked, and a move made from the tab reaches the editor', async () => {
  await withPage(async (page) => {
    await page.evaluate(() => window.__marxyHandle.toggleMode());
    await page.waitForFunction(() => window.__marxyHandle.panes().focused.view.mode === 'source' && document.querySelector('#marxy-source .cm-content'));
    // The caret into "Two": click at the end of the document.
    await page.evaluate(async () => {
      const { activeSourceEditor } = await import('/src/source/editor.ts');
      const view = activeSourceEditor(window.__marxyHandle.panes().focused.parts.source).view;
      view.dispatch({ selection: { anchor: view.state.doc.length } });
      view.focus();
    });
    await page.waitForFunction(() => document.querySelector('[aria-current="location"] .marxy-outline-text')?.textContent === 'Two');
    await focusRow(page, 'Two');
    await page.keyboard.press('Alt+ArrowUp');
    await page.waitForFunction(() => document.querySelector('[data-marxy-outline-row="heading"] .marxy-outline-text')?.textContent === 'Two');
    const editor = await page.evaluate(async () => {
      const { activeSourceEditor } = await import('/src/source/editor.ts');
      return activeSourceEditor(window.__marxyHandle.panes().focused.parts.source).view.state.doc.toString();
    });
    assert.equal(editor, await bytesOf(page), 'Source shows the bytes the move wrote');
    assert.match(editor, /^# Two\n/);
  });
});

test('Copy outline puts the headings on the pasteboard as a nested Markdown list', async () => {
  await withPage(async (page) => {
    await page.click('[data-marxy-outline-action="copy"]');
    await page.waitForFunction(() => window.__marxyHandle.shell.calls.some((c) => c.method === 'clipboardWriteItem'));
    const text = await page.evaluate(() => {
      const write = window.__marxyHandle.shell.calls.filter((c) => c.method === 'clipboardWriteItem').at(-1);
      return new TextDecoder().decode(write.args[0].find((rep) => rep.type === 'public.utf8-plain-text').bytes);
    });
    assert.equal(text, '- One\n  - One A\n  - One B\n- Two\n');
  });
});

test('a CRLF file with no final line ending is moved with CRLF and still ends without one', async () => {
  await withPage(async (page) => {
    await focusRow(page, 'B');
    await page.keyboard.press('Alt+ArrowUp');
    await page.waitForFunction(() => document.querySelector('[data-marxy-outline-row="heading"] .marxy-outline-text')?.textContent === 'B');
    assert.equal(await bytesOf(page), '# B\r\n\r\nb\r\n\r\n# A\r\n\r\na');
  }, { open: ['/r/crlf.md'] });
});

test('the move commands are offered when a row has focus or a section is selected, and not otherwise; running one moves the section', async () => {
  await withPage(async (page) => {
    const ask = (focus) =>
      page.evaluate(async (row) => {
        const { commands } = await import('/src/commands/index.ts');
        const store = window.__marxyHandle.document();
        const ast = store.snapshot().ast;
        const heading = ast.children.find((b) => b.type === 'heading' && b.src.start === row);
        const ctx = (node) => ({ document: store, operationInput: () => (node ? { node, range: node.src, text: '' } : null), operationInputs: () => [], closePalette() {}, showNotice() {} });
        const list = commands().filter((c) => c.id.startsWith('outline.move-section-'));
        return Object.fromEntries(list.map((c) => [c.id, { none: c.when(ctx(null)), selected: heading ? c.when(ctx(heading)) : null }]));
      }, focus);
    const two = (await rowsOf(page)).find((r) => r.text === 'Two').start;
    const one = (await rowsOf(page)).find((r) => r.text === 'One').start;
    // Nothing selected and no row focused: not offered.
    assert.deepEqual(await ask(two), { 'outline.move-section-up': { none: false, selected: true }, 'outline.move-section-down': { none: false, selected: false } });
    assert.deepEqual(await ask(one), { 'outline.move-section-up': { none: false, selected: false }, 'outline.move-section-down': { none: false, selected: true } });
    // A row with focus is the target without any selection.
    await focusRow(page, 'One');
    assert.equal(await page.evaluate(async () => {
      const { commands } = await import('/src/commands/index.ts');
      const store = window.__marxyHandle.document();
      const ctx = { document: store, operationInput: () => null, operationInputs: () => [], closePalette() {}, showNotice() {} };
      const down = commands().find((c) => c.id === 'outline.move-section-down');
      const up = commands().find((c) => c.id === 'outline.move-section-up');
      return [down.when(ctx), up.when(ctx)].join();
    }), 'true,false');
    await page.evaluate(async () => {
      const { commands } = await import('/src/commands/index.ts');
      const store = window.__marxyHandle.document();
      const ctx = { document: store, operationInput: () => null, operationInputs: () => [], closePalette() {}, showNotice() {} };
      await commands().find((c) => c.id === 'outline.move-section-down').run(ctx);
    });
    assert.match(await bytesOf(page), /^# Two\n/);
  });
});

test('a title that only front matter holds is the top row, and it is the row marked above the first heading, as the status bar says', async () => {
  await withPage(async (page) => {
    const rows = await rowsOf(page);
    assert.deepEqual(rows.map((r) => [r.kind, r.text]), [['title', 'Front title'], ['heading', 'Section']]);
    await page.waitForFunction(() => document.querySelector('[aria-current="location"]'));
    assert.equal((await rowsOf(page))[0].current, 'location');
    assert.equal(await page.evaluate(() => document.querySelector('[data-marxy-status-item="where"]').textContent), 'Front title');
    // Its row is a jump like the others and has no menu.
    assert.equal(await page.evaluate(() => document.querySelector('[data-marxy-outline-row="title"]').closest('li').querySelector('.marxy-outline-more')), null);
  }, { open: ['/r/Front.md'] });
});

test('a long outline draws only the rows near the view, and scrolling, End and the arrows reach every row', async () => {
  await withPage(async (page) => {
    const drawn = () => page.evaluate(() => document.querySelectorAll('[data-marxy-outline-row]').length);
    assert.ok((await drawn()) < 200, `${await drawn()} rows drawn of 2,000`);
    assert.equal(await page.evaluate(() => document.querySelector('.marxy-outline-count').textContent), '2,000 headings');
    // The list is as tall as the whole outline: the scroll bar is the outline's.
    const heights = await page.evaluate(() => { const l = document.querySelector('.marxy-outline-list'); return { list: l.getBoundingClientRect().height, row: l.querySelector('li').getBoundingClientRect().height }; });
    assert.ok(Math.abs(heights.list - 2000 * heights.row) < 2000 * 0.5, JSON.stringify(heights));
    // Scrolling draws the rows then in view.
    await page.evaluate(() => { const s = document.querySelector('.marxy-outline').closest('[data-marxy-workspace-region]'); let n = document.querySelector('.marxy-outline'); while (n && !['auto', 'scroll'].includes(getComputedStyle(n).overflowY)) n = n.parentElement; n.scrollTop = n.scrollHeight; });
    await page.waitForFunction(() => [...document.querySelectorAll('.marxy-outline-text')].some((t) => t.textContent === 'Heading 1999'));
    assert.ok((await drawn()) < 200);
    // End goes to the last row from anywhere; Home to the first stop; the arrows walk across what is drawn.
    await page.evaluate(() => document.querySelector('[data-marxy-outline-row]').focus());
    await page.keyboard.press('Home');
    assert.equal(await page.evaluate(() => document.activeElement.className), 'marxy-outline-copy');
    await page.keyboard.press('End');
    assert.equal(await page.evaluate(() => document.activeElement.querySelector('.marxy-outline-text')?.textContent), 'Heading 1999');
    for (let i = 0; i < 60; i++) await page.keyboard.press('ArrowUp');
    assert.equal(await page.evaluate(() => document.activeElement.querySelector('.marxy-outline-text')?.textContent), 'Heading 1939');
    // A row far from the view is moved to from the list: the section moves, and the row is drawn and focused where it landed.
    await page.keyboard.press('Alt+ArrowUp');
    await page.waitForFunction(() => document.querySelector('[data-marxy-outline-row]:focus')?.querySelector('.marxy-outline-text').textContent === 'Heading 1939');
  }, { open: ['/r/Many.md'] });
});

test('over the long reference at 5,000 headings the tab holds at most 200 rows, marks the row under the reading line, moves a section near the end and undoes it in one step', async () => {
  await withPage(async (page) => {
    const drawn = () => page.evaluate(() => document.querySelectorAll('[data-marxy-outline-row]').length);
    const total = await page.evaluate(() => Number(document.querySelector('.marxy-outline-count').textContent.replace(/[^0-9]/g, '')));
    assert.ok(total >= 5000, `${total} headings`);
    assert.ok((await drawn()) <= 200, `${await drawn()} rows at the top`);
    const scrollOutline = (to) => page.evaluate((where) => { let n = document.querySelector('.marxy-outline'); while (n && !['auto', 'scroll'].includes(getComputedStyle(n).overflowY)) n = n.parentElement; n.scrollTop = where === 'end' ? n.scrollHeight : Math.floor(n.scrollHeight * where); }, to);
    for (const where of [0.25, 0.5, 0.75, 'end']) {
      await scrollOutline(where);
      await frames(page, 3);
      assert.ok((await drawn()) <= 200, `${await drawn()} rows at ${where}`);
    }
    // The row under the reading line: the reader is scrolled to the middle; the outline is walked a screen at a time, never holding
    // more than 200 rows, and the mark is on a drawn row where it is reached (it stays on its heading, not on the first rows).
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight / 2));
    await frames(page, 4);
    let seen = null;
    for (let at = 0, step = 1; seen === null && step < 400; step++) {
      await page.evaluate((top) => { let n = document.querySelector('.marxy-outline'); while (n && !['auto', 'scroll'].includes(getComputedStyle(n).overflowY)) n = n.parentElement; n.scrollTop = top; }, at);
      await frames(page, 2);
      assert.ok((await drawn()) <= 200);
      seen = await page.evaluate(() => document.querySelector('.marxy-outline-list [aria-current="location"] .marxy-outline-text')?.textContent ?? null);
      at += 700;
    }
    assert.ok(seen !== null && seen !== 'Heading 0', `the row under the reading line was found among the drawn rows: ${seen}`);
    // Home and End rove to the ends; ⌥↓ on a row near the end moves its section and one Mod+Z restores the bytes.
    const original = await bytesOf(page);
    await page.evaluate(() => document.querySelector('[data-marxy-outline-row]').focus());
    await page.keyboard.press('End');
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Alt+ArrowDown');
    await page.waitForFunction((o) => new TextDecoder().decode(window.__marxyHandle.document().snapshot().buffer.bytes) !== o, original);
    await page.keyboard.press(`${await modOf(page)}+z`);
    await page.waitForFunction((o) => new TextDecoder().decode(window.__marxyHandle.document().snapshot().buffer.bytes) === o, original);
    assert.ok((await drawn()) <= 200);
  }, { open: ['/r/Ref5k.md'] });
});

test('the first draw of the tab for a document of 5,000 headings is recorded beside one of fifty (recorded, ADR-0032)', async () => {
  const record = {};
  for (const [name, path] of [['50', '/r/Ref50.md'], ['5,000', '/r/Ref5k.md']]) {
    await withPage(async (page) => {
      // Leave the tab and ask for it again: the first draw of this document's outline, from the tab being asked for to its rows being on the page.
      record[name] = await page.evaluate(async () => {
        const { selectInspectorTab } = await import('/src/workspace/inspector.ts');
        selectInspectorTab('links');
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const t0 = performance.now();
        selectInspectorTab('outline');
        while (!document.querySelector('.marxy-outline-list [data-marxy-outline-row]')) await new Promise((r) => requestAnimationFrame(r));
        const t1 = performance.now();
        return { ms: Math.round(t1 - t0), rows: document.querySelectorAll('[data-marxy-outline-row]').length };
      });
    }, { open: [path] });
  }
  console.log(`Outline tab first draw: ${JSON.stringify(record)} (recorded, ADR-0032)`);
  assert.ok(record['5,000'].rows <= 200 && record['50'].rows > 0, 'the measurement happened');
});

// W-10.3: a relist after an edit redraws only the rows that changed. The count is of DOM operations (a MutationObserver's records
// over the tab), not milliseconds: time flakes under load, an operation count does not. The times are recorded beside it (ADR-0032).
async function relistOnce(page, replacement) {
  return page.evaluate(async (text) => {
    const store = window.__marxyHandle.document();
    const raf = () => new Promise((r) => requestAnimationFrame(r));
    const seen = { records: 0, added: 0, removed: 0 };
    let drawStart = 0, drawMs = 0;
    const observer = new MutationObserver((list) => {
      if (drawStart > 0) drawMs = performance.now() - drawStart;
      for (const m of list) { seen.records++; seen.added += m.addedNodes.length; seen.removed += m.removedNodes.length; (seen.kinds ??= {})[m.type + ':' + (m.attributeName ?? '')] = ((seen.kinds ??= {})[m.type + ':' + (m.attributeName ?? '')] ?? 0) + 1; }
    });
    // The draw alone: a listener on the store ahead of the tab's (the tab is mounted again after it) starts the clock, and the last
    // mutation record, delivered when the draw's script ends, stops it.
    const { selectInspectorTab } = await import('/src/workspace/inspector.ts');
    selectInspectorTab('links');
    await raf();
    const offA = store.subscribe(() => { if (drawStart === 0) drawStart = performance.now(); });
    selectInspectorTab('outline');
    while (!document.querySelector('.marxy-outline-list [data-marxy-outline-row]')) await raf();
    const body = document.querySelector('.marxy-outline');
    observer.observe(body, { subtree: true, childList: true, attributes: true, characterData: true });
    const scroller = (() => { let n = body; while (n && !['auto', 'scroll'].includes(getComputedStyle(n).overflowY)) n = n.parentElement; return n; })();
    const top = scroller?.scrollTop ?? 0;
    document.querySelector('[data-marxy-outline-row="heading"]').focus();
    const t0 = performance.now();
    await store.apply({ range: { file: store.snapshot().path ?? '/r/Ref5k.md', start: 2, end: 2 }, replacement: text, label: 'edit' });
    while (document.querySelector('[data-marxy-outline-row="heading"] .marxy-outline-text')?.textContent.startsWith(text) !== true) await raf();
    const ms = performance.now() - t0;
    await raf(); await raf();
    observer.disconnect(); offA();
    return { ...seen, ms: Math.round(ms), drawMs: Math.round(drawMs * 10) / 10, stillFocused: document.activeElement?.hasAttribute('data-marxy-outline-row') ?? false, scrollTop: scroller?.scrollTop ?? 0, top, headings: document.querySelector('.marxy-outline-count').textContent };
  }, replacement);
}

test('a relist after a one-heading edit at 5,000 headings writes only the rows that changed, keeping focus and scroll (W-10.3)', async () => {
  await withPage(async (page) => {
    const rows0 = await page.evaluate(() => document.querySelectorAll('.marxy-outline-item').length);
    const runs = [];
    for (const word of ['Aaa ', 'Bbb ', 'Ccc ']) runs.push(await relistOnce(page, word));
    console.log(`Outline relist after a one-heading edit, 5,000 headings: ${JSON.stringify(runs)} (recorded, ADR-0032)`);
    for (const run of runs) {
      // Before W-10.3 the whole list was rebuilt: every drawn row removed and made again (hundreds of operations, a node per row).
      assert.ok(run.added <= 3, `${run.added} nodes added`);
      assert.ok(run.removed <= 3, `${run.removed} nodes removed`);
      // An insert at the top moves every row after it in the file: one attribute each; nothing else is written (288 records before).
      assert.ok(run.records <= rows0 + 10, `${run.records} DOM operations for ${rows0} drawn rows: ${JSON.stringify(run.kinds)}`);
      assert.equal(run.stillFocused, true, 'a row kept focus');
      assert.equal(run.scrollTop, run.top, 'the scroll position did not move');
    }
    const rows = await rowsOf(page);
    assert.equal(rows.length, rows0);
    assert.equal(rows[0].text.startsWith('Ccc Bbb Aaa'), true);
  }, { open: ['/r/Ref5k.md'] });
});
