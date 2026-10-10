// V-01: structural selection and line operations in Source. Node tests over a real CodeMirror state (no DOM):
// the file's bytes go in through `cmDocText` and `lineSeparatorFor`, an operation runs, and the bytes come out
// through `leaveSourceMode`, the Source fold the app uses, so what is checked is what would be saved.
import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { after, test, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { defaultKeymap, history, historyKeymap, undo, undoDepth } from '@codemirror/commands';
import { searchKeymap } from '@codemirror/search';
import { EditorSelection, EditorState } from '@codemirror/state';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { bootTwoPanes, closeHarness } from './support/two-pane.mjs';
import { createBuffer } from '../../../packages/core/src/index.ts';
import { PANE_CHORDS } from '../src/pane/keys.ts';
import { commands } from '../src/commands/index.ts';
import { SOURCE_EDIT_ENTRIES, sourceEditChords } from '../src/commands/source-edit.ts';
import { cmDocText, leaveSourceMode, lineSeparatorFor } from '../src/source/buffer-commit.ts';
import { keyBindingChords, registryChord, runStructure, withoutRegistryChords } from '../src/source/structure.ts';

const encoder = new TextEncoder();
const SEPARATORS = { lf: '\n', crlf: '\r\n', cr: '\r' };

/** Bytes of `lfText` in a file with separator `sep` and, optionally, a UTF-8 BOM. */
const fileBytes = (lfText, sep, bom) => encoder.encode((bom ? '﻿' : '') + lfText.replace(/\n/g, sep));

/** One editor session over `bytes`: the operation, then the file's bytes as the fold would write them. */
function session(bytes, op, sel, path = '/t/a.md') {
  const buffer = createBuffer(path, bytes);
  let state = EditorState.create({
    doc: cmDocText(buffer),
    selection: EditorSelection.single(sel.from, sel.to),
    extensions: [history(), EditorState.allowMultipleSelections.of(true), EditorState.lineSeparator.of(lineSeparatorFor(buffer))],
  });
  const dispatch = (tr) => {
    state = tr.state;
  };
  const ran = runStructure(op, { get state() { return state; }, dispatch }, path);
  const out = () => {
    const fold = leaveSourceMode(buffer, state.sliceDoc(0, state.doc.length));
    return fold.changed ? fold.buffer.bytes : bytes;
  };
  return {
    ran,
    bytes: out(),
    steps: undoDepth(state),
    undo() {
      undo({ state, dispatch });
      return out();
    },
    get state() {
      return state;
    },
  };
}

const text = (bytes) => new TextDecoder().decode(bytes);

// What each operation does to a file with LF line ends, written out by hand: the CRLF and CR runs below must be this, in their own separator.
const CASES = [
  { op: 'moveLineDown', input: 'a\nb\nc\n', sel: [0, 0], expected: 'b\na\nc\n' },
  { op: 'moveLineUp', input: 'a\nb\nc', sel: [4, 4], expected: 'a\nc\nb' },
  { op: 'duplicateLineDown', input: 'a\nb', sel: [2, 2], expected: 'a\nb\nb' },
  { op: 'duplicateLineUp', input: 'a\nb\n', sel: [0, 0], expected: 'a\na\nb\n' },
  { op: 'deleteLine', input: 'a\nb\nc\n', sel: [2, 2], expected: 'a\nc\n' },
  { op: 'joinLines', input: 'a\n  b\nc', sel: [0, 0], expected: 'a b\nc' },
  { op: 'sortLines', input: 'c\nb\na\n', sel: [0, 5], expected: 'a\nb\nc\n' },
  { op: 'toggleTask', input: 'x\n- [ ] a\nplain\n- b', sel: [0, 18], expected: 'x\n- [x] a\nplain\n- [ ] b' },
  { op: 'toggleQuote', input: 'a\nb', sel: [0, 3], expected: '> a\n> b' },
];

for (const eol of ['lf', 'crlf', 'cr']) {
  for (const bom of [false, true]) {
    for (const kase of CASES) {
      test(`${kase.op} keeps a ${eol.toUpperCase()} file ${eol.toUpperCase()}${bom ? ', its BOM' : ''}, and its last line's ending as it was; one undo step`, () => {
        const sep = SEPARATORS[eol];
        const bytes = fileBytes(kase.input, sep, bom);
        const r = session(bytes, kase.op, { from: kase.sel[0], to: kase.sel[1] });
        assert.equal(r.ran, true);
        assert.equal(text(r.bytes), text(fileBytes(kase.expected, sep, bom)), 'the bytes written');
        assert.equal(r.steps, 1, 'one undo step');
        assert.deepEqual([...r.undo()], [...bytes], 'one undo brings back every byte');
      });
    }
  }
}

test('a file with mixed endings keeps each line\'s own ending through every operation that moves lines', () => {
  const bytes = encoder.encode('a\r\nb\rc\nd');
  // `\r\n` lines keep their CR as a character, a lone CR stays inside its line: the editor's separator is "\n".
  const down = session(bytes, 'moveLineDown', { from: 0, to: 0 });
  assert.equal(text(down.bytes), 'b\rc\na\r\nd');
  assert.deepEqual([...down.undo()], [...bytes]);
  const sorted = session(encoder.encode('b\r\na\r\nc\r\n'), 'sortLines', { from: 0, to: 5 });
  assert.equal(text(sorted.bytes), 'a\r\nb\r\nc\r\n');
});

test('toggle task on several lines is one undo step; with no list marker it does nothing and says nothing', () => {
  const many = session(encoder.encode('- [ ] a\n- [x] b\n- c\n'), 'toggleTask', { from: 0, to: 20 });
  assert.equal(text(many.bytes), '- [x] a\n- [ ] b\n- [ ] c\n');
  assert.equal(many.steps, 1);
  assert.equal(text(many.undo()), '- [ ] a\n- [x] b\n- c\n');
  const bytes = encoder.encode('just text\n> a quote\n');
  const none = session(bytes, 'toggleTask', { from: 0, to: 19 });
  assert.equal(none.ran, false);
  assert.equal(none.steps, 0);
  assert.deepEqual([...none.bytes], [...bytes]);
});

test('toggle quote on several lines is one undo step', () => {
  const r = session(encoder.encode('a\nb\nc\n'), 'toggleQuote', { from: 0, to: 6 });
  assert.equal(text(r.bytes), '> a\n> b\n> c\n');
  assert.equal(r.steps, 1);
  assert.equal(text(r.undo()), 'a\nb\nc\n');
});

test('two operations in a row are two undo steps, not one', () => {
  const bytes = encoder.encode('c\nb\na\n');
  let state = EditorState.create({ doc: 'c\nb\na\n', selection: EditorSelection.single(0, 5), extensions: [history()] });
  const target = { get state() { return state; }, dispatch: (tr) => { state = tr.state; } };
  assert.ok(runStructure('sortLines', target, 'a.md'));
  assert.ok(runStructure('toggleQuote', target, 'a.md'));
  assert.equal(undoDepth(state), 2);
  assert.ok(bytes.length > 0);
});

test('toggle comment is one undo step in a language that has comments, and nothing in one that has none', async () => {
  const { markdown } = await import('@codemirror/lang-markdown');
  let state = EditorState.create({ doc: 'one\ntwo\n', selection: EditorSelection.single(0, 7), extensions: [history(), markdown()] });
  const target = { get state() { return state; }, dispatch: (tr) => { state = tr.state; } };
  assert.ok(runStructure('toggleComment', target, 'a.md'));
  assert.notEqual(state.doc.toString(), 'one\ntwo\n');
  assert.equal(undoDepth(state), 1);
  undo(target);
  assert.equal(state.doc.toString(), 'one\ntwo\n');
  const plain = session(encoder.encode('one\n'), 'toggleComment', { from: 0, to: 0 }, '/t/a.txt');
  assert.equal(plain.ran, false);
});

test('block and section select the exact ranges; expand walks to the end of the document and stops', () => {
  const doc = '# T\n\npara\n\n## S\n\n- x\n- y\n';
  const sel = (op, at) => session(encoder.encode(doc), op, { from: at, to: at }).state.selection.main;
  const at = doc.indexOf('para') + 1;
  assert.deepEqual([sel('selectBlock', at).from, sel('selectBlock', at).to], [doc.indexOf('para'), doc.indexOf('para') + 4]);
  const s = sel('selectSection', doc.indexOf('- y'));
  assert.equal(doc.slice(s.from, s.to), '## S\n\n- x\n- y\n');
  // expand, again and again
  let state = EditorState.create({ doc, selection: EditorSelection.single(at, at), extensions: [] });
  const target = { get state() { return state; }, dispatch: (tr) => { state = tr.state; } };
  const seen = [];
  while (runStructure('expandSelection', target, 'a.md')) seen.push(doc.slice(state.selection.main.from, state.selection.main.to));
  assert.deepEqual(seen, ['para', doc]);
  assert.equal(runStructure('expandSelection', target, 'a.md'), false);
});

test('in a Source file that is not Markdown, block is a paragraph and section is nothing', () => {
  const log = 'a\nb\n\nc\nd\n';
  const block = session(encoder.encode(log), 'selectBlock', { from: 5, to: 5 }, '/t/run.log').state.selection.main;
  assert.equal(log.slice(block.from, block.to), 'c\nd');
  assert.equal(session(encoder.encode(log), 'selectSection', { from: 5, to: 5 }, '/t/run.log').ran, false);
});

test('next occurrence and all occurrences come from the editor\'s search', () => {
  const next = session(encoder.encode('ab ab ab\n'), 'selectNextOccurrence', { from: 0, to: 2 });
  assert.equal(next.state.selection.ranges.length, 2);
  const all = session(encoder.encode('ab ab ab\n'), 'selectAllOccurrences', { from: 0, to: 2 });
  assert.equal(all.state.selection.ranges.length, 3);
});

// The property: the same file in LF, CRLF and CR, with and without a BOM and a final newline, gives the same
// result in its own separator, for a seeded run of random files and selections.
test('property: every line operation on random files is the same in CRLF and CR as in LF, one undo step, bytes outside it untouched', () => {
  let seed = 20261010;
  const rnd = (n) => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed % n;
  };
  const words = ['alpha', 'Beta', '- item', '- [ ] todo', '- [x] done', '> q', '', '  indented', 'zeta', 'é ü', '1. one', '# head'];
  const ops = ['joinLines', 'sortLines', 'toggleTask', 'toggleQuote', 'deleteLine', 'moveLineUp', 'moveLineDown', 'duplicateLineUp', 'duplicateLineDown'];
  let checked = 0;
  for (let trial = 0; trial < 120; trial++) {
    const lines = Array.from({ length: 2 + rnd(7) }, () => words[rnd(words.length)]);
    const finalNewline = rnd(2) === 1;
    const lf = lines.join('\n') + (finalNewline ? '\n' : '');
    const a = rnd(lf.length + 1);
    const b = rnd(2) ? a : Math.min(lf.length, a + rnd(lf.length + 1));
    for (const op of ops) {
      const base = session(fileBytes(lf, '\n', false), op, { from: a, to: b });
      for (const [eol, sep] of [['crlf', '\r\n'], ['cr', '\r']]) {
        for (const bom of [false, true]) {
          const bytes = fileBytes(lf, sep, bom);
          const r = session(bytes, op, { from: a, to: b });
          const msg = `${op} ${eol}${bom ? ' bom' : ''} on ${JSON.stringify(lf)} [${a},${b}]`;
          assert.equal(r.ran, base.ran, msg);
          if (!base.ran) {
            assert.deepEqual([...r.bytes], [...bytes], `${msg}: nothing changed`);
            continue;
          }
          assert.equal(text(r.bytes), text(fileBytes(text(base.bytes), sep, bom)), msg);
          assert.equal(r.steps, 1, `${msg}: one undo step`);
          assert.deepEqual([...r.undo()], [...bytes], `${msg}: undo`);
          checked++;
        }
      }
    }
  }
  assert.ok(checked > 1000, `the property ran (${checked})`);
});

