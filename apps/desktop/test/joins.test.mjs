// The joins in WebKit: the head's unsaved chip and its press, the spine's
// marks for unsaved lines, notes and the cursor's part, the Reveal chip, Reveal's front matter fences and comments, and
// Save from the menu and from Source reading the patch first when review_changes is on.
import { strict as assert } from 'node:assert';
import { after, test as nodeTest } from 'node:test';
import { closeHarness } from './support/two-pane.mjs';
import { skip, withFrame } from './support/frame.mjs';

const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);
after(() => closeHarness());

const PLAN = [
  '# Plan', '', 'The first paragraph of the plan.', '', '- one', '- two', '', '## Scope', '', 'What is in scope.', '',
  '- [ ] a task to do', '- [x] done already', '', '## Rollback', '', 'Put it back.', '', '# Last', '', 'The end.', '',
].join('\n');
const TICKED = PLAN.replace('- [ ] a task', '- [x] a task');
const MARKED = [
  '---', 'title: Marked', '---', '', '# Marked', '', 'Before the comment.', '', '<!-- kept out of the reading -->', '',
  'After the comment.', '', '| a | b |', '|---|---|', '| 1 | 2 |', '',
].join('\n');
const FILES = { '/r/plan.md': PLAN, '/r/marked.md': MARKED };

const keys = async (page, ...list) => {
  for (const k of list) await page.keyboard.press(k);
};
const blur = (page) => page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
const curText = (page) => page.evaluate(() => document.querySelector('[data-marxy-pane="0"] .marxy-article .marxy-cursor')?.textContent.trim().split('\n')[0] ?? null);
const diskText = (page, path) => page.evaluate(async (p) => new TextDecoder().decode(await window.__marxyHandle.shell.readFile(p)), path);
async function diskUntil(page, path, want) {
  for (let i = 0; i < 100; i++) {
    const text = await diskText(page, path);
    if (want(text)) return text;
    await page.waitForTimeout(50);
  }
  throw new Error(`${path} never became what was wanted`);
}
async function goTo(page, text) {
  await blur(page);
  await keys(page, 'g', 'g');
  for (let i = 0; i < 40; i++) {
    if ((await curText(page))?.startsWith(text)) return;
    await keys(page, 'j');
  }
  throw new Error(`no part begins ${text}`);
}
/** Ticks the task under Scope: one staged change on one line. */
async function tick(page) {
  await goTo(page, 'Scope');
  await keys(page, 'l', 'j', 'l', 't');
  await page.waitForFunction(() => window.__marxyHandle.document().snapshot().dirty);
}
const chip = (page, slot, kind) =>
  page.evaluate(({ slot, kind }) => {
    const c = document.querySelector(`[data-marxy-head="${slot}"] .marxy-head-chip[data-marxy-chip="${kind}"]`);
    return c && !c.hidden ? c.textContent : null;
  }, { slot, kind });
const spineMarks = (page, slot, kind) =>
  page.evaluate(({ slot, kind }) => {
    const host = window.__marxyHandle.panes().panes[slot].host;
    return [...host.querySelectorAll(`.marxy-spine-mark[data-marxy-mark="${kind}"]`)].map((m) => Number.parseFloat(m.style.top));
  }, { slot, kind });
/** Runs a native menu item as a click on it does (menu/menu-boot.ts). */
const menu = (page, id) =>
  page.evaluate(async (id) => {
    const h = window.__marxyHandle;
    const { runMenuCommand } = await import('/src/menu/menu-commands.ts');
    const { buildAppContext } = await import('/src/selection/bind.ts');
    runMenuCommand(id, document, { commands: () => h.commands(), context: () => buildAppContext(h), fail: (c, e) => console.error(c.id, e) });
  }, id);

test('18 (head): a staged tick puts "Unsaved · 1 place" after the crumbs; pressing it opens the changes beside; undone, it goes', async () => {
  await withFrame({ files: FILES, open: ['/r/plan.md'] }, async (page) => {
    assert.equal(await chip(page, 0, 'unsaved'), null, 'nothing unsaved, no chip');
    await tick(page);
    await page.waitForFunction(() => document.querySelector('[data-marxy-head="0"] .marxy-head-chip[data-marxy-chip="unsaved"]:not([hidden])'));
    assert.match(await chip(page, 0, 'unsaved'), /^Unsaved . 1 place$/);
    const order = await page.evaluate(() => [...document.querySelector('[data-marxy-head="0"] .marxy-ktools').children].filter((c) => !c.hidden).map((c) => c.className.split(' ')[0]));
    assert.equal(order.at(-1), 'marxy-head-chip', `the chip ends the head's tools: ${order}`);
    await page.click('[data-marxy-head="0"] .marxy-head-chip[data-marxy-chip="unsaved"]');
    await page.waitForSelector('[data-marxy-pane="1"] .marxy-diff-add');
    assert.equal(await diskText(page, '/r/plan.md'), PLAN, 'reading the patch writes nothing');
    await page.click('[data-marxy-pane="1"] [data-marxy-changes-act="undo"]');
    await page.waitForFunction(() => document.querySelector('[data-marxy-head="0"] .marxy-head-chip[data-marxy-chip="unsaved"]')?.hidden === true);
  });
});

