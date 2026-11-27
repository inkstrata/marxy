import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeDifference, embeddedSignature, largeLog, minimalPe, treeMemory, utf16LeWithBom, utf8WithBom } from './real-window-fixtures.mjs';

test('a BOM leads each encoding and the text follows in it', () => {
  assert.deepEqual([...utf16LeWithBom('A\r\n')], [0xff, 0xfe, 0x41, 0, 0x0d, 0, 0x0a, 0]);
  assert.deepEqual([...utf8WithBom('A\r\n')], [0xef, 0xbb, 0xbf, 0x41, 0x0d, 0x0a]);
});

test('a difference is placed at its first byte, and equal bytes say so', () => {
  assert.equal(describeDifference(Buffer.from('abc'), Buffer.from('abc')), 'identical');
  assert.match(describeDifference(Buffer.from('abd'), Buffer.from('abc')), /first difference at byte 2 \(64 against 63\)/);
  assert.match(describeDifference(Buffer.from('ab'), Buffer.from('abc')), /2 bytes against 3; first difference at byte 2 \(end against 63\)/);
  assert.equal(describeDifference(null, Buffer.from('a')), 'the file is not there');
});

test('the minimal program has MZ, PE, x64, a console subsystem, a stamp and no certificate', () => {
  const pe = minimalPe();
  assert.equal(pe.toString('latin1', 0, 2), 'MZ');
  const at = pe.readUInt32LE(0x3c);
  assert.equal(pe.toString('latin1', at, at + 4), 'PE\0\0');
  assert.equal(pe.readUInt16LE(at + 4), 0x8664);
  assert.equal(pe.readUInt16LE(at + 24), 0x20b);
  assert.equal(pe.readUInt16LE(at + 24 + 68), 3);
  assert.equal(pe.readUInt32LE(at + 24 + 108), 16);
  assert.ok(pe.readUInt32LE(at + 8) > 0);
  assert.equal(embeddedSignature(pe), false);
});

test('a certificate-table entry is seen, and text is no program', () => {
  const pe = minimalPe();
  const at = pe.readUInt32LE(0x3c);
  pe.writeUInt32LE(0x300, at + 24 + 112 + 32);
  pe.writeUInt32LE(0x40, at + 24 + 112 + 36);
  assert.equal(embeddedSignature(pe), true);
  assert.equal(embeddedSignature(Buffer.from('# not a program\n')), false);
});

test('the big log is past its size, ends on its last line and counts its lines', () => {
  const { bytes, lines } = largeLog(1);
  assert.ok(bytes.length > 2 ** 20);
  const text = bytes.toString('utf8');
  assert.equal(text.split('\n').length - 1, lines);
  assert.ok(text.endsWith('the very last line\n'));
});

test('a process tree sums the root and what descends from it, and nothing beside it', () => {
  const rows = [
    { ProcessId: 10, ParentProcessId: 1, WorkingSetSize: 2 ** 20, PrivatePageCount: 2 ** 20 },
    { ProcessId: 11, ParentProcessId: 10, WorkingSetSize: 3 * 2 ** 20, PrivatePageCount: 2 ** 20 },
    { ProcessId: 12, ParentProcessId: 11, WorkingSetSize: 2 * 2 ** 20, PrivatePageCount: 0 },
    { ProcessId: 20, ParentProcessId: 1, WorkingSetSize: 100 * 2 ** 20, PrivatePageCount: 100 * 2 ** 20 },
  ];
  assert.deepEqual(treeMemory(rows, 10), { processes: 3, workingSetMB: 6, privateMB: 2 });
  assert.deepEqual(treeMemory(rows[0], 10), { processes: 1, workingSetMB: 1, privateMB: 1 });
  assert.deepEqual(treeMemory(null, 10), { processes: 0, workingSetMB: 0, privateMB: 0 });
});

import { launchVerdict } from './real-window-fixtures.mjs';

test('a launch is judged by its painted mark: late text, an untagged frames-only launch and a missing mark fail with their cause', () => {
  assert.equal(launchVerdict('MARK painted 1 frames=2 since_render_ms=175 signal=first-paint source=paint').ok, true);
  assert.equal(launchVerdict('MARK painted 1 frames=2 since_render_ms=40 signal=frames-only source=frame fcp_before_ms=212').ok, true);
  const noEarlierPaint = launchVerdict('MARK painted 1 frames=2 since_render_ms=40 signal=frames-only source=frame');
  assert.equal(noEarlierPaint.ok, true, 'the fallback path carries no fcp_before_ms');
  const stalled = launchVerdict('MARK painted 1 frames=2 since_render_ms=2031 signal=frames-only');
  assert.equal(stalled.ok, false);
  assert.match(stalled.why, /2031 ms after the render/);
  assert.match(launchVerdict('MARK painted 1 frames=2 since_render_ms=40 signal=frames-only').why, /source=frame/);
  assert.match(launchVerdict(undefined).why, /no painted mark/);
});
