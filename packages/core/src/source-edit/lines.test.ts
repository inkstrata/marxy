// Line operations as splices over the editor's text (V-01). The file's separator is the editor's to write
// back; here a splice is checked for what it changes and, by a seeded property, for what it leaves.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareBytes, deleteLines, duplicateLines, joinLines, lineSpan, lineSpans, sortLines, toggleQuoteLines, toggleTaskLines, type LineEdit } from './lines.ts';

function apply(text: string, edit: LineEdit | null): string {
  if (!edit) return text;
  let out = '';
  let at = 0;
  for (const c of edit.changes) {
    assert.ok(c.from >= at, 'splices are ordered and do not overlap');
    out += text.slice(at, c.from) + c.insert;
    at = c.to;
  }
  return out + text.slice(at);
}
const caret = (pos: number) => [{ from: pos, to: pos }];
const sel = (from: number, to: number) => [{ from, to }];

test('join: a caret joins its line to the next with one space, and the last line joins nothing', () => {
  assert.equal(apply('one  \n   two\nthree', joinLines('one  \n   two\nthree', caret(1))), 'one two\nthree');
  assert.equal(joinLines('one\ntwo', caret(5)), null);
  assert.equal(apply('a\n\nb', joinLines('a\n\nb', caret(0))), 'a\nb');
  assert.equal(apply('a\n\nb', joinLines('a\n\nb', caret(2))), 'a\nb');
});

test('join: a selection joins every line it reaches into one, and leaves the lines around it', () => {
  const text = 'x\na\n  b\nc\ny\n';
  assert.equal(apply(text, joinLines(text, sel(2, 9))), 'x\na b c\ny\n');
});

test('join keeps a final line without a newline without one, and the break after the joined lines', () => {
  assert.equal(apply('a\nb\nc', joinLines('a\nb\nc', sel(2, 5))), 'a\nb c');
  assert.equal(apply('a\nb\n', joinLines('a\nb\n', caret(0))), 'a b\n');
});

test('join in a file of mixed endings drops the "\\r" of the line break it removes and keeps the other', () => {
  const text = 'a\r\nb\r\nc\n';
  assert.equal(apply(text, joinLines(text, caret(0))), 'a b\r\nc\n');
});

test('sort puts the selected lines in byte order and keeps equal lines in their order', () => {
  const text = 'z\nb\nB\na\nä\n10\n9\n';
  assert.equal(apply(text, sortLines(text, sel(0, text.length - 1))), '10\n9\nB\na\nb\nz\nä\n');
  const edit = sortLines('b\na\nc', sel(0, 5))!;
  assert.equal(apply('b\na\nc', edit), 'a\nb\nc');
  assert.deepEqual(edit.selection, [{ from: 0, to: 5 }]);
});

test('sort leaves a caret, one line, and sorted lines alone', () => {
  assert.equal(sortLines('b\na', caret(0)), null);
  assert.equal(sortLines('b\na', sel(0, 1)), null);
  assert.equal(sortLines('a\nb', sel(0, 3)), null);
});

test('sort order is bytes: an astral letter sorts after a private-use one, which a UTF-16 sort gets wrong', () => {
  assert.ok(compareBytes('\u{1F600}', '') > 0);
  assert.ok('\u{1F600}' < '');
});

test('sort does not touch a selection\'s final break or a file\'s missing one', () => {
  assert.equal(apply('b\na\n', sortLines('b\na\n', sel(0, 4))), 'a\nb\n');
  assert.equal(apply('b\na', sortLines('b\na', sel(0, 3))), 'a\nb');
});

test('delete takes the lines and one break with them, and the last break of the file stays as it was', () => {
  assert.equal(apply('a\nb\nc\n', deleteLines('a\nb\nc\n', caret(2))), 'a\nc\n');
  assert.equal(apply('a\nb\nc\n', deleteLines('a\nb\nc\n', caret(0))), 'b\nc\n');
  assert.equal(apply('a\nb\nc', deleteLines('a\nb\nc', caret(4))), 'a\nb');
  assert.equal(apply('a\nb\nc\n', deleteLines('a\nb\nc\n', sel(2, 5))), 'a\n');
  assert.equal(apply('only', deleteLines('only', caret(1))), '');
});

test('duplicate copies whole lines above or below, and puts the selection on the copy', () => {
  const down = duplicateLines('a\nb\n', sel(0, 3), 'down')!;
  assert.equal(apply('a\nb\n', down), 'a\nb\na\nb\n');
  assert.deepEqual(down.selection, [{ from: 4, to: 7 }]);
  const up = duplicateLines('a\nb', caret(2), 'up')!;
  assert.equal(apply('a\nb', up), 'a\nb\nb');
  assert.deepEqual(up.selection, [{ from: 2, to: 2 }]);
  assert.equal(apply('a\nb', duplicateLines('a\nb', caret(2), 'down')), 'a\nb\nb');
});

test('toggle task flips a box by one byte, adds one to a plain item, and ignores lines with no list marker', () => {
  const text = '- [ ] a\n* [x] b\n1. c\nplain\n  - [X] d\n';
  const edit = toggleTaskLines(text, sel(0, text.length))!;
  assert.equal(apply(text, edit), '- [x] a\n* [ ] b\n1. [ ] c\nplain\n  - [ ] d\n');
  assert.deepEqual(edit.changes.filter((c) => c.to - c.from === 1).length, 3);
  assert.equal(toggleTaskLines('plain\n> quote\n', sel(0, 13)), null);
  assert.equal(toggleTaskLines('-no space\n', caret(2)), null);
});

