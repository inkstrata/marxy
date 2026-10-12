// Formatting commands and inserts (V-08), over a real CodeMirror state with no DOM: the file's bytes go in through
// `cmDocText` and `lineSeparatorFor`, a command runs, and the bytes come out through `leaveSourceMode`, the Source fold the
// app uses, so what is checked is what would be saved.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { history, undo, undoDepth } from '@codemirror/commands';
import { EditorSelection, EditorState } from '@codemirror/state';
import { createBuffer } from '@marxy/core';
import { cmDocText, leaveSourceMode, lineSeparatorFor } from './buffer-commit.ts';
import { fenceSpans, formatRefusalText, formatsPath, insertAtCaret, runFormat, wrapSelection, type FormatEdit, type FormatOp, type InsertKind, type WrapKind } from './format-ops.ts';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const SEP = { lf: '\n', crlf: '\r\n', cr: '\r' } as const;

/** Applies an edit to plain text the way the editor does, in the editor's one-character line breaks. */
function applyEdit(text: string, edit: FormatEdit): { text: string; selected: string } {
  let out = text;
  for (const c of [...edit.changes].sort((a, b) => b.from - a.from)) out = out.slice(0, c.from) + c.insert + out.slice(c.to);
  return { text: out, selected: out.slice(edit.selection.from, edit.selection.to) };
}

function wrapped(text: string, from: number, to: number, kind: WrapKind) {
  const outcome = wrapSelection(text, { from, to }, kind);
  assert.ok('edit' in outcome, `declined: ${'declined' in outcome ? outcome.declined : ''}`);
  return { ...applyEdit(text, outcome.edit), edit: outcome.edit };
}

test('bold twice returns the bytes, whether a selection or the word at the caret', () => {
  const text = 'one two three\n';
  const once = wrapped(text, 4, 7, 'bold');
  assert.equal(once.text, 'one **two** three\n');
  assert.equal(once.selected, 'two', 'the text stays selected, so the next press unwraps');
  const twice = wrapped(once.text, once.edit.selection.from, once.edit.selection.to, 'bold');
  assert.equal(twice.text, text);
  // The word at an empty caret, in the middle of it.
  const word = wrapped(text, 5, 5, 'bold');
  assert.equal(word.text, 'one **two** three\n');
  assert.equal(wrapped(word.text, word.edit.selection.from, word.edit.selection.from, 'bold').text, text);
});

test('every wrap kind round-trips and each adds only its markers', () => {
  const text = 'a word here';
  for (const [kind, mark] of [['bold', '**'], ['italic', '*'], ['code', '`'], ['strike', '~~']] as const) {
    const once = wrapped(text, 2, 6, kind);
    assert.equal(once.text, `a ${mark}word${mark} here`, kind);
    assert.equal(wrapped(once.text, once.edit.selection.from, once.edit.selection.to, kind).text, text, `${kind} twice`);
    // Taking the markers out of the result gives the original: nothing else moved.
    assert.equal(once.text.split(mark).join(''), text, `${kind} adds only its markers`);
  }
});

test('italic and bold compose: *** is both, and each takes only its own off', () => {
  const bold = wrapped('x word y', 2, 6, 'bold');
  const both = wrapped(bold.text, bold.edit.selection.from, bold.edit.selection.to, 'italic');
  assert.equal(both.text, 'x ***word*** y');
  const noItalic = wrapped(both.text, both.edit.selection.from, both.edit.selection.to, 'italic');
  assert.equal(noItalic.text, 'x **word** y');
  const noBold = wrapped(both.text, both.edit.selection.from, both.edit.selection.to, 'bold');
  assert.equal(noBold.text, 'x *word* y');
});

