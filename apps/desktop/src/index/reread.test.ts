// A patch from a tree watch reads one file narrowly (C-11.2): one stat and at most the head of a markdown
// file, with no folder listing and no whole-file read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createIndexService } from './service.ts';
import { createMemoryShell } from '../shell/memory.ts';

const enc = (s: string) => new TextEncoder().encode(s);
const HEAD = 256 * 1024;

const repo = () => ({
  '/r/.git/HEAD': enc('ref: refs/heads/main\n'),
  '/r/README.md': enc('# Home\n'),
  '/r/docs/guide.md': enc('# Guide\n'),
  '/r/docs/more.md': enc('# More\n'),
});

async function patched(files: Record<string, Uint8Array>) {
  const shell = createMemoryShell(files);
  const index = createIndexService(shell);
  await index.ensureRoot('/r', { watch: true });
  await index.settled();
  shell.calls.length = 0;
  return { shell, index };
}

const called = (shell: ReturnType<typeof createMemoryShell>, method: string) => shell.calls.filter((c) => c.method === method);

test('a patched file costs one stat and one head read: no readDir, no readFile', async () => {
  const { shell, index } = await patched(repo());
  await shell.writeFileAtomic('/r/docs/guide.md', enc('# Guide, revised\n'));
  shell.calls.length = 0;
  index.applyEvents([{ kind: 'modified', path: '/r/docs/guide.md' }]);
  await index.settled();
  assert.equal(called(shell, 'readDir').length, 0, 'the folder is not listed');
  assert.equal(called(shell, 'readFile').length, 0, 'the file is not read whole');
  assert.deepEqual(called(shell, 'stat').map((c) => c.args), [['/r/docs/guide.md']]);
  assert.deepEqual(called(shell, 'readHead').map((c) => c.args), [['/r/docs/guide.md', HEAD]]);
  assert.ok(index.entries().some((e) => e.path === '/r/docs/guide.md' && e.title === 'Guide, revised'));
});

test('a large file is indexed from its head only', async () => {
  const { shell, index } = await patched(repo());
  const big = new Uint8Array(HEAD * 2).fill(97);
  big.set(enc('# Big title\n\n'));
  await shell.writeFileAtomic('/r/big.md', big);
  index.applyEvents([{ kind: 'created', path: '/r/big.md' }]);
  await index.settled();
  const entry = index.entries().find((e) => e.path === '/r/big.md');
  assert.equal(entry?.title, 'Big title');
  assert.equal(entry?.size, HEAD * 2, 'the size is the file\'s, from stat');
});

test('a removed file is dropped, and a path that became a folder is not indexed', async () => {
  const { shell, index } = await patched(repo());
  shell.remove('/r/docs/more.md');
  index.applyEvents([{ kind: 'removed', path: '/r/docs/more.md' }]);
  await index.settled();
  assert.ok(!index.entries().some((e) => e.path === '/r/docs/more.md'));
  assert.equal(called(shell, 'readDir').length, 0);
});

test('a stat that fails is treated as gone', async () => {
  const { shell, index } = await patched(repo());
  shell.stat = async () => {
    throw new Error('io');
  };
  index.applyEvents([{ kind: 'modified', path: '/r/docs/guide.md' }]);
  await index.settled();
  assert.ok(!index.entries().some((e) => e.path === '/r/docs/guide.md'));
});
