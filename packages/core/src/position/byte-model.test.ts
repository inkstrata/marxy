// The byte model's rules: records tile the file, sums are lazy and follow splices, and an anchor survives an edit.

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { splice, createBuffer } from '../buffer/buffer.ts';
import { parseMarkdown } from '../parse/parse.ts';
import { byteModelOf, createByteModel, estimateUnits, inputsOfBlocks, type BlockInput } from './byte-model.ts';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const TEXT = '# Title\n\nFirst paragraph here.\n\n```ts\nconst a = 1;\n```\n\n- one\n- two\n\nLast é paragraph.\n';

test('one record per top-level block, tiling the file from byte 0 to its end', () => {
  const bytes = enc(TEXT);
  const doc = parseMarkdown(bytes, { file: 'a.md' });
  const m = byteModelOf(doc, bytes.length);
  assert.equal(m.count, doc.children.length);
  assert.deepEqual(Array.from({ length: m.count }, (_, i) => m.record(i).kind), doc.children.map((b) => b.type));
  assert.equal(m.byteLength, bytes.length);
  assert.equal(m.startByte(0), 0);
  for (let i = 1; i < m.count; i++) assert.equal(m.startByte(i), doc.children[i]!.src.start, `block ${i} starts where the parse says`);
});

test('a byte is found in the block that holds it, a gap in the block before it', () => {
  const bytes = enc(TEXT);
  const doc = parseMarkdown(bytes, { file: 'a.md' });
  const m = byteModelOf(doc, bytes.length);
  const second = doc.children[1]!;
  assert.equal(m.indexAtByte(0), 0);
  assert.equal(m.indexAtByte(second.src.start - 1), 0, 'the blank line belongs to the heading');
  assert.equal(m.indexAtByte(second.src.start), 1);
  assert.equal(m.indexAtByte(bytes.length + 99), m.count - 1);
  assert.equal(createByteModel().indexAtByte(5), 0);
});

test('estimates are whole units by kind, and a measurement replaces one', () => {
  assert.equal(estimateUnits('paragraph', 200), 4, 'three lines and a gap');
  assert.equal(estimateUnits('paragraph', 0), 2);
  assert.equal(estimateUnits('heading', 5000), 3, 'a heading is not sized by its bytes');
  assert.equal(estimateUnits('paragraph', 160, { charsPerLine: 40 }), 5);
  const m = createByteModel([{ kind: 'paragraph', bytes: 80 }, { kind: 'paragraph', bytes: 80 }]);
  assert.equal(m.record(0).measured, false);
  assert.equal(m.topUnits(1), 2);
  m.measure(0, 7.4);
  assert.equal(m.record(0).units, 7);
  assert.equal(m.record(0).measured, true);
  assert.equal(m.topUnits(1), 7, 'the block below moves with no work of its own');
  assert.equal(m.totalUnits, 9);
});

test('the block under a height is the first whose bottom is below it', () => {
  const m = createByteModel([{ kind: 'paragraph', bytes: 10, units: 4 }, { kind: 'paragraph', bytes: 10, units: 6 }, { kind: 'paragraph', bytes: 10, units: 2 }]);
  assert.equal(m.indexAtUnits(0), 0);
  assert.equal(m.indexAtUnits(3), 0);
  assert.equal(m.indexAtUnits(4), 1, 'the top edge belongs to the block it starts');
  assert.equal(m.indexAtUnits(11), 2);
  assert.equal(m.indexAtUnits(500), 2);
});

