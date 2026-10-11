// dedupe-lines (E-05): a run of top-level blocks is a raw span (no node). Rows run as written, CRLF, CR, without the trailing
// newline and behind a BOM through the kit's variants; the kit's byte properties are asserted on every one, and over the corpus.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Document, Node, Source } from '../contracts/ast.ts';
import { createBuffer, splice, textOf } from '../buffer/buffer.ts';
import { parseMarkdown } from '../parse/parse.ts';
import { dedupeLines } from './dedupe-lines.ts';
import { corpusDocuments } from './testing/corpus.ts';
import {
  assertBytesOutsideRangeUnchanged,
  assertLineSeparatorsPreserved,
  assertMinimalDiff,
  canFail,
  crlf,
  mixedAllEndings,
  rowVariants,
  withBom,
  type Row,
} from './testing/test-kit.ts';

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { ignoreBOM: true });

/** The run of top-level blocks `from..to` as one range, the way a Rendered run resolves: first.start to last.end, no node. */
function run(doc: Document, from: number, to: number): Source {
  const a = doc.children[from]!;
  const b = doc.children[to]!;
  return { file: a.src.file, start: a.src.start, end: b.src.end };
}

interface SpanRow {
  readonly name: string;
  readonly source: string;
  readonly expect: string;
  /** Top-level block indexes the run covers; default the whole document. */
  readonly blocks?: readonly [number, number];
  readonly summary?: RegExp;
}

function check(source: string, expected: string, row: SpanRow): void {
  const bytes = enc.encode(source);
  const doc = parseMarkdown(bytes, { file: 'table.md' });
  const [from, to] = row.blocks ?? [0, doc.children.length - 1];
  const range = run(doc, from, to);
  const text = textOf(createBuffer('table.md', bytes), range);
  const refuses = expected === source;
  assert.equal(dedupeLines.canApply({ document: doc, range }), true, 'the run is offered');
  const result = dedupeLines.run({ document: doc, range, text });
  if (row.summary) assert.match(result.summary ?? '', row.summary);
  if (refuses) assert.equal(result.replacement, text, 'nothing to remove: replacement === text');
  assertBytesOutsideRangeUnchanged(bytes, range, result.replacement);
  assertLineSeparatorsPreserved(source, result.replacement);
  const after = dec.decode(splice(createBuffer('table.md', bytes), range, result.replacement).bytes);
  assert.equal(after, expected);
}

const row = (name: string, source: string, expect: string, blocks?: readonly [number, number], summary?: RegExp): SpanRow => ({
  name,
  source,
  expect,
  ...(blocks ? { blocks } : {}),
  ...(summary ? { summary } : {}),
});

const ROWS: SpanRow[] = [
  row('two paragraphs and a list with three repeated lines', 'one\ntwo\none\n\nthree\ntwo\n\n- a\n- b\n- a\n', 'one\ntwo\n\nthree\n\n- a\n- b\n', undefined, /Removed 3 duplicate lines/),
  row('one repeated line', 'a\nb\na\n', 'a\nb\n', undefined, /Removed 1 duplicate line$/),
  row('a duplicate that is the last line', '- x\n- y\n- x', '- x\n- y'),
  row('a duplicate separated by a blank line: its paragraph and the blank after it go', 'a\n\nb\n\na\n\nc\n', 'a\n\nb\n\nc\n'),
  row('a duplicated paragraph at the end takes the blank line before it', 'a\n\nb\n\na\n', 'a\n\nb\n'),
  row('a duplicated paragraph at the very end, no trailing newline', 'a\n\nb\n\na', 'a\n\nb'),
  row('two blank lines after a removed paragraph go with it', 'a\n\nb\n\n\na\n\n\nc\n', 'a\n\nb\n\n\nc\n'),
  row('only the first occurrence stays', 'x\nx\nx\nx\n', 'x\n', undefined, /Removed 3 duplicate lines/),
  row('blank lines are never duplicates', 'a\n\nb\n\nc\n', 'a\n\nb\n\nc\n'),
  row('trailing whitespace does not make a line different; the first occurrence is kept as written', 'a  \na\nb\n', 'a  \nb\n'),
  row('indentation is structure, so an indented copy stays', '- a\n  - a\n', '- a\n  - a\n'),
  row('nothing repeated: replacement is the text', 'a\nb\n\n- c\n', 'a\nb\n\n- c\n', undefined, /No duplicate lines/),
  row('emoji lines', '🙂 hello\n🎉\n🙂 hello\n👩‍👩‍👧\n👩‍👩‍👧\n', '🙂 hello\n🎉\n👩‍👩‍👧\n'),
  row('CJK lines', '猫\n犬\n猫\n\n犬\n', '猫\n犬\n'),
  row('only the run is touched: a repeat outside it stays', 'a\n\nb\n\na\n\nb\n\na\n', 'a\n\nb\n\na\n\na\n', [1, 3]),
  row('a repeat of a line before the run is not a duplicate of it', 'a\n\nb\n\nb\n\na\n', 'a\n\nb\n\na\n', [1, 3]),
  row('inside a list, nested repeated items go', '- a\n  - x\n- b\n- a\n  - x\n', '- a\n  - x\n- b\n'),
  row('an ordered list repeats by marker and text', '1. a\n2. b\n1. a\n', '1. a\n2. b\n'),
];

for (const r of ROWS) {
  const asRow: Row = { name: r.name, source: r.source, expect: r.expect, pick: (d) => d.children[0] as Node };
  for (const [label, source, expected] of rowVariants(asRow, { bom: true })) {
    test(`dedupe-lines: ${r.name} [${label}]`, () => check(source, expected, r));
  }
}

