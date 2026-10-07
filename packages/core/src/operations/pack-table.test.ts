// C-08: copy-table-tsv, copy-table-csv and copy-table-json.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Document, Table } from '../contracts/ast.ts';
import { createBuffer, textOf } from '../buffer/buffer.ts';
import { parseMarkdown } from '../parse/parse.ts';
import { copyTableCsv, copyTableJson, copyTableTsv, csvOf, jsonOf, tsvOf } from './copy-table.ts';
import { TABLE_PACK } from './pack-table.ts';
import { cellGrid } from './table-cells.ts';
import { corpusDocuments } from './testing/corpus.ts';

const enc = new TextEncoder();

function tableInput(source: string) {
  const document: Document = parseMarkdown(enc.encode(source), { file: 'c08.md' });
  const node = document.children.find((c) => c.type === 'table')!;
  assert.ok(node, 'the source has a table');
  return { document, node, range: node.src, text: textOf(createBuffer('c08.md', enc.encode(source)), node.src) };
}

const grid = (source: string) => cellGrid(tableInput(source).node as Table);
const tsv = (source: string) => copyTableTsv.run(tableInput(source)).clipboard!;
const csv = (source: string) => copyTableCsv.run(tableInput(source)).clipboard!.text;
const json = (source: string) => copyTableJson.run(tableInput(source)).clipboard!.text;

test('TABLE_PACK lists the three table copies, in order, with their titles', () => {
  assert.deepEqual(TABLE_PACK.map((o) => o.id), ['copy-table-tsv', 'copy-table-csv', 'copy-table-json']);
  assert.deepEqual(TABLE_PACK.map((o) => o.title), ['Copy table as TSV', 'Copy table as CSV', 'Copy table as JSON']);
});

test('escaped pipe arrives as a pipe', () => {
  assert.deepEqual(grid('| a | b |\n|---|---|\n| x \\| y | 2 |\n'), [['a', 'b'], ['x | y', '2']]);
});

test('inline code containing a pipe keeps it', () => {
  assert.deepEqual(grid('| a |\n|---|\n| `x \\| y` |\n'), [['a'], ['x | y']]);
});

test('links, emphasis and <br> are flattened', () => {
  const g = grid('| h |\n|---|\n| [**bold** text](http://e.com) *it* |\n| one<br>two |\n');
  assert.deepEqual(g, [['h'], ['bold text it'], ['one two']]);
});

test('CJK cells', () => {
  assert.equal(tsv('| 名前 | 値 |\n|---|---|\n| 日本語 | 一 |\n').text, '名前\t値\n日本語\t一');
});

test('empty cells stay empty', () => {
  assert.equal(tsv('| a | b |\n|---|---|\n|  | 2 |\n').text, 'a\tb\n\t2');
  assert.equal(csv('| a | b |\n|---|---|\n|  | 2 |\n'), 'a,b\r\n,2');
});

test('ragged rows are padded to the widest row', () => {
  assert.deepEqual(grid('| a | b | c |\n|---|---|---|\n| 1 |\n| 1 | 2 | 3 |\n'), [['a', 'b', 'c'], ['1', '', ''], ['1', '2', '3']]);
});

test('a CRLF table', () => {
  const src = '| a | b |\r\n|---|---|\r\n| 1 | 2 |\r\n';
  assert.equal(tsv(src).text, 'a\tb\n1\t2');
  assert.equal(csv(src), 'a,b\r\n1,2');
});

test('a table in a BOM-prefixed document', () => {
  assert.equal(tsv('﻿# T\n\n| a | b |\n|---|---|\n| 1 | 2 |\n').text, 'a\tb\n1\t2');
});

test('canApply is true on a table, false on a tableCell, a row, a paragraph and a raw span', () => {
  const input = tableInput('| a |\n|---|\n| 1 |\n');
  const table = input.node as Table;
  for (const op of TABLE_PACK) {
    assert.equal(op.canApply(input), true, op.id);
    const row = table.children[1]!;
    assert.equal(op.canApply({ ...input, node: row.children[0]!, range: row.children[0]!.src }), false, `${op.id} cell`);
    assert.equal(op.canApply({ ...input, node: row, range: row.src }), false, `${op.id} row`);
    assert.equal(op.canApply({ document: input.document, range: input.range }), false, `${op.id} span`);
  }
});

test('operations never change the buffer', () => {
  const input = tableInput('| a |\n|---|\n| 1 |\n');
  for (const op of TABLE_PACK) assert.equal(op.run(input).replacement, input.text);
});