// Keys: one table, no collision.
const MAC = true;

test('registry: no chord is bound twice, and the new chords do not touch a pane chord', () => {
  const owner = new Map();
  for (const cmd of commands()) {
    for (const spec of [cmd.key, ...(cmd.keys ?? [])].filter(Boolean)) {
      const chord = registryChord(spec, MAC);
      if (chord === null) continue;
      assert.equal(owner.get(chord), undefined, `${spec} is bound by both ${owner.get(chord)} and ${cmd.id}`);
      owner.set(chord, cmd.id);
    }
  }
  for (const entry of SOURCE_EDIT_ENTRIES) {
    const cmd = commands().find((c) => c.id === entry.id);
    assert.ok(cmd, `${entry.id} is registered`);
    assert.equal(cmd.global, true, `${entry.id} runs from inside the editor`);
  }
  // A pane chord is `Mod` plus a physical key; none of ours is `Mod+Backslash`, digits or arrows with Alt.
  const paneKeys = new Set(PANE_CHORDS.map((c) => `meta-${c.shift ? 'shift-' : ''}${c.alt ? 'alt-' : ''}${c.code}`));
  for (const entry of SOURCE_EDIT_ENTRIES.filter((e) => e.key?.startsWith('Mod'))) {
    const parts = entry.key.split('+');
    const code = parts.at(-1).length === 1 ? `Key${parts.at(-1).toUpperCase()}` : parts.at(-1);
    assert.ok(!paneKeys.has(`meta-${parts.includes('Shift') ? 'shift-' : ''}${parts.includes('Alt') ? 'alt-' : ''}${code}`), `${entry.key} is a pane chord`);
  }
  // `Mod+/` is the transforms key: no source command takes it.
  assert.ok(!SOURCE_EDIT_ENTRIES.some((e) => e.key === 'Mod+/'));
});

