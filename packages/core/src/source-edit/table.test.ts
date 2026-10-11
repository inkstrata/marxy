// Table tools as splices over the editor's text (V-02). Each tool is checked for what it writes, for what it
// leaves (every byte outside the table, the line endings, the container prefix), and, by a seeded property,
// for never writing a table the parse reads differently from what was asked.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseMarkdown } from '../parse/parse.ts';
import { copyTableCsv } from '../operations/copy-table.ts';
import type { Table } from '../contracts/ast.ts';
import type { LineEdit } from './lines.ts';
import { addTableColumn, addTableRow, alignTable, sortTableRows, tableCsv } from './table.ts';

function apply(text: string, edit: LineEdit | null): string {
  if (!edit) return text;
  assert.equal(edit.changes.length, 1, 'one splice');
  const c = edit.changes[0]!;
  return text.slice(0, c.from) + c.insert + text.slice(c.to);
}

const TOOLS = { alignTable, addTableRow, addTableColumn, sortTableRows } as const;
type Tool = keyof typeof TOOLS;
const names = Object.keys(TOOLS) as Tool[];

/** The text with the caret marked `^` removed, and where it was. */
function marked(src: string): { text: string; caret: number } {
  const caret = src.indexOf('^');
  assert.ok(caret >= 0, 'a caret');
  return { text: src.slice(0, caret) + src.slice(caret + 1), caret };
}

function run(tool: Tool, src: string): { out: string; edit: LineEdit | null; text: string } {
  const { text, caret } = marked(src);
  const edit = TOOLS[tool](text, caret);
  return { out: apply(text, edit), edit, text };
}

/** Where the caret lands after `edit`, in the new text, as the text before and after it. */
function after(out: string, edit: LineEdit | null): string {
  const at = edit!.selection![0]!.from;
  return `${out.slice(0, at)}^${out.slice(at)}`;
}

const SIMPLE = '| a | b |\n|---|---|\n| 1 | 2 |\n';

// ---- outside a table ---------------------------------------------------------------------------------------

test('with the caret outside a table, every tool answers null', () => {
  const cases = [
    'plain ^text\n\n| a | b |\n|---|---|\n| 1 | 2 |\n',
    '| a | b |\n|---|---|\n| 1 | 2 |\n\n^after\n',
    '| a | b |\n|---|---|\n| 1 | 2 |\n^\nafter\n',
    '```\n| a | b |\n|---|---|\n^| 1 | 2 |\n```\n',
    '    | a | b |\n    |---|---|\n    ^| 1 | 2 |\n',
    '<!--\n| a | b |\n|---|---|\n^| 1 | 2 |\n-->\n',
    '^',
    'not a table | really\n^---\n',
  ];
  for (const src of cases) {
    const { text, caret } = marked(src);
    for (const tool of names) assert.equal(TOOLS[tool](text, caret), null, `${tool} on ${JSON.stringify(src)}`);
    assert.equal(tableCsv(text, caret), null);
  }
});

test('a text that starts with a byte-order mark is refused, not mis-offset', () => {
  const text = `﻿${SIMPLE}`;
  for (const tool of names) assert.equal(TOOLS[tool](text, 5), null);
});

// ---- align -------------------------------------------------------------------------------------------------

test('align lays the pipes out by display width and keeps each column\'s alignment markers', () => {
  const { out } = run('alignTable', '| 名 | b |\n|:-:|--:|\n| ^1 | 22222 |\n');
  assert.equal(out, '| 名  | b     |\n| :-: | ----: |\n| 1   | 22222 |\n');
  // An emoji is two cells wide, as a CJK character is.
  assert.equal(run('alignTable', '| a | b |\n|---|---|\n| ^😀 | x |\n').out, '| a   | b   |\n| --- | --- |\n| 😀  | x   |\n');
});

test('align on an aligned table is null, and aligning twice is aligning once', () => {
  const once = run('alignTable', '| a | bb |\n|:--|--:|\n| ^1 | 2 |\n').out;
  assert.equal(alignTable(once, 3), null);
  assert.equal(run('alignTable', '|a|b|\n|-|-|\n|^1|2|\n').out, '| a   | b   |\n| --- | --- |\n| 1   | 2   |\n');
});

test('align does not change the alignment row\'s colons, a cell\'s text, or a row with a different number of cells', () => {
  const { out } = run('alignTable', '| a | b | c |\n|:--|:-:|--:|\n| ^1 |\n| x | y | z | extra |\n');
  assert.equal(out, '| a   | b   | c   |\n| :-- | :-: | --: |\n| 1   |\n| x   | y   | z   | extra |\n');
});

