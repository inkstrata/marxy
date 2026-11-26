import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { parseMarkdown, type Document, type Heading } from '@marxy/core';
import type { Transition } from '../document/store.ts';
import { foldAllHeadings, foldCount, foldedBlocks, headingAt, mapRange, sectionOf } from './depth-maths.ts';
import { revealMarks } from './reveal-marks.ts';
import { endGlyph, endingsOf, xrayLines, xrayPieces } from './xray-lines.ts';
import { cpuNow } from '../testing/cpu-clock.ts';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const parse = (text: string): Document => parseMarkdown(enc(text), { file: 't.md' });

test('x-ray widens a range to whole lines and numbers them from the file', () => {
  const text = 'one\ntwo three\nfour\n';
  const bytes = enc(text);
  const x = xrayLines(bytes, text.indexOf('three'), text.indexOf('four') + 2);
  assert.deepEqual(x.lines.map((l) => [l.number, l.text, l.end]), [[2, 'two three', '\n'], [3, 'four', '\n']]);
  assert.equal(x.showEnds, false, 'LF only: endings are not drawn');
  assert.equal(x.noFinalNewline, false);
});

test('x-ray says CRLF and mixed endings, and a missing final newline', () => {
  const bytes = enc('a\r\nb\nc');
  const x = xrayLines(bytes, 0, bytes.length);
  assert.deepEqual(x.lines.map((l) => [l.number, l.text, l.end]), [[1, 'a', '\r\n'], [2, 'b', '\n'], [3, 'c', '']]);
  assert.equal(x.showEnds, true);
  assert.equal(x.noFinalNewline, true);
  assert.deepEqual([...endingsOf(enc('a\rb'))], ['\r']);
  assert.deepEqual(['\r\n', '\r', '\n', ''].map((e) => endGlyph(e as '\n')), ['␍¬', '␍', '¬', '']);
});

test('x-ray of a range ending in its line break stays on its own lines', () => {
  const text = '# H\n\npara\n\nnext\n';
  const bytes = enc(text);
  const x = xrayLines(bytes, text.indexOf('para'), text.indexOf('next'));
  assert.deepEqual(x.lines.map((l) => l.number), [3]);
});

test('x-ray pieces mark tabs anywhere and spaces only at the end of a line', () => {
  assert.deepEqual(xrayPieces('a b\tc  '), [
    { kind: 'text', value: 'a b' }, { kind: 'tab' }, { kind: 'text', value: 'c' }, { kind: 'trailing-space' }, { kind: 'trailing-space' },
  ]);
  assert.deepEqual(xrayPieces('plain'), [{ kind: 'text', value: 'plain' }]);
});

test('reveal reads the markup each node left out from its byte range', () => {
  const text = '# Head *em* ##\n\nSetext\n===\n\n> quote a\n>\n> two\n\n- [ ] task `co de` **b**\n1. one [l](http://x "t") <http://y> ~~s~~\n\n```js\nx\n```\n\n***\n\n![alt](i.png)\n';
  const marks = revealMarks(parse(text), enc(text)).map((m) => `${m.type}:${m.place}:${m.text}`);
  assert.deepEqual(marks, [
    'heading:open:# ', 'emphasis:before:*', 'emphasis:after:*', 'heading:close: ##',
    'heading:line-after:===',
    'paragraph:open:> ', 'paragraph:open:> ',
    'listItem:hang:- ', 'taskMarker:before:[ ]', 'code:before:`', 'code:after:`', 'strong:before:**', 'strong:after:**',
    'listItem:hang:1. ', 'link:before:[', 'link:after:](http://x "t")', 'link:before:<', 'link:after:>', 'strikethrough:before:~~', 'strikethrough:after:~~',
    'codeBlock:line-before:```js', 'codeBlock:line-after:```',
    'thematicBreak:line-before:***',
    'image:before:![alt](i.png)',
  ]);
});