test('spine: an unsaved stretch and a margin note each have their mark, kept current as either changes', async () => {
  await withFrame({ files: FILES, open: ['/r/plan.md'] }, async (page) => {
    assert.deepEqual(await spineMarks(page, 0, 'edit'), []);
    await tick(page);
    await page.waitForFunction(() => document.querySelectorAll('.marxy-spine-mark[data-marxy-mark="edit"]').length === 1);
    const tickAt = (await spineMarks(page, 0, 'edit'))[0];
    const scopeAt = await page.evaluate(() => Number.parseFloat(document.querySelectorAll('.marxy-spine-tick[data-marxy-level="2"]')[0].style.top));
    assert.ok(tickAt > scopeAt, `the edit mark (${tickAt}%) sits below Scope's tick (${scopeAt}%)`);
    // A note on the last paragraph, then on the first: the mark follows the store.
    await page.evaluate(async (text) => {
      const { setNotes } = await import('/src/notes/store.ts');
      const lines = text.split('\n');
      const l0 = lines.indexOf('The end.');
      setNotes('/r/plan.md', [{ l0, l1: l0 + 1, key: 'The end.', text: 'Check the ending' }]);
    }, PLAN);
    await page.waitForFunction(() => document.querySelectorAll('.marxy-spine-mark[data-marxy-mark="note"]').length === 1);
    const low = (await spineMarks(page, 0, 'note'))[0];
    await page.evaluate(async () => {
      const { setNotes } = await import('/src/notes/store.ts');
      setNotes('/r/plan.md', [{ l0: 0, l1: 1, key: '# Plan', text: 'Title' }]);
    });
    await page.waitForFunction((low) => Number.parseFloat(document.querySelector('.marxy-spine-mark[data-marxy-mark="note"]')?.style.top) < low, low);
    // Undone, the edit mark goes; the note stays.
    await blur(page);
    await keys(page, 'u');
    await page.waitForFunction(() => document.querySelectorAll('.marxy-spine-mark[data-marxy-mark="edit"]').length === 0);
    assert.equal((await spineMarks(page, 0, 'note')).length, 1);
  });
});

test('spine: the cursor mark is the selection controller\'s part, not the painted element', async () => {
  await withFrame({ files: FILES, open: ['/r/plan.md'] }, async (page) => {
    await goTo(page, 'Scope');
    // The spine redraws at most every 120 ms, so a mark for a part the cursor passed on the way can still be up: wait for
    // the one on Scope, which a section's cursor puts at its heading's tick.
    const onScope = () => {
      const cursor = document.querySelector('.marxy-spine-mark[data-marxy-mark="cursor"]');
      const tick = document.querySelector('.marxy-spine-tick[data-marxy-level="2"]');
      return cursor !== null && tick !== null && cursor.style.top === tick.style.top;
    };
    await page.waitForFunction(onScope);
    // The paint taken off the page and the spine drawn again (its layer is new): the mark is still the selection's part.
    await page.evaluate(() => {
      window.__oldCursorMark = document.querySelector('.marxy-spine-mark[data-marxy-mark="cursor"]');
      for (const el of document.querySelectorAll('.marxy-cursor')) el.classList.remove('marxy-cursor');
      const h = window.__marxyHandle;
      h.frame().headOf(h.panes().panes[0]).render();
    });
    await page.waitForFunction(() => !window.__oldCursorMark.isConnected && document.querySelector('.marxy-spine-tick') !== null);
    assert.equal(await page.evaluate(onScope), true, 'the cursor mark is drawn again on Scope without the paint');
    await keys(page, 'Escape');
    await page.waitForFunction(() => document.querySelectorAll('.marxy-spine-mark[data-marxy-mark="cursor"]').length === 0);
  });
});

