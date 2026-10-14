// F-85 (ADR-0074): every write Marxy makes beside a reader's file rather than over it is create-only. These are the callers over the
// memory shell, with a creator that makes the name between the caller's look and its write: *Fork this file*, *Keep mine as a
// copy* (`writeCopy`), and the shared `writeBeside` that *Restore to a copy* (V-06) writes through. On `main` the write was
// `writeFileAtomic`, whose rename replaces whatever is at the name, so each of these fails there.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMemoryShell, type MemoryShell } from '../shell/memory.ts';
import { forkPath, writeBeside, writeFork } from './fork.ts';
import { openDocumentStore, type DocumentStore } from './store.ts';

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { ignoreBOM: true });
const text = (shell: MemoryShell, path: string): Promise<string> => shell.peekFile(path).then((b) => dec.decode(b));
const writtenAtomically = (shell: MemoryShell): string[] => shell.calls.filter((c) => c.method === 'writeFileAtomic').map((c) => String(c.args[0]));

const PATH = '/r/x.md';
const MINE = '/r/x (mine).md';

/** A store on `/r/x.md` with unsaved edits, the file then changed on disk and the change refused: the state *Keep mine* resolves. */
async function conflicted(shell: MemoryShell): Promise<DocumentStore> {
  const original = await shell.peekFile(PATH);
  const store = openDocumentStore(
    {
      writeFileAtomic: (p, b) => shell.writeFileAtomic(p, b),
      writeFileNew: (p, b) => shell.writeFileNew(p, b),
      peekFile: (p) => shell.peekFile(p),
    },
    PATH,
    original,
  );
  await store.apply({ range: { file: PATH, start: 0, end: 3 }, replacement: 'two', label: 'edit' });
  shell.plant(PATH, enc.encode('three\n'));
  assert.equal(await store.reload(enc.encode('three\n')), 'kept');
  return store;
}

// ---- Fork this file --------------------------------------------------------------------------------------------

test('Fork: a creator that makes the fork name between the look and the write keeps its bytes; the fork is (fork 2)', async () => {
  const shell = createMemoryShell({ '/r/notes.md': enc.encode('# notes\n') });
  const planted = enc.encode('PLANTED by another program');
  shell.beforeWriteNew((path) => {
    if (path === '/r/notes (fork).md') shell.plant(path, planted);
  });
  const out = await writeFork(shell, '/r/notes.md', enc.encode('# notes\n'));
  assert.deepEqual(out, { result: 'written', path: '/r/notes (fork 2).md', n: 2 });
  assert.deepEqual([...(await shell.peekFile('/r/notes (fork).md'))], [...planted]);
  assert.equal(await text(shell, '/r/notes (fork 2).md'), '# notes\n');
  assert.deepEqual(writtenAtomically(shell), [], 'nothing that replaces was called');
});

test('Fork: a symlink at the name is left as it is and its target keeps its bytes', async () => {
  const shell = createMemoryShell({ '/r/notes.md': enc.encode('# notes\n'), '/r/precious.md': enc.encode('PRECIOUS') });
  shell.symlink(forkPath('/r/notes.md', 1), '/r/precious.md');
  const out = await writeFork(shell, '/r/notes.md', enc.encode('# notes\n'));
  assert.equal(out.result === 'written' && out.n, 2);
  assert.equal(await text(shell, '/r/precious.md'), 'PRECIOUS');
});

test('Fork: a folder, a dangling link and a case variant are all skipped, in one walk, and nothing is replaced', async () => {
  const shell = createMemoryShell({ '/r/notes.md': enc.encode('a'), [`${forkPath('/r/notes.md', 1)}/inside`]: enc.encode('in'), [forkPath('/r/notes.md', 3).toUpperCase()]: enc.encode('CASED') }, { caseInsensitive: true });
  shell.symlink(forkPath('/r/notes.md', 2), '/r/nowhere.md');
  const out = await writeFork(shell, '/r/notes.md', enc.encode('b'));
  assert.deepEqual(out, { result: 'written', path: forkPath('/r/notes.md', 4), n: 4 });
  assert.equal(await text(shell, forkPath('/r/notes.md', 3).toUpperCase()), 'CASED');
  assert.equal(await text(shell, `${forkPath('/r/notes.md', 1)}/inside`), 'in');
  assert.equal(shell.hasFile('/r/nowhere.md'), false);
});

