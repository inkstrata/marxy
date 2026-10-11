// Edit one block in Source, in place (E-04, ADR-0048): select a block, press the edit key, a CodeMirror editor
// opens where the block was, over exactly its bytes; leaving folds the text back as one undo step. Booted on the
// shipped skeleton over the memory shell (test/support/two-pane.mjs), so a second pane is the real one.
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { DISK_CHANGED_EDITS_KEPT } from '../src/notices/disk.ts';
import { BLOCK_EDIT_CAP, rebaseRange } from '../src/commands/block-edit.ts';
import { blockEditRange, createBuffer, parseMarkdown, textOf } from '../../../packages/core/src/index.ts';
import { bootTwoPanes, closeHarness } from './support/two-pane.mjs';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip, timeout: 90_000 }, fn);
after(() => closeHarness());

const corpus = join(fileURLToPath(new URL('../../../', import.meta.url)), 'fixtures', 'corpus');
const read = (name) => readFileSync(join(corpus, name), 'utf8');

const para = (word) =>
  `${word} runs long enough to wrap across several lines of the column, so that the typesetter has ` +
  'real paragraphs to break and the page is tall enough to scroll a heading to the reading line. ';

/** The first top-level block of `type` in `text`, as the editor resolves it: its node start and its edit range. */
function firstBlock(text, type, at = 0) {
  const bytes = Buffer.from(text, 'utf8');
  const ast = parseMarkdown(bytes, { file: 'x' });
  const node = ast.children.filter((c) => c.type === type)[at];
  assert.ok(node, `no ${type} #${at}`);
  const range = blockEditRange(ast, node);
  return { node, range, text: textOf(createBuffer('x', bytes), range) };
}

/**
 * That `after` is `before` with only `range` replaced: every byte before the range and every byte after it
 * (shifted by the change in length) is the same. Returns the replaced slice of `after`.
 */
function assertOnlyInside(before, after, range) {
  const delta = after.length - before.length;
  for (let i = 0; i < range.start; i++) assert.equal(after[i], before[i], `byte ${i} before the block changed`);
  for (let i = range.end; i < before.length; i++) assert.equal(after[i + delta], before[i], `byte ${i} after the block changed`);
  return Buffer.from(after.slice(range.start, range.end + delta)).toString('utf8');
}

async function withPage(files, open, fn, viewport = { width: 1100, height: 900 }) {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport });
    await bootTwoPanes(page, { files, open });
    await page.waitForFunction(() => document.querySelector('#doc [data-marxy-s]') !== null);
    const mod = (await page.evaluate(() => navigator.platform)) === 'MacIntel' ? 'Meta' : 'Control';
    await fn(page, mod);
  } finally {
    await browser.close();
  }
}

/** The open document's bytes, as an array a test can compare. */
const bytesOf = (page, slot = 0) =>
  page.evaluate((slot) => [...window.__marxyHandle.panes().panes[slot].content.store().snapshot().buffer.bytes], slot);
const stateOf = (page, slot = 0) =>
  page.evaluate((slot) => {
    const snap = window.__marxyHandle.panes().panes[slot].content.store().snapshot();
    return { dirty: snap.dirty, canUndo: snap.canUndo, canRedo: snap.canRedo, version: snap.version };
  }, slot);
/** Selects the block at `byte` in the focused pane, as a click on it would. */
const selectBlock = (page, byte) => page.evaluate((b) => window.__marxyHandle.selection.selectBlockAtByte(b), byte);
const editors = (page) => page.evaluate(() => document.querySelectorAll('.marxy-block-editor').length);
/** The caret to the end of the island's text. */
const toEnd = (page, mod) => page.keyboard.press(mod === 'Meta' ? 'Meta+ArrowDown' : 'Control+End');

test('Mod+Enter on a selected paragraph edits it in place; Esc folds only that paragraph back', async () => {
  const file = '03-ai-plan.md';
  const text = read(file);
  const first = firstBlock(text, 'paragraph');
  await withPage({ [`/c/${file}`]: text }, [`/c/${file}`], async (page, mod) => {
    const before = await bytesOf(page);
    assert.equal(await editors(page), 0, 'no editor at rest');
    await selectBlock(page, first.node.src.start);
    await page.keyboard.press(`${mod}+Enter`);
    await page.waitForSelector('.marxy-block-editor .cm-content');
    assert.equal(await editors(page), 1);
    // The editor holds exactly the block's bytes, in the code face, where the block was.
    assert.equal(await page.evaluate(() => document.querySelector('.marxy-block-editor .cm-content').textContent), first.text);
    assert.equal(await page.evaluate(() => document.querySelector('.marxy-block-editor').hasAttribute('data-marxy-edit')), true);
    await toEnd(page, mod);
    await page.keyboard.type(' ZZ');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelector('.marxy-block-editor') === null);
    await page.waitForFunction(() => window.marxyDocumentEdit?.().dirty === true || window.__marxyHandle.document().snapshot().dirty);
    const after = await bytesOf(page);
    const edited = assertOnlyInside(before, after, first.range);
    assert.equal(edited, `${first.text} ZZ`);
    assert.equal((await stateOf(page)).dirty, true);
    assert.equal(await editors(page), 0, 'no editor at rest after the last edit');
  });
});