test('12 + chip: X toggles Reveal on the page and the head says ¶ while it is on; pressing ¶ turns it off', async () => {
  await withFrame({ files: FILES, open: ['/r/plan.md'] }, async (page) => {
    const on = () => page.evaluate(() => document.querySelector('[data-marxy-pane="0"] .marxy-article').hasAttribute('data-marxy-reveal'));
    await blur(page);
    const a = await on();
    assert.equal(await chip(page, 0, 'reveal'), null);
    await keys(page, 'Shift+X');
    await page.waitForFunction(() => document.querySelector('[data-marxy-head="0"] .marxy-head-chip[data-marxy-chip="reveal"]:not([hidden])'));
    const b = await on();
    assert.equal(await chip(page, 0, 'reveal'), '¶');
    await page.click('[data-marxy-head="0"] .marxy-head-chip[data-marxy-chip="reveal"]');
    await page.waitForFunction(() => document.querySelector('[data-marxy-head="0"] .marxy-head-chip[data-marxy-chip="reveal"]')?.hidden === true);
    const c = await on();
    assert.deepEqual([a, b, c], [false, true, false], 'reveal: before, after X, after the chip');
    await keys(page, 'Shift+X');
    await page.waitForFunction(() => document.querySelector('[data-marxy-head="0"] .marxy-head-chip[data-marxy-chip="reveal"]:not([hidden])'));
    await keys(page, 'Shift+X');
    await page.waitForFunction(() => document.querySelector('[data-marxy-head="0"] .marxy-head-chip[data-marxy-chip="reveal"]')?.hidden === true);
  });
});

test('Reveal puts back front matter fences and a comment where it sat, and leaves a table as it is', async () => {
  await withFrame({ files: FILES, open: ['/r/marked.md'] }, async (page) => {
    const tableBefore = await page.evaluate(() => document.querySelector('[data-marxy-pane="0"] .marxy-article table').getBoundingClientRect().width);
    await blur(page);
    await keys(page, 'Shift+X');
    await page.waitForSelector('[data-marxy-pane="0"] .marxy-article[data-marxy-reveal]');
    const s = await page.evaluate(() => {
      const article = document.querySelector('[data-marxy-pane="0"] .marxy-article');
      const dl = article.querySelector('dl');
      const comment = [...article.querySelectorAll('.marxy-reveal-mark')].find((m) => m.textContent.startsWith('<!--'));
      return {
        before: dl?.previousElementSibling?.textContent ?? null,
        after: dl?.nextElementSibling?.textContent ?? null,
        comment: comment?.textContent ?? null,
        prev: comment?.previousElementSibling?.textContent ?? null,
        next: comment?.nextElementSibling?.textContent ?? null,
        inTable: article.querySelectorAll('table .marxy-reveal-mark').length,
        table: article.querySelector('table').getBoundingClientRect().width,
      };
    });
    assert.equal(s.before, '---');
    assert.equal(s.after, '---');
    assert.equal(s.comment, '<!-- kept out of the reading -->');
    assert.equal(s.prev, 'Before the comment.');
    assert.equal(s.next, 'After the comment.');
    assert.equal(s.inTable, 0, 'no marks in the table');
    assert.equal(s.table, tableBefore, 'the table keeps its layout');
    await keys(page, 'Shift+X');
    await page.waitForFunction(() => document.querySelectorAll('[data-marxy-pane="0"] .marxy-reveal-mark').length === 0);
  });
});

test('with review_changes on, the menu\'s Save and Source\'s Mod+S read the patch first; the menu\'s Save on the patch writes', async () => {
  await withFrame({ files: FILES, open: ['/r/plan.md'], config: 'review_changes = true\n' }, async (page, { mod }) => {
    await tick(page);
    await menu(page, 'cmd:document.save');
    await page.waitForSelector('[data-marxy-pane="1"] .marxy-diff-add');
    assert.equal(await diskText(page, '/r/plan.md'), PLAN, 'the menu\'s Save did not write');
    // On the changes page the menu's Save is the document's.
    await page.evaluate(() => {
      const set = window.__marxyHandle.panes();
      set.focus(set.panes[1]);
    });
    await menu(page, 'cmd:document.save');
    await diskUntil(page, '/r/plan.md', (t) => t === TICKED);

    // Source: typed text is folded into the patch before anything is written.
    await page.evaluate(async () => {
      const set = window.__marxyHandle.panes();
      set.focus(set.panes[0]);
      await set.panes[0].view.setMode('source');
    });
    await page.waitForSelector('[data-marxy-pane="0"] .cm-content, .cm-content');
    await page.click('.cm-content');
    await keys(page, `${mod}+End`);
    await page.keyboard.type('Typed in Source.');
    await page.keyboard.press(`${mod}+KeyS`);
    await page.waitForFunction(() => /Typed in Source\./.test(document.querySelector('[data-marxy-pane="1"] .marxy-article')?.textContent ?? ''));
    assert.equal(await diskText(page, '/r/plan.md'), TICKED, 'Source\'s Mod+S did not write');
  });
});
