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
import { keyBindingChords, registryChord, replaceRange, runStructure, runTableTool, tableCsvAt, withoutRegistryChords } from '../src/source/structure.ts';
import { runTransform } from '../../../packages/core/src/index.ts';
import { copyTableCsv } from '../../../packages/core/src/operations/copy-table.ts';
import { parseMarkdown } from '../../../packages/core/src/parse/parse.ts';

const encoder = new TextEncoder();
const SEPARATORS = { lf: '\n', crlf: '\r\n', cr: '\r' };

/** Bytes of `lfText` in a file with separator `sep` and, optionally, a UTF-8 BOM. */
const fileBytes = (lfText, sep, bom) => encoder.encode((bom ? '﻿' : '') + lfText.replace(/\n/g, sep));

/** One editor session over `bytes`: the operation, then the file's bytes as the fold would write them. */
function session(bytes, op, sel, path = '/t/a.md') {
  const buffer = createBuffer(path, bytes);
  let state = EditorState.create({
    doc: cmDocText(buffer),
    selection: Array.isArray(sel)
      ? EditorSelection.create(sel.map((r) => EditorSelection.range(r.from, r.to)))
      : EditorSelection.single(sel.from, sel.to),
    extensions: [history(), EditorState.allowMultipleSelections.of(true), EditorState.lineSeparator.of(lineSeparatorFor(buffer))],
  });
  const dispatch = (tr) => {
    state = tr.state;
  };
  const target = { get state() { return state; }, dispatch };
  // A V-02 table tool is `{ table: 'alignTable' }`; the rest are V-01 operations.
  const ran = typeof op === 'object' ? runTableTool(op.table, target, path) : runStructure(op, target, path);
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

test('property: several carets (adjacent, repeated, on one line) give the same bytes in LF, CRLF and CR, and the bytes of untouched lines stay', () => {
  let seed = 4242;
  const rnd = (n) => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed % n;
  };
  const words = ['alpha', 'Beta', '- item', '- [ ] todo', '> q', '', 'zeta', '1. one'];
  const ops = ['joinLines', 'sortLines', 'toggleTask', 'toggleQuote', 'deleteLine', 'duplicateLineUp', 'duplicateLineDown'];
  for (let trial = 0; trial < 80; trial++) {
    const lines = Array.from({ length: 3 + rnd(6) }, () => words[rnd(words.length)]);
    const lf = lines.join('\n') + (rnd(2) ? '\n' : '');
    const carets = Array.from({ length: 2 + rnd(3) }, () => {
      const a = rnd(lf.length + 1);
      return { from: a, to: rnd(3) === 0 ? Math.min(lf.length, a + rnd(5)) : a };
    });
    for (const op of ops) {
      const base = session(fileBytes(lf, '\n', false), op, carets);
      for (const sep of ['\r\n', '\r']) {
        const bytes = fileBytes(lf, sep, true);
        const r = session(bytes, op, carets);
        const msg = `${op} ${JSON.stringify(sep)} on ${JSON.stringify(lf)} ${JSON.stringify(carets)}`;
        assert.equal(r.ran, base.ran, msg);
        if (!base.ran) continue;
        assert.equal(text(r.bytes), text(fileBytes(text(base.bytes), sep, true)), msg);
        assert.equal(r.steps, 1, msg);
        assert.deepEqual([...r.undo()], [...bytes], msg);
      }
    }
  }
});

test('carets on neighbouring lines: join and delete line act once', () => {
  const two = [{ from: 0, to: 0 }, { from: 2, to: 2 }];
  assert.equal(text(session(encoder.encode('a\r\nb\r\nc\r\nd\r\n'), 'joinLines', two).bytes), 'a b\r\nc\r\nd\r\n');
  assert.equal(text(session(encoder.encode('a\nb\nc\nd\n'), 'deleteLine', two).bytes), 'c\nd\n');
});

// ---- V-02: table tools ------------------------------------------------------------------------------------------