test('align keeps the text of a cell with an escaped pipe, a code span, a link', () => {
  const src = '| a \\| b | `x\\|y` | [l](u) |\n|---|---|---|\n| ^1 | 2 | 3 |\n';
  const { out } = run('alignTable', src);
  assert.equal(out, '| a \\| b | `x\\|y` | [l](u) |\n| ------ | ------ | ------ |\n| 1      | 2      | 3      |\n');
});

test('align changes only the table: the text before and after is the same bytes', () => {
  const src = 'before  \r\n\r\n|a|b|\r\n|-|-|\r\n|^1|22|\r\n\r\nafter  ';
  const { text, edit } = run('alignTable', src);
  const e = edit!.changes[0]!;
  assert.ok(e.from >= text.indexOf('|a|'), 'starts inside the table');
  assert.ok(e.to <= text.indexOf('|22|') + 4, 'ends inside the table');
  const out = apply(text, edit);
  assert.equal(out, 'before  \r\n\r\n| a   | b   |\r\n| --- | --- |\r\n| 1   | 22  |\r\n\r\nafter  ');
});

test('the caret stays in the same cell, the same distance into its text', () => {
  const { out, edit } = run('alignTable', '| a | bbb |\n|---|---|\n| 1 | 2^2 |\n');
  assert.equal(after(out, edit), '| a   | bbb |\n| --- | --- |\n| 1   | 2^2  |\n'.replace('2^2  |', '2^2  |'));
});

// ---- add row -----------------------------------------------------------------------------------------------

test('add row puts one empty row below the caret\'s row, and the caret in its first cell', () => {
  const { out, edit } = run('addTableRow', '| a | b |\n|---|---|\n| ^1 | 2 |\n| 3 | 4 |\n');
  assert.equal(out, '| a | b |\n|---|---|\n| 1 | 2 |\n|  |  |\n| 3 | 4 |\n');
  assert.equal(after(out, edit), '| a | b |\n|---|---|\n| 1 | 2 |\n| ^ |  |\n| 3 | 4 |\n');
});

test('add row from the header, the alignment row or the last row', () => {
  assert.equal(run('addTableRow', '| ^a | b |\n|---|---|\n| 1 | 2 |\n').out, '| a | b |\n|---|---|\n|  |  |\n| 1 | 2 |\n');
  assert.equal(run('addTableRow', '| a | b |\n|-^--|---|\n| 1 | 2 |\n').out, '| a | b |\n|---|---|\n|  |  |\n| 1 | 2 |\n');
  assert.equal(run('addTableRow', '| a | b |\n|---|---|\n| 1 | 2^ |\ntext after\n').out, '| a | b |\n|---|---|\n| 1 | 2 |\n|  |  |\ntext after\n');
});

test('add row to an aligned table takes the columns\' widths; to an unaligned one, none', () => {
  assert.equal(
    run('addTableRow', '| name | n |\n| ---- | - |\n| ^x    | 1 |\n'.replace('| - |', '| --- |').replace('| n |', '| n   |').replace('| 1 |', '| 1   |')).out,
    '| name | n   |\n| ---- | --- |\n| x    | 1   |\n|      |     |\n',
  );
  assert.equal(run('addTableRow', '|a|b|\n|-|-|\n|^1|2|\n').out, '|a|b|\n|-|-|\n|1|2|\n|  |  |\n');
});

test('add row on a table with no final newline adds none', () => {
  assert.equal(run('addTableRow', '| a |\n|---|\n| ^1 |').out, '| a |\n|---|\n| 1 |\n|  |');
});

test('add row uses the row ending of the table, in every kind of file', () => {
  assert.equal(run('addTableRow', '| a |\r\n|---|\r\n| ^1 |\r\n').out, '| a |\r\n|---|\r\n| 1 |\r\n|  |\r\n');
  assert.equal(run('addTableRow', '| a |\r|---|\r| ^1 |\r').out, '| a |\r|---|\r| 1 |\r|  |\r');
  // A mixed file: the new row takes the ending of the row it follows, and the others keep theirs.
  assert.equal(run('addTableRow', '| a |\n|---|\r\n| ^1 |\n| 2 |\r\n').out, '| a |\n|---|\r\n| 1 |\n|  |\n| 2 |\r\n');
  assert.equal(run('addTableRow', '| a |\n|---|\r\n| 1 |\r\n| ^2 |').out, '| a |\n|---|\r\n| 1 |\r\n| 2 |\r\n|  |');
});

