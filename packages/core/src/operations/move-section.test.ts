// move-section-up / move-section-down (W-10). The table rows run as written, in CRLF, in lone CR, without the final line
// ending and (where they say so) behind a BOM. Below them: the bytes of the card's own examples, a differential test against a
// reference written from the generator's model rather than from the parse, the round trip, and the corpus sweep.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Document, Heading, Node } from '../contracts/ast.ts';
import type { Operation } from '../contracts/operation.ts';
import { createBuffer, splice, textOf } from '../buffer/buffer.ts';
import { parseMarkdown } from '../parse/parse.ts';
import { blockShape, moveSectionDown, moveSectionUp, sectionSwapOf, swapSections, type MoveDirection } from './move-section.ts';
import { OPERATIONS } from './index.ts';
import { generate, reference, sectionIndexAfterDown, sectionIndexAfterUp } from './testing/sections.ts';
import { corpusDocuments } from './testing/corpus.ts';
import {
  assertBytesOutsideRangeUnchanged,
  assertLineSeparatorsPreserved,
  canFail,
  cr,
  crlf,
  mixedAllEndings,
  tableTest,
  withBom,
  type Row,
} from './testing/test-kit.ts';

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { ignoreBOM: true });
const parse = (s: string | Uint8Array): Document => parseMarkdown(s, { file: 't.md' });

/** The top-level headings, in order: the ones that are sections. */
const topHeadings = (doc: Document): Heading[] => doc.children.filter((b): b is Heading => b.type === 'heading');
const OPS: Record<MoveDirection, Operation> = { up: moveSectionUp, down: moveSectionDown };

/** The input an app builds for a move of the `at`-th heading: its node and the two sections together. */
function inputFor(doc: Document, bytes: Uint8Array, at: number, direction: MoveDirection) {
  const node = topHeadings(doc)[at]!;
  const swap = sectionSwapOf(doc, node, direction);
  if (swap === null) return null;
  const buffer = createBuffer('t.md', bytes);
  return { document: doc, node: node as Node, range: swap.range, text: textOf(buffer, swap.range) };
}

/** The document after moving the `at`-th heading, or null when it has no place to go. */
function moved(source: string, at: number, direction: MoveDirection): string | null {
  const bytes = enc.encode(source);
  const doc = parse(bytes);
  const input = inputFor(doc, bytes, at, direction);
  if (input === null) return null;
  assert.equal(OPS[direction].canApply(input), true);
  const { replacement } = OPS[direction].run(input);
  assertBytesOutsideRangeUnchanged(bytes, input.range, replacement);
  return dec.decode(splice(createBuffer('t.md', bytes), input.range, replacement).bytes);
}

const row = (name: string, source: string, expect: string, at: number): Row => ({
  name,
  source,
  expect,
  pick: (doc) => topHeadings(doc)[at]!,
  range: (doc, node) => sectionSwapOf(doc, node as Heading, direction(name))?.range ?? node.src,
});
// A row names its direction in its title.
const direction = (name: string): MoveDirection => (name.startsWith('down:') ? 'down' : 'up');

tableTest(moveSectionUp, [
  row('up: the second of three siblings is swapped with the first', '# A\na\n# B\nb\n# C\nc\n', '# B\nb\n# A\na\n# C\nc\n', 1),
  row('up: the third of three', '# A\na\n# B\nb\n# C\nc\n', '# A\na\n# C\nc\n# B\nb\n', 2),
  row('up: a section takes its sub-sections with it', '# A\na\n## A1\nx\n# B\nb\n## B1\ny\n', '# B\nb\n## B1\ny\n# A\na\n## A1\nx\n', 2),
  row('up: a sub-section swaps with its sibling, not across the parent', '# P\n## A\na\n## B\nb\n', '# P\n## B\nb\n## A\na\n', 2),
  row('up: a deeper section in between goes with the one before it', '## A\na\n### A1\nx\n## B\nb\n', '## B\nb\n## A\na\n### A1\nx\n', 2),
  row('up: the text before the first section stays put', 'intro\n\n# A\na\n# B\nb\n', 'intro\n\n# B\nb\n# A\na\n', 1),
  row('up: an indented heading keeps its indent', '# A\na\n   # B\nb\n', '   # B\nb\n# A\na\n', 1),
  row('up: the first section has nowhere to go', '# A\na\n# B\nb\n', '# A\na\n# B\nb\n', 0),
  row('up: the first child has no sibling above it (the parent is higher)', '# P\n## A\na\n## B\nb\n', '# P\n## A\na\n## B\nb\n', 1),
  row('up: a section is not moved across a heading of a higher level', '## A\na\n# H\n## B\nb\n', '## A\na\n# H\n## B\nb\n', 2),
]);

