// `writeFileAtomic` with `expected` on the memory shell: the contract the Rust write keeps
// (`atomic_write::write_atomic_unless_changed`), so browser tests of saving meet the same refusal.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryShell } from './memory.ts';

const bytes = (values: readonly number[]): Uint8Array => Uint8Array.from(values);
const after = (shell: ReturnType<typeof createMemoryShell>, path: string) => shell.peekFile(path).then((b) => [...b]);

test('the file still what was read: written', async () => {
  const shell = createMemoryShell({ '/r/a.md': bytes([1, 2, 3]) });
  await shell.writeFileAtomic('/r/a.md', bytes([4]), bytes([1, 2, 3]));
  assert.deepEqual(await after(shell, '/r/a.md'), [4]);
});

test('the file changed underneath, at the same length or another: refused with code changed, nothing written', async () => {
  const shell = createMemoryShell({ '/r/a.md': bytes([9, 9, 9]) });
  for (const theirs of [[9, 9, 9], [9, 9, 9, 9]]) {
    shell.plant('/r/a.md', bytes(theirs));
    await assert.rejects(
      shell.writeFileAtomic('/r/a.md', bytes([4]), bytes([1, 2, 3])),
      (err: { code?: string; path?: string; message: string }) =>
        err.code === 'changed' && err.path === '/r/a.md' && /changed on disk since it was opened; refusing to overwrite/.test(err.message),
    );
    assert.deepEqual(await after(shell, '/r/a.md'), theirs);
  }
});

test('the file gone: written, as the save makes it again', async () => {
  const shell = createMemoryShell({ '/r/a.md': bytes([1]) });
  shell.remove('/r/a.md');
  await shell.writeFileAtomic('/r/a.md', bytes([2]), bytes([1]));
  assert.deepEqual(await after(shell, '/r/a.md'), [2]);
});

test('no expected bytes: written whatever is there, as before', async () => {
  const shell = createMemoryShell({ '/r/a.md': bytes([7]) });
  await shell.writeFileAtomic('/r/a.md', bytes([8]));
  assert.deepEqual(await after(shell, '/r/a.md'), [8]);
});

test('the call record keeps its shape: path and bytes, and no read before the write', async () => {
  const shell = createMemoryShell({ '/r/a.md': bytes([1]) });
  await shell.writeFileAtomic('/r/a.md', bytes([2]), bytes([1]));
  assert.deepEqual(shell.calls.map((c) => [c.method, c.args.length]), [['writeFileAtomic', 2]]);
});