// What each tool does to a table in a file with LF line ends and the caret in `^`, by hand: the CRLF and CR runs,
// with and without a BOM, with and without a final newline, must be this in their own separator. `^` is removed.
const TABLE_CASES = [
  { tool: 'alignTable', input: 'intro\n\n| a | b |\n|:-:|--:|\n| 1 | ^22 |\n\nouttro\n', expected: 'intro\n\n| a   | b   |\n| :-: | --: |\n| 1   | 22  |\n\nouttro\n' },
  { tool: 'addTableRow', input: 'intro\n\n| a | b |\n|---|---|\n| ^1 | 2 |\n\nouttro\n', expected: 'intro\n\n| a | b |\n|---|---|\n| 1 | 2 |\n|  |  |\n\nouttro\n' },
  { tool: 'addTableColumn', input: 'intro\n\n| a | b |\n|---|---|\n| ^1 | 2 |\n\nouttro\n', expected: 'intro\n\n| a |  | b |\n|---|---|---|\n| 1 |  | 2 |\n\nouttro\n' },
  { tool: 'sortTableRows', input: 'intro\n\n| a | b |\n|---|---|\n| z | 1 |\n| ^a | 2 |\n\nouttro\n', expected: 'intro\n\n| a | b |\n|---|---|\n| a | 2 |\n| z | 1 |\n\nouttro\n' },
];

/** `input` with its caret marker removed, and the caret. */
const withCaret = (input) => ({ lf: input.replace('^', ''), at: input.indexOf('^') });

for (const eol of ['lf', 'crlf', 'cr']) {
  for (const bom of [false, true]) {
    for (const finalNewline of [true, false]) {
      for (const kase of TABLE_CASES) {
        test(`${kase.tool} keeps a ${eol.toUpperCase()} file ${eol.toUpperCase()}${bom ? ', its BOM' : ''} and ${finalNewline ? 'its final newline' : 'no final newline'}; one undo step`, () => {
          const sep = SEPARATORS[eol];
          const trim = (t) => (finalNewline ? t : t.replace(/\n$/, ''));
          const { lf, at } = withCaret(trim(kase.input));
          const bytes = fileBytes(lf, sep, bom);
          const r = session(bytes, { table: kase.tool }, { from: at, to: at });
          assert.equal(r.ran, true);
          assert.equal(text(r.bytes), text(fileBytes(trim(kase.expected), sep, bom)), 'the bytes written');
          assert.equal(r.steps, 1, 'one undo step');
          assert.deepEqual([...r.undo()], [...bytes], 'one undo brings back every byte');
        });
      }
    }
  }
}

test('every table tool with the caret outside a table does nothing: no change, no undo step, false', () => {
  for (const input of ['para ^graph\n\n| a |\n|---|\n| 1 |\n', '| a |\n|---|\n| 1 |\n\n^after\n', '```\n| a |\n|---|\n| ^1 |\n```\n']) {
    const { lf, at } = withCaret(input);
    for (const tool of ['alignTable', 'addTableRow', 'addTableColumn', 'sortTableRows']) {
      for (const sep of ['\n', '\r\n']) {
        const bytes = fileBytes(lf, sep, false);
        const r = session(bytes, { table: tool }, { from: at, to: at });
        assert.equal(r.ran, false, `${tool} in ${JSON.stringify(input)}`);
        assert.equal(r.steps, 0);
        assert.deepEqual([...r.bytes], [...bytes]);
      }
    }
    assert.equal(tableCsvAt(EditorState.create({ doc: lf, selection: { anchor: at } }), '/t/a.md'), null);
  }
});

test('table tools do nothing in a file that is not Markdown', () => {
  const { lf, at } = withCaret('| a |\n|---|\n| ^1 |\n');
  for (const tool of ['alignTable', 'addTableRow', 'addTableColumn', 'sortTableRows']) {
    const r = session(fileBytes(lf, '\n', false), { table: tool }, { from: at, to: at }, '/t/a.txt');
    assert.equal(r.ran, false);
    assert.equal(r.steps, 0);
  }
});