tableTest(moveSectionDown, [
  row('down: the first of three siblings is swapped with the second', '# A\na\n# B\nb\n# C\nc\n', '# B\nb\n# A\na\n# C\nc\n', 0),
  row('down: the second of three', '# A\na\n# B\nb\n# C\nc\n', '# A\na\n# C\nc\n# B\nb\n', 1),
  row('down: a section with sub-sections swaps with the next sibling and its sub-sections', '# A\na\n## A1\nx\n# B\nb\n## B1\ny\n', '# B\nb\n## B1\ny\n# A\na\n## A1\nx\n', 0),
  row('down: the last section has nowhere to go', '# A\na\n# B\nb\n', '# A\na\n# B\nb\n', 1),
  row('down: the last child has no sibling below it (a higher heading follows)', '# P\n## A\na\n# Q\nq\n', '# P\n## A\na\n# Q\nq\n', 1),
  row('down: a heading in a fence, in front matter, in a quote and in a list is not a section', '---\n# front\n---\n# A\n```\n# fence\n```\n> # quote\n- # item\n# B\nb\n', '---\n# front\n---\n# B\nb\n# A\n```\n# fence\n```\n> # quote\n- # item\n', 0),
]);

// The single-ending rows above are exact under every variant; those with blank lines between sections have their own checks below,
// because a missing final line ending moves the ending the file lost, not the one the kit would cut.
tableTest(
  moveSectionUp,
  [
    row('up: blank lines stay with their section', '# A\n\na\n\n# B\n\nb\n\n', '# B\n\nb\n\n# A\n\na\n\n', 1),
    row('up: a setext section moves like any other', 'A\n===\n\na\n\nB\n===\n\nb\n\n', 'B\n===\n\nb\n\nA\n===\n\na\n\n', 1),
    row('up: a setext level 2 among ATX', '## A\n\na\n\nB\n---\n\nb\n\n', 'B\n---\n\nb\n\n## A\n\na\n\n', 1),
    row('up: a swap of paragraph sections', '# A\n\nfirst.\n\n## A1\n\nx\n\n# B\n\nsecond.\n\n', '# B\n\nsecond.\n\n# A\n\nfirst.\n\n## A1\n\nx\n\n', 2),
  ],
  { bom: true, lfOnly: true },
);

// ---- the card's examples, exact ---------------------------------------------------------------------------------------

test('three sections: moving the second up gives the bytes of 2, 1, 3, each section byte for byte', () => {
  const one = '# One\n\nfirst text  \n\n';
  const two = '# Two\n\nsecond\t\n\n';
  const three = '# Three\n\nthird\n';
  const source = one + two + three;
  assert.equal(moved(source, 1, 'up'), two + one + three);
  assert.equal(moved(source, 0, 'down'), two + one + three);
  assert.equal(moved(source, 1, 'down'), one + three + two);
  assert.equal(moved(source, 2, 'up'), one + three + two);
});

test('a CRLF file keeps CRLF: no line feed is added or removed', () => {
  const source = crlf('# A\n\na\n\n# B\n\nb\n');
  const after = moved(source, 1, 'up')!;
  assert.equal(after, '# B\r\n\r\nb\r\n# A\r\n\r\na\r\n\r\n');
  assert.equal(after.replace(/\r\n/g, '').match(/[\r\n]/), null, 'no lone CR or LF appears');
  assert.equal((after.match(/\r\n/g) ?? []).length, (source.match(/\r\n/g) ?? []).length);
});

test('the last section with no final line ending, moved up, leaves the file still without one (question 2)', () => {
  // One line ending between the sections: the first gains nothing, the last loses nothing.
  assert.equal(moved('# A\na\n# B\nb', 1, 'up'), '# B\nb\n# A\na');
  assert.equal(moved('# A\na\n# B\nb', 0, 'down'), '# B\nb\n# A\na');
  // Blank lines between them: they stay between them, and the file's last byte is the same text byte as before.
  assert.equal(moved('# A\n\na\n\n# B\n\nb', 1, 'up'), '# B\n\nb\n\n# A\n\na');
  assert.equal(moved('# A\n\na\n\n# B\n\nb', 0, 'down'), '# B\n\nb\n\n# A\n\na');
  // In CRLF, with the file's own line ending.
  assert.equal(moved(crlf('# A\n\na\n\n# B\n\nb'), 1, 'up'), crlf('# B\n\nb\n\n# A\n\na'));
  // A lone CR file.
  assert.equal(moved(cr('# A\na\n# B\nb'), 1, 'up'), cr('# B\nb\n# A\na'));
});