test('one Mod+Z in Rendered undoes the whole edit; one Mod+Shift+Z does it again', async () => {
  const file = '03-ai-plan.md';
  const text = read(file);
  const first = firstBlock(text, 'paragraph');
  await withPage({ [`/c/${file}`]: text }, [`/c/${file}`], async (page, mod) => {
    const original = await bytesOf(page);
    await selectBlock(page, first.node.src.start);
    await page.keyboard.press(`${mod}+Enter`);
    await page.waitForSelector('.marxy-block-editor .cm-content');
    // Several separate edits inside the editor are still one step in the document.
    await toEnd(page, mod);
    await page.keyboard.type(' one');
    await page.keyboard.type(' two');
    await page.keyboard.press(`${mod}+Enter`);
    await page.waitForFunction(() => document.querySelector('.marxy-block-editor') === null);
    const edited = await bytesOf(page);
    assert.notDeepEqual(edited, original);
    assert.equal((await stateOf(page)).canUndo, true);
    await page.keyboard.press(`${mod}+z`);
    await page.waitForFunction(() => !window.__marxyHandle.document().snapshot().canUndo);
    assert.deepEqual(await bytesOf(page), original);
    assert.equal((await stateOf(page)).dirty, false);
    await page.keyboard.press(`${mod}+Shift+z`);
    await page.waitForFunction(() => !window.__marxyHandle.document().snapshot().canRedo);
    assert.deepEqual(await bytesOf(page), edited);
  });
});

test('a CRLF file with a BOM keeps every CRLF and the BOM; a new line typed in the editor is CRLF', async () => {
  const file = '12-crlf-and-bom.md';
  const text = read(file);
  assert.ok(text.startsWith('﻿') && text.includes('\r\n'));
  const second = firstBlock(text, 'paragraph', 0);
  await withPage({ [`/c/${file}`]: text }, [`/c/${file}`], async (page, mod) => {
    const original = await bytesOf(page);
    await selectBlock(page, second.node.src.start);
    await page.keyboard.press(`${mod}+Enter`);
    await page.waitForSelector('.marxy-block-editor .cm-content');
    await toEnd(page, mod);
    await page.keyboard.press('Enter');
    await page.keyboard.type('and a new line');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelector('.marxy-block-editor') === null);
    const after = Buffer.from(await bytesOf(page));
    assert.deepEqual([...after.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'the BOM stays');
    const edited = assertOnlyInside(original, [...after], second.range);
    assert.equal(edited, `${second.text}\r\nand a new line`);
    // Every line ending in the file is CRLF: no bare LF, no bare CR.
    const s = after.toString('latin1');
    assert.equal(s.replace(/\r\n/g, '').match(/[\r\n]/), null);
    assert.equal((s.match(/\r\n/g) ?? []).length, (Buffer.from(original).toString('latin1').match(/\r\n/g) ?? []).length + 1);
  });
});

test('opening and leaving without typing re-renders nothing, adds no history and leaves the file clean', async () => {
  const file = '03-ai-plan.md';
  const text = read(file);
  const first = firstBlock(text, 'paragraph');
  await withPage({ [`/c/${file}`]: text }, [`/c/${file}`], async (page, mod) => {
    await page.evaluate(() => {
      window.__stay = document.querySelector('#doc').firstElementChild;
      window.__repaints = performance.getEntriesByName('marxy:repaint').length;
    });
    const before = await stateOf(page);
    await selectBlock(page, first.node.src.start);
    await page.keyboard.press(`${mod}+Enter`);
    await page.waitForSelector('.marxy-block-editor .cm-content');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelector('.marxy-block-editor') === null);
    const after = await stateOf(page);
    assert.deepEqual(after, before, 'version, history and dirty are as they were');
    const kept = await page.evaluate(() => ({
      same: document.querySelector('#doc').firstElementChild === window.__stay,
      repaints: performance.getEntriesByName('marxy:repaint').length - window.__repaints,
      hidden: document.querySelectorAll('#doc [hidden]').length,
    }));
    assert.deepEqual(kept, { same: true, repaints: 0, hidden: 0 });
  });
});

/** The block on the reading line and where it sits, from the harness: what "the page is where the reader left it" means. */
const reading = (page) =>
  page.evaluate(() => {
    const { byteOffset } = window.__marxyHandle.sourceHarness();
    const el = document.querySelector(`#doc [data-marxy-s="${byteOffset}"]`);
    return { byteOffset, top: el ? el.getBoundingClientRect().top : null, h: el ? el.getBoundingClientRect().height : null, tag: el?.tagName, scrollTop: document.documentElement.scrollTop };
  });
/** A top-level paragraph of the page, on screen, `where` it sits against the reading line (0.4 of the window). */
const paragraphOnScreen = (page, where) =>
  page.evaluate((where) => {
    const line = innerHeight * 0.4;
    for (const p of document.querySelectorAll('#doc > p[data-marxy-s]')) {
      const r = p.getBoundingClientRect();
      if (where === 'below' && r.top > line + 80 && r.top < line + 220) return Number(p.getAttribute('data-marxy-s'));
      if (where === 'above' && r.bottom < line - 40 && r.bottom > 60) return Number(p.getAttribute('data-marxy-s'));
    }
    return null;
  }, where);