test('a table in a mixed-ending file: each tool keeps every other line\'s ending, and the table\'s own', () => {
  // The file's separator is "\n" (it is mixed), so a "\r" is a character at the end of a line, or inside one.
  const mixed = 'a\r\n\r\n| k |\n|---|\r\n| b |\n| ^a |\r\n\r\nz\rlone\n';
  const { lf, at } = withCaret(mixed);
  const bytes = encoder.encode(lf);
  const sorted = session(bytes, { table: 'sortTableRows' }, { from: at, to: at });
  assert.equal(text(sorted.bytes), 'a\r\n\r\n| k |\n|---|\r\n| a |\n| b |\r\n\r\nz\rlone\n');
  assert.deepEqual([...sorted.undo()], [...bytes]);
  const row = session(bytes, { table: 'addTableRow' }, { from: at, to: at });
  assert.equal(text(row.bytes), 'a\r\n\r\n| k |\n|---|\r\n| b |\n| a |\n|  |\r\n\r\nz\rlone\n');
  assert.deepEqual([...row.undo()], [...bytes]);
  const aligned = session(bytes, { table: 'alignTable' }, { from: at, to: at });
  assert.equal(text(aligned.bytes), 'a\r\n\r\n| k   |\n| --- |\r\n| b   |\n| a   |\r\n\r\nz\rlone\n');
  const column = session(bytes, { table: 'addTableColumn' }, { from: at, to: at });
  assert.equal(text(column.bytes), 'a\r\n\r\n| k |  |\n|---|---|\r\n| b |  |\n| a |  |\r\n\r\nz\rlone\n');
  assert.deepEqual([...column.undo()], [...bytes]);
});

test('a table in a block quote or a list item is edited with its prefix on every line, in CRLF too', () => {
  for (const sep of ['\n', '\r\n']) {
    for (const [first, rest] of [['> ', '> '], ['- ', '  '], ['1. ', '   '], ['> - ', '>   ']]) {
      const lines = [`${first}| k | v |`, `${rest}|---|---|`, `${rest}| b | 1 |`, `${rest}| ^a | 2 |`];
      const input = `${lines.join('\n')}\n`;
      const { lf, at } = withCaret(input);
      const bytes = fileBytes(lf, sep, false);
      const run = (tool) => session(bytes, { table: tool }, { from: at, to: at });
      const eolOf = (t) => t.replace(/\r\n/g, '\n');
      assert.equal(eolOf(text(run('sortTableRows').bytes)), `${first}| k | v |\n${rest}|---|---|\n${rest}| a | 2 |\n${rest}| b | 1 |\n`);
      assert.equal(eolOf(text(run('addTableRow').bytes)), `${first}| k | v |\n${rest}|---|---|\n${rest}| b | 1 |\n${rest}| a | 2 |\n${rest}|  |  |\n`);
      assert.equal(eolOf(text(run('addTableColumn').bytes)), `${first}| k |  | v |\n${rest}|---|---|---|\n${rest}| b |  | 1 |\n${rest}| a |  | 2 |\n`);
      const al = eolOf(text(run('alignTable').bytes));
      assert.equal(al, lf.replace(/\|---\|---\|/, '| --- | --- |').replace(/\| k \|/, '| k   |').replace(/\| b \|/, '| b   |').replace(/\| a \|/, '| a   |').replace(/\| v \|/, '| v   |').replace(/\| 1 \|/, '| 1   |').replace(/\| 2 \|/, '| 2   |'));
    }
  }
});

test('escaped pipes stay in their cell through every tool, and a code span\'s with them', () => {
  const input = '| name | code |\n|---|---|\n| b \\| c | `x\\|y` |\n| ^a | `p\\|q` |\n';
  const { lf, at } = withCaret(input);
  const run = (tool) => text(session(encoder.encode(lf), { table: tool }, { from: at, to: at }).bytes);
  assert.equal(run('sortTableRows'), '| name | code |\n|---|---|\n| a | `p\\|q` |\n| b \\| c | `x\\|y` |\n');
  assert.equal(run('addTableColumn'), '| name |  | code |\n|---|---|---|\n| b \\| c |  | `x\\|y` |\n| a |  | `p\\|q` |\n');
  assert.equal(run('addTableRow'), `${lf}|  |  |\n`);
  assert.equal(run('alignTable'), '| name   | code   |\n| ------ | ------ |\n| b \\| c | `x\\|y` |\n| a      | `p\\|q` |\n');
});