test('moving up and then down puts back the exact bytes, with a final line ending, without one, and in every line ending', () => {
  const sources = [
    '# A\n\na\n\n# B\n\nb\n',
    '# A\n\na\n\n# B\n\nb',
    '# A\na\n## A1\nx\n# B\nb\n',
    '﻿# A\r\n\r\na\r\n\r\n# B\r\n\r\nb',
    cr('# A\n\na\n\n# B\n\nb\n\n\n'),
    mixedAllEndings('# A\n\na\n\n# B\n\nb\n\n# C\nc', 5),
  ];
  for (const source of sources) {
    const heads = topHeadings(parse(source));
    for (let i = 1; i < heads.length; i++) {
      if (heads[i]!.level !== heads[i - 1]!.level) continue;
      const up = moved(source, i, 'up');
      if (up === null) continue;
      assert.notEqual(up, source);
      // After the move the section is at the sibling's index; down returns it.
      const back = moved(up, i - 1, 'down');
      assert.equal(back, source, `up then down: ${JSON.stringify(source)}`);
    }
  }
});

test('the first section is not offered Move up, nor the last Move down', () => {
  const source = '# A\na\n# B\nb\n# C\nc\n';
  const bytes = enc.encode(source);
  const doc = parse(bytes);
  const heads = topHeadings(doc);
  const offered = (op: Operation, at: number): boolean => {
    const swap = sectionSwapOf(doc, heads[at]!, op === moveSectionUp ? 'up' : 'down');
    return swap !== null && op.canApply({ document: doc, node: heads[at]!, range: swap.range });
  };
  assert.equal(offered(moveSectionUp, 0), false);
  assert.equal(offered(moveSectionUp, 1), true);
  assert.equal(offered(moveSectionDown, 2), false);
  assert.equal(offered(moveSectionDown, 1), true);
  assert.equal(moved(source, 0, 'up'), null);
  assert.equal(moved(source, 2, 'down'), null);
});

test('canApply wants the heading and both sections as the range, and nothing else', () => {
  const bytes = enc.encode('# A\na\n# B\nb\n');
  const doc = parse(bytes);
  const [a, b] = topHeadings(doc) as [Heading, Heading];
  const swap = sectionSwapOf(doc, b, 'up')!;
  assert.equal(moveSectionUp.canApply({ document: doc, node: b, range: swap.range }), true);
  // The section alone, the heading alone, a paragraph, no node and the document do not qualify.
  assert.equal(moveSectionUp.canApply({ document: doc, node: b, range: { ...swap.range, start: b.src.start } }), false);
  assert.equal(moveSectionUp.canApply({ document: doc, node: b, range: b.src }), false);
  assert.equal(moveSectionUp.canApply({ document: doc, node: doc.children[1]!, range: swap.range }), false);
  assert.equal(moveSectionUp.canApply({ document: doc, range: swap.range }), false);
  assert.equal(moveSectionUp.canApply({ document: doc, node: doc, range: doc.src }), false);
  // The first heading has no sibling above it.
  assert.equal(moveSectionUp.canApply({ document: doc, node: a, range: swap.range }), false);
  // Up and down name different ranges for the same heading.
  assert.equal(moveSectionDown.canApply({ document: doc, node: b, range: swap.range }), false);
  assert.deepEqual(moveSectionUp.appliesTo, ['section']);
  assert.deepEqual(moveSectionDown.appliesTo, ['section']);
});

test('both operations are registered, as mutating ones, and not as copy verbs', () => {
  for (const id of ['move-section-up', 'move-section-down']) assert.equal(OPERATIONS.filter((op) => op.id === id).length, 1, id);
});

test('swapSections: the join takes the first section\'s line endings, whatever they are, and only when the second has none', () => {
  assert.deepEqual(swapSections('a\n', 'b\n'), { text: 'b\na\n', firstAt: 2 });
  assert.deepEqual(swapSections('a\n', 'b'), { text: 'b\na', firstAt: 2 });
  assert.deepEqual(swapSections('a\r\n\r\n', 'b'), { text: 'b\r\n\r\na', firstAt: 5 });
  assert.deepEqual(swapSections('a\r\n\n\r', 'b'), { text: 'b\r\n\n\ra', firstAt: 5 });
  // A second that ends with only a blank line still ends with a line ending: nothing is joined.
  assert.deepEqual(swapSections('a\n', 'b\n\n'), { text: 'b\n\na\n', firstAt: 3 });
});

// ---- headings that are not sections ----------------------------------------------------------------------------------