for (const where of ['below', 'above']) {
  test(`the reading position survives an edit of a block ${where} the reading line`, async () => {
    const file = '01-long-technical.md';
    await withPage({ [`/c/${file}`]: read(file) }, [`/c/${file}`], async (page, mod) => {
      await page.waitForFunction(() => window.__marxyHandle.document().snapshot().buffer.bytes.length > 0);
      // Scroll to the middle of the document, then on to the nearest place where paragraphs sit both above and
      // below the reading line (a table or a code block can fill the very middle of it).
      const found = await page.evaluate(async () => {
        await window.__marxyHandle.contentComplete();
        const root = document.documentElement;
        const line = innerHeight * 0.4;
        const paragraphs = [...document.querySelectorAll('#doc > p[data-marxy-s]')];
        const top = (p) => p.getBoundingClientRect().top + root.scrollTop;
        const middle = (root.scrollHeight - innerHeight) / 2;
        const ordered = paragraphs.sort((a, b) => Math.abs(top(a) - middle) - Math.abs(top(b) - middle));
        for (const p of ordered) {
          root.scrollTop = top(p) - line + 12;
          const rects = paragraphs.map((q) => q.getBoundingClientRect());
          const above = rects.some((r) => r.bottom < line - 40 && r.bottom > 60);
          const below = rects.some((r) => r.top > line + 80 && r.top < line + 220);
          if (above && below) return true;
        }
        return false;
      });
      assert.ok(found, 'a place with paragraphs above and below the reading line');
      await page.waitForTimeout(400);
      const held = await reading(page);
      assert.ok(held.scrollTop > 500, 'scrolled well into the document');
      const at = await paragraphOnScreen(page, where);
      assert.ok(at !== null, `a paragraph ${where} the reading line`);
      await selectBlock(page, at);
      await page.keyboard.press(`${mod}+Enter`);
      await page.waitForSelector('.marxy-block-editor .cm-content');
      // The editor is taller or shorter than the block it replaced, and the reader's block does not move for it.
      const opened = await reading(page);
      assert.equal(opened.byteOffset, held.byteOffset);
      assert.ok(Math.abs(opened.top - held.top) <= 1, `opening moved the reading block ${opened.top - held.top}px`);
      await toEnd(page, mod);
      const typed = ' and a few more words.';
      await page.keyboard.type(typed);
      // (CodeMirror may scroll a few pixels to keep the caret in view as the reader types: that is the reader's doing.)
      const leaving = await reading(page);
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => document.querySelector('.marxy-block-editor') === null);
      await page.evaluate(() => window.__marxyHandle.panes().panes[0].view.settled());
      await page.waitForTimeout(300);
      const now = await reading(page);
      // Below the edit the reading line's block is the same block; above it the same block, moved by the bytes typed.
      const moved = where === 'above' ? Buffer.byteLength(typed) : 0;
      assert.equal(now.byteOffset, held.byteOffset + moved, 'the same block is on the reading line');
      assert.ok(Math.abs(now.top - leaving.top) <= 1, `leaving moved the reading block ${now.top - leaving.top}px`);
      if (where === 'below') assert.ok(Math.abs(now.top - held.top) <= 1, `the block moved ${now.top - held.top}px`);
    });
  });
}


/** The first paragraph of 03-ai-plan.md open in an editor with ' ZZ' typed at its end: the shape most guards start from. */
async function withTypedBlock(fn) {
  const file = '03-ai-plan.md';
  const text = read(file);
  const first = firstBlock(text, 'paragraph');
  await withPage({ [`/c/${file}`]: text }, [`/c/${file}`], async (page, mod) => {
    const original = await bytesOf(page);
    await selectBlock(page, first.node.src.start);
    await page.keyboard.press(`${mod}+Enter`);
    await page.waitForSelector('.marxy-block-editor .cm-content');
    await toEnd(page, mod);
    await page.keyboard.type(' ZZ');
    await fn(page, mod, { file, text, first, original, path: `/c/${file}` });
  });
}

test('Mod+E with an editor open leaves it first: Source shows the edited bytes', async () => {
  await withTypedBlock(async (page, mod, { first }) => {
    assert.equal((await stateOf(page)).dirty, false, 'nothing is in the document until the editor is left');
    await page.keyboard.press(`${mod}+KeyE`);
    await page.waitForFunction(() => window.__marxyHandle.sourceHarness()?.mode === 'source');
    assert.equal(await editors(page), 0);
    const source = await page.evaluate(async () => {
      const { activeSourceEditor } = await import('/src/source/editor.ts');
      return activeSourceEditor(window.__marxyHandle.panes().panes[0].parts.source)?.docText() ?? null;
    });
    assert.ok(source?.includes(`${first.text} ZZ`), 'Source has the typed text');
    const state = await stateOf(page);
    assert.equal(state.dirty, true);
    assert.equal(state.canUndo, true);
  });
});

test('Mod+S with an editor open saves the edited bytes', async () => {
  await withTypedBlock(async (page, mod, { path, first, original }) => {
    await page.keyboard.press(`${mod}+s`);
    await page.waitForFunction(() => window.__marxyHandle.document().snapshot().dirty === false);
    const saved = await page.evaluate(async (p) => [...(await window.__marxyHandle.shell.readFile(p))], path);
    assert.equal(assertOnlyInside(original, saved, first.range), `${first.text} ZZ`);
    assert.equal(await editors(page), 0, 'saving leaves the editor');
  });
});

