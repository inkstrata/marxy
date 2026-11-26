import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { parseMarkdown, type Block, type Document } from '@marxy/core';
import {
  blockLabel,
  childParts,
  citeText,
  cursorSelection,
  edgePart,
  extendHead,
  headingPart,
  intoPart,
  lineSpan,
  outPart,
  partAddress,
  partLabel,
  runLabel,
  stepPart,
} from './cursor.ts';

const parse = (text: string): Document => parseMarkdown(new TextEncoder().encode(text), { file: 't.md' });
const all = (): boolean => true;
const find = (root: Document | Block, type: string, nth = 0): Block => {
  const out: Block[] = [];
  const walk = (n: Document | Block): void => {
    if (n.type === type) out.push(n as Block);
    for (const c of (n.children ?? []) as Block[]) walk(c);
  };
  walk(root);
  return out[nth]!;
};

const DOC = '# One\n\nIntro.\n\n- a\n- b\n  - b1\n- c\n\n> quoted\n>\n> more\n\n## Two\n\nAfter.\n\n# Three\n\nLast.\n';

test('stepPart: siblings at the top level, then out of a list to the part after it', () => {
  const doc = parse(DOC);
  const [h1, intro, list, quote, h2] = doc.children;
  assert.equal(stepPart(doc, h1!, 1, all), intro);
  assert.equal(stepPart(doc, intro!, 1, all), list);
  assert.equal(stepPart(doc, intro!, -1, all), h1);
  const items = list!.children as Block[];
  assert.equal(stepPart(doc, items[0]!, 1, all), items[1]);
  assert.equal(stepPart(doc, items[2]!, 1, all), quote, 'the last item steps on to the part after the list');
  assert.equal(stepPart(doc, items[0]!, -1, all), intro, 'the first item steps back to the part before the list');
  assert.equal(stepPart(doc, quote!, 1, all), h2);
  assert.equal(stepPart(doc, doc.children.at(-1)!, 1, all), null, 'nothing past the end');
  assert.equal(stepPart(doc, h1!, -1, all), null);
});

test('stepPart skips what the caller says cannot hold the cursor', () => {
  const doc = parse(DOC);
  const [h1, intro, list] = doc.children;
  assert.equal(stepPart(doc, h1!, 1, (b) => b !== intro), list);
});

test('intoPart: a list to its first item, a quote to its first block, a section heading to the first part under it', () => {
  const doc = parse(DOC);
  const [h1, intro, list, quote, h2, after, h3, last] = doc.children;
  assert.equal(intoPart(doc, list!, all), (list!.children as Block[])[0]);
  assert.equal(intoPart(doc, quote!, all), (quote!.children as Block[])[0]);
  assert.equal(intoPart(doc, h1!, all), intro);
  assert.equal(intoPart(doc, h2!, all), after);
  assert.equal(intoPart(doc, h3!, all), last);
  assert.equal(intoPart(doc, intro!, all), null, 'a paragraph has nothing inside');
  const empty = parse('# A\n\n# B\n');
  assert.equal(intoPart(empty, empty.children[0]!, all), null, 'a section with nothing under its heading');
});

test('childParts: a tight item is its own text; its nested list is a part', () => {
  const doc = parse(DOC);
  const b = find(doc, 'listItem', 1);
  assert.deepEqual(childParts(doc, b).map((x) => x.type), ['list']);
  assert.deepEqual(childParts(doc, find(doc, 'listItem', 0)), []);
  const loose = parse('- one\n\n  more\n\n- two\n');
  assert.deepEqual(childParts(loose, find(loose, 'listItem', 0)).map((x) => x.type), ['paragraph', 'paragraph']);
  assert.deepEqual(childParts(doc, find(doc, 'paragraph')), []);
});

test('outPart: to the holder, then to the heading whose section holds it', () => {
  const doc = parse(DOC);
  const [h1, intro, list, , h2, after, h3] = doc.children;
  const item = (list!.children as Block[])[1]!;
  const nested = find(doc, 'listItem', 2);
  assert.equal(outPart(doc, nested, all), find(doc, 'list', 1));
  assert.equal(outPart(doc, item, all), list);
  assert.equal(outPart(doc, intro!, all), h1);
  assert.equal(outPart(doc, after!, all), h2);
  assert.equal(outPart(doc, h2!, all), h1, 'a heading goes to the heading a level above');
  assert.equal(outPart(doc, h3!, all), null, 'a first-level heading has none above');
  assert.equal(outPart(doc, h1!, all), null);
});

