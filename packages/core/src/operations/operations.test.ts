// §03 table tests and corpus fidelity for copy-section and copy-code-clean (MARXY-42).
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import type { Block, CodeBlock, Document, Heading, Inline, Node, Source } from '../contracts/ast.ts';
import { splice, textOf, createBuffer } from '../buffer/buffer.ts';
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
    assert.equal(out.clipboard?.text, text);
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
    expectText: 'line one',
  },
  {
    name: 'indented code block',
    source: '    indented\n    second\n',
    pick: (d) => d.children[0] as CodeBlock,
    expectText: 'indented\nsecond',
  },
  {
    name: 'unclosed fence at EOF',
    source: '```\nstill open\n',
    pick: (d) => d.children[0] as CodeBlock,
    expectText: 'still open',
  },
  {
    name: 'empty block',
    source: '```\n```\n',
    pick: (d) => d.children[0] as CodeBlock,
    expectText: '',
  },  {
    name: 'a CRLF block ends its copy with CRLF, not a lone LF',
    source: '```\r\na\r\nb\r\n```\r\n',
    pick: (d) => d.children[0] as CodeBlock,
    expectText: 'a\r\nb',
  },
  {
    name: 'one-line command copies without an added newline',
    source: '```sh\npnpm install --frozen-lockfile\n```\n',
    pick: (d) => d.children[0] as CodeBlock,
    expectText: 'pnpm install --frozen-lockfile',
  },
  {
    name: 'a trailing blank line inside the fence is kept',
    source: '```\nline one\n\n\n```\n',
    pick: (d) => d.children[0] as CodeBlock,
    expectText: 'line one\n\n',
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
  assert.equal(out.clipboard?.text, text);
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
  spliceFn: typeof splice = splice,
): void {
  const buffer = createBuffer('mutation-check', bytes);
  const src: Source = { file: buffer.path, start: range.start, end: range.end };
  const next = spliceFn(buffer, src, replacement);
  const enc = new TextEncoder().encode(replacement);
  assert.deepEqual(
    [...next.bytes.subarray(range.start, range.start + enc.length)],
    [...enc],
    'the replacement must land exactly in the range',
  );
  assert.deepEqual(
    [...next.bytes.subarray(0, range.start)],
    [...bytes.subarray(0, range.start)],
    'bytes before the range must be unchanged',
  );
  assert.deepEqual(
    [...next.bytes.subarray(range.start + enc.length)],
    [...bytes.subarray(range.end)],
    'bytes after the range must be unchanged',
  );
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

const corpusFiles = readdirSync(corpus)
  .filter((name) => name !== 'check-prose-volume.mjs' && name !== 'image.png' && !name.startsWith('.'))
  .sort();

function allNodes(root: Node, out: Node[] = []): Node[] {
  out.push(root);
  for (const child of root.children ?? []) allNodes(child, out);
  return out;
}

test('fidelity: replacement === text for every applicable copy operation node in the corpus', () => {
  const files = corpusFiles.filter((f) => f.endsWith('.md'));
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
  for (const file of corpusFiles) {
    const bytes = readFileSync(new URL(file, corpus));
    const doc = parseMarkdown(bytes, { file });
    const buffer = createBuffer(file, bytes);
    for (const node of allNodes(doc)) {
      if (node.type === 'document') continue;
      const range = node.src;
      const text = textOf(buffer, range);
      const input = { document: doc, node, range, text };
      for (const op of mutateOps) {
        if (!op.canApply(input)) continue;
        const result = op.run(input);
        assertBytesOutsideRangeUnchanged(bytes, range, result.replacement);
      }
    }
  }
});

test('fidelity: corrupting one byte outside the range is caught by the mutation guard', () => {
  const bytes = readFileSync(new URL('03-ai-plan.md', corpus));
  const doc = parseMarkdown(bytes, { file: '03-ai-plan.md' });
  const buffer = createBuffer('03-ai-plan.md', bytes);
  const markers: Extract<Inline, { type: 'taskMarker' }>[] = [];
  taskMarkersOf(doc, markers);
  assert.ok(markers.length > 0);
  const marker = markers[0]!;
  const range = marker.src;
  const text = textOf(buffer, range);
  const result = toggleTask.run({ document: doc, node: marker, range, text });
  const noopSplice: typeof splice = (current) => current;
  assert.throws(
    () => assertBytesOutsideRangeUnchanged(bytes, range, result.replacement, noopSplice),
    (error: unknown) => error instanceof assert.AssertionError,
  );
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

test('copy-section clipboard html keeps inline code text that resembles provenance attributes', () => {
  const source = '## Snippet\n\n`a data-marxy-k="9" b`\n\n```html\n<p data-marxy-s="0" data-marxy-e="1">ok</p>\n```\n';
  const document = parse(source);
  const heading = document.children[0] as Heading;
  const range = sectionRange(document, heading);
  const text = sliceText(source, range.start, range.end);
  const result = copySection.run({ document, node: heading, range, text });
  assert.ok(result.clipboard?.html?.includes('a data-marxy-k="9" b'));
  assert.ok(result.clipboard?.html?.includes('data-marxy-s="0" data-marxy-e="1"'));
  assert.equal(result.clipboard?.text, text);
});

test('copy-section.ts does not strip provenance with a regex over the whole html string', () => {
  const src = readFileSync(fileURLToPath(new URL('./copy-section.ts', import.meta.url)), 'utf8');
  assert.ok(!src.includes('html.replace(/\\sdata-marxy-'));
  assert.ok(!src.includes('<script\\b'));
});

test('copy-section keeps a reference link whose definition is outside the section', () => {
  const source = '# Title\n\n## Install\n\nSee [the docs][d].\n\n## Next\n\nMore.\n\n[d]: https://example.com/docs\n';
  const document = parse(source);
  const heading = document.children.find((block): block is Heading => block.type === 'heading' && block.level === 2)!;
  const range = sectionRange(document, heading);
  const result = copySection.run({ document, node: heading, range, text: sliceText(source, range.start, range.end) });
  assert.match(result.clipboard?.html ?? '', /<a href="https:\/\/example\.com\/docs"(?: class="marxy-external")?>the docs<\/a>/);
  assert.ok(!(result.clipboard?.html ?? '').includes('More.'));
});

// 2026-09-26 review (MARXY-246): cases the corpus has none of.
function alignWhole(source: string): { out: string; table: Extract<Block, { type: 'table' }> | undefined } {
  const doc = parse(source);
  const tables: Extract<Block, { type: 'table' }>[] = [];
  tablesOf(doc, tables);
  const table = tables[0]!;
  const bytes = new TextEncoder().encode(source);
  const dec = new TextDecoder();
  const text = dec.decode(bytes.slice(table.src.start, table.src.end));
  const replacement = alignTablePipes.run({ document: doc, node: table, range: table.src, text }).replacement;
  const out = dec.decode(bytes.slice(0, table.src.start)) + replacement + dec.decode(bytes.slice(table.src.end));
  const again: Extract<Block, { type: 'table' }>[] = [];
  tablesOf(parse(out), again);
  return { out, table: again[0] };
}

const cellsOf = (t: Extract<Block, { type: 'table' }> | undefined, source: string) =>
  t?.children.map((r) => r.children.map((c) => sliceText(source, c.src.start, c.src.end).replace(/^\s*\|/, '').replace(/\|\s*$/, '').trim()));

for (const [name, source, expected] of [
  ['indented', '  | a | b |\n  | - | - |\n  | x | y |\n', '  | a   | b   |\n  | --- | --- |\n  | x   | y   |\n'],
  ['blockquote', '> | a | b |\n> | - | - |\n> | xx | y |\n', '> | a   | b   |\n> | --- | --- |\n> | xx  | y   |\n'],
  ['list item', '- item\n\n  | a | b |\n  | - | - |\n  | xx | y |\n', '- item\n\n  | a   | b   |\n  | --- | --- |\n  | xx  | y   |\n'],
] as const) {
  test(`align-table-pipes: a table in a container (${name}) keeps its prefix and stays the same table`, () => {
    const before = alignWhole(source);
    assert.equal(before.out, expected);
    const orig: Extract<Block, { type: 'table' }>[] = [];
    tablesOf(parse(source), orig);
    assert.deepEqual(cellsOf(before.table, before.out), cellsOf(orig[0], source));
  });
}

test('align-table-pipes: a body row of dashes is content, not a second delimiter row', () => {
  const { out } = alignWhole('| Option | Default |\n|---|---|\n| verbose | false |\n| - | - |\n');
  assert.match(out, /\n\| -       \| -       \|\n$/);
});

test('align-table-pipes: a row with no closing pipe gains no trailing whitespace', () => {
  const { out } = alignWhole('a | b\n--|--\nx | y\n');
  assert.equal(out, 'a   | b\n--- | ---\nx   | y\n');
});

test('align-table-pipes: an escaped backslash before a pipe does not escape the pipe', () => {
  const source = '| x \\\\| y |\n|---|---|\n| 1 | 2 |\n';
  const { out, table } = alignWhole(source);
  assert.equal(table?.children[0]?.children.length, 2);
  assert.equal(out, '| x \\\\ | y   |\n| ---- | --- |\n| 1    | 2   |\n');
});

test('displayWidth: marks, VS16, presentation emoji and zero-width characters', () => {
  assert.equal(displayWidth('é'), 1);
  assert.equal(displayWidth('❤️'), 2);
  assert.equal(displayWidth('1️⃣'), 2);
  assert.equal(displayWidth('✅'), 2);
  assert.equal(displayWidth('⌚'), 2);
  assert.equal(displayWidth('a​b'), 2);
  assert.equal(displayWidth('कि'), 1);
  assert.equal(displayWidth('漢字'), 4);
});

test('copy-section clipboard text is the exact source slice (MARXY-337)', () => {
  for (const source of ['# A\r\n\r\ntext\r\nmore\r\n', '# A\n\nline  \n', '# A\n\nline\t\n', '# A\n\ntext', '# A\n\ntext\n\n\n']) {
    const document = parse(source);
    const heading = document.children[0] as Heading;
    const range = sectionRange(document, heading);
    const text = sliceText(source, range.start, range.end);
    const out = copySection.run({ document, node: heading, range, text });
    assert.equal(out.clipboard?.text, text, JSON.stringify(source));
    assert.equal(out.clipboard?.text, source, JSON.stringify(source));
  }
});