test('an outside write while an editor holds an edit keeps the edit and says so', async () => {
  await withTypedBlock(async (page, mod, { path, first, original }) => {
    await page.evaluate(async (p) => {
      const shell = window.__marxyHandle.shell;
      await shell.writeFileAtomic(p, new TextEncoder().encode('# written by another program\n'));
      shell.emit([{ kind: 'modified', path: p }]);
    }, path);
    await page.waitForFunction((text) => document.body.textContent.includes(text), DISK_CHANGED_EDITS_KEPT);
    // The editor and what was typed in it are still there; the document is the bytes it was.
    assert.equal(await editors(page), 1);
    assert.equal(await page.evaluate(() => document.querySelector('.marxy-block-editor .cm-content').textContent.endsWith(' ZZ')), true);
    assert.deepEqual(await bytesOf(page), original);
    // Leaving puts the text into the document: nothing was dropped.
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelector('.marxy-block-editor') === null);
    assert.equal(assertOnlyInside(original, await bytesOf(page), first.range), `${first.text} ZZ`);
  });
});

test('an outside write with the editor open and nothing typed closes it and shows the new file', async () => {
  const file = '03-ai-plan.md';
  const text = read(file);
  const first = firstBlock(text, 'paragraph');
  await withPage({ [`/c/${file}`]: text }, [`/c/${file}`], async (page, mod) => {
    await selectBlock(page, first.node.src.start);
    await page.keyboard.press(`${mod}+Enter`);
    await page.waitForSelector('.marxy-block-editor .cm-content');
    await page.evaluate(async (p) => {
      const shell = window.__marxyHandle.shell;
      await shell.writeFileAtomic(p, new TextEncoder().encode('# written by another program\n'));
      shell.emit([{ kind: 'modified', path: p }]);
    }, `/c/${file}`);
    await page.waitForFunction(() => document.querySelector('#doc h1')?.textContent === 'written by another program');
    assert.equal(await editors(page), 0);
    assert.equal((await stateOf(page)).dirty, false);
    assert.equal(await page.evaluate(() => document.querySelectorAll('#doc [hidden]').length), 0);
  });
});

test('a document selection and a block over 64 KB refuse with a word and open nothing', async () => {
  const big = `# Big\n\n\`\`\`\n${'x'.repeat(100 * 1024)}\n\`\`\`\n\nAfter it, a short paragraph.\n`;
  await withPage({ '/c/big.md': big }, ['/c/big.md'], async (page, mod) => {
    // A document selection (Mod+A is the document in Rendered; the selection API says it directly).
    await page.evaluate(() => {
      const sel = window.__marxyHandle.selection;
      sel.selectAt(document.querySelector('#doc h1'), { link: 'select' });
    });
    await page.evaluate(async () => {
      const { commands } = await import('/src/commands/index.ts');
      const { buildAppContext } = await import('/src/selection/bind.ts');
      const ctx = { ...buildAppContext(window.__marxyHandle), selection: { kind: 'document' } };
      await commands().find((c) => c.id === 'edit.block').run(ctx);
    });
    await page.waitForFunction((t) => document.body.textContent.includes(t), 'Too large to edit in place');
    assert.equal(await editors(page), 0);
    await page.evaluate(() => document.querySelector('#marxy-notices')?.replaceChildren());
    const fence = firstBlock(big, 'codeBlock');
    await selectBlock(page, fence.node.src.start);
    await page.keyboard.press(`${mod}+Enter`);
    await page.waitForFunction((t) => document.body.textContent.includes(t), 'Too large to edit in place');
    assert.equal(await editors(page), 0);
    assert.equal(await page.evaluate(() => document.querySelectorAll('#doc [hidden]').length), 0);
    assert.equal((await stateOf(page)).dirty, false);
    // A block under the cap, in the same document, still opens.
    const short = firstBlock(big, 'paragraph');
    await selectBlock(page, short.node.src.start);
    await page.keyboard.press(`${mod}+Enter`);
    await page.waitForSelector('.marxy-block-editor .cm-content');
    assert.equal(await editors(page), 1);
  });
});

const TWO = { width: 1470, height: 900 };
const A = `# Alpha\n\n${para('Alpha').repeat(3)}\n\n${para('Second').repeat(2)}\n\n${para('Third').repeat(2)}\n`;

/** Two panes on one file, an editor open in the left one with ' ZZ' typed at the end of the first paragraph. */
async function withTwoPanes(fn, nth = 0) {
  const first = firstBlock(A, 'paragraph', nth);
  await withPage({ '/c/A.md': A }, ['/c/A.md', '/c/A.md'], async (page, mod) => {
    assert.equal(await page.evaluate(() => {
      const [a, b] = window.__marxyHandle.panes().panes;
      return a.content.store() === b.content.store();
    }), true, 'one store under both panes');
    await page.evaluate(() => window.__marxyHandle.panes().focus(window.__marxyHandle.panes().panes[0]));
    const original = await bytesOf(page);
    await selectBlock(page, first.node.src.start);
    await page.keyboard.press(`${mod}+Enter`);
    await page.waitForSelector('#doc .marxy-block-editor .cm-content');
    await toEnd(page, mod);
    await page.keyboard.type(' ZZ');
    await fn(page, mod, { first, original });
  }, TWO);
}

const paneText = (page, slot) =>
  page.evaluate((slot) => window.__marxyHandle.panes().panes[slot].article.textContent, slot);

