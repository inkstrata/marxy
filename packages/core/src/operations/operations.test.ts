// §03 table tests and corpus fidelity for copy-section and copy-code-clean (MARXY-42).
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import type { Block, CodeBlock, Document, Heading, Node } from '../contracts/ast.ts';
import { textOf, createBuffer } from '../buffer/buffer.ts';
import { parseMarkdown } from '../parse/parse.ts';
import { sectionRange } from '../sourcemap/section.ts';
import { copyCodeClean } from './copy-code-clean.ts';
import { copySection } from './copy-section.ts';
import { OPERATIONS } from './index.ts';

function parse(source: string, file = 'test.md'): Document {
  return parseMarkdown(source, { file });
}

function sliceText(source: string, start: number, end: number): string {
  return new TextDecoder().decode(new TextEncoder().encode(source).slice(start, end));
}

type SectionCase = {
  name: string;
  source: string;
  pick: (doc: Document) => Heading;
  expectIncludes?: string[];
  expectEnds?: string;
};

const sectionTable: SectionCase[] = [
  {
    name: 'h2 followed by h3, h3, h2',
    source: '## A\n\n### B\n\n### C\n\n## D\n\nTail\n',
    pick: (d) => d.children[0] as Heading,
    expectIncludes: ['### B', '### C'],
  },
  {
    name: 'last section of the file',
    source: '## Only\n\nBody\n',
    pick: (d) => d.children[0] as Heading,
  },
  {
    name: 'h1 with nested h2s',
    source: '# Title\n\n## Inner\n\nPara\n',
    pick: (d) => d.children[0] as Heading,
    expectIncludes: ['## Inner', 'Para'],
  },
  {
    name: 'heading with trailing ## closers',
    source: '## Close me ##\n\nBody\n',
    pick: (d) => d.children[0] as Heading,
    expectIncludes: ['Close me ##'],
  },
];

for (const c of sectionTable) {
  test(`copy-section: ${c.name}`, () => {
    const doc = parse(c.source);
    const heading = c.pick(doc);
    const range = sectionRange(doc, heading);
    const text = sliceText(c.source, range.start, range.end);
    assert.ok(copySection.canApply({ document: doc, node: heading, range }));
    const out = copySection.run({ document: doc, node: heading, range, text });
    assert.equal(out.replacement, text);
    assert.equal(out.clipboard?.text, text.replace(/\s+$/, '') + '\n');
    assert.ok(out.clipboard?.html && out.clipboard.html.length > 0);
    for (const part of c.expectIncludes ?? []) assert.ok(out.clipboard!.text.includes(part));
    if (c.name === 'last section of the file') {
      assert.equal(range.end, doc.src.end);
      assert.match(out.clipboard!.text, /\n$/);
    }
  });
}

type CodeCase = {
  name: string;
  source: string;
  pick: (doc: Document) => CodeBlock;
  expectText: string;
};

const codeTable: CodeCase[] = [
  {
    name: 'fenced ```ts with info string',
    source: '```ts title\nline one\n```\n',
    pick: (d) => d.children[0] as CodeBlock,
    expectText: 'line one\n',
  },
  {
    name: 'indented code block',
    source: '    indented\n    second\n',
    pick: (d) => d.children[0] as CodeBlock,
    expectText: 'indented\nsecond\n',
  },
  {
    name: 'unclosed fence at EOF',
    source: '```\nstill open\n',
    pick: (d) => d.children[0] as CodeBlock,
    expectText: 'still open\n',
  },
  {
    name: 'empty block',
    source: '```\n```\n',
    pick: (d) => d.children[0] as CodeBlock,
    expectText: '',
  },
];

for (const c of codeTable) {
  test(`copy-code-clean: ${c.name}`, () => {
    const doc = parse(c.source);
    const block = c.pick(doc);
    const range = block.src;
    const text = sliceText(c.source, range.start, range.end);
    assert.ok(copyCodeClean.canApply({ document: doc, node: block, range }));
    const out = copyCodeClean.run({ document: doc, node: block, range, text });
    assert.equal(out.replacement, text);
    assert.equal(out.clipboard?.text, c.expectText);
    assert.equal(out.clipboard?.html, undefined);
  });
}

test('copy-section: whole document', () => {
  const source = '# Doc\n\nPara\n';
  const doc = parse(source);
  const range = doc.src;
  const text = sliceText(source, range.start, range.end);
  assert.ok(copySection.canApply({ document: doc, range }));
  const out = copySection.run({ document: doc, range, text });
  assert.equal(out.replacement, text);
  assert.equal(out.clipboard?.text, source.replace(/\s+$/, '') + '\n');
});

test('copy-section canApply false for a paragraph node', () => {
  const doc = parse('Hello\n');
  const para = doc.children[0]!;
  assert.equal(copySection.canApply({ document: doc, node: para, range: para.src }), false);
});

test('copy-code-clean canApply false for a paragraph', () => {
  const doc = parse('Hello\n');
  const para = doc.children[0]!;
  assert.equal(copyCodeClean.canApply({ document: doc, node: para, range: para.src }), false);
});

const corpus = new URL('../../../../fixtures/corpus/', import.meta.url);

function walkBlocks(node: Node, out: Block[]): void {
  if (node.type !== 'document' && node.type !== 'paragraph' && node.type !== 'listItem') {
    if (
      node.type === 'heading' ||
      node.type === 'codeBlock' ||
      node.type === 'blockquote' ||
      node.type === 'list' ||
      node.type === 'table'
    ) {
      out.push(node as Block);
    }
  }
  for (const child of node.children ?? []) walkBlocks(child, out);
}

function headingsOf(node: Node, out: Heading[]): void {
  if (node.type === 'heading') out.push(node);
  for (const child of node.children ?? []) headingsOf(child, out);
}

test('fidelity: replacement === text for every applicable operation node in the corpus', () => {
  const files = readdirSync(corpus).filter((f) => f.endsWith('.md'));
  for (const file of files) {
    const bytes = readFileSync(new URL(file, corpus));
    const doc = parseMarkdown(bytes, { file });
    const buffer = createBuffer(file, bytes);
    const headings: Heading[] = [];
    headingsOf(doc, headings);
    for (const heading of headings) {
      const range = sectionRange(doc, heading);
      const text = textOf(buffer, range);
      const input = { document: doc, node: heading, range, text };
      for (const op of OPERATIONS) {
        if (!op.canApply(input)) continue;
        const result = op.run(input);
        assert.equal(result.replacement, text, `${file} ${op.id} @ heading L${heading.level}`);
      }
    }
    const docRange = doc.src;
    const docText = textOf(buffer, docRange);
    const docInput = { document: doc, range: docRange, text: docText };
    if (copySection.canApply(docInput)) {
      assert.equal(copySection.run(docInput).replacement, docText, `${file} copy-section document`);
    }
    const blocks: Block[] = [];
    walkBlocks(doc, blocks);
    for (const block of blocks) {
      if (block.type !== 'codeBlock') continue;
      const range = block.src;
      const text = textOf(buffer, range);
      const input = { document: doc, node: block, range, text };
      if (copyCodeClean.canApply(input)) {
        assert.equal(copyCodeClean.run(input).replacement, text, `${file} copy-code-clean`);
      }
    }
  }
});

test('neutralised copy-section canApply fails the paragraph guard', () => {
  const doc = parse('Hello\n');
  const para = doc.children[0]!;
  const input = { document: doc, node: para, range: para.src };
  assert.equal(copySection.canApply(input), false);
});