test('a selection that holds its markers unwraps; one that merely starts and ends with a star does not', () => {
  assert.equal(wrapped('a **bold** b', 2, 10, 'bold').text, 'a bold b');
  // `*a* and *b*` is two emphasised runs, not one: italic wraps the whole selection and breaks neither.
  const alt = wrapped('*a* and *b*', 0, 11, 'italic');
  assert.equal(alt.text, '_*a* and *b*_');
  assert.equal(wrapped(alt.text, alt.edit.selection.from, alt.edit.selection.to, 'italic').text, '*a* and *b*', 'either marker comes off');
});

test('bold over text that holds ** wraps in __, and either takes it off', () => {
  const once = wrapped('**a** and **b**', 0, 15, 'bold');
  assert.equal(once.text, '__**a** and **b**__');
  assert.equal(wrapped(once.text, once.edit.selection.from, once.edit.selection.to, 'bold').text, '**a** and **b**');
  // The caret in a snake_case word is not inside emphasis.
  assert.equal(wrapped('foo_bar_baz', 4, 7, 'italic').text, 'foo_*bar*_baz');
});

test('a word at the caret keeps an in-word apostrophe', () => {
  assert.equal(wrapped("we don't know", 6, 6, 'bold').text, "we **don't** know");
  assert.equal(wrapped('the user’s file', 6, 6, 'bold').text, 'the **user’s** file');
});

test('inside inline code or across its edge a command declines; Code takes the span off', () => {
  const text = 'a `code here` b';
  for (const kind of ['bold', 'italic', 'strike', 'link'] as const) {
    assert.deepEqual(wrapSelection(text, { from: 4, to: 4 }, kind), { declined: 'code' }, `${kind} in code`);
    assert.deepEqual(wrapSelection(text, { from: 0, to: 6 }, kind), { declined: 'code' }, `${kind} across the edge`);
  }
  assert.deepEqual(wrapSelection(text, { from: 0, to: 6 }, 'code'), { declined: 'code' }, 'partly overlapping');
  assert.equal(wrapped(text, 4, 4, 'code').text, 'a code here b');
  assert.equal(wrapped('a ``x ` y`` b', 5, 5, 'code').text, 'a x ` y b');
  assert.deepEqual(wrapSelection(text, { from: 14, to: 15 }, 'bold').hasOwnProperty('edit'), true, 'text after the span is fine');
  assert.equal(wrapped('x `a` and word', 10, 14, 'bold').text, 'x `a` and **word**');
});

test('front matter: no wrap inside it, and a block never lands inside or before it', () => {
  const doc = '---\ntitle: x\n---\n\nbody\n';
  assert.deepEqual(wrapSelection(doc, { from: 4, to: 9 }, 'bold'), { declined: 'code' });
  assert.ok('edit' in wrapSelection(doc, { from: 18, to: 22 }, 'bold'));
  for (const caret of [0, 5, 16]) {
    for (const kind of ['table', 'fence', 'rule', 'details'] as const) {
      const out = insertAtCaret(doc, caret, kind, '\n');
      assert.ok('edit' in out, `${kind} at ${caret}`);
      assert.ok(out.edit.changes[0]!.from === 16, `${kind} at ${caret} goes after the closing line`);
      assert.ok(applyEdit(doc, out.edit).text.startsWith('---\ntitle: x\n---\n\n'), `${kind} keeps the front matter on line 1`);
    }
  }
  assert.deepEqual(insertAtCaret(doc, 5, 'footnote', '\n'), { declined: 'code' });
  assert.equal(applyEdit('---\na: 1\n---\n', (insertAtCaret('---\na: 1\n---\n', 0, 'rule', '\n') as { edit: FormatEdit }).edit).text, '---\na: 1\n---\n\n---\n');
});

test('white space at the edge of a selection stays outside the markers', () => {
  assert.equal(wrapped('x  two  y', 1, 8, 'bold').text, 'x  **two**  y');
});

test('an empty selection with no word puts the pair at the caret, and an empty pair comes out', () => {
  const pair = wrapped('a  b', 2, 2, 'code');
  assert.equal(pair.text, 'a `` b');
  assert.equal(pair.edit.selection.from, 3);
  assert.equal(wrapped(pair.text, 3, 3, 'code').text, 'a  b');
});