test('two panes on one file stay consistent: leaving the editor in one shows the edit in the other', async () => {
  await withTwoPanes(async (page, mod, { first, original }) => {
    assert.equal(await editors(page), 1);
    assert.equal(await page.evaluate(() => window.__marxyHandle.panes().panes[1].article.querySelector('.marxy-block-editor')), null, 'the other pane shows the page, not an editor');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelector('.marxy-block-editor') === null);
    const bytes = await bytesOf(page, 0);
    assert.deepEqual(bytes, await bytesOf(page, 1));
    assert.equal(assertOnlyInside(original, bytes, first.range), `${first.text} ZZ`);
    for (const slot of [0, 1]) assert.ok((await paneText(page, slot)).includes('ZZ'), `pane ${slot} shows the edit`);
    // One history, shared: one undo takes the edit out of both.
    await page.evaluate(() => window.__marxyHandle.dispatch({ type: 'undo' }));
    await page.waitForFunction(() => !window.__marxyHandle.document().snapshot().canUndo);
    for (const slot of [0, 1]) assert.ok(!(await paneText(page, slot)).includes('ZZ'), `pane ${slot} shows the undo`);
    assert.deepEqual(await bytesOf(page, 0), original);
  });
});

test('a press in the other pane leaves the editor first, so what was typed is in the document', async () => {
  await withTwoPanes(async (page, mod, { first, original }) => {
    const box = await page.evaluate(() => {
      const r = window.__marxyHandle.panes().panes[1].article.querySelector('p').getBoundingClientRect();
      return { x: r.left + 10, y: r.top + 10 };
    });
    await page.mouse.click(box.x, box.y);
    await page.waitForFunction(() => document.querySelector('.marxy-block-editor') === null);
    assert.equal(assertOnlyInside(original, await bytesOf(page, 0), first.range), `${first.text} ZZ`);
    assert.equal(await page.evaluate(() => window.__marxyHandle.panes().focused.slot), 1, 'the press focused the other pane');
    await page.waitForFunction(() => window.__marxyHandle.selection.state().selection.kind === 'node');
  });
});

test('a click on another block of the same pane leaves the editor and selects the block clicked', async () => {
  await withTwoPanes(async (page, mod, { first, original }) => {
    const third = firstBlock(A, 'paragraph', 2);
    const box = await page.evaluate((start) => {
      const r = document.querySelector(`#doc [data-marxy-s="${start}"]`).getBoundingClientRect();
      return { x: r.left + 10, y: r.top + 10 };
    }, third.node.src.start + 3 * 0);
    await page.mouse.click(box.x, box.y);
    await page.waitForFunction(() => document.querySelector('.marxy-block-editor') === null);
    assert.equal(assertOnlyInside(original, await bytesOf(page, 0), first.range), `${first.text} ZZ`);
    // What the click selected is selected on the new page: the third paragraph, moved by the three bytes typed.
    await page.waitForFunction(() => window.__marxyHandle.selection.state().selection.kind === 'node');
    const start = await page.evaluate(() => window.__marxyHandle.selection.state().selection.node.src.start);
    assert.equal(start, third.node.src.start + 3);
    assert.equal(await page.evaluate(() => document.querySelectorAll('.marxy-selected').length), 1);
  });
});

test('a change to the file made in the other pane while an editor holds an edit is kept alongside it', async () => {
  await withTwoPanes(async (page, mod, { first, original }) => {
    // The other pane appends a paragraph: disjoint from the open block, and a change the editor's page must not lose.
    await page.evaluate(async () => {
      const store = window.__marxyHandle.panes().panes[1].content.store();
      const end = store.snapshot().buffer.bytes.length;
      await store.apply({ range: { file: store.snapshot().path, start: end, end }, replacement: '\nAppended elsewhere.\n', label: 'append' });
    });
    await page.waitForFunction(() => document.querySelector('.marxy-block-editor') === null);
    await page.waitForFunction(() => window.__marxyHandle.panes().panes[0].content.store().snapshot().canUndo);
    await page.waitForFunction(() => new TextDecoder().decode(window.__marxyHandle.panes().panes[0].content.store().snapshot().buffer.bytes).includes('ZZ'));
    const text = Buffer.from(await bytesOf(page, 0)).toString('utf8');
    const expected = `${A.slice(0, first.range.start)}${first.text} ZZ${A.slice(first.range.end)}\nAppended elsewhere.\n`;
    assert.equal(text, expected);
    assert.equal(await page.evaluate(() => document.querySelectorAll('[hidden]:not(dialog):not(.marxy-source-mount)').length >= 0), true);
  });
});

/**
 * The other pane changes the block the editor has open, in one of the ways that leave no block to fold into; the
 * reader's text is added beside it, nothing is replaced, and the notice names the reader's text.
 */
