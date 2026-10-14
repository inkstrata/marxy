// Undo and line endings never add or rewrite a byte the reader did not edit (F-40, ADR-0069, commitment 3).
// The oracle is the bytes: every byte outside the reader's edit is identical across a save, an undo and a block edit,
// computed here from the file itself and never by the product's own encoder. Booted on the shipped skeleton over the
// memory shell (test/support/two-pane.mjs), driven through keys and the save, in WebKit.
//
// 1. A Source save that makes a mixed-ending file uniform, then Mod+Z, appended 0D 0A (the separator swap replaced
//    the whole text under the editor's history).
// 2. Source Mod+Z after an undo in Rendered added a byte (the editor's history outlived a change made outside it).
// 3. A block edit across the bare LF or CRLF of a mixed-ending block rewrote the endings it did not touch.
import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { after, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { blockEditRange, parseMarkdown } from '../../../packages/core/src/index.ts';
import { bootTwoPanes, closeHarness } from './support/two-pane.mjs';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);
after(() => closeHarness());

const PATH = '/c/p.md';
/** Bytes from strings (UTF-8) and arrays (raw byte values). */
const B = (...parts) => Buffer.concat(parts.map((p) => Buffer.from(p)));
const hex = (b) => [...b].map((x) => x.toString(16).padStart(2, '0')).join(' ');

/** The bytes the Source text names: a lone U+DC80..U+DCFF is that byte, everything else is its UTF-8 (the ADR-0069 rule, written out again). */
function named(text) {
  const out = [];
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    const next = text.charCodeAt(i + 1);
    if (c >= 0xd800 && c < 0xdc00 && next >= 0xdc00 && next < 0xe000) {
      out.push(...Buffer.from(text.slice(i, i + 2)));
      i++;
    } else if (c >= 0xdc80 && c <= 0xdcff) out.push(c - 0xdc00);
    else out.push(...Buffer.from(text[i]));
  }
  return out;
}

async function withApp(bytes, fn) {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    await bootTwoPanes(page, { files: { [PATH]: bytes }, open: [PATH] });
    await page.waitForFunction(() => document.querySelector('#doc [data-marxy-s]') !== null);
    const mod = (await page.evaluate(() => navigator.platform)) === 'MacIntel' ? 'Meta' : 'Control';
    const t = {
      page,
      mod,
      /** The store's bytes. */
      buf: () => page.evaluate(() => [...window.__marxyHandle.panes().panes[0].content.store().snapshot().buffer.bytes]),
      /** The bytes on disk (the memory shell). */
      disk: () => page.evaluate(async (p) => [...(await window.__marxyHandle.shell.readFile(p))], PATH),
      // Local versions (V-06) are Marxy's own state under /data, written after a save: not the save itself.
      writes: () => page.evaluate(() => window.__marxyHandle.shell.calls.filter((c) => c.method === 'writeFileAtomic' && !String(c.args[0]).startsWith('/data/versions-')).length),
      /** What the Source editor's text names. */
      doc: async () =>
        named(await t.cm(`return ed.view.state.sliceDoc(0, ed.view.state.doc.length)`)),
      cm: (js, arg) =>
        page.evaluate(
          async ([js, arg]) => {
            const { activeSourceEditor } = await import('/src/source/editor.ts');
            return new Function('ed', 'arg', `return (async () => { ${js} })()`)(activeSourceEditor(), arg);
          },
          [js, arg],
        ),
      toSource: async () => {
        await page.keyboard.press(`${mod}+e`);
        await page.waitForFunction(() => document.body.dataset.marxyMode === 'source' && document.querySelector('.cm-line'));
      },
      toRendered: async () => {
        await page.keyboard.press(`${mod}+e`);
        await page.waitForFunction(() => document.body.dataset.marxyMode !== 'source');
      },
      /** Mod+S, and waits for the write it makes. */
      save: async () => {
        const before = await t.writes();
        await page.keyboard.press(`${mod}+s`);
        await page.waitForFunction((n) => window.__marxyHandle.shell.calls.filter((c) => c.method === 'writeFileAtomic' && !String(c.args[0]).startsWith('/data/versions-')).length > n, before);
      },
      /** The writes to `path` (the index and the layout are written too). */
      writesTo: (path) =>
        page.evaluate((p) => window.__marxyHandle.shell.calls.filter((c) => c.method === 'writeFileAtomic' && c.args[0] === p).length, path),
      /** Holds the store's queue for `ms`: whatever folds next waits its turn, as it does behind a slow write. */
      hold: (ms) =>
        page.evaluate((ms) => {
          window.__marxyHandle.document().serially(() => new Promise((r) => setTimeout(r, ms)));
        }, ms),
      /** Every title the shell is asked to set takes `ms` (a slow window manager); `window.__titles` counts the asks. */
      slowTitle: (ms) =>
        page.evaluate((ms) => {
          const shell = window.__marxyHandle.shell;
          window.__titles = 0;
          shell.setTitle = async () => {
            window.__titles += 1;
            await new Promise((r) => setTimeout(r, ms));
          };
        }, ms),
      /** Puts the caret where `needle` ends in the editor's text and focuses the editor. */
      caretAfter: (needle) =>
        t.cm(
          `ed.view.focus(); const at = ed.view.state.doc.toString().indexOf(arg); if (at < 0) throw new Error('no ' + arg);
           ed.view.dispatch({ selection: { anchor: at + arg.length } });`,
          needle,
        ),
    };
    return await fn(t);
  } finally {
    await browser.close();
  }
}

