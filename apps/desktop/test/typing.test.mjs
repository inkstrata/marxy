// Typed letters land as text where the reader put the caret and never run as single-key verbs: after Mod+E and the
// Source button (the caret is in the editor at the reading line, or where the reader left it), after `e` (the caret is at
// the end of the block's text and never inside its syntax), and with the Line open (Mod+P selects its text). Source
// opened for another pane never takes the keys. Each word is made of verb keys (c copy, e edit, t tick, l in, j next),
// so a key that reached the page would show.
import { strict as assert } from 'node:assert';
import { after, test as nodeTest } from 'node:test';
import { closeHarness } from './support/two-pane.mjs';
import { skip, withFrame } from './support/frame.mjs';

const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);
after(() => closeHarness());

const WORD = 'jetcell';
const DOC = [
  '# Notes', '', 'A paragraph to read.', '',
  '- one item', '- two item',
  '- [ ] ask Priya', '- [ ] second task', '',
  '> a quote line', '',
  'Last words.', '',
].join('\n');
const FILES = { '/r/notes.md': DOC };

/** A long page, so that Read can be scrolled to a block far from the top. */
const LONG = [
  '# Long', '',
  ...Array.from({ length: 60 }, (_, n) => `Paragraph ${n + 1} runs long enough to wrap across a few lines of the column, so that the page is tall and the reading line falls inside it.\n`),
].join('\n');

const SYNTAX = [
  '# Syntax', '',
  '```js', 'let a = 1;', '```', '',
  'Setext title', '============', '',
  '- ', '', '- [ ] ', '',
  '| h1 | h2 |', '| -- | -- |', '| c1 | c2 |', '',
  '- parent', '  - child', '',
  'End.', '',
].join('\n');

const blur = (page) => page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
const keys = async (page, ...list) => {
  for (const k of list) await page.keyboard.press(k);
};
const bufferText = (page) => page.evaluate(() => new TextDecoder().decode(window.__marxyHandle.document().snapshot().buffer.bytes));
const sourceFocused = (page) => page.evaluate(() => document.activeElement?.closest('.cm-content') != null);
const inMode = (page, mode) => page.waitForFunction((m) => window.__marxyHandle.sourceHarness()?.mode === m, mode);

/** No surface a verb opens is up. */
async function assertQuiet(page) {
  const open = await page.evaluate(() => ({
    menu: document.querySelector('.marxy-verb-menu') !== null,
    look: [...document.querySelectorAll('[data-marxy-look-popover], .marxy-look-popover')].some((e) => !e.hidden),
    line: document.querySelector('#marxy-palette')?.open === true,
  }));
  assert.deepEqual(open, { menu: false, look: false, line: false });
}

/** The word is where `at` says: the file is its old bytes with the word inserted there, and nothing else changed. */
function assertInsertedAt(before, now, at) {
  assert.equal(now, before.slice(0, at) + WORD + before.slice(at));
}

/** From the top, the keys that bring the cursor onto the part whose text starts with `text`. */
async function cursorOn(page, text, path) {
  await blur(page);
  await keys(page, 'g', 'g', ...path);
  const now = await page.evaluate(() => (document.querySelector('[data-marxy-pane="0"] .marxy-article .marxy-cursor')?.textContent.trim() ?? '').slice(0, 40));
  assert.ok(now.startsWith(text), `the cursor is on ${JSON.stringify(now)}, not ${text}`);
}

/** The start byte of the top-level block the reading line (40 % down the window) falls in, read from the page. */
const blockAtReadingLine = (page) =>
  page.evaluate(() => {
    const y = window.innerHeight * 0.4;
    const blocks = [...document.querySelectorAll('[data-marxy-pane="0"] .marxy-article > [data-marxy-s]')];
    const el = blocks.find((b) => b.getBoundingClientRect().bottom > y);
    return Number(el.getAttribute('data-marxy-s'));
  });

/** Scrolls Read down by wheel and returns the start of the block now at the reading line. */
async function scrollRead(page) {
  await page.mouse.move(600, 400);
  await page.mouse.wheel(0, 2400);
  await page.waitForTimeout(400);
  const at = await blockAtReadingLine(page);
  assert.ok(at > 500, `Read is scrolled: the block at the reading line starts at byte ${at}`);
  return at;
}

async function typeInSourceThenLeave(page, mod, before, at) {
  await inMode(page, 'source');
  assert.equal(await sourceFocused(page), true, 'focus is in the editor');
  await page.keyboard.type(WORD);
  await page.keyboard.press(`${mod}+e`);
  await inMode(page, 'rendered');
  assertInsertedAt(before, await bufferText(page), at);
  await assertQuiet(page);
}