async function conflictOutcome(change, expectedOf) {
  await withTwoPanes(async (page, mod, { first }) => {
    const third = firstBlock(A, 'paragraph', 2);
    await page.evaluate(change, first.range);
    await page.waitForFunction(() => document.body.textContent.includes('was changed or removed elsewhere'));
    await page.waitForFunction(() => new TextDecoder().decode(window.__marxyHandle.panes().panes[0].content.store().snapshot().buffer.bytes).includes('ZZ'));
    assert.equal(await editors(page), 0);
    const text = Buffer.from(await bytesOf(page, 0)).toString('utf8');
    const ours = `${first.text} ZZ\n\n`;
    assert.equal(text, expectedOf({ first, third, ours }));
    // The block neither side edited is whole, and the notice is about the reader's text.
    assert.ok(text.includes(third.text), 'the next block is intact');
    assert.ok(await page.evaluate(() => document.body.textContent.includes('Second runs long')), 'the notice names the reader\'s text');
    await page.evaluate(() => window.__marxyHandle.dispatch({ type: 'undo' }));
    await page.waitForFunction(() => !new TextDecoder().decode(window.__marxyHandle.panes().panes[0].content.store().snapshot().buffer.bytes).includes('ZZ'));
  }, 1);
}

test('another pane deletes the block being edited: the next block is not overwritten, the reader\'s text is kept', () =>
  conflictOutcome(
    async (range) => {
      const store = window.__marxyHandle.panes().panes[1].content.store();
      const end = range.end + 2;
      await store.apply({ range: { file: store.snapshot().path, start: range.start, end }, replacement: '', label: 'delete block' });
    },
    ({ first, third, ours }) => A.slice(0, first.range.start) + ours + A.slice(third.range.start),
  ));

test('another pane replaces the block being edited: both versions stand, the reader\'s text where the block was', () =>
  conflictOutcome(
    async (range) => {
      const store = window.__marxyHandle.panes().panes[1].content.store();
      await store.apply({ range: { file: store.snapshot().path, start: range.start, end: range.end }, replacement: 'Replaced elsewhere.', label: 'replace block' });
    },
    ({ first, third, ours }) => `${A.slice(0, first.range.start)}${ours}Replaced elsewhere.\n\n${A.slice(third.range.start)}`,
  ));

test('another pane splits the block being edited in two: the reader\'s text is added where the block was, nothing is overwritten', () =>
  conflictOutcome(
    async (range) => {
      const store = window.__marxyHandle.panes().panes[1].content.store();
      await store.apply({ range: { file: store.snapshot().path, start: range.start + 20, end: range.start + 20 }, replacement: '\n\n', label: 'split block' });
    },
    ({ first, third, ours }) => `${A.slice(0, first.range.start)}${ours}${first.text.slice(0, 20)}\n\n${first.text.slice(20)}${A.slice(first.range.end, third.range.start)}${A.slice(third.range.start)}`,
  ));


const KINDS = `# Title

A paragraph with *emphasis* and a [link](https://example.com).

- item one
- item two

> a quoted line

| a | b |
| - | - |
| 1 | 2 |

\`\`\`js
let x = 1;
\`\`\`

The last paragraph.
`;

test('each kind of block opens over its own bytes, hides its own element and folds back in place', async () => {
  await withPage({ '/c/k.md': KINDS }, ['/c/k.md'], async (page, mod) => {
    let current = KINDS;
    for (const type of ['heading', 'paragraph', 'list', 'blockquote', 'table', 'codeBlock']) {
      const block = firstBlock(current, type);
      const before = await bytesOf(page);
      await selectBlock(page, block.node.src.start);
      // A click on a list selects its first item; the item's parent is the list.
      if (type === 'list') await page.keyboard.press('Alt+Shift+ArrowUp');
      await page.keyboard.press(`${mod}+Enter`);
      await page.waitForSelector('.marxy-block-editor .cm-content');
      const shown = await page.evaluate(() => {
        const doc = [...document.querySelectorAll('.marxy-block-editor .cm-line')].map((l) => l.textContent).join('\n');
        const host = document.querySelector('.marxy-block-editor');
        return { doc, hidden: [...document.querySelectorAll('#doc [hidden]')].length, next: host.nextElementSibling?.hidden === true };
      });
      assert.equal(shown.doc, block.text, `${type}: the editor holds the block's bytes`);
      assert.ok(shown.hidden >= 1 && shown.next, `${type}: the block's element is out of the page while the editor is in`);
      await toEnd(page, mod);
      await page.keyboard.type('Q');
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => document.querySelector('.marxy-block-editor') === null);
      const after = await bytesOf(page);
      assert.equal(assertOnlyInside(before, after, block.range), `${block.text}Q`, `${type}: only the block changed`);
      assert.equal(await page.evaluate(() => document.querySelectorAll('#doc [hidden]').length), 0, `${type}: nothing is left hidden`);
      current = Buffer.from(after).toString('utf8');
    }
  });
});

test('undo from outside the editor takes the open block with it: it folds first, one step each', async () => {
  await withTypedBlock(async (page, mod, { original, first }) => {
    await page.evaluate(() => window.__marxyHandle.dispatch({ type: 'undo' }));
    await page.waitForFunction(() => document.querySelector('.marxy-block-editor') === null);
    // The typed text went into the document (one entry) and the undo took it straight out again.
    assert.deepEqual(await bytesOf(page), original);
    assert.equal((await stateOf(page)).canRedo, true);
    await page.evaluate(() => window.__marxyHandle.dispatch({ type: 'redo' }));
    await page.waitForFunction(() => window.__marxyHandle.document().snapshot().dirty);
    assert.equal(assertOnlyInside(original, await bytesOf(page), first.range), `${first.text} ZZ`);
  });
});