test('Source: a save that makes a mixed-ending file uniform, then Mod+Z, writes no byte the reader did not edit', async () => {
  // One bare LF among CRLFs; the reader deletes it, so the saved file is all CRLF. A stray byte rides along.
  const orig = B('# T\r\n\r\nalpha\nbeta ', [0xff], '\r\nend\r\n');
  const lf = orig.indexOf('alpha\n') + 5;
  const saved = B(orig.subarray(0, lf), orig.subarray(lf + 1));
  await withApp(orig, async (t) => {
    await t.toSource();
    await t.caretAfter('alpha');
    await t.page.keyboard.press('Delete');
    assert.equal(hex(await t.doc()), hex(saved), 'the editor names the file without the LF');
    await t.save();
    assert.equal(hex(await t.disk()), hex(saved), 'the save wrote exactly the edit');
    // Mod+Z in the editor: whatever it does, every byte it names is a byte the reader had.
    await t.page.keyboard.press(`${t.mod}+z`);
    const afterUndo = hex(await t.doc());
    assert.ok([hex(orig), hex(saved)].includes(afterUndo), `Mod+Z named bytes the reader never had: ${afterUndo}`);
    await t.save();
    assert.ok([hex(orig), hex(saved)].includes(hex(await t.disk())), 'and a save after it writes the same');
    // Rendered's undo (the store's) puts the original back, byte for byte.
    await t.toRendered();
    await t.page.keyboard.press(`${t.mod}+z`);
    await t.page.waitForFunction(() => !window.__marxyHandle.document().snapshot().canUndo);
    assert.equal(hex(await t.buf()), hex(orig), 'Rendered undo is exact');
  });
});

test('Source: a save that makes a uniform file mixed, then Mod+Z, writes no byte the reader did not edit', async () => {
  // The other direction: a CRLF file; the reader types a lone CR after `alpha` and deletes the `t` of `beta`, so the
  // saved file mixes endings. The three states the reader had are the bytes before the edits and after each.
  const orig = B('# T\r\n\r\nalpha\r\nbeta\r\n\r\nend\r\n');
  const cr = orig.indexOf('alpha') + 5;
  const withCr = B(orig.subarray(0, cr), '\r', orig.subarray(cr));
  const t0 = withCr.indexOf('beta') + 2;
  const saved = B(withCr.subarray(0, t0), withCr.subarray(t0 + 1));
  await withApp(orig, async (t) => {
    await t.toSource();
    await t.caretAfter('alpha');
    await t.cm(`const at = ed.view.state.selection.main.head; ed.view.dispatch({ changes: { from: at, insert: '\\r' }, selection: { anchor: at + 1 }, userEvent: 'input.type' })`);
    assert.equal(hex(await t.doc()), hex(withCr));
    await t.caretAfter('be');
    await t.page.keyboard.press('Delete');
    assert.equal(hex(await t.doc()), hex(saved));
    await t.save();
    assert.equal(hex(await t.disk()), hex(saved), 'the save wrote what the editor names');
    const states = new Set([hex(orig), hex(withCr), hex(saved)]);
    for (let i = 0; i < 3; i++) {
      await t.page.keyboard.press(`${t.mod}+z`);
      const now = hex(await t.doc());
      assert.ok(states.has(now), `Mod+Z named bytes the reader never had: ${now}`);
    }
    // Rendered's undo (the store's) steps back over every fold, and each step is a state the reader had.
    await t.toRendered();
    for (let i = 0; i < 4 && (await t.page.evaluate(() => window.__marxyHandle.document().snapshot().canUndo)); i++) {
      await t.page.keyboard.press(`${t.mod}+z`);
      await t.page.waitForTimeout(100);
      assert.ok(states.has(hex(await t.buf())), 'Rendered undo is exact');
    }
    assert.equal(hex(await t.buf()), hex(orig), 'and reaches the original');
  });
});

