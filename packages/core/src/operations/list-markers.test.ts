// renumber-list, list-to-numbers, list-to-bullets, bullets-from-glyphs (E-08): table rows run in LF, CRLF, CR, no trailing
// newline and BOM; the corpus sweep checks only marker bytes change, idempotence and the inverse.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
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
  list('a multi-line item moves its continuation left by one', '1. a\n   more\n2. b\n', '- a\n  more\n- b\n'),
  list('a nested block moves left with it', '1. a\n   - x\n2. b\n', '- a\n  - x\n- b\n'),
  list('the nested list moves, its own markers stay', '1. a\n2. b\n   1. x\n   2. y\n', '- a\n- b\n  1. x\n  2. y\n'),
  list('10. is three wide: continuation moves by two', '9. a\n10. b\n    more\n', '- a\n- b\n  more\n'),
  list('1) and a wide gap keep the gap', '1)   a\n     more\n', '-   a\n    more\n'),
  list('a loose multi-line item, blank line between paragraphs', '1. a\n\n   more\n\n2. b\n', '- a\n\n  more\n\n- b\n'),
  list('indented code in an item keeps its place under the content', '1. a\n\n       code\n2. b\n', '- a\n\n      code\n- b\n'),
  list('fenced code in an item: fence and content move together', '1. a\n   ```js\n   let x = 1;\n     y\n   ```\n2. b\n', '- a\n  ```js\n  let x = 1;\n    y\n  ```\n- b\n'),
  list('a lazy line is left as written', '1. a\nlazy\n   more\n2. b\n', '- a\nlazy\n  more\n- b\n'),
  list('a task item with a continuation', '1. [ ] a\n   more\n', '- [ ] a\n  more\n'),
  same('a tab in the continuation indent declines', '1. a\n\tmore\n2. b\n', /re-indent a nested item/),
  same('a multi-line item inside a blockquote declines', '> 1. a\n>    more\n> 2. b\n', /re-indent a nested item/),
  same('a multi-line item in a nested list declines', '- x\n  1. a\n     more\n  2. b\n', /re-indent a nested item/, 1),
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

/** The markers, and for list-to-bullets also the leading spaces of every line after the first: a re-indent changes nothing else. */
const spansAndIndents = (doc: Document, node: Node, text: string) => {
  const base = node.src.start;
  const markers = spansOf(doc, node, text);
  const enc = new TextEncoder();
  const out = [...markers];
  let at = 0;
  for (const line of text.split(/(?<=\r\n|\n|\r)(?!\n)/)) {
    const lead = /^ */.exec(line)![0].length;
    const start = base + enc.encode(text.slice(0, at)).length;
    if (at > 0 && lead > 0 && !markers.some((m) => m.start >= start && m.start < start + lead + 1)) out.push({ file: node.src.file, start, end: start + lead });
    at += line.length;
  }
  return out;
};

test('corpus: renumber-list changes only marker bytes, is idempotent', () => {
  const stats = corpusProperties(renumberList, { targets: spansOf, accepts: lists((l) => l.ordered), idempotent: true, sample: 20 });
  assert.ok(stats.applied > 0);
});

test('corpus: list-to-numbers and list-to-bullets change only marker bytes', () => {
  assert.ok(corpusProperties(listToNumbers, { targets: spansOf, accepts: lists((l) => !l.ordered), sample: 0 }).applied > 0);
  assert.ok(corpusProperties(listToBullets, { targets: spansAndIndents, accepts: lists((l) => l.ordered), sample: 0 }).applied > 0);
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

// ---- E-08.1: narrowing re-indents, and the list keeps its structure --------------------------------------------------

/** Node types down the tree, and the text of each code block: what a re-indent must leave alone. A list's kind is what the operation changes. */
function shape(n: Node): unknown {
  const kids = ((n.children ?? []) as readonly Node[]).map(shape);
  if (n.type === 'list') return ['list', (n as List).tight, kids];
  if (n.type === 'codeBlock') return ['codeBlock', (n as unknown as { value: string }).value];
  return [n.type, kids];
}

test('list-to-bullets: every converted corpus list re-parses to the same items, nesting and code, and none is declined for its indent', () => {
  const dir = new URL('../../../../fixtures/corpus/', import.meta.url);
  let converted = 0;
  let reindented = 0;
  let declined = 0;
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.md'))) {
    const source = readFileSync(new URL(f, dir), 'utf8');
    const doc = parseMarkdown(source, { file: f });
    const bytes = Buffer.from(source);
    for (const node of collect(doc, 'list') as List[]) {
      if (!node.ordered || !listToBullets.canApply({ document: doc, node, range: node.src })) continue;
      const text = bytes.subarray(node.src.start, node.src.end).toString();
      const out = listToBullets.run({ document: doc, node, range: node.src, text });
      if (out.summary) {
        declined++;
        const topLevel = doc.children.includes(node as never);
        if (topLevel) assert.match(out.summary, /merge with the list next to it/, `${f}: a top-level list was declined for its indent`);
        continue;
      }
      converted++;
      // Only a top-level list parses on its own; a nested one lost its container's prefix when cut out.
      if (doc.children.includes(node as never) && /[\r\n]/.test(text.replace(/[\r\n]+$/, ''))) {
        const before = parseMarkdown(text, { file: f });
        const after = parseMarkdown(out.replacement, { file: f });
        assert.deepEqual(shape(after), shape(before), `${f}: the list changed shape`);
        const a = (collect(after, 'list')[0] as List).children.length;
        assert.equal(a, node.children.length, `${f}: item count changed`);
        if (out.replacement.length < text.length) reindented++;
      }
    }
  }
  assert.ok(reindented >= 5, `expected the five re-indent cases to convert, got ${reindented}`);
  assert.equal(declined, 8, 'the corpus declines are the merge-with-neighbour ones only');
  assert.ok(converted > 0);
});

test('list-to-bullets: a fenced block in an item keeps its content, and only leading spaces change', () => {
  const source = '1. a\n   ```\n   x\n     y\n\n   z\n   ```\n2. b\n';
  const doc = parseMarkdown(source, { file: 't.md' });
  const node = collect(doc, 'list')[0] as List;
  const out = listToBullets.run({ document: doc, node, range: node.src, text: source }).replacement;
  const code = (d: Document): string => (collect(d, 'codeBlock')[0] as unknown as { value: string }).value;
  assert.equal(code(parseMarkdown(out, { file: 't.md' })), code(doc));
  assert.equal(out.replace(/^ +/gm, ''), source.replace(/^ +/gm, '').replace(/^1\./, '-').replace(/^2\./m, '-'));
});
