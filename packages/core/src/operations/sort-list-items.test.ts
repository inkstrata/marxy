// sort-list-items (E-09): table rows in LF, CRLF, CR, no trailing newline and BOM; permutation, idempotence and minimal diff over the corpus.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Document, List, Node, Source } from '../contracts/ast.ts';
import { parseMarkdown } from '../parse/parse.ts';
import { itemSpans, sortListItems } from './sort-list-items.ts';
import { corpusProperties, tableTest, type Row } from './testing/test-kit.ts';

function all(n: Node, out: Node[] = []): Node[] {
  out.push(n);
  for (const c of n.children ?? []) all(c as Node, out);
  return out;
}
const listAt = (i: number) => (doc: Document): Node => all(doc).filter((n) => n.type === 'list')[i]!;
const row = (name: string, source: string, expect: string, at = 0, summary?: RegExp): Row => ({ name, source, expect, pick: listAt(at), ...(summary ? { summary } : {}) });
const S = /Sorted \d+ items/;

tableTest(
  sortListItems,
  [
    row('tight bullets', '- pear\n- apple\n- fig\n', '- apple\n- fig\n- pear\n', 0, /Sorted 3 items/),
    row('an ordered list keeps 1. 2. 3. in place', '1. pear\n2. apple\n3. fig\n', '1. apple\n2. fig\n3. pear\n', 0, S),
    row('task state travels with its item', '- [x] pear\n- [ ] apple\n- [x] fig\n', '- [ ] apple\n- [x] fig\n- [x] pear\n', 0, S),
    row('nested lists and continuation lines travel', '- b\n  more b\n  - b1\n  - b0\n- a\n  more a\n', '- a\n  more a\n- b\n  more b\n  - b1\n  - b0\n', 0, S),
    row('a nested list is left as written', '- b\n  - y\n  - x\n- a\n', '- a\n- b\n  - y\n  - x\n', 0, S),
    row('a loose list keeps its blank lines in place', '- b\n\n- a\n\n\n- c\n', '- a\n\n- b\n\n\n- c\n', 0, S),
    row('a loose item with two paragraphs', '- b\n\n  para\n\n- a\n', '- a\n\n- b\n\n  para\n', 0, S),
    row('equal keys keep their order', '- B\n- a\n- b\n- B\n', '- a\n- B\n- b\n- B\n', 0, S),
    row('item 2 before item 10', '- item 10\n- item 2\n- item 1\n', '- item 1\n- item 2\n- item 10\n', 0, S),
    row('accents and case do not outrank letters', '- zebra\n- Éclair\n- apple\n', '- apple\n- Éclair\n- zebra\n', 0, S),
    row('emoji and CJK items', '- 猫\n- 🙂 smile\n- apple\n- 犬\n', '- 🙂 smile\n- apple\n- 犬\n- 猫\n', 0, S),
    row('an empty item with a space after its marker sorts first', '- b\n- \n- a\n', '- \n- a\n- b\n', 0, S),
    row('a bare marker cannot take text: declines', '- b\n-\n- a\n', '- b\n-\n- a\n', 0, /Not changed: sorting would/),
    row('one item is not offered', '- only\n', '- only\n'),
    row('already sorted changes nothing', '- a\n- b\n- c\n', '- a\n- b\n- c\n'),
    row('a list among other blocks', '# T\n\n- b\n- a\n\ntext\n', '# T\n\n- a\n- b\n\ntext\n'),
    row('a list in a blockquote', '> - b\n> - a\n', '> - a\n> - b\n', 0, S),
    row('a nested list can itself be selected', '- x\n  - b\n  - a\n', '- x\n  - a\n  - b\n', 1, S),
    row('9 and 10 swap when their items are one line', '9. b\n10. a\n', '9. a\n10. b\n', 0, S),
    row('9 and 10 decline when a moved item spans lines', '9. b\n   more\n10. a\n', '9. b\n   more\n10. a\n', 0, /Not changed: sorting would re-indent a/),
    row('code and quotes inside items travel', '- b\n  ```\n  x\n  ```\n- a\n  > q\n', '- a\n  > q\n- b\n  ```\n  x\n  ```\n', 0, S),
  ],
  { bom: true },
);

test('a mixed-ending list stays a permutation: each separator keeps its own bytes', () => {
  const source = '- c\r\n- b\n- a\r- z\n';
  const doc = parseMarkdown(source, { file: 't.md' });
  const list = doc.children[0]!;
  const { replacement } = sortListItems.run({ document: doc, node: list, range: list.src, text: source.slice(list.src.start, list.src.end) });
  assert.equal(replacement, '- a\r\n- b\n- c\r- z');
});