for (const [name, orig, needle] of [
  ['plain', B('# T\n\nhello world\n\nbye\n'), 'hello'],
  ['stray bytes that join', B('# T\n\nhello\n\nx', [0xc3], '\n', [0xa9], 'y\n\ntail ', [0xc3], '\n', [0xa9, 0xe2, 0x82], '\n'), 'hello'],
]) {
  test(`Source: Mod+Z after an undo in Rendered adds no byte (${name})`, async () => {
    await withApp(orig, async (t) => {
      await t.toSource();
      await t.caretAfter(needle);
      await t.page.keyboard.press('Delete');
      await t.page.keyboard.type('Q');
      await t.toRendered();
      assert.notEqual(hex(await t.buf()), hex(orig), 'the Source edit reached the document');
      await t.page.keyboard.press(`${t.mod}+z`);
      await t.page.waitForFunction(() => !window.__marxyHandle.document().snapshot().canUndo);
      assert.equal(hex(await t.buf()), hex(orig), 'Rendered undo is exact');
      await t.toSource();
      assert.equal(hex(await t.doc()), hex(orig), 'Source shows the bytes Rendered left');
      // Every Mod+Z in Source now: nothing the reader did there is left to undo, and no byte is added.
      for (let i = 0; i < 3; i++) {
        await t.page.keyboard.press(`${t.mod}+z`);
        assert.equal(hex(await t.doc()), hex(orig), `Source Mod+Z #${i + 1} changed the text`);
      }
      // And typing again after it undoes cleanly: the new history is the editor's own.
      await t.caretAfter(needle);
      await t.page.keyboard.type('W');
      await t.page.keyboard.press(`${t.mod}+z`);
      assert.equal(hex(await t.doc()), hex(orig), 'a new edit undoes to the bytes the reader had');
    });
  });
}

test('Source: a Rendered redo, then Mod+Z in Source, adds no byte', async () => {
  const orig = B('# T\n\nhello world\n\nbye\n');
  await withApp(orig, async (t) => {
    await t.toSource();
    await t.caretAfter('hello');
    await t.page.keyboard.press('Delete');
    await t.page.keyboard.type('Q');
    await t.toRendered();
    const edited = await t.buf();
    await t.page.keyboard.press(`${t.mod}+z`);
    await t.page.waitForFunction(() => !window.__marxyHandle.document().snapshot().canUndo);
    await t.page.keyboard.press(`${t.mod}+Shift+z`);
    await t.page.waitForFunction(() => !window.__marxyHandle.document().snapshot().canRedo);
    assert.equal(hex(await t.buf()), hex(edited), 'Rendered redo is exact');
    await t.toSource();
    for (let i = 0; i < 3; i++) {
      await t.page.keyboard.press(`${t.mod}+z`);
      const now = hex(await t.doc());
      assert.ok([hex(orig), hex(edited)].includes(now), `Source Mod+Z named bytes the reader never had: ${now}`);
    }
  });
});