test('registry: the editor keeps none of the chords the registry binds in Source, and drops only those', () => {
  const defaults = [...defaultKeymap, ...historyKeymap, ...searchKeymap];
  const owned = sourceEditChords();
  const kept = withoutRegistryChords(defaults, owned, MAC);
  const taken = new Set(owned.map((s) => registryChord(s, MAC)).filter(Boolean));
  for (const binding of kept) {
    for (const chord of keyBindingChords(binding, MAC)) assert.ok(!taken.has(chord), `the editor still binds ${chord}`);
  }
  const before = new Set(defaults.flatMap((b) => keyBindingChords(b, MAC)));
  const after = new Set(kept.flatMap((b) => keyBindingChords(b, MAC)));
  const dropped = [...before].filter((c) => !after.has(c) || false).sort();
  // Exactly the defaults that sat on our chords: next occurrence, all occurrences, delete line, toggle comment, and two Mac emacs-style selects (syntax right, char left).
  assert.deepEqual(dropped, ['ctrl-shift-arrowright', 'ctrl-shift-b', 'meta-/', 'meta-d', 'meta-shift-k', 'meta-shift-l']);
  // The expand chord's base binding (cursor by syntax) is still there: only its shift variant went.
  assert.ok(after.has('ctrl-arrowright'));
});

