import assert from 'node:assert/strict';
import { test } from 'node:test';
import { byteToStringOffset, stringToByteOffset } from './offsets.ts';

test('offsets: byte and string offsets round trip for 1-, 2-, 3- and 4-byte characters', () => {
  const text = 'a\u00e9\u65e5\ud83d\ude00b\r\nc';
  let bytes = 0;
  for (let index = 0; index <= text.length; index++) {
    const cp = index < text.length ? text.codePointAt(index)! : 0;
    const splitsPair = index > 0 && text.charCodeAt(index - 1) >= 0xd800 && text.charCodeAt(index - 1) <= 0xdbff;
    if (splitsPair) {
      assert.throws(() => stringToByteOffset(text, index), RangeError);
      continue;
    }
    assert.equal(stringToByteOffset(text, index), bytes);
    assert.equal(byteToStringOffset(text, bytes), index);
    if (index < text.length) bytes += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
  assert.equal(stringToByteOffset(text, text.length), new TextEncoder().encode(text).length);
});

test('offsets: a byte offset inside a multi-byte sequence or past the end throws RangeError', () => {
  const text = 'a\u00e9\u65e5\ud83d\ude00';
  for (const bad of [2, 4, 5, 7, 8, 9, 100, -1, 1.5]) assert.throws(() => byteToStringOffset(text, bad), RangeError, String(bad));
  assert.throws(() => stringToByteOffset(text, text.length + 1), RangeError);
  assert.throws(() => stringToByteOffset(text, 4), RangeError);
});