/** Opens the editor on the file's first paragraph, types `edits` (a list of [key, text]), leaves with Escape. */
async function blockEdit(t, file, edits) {
  const ast = parseMarkdown(file, { file: 'x' });
  const node = ast.children.find((c) => c.type === 'paragraph');
  const range = blockEditRange(ast, node);
  await t.page.evaluate((b) => window.__marxyHandle.selection.selectBlockAtByte(b), node.src.start);
  await t.page.keyboard.press(`${t.mod}+Enter`);
  await t.page.waitForSelector('.marxy-block-editor .cm-content');
  for (const [where, text] of edits) {
    if (where === 'start') await t.page.keyboard.press(t.mod === 'Meta' ? 'Meta+ArrowUp' : 'Control+Home');
    else if (where === 'end') await t.page.keyboard.press(t.mod === 'Meta' ? 'Meta+ArrowDown' : 'Control+End');
    if (text === '\n') await t.page.keyboard.press('Enter');
    else await t.page.keyboard.type(text);
  }
  await t.page.keyboard.press('Escape');
  await t.page.waitForFunction(() => document.querySelector('.marxy-block-editor') === null);
  return range;
}

for (const [name, file] of [
  ['CRLF first', B('# T\r\n\r\nline1\r\nline2\nline3 ', [0xff], '\r\nline4\r\n\r\nnext\r\n')],
  ['lone CR first', B('# T\r\rline1\rline2\nline3\r\nline4 ', [0xff], '\r\rnext\r')],
  ['CRLF first, a lone CR inside', B('# T\r\n\r\nline1\r\nline2\rline3\r\nline4\r\n\r\nnext\r\n')],
]) {
  test(`Block editor: an edit at both ends of a mixed-ending block (${name}) rewrites no unedited ending`, async () => {
    await withApp(file, async (t) => {
      const range = await blockEdit(t, file, [['start', 'A'], ['end', 'Z']]);
      const expected = B(file.subarray(0, range.start), 'A', file.subarray(range.start, range.end), 'Z', file.subarray(range.end));
      assert.equal(hex(await t.buf()), hex(expected), 'only A and Z were added');
      await t.page.keyboard.press(`${t.mod}+z`);
      await t.page.waitForFunction(() => !window.__marxyHandle.document().snapshot().canUndo);
      assert.equal(hex(await t.buf()), hex(file), 'one Mod+Z puts the block back');
    });
  });
}

test('Block editor: a line break typed in a mixed-ending block follows its first ending; the other endings stay', async () => {
  const file = B('# T\r\n\r\nline1\r\nline2\nline3\r\nline4\r\n\r\nnext\r\n');
  await withApp(file, async (t) => {
    // Enter at the end of line1: the edit lies between two CRLFs, so the new break is a CRLF like its neighbours.
    const ast = parseMarkdown(file, { file: 'x' });
    const node = ast.children.find((c) => c.type === 'paragraph');
    const range = blockEditRange(ast, node);
    await t.page.evaluate((b) => window.__marxyHandle.selection.selectBlockAtByte(b), node.src.start);
    await t.page.keyboard.press(`${t.mod}+Enter`);
    await t.page.waitForSelector('.marxy-block-editor .cm-content');
    await t.page.keyboard.press(t.mod === 'Meta' ? 'Meta+ArrowUp' : 'Control+Home');
    await t.page.keyboard.press('End');
    await t.page.keyboard.press('Enter');
    await t.page.keyboard.press('Escape');
    await t.page.waitForFunction(() => document.querySelector('.marxy-block-editor') === null);
    const at = range.start + 'line1'.length;
    const expected = B(file.subarray(0, at), '\r\n', file.subarray(at));
    assert.equal(hex(await t.buf()), hex(expected));
  });
});