test('TSV: a tab or line break inside a cell becomes one space', () => {
  assert.equal(tsvOf([['a\tb', 'c\r\nd'], ['x', 'y']]), 'a b\tc d\nx\ty');
});

test('TSV html: th/td count is rows x columns, no attributes, text escaped', () => {
  const html = tsv('| a & b | &lt;x&gt; |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n').html!;
  assert.equal(html, '<table><thead><tr><th>a &amp; b</th><th>&lt;x&gt;</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr><tr><td>3</td><td>4</td></tr></tbody></table>');
  assert.equal((html.match(/<t[hd]>/g) ?? []).length, 6);
  assert.equal(/<t[a-z]+ /.test(html), false);
});

test('CSV: RFC 4180 quoting', () => {
  assert.equal(csvOf([['a,b', 'say "hi"', 'l1\nl2', 'c\rd', 'plain']]), '"a,b","say ""hi""","l1\nl2","c\rd",plain');
  assert.equal(csvOf([['a'], ['b']]), 'a\r\nb');
});

test('cells that start with = + - @ are copied as they are (no formula guard, by design)', () => {
  const src = '| a | b | c | d |\n|---|---|---|---|\n| =1+1 | +1 | -5 | @x |\n';
  assert.equal(tsv(src).text, 'a\tb\tc\td\n=1+1\t+1\t-5\t@x');
  assert.equal(csv(src), 'a,b,c,d\r\n=1+1,+1,-5,@x');
  assert.deepEqual(JSON.parse(json(src)), [{ a: '=1+1', b: '+1', c: '-5', d: '@x' }]);
});

test('JSON: keyed by header; empty header is "column N", repeats "name (2)", values stay strings', () => {
  const src = '| id |  | id | id |\n|---|---|---|---|\n| 1 | x | 2 | 3 |\n';
  assert.deepEqual(JSON.parse(json(src)), [{ id: '1', 'column 2': 'x', 'id (2)': '2', 'id (3)': '3' }]);
  assert.equal(json(src), JSON.stringify(JSON.parse(json(src)), null, 2));
});

test('JSON: a ragged row adds "column N" keys; a header-only table is an empty array', () => {
  assert.deepEqual(JSON.parse(json('| a | b |\n|---|---|\n| 1 | 2 | 3 |\n')), [{ a: '1', b: '2', 'column 3': '3' }]);
  assert.equal(json('| a |\n|---|\n'), '[]');
});

test('JSON: a header named __proto__ stays a key', () => {
  assert.equal(jsonOf([['__proto__'], ['x']]).includes('"__proto__": "x"'), true);
});

// A 20-line RFC 4180 reader, enough to read back what csvOf writes.
function readCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\r' && text[i + 1] === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; }
    else field += ch;
  }
  row.push(field);
  rows.push(row);
  return rows;
}

test('round trip over every corpus table: TSV, CSV and JSON read back to cellGrid', () => {
  let tables = 0;
  for (const { file, document } of corpusDocuments()) {
    const visit = (nodes: readonly { type: string }[]) => {
      for (const n of nodes) {
        const node = n as { type: string; children?: readonly { type: string }[] };
        if (node.type === 'table') {
          tables++;
          const t = node as unknown as Table;
          const g = cellGrid(t);
          const input = { document, node: t, range: t.src, text: '' };
          const out = copyTableTsv.run(input).clipboard!;
          assert.deepEqual(out.text.split('\n').map((l) => l.split('\t')), g.map((r) => r.map((c) => c.replace(/[\t\r\n]+/g, ' '))), `${file} tsv`);
          assert.deepEqual(readCsv(copyTableCsv.run(input).clipboard!.text), g, `${file} csv`);
          const parsed = JSON.parse(copyTableJson.run(input).clipboard!.text) as Record<string, string>[];
          assert.equal(parsed.length, g.length - 1, `${file} json rows`);
          const keys = Object.keys(parsed[0] ?? {});
          parsed.forEach((o, r) => assert.deepEqual(Object.values(o), g[r + 1], `${file} json row ${r}`));
          if (parsed.length > 0) assert.equal(keys.length, g[0]!.length, `${file} json keys`);
          const cells = (out.html!.match(/<t[hd]>/g) ?? []).length;
          assert.equal(cells, g.length * (g[0]?.length ?? 0), `${file} html cells`);
        }
        if (node.children) visit(node.children);
      }
    };
    visit(document.children);
  }
  assert.ok(tables >= 20, `expected the corpus tables, saw ${tables}`);
});
