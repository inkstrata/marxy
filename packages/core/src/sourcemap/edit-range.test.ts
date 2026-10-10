import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Document, Node } from '../contracts/ast.ts';
import { corpusDocuments } from '../operations/testing/corpus.ts';
import { parseMarkdown } from '../parse/parse.ts';
import { blockEditRange, lineStartAt } from './index.ts';

const enc = new TextEncoder();
const dec = new TextDecoder();

function walk(node: Node, visit: (n: Node) => void): void {
  visit(node);
  for (const child of node.children ?? []) walk(child, visit);
}
function find(doc: Document, pred: (n: Node) => boolean): Node {
  let found: Node | undefined;
  walk(doc, (n) => {
    if (found === undefined && pred(n)) found = n;
  });
  assert.ok(found, 'node not found');
  return found;
}
function show(src: string, doc: Document, node: Node): string | null {
  const range = blockEditRange(doc, node);
  return range === null ? null : dec.decode(enc.encode(src).subarray(range.start, range.end));
}

test('a paragraph in a blockquote carries the `> ` of its first line', () => {
  const src = 'intro\n\n> quoted one\n> still one\n';
  const doc = parseMarkdown(src);
  const p = find(doc, (n) => n.type === 'paragraph' && n.src.start > 7);
  assert.equal(show(src, doc, p), '> quoted one\n> still one');
});

test('a block in a list item carries its container prefix', () => {
  const src = '- one\n- two\n';
  const doc = parseMarkdown(src);
  const items = doc.children[0]!.children!;
  assert.equal(show(src, doc, items[1]!.children![0]!), '- two');
});

test('a heading is the heading alone, not its section', () => {
  const src = '# One\n\nbody\n\n## Two\n\nmore\n';
  const doc = parseMarkdown(src);
  assert.equal(show(src, doc, doc.children[0]!), '# One');
});

test('an inline node means its enclosing block', () => {
  const src = 'a *b* c\n\n- x **y**\n';
  const doc = parseMarkdown(src);
  assert.equal(show(src, doc, find(doc, (n) => n.type === 'emphasis')), 'a *b* c');
  assert.equal(show(src, doc, find(doc, (n) => n.type === 'strong')), '- x **y**');
});

test('a table cell or row means the table', () => {
  const src = 'before\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\nafter\n';
  const doc = parseMarkdown(src);
  const table = '| a | b |\n| - | - |\n| 1 | 2 |';
  assert.equal(show(src, doc, find(doc, (n) => n.type === 'tableCell')), table);
  assert.equal(show(src, doc, find(doc, (n) => n.type === 'tableRow')), table);
  assert.equal(show(src, doc, find(doc, (n) => n.type === 'text' && n.src.start > 20)), table);
});

test('the document and a node from elsewhere have no edit range', () => {
  const doc = parseMarkdown('a\n');
  assert.equal(blockEditRange(doc, doc), null);
  assert.equal(blockEditRange(doc, parseMarkdown('b\n').children[0]!), null);
});

test('every node of every corpus file: a line-start range inside the document', () => {
  const midLine: string[] = [];
  for (const { file, bytes, document } of corpusDocuments()) {
    walk(document, (node) => {
      const range = blockEditRange(document, node);
      if (node.type === 'document') return assert.equal(range, null);
      if (range === null) return assert.fail(`${file}: ${node.type} at ${node.src.start} has no range`);
      assert.ok(range.start >= 0 && range.start <= range.end && range.end <= bytes.length, `${file}: ${node.type} out of bounds`);
      const atLineStart = range.start === 0 || bytes[range.start - 1] === 0x0a || bytes[range.start - 1] === 0x0d || (range.start === 3 && bytes[0] === 0xef);
      assert.ok(atLineStart, `${file}: ${node.type} at ${node.src.start} starts mid-line`);
      assert.equal(range.start, lineStartAt(document, range.start) ?? -1, `${file}: not a registered line start`);
      const end = range.end;
      if (end !== bytes.length && bytes[end] !== 0x0a && bytes[end] !== 0x0d) midLine.push(`${file}:${end}`);
    });
  }
  // Card risk: report (not fail) blocks that end mid-line.
  if (midLine.length > 0) console.log(`blockEditRange: ${midLine.length} node(s) end mid-line, e.g. ${midLine.slice(0, 3).join(', ')}`);
});