// In the running app: the keys, from inside the editor and past the pane listener, and two panes.
const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const browserTest = (name, fn) => nodeTest(name, { skip }, fn);
after(() => closeHarness());

const files = {
  '/r/A.md': '# Alpha\n\nalpha one\nalpha two\n\n## Part\n\nalpha three\n',
  '/r/B.md': '# Bravo\n\nbravo one\nbravo two\n\n- [ ] task\n',
};

async function withPanes(fn) {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 1470, height: 900 } });
    await bootTwoPanes(page, { files, open: ['/r/A.md', '/r/B.md'] });
    await fn(page);
  } finally {
    await browser.close();
  }
}

const editorText = (page, slot) =>
  page.evaluate(async (slot) => {
    const { activeSourceEditor } = await import('/src/source/editor.ts');
    return activeSourceEditor(window.__marxyHandle.panes().panes[slot].parts.source)?.docText() ?? null;
  }, slot);
const storeText = (page, slot) =>
  page.evaluate((slot) => new TextDecoder().decode(window.__marxyHandle.panes().panes[slot].view.store().snapshot().buffer.bytes), slot);
const selectionOf = (page, slot) =>
  page.evaluate(async (slot) => {
    const { activeSourceEditor } = await import('/src/source/editor.ts');
    const view = activeSourceEditor(window.__marxyHandle.panes().panes[slot].parts.source).view;
    return view.state.selection.ranges.map((r) => view.state.sliceDoc(r.from, r.to));
  }, slot);
