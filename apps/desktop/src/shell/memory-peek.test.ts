// `peekFile` and `exists` on the memory shell (F-33): the blind look the store's stale-write check and the
// watch use on Tauri. The app-harness call record is fixed, so a peek is recorded exactly as the `readFile` the
// app made before this shell had one (live reload, the index, a link's look), and `exists` leaves nothing, as
// `hasFile` does. Bytes are compared as bytes: the shell passes them through (the fidelity gate scans this folder).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryShell } from './memory.ts';

const ONE = [1, 2, 3];
const TWO = [4, 5, 6];
const bytes = (values: readonly number[]): Uint8Array => Uint8Array.from(values);

test('peekFile returns the bytes now in the store, as a copy', async () => {
  const shell = createMemoryShell({ '/r/a.md': bytes(ONE) });
  const peeked = await shell.peekFile('/r/a.md');
  assert.deepEqual([...peeked], ONE);
  peeked[0] = 9;
  assert.deepEqual([...(await shell.peekFile('/r/a.md'))], ONE, 'a caller cannot change the store through the bytes it was handed');
});

test('a second program writes, and peekFile sees it; the call log holds one readFile per look, as before peekFile existed', async () => {
  const shell = createMemoryShell({ '/r/a.md': bytes(ONE) });
  await shell.writeFileAtomic('/r/a.md', bytes(TWO)); // another program's write is the same call as the app's
  const before = shell.calls.length;
  assert.deepEqual([...(await shell.peekFile('/r/a.md'))], TWO);
  assert.deepEqual(shell.calls.slice(before), [{ method: 'readFile', args: ['/r/a.md'] }], 'a look is the readFile the app used to make');
  shell.remove('/r/a.md');
  await assert.rejects(shell.peekFile('/r/a.md'), (err: { code?: string; path?: string }) => err.code === 'not-found' && err.path === '/r/a.md');
});

test('exists is true for a file and for a folder with a file under it, false otherwise, and records nothing', async () => {
  const shell = createMemoryShell({ '/r/a.md': bytes(ONE), '/r/sub/b.md': bytes(TWO) });
  assert.equal(await shell.exists('/r/a.md'), true);
  assert.equal(await shell.exists('/r/sub'), true);
  assert.equal(await shell.exists('/r/sub/'), true);
  assert.equal(await shell.exists('/r/su'), false, 'a prefix of a name is not a folder');
  assert.equal(await shell.exists('/r/missing.md'), false);
  assert.deepEqual(shell.calls, []);
  shell.remove('/r/a.md');
  assert.equal(await shell.exists('/r/a.md'), false);
});