test('reveal puts back front matter fences and a top-level comment, and leaves a table unmarked', () => {
  const text = '---\ntitle: T\n---\n\n# H\n\n<!-- kept out -->\n\n| a | b |\n|---|---|\n| 1 | 2 |\n';
  const marks = revealMarks(parse(text), enc(text)).map((m) => `${m.type}:${m.place}:${m.text}`);
  assert.deepEqual(marks, ['frontmatter:line-before:---', 'frontmatter:line-after:---', 'heading:open:# ', 'htmlBlock:gap:<!-- kept out -->']);
});

test('folds: the section a part is in, what it hides, and what Z folds', () => {
  const doc = parse('# Title\n\nintro\n\n## A\n\na1\n\na2\n\n### A.1\n\ndeep\n\n## B\n\nb1\n\n## Empty\n');
  const a = doc.children.find((b) => b.type === 'heading' && b.level === 2) as Heading;
  assert.equal(headingAt(doc, a.src), a);
  assert.equal(foldedBlocks(doc, a).length, 4, 'a1, a2, the sub-heading and its paragraph');
  const deep = doc.children.filter((b) => b.type === 'paragraph')[3]!;
  assert.equal((sectionOf(doc, deep) as Heading).level, 3, 'the innermost section');
  assert.deepEqual(foldAllHeadings(doc).map((h) => h.level), [2, 2], 'the second level under one title, only those holding something');
  const flat = parse('## A\n\na\n\n## B\n\nb\n');
  assert.deepEqual(foldAllHeadings(flat).map((h) => h.level), [2, 2], 'no single title: the shallowest level');
  assert.equal(foldCount(1, 3), '1 part, 3 lines');
});

test('a part range follows an edit, and is gone when the edit took it', () => {
  const edit = (start: number, before: number, after: number): Transition => ({
    kind: 'apply',
    edit: { range: { file: 't', start, end: start + before }, before: new Uint8Array(before), after: new Uint8Array(after), label: '' },
  });
  const r = { start: 10, end: 20 };
  assert.deepEqual(mapRange(edit(0, 2, 5), r), { start: 13, end: 23 }, 'an edit before moves it');
  assert.deepEqual(mapRange(edit(25, 2, 5), r), r, 'an edit after leaves it');
  assert.deepEqual(mapRange(edit(12, 2, 5), r), { start: 10, end: 23 }, 'an edit inside moves its end');
  assert.deepEqual(mapRange(edit(10, 10, 4), r), { start: 10, end: 14 }, 'the part replaced whole is the new bytes');
  assert.equal(mapRange(edit(10, 10, 0), r), null, 'the part deleted');
  assert.equal(mapRange(edit(5, 10, 0), r), null, 'its start taken away from before');
  assert.equal(mapRange({ kind: 'reload' }, r), null, 'a reload with no bytes to map through drops it');
  const undo: Transition = { kind: 'undo', edit: { range: { file: 't', start: 0, end: 2 }, before: new Uint8Array(2), after: new Uint8Array(5), label: '' } };
  assert.deepEqual(mapRange(undo, r), { start: 7, end: 17 }, 'an undo takes the edit back');
});

test('a part range follows a reload through its bytes: a line added above moves it, one changed inside it drops a fold', () => {
  const enc = (t: string) => new TextEncoder().encode(t);
  const before = enc('# A\n\nOne.\n\n## B\n\nTwo.\n');
  const heading = { start: 11, end: 15 };
  assert.equal(new TextDecoder().decode(before.subarray(heading.start, heading.end)), '## B');
  const above = { before, after: enc('# A\n\nOne more line.\n\n## B\n\nTwo.\n') };
  assert.deepEqual(mapRange({ kind: 'reload' }, heading, above), { start: 21, end: 25 }, 'moved by what was added above');
  const below = { before, after: enc('# A\n\nOne.\n\n## B\n\nTwo and three.\n') };
  assert.deepEqual(mapRange({ kind: 'reload' }, heading, below), heading, 'a change below leaves it');
  const over = { before, after: enc('# A\n\nOne.\n') };
  assert.equal(mapRange({ kind: 'reload' }, heading, over), null, 'its bytes gone');
});