async function caretAt(page, slot, needle, delta = 0) {
  await page.evaluate(async ({ slot, needle, delta }) => {
    const { activeSourceEditor } = await import('/src/source/editor.ts');
    const view = activeSourceEditor(window.__marxyHandle.panes().panes[slot].parts.source).view;
    const at = view.state.doc.toString().indexOf(needle) + delta;
    view.dispatch({ selection: { anchor: at } });
    view.focus();
  }, { slot, needle, delta });
}
async function bothInSource(page) {
  await page.keyboard.press('Meta+1');
  await page.keyboard.press('Meta+e');
  await page.waitForSelector('#marxy-source .cm-content');
  await page.keyboard.press('Meta+2');
  await page.keyboard.press('Meta+e');
  await page.waitForSelector('#marxy-source-2 .cm-content');
}

browserTest('the keys work from inside the editor, past the pane listener, and each runs once', async () => {
  await withPanes(async (page) => {
    await bothInSource(page);
    await page.keyboard.press('Meta+1');
    await caretAt(page, 0, 'alpha one', 2);
    await page.keyboard.press('Control+Shift+B');
    assert.deepEqual(await selectionOf(page, 0), ['alpha one\nalpha two']);
    await page.keyboard.press('Control+Shift+S');
    assert.equal((await selectionOf(page, 0))[0], '# Alpha\n\nalpha one\nalpha two\n\n## Part\n\nalpha three\n');
    await caretAt(page, 0, 'alpha one', 2);
    // Expand: word, then line; one press is one step (the editor's own select-syntax chord does not also run).
    await page.keyboard.press('Control+Shift+ArrowRight');
    assert.deepEqual(await selectionOf(page, 0), ['alpha']);
    await page.keyboard.press('Control+Shift+ArrowRight');
    assert.deepEqual(await selectionOf(page, 0), ['alpha one']);
    // Next occurrence: one more range per press.
    await caretAt(page, 0, 'alpha one', 2);
    await page.keyboard.press('Meta+d');
    assert.deepEqual(await selectionOf(page, 0), ['alpha']);
    await page.keyboard.press('Meta+d');
    assert.deepEqual(await selectionOf(page, 0), ['alpha', 'alpha']);
    await caretAt(page, 0, 'alpha one', 2);
    await page.keyboard.press('Meta+d');
    await page.keyboard.press('Meta+Shift+l');
    assert.equal((await selectionOf(page, 0)).length, 3);
    // Line ops are one step each.
    await caretAt(page, 0, 'alpha one');
    await page.keyboard.press('Control+j');
    assert.ok((await editorText(page, 0)).includes('alpha one alpha two\n'));
    await page.keyboard.press('Meta+z');
    assert.ok((await editorText(page, 0)).includes('alpha one\nalpha two\n'), 'one Mod+Z undoes the join');
    // Mod+/ is not toggle comment.
    const before = await editorText(page, 0);
    await page.keyboard.press('Meta+/');
    assert.equal(await editorText(page, 0), before);
  });
});

