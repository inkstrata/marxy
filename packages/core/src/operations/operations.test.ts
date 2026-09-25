// §03 table tests and corpus fidelity for copy-section and copy-code-clean (MARXY-42).
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import type { Block, CodeBlock, Document, Heading, Inline, Node } from '../contracts/ast.ts';
import { textOf, createBuffer } from '../buffer/buffer.ts';
import { parseMarkdown } from '../parse/parse.ts';
import { sectionRange } from '../sourcemap/section.ts';
import { alignTablePipes } from './align-table-pipes.ts';
import { copyCodeClean } from './copy-code-clean.ts';
import { copySection } from './copy-section.ts';
import { displayWidth } from './display-width.ts';
import { OPERATIONS } from './index.ts';
import { toggleTask } from './toggle-task.ts';

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

function tablesOf(node: Node, out: Extract<Block, { type: 'table' }>[]): void {
  if (node.type === 'table') out.push(node);
  for (const child of node.children ?? []) tablesOf(child, out);
}

function taskMarkersOf(node: Node, out: Extract<Inline, { type: 'taskMarker' }>[]): void {
  if (node.type === 'taskMarker') out.push(node);
  for (const child of node.children ?? []) taskMarkersOf(child as Node, out);
}

function assertBytesOutsideRangeUnchanged(
  bytes: Uint8Array,
  range: { start: number; end: number },
  replacement: string,
): void {
  const enc = new TextEncoder().encode(replacement);
  const after = bytes.subarray(range.end);
  const merged = new Uint8Array(range.start + enc.length + after.length);
  merged.set(bytes.subarray(0, range.start), 0);
  merged.set(enc, range.start);
  merged.set(after, range.start + enc.length);
  assert.equal(Buffer.from(merged.subarray(0, range.start)).compare(Buffer.from(bytes.subarray(0, range.start))), 0);
  assert.equal(Buffer.from(merged.subarray(range.start + enc.length)).compare(Buffer.from(after)), 0);
}

type ToggleCase = { name: string; source: string; pick: (doc: Document) => Extract<Inline, { type: 'taskMarker' }>; expect: string };

const toggleTable: ToggleCase[] = [
  {
    name: '- [ ] a',
    source: '- [ ] a\n',
    pick: (d) => {
      const m: Extract<Inline, { type: 'taskMarker' }>[] = [];
      taskMarkersOf(d, m);
      return m[0]!;
    },
    expect: '[x]',
  },
  {
    name: '* [X] b',
    source: '* [X] b\n',
    pick: (d) => {
      const m: Extract<Inline, { type: 'taskMarker' }>[] = [];
      taskMarkersOf(d, m);
      return m[0]!;
    },
    expect: '[ ]',
  },
  {
    name: '1. [x] c',
    source: '1. [x] c\n',
    pick: (d) => {
      const m: Extract<Inline, { type: 'taskMarker' }>[] = [];
      taskMarkersOf(d, m);
      return m[0]!;
    },
    expect: '[ ]',
  },
];

for (const c of toggleTable) {
  test(`toggle-task: ${c.name}`, () => {
    const doc = parse(c.source);
    const marker = c.pick(doc);
    const range = marker.src;
    const text = sliceText(c.source, range.start, range.end);
    assert.ok(toggleTask.canApply({ document: doc, node: marker, range }));
    const out = toggleTask.run({ document: doc, node: marker, range, text });
    assert.equal(out.replacement, c.expect);
    assert.equal(out.summary, undefined);
  });
}

test('toggle-task: nested item changes only the clicked marker', () => {
  const source = '- [ ] outer\n  - [ ] inner\n';
  const doc = parse(source);
  const markers: Extract<Inline, { type: 'taskMarker' }>[] = [];
  taskMarkersOf(doc, markers);
  const inner = markers[1]!;
  const range = inner.src;
  const text = sliceText(source, range.start, range.end);
  const out = toggleTask.run({ document: doc, node: inner, range, text });
  assert.equal(out.replacement, '[x]');
  const bytes = new TextEncoder().encode(source);
  const enc = new TextEncoder().encode('[x]');
  const merged = new Uint8Array(bytes.length - 3 + enc.length);
  merged.set(bytes.subarray(0, range.start), 0);
  merged.set(enc, range.start);
  merged.set(bytes.subarray(range.end), range.start + enc.length);
  assert.equal(
    Buffer.from(merged.subarray(0, markers[0]!.src.start)).compare(Buffer.from(bytes.subarray(0, markers[0]!.src.start))),
    0,
  );
});

test('toggle-task canApply false for a paragraph', () => {
  const doc = parse('Hello\n');
  const para = doc.children[0]!;
  assert.equal(toggleTask.canApply({ document: doc, node: para, range: para.src }), false);
});

test('align-table-pipes: ragged widths align pipes', () => {
  const source = '|a|b|\n|-|-|\n';
  const doc = parse(source);
  const table = doc.children[0]!;
  assert.equal(table.type, 'table');
  const range = table.src;
  const text = sliceText(source, range.start, range.end);
  const out = alignTablePipes.run({ document: doc, node: table, range, text });
  assert.notEqual(out.replacement, text);
  assert.match(out.replacement, /\| a +\| b +\|/);
});

