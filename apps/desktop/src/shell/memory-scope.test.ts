// The memory shell's model of the desktop shell's scope (src-tauri/src/scope.rs), case by case as scope_tests.rs has it.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { createMemoryShell } from './memory.ts';

// ASCII fixtures, as bytes: the shell's folder holds no text conversion (gate-fidelity).
const enc = (s: string): Uint8Array => Uint8Array.from(s, (c) => c.charCodeAt(0));
const tree = (): Record<string, Uint8Array> => ({
  '/r/.git/HEAD': enc('ref: refs/heads/main\n'),
  '/r/docs/a.md': enc('# a\n'),
  '/r/docs/b.md': enc('# b\n'),
  '/r/.env': enc('KEY=1\n'),
  '/out/secret.md': enc('# secret\n'),
  '/data/history.json': enc('{}'),
});
const code = async (p: Promise<unknown>): Promise<string> => p.then(() => 'ok', (e: { code?: string }) => e.code ?? 'thrown');

test('a scoped shell refuses everything the reader has not opened or chosen, and its own folders never', async () => {
  const shell = createMemoryShell(tree(), { scoped: true });
  assert.equal(await code(shell.readFile('/r/docs/a.md')), 'outside');
  assert.equal(await code(shell.readDir('/out')), 'outside');
  assert.equal(await code(shell.readFile('/data/history.json')), 'ok');
  // Unscoped (the unit tests' fake disk), everything is there.
  assert.equal(await code(createMemoryShell(tree()).readFile('/out/secret.md')), 'ok');
});

test('an opened file is read, its neighbours listed but not read, and a new name made beside it', async () => {
  const shell = createMemoryShell(tree(), { scoped: true });
  await shell.markOpened('/r/docs/a.md');
  assert.equal(await code(shell.readFile('/r/docs/a.md')), 'ok');
  assert.equal(await code(shell.readFile('/r/docs/b.md')), 'outside');
  assert.equal(await code(shell.readDir('/r/docs')), 'ok');
  assert.equal(await code(shell.stat('/')), 'ok', 'the breadcrumbs stat every folder above');
  assert.equal(await code(shell.readDir('/')), 'outside', "but list only a place or an opened file's folder");
  assert.equal(await code(shell.readHead('/r/.git/HEAD', 8)), 'ok', 'the repository probe above an opened file');
  assert.equal(await code(shell.readFile('/r/.env')), 'outside');
  assert.equal(await code(shell.writeFileNew('/r/docs/a (fork).md', enc('x'))), 'ok');
  assert.equal(await code(shell.writeFileAtomic('/r/docs/b.md', enc('x'))), 'outside');
});

test('a root is read whole by the commands, dot files too, but only opened files and scoped folders are served', async () => {
  const shell = createMemoryShell(tree(), { scoped: true });
  await shell.markOpened('/r', 'root');
  assert.equal(await code(shell.readHead('/r/.env', 3)), 'ok');
  assert.equal(await code(shell.writeFileAtomic('/r/docs/a.md', enc('x'))), 'outside', 'a root is read-only');
  assert.equal(await code(shell.writeFileNew('/r/new.md', enc('x'))), 'outside');
  assert.equal(await code(shell.readRange('/r/docs/a.md', 0, 2)), 'refused');
  await shell.allowAssetScope('/r');
  assert.equal(await code(shell.readRange('/r/docs/a.md', 0, 2)), 'ok');
  assert.equal(await code(shell.readRange('/r/.env', 0, 2)), 'refused', 'a dot file below a scoped folder is not served');
  assert.equal(await code(shell.readFile('/r/docs/../../out/secret.md')), 'outside');
  assert.equal(await code(shell.markOpened('/', 'root')), 'outside');
  assert.equal(await code(shell.markOpened('/nowhere', 'root')), 'outside');
});

test('a Save as name is the reader\'s to write before any file is there', async () => {
  const shell = createMemoryShell(tree(), { scoped: true });
  shell.queueSaveDialog('/out/new.md');
  assert.equal(await shell.saveDialog(), '/out/new.md');
  assert.equal(await code(shell.writeFileAtomic('/out/new.md', enc('x'))), 'ok');
  assert.equal(await code(shell.readFile('/out/secret.md')), 'outside');
});