browserTest('with two panes in Source, an operation changes its own pane\'s document and nothing else, until folded', async () => {
  await withPanes(async (page) => {
    await bothInSource(page);
    const leftBefore = await editorText(page, 0);
    const storesBefore = [await storeText(page, 0), await storeText(page, 1)];
    await page.keyboard.press('Meta+2');
    await caretAt(page, 1, '- [ ] task');
    await page.keyboard.press('Control+Shift+T');
    assert.ok((await editorText(page, 1)).includes('- [x] task'));
    assert.equal(await editorText(page, 0), leftBefore, 'the left pane\'s editor is unchanged');
    assert.deepEqual([await storeText(page, 0), await storeText(page, 1)], storesBefore, 'no store has it yet');
    assert.deepEqual(await page.evaluate(() => window.__marxyHandle.panes().panes.map((p) => p.view.sourceHasUnfoldedEdits())), [false, true]);
    // The Source fold is the one way it reaches the store: the right document only.
    await page.evaluate(() => window.__marxyHandle.panes().panes[1].content.foldSource());
    assert.equal(await storeText(page, 1), storesBefore[1].replace('- [ ] task', '- [x] task'));
    assert.equal(await storeText(page, 0), storesBefore[0]);
  });
});

browserTest('in Rendered no Source key does anything, and Source gains no element', async () => {
  await withPanes(async (page) => {
    const rendered = await page.evaluate(() => ({ html: window.__marxyHandle.panes().panes[0].article.innerHTML, mode: document.body.dataset.marxyMode }));
    for (const chord of ['Control+j', 'Control+Shift+B', 'Control+Shift+T', 'Meta+Shift+k', 'Control+Shift+ArrowRight']) await page.keyboard.press(chord);
    assert.deepEqual(await page.evaluate(() => ({ html: window.__marxyHandle.panes().panes[0].article.innerHTML, mode: document.body.dataset.marxyMode })), rendered);
    assert.deepEqual([await storeText(page, 0), await storeText(page, 1)], [files['/r/A.md'], files['/r/B.md']]);
    await page.keyboard.press('Meta+e');
    await page.waitForSelector('#marxy-source .cm-content');
    // The editor's own elements, by class with the generated and state classes left out.
    const frame = () => page.evaluate(() => [...new Set([...document.querySelectorAll('#marxy-source *')].map((e) => `${e.tagName}.${String(e.className).split(/\s+/).filter((c) => c.startsWith('cm-') && c !== 'cm-focused').join('.')}`))].filter((c) => !/cm-(cursor|selection|layer)/.test(c)).sort().join('|'));
    const before = await frame();
    await caretAt(page, 0, 'alpha one', 2);
    for (const chord of ['Control+Shift+B', 'Control+Shift+S', 'Control+Shift+ArrowRight', 'Meta+d', 'Meta+Shift+l', 'Meta+l']) await page.keyboard.press(chord);
    await caretAt(page, 0, 'alpha two');
    for (const chord of ['Control+j', 'Control+Shift+Q']) await page.keyboard.press(chord);
    assert.equal(await page.evaluate(() => document.querySelectorAll('#marxy-source [role=toolbar], #marxy-source [role=menu], #marxy-source button').length), 0);
    const after = await frame();
    assert.equal(after, before, 'the same kinds of element as before: nothing was added to the frame');
  });
});