test('link wraps with a url to type over, and unwraps from the text, the url or the whole', () => {
  const once = wrapped('see the docs now', 4, 12, 'link');
  assert.equal(once.text, 'see [the docs](url) now');
  assert.equal(once.selected, 'url');
  for (const [from, to] of [[once.edit.selection.from, once.edit.selection.to], [7, 7], [4, 19]] as const) {
    assert.equal(wrapped(once.text, from, to, 'link').text, 'see the docs now', `from ${from}`);
  }
  assert.equal(wrapped('a  b', 2, 2, 'link').text, 'a [](url) b');
});

test('a selection across a fence, or in one, is declined with a reason; nothing is written', () => {
  const text = 'before\n\n```js\nlet x = 1;\n```\n\nafter\n';
  assert.deepEqual(fenceSpans(text), [{ from: 8, to: 28 }]);
  for (const [from, to] of [[2, 12], [15, 17], [24, 33], [8, 8]] as const) {
    assert.deepEqual(wrapSelection(text, { from, to }, 'bold'), { declined: 'code' }, `${from}-${to}`);
  }
  assert.ok('edit' in wrapSelection(text, { from: 0, to: 6 }, 'bold'), 'text outside the fence is fine');
  assert.equal(formatRefusalText({ wrap: 'bold' }, 'code'), "Not formatted · the text is unchanged · it's inside code");
  // An unclosed fence runs to the end; a longer closing fence closes it; a tilde fence is a fence.
  assert.deepEqual(fenceSpans('```\nx'), [{ from: 0, to: 5 }]);
  assert.deepEqual(fenceSpans('~~~\nx\n~~~~\ny'), [{ from: 0, to: 10 }]);
});

test('a selection over a paragraph break or into a list is declined', () => {
  assert.deepEqual(wrapSelection('a\n\nb', { from: 0, to: 4 }, 'bold'), { declined: 'paragraphs' });
  assert.deepEqual(wrapSelection('a\n- b', { from: 0, to: 5 }, 'italic'), { declined: 'paragraphs' });
  assert.ok('edit' in wrapSelection('a\nb', { from: 0, to: 3 }, 'bold'), 'two lines of one paragraph wrap');
});

const INSERTS: readonly InsertKind[] = ['table', 'fence', 'rule', 'details', 'footnote'];

test('every insert in a CRLF file contains only CRLF, and in a CR file only CR', () => {
  const doc = 'Title\nbody text\n\nmore';
  for (const eol of ['\r\n', '\r']) {
    for (const kind of INSERTS) {
      for (const caret of [0, 3, 5, 6, 10, 17, 18, doc.length]) {
        const outcome = insertAtCaret(doc, caret, kind, eol);
        assert.ok('edit' in outcome, `${kind} at ${caret}`);
        for (const c of outcome.edit.changes) {
          const stray = eol === '\r\n' ? /(?<!\r)\n|\r(?!\n)/ : /\n/;
          assert.doesNotMatch(c.insert, stray, `${kind} at ${caret} in ${JSON.stringify(eol)}`);
        }
      }
    }
  }
});

