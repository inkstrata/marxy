// C-07: copy-source, copy-plain and copy-rich — table cases and corpus properties.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Document, Heading, List, Node, Paragraph } from '../contracts/ast.ts';
import { createBuffer, textOf } from '../buffer/buffer.ts';
import { parseMarkdown } from '../parse/parse.ts';
import { sectionRange } from '../sourcemap/section.ts';
import { copyPlain } from './copy-plain.ts';
import { copyRich } from './copy-rich.ts';
import { copySource } from './copy-source.ts';
import { inlinePlainText } from './inline-text.ts';
import { plainTextOf } from './plain-text.ts';
import { COPY_PACK } from './pack-copy.ts';
import { corpusDocuments } from './testing/corpus.ts';

const enc = new TextEncoder();

function parse(source: string): Document {
  return parseMarkdown(enc.encode(source), { file: 'c07.md' });
}

/** The input an operation gets for the whole document. */
function wholeDocument(source: string) {
  const document = parse(source);
  return { document, range: document.src, text: textOf(createBuffer('c07.md', enc.encode(source)), document.src) };
}

function blockInput(source: string, index = 0) {
  const document = parse(source);
  const node = document.children[index]!;
  return { document, node, range: node.src, text: textOf(createBuffer('c07.md', enc.encode(source)), node.src) };
}

const IDS = (op: { id: string }) => op.id;

test('COPY_PACK lists copy-source, copy-plain and copy-rich, in that order', () => {
  assert.deepEqual(COPY_PACK.map(IDS), ['copy-source', 'copy-plain', 'copy-rich']);
  assert.deepEqual(COPY_PACK.map((op) => op.title), ['Copy as markdown', 'Copy as plain text', 'Copy as rich text']);
});

type Case = { name: string; source: string; plain: string; sourceText?: string };

const cases: Case[] = [
  { name: 'LF paragraph', source: '# Title\n\nHello *there*.\n', plain: 'Title\n\nHello there.' },
  { name: 'CRLF document', source: '# Title\r\n\r\nHello **there**.\r\n', plain: 'Title\n\nHello there.' },
  { name: 'no trailing newline', source: 'One\n\nTwo', plain: 'One\n\nTwo' },
  { name: 'BOM-prefixed document', source: '﻿# Title\n\nBody\n', plain: 'Title\n\nBody' },
  { name: 'CJK', source: '# 見出し\n\n日本語の**文章**です。\n', plain: '見出し\n\n日本語の文章です。' },
  { name: 'nested list', source: '- a\n  - b\n    - c\n- d\n', plain: '- a\n  - b\n    - c\n- d' },
  { name: 'ordered list from 3', source: '3. a\n4. b\n', plain: '3. a\n4. b' },
  { name: 'task list', source: '- [x] done\n- [ ] todo\n', plain: '- [x] done\n- [ ] todo' },
  { name: 'table', source: '| a | b |\n|---|---|\n| 1 | **2** |\n', plain: 'a\tb\n1\t2' },
  { name: 'fenced block', source: '```js\nlet a = 1;\n*b*\n```\n', plain: 'let a = 1;\n*b*' },
  { name: 'blockquote', source: '> quoted *text*\n>\n> more\n', plain: 'quoted text\n\nmore' },
  { name: 'front matter and HTML dropped', source: '---\ntitle: x\n---\n\n<div>raw</div>\n\nBody\n', plain: 'Body' },
];

for (const c of cases) {
  test(`pack-copy: ${c.name}`, () => {
    const input = wholeDocument(c.source);
    assert.ok(copySource.canApply(input) && copyPlain.canApply(input) && copyRich.canApply(input));

    const src = copySource.run(input);
    assert.equal(src.clipboard?.text, input.text);
    assert.equal(src.clipboard?.html, undefined);
    assert.equal(src.replacement, input.text);

    const plain = copyPlain.run(input);
    assert.equal(plain.clipboard?.text, c.plain);
    assert.equal(plain.clipboard?.html, undefined);
    assert.equal(plain.replacement, input.text);

    const rich = copyRich.run(input);
    assert.equal(rich.clipboard?.text, c.plain);
    assert.ok(rich.clipboard?.html && rich.clipboard.html.length > 0);
    assert.equal(rich.replacement, input.text);
  });
}

test('copy-source on a block keeps CRLF and the missing final newline', () => {
  const input = blockInput('first\r\n\r\nlast para', 1);
  assert.equal(copySource.run(input).clipboard?.text, 'last para');
  const crlf = blockInput('- a\r\n- b\r\n', 0);
  assert.equal(copySource.run(crlf).clipboard?.text, crlf.text);
  assert.match(copySource.run(crlf).clipboard!.text, /\r\n/);
});

test('copy-plain and copy-rich on a heading section cover its blocks and nothing after', () => {
  const source = '# A\n\nin A\n\n## B\n\nin B\n\n# C\n\nin C\n';
  const document = parse(source);
  const heading = document.children[0] as Heading;
  const range = sectionRange(document, heading);
  const text = textOf(createBuffer('c07.md', enc.encode(source)), range);
  const input = { document, node: heading, range, text };
  assert.equal(copyPlain.run(input).clipboard?.text, 'A\n\nin A\n\nB\n\nin B');
  assert.equal(copySource.run(input).clipboard?.text, text);
  assert.ok(!copyRich.run(input).clipboard!.html!.includes('in C'));
});

test('copy-plain on a single block copies that block only', () => {
  const input = blockInput('- [ ] x\n- y\n\nafter\n', 0);
  assert.equal(copyPlain.run(input).clipboard?.text, '- [ ] x\n- y');
});