test('headings inside a code fence, front matter, a quote or a list item are neither moved nor moved past', () => {
  const source = '---\ntitle: x\n# not a heading\n---\n# A\n```md\n# in a fence\n## also\n```\n> # quoted\n\n- # listed\n\n# B\nb\n';
  const doc = parse(source);
  assert.equal(topHeadings(doc).length, 2);
  const after = moved(source, 1, 'up')!;
  assert.equal(after, '---\ntitle: x\n# not a heading\n---\n# B\nb\n# A\n```md\n# in a fence\n## also\n```\n> # quoted\n\n- # listed\n\n');
  // The quote's heading and the list's have no section to move.
  for (const nested of [doc.children.find((b) => b.type === 'blockquote')!.children![0]!, doc.children.find((b) => b.type === 'list')!.children![0]!.children![0]!]) {
    assert.equal(nested.type, 'heading');
    assert.equal(sectionSwapOf(doc, nested as Heading, 'up'), null);
    assert.equal(sectionSwapOf(doc, nested as Heading, 'down'), null);
  }
});

test('a move that would merge a paragraph into a heading changes the shape, which is how a host knows to refuse it', () => {
  // A move that keeps the structure: the shape is the sections' shapes in the new order.
  const clean = '# A\n\na\n\n# B\n\nb\n';
  assert.deepEqual(blockShape(parse(moved(clean, 1, 'up')!)), blockShape(parse(clean)));
  // The last section has no blank line after it; moved above a setext section whose line ending is single, its text line
  // runs into the setext text and the underline turns both into one heading.
  const joined = '# A\na\n\nB\n===\nb\n# C\nc';
  const after = moved(joined, 2, 'up')!;
  assert.equal(after, '# A\na\n\n# C\nc\nB\n===\nb');
  assert.deepEqual(blockShape(parse(joined)), ['h1', 'paragraph', 'h1', 'paragraph', 'h1', 'paragraph']);
  assert.notDeepEqual(blockShape(parse(after)), blockShape(parse(joined)));
  // A setext section moved to just below a paragraph line takes that line into its heading.
  const into = moved('p\n# A\na\n\nB\n===\nb\n', 1, 'up')!;
  assert.equal(into, 'p\nB\n===\nb\n# A\na\n\n');
  assert.notDeepEqual(blockShape(parse(into)), ['paragraph', 'h1', 'paragraph', 'h1', 'paragraph']);
});

// ---- the differential test --------------------------------------------------------------------------------------------

test('differential: every move over a thousand random documents is the reference splice, byte for byte; up then down restores the bytes', () => {
  let moves = 0;
  let joins = 0;
  let merged = 0;
  let restored = 0;
  for (let seed = 1; seed <= 1000; seed++) {
    const { text, gen } = generate(seed);
    const bytes = enc.encode(text);
    const doc = parse(bytes);
    const heads = topHeadings(doc);
    // The parse agrees with the generator about which headings are sections: none in the fence, quote, list or front matter.
    assert.equal(heads.length, gen.sections.length, `seed ${seed}: ${JSON.stringify(text)}`);
    heads.forEach((h, i) => assert.equal(h.level, gen.sections[i]!.level, `seed ${seed}: section ${i} level`));
    for (let at = 0; at < heads.length; at++) {
      for (const direction of ['up', 'down'] as const) {
        const want = reference(text, gen, at, direction);
        const input = inputFor(doc, bytes, at, direction);
        const where = `seed ${seed}, ${direction} section ${at}: ${JSON.stringify(text)}`;
        if (want === null) {
          assert.equal(input, null, `offered a move the reference does not have: ${where}`);
          continue;
        }
        assert.ok(input !== null, `refused a move the reference makes: ${where}`);
        assert.equal(OPS[direction].canApply(input), true, where);
        const { replacement } = OPS[direction].run(input);
        assertBytesOutsideRangeUnchanged(bytes, input.range, replacement);
        assertLineSeparatorsPreserved(text, replacement);
        const got = dec.decode(splice(createBuffer('t.md', bytes), input.range, replacement).bytes);
        assert.equal(got, want, where);
        moves++;
        if (gen.sections[gen.sections.length - 1]!.lines.at(-1)!.eol === '' && want.length > 0) joins++;
        // The file ends as it did.
        assert.equal(got.endsWith('\n') || got.endsWith('\r'), text.endsWith('\n') || text.endsWith('\r'), `final line ending state: ${where}`);
        assert.equal(got.length, text.length, `the move adds and removes no byte: ${where}`);
        // Every byte is still there: the lines are the same multiset.
        assert.deepEqual([...got].sort(), [...text].sort(), where);
        // The section lands at the sibling's place; one move the other way puts everything back.
        // A move can run a last section that has no blank line after it into a setext heading below it; the host sees that in the
        // shape (see above) and refuses, so the opposite move is only tried where the headings are still the generator's.
        if (blockShape(parse(got)).sort().join() !== blockShape(doc).sort().join()) {
          merged++;
          continue;
        }
        const to = direction === 'up' ? sectionIndexAfterUp(gen, at) : sectionIndexAfterDown(gen, at);
        const back = moved(got, to, direction === 'up' ? 'down' : 'up');
        assert.equal(back, text, `the opposite move restores the bytes: ${where}`);
        restored++;
      }
    }
  }
  assert.ok(moves > 1500, `${moves} moves were made`);
  assert.ok(joins > 100, `${joins} moves met a last section with no final line ending`);
  assert.ok(restored > 1000 && restored > merged * 10, `${restored} moves were undone by the opposite move; ${merged} merged a paragraph into a heading and were left to the host`);
});