test('add row inside a block quote and a list item keeps the prefix on the new row', () => {
  assert.equal(run('addTableRow', '> | a | b |\n> |---|---|\n> | ^1 | 2 |\n').out, '> | a | b |\n> |---|---|\n> | 1 | 2 |\n> |  |  |\n');
  assert.equal(run('addTableRow', '- item\n\n  | a | b |\n  |---|---|\n  | ^1 | 2 |\n').out, '- item\n\n  | a | b |\n  |---|---|\n  | 1 | 2 |\n  |  |  |\n');
  // The first row of a table that starts a list item has the marker before it; a new row takes the indent instead.
  assert.equal(run('addTableRow', '- | a | b |\n  |---|---|\n  | ^1 | 2 |\n').out, '- | a | b |\n  |---|---|\n  | 1 | 2 |\n  |  |  |\n');
  assert.equal(run('addTableRow', '- | ^a | b |\n  |---|---|\n  | 1 | 2 |\n').out, '- | a | b |\n  |---|---|\n  |  |  |\n  | 1 | 2 |\n');
  assert.equal(run('addTableRow', '> - > | a |\n>   > |---|\n>   > | ^1 |\n').out, '> - > | a |\n>   > |---|\n>   > | 1 |\n>   > |  |\n');
});

test('add row gives the new row the header\'s number of cells, not the caret row\'s', () => {
  assert.equal(run('addTableRow', '| a | b | c |\n|---|---|---|\n| ^1 |\n').out, '| a | b | c |\n|---|---|---|\n| 1 |\n|  |  |  |\n');
});

// ---- add column --------------------------------------------------------------------------------------------

test('add column puts an empty column after the caret\'s, with --- under it', () => {
  const { out, edit } = run('addTableColumn', '| a | b |\n|:--|--:|\n| ^1 | 2 |\n');
  assert.equal(out, '| a |  | b |\n|:--|---|--:|\n| 1 |  | 2 |\n');
  assert.equal(after(out, edit), '| a |  | b |\n|:--|---|--:|\n| ^1 |  | 2 |\n');
  assert.equal(after(out, edit).replace('^', ''), out);
});

test('add column in an aligned table keeps it aligned', () => {
  const aligned = '| a   | b   |\n| --- | --- |\n| 1^   | 2   |\n';
  const { out } = run('addTableColumn', aligned);
  assert.equal(out, '| a   |     | b   |\n| --- | --- | --- |\n| 1   |     | 2   |\n');
  assert.equal(alignTable(out, 3), null, 'still aligned');
});

test('add column after the last column, and at the caret on a pipe', () => {
  assert.equal(run('addTableColumn', '| a | b |\n|---|---|\n| 1 | ^2 |\n').out, '| a | b |  |\n|---|---|---|\n| 1 | 2 |  |\n');
  // Before a pipe the caret is in the cell to its left; after it, in the cell to its right.
  assert.equal(run('addTableColumn', '| a ^| b |\n|---|---|\n| 1 | 2 |\n').out, '| a |  | b |\n|---|---|---|\n| 1 |  | 2 |\n');
  assert.equal(run('addTableColumn', '| a |^ b |\n|---|---|\n| 1 | 2 |\n').out, '| a | b |  |\n|---|---|---|\n| 1 | 2 |  |\n');
});

test('add column pads only the rows that reach the caret\'s column', () => {
  const { out } = run('addTableColumn', '| a | b | c |\n|---|---|---|\n| 1 |\n| 1 | 2 |\n| 1 | 2 | 3 |\n| x | ^y | z |\n');
  assert.equal(out, '| a | b |  | c |\n|---|---|---|---|\n| 1 |\n| 1 | 2 |  |\n| 1 | 2 |  | 3 |\n| x | y |  | z |\n');
});

test('add column keeps escaped pipes and code spans with an escaped pipe in their cells', () => {
  const { out } = run('addTableColumn', '| a \\| b | `x\\|y` |\n|---|---|\n| ^1 | `p\\|q` |\n');
  assert.equal(out, '| a \\| b |  | `x\\|y` |\n|---|---|---|\n| 1 |  | `p\\|q` |\n');
});

