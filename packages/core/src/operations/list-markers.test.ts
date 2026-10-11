// renumber-list, list-to-numbers, list-to-bullets, bullets-from-glyphs (E-08): table rows run in LF, CRLF, CR, no trailing
// newline and BOM; the corpus sweep checks only marker bytes change, idempotence and the inverse.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { Document, List, Node, Paragraph } from '../contracts/ast.ts';
import type { Operation } from '../contracts/operation.ts';
import { parseMarkdown } from '../parse/parse.ts';
import { bulletsFromGlyphs, listToBullets, listToNumbers, markerSpans, mergesWithNeighbour, renumberList } from './list-markers.ts';
import { corpusProperties, tableTest, type Row } from './testing/test-kit.ts';

function collect(n: Node, type: string, out: Node[] = []): Node[] {
  if (n.type === type) out.push(n);
  for (const c of n.children ?? []) collect(c as Node, type, out);
  return out;
}
const nth = (type: string, i: number) => (doc: Document): Node => collect(doc, type)[i]!;
const row = (type: string, name: string, source: string, expect: string, at = 0, summary?: RegExp): Row => ({
  name, source, expect, pick: nth(type, at), ...(summary ? { summary } : {}),
});
const list = (name: string, source: string, expect: string, at = 0, summary?: RegExp): Row => row('list', name, source, expect, at, summary);
const same = (name: string, source: string, summary: RegExp, at = 0): Row => list(name, source, source, at, summary);

const nine = (n: number, tail = ''): string => Array.from({ length: n }, (_, i) => `${i + 1}. item${i + 1}${tail}`).join('\n') + '\n';
const ten = (from: number, n: number): string => Array.from({ length: n }, (_, i) => `${from + i}. item`).join('\n') + '\n';

tableTest(renumberList, [
  list('1. 1. 1. becomes 1. 2. 3.', '1. a\n1. b\n1. c\n', '1. a\n2. b\n3. c\n'),
  list('a list starting at 4 keeps its start', '4. a\n1. b\n2. c\n', '4. a\n5. b\n6. c\n'),
  list('the 1) delimiter is kept', '1) a\n1) b\n1) c\n', '1) a\n2) b\n3) c\n'),
  list('a start of 0 is kept', '0. a\n0. b\n', '0. a\n1. b\n'),
  list('an already correct list is unchanged', '1. a\n2. b\n3. c\n', '1. a\n2. b\n3. c\n'),
  list('a nested bullet list under item 2 is untouched', '1. a\n1. b\n   - x\n   - y\n1. c\n', '1. a\n2. b\n   - x\n   - y\n3. c\n'),
  list('a nested ordered list is not renumbered (selecting the outer)', '1. a\n1. b\n   1. x\n   1. y\n', '1. a\n2. b\n   1. x\n   1. y\n'),
  list('selecting the nested list renumbers only it', '1. a\n1. b\n   1. x\n   1. y\n', '1. a\n1. b\n   1. x\n   2. y\n', 1),
  list('a lazy continuation line is untouched', '1. a\nlazy\n1. b\n', '1. a\nlazy\n2. b\n'),
  list('a multi-line item keeps its width and its indent', '1. a\n   more\n1. b\n   more\n', '1. a\n   more\n2. b\n   more\n'),
  list('a loose list stays loose', '1. a\n\n1. b\n\n1. c\n', '1. a\n\n2. b\n\n3. c\n'),
  list('a task list stays a task list', '1. [ ] a\n1. [x] b\n', '1. [ ] a\n2. [x] b\n'),
  list('spaces after the marker are kept', '1.   a\n1.   b\n', '1.   a\n2.   b\n'),
  list('zero padding is kept', '01. a\n01. b\n01. c\n', '01. a\n02. b\n03. c\n'),
  list('an indented list keeps its indent', '  1. a\n  1. b\n', '  1. a\n  2. b\n'),
  list('a list in a blockquote', '> 1. a\n> 1. b\n', '> 1. a\n> 2. b\n'),
  list('a list after a code block (the 4. that restarts)', '```\nx\n```\n\n4. a\n1. b\n', '```\nx\n```\n\n4. a\n5. b\n'),
  list('8 to 9 does not widen', '8. a\n8. b\n', '8. a\n9. b\n'),
  list('9 to 10 widens single-line items', '9. a\n9. b\n9. c\n', '9. a\n10. b\n11. c\n'),
  list('nine items of 1. widen the tenth', nine(9) + '1. item10\n', nine(9) + '10. item10\n'),
  list('10 to 9 narrows single-line items', '9. a\n10. b\n', '9. a\n10. b\n'),
  list('9 to 10 declines when the widened item has a nested block', '9. a\n9. b\n   - x\n', '9. a\n9. b\n   - x\n', 0, /re-indent a nested item/),
  same('9 to 10 declines when the widened item has a continuation line', '9. a\n9. b\n   more\n', /re-indent a nested item/),
  same('9 to 10 declines when the widened item has a lazy line', '9. a\n9. b\nlazy\n', /re-indent a nested item/),
  list('a nested block under an item that keeps its width is fine', '9. a\n   - x\n9. b\n', '9. a\n   - x\n10. b\n'),
  same('a narrowing item with a nested block declines', '1. a\n10. b\n    - x\n', /re-indent a nested item/),
  same('more than nine digits is refused', '999999999. a\n1. b\n', /longer than CommonMark allows/),
], { bom: true });

