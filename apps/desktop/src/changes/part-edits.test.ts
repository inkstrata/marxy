import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { parseMarkdown, type Block, type Document } from '@marxy/core';
import { movePart, removePart, type Splice } from './part-edits.ts';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const dec = (b: Uint8Array): string => new TextDecoder().decode(b);
const parse = (b: Uint8Array): Document => parseMarkdown(b, { file: 't.md' });
const apply = (bytes: Uint8Array, s: Splice): Uint8Array => {
  const out = new Uint8Array(bytes.length - (s.range.end - s.range.start) + s.replacement.length);
  out.set(bytes.subarray(0, s.range.start), 0);
  out.set(s.replacement, s.range.start);
  out.set(bytes.subarray(s.range.end), s.range.start + s.replacement.length);
  return out;
};
const blockAtStart = (doc: Document, start: number): Block => {
  let found: Block | null = null;
  const walk = (n: Document | Block): void => {
    for (const c of (n.children ?? []) as Block[]) {
      if (!c.src) continue;
      // The innermost holder starting there: a list item, not the list it opens.
      if (c.src.start === start && c.type !== 'paragraph') found = c;
      walk(c);
    }
  };
  walk(doc);
  return found ?? doc.children.find((c) => c.src.start === start)!;
};

const TEXT = '# A\r\n\r\npara one\r\nline two\r\n\r\n- a\n- b\n  - b1\n- c\n\nlast paragraph';

test('a paragraph moved down and back up is byte for byte the file it was, CRLF and no final newline kept', () => {
  const bytes = enc(TEXT);
  const doc = parse(bytes);
  const para = doc.children[1]!;
  const down = movePart(doc, bytes, para, para, 1)!;
  const mid = apply(bytes, down);
  assert.equal(dec(mid), '# A\r\n\r\n- a\n- b\n  - b1\n- c\r\n\r\npara one\r\nline two\n\nlast paragraph');
  const doc2 = parse(mid);
  const moved = doc2.children.find((c) => c.src.start === down.landed)!;
  assert.equal(moved.type, 'paragraph');
  const up = movePart(doc2, mid, moved, moved, -1)!;
  assert.equal(dec(apply(mid, up)), TEXT);
});

test('a list item trades with its sibling, nested list and all', () => {
  const bytes = enc(TEXT);
  const doc = parse(bytes);
  const b = blockAtStart(doc, TEXT.indexOf('- b'));
  assert.equal(b.type, 'listItem');
  const s = movePart(doc, bytes, b, b, -1)!;
  const mid = apply(bytes, s);
  assert.ok(dec(mid).includes('- b\n  - b1\n- a\n- c'));
  assert.equal(s.landed, TEXT.indexOf('- a'));
  const again = parse(mid);
  const back = movePart(again, mid, blockAtStart(again, s.landed), blockAtStart(again, s.landed), 1)!;
  assert.equal(dec(apply(mid, back)), TEXT);
});

test('nothing to move past at the edges', () => {
  const bytes = enc(TEXT);
  const doc = parse(bytes);
  assert.equal(movePart(doc, bytes, doc.children[0]!, doc.children[0]!, -1), null);
  assert.equal(movePart(doc, bytes, doc.children.at(-1)!, doc.children.at(-1)!, 1), null);
});

test('d removes a part and the gap after it; the last part takes the gap before it', () => {
  const bytes = enc(TEXT);
  const doc = parse(bytes);
  assert.equal(dec(apply(bytes, removePart(doc, bytes, doc.children[1]!, doc.children[1]!)!)), '# A\r\n\r\n- a\n- b\n  - b1\n- c\n\nlast paragraph');
  const last = doc.children.at(-1)!;
  assert.equal(dec(apply(bytes, removePart(doc, bytes, last, last)!)), TEXT.slice(0, TEXT.indexOf('\n\nlast')));
  const c = blockAtStart(doc, TEXT.indexOf('- c'));
  assert.ok(dec(apply(bytes, removePart(doc, bytes, c, c)!)).includes('  - b1\n\nlast'));
});

test('a run of parts moves as one', () => {
  const t = 'one\n\ntwo\n\nthree\n';
  const bytes = enc(t);
  const doc = parse(bytes);
  const s = movePart(doc, bytes, doc.children[0]!, doc.children[1]!, 1)!;
  assert.equal(dec(apply(bytes, s)), 'three\n\none\n\ntwo\n');
  assert.equal(s.landed, 'three\n\n'.length);
});

test('an ordered list keeps its start number when its first item is moved or removed, and a move and its inverse are byte-exact', () => {
  const t = 'Intro.\n\n3. three\n4. four\n   more four\n5. five\n';
  const bytes = enc(t);
  const doc = parse(bytes);
  const first = blockAtStart(doc, t.indexOf('3.'));
  const down = movePart(doc, bytes, first, first, 1)!;
  const mid = apply(bytes, down);
  assert.equal(dec(mid), 'Intro.\n\n3. four\n   more four\n4. three\n5. five\n');
  assert.equal(down.landed, dec(mid).indexOf('4. three'));
  const again = parse(mid);
  const moved = blockAtStart(again, down.landed);
  assert.equal(dec(apply(mid, movePart(again, mid, moved, moved, -1)!)), t);
  const up = movePart(doc, bytes, blockAtStart(doc, t.indexOf('4.')), blockAtStart(doc, t.indexOf('4.')), -1)!;
  assert.equal(dec(apply(bytes, up)), 'Intro.\n\n3. four\n   more four\n4. three\n5. five\n');
  assert.equal(up.landed, t.indexOf('3.'));
  assert.equal(dec(apply(bytes, removePart(doc, bytes, first, first)!)), 'Intro.\n\n3. four\n   more four\n5. five\n');
  const mixed = enc('- a\n- b\n');
  const md = parse(mixed);
  assert.equal(dec(apply(mixed, movePart(md, mixed, blockAtStart(md, 0), blockAtStart(md, 0), 1)!)), '- b\n- a\n');
});