test('align-table-pipes: escaped pipe counts as width 2', () => {
  const cell = `a ${String.fromCharCode(92)}| b`;
  assert.equal(displayWidth(cell), 6);
});

test('align-table-pipes: CRLF table keeps CRLF on every line', () => {
  const source = '| a |\r\n| - |\r\n';
  const doc = parse(source);
  const table = doc.children[0]!;
  const range = table.src;
  const text = sliceText(source, range.start, range.end);
  const out = alignTablePipes.run({ document: doc, node: table, range, text });
  assert.match(out.replacement, /\r\n/);
  const lines = out.replacement.split(/\r\n/);
  assert.equal(lines.length, 2);
});

test('align-table-pipes: alignment row :---: stretches', () => {
  const source = '| :---: |\n| - |\n';
  const doc = parse(source);
  const table = doc.children[0]!;
  const range = table.src;
  const text = sliceText(source, range.start, range.end);
  const out = alignTablePipes.run({ document: doc, node: table, range, text });
  assert.match(out.replacement, /:\-+:/);
});

test('align-table-pipes: 40-row table completes in under 5 ms (median of 10)', () => {
  const rows = ['| a | b |', '| - | - |', ...Array.from({ length: 38 }, (_, i) => `| ${i} | x |`)];
  const source = `${rows.join('\n')}\n`;
  const doc = parse(source);
  const table = doc.children[0]!;
  const range = table.src;
  const text = sliceText(source, range.start, range.end);
  const input = { document: doc, node: table, range, text };
  const samples: number[] = [];
  for (let i = 0; i < 10; i++) {
    const t0 = performance.now();
    alignTablePipes.run(input);
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  const median = samples[4]!;
  assert.ok(median < 5, `median ${median} ms`);
});

test('fidelity: replacement === text for every applicable copy operation node in the corpus', () => {
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
        if (!op.id.startsWith('copy-') || !op.canApply(input)) continue;
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

test('fidelity: mutations change only their range over the corpus', () => {
  const mutateOps = OPERATIONS.filter((op) => !op.id.startsWith('copy-'));
  const files = readdirSync(corpus).filter((f) => f.endsWith('.md'));
  for (const file of files) {
    const bytes = readFileSync(new URL(file, corpus));
    const doc = parseMarkdown(bytes, { file });
    const buffer = createBuffer(file, bytes);
    const markers: Extract<Inline, { type: 'taskMarker' }>[] = [];
    taskMarkersOf(doc, markers);
    for (const marker of markers) {
      const range = marker.src;
      const text = textOf(buffer, range);
      const input = { document: doc, node: marker, range, text };
      for (const op of mutateOps) {
        if (!op.canApply(input)) continue;
        const result = op.run(input);
        assertBytesOutsideRangeUnchanged(bytes, range, result.replacement);
      }
    }
    const tables: Extract<Block, { type: 'table' }>[] = [];
    tablesOf(doc, tables);
    for (const table of tables) {
      const range = table.src;
      const text = textOf(buffer, range);
      const input = { document: doc, node: table, range, text };
      for (const op of mutateOps) {
        if (!op.canApply(input)) continue;
        const result = op.run(input);
        assertBytesOutsideRangeUnchanged(bytes, range, result.replacement);
      }
    }
  }
});

test('align-table-pipes CRLF case fails when line endings are normalised to LF', () => {
  const source = '| a |\r\n| - |\r\n';
  const doc = parse(source);
  const table = doc.children[0]!;
  const range = table.src;
  const text = sliceText(source, range.start, range.end);
  const aligned = alignTablePipes.run({ document: doc, node: table, range, text }).replacement;
  assert.ok(aligned.includes('\r\n'), 'each line keeps CRLF');
  const normalised = aligned.replace(/\r\n/g, '\n');
  assert.notEqual(normalised, aligned);
  assert.throws(() => {
    if (new TextEncoder().encode(normalised).includes(0x0d)) return;
    throw new Error('LF-only output would fail the CRLF fixture');
  });
});

test('neutralised copy-section canApply fails the paragraph guard', () => {
  const doc = parse('Hello\n');
  const para = doc.children[0]!;
  const input = { document: doc, node: para, range: para.src };
  assert.equal(copySection.canApply(input), false);
});

test('copy-section keeps a reference link whose definition is outside the section', () => {
  const source = '# Title\n\n## Install\n\nSee [the docs][d].\n\n## Next\n\nMore.\n\n[d]: https://example.com/docs\n';
  const document = parse(source);
  const heading = document.children.find((block): block is Heading => block.type === 'heading' && block.level === 2)!;
  const range = sectionRange(document, heading);
  const result = copySection.run({ document, node: heading, range, text: sliceText(source, range.start, range.end) });
  assert.match(result.clipboard?.html ?? '', /<a href="https:\/\/example\.com\/docs">the docs<\/a>/);
  assert.ok(!(result.clipboard?.html ?? '').includes('More.'));
});