test('canApply is false for an inline node and for a partial span', () => {
  const document = parse('Some *emphasis* here.\n');
  const para = document.children[0] as Paragraph;
  const inline = para.children.find((n) => n.type === 'emphasis')!;
  for (const op of COPY_PACK) {
    assert.equal(op.canApply({ document, node: inline, range: inline.src }), false, `${op.id} inline`);
    assert.equal(op.canApply({ document, range: { ...document.src, start: 2, end: 6 } }), false, `${op.id} span`);
    assert.equal(op.canApply({ document, node: para, range: para.src }), true, `${op.id} block`);
  }
});

function allNodes(root: Node, out: Node[] = []): Node[] {
  out.push(root);
  for (const child of root.children ?? []) allNodes(child, out);
  return out;
}

test('copy-source returns textOf(buffer, node.src) byte-for-byte for every block in the corpus', () => {
  let checked = 0;
  for (const { file, bytes, document } of corpusDocuments()) {
    const buffer = createBuffer(file, bytes);
    for (const node of allNodes(document)) {
      if (node.type === 'document') continue;
      const input = { document, node, range: node.src, text: textOf(buffer, node.src) };
      if (!copySource.canApply(input)) continue;
      assert.equal(copySource.run(input).clipboard?.text, input.text, `${file} @ ${node.src.start}`);
      checked++;
    }
    const whole = { document, range: document.src, text: textOf(buffer, document.src) };
    assert.equal(copySource.run(whole).clipboard?.text, whole.text, `${file} document`);
  }
  assert.ok(checked > 100);
});

test('copy-plain of every corpus paragraph equals inlinePlainText of the paragraph', () => {
  let checked = 0;
  for (const { file, bytes, document } of corpusDocuments()) {
    const buffer = createBuffer(file, bytes);
    for (const node of allNodes(document)) {
      if (node.type !== 'paragraph') continue;
      const input = { document, node, range: node.src, text: textOf(buffer, node.src) };
      assert.equal(copyPlain.run(input).clipboard?.text, inlinePlainText(node.children), `${file} @ ${node.src.start}`);
      checked++;
    }
  }
  assert.ok(checked > 50);
});

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", '#x27': "'" };

function htmlText(html: string): string {
  return html
    .replace(/<img\b[^>]*?\balt="([^"]*)"[^>]*>/gi, '$1') // an image's text is its alt
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, name: string) => {
      if (name[0] === '#') return String.fromCodePoint(name[1]!.toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10));
      return ENTITIES[name] ?? m;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

/** The renderer's typographic substitutions (dashes, ellipsis) and a footnote mark's caret are not the words. */
function asWords(text: string): string {
  return text
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/---|\u2014/g, '\u2014')
    .replace(/--|\u2013/g, '\u2013')
    .replace(/\.\.\.|\u2026/g, '\u2026')
    .replace(/\[\^([^\]]+)\]/g, '[$1]');
}

/**
 * The structure the HTML carries as elements, not text: list markers and task boxes. Stripped per
 * item, from the start of the item's own first line only, so a continuation line is never trimmed.
 */
function withoutStructureMarks(list: List): string {
  const lines: string[] = [];
  const walk = (l: List): void => {
    for (const item of l.children) {
      const own = plainTextOf(item.children.filter((c) => c.type !== 'list'));
      lines.push(own);
      for (const c of item.children) if (c.type === 'list') walk(c);
    }
  };
  walk(list);
  return lines.join(' ');
}

test('copy-rich HTML has no data-marxy- attribute in a tag, and its text equals copy-plain for every top-level corpus block', () => {
  let checked = 0;
  for (const { file, bytes, document } of corpusDocuments()) {
    const buffer = createBuffer(file, bytes);
    for (const node of document.children) {
      const input = { document, node, range: node.src, text: textOf(buffer, node.src) };
      const { clipboard } = copyRich.run(input);
      const html = clipboard!.html!;
      assert.ok(!/<[^>]*data-marxy-/i.test(html), `${file} @ ${node.src.start}: provenance in a tag`);
      const plain = clipboard!.text;
      assert.equal(plain, copyPlain.run(input).clipboard?.text);
      // Elements the HTML draws instead of spelling (images, footnote marks, list markers) are
      // compared by what they have in common: the words.
      const words = (s: string) => s.replace(/\s+/g, ' ').trim();
      const marks = node.type === 'list' ? withoutStructureMarks(node) : plain;
      // Raw HTML is the sanitiser's to strip (scripts, svg), so a block holding any is not compared.
      // A mermaid block is drawn with a caption of the renderer's own.
      const captioned = node.type === 'codeBlock' && node.lang === 'mermaid';
      const hasRawHtml = captioned || allNodes(node).some((n) => n.type === 'html' || n.type === 'htmlBlock');
      if (!hasRawHtml && (node.type === 'paragraph' || node.type === 'heading' || node.type === 'list' || node.type === 'codeBlock' || node.type === 'table')) {
        assert.equal(asWords(htmlText(html)), asWords(words(marks)), `${file} @ ${node.src.start} (${node.type})`);
      }
      checked++;
    }
  }
  assert.ok(checked > 100);
});

test('copy-plain keeps words apart across an inline <br> (paragraph: newline; table cell: space)', () => {
  for (const br of ['<br>', '<BR/>', '<br />']) {
    const para = wholeDocument(`y${br}z\n`);
    assert.equal(copyPlain.run(para).clipboard?.text, 'y\nz', br);
    const table = wholeDocument(`| a |\n|---|\n| y${br}z |\n`);
    assert.equal(copyPlain.run(table).clipboard?.text, 'a\ny z', br);
  }
});
