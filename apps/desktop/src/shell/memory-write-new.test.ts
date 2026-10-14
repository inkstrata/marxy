// `writeFileNew` (F-85, ADR-0074) on the memory shell: the contract every shell keeps, held here as the Rust shell holds it in
// `atomic_write.rs`. Anything at the name (a file, a folder, a symlink, a symlink that leads nowhere, a name differing only by case
// on a case-insensitive volume) refuses `exists` and writes nothing; a creator that appears between a caller's look and its write is
// never replaced; a failed write leaves nothing. Bytes are compared as bytes (the fidelity gate scans this folder).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryShell } from './memory.ts';

const bytes = (...values: number[]): Uint8Array => Uint8Array.from(values);
const ONE = bytes(1, 2, 3);
const TWO = bytes(0xef, 0xbb, 0xbf, 0, 0xff);
const exists = (err: unknown): boolean => typeof err === 'object' && err !== null && (err as { code?: string }).code === 'exists';

test('a free name is created with exactly the bytes, as a copy', async () => {
  const shell = createMemoryShell({});
  const given = TWO.slice();
  await shell.writeFileNew('/r/a (fork).md', given);
  given[0] = 9;
  assert.deepEqual([...(await shell.peekFile('/r/a (fork).md'))], [...TWO], 'a caller cannot change the file through the bytes it passed');
});

test('an existing file refuses "exists" and keeps its bytes', async () => {
  const shell = createMemoryShell({ '/r/a.md': ONE });
  await assert.rejects(shell.writeFileNew('/r/a.md', TWO), exists);
  assert.deepEqual([...(await shell.peekFile('/r/a.md'))], [...ONE]);
});

test('a folder refuses "exists" and nothing appears inside or beside it', async () => {
  const shell = createMemoryShell({ '/r/folder.md/inside.txt': ONE });
  await assert.rejects(shell.writeFileNew('/r/folder.md', TWO), exists);
  await assert.rejects(shell.writeFileNew('/r/folder.md/', TWO), exists, 'a trailing slash names the same folder');
  assert.equal(shell.hasFile('/r/folder.md'), false);
  assert.deepEqual([...(await shell.peekFile('/r/folder.md/inside.txt'))], [...ONE]);
});

test('a symlink refuses "exists", is not written through, and its target keeps its bytes', async () => {
  const shell = createMemoryShell({ '/r/real.md': ONE });
  shell.symlink('/r/x (mine).md', '/r/real.md');
  await assert.rejects(shell.writeFileNew('/r/x (mine).md', TWO), exists);
  assert.deepEqual([...(await shell.peekFile('/r/real.md'))], [...ONE]);
  assert.equal(shell.hasFile('/r/x (mine).md'), false, 'no file was made where the link is');
  await assert.rejects(shell.writeFileNew('/r/x (mine).md', TWO), exists, 'and the link is still there');
});

test('a symlink that leads nowhere refuses "exists" and creates nothing at its destination', async () => {
  const shell = createMemoryShell({});
  shell.symlink('/r/link.md', '/r/missing.md');
  await assert.rejects(shell.writeFileNew('/r/link.md', TWO), exists);
  assert.equal(shell.hasFile('/r/missing.md'), false);
  assert.equal(shell.hasFile('/r/link.md'), false);
});

test('on a case-insensitive volume a name differing only by case refuses; on a case-sensitive one it is a different name', async () => {
  const folded = createMemoryShell({ '/r/Notes (Fork).md': ONE }, { caseInsensitive: true });
  await assert.rejects(folded.writeFileNew('/r/notes (fork).md', TWO), exists);
  assert.equal(folded.hasFile('/r/notes (fork).md'), false);
  assert.deepEqual([...(await folded.peekFile('/r/Notes (Fork).md'))], [...ONE]);
  folded.symlink('/r/Link.md', '/r/real.md');
  await assert.rejects(folded.writeFileNew('/r/LINK.md', TWO), exists, 'a link folds too');
  const kept = createMemoryShell({ '/r/Notes (Fork).md': ONE });
  await kept.writeFileNew('/r/notes (fork).md', TWO);
  assert.deepEqual([...(await kept.peekFile('/r/notes (fork).md'))], [...TWO]);
});

test('a creator that appears just before the write wins the name and is not replaced', async () => {
  const shell = createMemoryShell({});
  shell.beforeWriteNew((path) => {
    if (path === '/r/a (fork).md') shell.plant(path, ONE);
  });
  await assert.rejects(shell.writeFileNew('/r/a (fork).md', TWO), exists);
  assert.deepEqual([...(await shell.peekFile('/r/a (fork).md'))], [...ONE]);
});

test('two creators racing for one name: exactly one is made, the other is refused, and the file is whole', async () => {
  const shell = createMemoryShell({});
  const results = await Promise.allSettled([shell.writeFileNew('/r/a.md', ONE), shell.writeFileNew('/r/a.md', TWO)]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  const refused = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
  assert.ok(exists(refused.reason));
  assert.deepEqual([...(await shell.peekFile('/r/a.md'))], [...ONE], 'the first to arrive keeps the name');
});

test('a refused or failed write leaves nothing: a rejected write creates no file, and the next write is not poisoned', async () => {
  const shell = createMemoryShell({});
  shell.rejectNextWrite('io');
  await assert.rejects(shell.writeFileNew('/r/a.md', ONE), (err: { code?: string }) => err.code === 'io');
  assert.equal(shell.hasFile('/r/a.md'), false);
  await shell.writeFileNew('/r/a.md', ONE);
  assert.deepEqual([...(await shell.peekFile('/r/a.md'))], [...ONE]);
});

test('the call is recorded with its path and bytes, and a refused one too', async () => {
  const shell = createMemoryShell({ '/r/a.md': ONE });
  await shell.writeFileNew('/r/b.md', TWO);
  await assert.rejects(shell.writeFileNew('/r/a.md', TWO), exists);
  assert.deepEqual(shell.calls.filter((c) => c.method === 'writeFileNew').map((c) => c.args[0]), ['/r/b.md', '/r/a.md']);
});
