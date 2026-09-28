// sectionRange table cases and a corpus property over every heading (MARXY-41, docs/design/03-selection-and-operations.md).

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import type { Document, Heading, Node } from '../contracts/ast.ts';
import { parseMarkdown } from '../parse/parse.ts';
import { nodeAt, sectionRange } from './section.ts';

function parse(source: string, file = 'test.md'): Document {
  return parseMarkdown(source, { file });
}

function headingsOf(node: Node): Heading[] {
  const found: Heading[] = node.type === 'heading' ? [node] : [];
  for (const child of node.children ?? []) found.push(...headingsOf(child));
  return found;
}

const corpus = new URL('../../../../fixtures/corpus/', import.meta.url);

type TableCase = {
  name: string;
  source: string;
  pick: (doc: Document) => Heading;
  expectIncludes?: string[];
  expectExcludes?: string[];
};

function isTopLevelHeading(doc: Document, heading: Heading): boolean {
  return doc.children.some(
    (block) =>
      block.type === 'heading' &&
      block.src.start === heading.src.start &&
      block.src.end === heading.src.end,
  );
}

function topLevelEnclosingBlock(doc: Document, heading: Heading) {
  for (const block of doc.children) {
    if (heading.src.start >= block.src.start && heading.src.end <= block.src.end) return block;
  }
  return heading;
}

const BLOCK_TYPES = new Set([
  'heading',
  'paragraph',
  'blockquote',
  'list',
  'listItem',
  'codeBlock',
  'htmlBlock',
  'thematicBreak',
  'table',
  'tableRow',
  'tableCell',
  'mathBlock',
  'footnoteDefinition',
  'frontmatter',
]);

function expectedSectionEnd(doc: Document, heading: Heading): number {
  if (isTopLevelHeading(doc, heading)) {
    let end = doc.src.end;
    for (const block of doc.children) {
      if (block.src.start <= heading.src.start) continue;
      if (block.type === 'heading' && block.level <= heading.level) {
        end = block.src.start;
        break;
      }
    }
    return end;
  }
  const scope = topLevelEnclosingBlock(doc, heading);
  let end = scope.src.end;
  const walk = (node: Node): boolean => {
    if (BLOCK_TYPES.has(node.type)) {
      const block = node as import('../contracts/ast.ts').Block;
      if (block.src.start > heading.src.start && block.type === 'heading' && block.level <= heading.level) {
        end = block.src.start;
        return true;
      }
      for (const child of block.children ?? []) {
        if (walk(child)) return true;
      }
      return false;
    }
    for (const child of node.children ?? []) {
      if (walk(child)) return true;
    }
    return false;
  };
  walk(scope);
  return end;
}

const table: TableCase[] = [
  {
    name: 'h2 followed by h3, h3, h2 ends at the second h2',
    source: '## A\n\n### B\n\n### C\n\n## D\n\nTail\n',
    pick: (d) => d.children[0] as Heading,
    expectIncludes: ['### B', '### C'],
  },
  {
    name: 'last section ends at doc.src.end',
    source: '## Only\n\nBody\n',
    pick: (d) => d.children[0] as Heading,
  },
  {
    name: 'h1 with nested h2s includes them all',
    source: '# Title\n\n## Inner\n\nPara\n',
    pick: (d) => d.children[0] as Heading,
    expectIncludes: ['## Inner', 'Para'],
  },
  {
    name: 'setext h2 section',
    source: 'Title\n-----\n\nBody\n\nNext\n=====\n',
    pick: (d) => d.children[0] as Heading,
    expectIncludes: ['Body'],
  },
  {
    name: 'heading inside blockquote stays inside the blockquote',
    source: '> ## In quote\n>\n> text\n\n## Top\n',
    pick: (d) => {
      const bq = d.children[0];
      assert.equal(bq.type, 'blockquote');
      return (bq.children ?? []).find((c) => c.type === 'heading') as Heading;
    },
    expectIncludes: ['text'],
    expectExcludes: ['## Top'],
  },
  {
    name: 'heading inside blockquote does not swallow content after the blockquote',
    source: '> ## Inner\n> body\n\nParagraph after blockquote.\n\n## Outer\nmore\n',
    pick: (d) => {
      const bq = d.children[0];
      assert.equal(bq.type, 'blockquote');
      return (bq.children ?? []).find((c) => c.type === 'heading') as Heading;
    },
    expectIncludes: ['body'],
    expectExcludes: ['Paragraph after blockquote', '## Outer'],
  },
  {
    name: 'heading inside a list stays inside the list',
    source: '- ## In list\n  item body\n\nAfter list.\n\n## Outer\n',
    pick: (d) => {
      const list = d.children[0];
      assert.equal(list.type, 'list');
      const item = list.children[0];
      return (item.children ?? []).find((c) => c.type === 'heading') as Heading;
    },
    expectIncludes: ['item body'],
    expectExcludes: ['After list', '## Outer'],
  },
];

for (const c of table) {
  test(`sectionRange: ${c.name}`, () => {
    const doc = parse(c.source);
    const heading = c.pick(doc);
    const range = sectionRange(doc, heading);
    assert.equal(range.start, heading.src.start);
    assert.equal(range.end, expectedSectionEnd(doc, heading));
    const text = new TextDecoder().decode(
      new TextEncoder().encode(c.source).slice(range.start, range.end),
    );
    for (const fragment of c.expectIncludes ?? []) assert.match(text, new RegExp(fragment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    for (const fragment of c.expectExcludes ?? []) assert.doesNotMatch(text, new RegExp(fragment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    for (const h of headingsOf(doc)) {
      if (h.src.start <= range.start || h.src.start >= range.end) continue;
      assert.ok(h.level > heading.level, `${c.name}: inner heading h${h.level} should outrank h${heading.level}`);
    }
  });
}

test('nodeAt returns the innermost block at a byte', () => {
  const doc = parse('- item one\n- item two\n');
  const list = doc.children[0];
  assert.equal(list.type, 'list');
  const item = list.children[0];
  const para = item.children?.[0];
  assert.equal(para?.type, 'paragraph');
  const inner = nodeAt(doc, para!.src.start + 1);
  assert.equal(inner?.type, 'paragraph');
});

test('sectionRange corpus property over every heading', () => {
  for (const name of readdirSync(corpus).filter((f) => f.endsWith('.md'))) {
    const bytes = readFileSync(new URL(name, corpus));
    const doc = parseMarkdown(bytes, { file: name });
    for (const heading of headingsOf(doc)) {
      const range = sectionRange(doc, heading);
      assert.equal(range.start, heading.src.start, `${name}: section must start at the heading`);
      for (const inner of headingsOf(doc)) {
        if (inner.src.start <= range.start || inner.src.start >= range.end) continue;
        assert.ok(
          inner.level > heading.level,
          `${name}: heading at ${inner.src.start} inside section of h${heading.level} must be deeper`,
        );
      }
    }
  }
});