test('the differential can fail: a plain swap with no join disagrees with the reference at the end of a file', () => {
  const plain = (): void => {
    for (let seed = 1; seed <= 300; seed++) {
      const { text, gen } = generate(seed);
      const bytes = enc.encode(text);
      const doc = parse(bytes);
      for (let at = 0; at < topHeadings(doc).length; at++) {
        const input = inputFor(doc, bytes, at, 'up');
        const want = reference(text, gen, at, 'up');
        if (input === null || want === null) continue;
        const cut = sectionSwapOf(doc, topHeadings(doc)[at]!, 'up')!.split - input.range.start;
        const naive = input.text.slice(cut) + input.text.slice(0, cut);
        const got = dec.decode(splice(createBuffer('t.md', bytes), input.range, naive).bytes);
        assert.equal(got, want, `seed ${seed}`);
      }
    }
  };
  canFail(plain);
});

// ---- the corpus ------------------------------------------------------------------------------------------------------

function variants(text: string): [string, string][] {
  return [
    ['as is', text],
    ['crlf', crlf(text)],
    ['cr', cr(text)],
    ['bom', text.startsWith('﻿') ? text : withBom(text)],
    ['no final newline', text.replace(/(\r\n|\n|\r)+$/, '')],
    ['mixed', mixedAllEndings(text, 3)],
  ];
}

test('corpus: every section of every fixture moves up and down as a splice inside its two sections, keeps its bytes, and moves back', () => {
  let applied = 0;
  for (const { file, bytes: original } of corpusDocuments()) {
    for (const [label, text] of variants(dec.decode(original))) {
      const bytes = enc.encode(text);
      const buffer = createBuffer(file, bytes);
      const doc = parseMarkdown(bytes, { file });
      const heads = topHeadings(doc);
      for (let at = 0; at < heads.length; at++) {
        for (const direction of ['up', 'down'] as const) {
          const node = heads[at]!;
          const swap = sectionSwapOf(doc, node, direction);
          if (swap === null) continue;
          const where = `${file} [${label}] ${direction} ${node.src.start}`;
          const input = { document: doc, node: node as Node, range: swap.range, text: textOf(buffer, swap.range) };
          assert.ok(OPS[direction].canApply(input), where);
          const { replacement } = OPS[direction].run(input);
          assertLineSeparatorsPreserved(text, replacement);
          // No byte is added or lost: the replacement is a rearrangement of the two sections' bytes.
          assert.equal(enc.encode(replacement).length, swap.range.end - swap.range.start, where);
          assert.deepEqual(checksum(replacement), checksum(input.text), where);
          // Outside the two sections nothing is read or written; and the two sections' own bytes are in it whole, one after the other.
          const second = direction === 'up' ? input.text.slice(swap.split - swap.range.start === 0 ? 0 : textIndexOf(input.text, swap.split - swap.range.start)) : '';
          if (direction === 'up') assert.ok(replacement.startsWith(second), where);
          applied++;
        }
      }
    }
  }
  assert.ok(applied > 100, `${applied} moves were swept over the corpus`);
});

/** Order-free fingerprint of a string's characters: the same characters, rearranged, give the same pair. */
function checksum(s: string): [number, number, number] {
  let sum = 0;
  let squares = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    sum += c;
    squares = (squares + c * c) % 1_000_000_007;
  }
  return [s.length, sum, squares];
}

/** UTF-16 index of a byte offset in `text`. */
function textIndexOf(text: string, byte: number): number {
  return dec.decode(enc.encode(text).subarray(0, byte)).length;
}