test('wide characters align by display width: CJK and emoji are two cells', () => {
  const { lf, at } = withCaret('| a | b |\n|---|---|\n| ^漢字 | 😀 |\n| xxxx | y |\n');
  const out = text(session(encoder.encode(lf), { table: 'alignTable' }, { from: at, to: at }).bytes);
  assert.equal(out, '| a    | b   |\n| ---- | --- |\n| 漢字 | 😀  |\n| xxxx | y   |\n');
});

test('sort leaves the header and alignment rows in place and is one undo step', () => {
  const { lf, at } = withCaret('| k |\n|:-:|\n| c |\n| ^a |\n| b |\n');
  const bytes = encoder.encode(lf);
  const r = session(bytes, { table: 'sortTableRows' }, { from: at, to: at });
  assert.equal(text(r.bytes), '| k |\n|:-:|\n| a |\n| b |\n| c |\n');
  assert.equal(r.steps, 1);
  assert.deepEqual([...r.undo()], [...bytes]);
});

test('Copy table as CSV is the text of C-07\'s copy-table-csv for the same table, and reads nothing it does not own', () => {
  const src = '| name | note |\n|:--|--:|\n| a,b | "q" |\n| =1+1 | x\\|y |\n| 名 | `c` |\n';
  for (const sep of ['\n', '\r\n']) {
    const { lf, at } = withCaret(src.replace('| a,b', '| ^a,b'));
    const buffer = createBuffer('/t/a.md', fileBytes(lf, sep, true));
    const state = EditorState.create({ doc: cmDocText(buffer), selection: { anchor: at }, extensions: [EditorState.lineSeparator.of(lineSeparatorFor(buffer))] });
    const doc = parseMarkdown(lf);
    const table = doc.children.find((n) => n.type === 'table');
    const expected = copyTableCsv.run({ document: doc, node: table, range: table.src, text: '' }).clipboard.text;
    assert.equal(tableCsvAt(state, '/t/a.md'), expected);
    assert.equal(expected, 'name,note\r\n"a,b","""q"""\r\n\'=1+1,x|y\r\n名,c');
    assert.equal(state.doc.toString(), lf, 'the editor is not touched');
  }
});

test('the table commands are palette-only entries of the Source group, each runs from inside the editor and has a title that says what it does', () => {
  const table = SOURCE_EDIT_ENTRIES.filter((e) => e.table !== undefined);
  assert.deepEqual(table.map((e) => e.table), ['alignTable', 'addTableRow', 'addTableColumn', 'sortTableRows', 'copyTableCsv']);
  for (const entry of table) {
    assert.equal(entry.key, undefined, `${entry.id} takes no key`);
    assert.match(entry.id, /^source\.table-/);
  }
  assert.match(table.find((e) => e.table === 'sortTableRows').title, /byte order/);
});

// W-21: Apply on the result sheet is `replaceRange`, one transaction.

/** `replaceRange` over [from, to) of a file's text, with `transform` run on the text as the sheet reads it (the file's own separator). */
function replacing(bytes, from, to, transform, path = '/t/a.md') {
  const buffer = createBuffer(path, bytes);
  let state = EditorState.create({
    doc: cmDocText(buffer),
    selection: EditorSelection.single(from, to),
    extensions: [history(), EditorState.lineSeparator.of(lineSeparatorFor(buffer))],
  });
  const target = { get state() { return state; }, dispatch: (tr) => { state = tr.state; } };
  const input = state.doc.sliceString(from, to, state.lineBreak);
  const output = transform(input);
  const ran = replaceRange(target, from, to, output);
  const out = () => {
    const fold = leaveSourceMode(buffer, state.sliceDoc(0, state.doc.length));
    return fold.changed ? fold.buffer.bytes : bytes;
  };
  return { ran, input, output, bytes: out(), steps: undoDepth(state), get state() { return state; }, undo() { undo(target); return out(); } };
}