test('headingPart and edgePart', () => {
  const doc = parse(DOC);
  const [h1, intro, , , h2, , h3, last] = doc.children;
  assert.equal(headingPart(doc, intro!.src.start, 1, all), h2);
  assert.equal(headingPart(doc, h2!.src.start, 1, all), h3);
  assert.equal(headingPart(doc, h3!.src.start, 1, all), null);
  assert.equal(headingPart(doc, h2!.src.start, -1, all), h1);
  assert.equal(headingPart(doc, h1!.src.start, -1, all), null);
  assert.equal(edgePart(doc, 'first', all), h1);
  assert.equal(edgePart(doc, 'last', all), last);
});

test('extendHead: the free end moves, toward and past the anchor, inside one container', () => {
  const doc = parse('a\n\nb\n\nc\n\nd\n');
  const [a, b, c, d] = doc.children;
  assert.equal(extendHead(doc, b!, b!, 1, all), c);
  assert.equal(extendHead(doc, b!, c!, 1, all), d);
  assert.equal(extendHead(doc, b!, d!, 1, all), null);
  assert.equal(extendHead(doc, b!, c!, -1, all), b, 'shrinks back to the anchor');
  assert.equal(extendHead(doc, b!, b!, -1, all), a);
  const list = parse('- x\n- y\n');
  const [x] = find(list, 'list').children as Block[];
  assert.equal(extendHead(list, x!, x!, -1, all), null, 'never out of its list');
});

test('cursorSelection: a top-level heading is its section; anything else is the block', () => {
  const doc = parse(DOC);
  const h1 = doc.children[0]!;
  const sel = cursorSelection(doc, h1, null as unknown as Element);
  assert.equal(sel.kind, 'section');
  assert.equal(sel.kind === 'section' && sel.range.end, doc.children[6]!.src.start);
  assert.equal(cursorSelection(doc, doc.children[1]!, null as unknown as Element).kind, 'node');
});

test('labels: plain words, with what tells a part apart', () => {
  const doc = parse('# Title *here*\n\npara\n\n- [ ] task\n- two\n\n```ts\nx\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n\n> q\n\n---\n\n### Deep\n');
  const [h1, p, list, code, table, quote, rule, h3] = doc.children;
  assert.equal(partLabel(cursorSelection(doc, h1!, null as unknown as Element)), '§ Title here');
  assert.equal(blockLabel(p!), 'paragraph');
  assert.equal(blockLabel(list!), 'list of 2');
  assert.equal(blockLabel((list!.children as Block[])[0]!), 'task');
  assert.equal(blockLabel((list!.children as Block[])[1]!), 'item');
  assert.equal(blockLabel(code!), 'code (ts)');
  assert.equal(blockLabel(table!), 'table of 2 rows');
  assert.equal(blockLabel(quote!), 'quote');
  assert.equal(blockLabel(rule!), 'rule');
  assert.equal(blockLabel(h3!), 'heading 3');
  assert.equal(runLabel(3), '3 parts');
  assert.equal(partLabel({ kind: 'node', node: find(doc, 'emphasis'), el: null as unknown as Element }), 'emphasis');
  assert.equal(partLabel({ kind: 'none' }), null);
});

test('lineSpan: 1-based lines over LF, CRLF and a lone CR; a trailing break does not reach the next line', () => {
  const lf = new TextEncoder().encode('one\ntwo\nthree\n\nfour\n');
  assert.deepEqual(lineSpan(lf, 0, 3), { first: 1, last: 1 });
  assert.deepEqual(lineSpan(lf, 4, 13), { first: 2, last: 3 });
  assert.deepEqual(lineSpan(lf, 4, 15), { first: 2, last: 3 }, 'the blank line after is not counted');
  assert.deepEqual(lineSpan(lf, 15, 19), { first: 5, last: 5 });
  const crlf = new TextEncoder().encode('one\r\ntwo\r\nthree');
  assert.deepEqual(lineSpan(crlf, 5, 15), { first: 2, last: 3 });
  const cr = new TextEncoder().encode('a\rb\rc');
  assert.deepEqual(lineSpan(cr, 2, 5), { first: 2, last: 3 });
  assert.deepEqual(lineSpan(lf, 3, 3), { first: 1, last: 1 }, 'an empty range is its line');
});

test('partAddress and citeText: the prototype\'s forms', () => {
  assert.equal(partAddress('plan.md', { first: 12, last: 12 }), 'plan.md:12');
  assert.equal(partAddress('plan.md', { first: 12, last: 18 }), 'plan.md:12–18');
  assert.equal(citeText('one\r\ntwo', '/r/plan.md', { first: 3, last: 4 }), '> one\n> two\n\n— `/r/plan.md:3-4`\n');
  assert.equal(citeText('solo', '/r/a.md', { first: 9, last: 9 }), '> solo\n\n— `/r/a.md:9`\n');
});