test('a part range stays on its part when its section is promoted, demoted or moved', () => {
  const enc = (t: string) => new TextEncoder().encode(t);
  const doc = '# T\n\n## A\n\nOne.\n\n### B\n\nTwo.\n\n## C\n\nThree.\n';
  const at = (text: string, part: string) => ({ start: text.indexOf(part), end: text.indexOf(part) + part.length });
  const change = (start: number, before: string, after: string, kind: 'apply' | 'undo' = 'apply'): Transition => ({
    kind,
    edit: { range: { file: 't', start, end: start + enc(before).length }, before: enc(before), after: enc(after), label: '' },
  });
  const sectionA = doc.slice(doc.indexOf('## A'), doc.indexOf('## C'));
  const promoted = '# A\n\nOne.\n\n## B\n\nTwo.\n\n';
  const after = doc.replace(sectionA, promoted);
  const promote = change(doc.indexOf('## A'), sectionA, promoted);
  assert.deepEqual(mapRange(promote, at(doc, '## A')), at(after, '# A'), 'the fold on its heading');
  assert.deepEqual(mapRange(promote, at(doc, '### B')), at(after, '## B'), 'the fold on a heading under it');
  assert.deepEqual(mapRange(promote, at(doc, 'Two.')), at(after, 'Two.'), 'an x-ray inside it');
  assert.deepEqual(mapRange(promote, at(doc, '## C')), at(after, '## C'), 'a part after it');
  const demote = change(doc.indexOf('## A'), sectionA, '### A\n\nOne.\n\n#### B\n\nTwo.\n\n');
  const deeper = doc.replace(sectionA, '### A\n\nOne.\n\n#### B\n\nTwo.\n\n');
  assert.deepEqual(mapRange(demote, at(doc, '### B')), at(deeper, '#### B'), 'demoted');
  const undo = change(doc.indexOf('## A'), sectionA, promoted, 'undo');
  assert.deepEqual(mapRange(undo, at(after, '## B')), at(doc, '### B'), 'and back on undo');
  const both = doc.slice(doc.indexOf('## A'));
  const swapped = '## C\n\nThree.\n' + sectionA;
  const moved = doc.replace(both, swapped);
  const move = change(doc.indexOf('## A'), both, swapped);
  for (const part of ['## A', '### B', 'One.', '## C', 'Three.']) assert.deepEqual(mapRange(move, at(doc, part)), at(moved, part), part);
  assert.deepEqual(mapRange(move, at(doc, '# T')), at(moved, '# T'), 'a part before the move');
  assert.equal(mapRange(move, { start: doc.indexOf('Two.'), end: doc.indexOf('Three.') }), null, 'a range across both sections');
  assert.deepEqual(mapRange(change(doc.indexOf('One.'), 'One.', 'Uno.'), at(doc, '## C')), at(doc, '## C'), 'a same-length edit is no swap');
});

test('Z on 30,000 sections finds its folds in time in proportion to them, and what each hides', () => {
  const doc = parse(`# Title\n\n${Array.from({ length: 30_000 }, (_, i) => `## S ${i}\n\ntext ${i}\n\n### Sub ${i}\n\nmore\n\n`).join('')}`);
  const t0 = cpuNow();
  const folds = foldAllHeadings(doc);
  for (const h of folds) {
    assert.equal(headingAt(doc, h.src), h);
    assert.equal(foldedBlocks(doc, h).length, 3);
  }
  assert.equal(folds.length, 30_000);
  assert.ok(cpuNow() - t0 < 2000, `${(cpuNow() - t0).toFixed(0)} ms`);
  const last = doc.children[doc.children.length - 1]!;
  assert.equal((sectionOf(doc, last) as Heading).level, 3);
});