// ---- Keep mine as a copy ---------------------------------------------------------------------------------------

test('Keep mine: a creator that makes "x (mine).md" between the look and the write keeps its bytes; the copy is (mine 2)', async () => {
  const shell = createMemoryShell({ [PATH]: enc.encode('one\n') });
  const store = await conflicted(shell);
  const buffer = store.snapshot().buffer.bytes.slice();
  const planted = enc.encode('PLANTED');
  shell.beforeWriteNew((path) => {
    if (path === MINE) shell.plant(path, planted);
  });
  const out = await store.resolveConflict('mine');
  assert.deepEqual(out, { result: 'resolved', copy: '/r/x (mine 2).md' });
  assert.deepEqual([...(await shell.peekFile(MINE))], [...planted]);
  assert.deepEqual([...(await shell.peekFile('/r/x (mine 2).md'))], [...buffer], 'the copy is the buffer, byte for byte');
  assert.deepEqual(writtenAtomically(shell), [], 'the copy was never written with the write that replaces');
});

test('Keep mine: a symlink at "x (mine).md" is not written through: the copy is (mine 2) and the link and its target are unchanged', async () => {
  const shell = createMemoryShell({ [PATH]: enc.encode('one\n'), '/r/other.md': enc.encode('OTHER FILE') });
  shell.symlink(MINE, '/r/other.md');
  const store = await conflicted(shell);
  const out = await store.resolveConflict('mine');
  assert.deepEqual(out, { result: 'resolved', copy: '/r/x (mine 2).md' });
  assert.equal(await text(shell, '/r/other.md'), 'OTHER FILE');
  await assert.rejects(shell.writeFileNew(MINE, enc.encode('x')), (e: { code?: string }) => e.code === 'exists', 'the link is still at the name');
});

test('Keep mine: a folder and a case variant at the name are skipped and left alone', async () => {
  const shell = createMemoryShell({ [PATH]: enc.encode('one\n'), '/r/x (mine).md/inside': enc.encode('in'), '/r/X (MINE 2).md': enc.encode('CASED') }, { caseInsensitive: true });
  const store = await conflicted(shell);
  const out = await store.resolveConflict('mine');
  assert.deepEqual(out, { result: 'resolved', copy: '/r/x (mine 3).md' });
  assert.equal(await text(shell, '/r/X (MINE 2).md'), 'CASED');
});

test('Keep mine: when the write is refused for any other reason it fails with that reason and writes nothing', async () => {
  const shell = createMemoryShell({ [PATH]: enc.encode('one\n') });
  const store = await conflicted(shell);
  shell.rejectNextWrite('permission');
  const out = await store.resolveConflict('mine');
  assert.equal(out.result, 'failed');
  assert.equal(shell.hasFile(MINE), false);
  assert.ok(store.conflict(), 'the choice is still pending');
});

// ---- Restore to a copy (V-06) ----------------------------------------------------------------------------------

test('writeBeside, the writer Restore to a copy goes through: a creator at the version copy name keeps its bytes', async () => {
  // V-06's `restoreToCopy` is `writeBeside` with `versionCopyPath` as the namer. V-06 (#717) is not on main when this lands, so its own
  // caller test is V-06's to add; this holds the rule it inherits.
  const shell = createMemoryShell({ [PATH]: enc.encode('now\n') });
  const name = (n: number): string => `/r/x (version 14.32${n > 1 ? ` ${n}` : ''}).md`;
  shell.beforeWriteNew((path) => {
    if (path === name(1)) shell.plant(path, enc.encode('PLANTED'));
  });
  const out = await writeBeside(shell, name, enc.encode('old\n'), { max: 999, what: 'version copy names' });
  assert.deepEqual(out, { result: 'written', path: name(2), n: 2 });
  assert.equal(await text(shell, name(1)), 'PLANTED');
  assert.equal(await text(shell, name(2)), 'old\n');
  assert.equal(await text(shell, PATH), 'now\n', 'the file the version belongs to is untouched');
});