test('mixed endings: each kept line keeps its own, and the ending after the run stays', () => {
  const source = 'a\r\nb\na\rc\r\nb\n';
  const doc = parseMarkdown(source, { file: 't.md' });
  const range = run(doc, 0, doc.children.length - 1);
  const { replacement } = dedupeLines.run({ document: doc, range, text: source.slice(range.start, range.end) });
  assert.equal(source.slice(0, range.start) + replacement + source.slice(range.end), 'a\r\nb\nc\n');
});

test('a removed line takes its own ending (CR file, last line removed, no trailing newline)', () => {
  const source = 'a\rb\ra';
  const doc = parseMarkdown(source, { file: 't.md' });
  const range = run(doc, 0, 0);
  assert.equal(dedupeLines.run({ document: doc, range, text: source }).replacement, 'a\rb');
});

test('canApply: a span of paragraphs and lists only; not a node, a fence, a table, a heading, raw HTML, a quote or an empty range', () => {
  const ok = parseMarkdown('p\n\n- l\n', { file: 't.md' });
  assert.equal(dedupeLines.canApply({ document: ok, range: run(ok, 0, 1) }), true);
  assert.equal(dedupeLines.canApply({ document: ok, node: ok.children[0]!, range: ok.children[0]!.src }), false, 'a node is a block, not a span');
  assert.equal(dedupeLines.canApply({ document: ok, range: { ...ok.src, start: 3, end: 3 } }), false, 'empty');
  assert.deepEqual(dedupeLines.appliesTo, ['span']);
  const bad: [string, string][] = [
    ['a fence', 'p\n\n```\nx\nx\n```\n'],
    ['a table', 'p\n\n| a |\n| - |\n| x |\n| x |\n'],
    ['a heading', '# t\n\np\n'],
    ['raw HTML', 'p\n\n<div>\nx\n</div>\n'],
    ['a quote', 'p\n\n> q\n> q\n'],
    ['a fence inside a list item', '- a\n\n  ```\n  x\n  x\n  ```\n'],
    ['math', 'p\n\n$$\nx\nx\n$$\n'],
  ];
  for (const [name, source] of bad) {
    const doc = parseMarkdown(source, { file: 't.md' });
    assert.equal(dedupeLines.canApply({ document: doc, range: run(doc, 0, doc.children.length - 1) }), false, name);
  }
  // A run that stops before the fence is fine.
  const doc = parseMarkdown('p\n\np\n\n```\nx\n```\n', { file: 't.md' });
  assert.equal(dedupeLines.canApply({ document: doc, range: run(doc, 0, 1) }), true);
  assert.equal(dedupeLines.canApply({ document: doc, range: run(doc, 0, 2) }), false);
});

test('the lines of a fence are content: a run is refused and a fence in its range would not be touched', () => {
  const source = 'a\n\n```\nx\nx\n```\n';
  const doc = parseMarkdown(source, { file: 't.md' });
  assert.equal(dedupeLines.canApply({ document: doc, range: doc.src }), false);
});

test('over the corpus: every run of sibling prose blocks, in every line-ending form, removes only duplicate lines', () => {
  let applied = 0;
  let changed = 0;
  for (const { file, bytes: original } of corpusDocuments()) {
    const text0 = dec.decode(original);
    const forms: [string, string][] = [
      ['as is', text0],
      ['crlf', crlf(text0)],
      ['bom', text0.startsWith('﻿') ? text0 : withBom(text0)],
      ['mixed-all', mixedAllEndings(text0, 1)],
    ];
    for (const [label, text] of forms) {
      const bytes = enc.encode(text);
      const doc = parseMarkdown(bytes, { file });
      const kids = doc.children;
      for (let from = 0; from < kids.length; from++) {
        for (let to = from; to < Math.min(kids.length, from + 6); to++) {
          const range = run(doc, from, to);
          if (!dedupeLines.canApply({ document: doc, range })) continue;
          applied++;
          const body = dec.decode(bytes.subarray(range.start, range.end));
          const { replacement } = dedupeLines.run({ document: doc, range, text: body });
          const where = `${file} [${label}] blocks ${from}..${to}`;
          assertBytesOutsideRangeUnchanged(bytes, range, replacement);
          assertLineSeparatorsPreserved(text, replacement, where);
          // Targets: the removed lines, found by walking the lines of the span against what stayed.
          const targets = removedLines(bytes, range, replacement);
          assertMinimalDiff(bytes, range, replacement, targets);
          const again = dedupeLines.run({ document: doc, range, text: replacement });
          assert.equal(again.replacement, replacement, `${where}: idempotent`);
          if (replacement !== body) changed++;
        }
      }
    }
  }
  assert.ok(applied > 0, 'the corpus offered at least one run');
  assert.ok(changed > 0, 'and at least one run had a duplicate to remove');
});

/** The byte ranges of `range` that `replacement` lacks, as whole lines (body and ending) or blank-line separators, by greedy match from the left. */
function removedLines(bytes: Uint8Array, range: Source, replacement: string): Source[] {
  const body = dec.decode(bytes.subarray(range.start, range.end));
  const parts = body.match(/[^\r\n]*(\r\n|\r|\n|$)/g)!.filter((s) => s !== '');
  const out: Source[] = [];
  let at = 0;
  let offset = range.start;
  for (const part of parts) {
    const size = enc.encode(part).length;
    if (replacement.startsWith(part, at)) at += part.length;
    else out.push({ file: range.file, start: offset, end: offset + size });
    offset += size;
  }
  return out;
}

test('the byte properties can fail: an operation that drops a line ending from a kept line is caught', () => {
  const source = 'a\r\nb\r\n';
  const bytes = enc.encode(source);
  canFail(() => assertLineSeparatorsPreserved(source, 'a\nb\n'));
  canFail(() => assertMinimalDiff(bytes, { start: 0, end: bytes.length }, 'ab', []));
});