tableTest(listToNumbers, [
  list('bullets to numbers', '- a\n- b\n- c\n', '1. a\n2. b\n3. c\n'),
  list('+ and * bullets', '* a\n* b\n', '1. a\n2. b\n'),
  list('a task list stays a task list', '- [ ] a\n- [x] b\n', '1. [ ] a\n2. [x] b\n'),
  list('a loose list stays loose', '- a\n\n- b\n', '1. a\n\n2. b\n'),
  list('the nested list is not converted', '- a\n  - x\n  - y\n', '- a\n  - x\n  - y\n', 0, /re-indent a nested item/),
  list('the nested list alone converts', '- a\n  - x\n  - y\n', '- a\n  1. x\n  2. y\n', 1),
  same('a multi-line item declines', '- a\n  more\n- b\n', /re-indent a nested item/),
  same('a lazy line declines', '- a\nlazy\n- b\n', /re-indent a nested item/),
  list('ten bullets: the tenth marker widens', Array.from({ length: 10 }, () => '- x').join('\n') + '\n', ten(1, 10).replace(/item/g, 'x')),
  same('would merge with an ordered list next to it', '1. a\n\n- b\n- c\n', /merge with the list next to it/, 1),
  list('a list in a blockquote', '> - a\n> - b\n', '> 1. a\n> 2. b\n'),
], { bom: true });

tableTest(listToBullets, [
  list('numbers to bullets', '1. a\n2. b\n3. c\n', '- a\n- b\n- c\n'),
  list('the 1) delimiter goes too', '1) a\n2) b\n', '- a\n- b\n'),
  list('a start of 4 goes too', '4. a\n5. b\n', '- a\n- b\n'),
  list('a task list stays a task list', '1. [ ] a\n2. [x] b\n', '- [ ] a\n- [x] b\n'),
  list('a loose list stays loose', '1. a\n\n2. b\n', '- a\n\n- b\n'),
  same('a multi-line item declines', '1. a\n   more\n2. b\n', /re-indent a nested item/),
  same('a nested block declines', '1. a\n   - x\n2. b\n', /re-indent a nested item/),
  list('the nested list is left alone', '1. a\n2. b\n   1. x\n   2. y\n', '1. a\n2. b\n   1. x\n   2. y\n', 0, /re-indent a nested item/),
  same('would merge with a bullet list next to it', '- a\n\n1. b\n2. c\n', /merge with the list next to it/, 1),
  list('a list in a blockquote', '> 1. a\n> 2. b\n', '> - a\n> - b\n'),
], { bom: true });

const para = (name: string, source: string, expect: string, summary?: RegExp): Row => row('paragraph', name, source, expect, 0, summary);

tableTest(bulletsFromGlyphs, [
  para('two bullets', '• a\n• b\n', '- a\n- b\n'),
  para('mixed glyphs, as chat tools emit', '• a\n– b\n— c\n· d\n', '- a\n- b\n- c\n- d\n'),
  para('inline markup after the glyph', '• **a** and `b`\n• [c](d)\n', '- **a** and `b`\n- [c](d)\n'),
  para('a CJK line behind the glyph', '• 日本語\n• テキスト\n', '- 日本語\n- テキスト\n'),
  para('more than one space after the glyph', '•  a\n•   b\n', '-  a\n-   b\n'),
], { bom: true });

const refuses = (name: string, source: string): void => {
  test(`bullets-from-glyphs: ${name} is not offered`, () => {
    const doc = parseMarkdown(source, { file: 't.md' });
    const p = collect(doc, 'paragraph')[0] as Paragraph;
    assert.equal(bulletsFromGlyphs.canApply({ document: doc, node: p, range: p.src }), false);
  });
};
refuses('a paragraph where only some lines have a glyph', '• a\nb\n• c\n');
refuses('a single glyph line', '• a\n');
refuses('a glyph with no space', '•a\n•b\n');
refuses('a hyphen paragraph (already a list)', '- a\n- b\n'.replace('- a', 'x'));
refuses('a line starting with an unlisted glyph', '• a\n* b\n');

test('bullets-from-glyphs: a blockquoted glyph paragraph is declined by run, with a summary', () => {
  const source = '> • a\n> • b\n';
  const doc = parseMarkdown(source, { file: 't.md' });
  const p = collect(doc, 'paragraph')[0] as Paragraph;
  if (!bulletsFromGlyphs.canApply({ document: doc, node: p, range: p.src })) return;
  const out = bulletsFromGlyphs.run({ document: doc, node: p, range: p.src, text: new TextDecoder().decode(new TextEncoder().encode(source).subarray(p.src.start, p.src.end)) });
  assert.match(out.summary ?? '', /Not changed/);
});