test('Mod+E from a scrolled page puts the caret in the editor at the block on the reading line; a typed word is text', async () => {
  await withFrame({ files: { '/r/long.md': LONG }, open: ['/r/long.md'] }, async (page, { mod }) => {
    const at = await scrollRead(page);
    await blur(page);
    await page.keyboard.press(`${mod}+e`);
    await typeInSourceThenLeave(page, mod, LONG, at);
  });
});

test('the Source button from a scrolled page puts the caret at the block on the reading line; a typed word is text', async () => {
  await withFrame({ files: { '/r/long.md': LONG }, open: ['/r/long.md'] }, async (page, { mod }) => {
    const at = await scrollRead(page);
    await page.click('.marxy-rs-source');
    await typeInSourceThenLeave(page, mod, LONG, at);
  });
});

test('the caret the reader left in Source is kept across Read and back when Read was not scrolled', async () => {
  await withFrame({ files: { '/r/long.md': LONG }, open: ['/r/long.md'] }, async (page, { mod }) => {
    await blur(page);
    await page.keyboard.press(`${mod}+e`);
    await inMode(page, 'source');
    await page.keyboard.press(`${mod}+End`);
    await page.keyboard.press(`${mod}+e`);
    await inMode(page, 'rendered');
    await page.keyboard.press(`${mod}+e`);
    await inMode(page, 'source');
    assert.equal(await sourceFocused(page), true);
    await page.keyboard.type(WORD);
    await page.keyboard.press(`${mod}+e`);
    await inMode(page, 'rendered');
    assertInsertedAt(LONG, await bufferText(page), LONG.length);
  });
});

test('Mod+2 opens Source in the right pane and leaves the keys, and focus, in the left one', async () => {
  await withFrame({ files: FILES, open: ['/r/notes.md'] }, async (page, { mod }) => {
    await blur(page);
    await page.keyboard.press(`${mod}+2`);
    await page.waitForFunction(() => window.__marxyHandle.panes().panes.length === 2 && window.__marxyHandle.panes().panes[1].view.mode === 'source');
    await page.waitForTimeout(300);
    const where = await page.evaluate(() => ({
      right: document.querySelector('[data-marxy-pane="1"]')?.contains(document.activeElement) ?? false,
      leftHasFocus: document.querySelector('[data-marxy-pane="0"]')?.hasAttribute('data-marxy-focus') ?? false,
    }));
    assert.deepEqual(where, { right: false, leftHasFocus: true });
    await page.keyboard.press('j');
    assert.equal(await bufferText(page), DOC, 'a typed letter did not reach the right-hand editor');
    assert.equal(await page.evaluate(() => window.__marxyHandle.selection.state().selection.kind), 'node', 'the key acted on the left pane');
  });
});

/** `e` on the part starting `text`, then the word, then Esc: the word is at `end` (the end of the block's text). */
async function editAndType(page, text, path, end) {
  await cursorOn(page, text, path);
  await page.keyboard.press('e');
  await page.waitForSelector('.marxy-block-editor .cm-content');
  await page.keyboard.type(WORD);
  await page.keyboard.press('Escape');
  await page.waitForSelector('.marxy-block-editor', { state: 'detached' });
  assertInsertedAt(DOC, await bufferText(page), end);
  await assertQuiet(page);
}

const endOf = (line) => DOC.indexOf(line) + line.length;

test('e on a list item: the word goes after the item\'s text, the marker intact', async () => {
  await withFrame({ files: FILES, open: ['/r/notes.md'] }, async (page) => {
    await editAndType(page, 'two item', ['j', 'j', 'l', 'j'], endOf('- two item'));
  });
});

test('e on a task item: the word goes after the task\'s text, so the box and the item above are intact', async () => {
  await withFrame({ files: FILES, open: ['/r/notes.md'] }, async (page) => {
    await editAndType(page, 'second task', ['j', 'j', 'l', 'j', 'j', 'j'], endOf('- [ ] second task'));
  });
});

test('e on a quote: the word goes after the quote\'s text, the marker intact', async () => {
  await withFrame({ files: FILES, open: ['/r/notes.md'] }, async (page) => {
    await editAndType(page, 'a quote line', ['j', 'j', 'j'], endOf('> a quote line'));
  });
});