test('an insert is its own block with a blank line each side and moves no other byte', () => {
  const at = (doc: string, caret: number, kind: InsertKind) => {
    const outcome = insertAtCaret(doc, caret, kind, '\n');
    assert.ok('edit' in outcome);
    return applyEdit(doc, outcome.edit);
  };
  // End of a paragraph line: a blank line, the block, and the next paragraph still one blank line away.
  assert.equal(at('para\n\nnext', 4, 'rule').text, 'para\n\n---\n\nnext');
  // Mid-line: the line is cut at the caret and the rest follows the block.
  assert.equal(at('abcdef', 3, 'rule').text, 'abc\n\n---\n\ndef');
  // On a blank line between paragraphs: it fills it.
  assert.equal(at('a\n\nb', 2, 'rule').text, 'a\n\n---\n\nb');
  // At the very start `***`, because `---` there could open front matter.
  assert.equal(at('text', 0, 'rule').text, '***\n\ntext');
  assert.equal(at('', 0, 'fence').text, '```\n\n```');
  assert.equal(at('', 0, 'fence').selected, '', 'the caret is on the empty line of the fence');
  assert.equal(at('x\n\n', 3, 'table').selected, 'Column');
  assert.match(at('x\n\n', 3, 'details').text, /<details>\n<summary>Summary<\/summary>\n\nDetails\n\n<\/details>$/);
  assert.equal(at('x\n\n', 3, 'details').selected, 'Summary');
});

test('a footnote puts the reference at the caret and the definition at the end, numbered after the highest', () => {
  const at = (doc: string, caret: number) => {
    const outcome = insertAtCaret(doc, caret, 'footnote', '\n');
    assert.ok('edit' in outcome);
    return applyEdit(doc, outcome.edit);
  };
  const first = at('A claim.\n', 7);
  assert.equal(first.text, 'A claim[^1].\n\n[^1]: \n');
  assert.equal(first.selected, '');
  assert.equal(at(first.text, 0).text, '[^2]A claim[^1].\n\n[^1]: \n\n[^2]: \n');
  // No final line break stays none; the caret at the very end is the reference followed by its definition.
  assert.equal(at('end', 3).text, 'end[^1]\n\n[^1]: ');
  assert.equal(at('', 0).text, '[^1]\n\n[^1]: ');
});

test('after an insert in a CRLF file the selection is in the editor\'s positions: a break counts one', async () => {
  const bytes = encoder.encode('Title\r\nbody text\r\n\r\nmore\r\n');
  const expect: Record<InsertKind, string> = { table: 'Column', details: 'Summary', fence: '', rule: '', footnote: '' };
  for (const insert of INSERTS) {
    const r = await session(bytes, { insert }, { from: 8, to: 8 });
    const sel = r.state.selection.main;
    const at = r.state.sliceDoc(sel.from, sel.to);
    assert.equal(at, expect[insert], insert);
    if (insert === 'fence') {
      assert.equal(r.state.doc.lineAt(sel.from).text, '', 'the caret is on the fence\'s empty line');
    }
    if (insert === 'footnote') assert.equal(r.state.doc.lineAt(sel.from).text, '[^1]: ', 'the caret is after the definition label');
    if (insert === 'rule') assert.equal(r.state.doc.lineAt(sel.from).text, '---');
  }
});