test('in a long document only the block that changed is replaced on the page', async () => {
  const body = Array.from({ length: 400 }, (_, i) => `Paragraph ${i}: ${'some words to fill the line out. '.repeat(6)}`).join('\n\n');
  const text = `# Long\n\n${body}\n`;
  assert.ok(text.length > 64 * 1024);
  const target = firstBlock(text, 'paragraph', 200);
  await withPage({ '/c/long.md': text }, ['/c/long.md'], async (page, mod) => {
    await page.evaluate(() => window.__marxyHandle.contentComplete());
    await page.evaluate(() => {
      window.__kept = [...document.querySelector('#doc').children];
      window.__repaints = performance.getEntriesByName('marxy:repaint').length;
    });
    await selectBlock(page, target.node.src.start);
    await page.keyboard.press(`${mod}+Enter`);
    await page.waitForSelector('.marxy-block-editor .cm-content');
    await toEnd(page, mod);
    await page.keyboard.type(' typo fixed');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelector('.marxy-block-editor') === null);
    await page.evaluate(() => window.__marxyHandle.panes().panes[0].view.settled());
    const out = await page.evaluate(() => {
      const now = [...document.querySelector('#doc').children];
      const kept = window.__kept.filter((el) => now.includes(el)).length;
      const repaints = performance.getEntriesByName('marxy:repaint').slice(window.__repaints);
      return { kept, before: window.__kept.length, now: now.length, how: repaints.map((r) => r.detail?.how) };
    });
    assert.deepEqual(out.how, ['replaced'], 'the page was patched, not set whole');
    assert.ok(out.kept >= out.before - 2, `${out.kept} of ${out.before} blocks kept their elements`);
    assert.equal(out.now, out.before);
    // The replaced block shows the new text, and the page holds no editor and nothing hidden.
    const shown = await page.evaluate(() => ({
      text: [...document.querySelectorAll('#doc > p')].find((p) => p.textContent.startsWith('Paragraph 200:'))?.textContent ?? '',
      hidden: document.querySelectorAll('#doc [hidden]').length,
    }));
    assert.match(shown.text.replace(/[^\p{L}\p{N}.]+/gu, ' ').trim(), /out\. typo fixed$/, shown.text.slice(-40));
    assert.equal(shown.hidden, 0);
  });
});

test('the edit key and its refusals are in the registry, and the palette can list it', async () => {
  await withPage({ '/c/A.md': A }, ['/c/A.md'], async (page) => {
    const listed = await page.evaluate(async () => {
      const { commands } = await import('/src/commands/index.ts');
      const cmd = commands().find((c) => c.id === 'edit.block');
      return cmd ? { title: cmd.title, key: cmd.key, group: cmd.group } : null;
    });
    assert.deepEqual(listed, { title: 'Edit block in place', key: 'Mod+Enter', group: 'selection' });
  });
});

test('where a block lands after another change: before it moves it, after it leaves it, across it is a conflict', () => {
  const range = { file: 'f', start: 100, end: 200 };
  assert.deepEqual(rebaseRange(range, null), { range, conflict: false });
  assert.deepEqual(rebaseRange(range, { start: 10, removed: 5, inserted: 20 }), { range: { file: 'f', start: 115, end: 215 }, conflict: false });
  assert.deepEqual(rebaseRange(range, { start: 100, removed: 0, inserted: 8 }), { range: { file: 'f', start: 108, end: 208 }, conflict: false }, 'an insertion at its start moves it');
  assert.deepEqual(rebaseRange(range, { start: 200, removed: 3, inserted: 9 }), { range, conflict: false }, 'a change from its end on leaves it');
  assert.deepEqual(rebaseRange(range, { start: 150, removed: 5, inserted: 5 }), { range: { file: 'f', start: 100, end: 100 }, conflict: true });
  assert.deepEqual(rebaseRange(range, { start: 90, removed: 20, inserted: 0 }), { range: { file: 'f', start: 90, end: 90 }, conflict: true }, 'a change that ate its start');
  assert.equal(BLOCK_EDIT_CAP, 64 * 1024);
});

const closeNotice = (page) =>
  page.evaluate(() => [...document.querySelectorAll('#marxy-notices .marxy-notice button')].map((b) => b.textContent));

test('closing the window over an editor that holds an edit asks first, and Save and close writes the edit', async () => {
  await withTypedBlock(async (page, mod, { path, first, original }) => {
    await page.evaluate(() => window.__marxyHandle.shell.emitCloseRequested());
    await page.waitForFunction(() => document.querySelectorAll('#marxy-notices .marxy-notice button').length > 0);
    assert.deepEqual(await closeNotice(page), ['Save and close', 'Close without saving', 'Dismiss']);
    assert.equal(await page.evaluate(() => window.__marxyHandle.shell.calls.filter((c) => c.method === 'confirmClose').length), 0, 'the window did not close');
    await page.evaluate(() => [...document.querySelectorAll('#marxy-notices .marxy-notice button')].find((b) => b.textContent === 'Save and close').click());
    await page.waitForFunction(() => window.__marxyHandle.shell.calls.some((c) => c.method === 'confirmClose'));
    const saved = await page.evaluate(async (p) => [...(await window.__marxyHandle.shell.readFile(p))], path);
    assert.equal(assertOnlyInside(original, saved, first.range), `${first.text} ZZ`);
  });
});