test('the glyph paragraph of 28-llm-answer.md becomes five - items and re-parses as one list of five items', () => {
  const file = new URL('../../../../fixtures/corpus/28-llm-answer.md', import.meta.url);
  const source = readFileSync(file, 'utf8');
  const doc = parseMarkdown(source, { file: '28-llm-answer.md' });
  const paragraphs = collect(doc, 'paragraph') as Paragraph[];
  const target = paragraphs.find((p) => bulletsFromGlyphs.canApply({ document: doc, node: p, range: p.src }))!;
  assert.ok(target, 'the glyph paragraph is offered');
  const bytes = new TextEncoder().encode(source);
  const text = new TextDecoder().decode(bytes.subarray(target.src.start, target.src.end));
  const { replacement } = bulletsFromGlyphs.run({ document: doc, node: target, range: target.src, text });
  assert.equal(replacement.split('\n').length, 5);
  assert.ok(replacement.split('\n').every((l) => l.startsWith('- ')));
  const after = new TextDecoder().decode(bytes.subarray(0, target.src.start)) + replacement + new TextDecoder().decode(bytes.subarray(target.src.end));
  const reparsed = parseMarkdown(after, { file: '28-llm-answer.md' });
  const lists = collect(reparsed, 'list') as List[];
  const made = lists.find((l) => l.src.start === target.src.start)!;
  assert.ok(made && !made.ordered);
  assert.equal(made.children.length, 5);
  // Exactly the five glyphs changed; nothing else did.
  assert.equal(new TextEncoder().encode(after).length, bytes.length - 5 * 2);
});

test('the corpus has the three shapes the card names: 1. 1. 1., a restarting 4., and the glyph block', () => {
  const doc = parseMarkdown(readFileSync(new URL('../../../../fixtures/corpus/28-llm-answer.md', import.meta.url), 'utf8'), { file: '28.md' });
  const lists = collect(doc, 'list') as List[];
  assert.ok(lists.some((l) => l.ordered && l.start === 4));
  assert.ok(lists.some((l) => l.ordered && l.start === 1 && l.children.length >= 3));
});

test('markerSpans: the marker bytes, number and delimiter, without the spaces after', () => {
  const source = '4)   a\n5)   b\n';
  const doc = parseMarkdown(source, { file: 't.md' });
  const l = collect(doc, 'list')[0] as List;
  const spans = markerSpans(l, source, l.src.start)!;
  assert.deepEqual(spans.map((s) => [s.marker.start, s.marker.end, s.number, s.delimiter]), [[0, 2, 4, ')'], [7, 9, 5, ')']]);
  assert.equal(markerSpans({ ...l, children: [{ ...l.children[0]!, src: { ...l.children[0]!.src, start: 2 } }] }, source, 0), undefined);
});

// ---- corpus -------------------------------------------------------------------------------------------------------

const lists = (accepts: (l: List) => boolean) => (n: Node): boolean => n.type === 'list' && accepts(n as List);
const spansOf = (doc: Document, node: Node, text: string) => markerSpans(node as List, text, node.src.start)!.map((s) => s.marker);

test('corpus: renumber-list changes only marker bytes, is idempotent', () => {
  const stats = corpusProperties(renumberList, { targets: spansOf, accepts: lists((l) => l.ordered), idempotent: true, sample: 20 });
  assert.ok(stats.applied > 0);
});

test('corpus: list-to-numbers and list-to-bullets change only marker bytes', () => {
  assert.ok(corpusProperties(listToNumbers, { targets: spansOf, accepts: lists((l) => !l.ordered), sample: 0 }).applied > 0);
  assert.ok(corpusProperties(listToBullets, { targets: spansOf, accepts: lists((l) => l.ordered), sample: 0 }).applied > 0);
});

/** `listToNumbers` as the round trip may use it: only a list of `-` bullets, and only when it applied (a `*` list is declined, so its inverse is skipped). */
const dashOnly: Operation = {
  ...listToNumbers,
  run(input) {
    const spans = markerSpans(input.node as List, input.text, input.range.start)!;
    const dashes = spans.every((s) => input.text[s.marker.start - input.range.start] === '-');
    // A bullet list beside it would make the inverse decline (it cannot tell a `*` list from a `-` one), so that is a no-op round trip too.
    return dashes && !mergesWithNeighbour(input.document, input.node as List, false) ? listToNumbers.run(input) : { replacement: input.text };
  },
};

test('corpus: list-to-bullets undoes list-to-numbers for lists of - bullets with single-line items', () => {
  const stats = corpusProperties(dashOnly, { targets: spansOf, accepts: lists((l) => !l.ordered), inverse: listToBullets, sample: 10 });
  assert.ok(stats.applied > 0);
});
