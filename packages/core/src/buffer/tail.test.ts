import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { appendedBytes, tailRead, TAIL_CHECK_BYTES } from './tail.ts';
import { indexLines } from '../reading/lines.ts';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const cat = (a: Uint8Array, b: Uint8Array): Uint8Array => Uint8Array.from([...a, ...b]);
/** What a shell's range read gives for `plan` over `file`. */
const readOf = (file: Uint8Array, plan: NonNullable<ReturnType<typeof tailRead>>): Uint8Array => file.slice(plan.at, plan.at + plan.length);

test('a file that grew yields only its new bytes, after the old end is read again', () => {
  const held = enc('one\ntwo\n');
  const file = enc('one\ntwo\nthree\nfour\n');
  const plan = tailRead(held.length, file.length)!;
  assert.deepEqual(plan, { at: 0, check: held.length, length: file.length, head: 0 });
  assert.equal(new TextDecoder().decode(appendedBytes(held, plan, readOf(file, plan))!), 'three\nfour\n');
});

test('only the last bytes are read again, however long the held file is', () => {
  const held = new Uint8Array(TAIL_CHECK_BYTES * 3).fill(0x61);
  const file = cat(held, enc('new\n'));
  const plan = tailRead(held.length, file.length)!;
  assert.equal(plan.check, TAIL_CHECK_BYTES);
  assert.equal(plan.at, held.length - TAIL_CHECK_BYTES);
  assert.equal(plan.length, TAIL_CHECK_BYTES + 4);
  assert.equal(plan.head, TAIL_CHECK_BYTES);
  assert.equal(appendedBytes(held, plan, readOf(file, plan), file.slice(0, plan.head))!.length, 4);
});

test('a long file copied and truncated, then grown past its old size, differs at its start and is read whole', () => {
  const held = new Uint8Array(TAIL_CHECK_BYTES * 3).fill(0x61);
  // The new file's last bytes happen to equal the old end; its start is not the old start.
  const regrown = new Uint8Array(held.length + 10).fill(0x61);
  regrown.set(enc('2026-11-20 rotated start\n'), 0);
  const plan = tailRead(held.length, regrown.length)!;
  assert.equal(appendedBytes(held, plan, readOf(regrown, plan), regrown.slice(0, plan.head)), null);
  assert.equal(appendedBytes(held, plan, readOf(regrown, plan)), null, 'no head read, no append');
});

test('a file that did not grow is not followed', () => {
  assert.equal(tailRead(10, 10), null);
  assert.equal(tailRead(10, 4), null);
});

test('a truncated file, and one truncated and grown past the old size, are read whole', () => {
  const held = enc('alpha\nbeta\ngamma\n');
  const regrown = enc('alpha\nbeta\nDELTA\nepsilon\nzeta\n');
  assert.ok(regrown.length > held.length);
  const plan = tailRead(held.length, regrown.length)!;
  assert.equal(appendedBytes(held, plan, readOf(regrown, plan)), null);
});

test('a rotated file of the same size is not an append', () => {
  const held = enc('2026-11-19 old log line one\n');
  const rotated = enc('2026-11-20 new log line one\n');
  assert.equal(held.length, rotated.length);
  assert.equal(tailRead(held.length, rotated.length), null);
});

test('a rotated file that is larger is read whole', () => {
  const held = enc('2026-11-19 old log line one\n');
  const rotated = enc('2026-11-20 new log line one\nand a second line\n');
  const plan = tailRead(held.length, rotated.length)!;
  assert.equal(appendedBytes(held, plan, readOf(rotated, plan)), null);
});

test('a read that came back short (the file shrank while it was read) is refused', () => {
  const held = enc('abc\n');
  const file = enc('abc\ndef\n');
  const plan = tailRead(held.length, file.length)!;
  assert.equal(appendedBytes(held, plan, readOf(file, plan).slice(0, -2)), null);
});

test('a CRLF cut between the old end and the new bytes is one line ending', () => {
  const held = enc('first\r\nsecond\r');
  const file = enc('first\r\nsecond\r\nthird\r\n');
  const plan = tailRead(held.length, file.length)!;
  const added = appendedBytes(held, plan, readOf(file, plan))!;
  assert.deepEqual([...added.subarray(0, 1)], [0x0a]);
  const whole = indexLines(cat(held, added), false, indexLines(held, false));
  const direct = indexLines(file, false);
  assert.equal(whole.count, direct.count);
  assert.deepEqual([...whole.starts], [...direct.starts]);
  assert.deepEqual([...whole.ends], [...direct.ends]);
});

test('a character cut at the old end is completed by the new bytes', () => {
  const full = enc('café ☃ snow\n');
  const cut = full.indexOf(0xe2) + 1;
  const held = full.slice(0, cut);
  const plan = tailRead(held.length, full.length)!;
  const added = appendedBytes(held, plan, readOf(full, plan))!;
  assert.equal(new TextDecoder().decode(cat(held, added)), 'café ☃ snow\n');
});

test('new bytes that are not UTF-8 send the file to be read whole', () => {
  const held = enc('plain\n');
  const file = cat(held, Uint8Array.from([0x63, 0x61, 0x66, 0xe9, 0x0a]));
  const plan = tailRead(held.length, file.length)!;
  assert.equal(appendedBytes(held, plan, readOf(file, plan)), null);
});

test('a file that was empty is followed from its first byte', () => {
  const file = enc('first line\n');
  const plan = tailRead(0, file.length)!;
  assert.deepEqual(plan, { at: 0, check: 0, length: file.length, head: 0 });
  assert.equal(appendedBytes(new Uint8Array(0), plan, file)!.length, file.length);
});