// 4. A keystroke in the same task as Mod+S (F-42). The save folds the editor's text into the store (async) and then took
//    the store's bytes back into the editor, which deleted what had been typed while it waited. Nothing typed is lost:
//    the keystroke stays in the editor and the store, and the next save writes it.
for (const [name, orig, prior] of [
  ['an edit before the save', B('# T\n\nhello world\n\nbye\n'), 'x'],
  ['no edit before the save', B('# T\n\nhello world\n\nbye\n'), null],
  ['a stray byte in the file', B('# T\n\nhello ', [0xff], ' world\n\nbye\n'), 'x'],
  ['a mixed-ending file made uniform', B('# T\r\n\r\nhello\nworld\r\n\r\nbye\r\n'), 'Delete'],
]) {
  test(`Source: a keystroke typed in the same task as Mod+S is kept and saved next (${name})`, async () => {
    await withApp(orig, async (t) => {
      await t.toSource();
      await t.caretAfter('hello');
      if (prior) await t.page.keyboard.press(prior);
      // Mod+S and a keystroke in one task: no await between them, so the save's fold has not settled.
      await t.cm(
        `const dom = ed.view.contentDOM;
         dom.dispatchEvent(new KeyboardEvent('keydown', { key: 's', code: 'KeyS', metaKey: arg.mod === 'Meta', ctrlKey: arg.mod === 'Control', bubbles: true, cancelable: true }));
         const at = ed.view.state.selection.main.head;
         ed.view.dispatch({ changes: { from: at, insert: 'Q' }, selection: { anchor: at + 1 }, userEvent: 'input.type' });`,
        { mod: t.mod },
      );
      await t.page.waitForTimeout(500);
      assert.ok((await t.doc()).includes(0x51), `the keystroke was dropped: ${hex(await t.doc())}`);
      // The keystroke is in the editor and the store. The first save may already have written it (the fold takes it in
      // before the write); either way a second Mod+S leaves the disk holding it.
      assert.equal(hex(await t.buf()), hex(await t.doc()), 'the store holds it too');
      await t.page.keyboard.press(`${t.mod}+s`);
      await t.page.waitForTimeout(500);
      assert.equal(hex(await t.disk()), hex(await t.doc()), 'the disk is what the editor names');
      assert.ok((await t.disk()).includes(0x51), 'the save wrote the keystroke');
      // It was this pane's own keystroke, not another pane's change: nothing says the text was held apart.
      assert.ok(!(await t.page.evaluate(() => document.body.innerText)).includes('Source in the other pane'));
    });
  });
}

// F-40.1: deleting only a CR inside a mixed-ending block is an edit and is written (it was folded to nothing).
for (const [name, file, line, back, cutAt] of [
  ['the CR of a CRLF', B('# T\r\n\r\nline1\r\nline2\nline3\r\nline4\r\n\r\nnext\r\n'), 0, 0, 'line1\r'],
  ['the CR of a CRLF beside a bare LF', B('# T\r\n\r\nline1\nline2\r\nline3\r\n\r\nnext\r\n'), 1, 0, 'line2\r'],
  // (a lone CR takes two arrow steps in WebKit, hence 6)
  ['a lone CR inside a line', B('# T\r\n\r\nline1\r\nline2\rline3\r\nline4\r\n\r\nnext\r\n'), 1, 6, 'line2\r'],
]) {
  test(`Block editor: deleting only ${name} of a mixed-ending block is written, and nothing else moves`, async () => {
    await withApp(file, async (t) => {
      const ast = parseMarkdown(file, { file: 'x' });
      const node = ast.children.find((c) => c.type === 'paragraph');
      await t.page.evaluate((b) => window.__marxyHandle.selection.selectBlockAtByte(b), node.src.start);
      await t.page.keyboard.press(`${t.mod}+Enter`);
      await t.page.waitForSelector('.marxy-block-editor .cm-content');
      // The caret just after the CR, by keys; then the real Backspace key.
      await t.page.keyboard.press(t.mod === 'Meta' ? 'Meta+ArrowUp' : 'Control+Home');
      for (let i = 0; i < line; i++) await t.page.keyboard.press('ArrowDown');
      await t.page.keyboard.press('End');
      for (let i = 0; i < back; i++) await t.page.keyboard.press('ArrowLeft');
      await t.page.keyboard.press('Backspace');
      await t.page.keyboard.press('Escape');
      await t.page.waitForFunction(() => document.querySelector('.marxy-block-editor') === null);
      const cr = file.indexOf(cutAt) + cutAt.length - 1;
      const expected = B(file.subarray(0, cr), file.subarray(cr + 1));
      assert.equal(hex(await t.buf()), hex(expected), 'exactly the CR is gone');
      await t.save();
      assert.equal(hex(await t.disk()), hex(expected), 'and the save writes it');
    });
  });
}