test('an insert in a fenced block is declined', () => {
  const text = '```\ncode\n```\n';
  for (const kind of INSERTS) assert.deepEqual(insertAtCaret(text, 6, kind, '\n'), { declined: 'code' });
  assert.match(formatRefusalText({ insert: 'table' }, 'code'), /the text is unchanged · it's inside code/);
});

test('only Markdown (and a scratch document) is formatted', () => {
  for (const path of ['/a/b.md', '/a/b.MARKDOWN', '/a/b.mdx', 'untitled', 'untitled:2']) assert.equal(formatsPath(path), true, path);
  for (const path of ['/a/b.rs', '/a/b.txt', '/a/b.json', '/a/README']) assert.equal(formatsPath(path), false, path);
});

/** One editor session over `bytes`: a command, then the file's bytes as the fold would write them. */
async function session(bytes: Uint8Array, op: FormatOp, sel: { from: number; to: number }, path = '/t/a.md') {
  const buffer = createBuffer(path, bytes);
  let state = EditorState.create({
    doc: cmDocText(buffer),
    selection: EditorSelection.single(sel.from, sel.to),
    extensions: [history(), EditorState.lineSeparator.of(lineSeparatorFor(buffer))],
  });
  const said: string[] = [];
  const target = {
    get state() {
      return state;
    },
    dispatch: (tr: import('@codemirror/state').Transaction) => {
      state = tr.state;
    },
  };
  const ran = await runFormat(op, target, path, (n) => said.push(n.text));
  const out = (): Uint8Array => {
    const fold = leaveSourceMode(buffer, state.sliceDoc(0, state.doc.length));
    return fold.changed ? fold.buffer.bytes : bytes;
  };
  return {
    ran,
    said,
    bytes: out(),
    steps: undoDepth(state),
    undo() {
      undo(target as never);
      return out();
    },
    get state() {
      return state;
    },
  };
}

const fileBytes = (lf: string, sep: string, bom = false): Uint8Array => encoder.encode((bom ? '﻿' : '') + lf.replace(/\n/g, sep));

for (const eol of ['lf', 'crlf', 'cr'] as const) {
  for (const bom of [false, true]) {
    test(`a ${eol.toUpperCase()} file${bom ? ' with a BOM' : ''}: bold keeps its line endings, is one undo step, and Mod+Z restores every byte`, async () => {
      const sep = SEP[eol];
      const bytes = fileBytes('alpha beta\ngamma\n', sep, bom);
      const r = await session(bytes, { wrap: 'bold' }, { from: 6, to: 10 });
      assert.equal(r.ran, true);
      assert.equal(decoder.decode(r.bytes), decoder.decode(fileBytes('alpha **beta**\ngamma\n', sep, bom)));
      assert.equal(r.steps, 1);
      assert.deepEqual([...r.undo()], [...bytes]);
    });

    test(`a ${eol.toUpperCase()} file${bom ? ' with a BOM' : ''}: every insert is written in its line ending and one undo step undoes it`, async () => {
      const sep = SEP[eol];
      for (const insert of INSERTS) {
        const bytes = fileBytes('Title\nbody text\n\nmore\n', sep, bom);
        const r = await session(bytes, { insert }, { from: 8, to: 8 });
        assert.equal(r.ran, true, insert);
        const text = decoder.decode(r.bytes);
        const stray = eol === 'crlf' ? /(?<!\r)\n|\r(?!\n)/ : eol === 'cr' ? /\n/ : /\r/;
        assert.doesNotMatch(text, stray, `${insert}: only ${eol} line endings`);
        assert.equal(r.steps, 1, insert);
        assert.deepEqual([...r.undo()], [...bytes], `${insert}: undo restores every byte`);
      }
    });
  }
}

test('a command in a file that is not Markdown does nothing, and a declined one says why and writes nothing', async () => {
  const bytes = encoder.encode('fn main() {}\n');
  const rs = await session(bytes, { wrap: 'bold' }, { from: 3, to: 7 }, '/t/a.rs');
  assert.equal(rs.ran, false);
  assert.deepEqual([...rs.bytes], [...bytes]);
  assert.equal(rs.steps, 0);
  const fenced = encoder.encode('```\ncode\n```\n');
  const declined = await session(fenced, { wrap: 'bold' }, { from: 0, to: 8 });
  assert.equal(declined.ran, false);
  assert.equal(declined.said.length, 1);
  assert.equal(declined.said[0], "Not formatted · the text is unchanged · it's inside code");
  assert.deepEqual([...declined.bytes], [...fenced]);
});

test('a wrap never moves a byte it was not asked to: over every selection of a line, taking the markers out gives the line back', () => {
  const line = 'The quick brown fox, jumps over (the) lazy dog.';
  for (let from = 0; from <= line.length; from++) {
    for (let to = from; to <= line.length; to++) {
      for (const kind of ['bold', 'italic', 'code', 'strike'] as const) {
        const outcome = wrapSelection(line, { from, to }, kind);
        if (!('edit' in outcome)) continue;
        const { text } = applyEdit(line, outcome.edit);
        const stripped = text.replace(/\*\*|\*|`|~~/g, '');
        assert.equal(stripped, line, `${kind} ${from}-${to}`);
      }
    }
  }
});