test('add column in a row with no closing pipe after its last cell refuses', () => {
  assert.equal(addTableColumn(...Object.values(marked('a | ^b\n--|--\n1 | 2\n')) as [string, number]), null);
  // Not in the last column, the same table takes one.
  assert.equal(run('addTableColumn', 'a ^| b\n--|--\n1 | 2\n').out, 'a | | b\n--|---|--\n1 | | 2\n');
});

test('add column in a block quote, a list item and CRLF', () => {
  assert.equal(run('addTableColumn', '> | a | b |\n> |---|---|\n> | ^1 | 2 |\n').out, '> | a |  | b |\n> |---|---|---|\n> | 1 |  | 2 |\n');
  assert.equal(run('addTableColumn', '- | a | b |\n  |---|---|\n  | ^1 | 2 |\n').out, '- | a |  | b |\n  |---|---|---|\n  | 1 |  | 2 |\n');
  assert.equal(run('addTableColumn', '| a | b |\r\n|---|---|\r\n| ^1 | 2 |\r\n').out, '| a |  | b |\r\n|---|---|---|\r\n| 1 |  | 2 |\r\n');
});

test('add column from a cell beyond the header\'s columns adds after the last column', () => {
  assert.equal(run('addTableColumn', '| a | b |\n|---|---|\n| 1 | 2 | ^3 |\n').out, '| a | b |  |\n|---|---|---|\n| 1 | 2 |  | 3 |\n');
});

// ---- sort --------------------------------------------------------------------------------------------------

test('sort orders the rows by the caret\'s column in byte order and leaves the header and alignment rows', () => {
  const { out } = run('sortTableRows', '| k | v |\n|:--|--:|\n| b | 1 |\n| B | 2 |\n| é | 3 |\n| ^a | 4 |\n| z | 5 |\n');
  // Uppercase before lowercase, and é (U+00E9, two bytes) after z: the bytes decide, not the locale.
  assert.equal(out, '| k | v |\n|:--|--:|\n| B | 2 |\n| a | 4 |\n| b | 1 |\n| z | 5 |\n| é | 3 |\n');
});

test('sort by another column, and stably', () => {
  const { out } = run('sortTableRows', '| k | v |\n|---|---|\n| a | 2 |\n| b | 1 |\n| c | 2 |\n| d | ^1 |\n');
  assert.equal(out, '| k | v |\n|---|---|\n| b | 1 |\n| d | 1 |\n| a | 2 |\n| c | 2 |\n');
});

test('sort with the caret in the header or the alignment row uses that column', () => {
  assert.equal(run('sortTableRows', '| k | ^v |\n|---|---|\n| a | 2 |\n| b | 1 |\n').out, '| k | v |\n|---|---|\n| b | 1 |\n| a | 2 |\n');
  assert.equal(run('sortTableRows', '| k | v |\n|---|--^-|\n| a | 2 |\n| b | 1 |\n').out, '| k | v |\n|---|---|\n| b | 1 |\n| a | 2 |\n');
});

test('sort is null for a table that is already in order, or has no body rows', () => {
  assert.equal(sortTableRows(...Object.values(marked('| ^k |\n|---|\n| a |\n| b |\n')) as [string, number]), null);
  assert.equal(sortTableRows(...Object.values(marked('| ^k |\n|---|\n')) as [string, number]), null);
});

test('sort moves a row\'s text and nothing else: each line keeps its ending, the last keeps having none', () => {
  assert.equal(run('sortTableRows', '| k |\n|---|\r\n| b |\r\n| ^a |\n| c |').out, '| k |\n|---|\r\n| a |\r\n| b |\n| c |');
  assert.equal(run('sortTableRows', '| k |\n|---|\n| b |\n| ^a |').out, '| k |\n|---|\n| a |\n| b |');
  assert.equal(run('sortTableRows', '| k |\n|---|\n| b |  \n| ^a |').out, '| k |\n|---|\n| a |\n| b |  ');
});

test('sort in a block quote and a list item keeps the prefix on every line', () => {
  assert.equal(run('sortTableRows', '> | k |\n> |---|\n> | b |\n> | ^a |\n').out, '> | k |\n> |---|\n> | a |\n> | b |\n');
  assert.equal(run('sortTableRows', '- | k |\n  |---|\n  | b |\n  | ^a |\n\n  tail\n').out, '- | k |\n  |---|\n  | a |\n  | b |\n\n  tail\n');
});

