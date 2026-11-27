// align-table-pipes: byte fidelity outside the aligned cells (never touch an unasked byte).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Node } from '../contracts/ast.ts';
import { parseMarkdown } from '../parse/parse.ts';
import { alignTablePipes } from './align-table-pipes.ts';

const enc = new TextEncoder();
const dec = new TextDecoder();

function align(src: string): string {
  const document = parseMarkdown(src, { file: 't.md' });
  let table: Node | undefined;
  const walk = (n: Node): void => {
    if (n.type === 'table' && !table) table = n;
    for (const c of (n as { children?: readonly Node[] }).children ?? []) walk(c);
  };
  walk(document);
  assert.ok(table, 'a table parsed');
  const range = table.src;
  const text = dec.decode(enc.encode(src).slice(range.start, range.end));
  return alignTablePipes.run({ document, node: table, range, text }).replacement;
}

/** Aligns `text` as a bare table range, for shapes the parser would not hand over as one table. */
function alignRange(text: string): string {
  const document = parseMarkdown(text, { file: 't.md' });
  const node = { type: 'table', children: [] } as unknown as Node;
  return alignTablePipes.run({ document, node, range: { file: 't.md', start: 0, end: text.length }, text }).replacement;
}

test('a lone CR row ending stays CR', () => {
  const out = align('| a | b |\r|---|---|\r| x | y |\r');
  assert.equal(out.includes('\n'), false);
  assert.equal(out, '| a   | b   |\r| --- | --- |\r| x   | y   |');
});

test('cell trimming takes spaces and tabs only, never NBSP, em space or BOM', () => {
  const cell = '\u00a0x\u2003';
  const out = align(`| a | b |\n|---|---|\n|\t${cell} \t| y |\n`);
  assert.ok(out.includes(`| ${cell}`), JSON.stringify(out));
});

test('a lone pipe row is left as it is and the result is stable', () => {
  const once = alignRange('|');
  assert.equal(once, '|');
  assert.equal(alignRange(once), once);
});

test('a table of 130,000 rows aligns, not a RangeError', () => {
  const text = `| a | b |\n|---|---|\n${'| 1 | 2 |\n'.repeat(130_000)}`;
  // The rows are the operation's text; the document is not walked for a bare table node, so a small one serves.
  const node = { type: 'table', children: [] } as unknown as Node;
  const result = alignTablePipes.run({ document: parseMarkdown('x'), node, range: { file: 't.md', start: 0, end: text.length }, text });
  assert.ok(result.replacement.startsWith('| a   | b   |'));
});