for (const eol of ['lf', 'crlf', 'cr']) {
  for (const bom of [false, true]) {
    test(`replaceRange applies a transform to a selection of a ${eol.toUpperCase()} file${bom ? ' with a BOM' : ''}: the bytes outside the range stay, the endings are the file's, one undo step restores every byte`, () => {
      const sep = SEPARATORS[eol];
      const bytes = fileBytes('head\nc\nb\na\ntail\n', sep, bom);
      // CodeMirror counts a line break as one position whatever its separator.
      const doc = 'head\nc\nb\na\ntail\n';
      const from = doc.indexOf('c');
      const to = doc.indexOf('tail') - 1;
      const r = replacing(bytes, from, to, (t) => runTransform('sort', t));
      assert.equal(r.ran, true);
      assert.equal(text(r.bytes), text(fileBytes('head\na\nb\nc\ntail\n', sep, bom)));
      assert.equal(r.steps, 1, 'one undo step');
      assert.equal(r.state.sliceDoc(r.state.selection.main.from, r.state.selection.main.to), r.output, 'the result is selected');
      assert.deepEqual([...r.undo()], [...bytes], 'one undo gives back every byte');
    });
  }
}

test('replaceRange keeps a mixed-ending file\'s other lines as they were, and a doubled CR never appears', () => {
  const bytes = encoder.encode('x\r\nc\r\nb\r\na\r\ny\nz');
  const r = replacing(bytes, 3, 12, (t) => runTransform('sort', t));
  assert.equal(r.ran, true);
  assert.ok(!/\r\r/.test(text(r.bytes)), JSON.stringify(text(r.bytes)));
  assert.equal(text(r.bytes).startsWith('x\r\n'), true);
  assert.equal(text(r.bytes).endsWith('y\nz'), true);
  assert.deepEqual([...r.undo()], [...bytes]);
});

