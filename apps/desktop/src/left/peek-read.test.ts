// A link peek reads up to the lines it shows, not the whole target.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryShell } from '../shell/memory.ts';
import { PEEK_MAX_BYTES, textThroughLine } from './peek-read.ts';

const enc = new TextEncoder();

test('a peek near the top of a 50 MB file reads its head only, and readFile never', async () => {
  const line = 'x'.repeat(99) + '\n';
  const shell = createMemoryShell({ '/r/big.log': enc.encode(line.repeat(500_000)) });
  const text = await textThroughLine(shell, '/r/big.log', 8);
  assert.ok(text !== null && text.split('\n').length > 8);
  assert.equal(shell.calls.filter((c) => c.method === 'readFile').length, 0);
});

test('a line deeper than the head is read through windows; every line ending counts once', async () => {
  for (const eol of ['\n', '\r\n', '\r']) {
    const lines = Array.from({ length: 40_000 }, (_, i) => `line ${i + 1} ${'.'.repeat(20)}`);
    const shell = createMemoryShell({ '/r/a.txt': enc.encode(lines.join(eol)) });
    const text = await textThroughLine(shell, '/r/a.txt', 30_005);
    const got = text!.split(/\r\n|\n|\r/);
    assert.ok(got.length > 30_005, `${JSON.stringify(eol)}: ${got.length} lines read`);
    assert.equal(got[30_004], lines[30_004]);
  }
});

test('a short file is read whole, and a line past the bound is no peek', async () => {
  const shell = createMemoryShell({ '/r/s.md': enc.encode('one\ntwo') });
  assert.equal(await textThroughLine(shell, '/r/s.md', 50), 'one\ntwo');
  const flat = createMemoryShell({ '/r/flat.bin': new Uint8Array(PEEK_MAX_BYTES + 10).fill(65) });
  assert.equal(await textThroughLine(flat, '/r/flat.bin', 3), null);
});