test('a moved last item neither gains nor loses a newline at the end of the file', () => {
  for (const eof of ['', '\n', '\r\n']) {
    const source = `- b\n- a${eof}`;
    const doc = parseMarkdown(source, { file: 't.md' });
    const list = doc.children[0]!;
    const text = source.slice(list.src.start, list.src.end);
    const { replacement } = sortListItems.run({ document: doc, node: list, range: list.src, text });
    assert.equal(source.slice(0, list.src.start) + replacement + source.slice(list.src.end), `- a\n- b${eof}`);
  }
});

test('canApply: a list of two or more at its own range; not one item, a part range, a missing node or the document', () => {
  const doc = parseMarkdown('- b\n- a\n\n- only\n', { file: 't.md' });
  const two = doc.children[0]!;
  assert.equal(sortListItems.canApply({ document: doc, node: two, range: two.src }), true);
  assert.equal(sortListItems.canApply({ document: doc, node: two, range: { ...two.src, end: two.src.end - 1 } }), false);
  assert.equal(sortListItems.canApply({ document: doc, node: doc, range: doc.src }), false);
  assert.equal(sortListItems.canApply({ document: doc, range: two.src }), false);
  const one = parseMarkdown('- only\n', { file: 't.md' }).children[0]!;
  assert.equal(sortListItems.canApply({ document: doc, node: one, range: one.src }), false);
  assert.deepEqual(sortListItems.appliesTo, ['block']);
});

test('sorting agrees with the fixed locale, not the reader\'s', () => {
  const doc = parseMarkdown('- b\n- 10\n- 2\n- a\n', { file: 't.md' });
  const list = doc.children[0]!;
  const text = '- b\n- 10\n- 2\n- a';
  assert.equal(sortListItems.run({ document: doc, node: list, range: list.src, text }).replacement, '- 2\n- 10\n- a\n- b');
});

const dec = new TextDecoder('utf-8', { ignoreBOM: true });
const enc = new TextEncoder();

test('the sorted list re-parses with the same items and descendants, and its contents are a permutation', () => {
  const source = '- b\n  - b1\n  - b2\n    - deep\n  tail\n\n- a\n  - a1\n\n- [x] c\n  ```js\n  x\n  ```\n';
  const doc = parseMarkdown(source, { file: 't.md' });
  const list = doc.children[0] as List;
  const text = source.slice(list.src.start, list.src.end);
  const { replacement } = sortListItems.run({ document: doc, node: list, range: list.src, text });
  assert.notEqual(replacement, text);
  const after = parseMarkdown(source.slice(0, list.src.start) + replacement + source.slice(list.src.end), { file: 't.md' });
  const l2 = after.children[0] as List;
  assert.equal(l2.children.length, list.children.length);
  assert.equal(all(l2).length, all(list).length);
  const contents = (l: List, t: string) => itemSpans(l, l.src, t)!.map((s) => t.slice(s.content.start, s.content.end)).sort();
  assert.deepEqual(contents(l2, replacement), contents(list, text));
});

corpusProperties(sortListItems, {
  accepts: (n) => n.type === 'list',
  idempotent: true,
  sample: 40,
  // The contents of the items: the only bytes that move.
  targets(_doc, node, text) {
    const list = node as List;
    return itemSpans(list, node.src, text)!.map((s): Source => ({
      file: node.src.file,
      start: node.src.start + enc.encode(text.slice(0, s.content.start)).length,
      end: node.src.start + enc.encode(text.slice(0, s.content.end)).length,
    }));
  },
});

test('corpus: the contents of every sorted list are a permutation of the originals', async () => {
  const { corpusDocuments } = await import('./testing/corpus.ts');
  let lists = 0;
  for (const { file, bytes } of corpusDocuments()) {
    const doc = parseMarkdown(bytes, { file });
    for (const node of all(doc).filter((n) => n.type === 'list')) {
      if (!sortListItems.canApply({ document: doc, node, range: node.src })) continue;
      const text = dec.decode(bytes.subarray(node.src.start, node.src.end));
      const { replacement } = sortListItems.run({ document: doc, node, range: node.src, text });
      const spans = itemSpans(node as List, node.src, text)!;
      const before = spans.map((s) => text.slice(s.content.start, s.content.end)).sort();
      const afterDoc = parseMarkdown(replacement, { file });
      const l2 = afterDoc.children[0] as List | undefined;
      if (replacement !== text && l2?.type === 'list' && l2.children.length === spans.length) {
        const after = itemSpans(l2, l2.src, replacement)!.map((s) => replacement.slice(s.content.start, s.content.end)).sort();
        assert.deepEqual(after, before, `${file} @ ${node.src.start}`);
      }
      assert.equal(replacement.length, text.length, `${file} @ ${node.src.start}: a permutation keeps the length`);
      lists++;
    }
  }
  assert.ok(lists > 0);
});