/** Opens the block at `marker` for editing (Mod+Enter on the selected block), types the word, leaves with Esc. */
async function editAt(page, mod, marker, type, end, into = []) {
  const byte = Buffer.byteLength(SYNTAX.slice(0, SYNTAX.indexOf(marker)));
  await blur(page);
  await page.evaluate((b) => window.__marxyHandle.selection.selectBlockAtByte(b), byte);
  await keys(page, ...into);
  assert.equal(await page.evaluate(() => window.__marxyHandle.selection.state().selection.node?.type), type);
  await page.keyboard.press(`${mod}+Enter`);
  await page.waitForSelector('.marxy-block-editor .cm-content');
  await page.keyboard.type(WORD);
  await page.keyboard.press('Escape');
  await page.waitForSelector('.marxy-block-editor', { state: 'detached' });
  assertInsertedAt(SYNTAX, await bufferText(page), end);
}

for (const [name, marker, type, end, into] of [
  ['a code fence: the word ends the last code line, not the closing fence', '```js', 'codeBlock', SYNTAX.indexOf('let a = 1;') + 'let a = 1;'.length],
  ['a setext heading: the word ends the title line, not the underline', 'Setext title', 'heading', SYNTAX.indexOf('Setext title') + 'Setext title'.length],
  ['an empty list item: the marker keeps its space', '- \n', 'listItem', SYNTAX.indexOf('- \n') + 2],
  ['an empty task item: the box stays', '- [ ] \n', 'listItem', SYNTAX.indexOf('- [ ] \n') + 6],
  ['a table: the word ends the last cell, no cell is added', '| h1 | h2 |', 'tableCell', SYNTAX.indexOf('| c2 |') + 4],
  ['a list item with a nested list: the word ends the item\'s own text', '- parent', 'listItem', SYNTAX.indexOf('- parent') + '- parent'.length, ['l']],
]) {
  test(`e keeps the syntax of ${name}`, async () => {
    await withFrame({ files: { '/r/syntax.md': SYNTAX }, open: ['/r/syntax.md'] }, async (page, { mod }) => {
      await editAt(page, mod, marker, type, end, into);
    });
  });
}

test('Mod+P with the Line open selects its text; Esc closes it; a word typed after is the Line\'s', async () => {
  await withFrame({ files: FILES, open: ['/r/notes.md'] }, async (page, { mod }) => {
    await blur(page);
    await page.keyboard.press(`${mod}+p`);
    await page.waitForFunction(() => document.querySelector('#marxy-palette')?.open === true);
    await page.keyboard.type('ab');
    await page.keyboard.press(`${mod}+p`);
    assert.equal(await page.evaluate(() => document.querySelector('#marxy-palette')?.open), true, 'the second Mod+P leaves the Line open');
    await page.keyboard.type(WORD);
    assert.equal(await page.evaluate(() => document.querySelector('#marxy-palette input').value), WORD, 'the text was selected, so the word replaced it');
    assert.equal(await bufferText(page), DOC);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelector('#marxy-palette')?.open !== true);
    await assertQuiet(page);
  });
});

test('the Enter menu names every verb the verb bar does, each once, with the bar\'s key on the row that does the same', async () => {
  await withFrame({ files: FILES, open: ['/r/notes.md'] }, async (page) => {
    await cursorOn(page, 'second task', ['j', 'j', 'l', 'j', 'j', 'j']);
    const bar = await page.evaluate(() => [...document.querySelectorAll('.marxy-verb-bar [data-marxy-verb]')].map((b) => b.getAttribute('data-marxy-verb')).filter((id) => id !== 'cursor.menu'));
    await page.keyboard.press('Enter');
    await page.waitForSelector('.marxy-verb-menu');
    const rows = await page.evaluate(() => [...document.querySelectorAll('.marxy-verb-menu [role="menuitem"]')].map((r) => ({ id: r.getAttribute('data-row-key'), key: r.querySelector('.marxy-verb-menu-key')?.textContent ?? null })));
    const ids = rows.map((r) => r.id);
    assert.equal(new Set(ids).size, ids.length, ids.join(','));
    const same = { 'cursor.tick': 'op.toggle-task', 'cursor.source': 'view.jump-to-source', 'cursor.copy': 'op.copy-source' };
    for (const id of bar) assert.ok(ids.includes(id) || ids.includes(same[id]), `${id} is on the bar and not in the menu: ${ids.join(',')}`);
    for (const [barId, op] of Object.entries(same)) assert.ok(!(ids.includes(barId) && ids.includes(op)), `${barId} and ${op} are both listed: ${ids.join(',')}`);
    assert.equal(rows.find((r) => r.id === 'op.toggle-task')?.key?.toLowerCase(), 't');
  });
});