test('replaceRange does nothing, dispatches nothing and says false for the same text or a range outside the document', () => {
  const bytes = encoder.encode('a\nb\n');
  assert.equal(replacing(bytes, 0, 3, (t) => t).ran, false, 'the same text');
  assert.equal(replacing(bytes, 0, 3, (t) => t).steps, 0);
  const buffer = createBuffer('/t/a.md', bytes);
  let state = EditorState.create({ doc: cmDocText(buffer), extensions: [history()] });
  const calls = [];
  const target = { get state() { return state; }, dispatch: (tr) => calls.push(tr) };
  for (const [from, to] of [[0, 99], [-1, 2], [3, 1], [0.5, 2]]) assert.equal(replaceRange(target, from, to, 'zzz'), false, `${from}..${to}`);
  assert.equal(calls.length, 0);
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
  await page.keyboard.press('Meta+Alt+ArrowLeft');
  await page.keyboard.press('Meta+e');
  await page.waitForSelector('#marxy-source .cm-content');
  await page.keyboard.press('Meta+Alt+ArrowRight');
  await page.keyboard.press('Meta+e');
  await page.waitForSelector('#marxy-source-2 .cm-content');
}

browserTest('the keys work from inside the editor, past the pane listener, and each runs once', async () => {
  await withPanes(async (page) => {
    await bothInSource(page);
    await page.keyboard.press('Meta+Alt+ArrowLeft');
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
    await page.keyboard.press('Meta+Alt+ArrowRight');
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

browserTest('the find panel\'s field keeps its own keys: the Source chords do nothing from it', async () => {
  await withPanes(async (page) => {
    await bothInSource(page);
    await page.keyboard.press('Meta+Alt+ArrowLeft');
    await caretAt(page, 0, 'alpha one');
    await page.keyboard.press('Meta+f');
    await page.waitForSelector('#marxy-source .cm-search input');
    await page.focus('#marxy-source .cm-search input[name=search]');
    const before = await editorText(page, 0);
    for (const chord of ['Control+j', 'Meta+d', 'Meta+Shift+l', 'Meta+l']) await page.keyboard.press(chord);
    assert.equal(await editorText(page, 0), before);
    assert.equal(await page.evaluate(() => document.activeElement?.closest('.cm-panels') !== null), true, 'focus stays in the panel');
  });
});

// ---- V-02 in the running app: the palette commands over a real editor, the Source fold and Save --------------------------

const TABLE_DOC = '/r/T.md';
// CRLF, a BOM and no final newline: the table is the last block of the file.
const TABLE_FILE = '﻿# Notes\r\n\r\n| k | v |\r\n|:--|--:|\r\n| b | 1 |\r\n| a | 22 |';

async function withTable(fn) {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    await bootTwoPanes(page, { files: { [TABLE_DOC]: TABLE_FILE }, open: [TABLE_DOC], guard: true });
    const mod = (await page.evaluate(() => navigator.platform)) === 'MacIntel' ? 'Meta' : 'Control';
    await page.keyboard.press(`${mod}+e`);
    await page.waitForFunction(() => document.body.dataset.marxyMode === 'source');
    await page.waitForSelector('.cm-content');
    const api = {
      mod,
      doc: () => page.evaluate(async () => (await import('/src/source/editor.ts')).activeSourceEditor().docText()),
      caretAt: (needle, delta = 0) =>
        page.evaluate(async ({ needle, delta }) => {
          const { activeSourceEditor } = await import('/src/source/editor.ts');
          const view = activeSourceEditor().view;
          view.dispatch({ selection: { anchor: view.state.doc.toString().indexOf(needle) + delta } });
          view.focus();
        }, { needle, delta }),
      /** Runs the registry command as the palette does; resolves whether the palette offers it in Source. */
      run: (id) =>
        page.evaluate(async (id) => {
          const { commands } = await import('/src/commands/index.ts');
          const { buildAppContext } = await import('/src/selection/bind.ts');
          const cmd = commands().find((c) => c.id === id);
          const ctx = buildAppContext();
          const offered = cmd.when(ctx);
          await cmd.run(ctx);
          return offered;
        }, id),
      notices: () => page.evaluate(() => [...document.querySelectorAll('.marxy-notice-text')].map((n) => n.textContent)),
      /** Saves with the Mod+S chord and returns the bytes on disk. */
      save: async () => {
        await page.evaluate(() => { window.__appWrites.length = 0; });
        await page.keyboard.press(`${mod}+s`);
        await page.waitForFunction((p) => window.__appWrites.some((w) => w.path === p), TABLE_DOC, { timeout: 5000 });
        return page.evaluate((p) => window.__marxyHandle.shell.peekFile(p).then((b) => [...b]), TABLE_DOC);
      },
      /** Mod+Z presses that change the text: the history's depth. Undoes everything it counts. */
      undoSteps: async () => {
        let steps = 0;
        for (let i = 0; i < 8; i++) {
          const before = await api.doc();
          await page.keyboard.press(`${mod}+z`);
          if ((await api.doc()) === before) break;
          steps += 1;
        }
        return steps;
      },
      writes: () => page.evaluate(() => window.__marxyHandle.shell.calls.filter((c) => c.method === 'writeFileAtomic' && !c.args[0].startsWith('/data/')).length),
    };
    await fn(page, api);
  } finally {
    await browser.close();
  }
}

const asBytes = (s) => [...new TextEncoder().encode(s)];
const TABLE_EXPECTED = {
  'source.table-align': { at: ['| a |', 4], file: TABLE_FILE.replace('| k | v |', '| k   | v   |').replace('|:--|--:|', '| :-- | --: |').replace('| b | 1 |', '| b   | 1   |').replace('| a | 22 |', '| a   | 22  |') },
  'source.table-add-row': { at: ['| a |', 4], file: `${TABLE_FILE}\r\n|  |  |` },
  'source.table-add-column': { at: ['| a |', 4], file: TABLE_FILE.replace('| k | v |', '| k |  | v |').replace('|:--|--:|', '|:--|---|--:|').replace('| b | 1 |', '| b |  | 1 |').replace('| a | 22 |', '| a |  | 22 |') },
  'source.table-sort': { at: ['| a |', 4], file: TABLE_FILE.replace('| b | 1 |\r\n| a | 22 |', '| a | 22 |\r\n| b | 1 |') },
};

for (const [id, want] of Object.entries(TABLE_EXPECTED)) {
  browserTest(`${id} in the app: one undo step, and Save writes the file's own CRLF, BOM and missing final newline`, async () => {
    await withTable(async (page, s) => {
      const original = await s.doc();
      await s.caretAt(...want.at);
      assert.equal(await s.run(id), true, 'offered in Source');
      const edited = await s.doc();
      assert.notEqual(edited, original);
      assert.deepEqual(await s.save(), asBytes(want.file), 'the bytes on disk');
      await s.caretAt(...want.at);
      assert.equal(await s.undoSteps(), 1, 'one Mod+Z undoes the whole operation');
      assert.equal(await s.doc(), original);
      assert.deepEqual(await s.save(), asBytes(TABLE_FILE), 'saved again, the original bytes');
    });
  });
}

browserTest('the table commands with the caret outside a table do nothing and say nothing', async () => {
  await withTable(async (page, s) => {
    const original = await s.doc();
    await s.caretAt('# Notes', 2);
    const writes = await s.writes();
    for (const id of ['source.table-align', 'source.table-add-row', 'source.table-add-column', 'source.table-sort', 'source.table-copy-csv']) await s.run(id);
    assert.equal(await s.doc(), original);
    assert.equal(await s.undoSteps(), 0, 'no undo step');
    assert.deepEqual(await s.notices(), []);
    assert.equal(await page.evaluate(() => window.__marxyHandle.shell.calls.filter((c) => /clipboard/i.test(c.method) && !/Types|Read/.test(c.method)).length), 0, 'nothing on the pasteboard');
    assert.equal(await s.writes(), writes);
  });
});

browserTest('Copy table as CSV in Source goes through the one copy path: one pasteboard item, the text of copy-table-csv, one notice', async () => {
  await withTable(async (page, s) => {
    await s.caretAt('| a |', 4);
    await page.evaluate(() => { window.__marxyHandle.shell.calls.length = 0; });
    await s.run('source.table-copy-csv');
    const item = await page.evaluate(() => {
      const [w] = window.__marxyHandle.shell.calls.filter((c) => c.method === 'clipboardWriteItem');
      return w ? { reps: w.args[0].map((r) => ({ type: r.type, text: new TextDecoder().decode(r.bytes) })), others: window.__marxyHandle.shell.calls.filter((c) => c.method === 'clipboardWriteItem').length } : null;
    });
    assert.deepEqual(item, { reps: [{ type: 'public.utf8-plain-text', text: 'k,v\r\nb,1\r\na,22' }], others: 1 });
    assert.deepEqual(await s.notices(), ['Copied table as CSV, 14 B']);
    assert.equal(await s.doc(), TABLE_FILE.slice(1), 'the editor is untouched');
  });
});

browserTest('the table commands are offered in Source and not in Rendered', async () => {
  await withTable(async (page, s) => {
    const offered = () =>
      page.evaluate(async () => {
        const { commands } = await import('/src/commands/index.ts');
        const { buildAppContext } = await import('/src/selection/bind.ts');
        return commands().filter((c) => c.id.startsWith('source.table-')).map((c) => c.when(buildAppContext()));
      });
    assert.deepEqual(await offered(), [true, true, true, true, true]);
    await page.keyboard.press(`${s.mod}+e`);
    await page.waitForFunction(() => document.body.dataset.marxyMode === 'rendered');
    assert.deepEqual(await offered(), [false, false, false, false, false]);
  });
});