test('sort keeps escaped pipes and code spans in their cells and sorts on the whole cell', () => {
  const { out } = run('sortTableRows', '| k | v |\n|---|---|\n| b \\| 2 | 1 |\n| ^`a\\|z` | 2 |\n| b | 3 |\n');
  assert.equal(out, '| k | v |\n|---|---|\n| `a\\|z` | 2 |\n| b | 3 |\n| b \\| 2 | 1 |\n');
});

test('the caret follows its row when sort moves it', () => {
  const { out, edit } = run('sortTableRows', '| k |\n|---|\n| b |\n| a^b |\n| a |\n');
  assert.equal(after(out, edit), '| k |\n|---|\n| a |\n| a^b |\n| b |\n');
});

test('sort compares rows with fewer cells as empty, so they come first', () => {
  const { out } = run('sortTableRows', '| a | b |\n|---|---|\n| z | 9 |\n| y |\n| x | ^1 |\n');
  assert.equal(out, '| a | b |\n|---|---|\n| y |\n| x | 1 |\n| z | 9 |\n');
});

// ---- the tools never touch bytes outside the table, in any container --------------------------------------------

test('every tool changes only the table: the bytes before and after it are the same, in every kind of container', () => {
  const containers: [string, string, string][] = [
    ['', '', ''],
    ['> ', '> ', '> '],
    ['- ', '  ', '  '],
    ['1. ', '   ', '   '],
    ['> - ', '>   ', '>   '],
    ['  ', '  ', '  '],
  ];
  for (const [first, rest] of containers.map(([a, b]) => [a, b] as const)) {
    for (const eol of ['\n', '\r\n', '\r']) {
      const rows = ['| k | v |', '|:--|--:|', '| b | 1 |', '| ^a | 2 |'];
      const head = `intro${eol}${eol}`;
      const tail = `${eol}${eol}outro ${eol}`;
      const body = rows.map((r, i) => (i === 0 ? first : rest) + r).join(eol);
      const { text, caret } = marked(head + body + tail);
      const from = text.indexOf('| k');
      const to = text.indexOf('| 2 |', from) + 5;
      for (const tool of names) {
        const edit = TOOLS[tool](text, caret);
        assert.ok(edit, `${tool} in ${JSON.stringify(first)} with ${JSON.stringify(eol)}`);
        const c = edit.changes[0]!;
        assert.ok(c.from >= from && c.to <= to, `${tool}: the splice [${c.from},${c.to}) is inside the table [${from},${to})`);
        const out = apply(text, edit);
        assert.ok(out.startsWith(text.slice(0, from)) && out.endsWith(text.slice(to)), `${tool}: bytes outside are the same`);
        // Every line of the new table still opens with the container's prefix.
        const rowsOut = out.slice(from).split(/\r\n|\r|\n/).slice(1, 4 + (tool === 'addTableRow' ? 1 : 0));
        for (const line of rowsOut) assert.ok(line.startsWith(rest), `${tool}: the prefix ${JSON.stringify(rest)} is on ${JSON.stringify(line)}`);
      }
    }
  }
});

// ---- CSV ---------------------------------------------------------------------------------------------------

test('CSV is what copy-table-csv gives for the same table', () => {
  const src = '| name | note |\n|:--|--:|\n| a,b | "q" |\n| =1+1 | x\\|y |\n| 名 | `c` |\n';
  const { text, caret } = marked(src.replace('| a,b', '| ^a,b'));
  const doc = parseMarkdown(text);
  const table = doc.children.find((n) => n.type === 'table') as Table;
  const op = copyTableCsv.run({ document: doc, node: table, range: table.src, text: '' });
  assert.equal(tableCsv(text, caret), op.clipboard!.text);
  assert.equal(op.clipboard!.text, 'name,note\r\n"a,b","""q"""\r\n\'=1+1,x|y\r\n名,c');
});

test('CSV of a table in a block quote is the same grid', () => {
  assert.equal(tableCsv(...(Object.values(marked('> | a | b |\n> |---|---|\n> | ^1 | 2 |\n')) as [string, number])), 'a,b\r\n1,2');
});

// ---- the property ----------------------------------------------------------------------------------------------

function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CELLS = ['a', 'B', 'z', '1', '22', '', ' ', '名前', '😀', 'é', '`c`', '`x\\|y`', 'p \\| q', '*e*', '[l](u)', '\\\\', '=1', 'x y', '`a|b`', '|', '\\'];
const PREFIXES: readonly (readonly [string, string])[] = [['', ''], ['> ', '> '], ['- ', '  '], ['> - ', '>   '], ['1. ', '   '], ['', '  ']];

