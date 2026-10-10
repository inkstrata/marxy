// Structural selection returns the parse's own ranges: block and section in bytes, converted at the seam (V-01).

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { Document, Heading, Node } from '../contracts/ast.ts';
import { byteOffsets } from '../parse/byte-offsets.ts';
import { parseMarkdown } from '../parse/parse.ts';
import { sectionRange } from '../sourcemap/section.ts';
import { expandSelection, selectBlock, selectSection } from './select.ts';

const DOC = [
  '# Title',
  '',
  'First paragraph with café.',
  '',
  '## Part one',
  '',
  '- item a',
  '- item b',
  '',
  '### Deep',
  '',
  'Deep text.',
  '',
  '## Part two',
  '',
  'Last words.',
  '',
].join('\n');

const at = (needle: string, delta = 0): number => DOC.indexOf(needle) + delta;
const caret = (pos: number) => ({ from: pos, to: pos });

function all(node: Node, type: string): Node[] {
  const out: Node[] = node.type === type ? [node] : [];
  for (const child of node.children ?? []) out.push(...all(child, type));
  return out;
}

/** The parse's own byte range for a node, as the UTF-16 range the editor uses. */
function indexRange(src: { start: number; end: number }): { from: number; to: number } {
  const table = byteOffsets(DOC);
  let from = -1;
  let to = -1;
  for (let i = 0; i <= DOC.length; i++) {
    if (table.at(i) === src.start && from === -1) from = i;
    if (table.at(i) === src.end && to === -1) to = i;
  }
  return { from, to };
}

test('select block returns the byte range of the innermost block, converted to indexes', () => {
  const doc: Document = parseMarkdown(DOC);
  const para = all(doc, 'paragraph').find((p) => DOC.slice(indexRange(p.src).from).startsWith('First'))!;
  assert.deepEqual(selectBlock(DOC, caret(at('paragraph'))), indexRange(para.src));
  // The paragraph has a multi-byte letter before its end: a byte range is not an index range there.
  assert.notEqual(para.src.end - para.src.start, indexRange(para.src).to - indexRange(para.src).from);
  // The innermost block: a caret in a list item names the paragraph inside it, a caret on its marker the item.
  const item = all(doc, 'listItem')[0]!;
  assert.deepEqual(selectBlock(DOC, caret(at('- item a'))), indexRange(item.src));
  assert.deepEqual(selectBlock(DOC, caret(at('item a'))), indexRange(all(item, 'paragraph')[0]!.src));
});

test('select block between blocks selects nothing', () => {
  assert.equal(selectBlock(DOC, caret(at('First paragraph', -1))), null);
});

test('select section returns sectionRange over the parse, for every heading', () => {
  const doc = parseMarkdown(DOC);
  for (const heading of all(doc, 'heading') as Heading[]) {
    // A caret on the heading: the innermost section holding it is the heading's own.
    const got = selectSection(DOC, caret(indexRange(heading.src).from));
    assert.deepEqual(got, indexRange(sectionRange(doc, heading)));
  }
});

test('select section: the innermost section holds a caret in its body, and the whole file has none above the first heading', () => {
  const doc = parseMarkdown(DOC);
  const deep = all(doc, 'heading').find((h) => (h as Heading).level === 3) as Heading;
  assert.deepEqual(selectSection(DOC, caret(at('Deep text'))), indexRange(sectionRange(doc, deep)));
  assert.equal(selectSection('no heading here\n\nat all\n', caret(3)), null);
  assert.equal(selectSection(DOC, caret(at('Part one')))!.from, at('## Part one'));
});

test('expand walks word, line, block, section, document and stops at the end', () => {
  const steps: { from: number; to: number }[] = [];
  let sel = caret(at('Deep text') + 2);
  for (let i = 0; i < 12; i++) {
    const next = expandSelection(DOC, sel);
    if (!next) break;
    steps.push(next);
    sel = next;
  }
  const text = steps.map((s) => DOC.slice(s.from, s.to));
  assert.deepEqual(text[0], 'Deep');
  assert.deepEqual(text[1], 'Deep text.');
  // The paragraph is the same range as its line, so the next step is the section of "### Deep".
  assert.deepEqual(text[2], '### Deep\n\nDeep text.\n\n');
  assert.deepEqual(text[3], '## Part one\n\n- item a\n- item b\n\n### Deep\n\nDeep text.\n\n');
  assert.deepEqual(text[4], DOC.slice(0, DOC.length));
  assert.deepEqual(steps.at(-1), { from: 0, to: DOC.length });
  assert.equal(steps.length, 5);
  assert.equal(text[4], DOC);
  assert.equal(expandSelection(DOC, { from: 0, to: DOC.length }), null);
});

test('expand from a selected line moves past the line even when its break is selected', () => {
  const from = at('- item a');
  const next = expandSelection(DOC, { from, to: from + '- item a\n'.length })!;
  assert.equal(DOC.slice(next.from, next.to), '- item a\n- item b');
});

test('in a text that is not Markdown a block is a run of non-blank lines and there are no sections', () => {
  const log = 'a one\nb two\n\nc three\nd four\n\ne\n';
  const c = log.indexOf('c three');
  assert.deepEqual(selectBlock(log, caret(c + 2), 'text'), { from: c, to: log.indexOf('\n\ne') });
  assert.equal(selectSection(log, caret(c), 'text'), null);
  const steps: string[] = [];
  let sel = caret(c + 1);
  for (let n = 0; n < 6; n++) {
    const next = expandSelection(log, sel, 'text');
    if (!next) break;
    steps.push(log.slice(next.from, next.to));
    sel = next;
  }
  assert.deepEqual(steps, ['c', 'c three', 'c three\nd four', log]);
});

test('section ranges equal the parse on corpus files, with multi-byte text in them', () => {
  const dir = new URL('../../../../fixtures/corpus/', import.meta.url);
  for (const name of ['01-long-technical.md', '07-cjk.md', '14-marxy-plan.md']) {
    const text = readFileSync(new URL(name, dir), 'utf8').replace(/\r\n?/g, '\n');
    const doc = parseMarkdown(text);
    const table = byteOffsets(text);
    for (const heading of all(doc, 'heading') as Heading[]) {
      const r = sectionRange(doc, heading);
      // The index of the heading's first byte: the table is monotone, so a scan finds it.
      let i = 0;
      while (table.at(i) < heading.src.start) i++;
      const got = selectSection(text, { from: i, to: i });
      assert.ok(got, `${name} heading at byte ${heading.src.start}`);
      assert.equal(table.at(got.from), r.start, `${name} start`);
      assert.equal(table.at(got.to), r.end, `${name} end`);
    }
  }
});
