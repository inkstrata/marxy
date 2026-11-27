// A patch from a tree watch reads one file narrowly: one stat and at most the head of a markdown
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

test('the first walk reads each markdown file\'s head only, a few at a time', async () => {
  const files: Record<string, Uint8Array> = { '/r/.git/HEAD': enc('ref: refs/heads/main\n') };
  const big = new Uint8Array(10 * 1024 * 1024).fill(97);
  big.set(enc('# Huge\n\n'));
  files['/r/huge.md'] = big;
  for (let i = 0; i < 60; i++) files[`/r/n/${i}.md`] = enc(`# Note ${i}\n`);
  const shell = createMemoryShell(files);
  let inFlight = 0;
  let most = 0;
  const head = shell.readHead.bind(shell);
  shell.readHead = async (path, max) => {
    most = Math.max(most, ++inFlight);
    try {
      await new Promise((r) => setTimeout(r, 1));
      return await head(path, max);
    } finally {
      inFlight--;
    }
  };
  const index = createIndexService(shell);
  await index.ensureRoot('/r');
  await index.settled();
  const mds = (method: string) => called(shell, method).filter((c) => String(c.args[0]).endsWith('.md'));
  assert.equal(mds('readFile').length, 0, 'no markdown file is read whole');
  assert.deepEqual(mds('readHead').find((c) => c.args[0] === '/r/huge.md')?.args, ['/r/huge.md', HEAD]);
  assert.equal(index.entries().find((e) => e.path === '/r/huge.md')?.title, 'Huge');
  assert.equal(index.entries().filter((e) => e.path.startsWith('/r/n/')).length, 60);
  assert.ok(most <= 16, `${most} head reads at once`);
});

test('entries take the reader\'s [[kind]] rules and Show as, from the first walk and again when they change', async () => {
  const { setShowAs, emptyKindsEnvelope } = await import('@marxy/core/src/kind/show-as.ts');
  const shell = createMemoryShell({ '/r/.git/HEAD': enc('ref: refs/heads/main\n'), '/r/a.txt': enc('plain\n'), '/r/b.txt': enc('plain\n') });
  const index = createIndexService(shell, { readerKinds: async () => ({ rules: [{ glob: '**/a.txt', is: 'log' }] }) });
  await index.ensureRoot('/r');
  await index.settled();
  const kindOf = (path: string) => index.entries().find((e) => e.path === path)?.readerKind;
  assert.equal(kindOf('/r/a.txt'), 'log', 'the rule, from the first walk');
  const plain = kindOf('/r/b.txt');
  assert.notEqual(plain, 'report');
  const shown = setShowAs(emptyKindsEnvelope(), '/r/b.txt', 'report');
  assert.ok(shown.ok);
  index.setKinds({ choices: shown.envelope });
  assert.equal(kindOf('/r/b.txt'), 'report', 'Show as, at once');
  assert.notEqual(kindOf('/r/a.txt'), 'log', 'the rule is gone');
});