test('property: on random tables, every tool either refuses or does what it says, and touches nothing outside the table', () => {
  const rnd = prng(20261011);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
  let edits = 0;
  let refusals = 0;
  for (let trial = 0; trial < 300; trial++) {
    const [first, rest] = pick(PREFIXES);
    const cols = 1 + Math.floor(rnd() * 4);
    const nrows = 1 + Math.floor(rnd() * 5);
    const pipeless = rnd() < 0.1;
    const cell = (): string => pick(CELLS);
    const row = (n: number): string => {
      const body = Array.from({ length: n }, () => ` ${cell()} `).join('|');
      return pipeless ? body.trim() : `|${body}|`;
    };
    const delim = Array.from({ length: cols }, () => pick(['---', ':--', '--:', ':-:', '-'])).join('|');
    const lines = [row(cols), pipeless ? delim : `|${delim}|`];
    for (let i = 0; i < nrows; i++) lines.push(row(rnd() < 0.2 ? Math.max(1, cols - 1 + Math.floor(rnd() * 3)) : cols));
    const eol = pick(['\n', '\r\n', '\r']);
    const mixed = rnd() < 0.2;
    const joined = lines.map((l, i) => (i === 0 ? first : rest) + l).reduce((acc, l, i) => acc + (i === 0 ? '' : mixed ? pick(['\n', '\r\n', '\r']) : eol) + l, '');
    const head = pick(['', 'text\n\n', '# h' + eol + eol]);
    const tail = pick(['', eol, eol + eol + 'tail', eol + 'x']);
    const full = head + joined + tail;
    const text = full;
    const caret = Math.floor(rnd() * (text.length + 1));
    const doc = parseMarkdown(text);
    const before = JSON.stringify(doc.children.filter((n) => n.type === 'table').length);
    for (const tool of names) {
      const edit = TOOLS[tool](text, caret);
      if (edit === null) {
        refusals++;
        continue;
      }
      edits++;
      const c = edit.changes[0]!;
      const out = text.slice(0, c.from) + c.insert + text.slice(c.to);
      const ctx = `${tool} at ${caret} on ${JSON.stringify(text)}`;
      assert.notEqual(out, text, ctx);
      // The splice lies in the table the caret is in, and every byte outside that table is the old byte.
      const bytes = Buffer.from(text);
      const outBytes = Buffer.from(out);
      const tables: Table[] = [];
      const collect = (n: { children?: readonly unknown[]; type?: string }): void => {
        for (const child of (n.children ?? []) as { type: string; children?: readonly unknown[] }[]) {
          if (child.type === 'table') tables.push(child as unknown as Table);
          else collect(child);
        }
      };
      collect(doc as never);
      const inTable = tables.filter((t) => {
        const start = Buffer.byteLength(text.slice(0, c.from));
        const end = Buffer.byteLength(text.slice(0, c.to));
        return t.src.start <= start && end <= t.src.end;
      });
      assert.equal(inTable.length, 1, `${ctx}: the splice is inside exactly one table`);
      const t = inTable[0]!;
      assert.ok(bytes.subarray(0, t.src.start).equals(outBytes.subarray(0, t.src.start)), `${ctx}: bytes before the table`);
      assert.ok(bytes.subarray(t.src.end).equals(outBytes.subarray(outBytes.length - (bytes.length - t.src.end))), `${ctx}: bytes after the table`);
      // The result parses to the same number of tables, and aligning it again is a no-op (idempotent).
      assert.equal(JSON.stringify(parseMarkdown(out).children.filter((n) => n.type === 'table').length), before, ctx);
      const sel = edit.selection![0]!;
      assert.ok(sel.from >= 0 && sel.from <= out.length, `${ctx}: caret in range`);
      // The line endings of the file are exactly the endings it had, plus (add row) one copy of one of them.
      const kinds = (s: string): string => [...(s.match(/\r\n|\r|\n/g) ?? [])].sort().join('');
      if (tool === 'addTableRow') {
        const add = kinds(out).length - kinds(text).length;
        assert.ok(add === 1 || add === 2 || add === 4, `${ctx}: one line ending added (${add})`);
      } else assert.equal(kinds(out), kinds(text), `${ctx}: the same line endings`);
      if (tool === 'alignTable') {
        const again = alignTable(out, sel.from);
        assert.equal(again, null, `${ctx}: aligned is aligned`);
      }
    }
  }
  assert.ok(edits > 250, `the property ran (${edits} edits, ${refusals} refusals)`);
});