test('closing the window over an editor with nothing typed in it closes at once', async () => {
  const file = '03-ai-plan.md';
  const text = read(file);
  const first = firstBlock(text, 'paragraph');
  await withPage({ [`/c/${file}`]: text }, [`/c/${file}`], async (page, mod) => {
    await selectBlock(page, first.node.src.start);
    await page.keyboard.press(`${mod}+Enter`);
    await page.waitForSelector('.marxy-block-editor .cm-content');
    await page.evaluate(() => window.__marxyHandle.shell.emitCloseRequested());
    await page.waitForFunction(() => window.__marxyHandle.shell.calls.some((c) => c.method === 'confirmClose'));
    assert.deepEqual(await closeNotice(page), []);
  });
});

// F-34.2: the block's text is Source's (a byte that is not UTF-8 is a code unit of its own, shown as a marked byte), so a
// block edit beside a stray byte, or either side of one, keeps the byte.
const STRAY_FILE = Buffer.concat([
  Buffer.from('# Title\n\nalpha '),
  Buffer.from([0xff]),
  Buffer.from(' omega\n\nsecond '),
  Buffer.from([0xe9]),
  Buffer.from(' para\n'),
]);
const withStray = (...parts) => Buffer.concat(parts.map((p) => (typeof p === 'string' ? Buffer.from(p) : Buffer.from(p))));

/** The paragraph block of `bytes` as the editor resolves it: its node start and edit range. */
function strayBlock(bytes, at = 0) {
  const ast = parseMarkdown(bytes, { file: 'x' });
  const node = ast.children.filter((c) => c.type === 'paragraph')[at];
  return { node, range: blockEditRange(ast, node) };
}

test('a block edit beside a stray byte, and either side of one, keeps the byte; the marker shows; Esc keeps the edit; one Mod+Z is exact (F-34.2)', async () => {
  const first = strayBlock(STRAY_FILE);
  await withPage({ '/c/stray.md': STRAY_FILE }, ['/c/stray.md'], async (page, mod) => {
    const original = await bytesOf(page);
    assert.deepEqual(original, [...STRAY_FILE]);
    await selectBlock(page, first.node.src.start);
    await page.keyboard.press(`${mod}+Enter`);
    await page.waitForSelector('.marxy-block-editor .cm-content');
    // The byte is marked with its value, and no lone surrogate (the editor's code unit for it) is on the page.
    assert.deepEqual(await page.locator('.marxy-block-editor .marxy-stray-byte').allTextContents(), ['FF']);
    assert.equal(await page.evaluate(() => /[\uD800-\uDFFF]/u.test(document.body.innerText)), false, 'no lone surrogate in the page');
    // Two edits, one either side of the byte: the start of the block, then its end.
    await page.keyboard.press(mod === 'Meta' ? 'Meta+ArrowUp' : 'Control+Home');
    await page.keyboard.type('A ');
    await toEnd(page, mod);
    await page.keyboard.type(' Z');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelector('.marxy-block-editor') === null);
    const edited = await bytesOf(page);
    assert.deepEqual(edited, [...withStray('# Title\n\nA alpha ', [0xff], ' omega Z\n\nsecond ', [0xe9], ' para\n')]);
    assert.equal(await page.evaluate(() => /[\uD800-\uDFFF]/u.test(document.body.innerText)), false, 'nor after the fold');
    // One step in the document: one Mod+Z puts back every byte.
    await page.keyboard.press(`${mod}+z`);
    await page.waitForFunction(() => !window.__marxyHandle.document().snapshot().canUndo);
    assert.deepEqual(await bytesOf(page), original);
    assert.equal((await stateOf(page)).dirty, false);
    await page.keyboard.press(`${mod}+Shift+z`);
    await page.waitForFunction(() => !window.__marxyHandle.document().snapshot().canRedo);
    assert.deepEqual(await bytesOf(page), edited);
  });
});

test('a block with a stray byte that is opened and left with nothing typed, or edited beside another block\'s stray, changes no other byte (F-34.2)', async () => {
  const second = strayBlock(STRAY_FILE, 1);
  await withPage({ '/c/stray.md': STRAY_FILE }, ['/c/stray.md'], async (page, mod) => {
    await selectBlock(page, strayBlock(STRAY_FILE).node.src.start);
    await page.keyboard.press(`${mod}+Enter`);
    await page.waitForSelector('.marxy-block-editor .cm-content');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelector('.marxy-block-editor') === null);
    assert.equal((await stateOf(page)).dirty, false, 'nothing typed: nothing changed');
    assert.deepEqual(await bytesOf(page), [...STRAY_FILE]);
    // The second paragraph: edit its start; the first paragraph's FF and its own E9 keep their bytes.
    await selectBlock(page, second.node.src.start);
    await page.keyboard.press(`${mod}+Enter`);
    await page.waitForSelector('.marxy-block-editor .cm-content');
    assert.deepEqual(await page.locator('.marxy-block-editor .marxy-stray-byte').allTextContents(), ['E9']);
    await page.keyboard.press(mod === 'Meta' ? 'Meta+ArrowUp' : 'Control+Home');
    await page.keyboard.type('> ');
    await page.keyboard.press(`${mod}+Enter`);
    await page.waitForFunction(() => document.querySelector('.marxy-block-editor') === null);
    assert.deepEqual(await bytesOf(page), [...withStray('# Title\n\nalpha ', [0xff], ' omega\n\n> second ', [0xe9], ' para\n')]);
  });
});