test('splicing blocks moves every later block by the difference and keeps their records', () => {
  const ins = (n: number, kind: BlockInput['kind'] = 'paragraph'): BlockInput => ({ kind, bytes: n, units: 3 });
  const m = createByteModel(Array.from({ length: 10 }, () => ins(100)));
  m.setMounted(9, true);
  m.setTypeset(9, true);
  assert.equal(m.startByte(9), 900);
  m.splice(2, 3, [ins(40), ins(60)]);
  assert.equal(m.count, 9);
  assert.equal(m.startByte(4), 100 * 2 + 40 + 60);
  assert.equal(m.byteLength, 1000 - 300 + 100);
  assert.equal(m.topUnits(9), 27);
  assert.deepEqual([m.record(8).mounted, m.record(8).typeset], [true, true], 'a later block keeps its flags');
  m.splice(0, 0, [ins(5)]);
  assert.equal(m.startByte(1), 5);
  m.splice(m.count, 0, [ins(7)]);
  assert.equal(m.byteLength, 1000 - 300 + 100 + 5 + 7);
  m.splice(0, 99, []);
  assert.equal(m.count, 0);
  assert.equal(m.byteLength, 0);
});

test('a spliced model equals one built whole from the edited text', () => {
  const before = enc(TEXT);
  const docBefore = parseMarkdown(before, { file: 'a.md' });
  const m = byteModelOf(docBefore, before.length);
  // Replace the first paragraph's text, a block in the middle of the page.
  const para = docBefore.children[1]!;
  const edited = splice(createBuffer('a.md', before), { file: 'a.md', start: para.src.start, end: para.src.end }, 'A much longer first paragraph, long enough to wrap onto a second line of the measure we assume here.');
  const docAfter = parseMarkdown(edited.bytes, { file: 'a.md' });
  const whole = byteModelOf(docAfter, edited.bytes.length);
  const newEnd = docAfter.children[2]!.src.start;
  m.splice(1, 1, inputsOfBlocks(docAfter.children.slice(1, 2), docAfter.children[1]!.src.start, newEnd));
  assert.equal(m.count, whole.count);
  assert.equal(m.byteLength, whole.byteLength);
  for (let i = 0; i <= m.count; i++) {
    assert.equal(m.startByte(i), whole.startByte(i), `start of ${i}`);
    assert.equal(m.topUnits(i), whole.topUnits(i), `top of ${i}`);
  }
});

test('an anchor is found by byte or by height, and put back after an edit above it', () => {
  const m = createByteModel(Array.from({ length: 6 }, () => ({ kind: 'paragraph' as const, bytes: 100, units: 10 })));
  const a = m.anchorAtByte(350);
  assert.deepEqual(a, { block: 3, byte: 350, units: 5 });
  assert.equal(m.unitsOfAnchor(a), 35);
  assert.deepEqual(m.anchorAtUnits(35), { block: 3, byte: 350, units: 5 });
  assert.deepEqual(m.anchorAtUnits(0), { block: 0, byte: 0, units: 0 });
  // A block above grows by 20 bytes and 4 units; the reader's byte moves with it.
  m.splice(0, 1, [{ kind: 'paragraph', bytes: 120, units: 14 }]);
  const moved = { ...a, byte: a.byte + 20 };
  assert.deepEqual(m.resolve(moved), { block: 3, byte: 370, units: 5 });
  assert.equal(m.unitsOfAnchor(m.resolve(moved)), 39);
  // The block under the anchor shrinks below the offset: the offset is held inside it.
  m.splice(3, 1, [{ kind: 'paragraph', bytes: 100, units: 3 }]);
  assert.equal(m.resolve(moved).units, 3);
  assert.deepEqual(createByteModel().anchorAtByte(9), { block: 0, byte: 9, units: 0 });
});

test('sums stay right through several splices between questions', () => {
  const m = createByteModel(Array.from({ length: 100 }, () => ({ kind: 'paragraph' as const, bytes: 10, units: 2 })));
  assert.equal(m.byteLength, 1000);
  m.splice(99, 1, [{ kind: 'paragraph', bytes: 50, units: 2 }]);
  m.splice(98, 1, [{ kind: 'paragraph', bytes: 20, units: 2 }]);
  m.splice(5, 1, [{ kind: 'paragraph', bytes: 15, units: 2 }]);
  assert.equal(m.startByte(6), 65);
  assert.equal(m.startByte(99), 5 * 10 + 15 + 92 * 10 + 20);
  assert.equal(m.byteLength, 1000 + 40 + 10 + 5);
});