// 5. A keystroke while Mod+E's fold waits (F-42.1). Leaving Source folds the editor's text into the store and then
//    took the store's bytes back into the editor, which deleted whatever had been typed while the fold waited its turn
//    (the same shape as the save, F-42). Real keys: the fold waits behind a held store queue and the reader types.
for (const [name, orig, prior, typed] of [
  ['an edit before', B('# T\n\nhello world\n\nbye\n'), 'x', 'QRS'],
  ['no edit before', B('# T\n\nhello world\n\nbye\n'), null, 'QRS'],
  ['a stray byte in the file', B('# T\n\nhello ', [0xff], ' world\n\nbye\n'), 'x', 'Q'],
]) {
  test(`Source: keys typed while Mod+E's fold waits are kept in Rendered and saved next (${name})`, async () => {
    await withApp(orig, async (t) => {
      await t.toSource();
      await t.caretAfter('hello');
      if (prior) await t.page.keyboard.press(prior);
      await t.hold(900);
      await t.page.keyboard.press(`${t.mod}+e`);
      await t.page.keyboard.type(typed);
      await t.page.waitForFunction(() => document.body.dataset.marxyMode !== 'source', null, { timeout: 5000 });
      const want = (bytes) => bytes.includes(typed.charCodeAt(0)) && Buffer.from(bytes).toString('latin1').includes(typed);
      assert.ok(want(await t.buf()), `the store lost the keys: ${hex(await t.buf())}`);
      // Back in Source the editor names what the store holds, keys included.
      await t.toSource();
      assert.equal(hex(await t.doc()), hex(await t.buf()), 'the editor and the store agree');
      assert.ok(want(await t.doc()), 'the editor lost the keys');
      await t.toRendered();
      await t.save();
      assert.ok(want(await t.disk()), `the save did not write the keys: ${hex(await t.disk())}`);
      assert.equal(hex(await t.disk()), hex(await t.buf()), 'the disk is what the store holds');
      assert.ok(!(await t.page.evaluate(() => document.body.innerText)).includes('Source in the other pane'), 'no held-apart notice');
    });
  });
}

test("Source: a key typed while Mod+E's title refreshes is kept in Rendered too", async () => {
  const orig = B('# T\n\nhello world\n\nbye\n');
  await withApp(orig, async (t) => {
    await t.toSource();
    await t.caretAfter('hello');
    await t.page.keyboard.type('x');
    await t.slowTitle(700);
    await t.page.keyboard.press(`${t.mod}+e`);
    await t.page.waitForFunction(() => window.__titles > 0, null, { timeout: 5000 });
    await t.page.keyboard.type('Q'); // after the fold, while Source is still showing
    await t.page.waitForFunction(() => document.body.dataset.marxyMode !== 'source', null, { timeout: 5000 });
    assert.ok(Buffer.from(await t.buf()).toString('latin1').includes('xQ'), `the store lost the key: ${hex(await t.buf())}`);
    await t.toSource();
    assert.equal(hex(await t.doc()), hex(await t.buf()), 'the editor and the store agree');
  });
});

// 6. A keystroke while Save refreshes the title (F-42.1). The fold had settled, so the key was not part of it; the save
//    saw text the store lacked and refused ("Source in the other pane") though nothing was held apart. The save is
//    written and the key stays in the editor for the next save.
for (const [name, orig] of [
  ['an LF file', B('# T\n\nhello world\n\nbye\n')],
  ['a CRLF file with a stray byte', B('# T\r\n\r\nhello ', [0xff], ' world\r\n\r\nbye\r\n')],
]) {
  test(`Source: a key typed while Mod+S's title refreshes does not cancel the save (${name})`, async () => {
    await withApp(orig, async (t) => {
      await t.toSource();
      await t.caretAfter('hello');
      await t.page.keyboard.type('Z');
      const folded = hex(await t.doc());
      await t.slowTitle(700);
      const writes = await t.writesTo(PATH);
      await t.page.keyboard.press(`${t.mod}+s`);
      await t.page.waitForFunction(() => window.__titles > 0, null, { timeout: 5000 });
      await t.page.keyboard.type('Q'); // after the fold, during the title refresh
      await t.page.waitForTimeout(1500);
      assert.equal(await t.writesTo(PATH), writes + 1, 'the save wrote the file');
      assert.equal(hex(await t.disk()), folded, 'the disk holds the text the save folded');
      assert.ok(Buffer.from(await t.doc()).toString('latin1').includes('ZQ'), 'the editor kept the key');
      assert.ok(!(await t.page.evaluate(() => document.body.innerText)).includes('Source in the other pane'), 'no held-apart notice');
      await t.save();
      assert.ok(Buffer.from(await t.disk()).toString('latin1').includes('ZQ'), 'the next save wrote the key');
      assert.equal(hex(await t.disk()), hex(await t.doc()));
    });
  });
}