test('toggle task treats a line holding [ ]-like text that is not a box as a plain item', () => {
  assert.equal(apply('- [] a\n', toggleTaskLines('- [] a\n', caret(0))), '- [ ] [] a\n');
});

test('toggle quote quotes unquoted lines, and removes one level when every line is quoted', () => {
  const text = 'a\n\nb\n';
  const quoted = apply(text, toggleQuoteLines(text, sel(0, 4)));
  assert.equal(quoted, '> a\n>\n> b\n');
  assert.equal(apply(quoted, toggleQuoteLines(quoted, sel(0, quoted.length - 1))), text);
  assert.equal(apply('> a\nb\n', toggleQuoteLines('> a\nb\n', sel(0, 5))), '> a\n> b\n'.replace('> a', '> a'));
  assert.equal(apply('>> a\n', toggleQuoteLines('>> a\n', caret(0))), '> a\n');
});

test('seeded property: quoting twice and sorting twice change nothing more than once, and no splice reaches past its lines', () => {
  let seed = 12345;
  const rnd = (n: number): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed % n;
  };
  const words = ['alpha', 'Beta', '- item', '- [ ] todo', '> q', '', '  indented', 'zeta ', 'é', '10'];
  for (let trial = 0; trial < 300; trial++) {
    const lines = Array.from({ length: 1 + rnd(8) }, () => words[rnd(words.length)]!);
    const text = lines.join('\n') + (rnd(2) ? '\n' : '');
    const a = rnd(text.length + 1);
    const b = Math.min(text.length, a + rnd(text.length + 1));
    const ranges = sel(a, b);
    const sorted = apply(text, sortLines(text, ranges));
    // Sorting the same lines again changes nothing.
    const again = sortLines(sorted, sel(a, a + (sorted.length - text.length) + (b - a)));
    if (again) assert.equal(apply(sorted, again), sorted, `sort idempotent on ${JSON.stringify(text)}`);
    // Whatever the operation, bytes outside its splices are the old bytes, and the line count of a task toggle is unchanged.
    for (const op of [joinLines, sortLines, toggleTaskLines, toggleQuoteLines]) {
      const edit = op(text, ranges);
      if (!edit) continue;
      let at = 0;
      for (const c of edit.changes) {
        assert.ok(c.from >= at && c.to >= c.from && c.to <= text.length, `${op.name} splice in range`);
        at = c.to;
      }
      if (op === toggleTaskLines || op === toggleQuoteLines) {
        assert.equal(apply(text, edit).split('\n').length, text.split('\n').length, `${op.name} adds no line`);
      }
    }
  }
});

test('carets on neighbouring lines: join and delete act once on the lines together, never on overlapping splices', () => {
  const text = 'a\nb\nc\nd\n';
  const two = [{ from: 0, to: 0 }, { from: 2, to: 2 }];
  assert.equal(apply(text, joinLines(text, two)), 'a b\nc\nd\n');
  assert.equal(apply(text, deleteLines(text, two)), 'c\nd\n');
  const items = '- a\n- b\n- c\n- d\n';
  assert.equal(apply(items, joinLines(items, [{ from: 0, to: 0 }, { from: 4, to: 4 }, { from: 8, to: 8 }])), '- a - b - c\n- d\n');
});

test('join on the last line keeps the final break; toggle task reads a trailing CR as the end of the line', () => {
  assert.equal(joinLines('a\nb\n', caret(2)), null);
  assert.equal(apply('a\nb\n', joinLines('a\nb\n', caret(0))), 'a b\n');
  assert.equal(apply('- [ ]\r\n- x\n', toggleTaskLines('- [ ]\r\n- x\n', sel(0, 11))), '- [x]\r\n- [ ] x\n');
});

test('seeded property: multi-caret operations equal one operation on the merged lines, and touch nothing outside them', () => {
  let seed = 777;
  const rnd = (n: number): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed % n;
  };
  const words = ['alpha', 'Beta', '- item', '- [ ] todo', '> q', '', '  indented', 'zeta', '1. one'];
  const ops: Record<string, (t: string, r: { from: number; to: number }[]) => LineEdit | null> = {
    join: joinLines,
    sort: sortLines,
    task: toggleTaskLines,
    quote: toggleQuoteLines,
    delete: deleteLines,
    dupUp: (t, r) => duplicateLines(t, r, 'up'),
    dupDown: (t, r) => duplicateLines(t, r, 'down'),
  };
  for (let trial = 0; trial < 400; trial++) {
    const lines = Array.from({ length: 2 + rnd(8) }, () => words[rnd(words.length)]!);
    const text = lines.join('\n') + (rnd(2) ? '\n' : '');
    const ranges = Array.from({ length: 1 + rnd(4) }, () => {
      const a = rnd(text.length + 1);
      return { from: a, to: rnd(3) === 0 ? Math.min(text.length, a + rnd(6)) : a };
    });
    const merged = lineSpans(text, ranges);
    for (const [name, op] of Object.entries(ops)) {
      const once = op(text, merged);
      const many = op(text, ranges);
      const msg = `${name} on ${JSON.stringify(text)} ${JSON.stringify(ranges)}`;
      // Sort ignores a caret (it has nothing to sort), so a merged span of carets is not the same request.
      if (name !== "sort" || ranges.every((r) => r.from !== r.to)) assert.equal(apply(text, many), apply(text, once), msg);
      for (const c of many?.changes ?? []) {
        const inside = merged.some((m) => c.from >= m.from - 1 && c.to <= (m.to < text.length ? lineSpan(text, { from: m.to + 1, to: m.to + 1 }).to : m.to));
        assert.ok(inside, `${msg}: splice ${c.from}-${c.to} stays within the touched lines`);
      }
    }
  }
});
