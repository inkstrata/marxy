// The palette's command list, chord labels and key dispatch (A-12).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AppContext, Command } from '../commands/registry.ts';
import { commandForKey, keyLabel, paletteCommands } from './commands.ts';
import { documentCommands } from '../commands/document.ts';
import { setAppHandle } from '../commands/app-handle.ts';
import type { AppHandle } from '../app.ts';
import { DISK_CHANGED_CHOOSE } from '../notices/disk.ts';
import { openDocumentStore, type DocumentStore } from '../document/store.ts';

const ctx = {
  shell: { clipboardWrite: async () => {} },
  selection: { kind: 'none' },
  document: null,
  operationInput: () => null,
  closePalette: () => {},
  showNotice: () => {},
} as AppContext;

function cmd(id: string, title: string, group: Command['group'], extra: Partial<Command> = {}): Command {
  return { id, title, group, when: () => true, run: async () => {}, ...extra };
}

const key = (k: string, mods: { meta?: boolean; ctrl?: boolean; shift?: boolean; alt?: boolean } = {}) => ({
  key: k,
  metaKey: mods.meta === true,
  ctrlKey: mods.ctrl === true,
  shiftKey: mods.shift === true,
  altKey: mods.alt === true,
});

test('paletteCommands keeps only the commands whose when holds', () => {
  const all = [
    cmd('a', 'Save', 'document'),
    cmd('b', 'Undo', 'document', { when: () => false }),
  ];
  assert.deepEqual(paletteCommands(all, ctx, '').map((c) => c.id), ['a']);
});

test('paletteCommands filters by title on the query and ignores case and edge space', () => {
  const all = [cmd('a', 'Save', 'document'), cmd('b', 'Save as', 'document'), cmd('c', 'Toggle line numbers in Source', 'view')];
  assert.deepEqual(paletteCommands(all, ctx, ' SAVE ').map((c) => c.id), ['a', 'b']);
  assert.deepEqual(paletteCommands(all, ctx, 'zzzz').map((c) => c.id), []);
});

test('paletteCommands orders by group (document, view, app, selection) then title', () => {
  const all = [
    cmd('s1', 'Copy code', 'selection'),
    cmd('a1', 'Zoom', 'app'),
    cmd('v1', 'Jump to source', 'view'),
    cmd('d2', 'Undo', 'document'),
    cmd('d1', 'Save', 'document'),
    cmd('a0', 'About', 'app'),
  ];
  assert.deepEqual(paletteCommands(all, ctx, '').map((c) => c.id), ['d1', 'd2', 'v1', 'a0', 'a1', 's1']);
});

test('keyLabel spells a chord for a Mac and for Linux', () => {
  assert.equal(keyLabel('Mod+Shift+S', true), '⇧⌘S');
  assert.equal(keyLabel('Mod+Shift+S', false), 'Ctrl+Shift+S');
  assert.equal(keyLabel('Mod+Z', true), '⌘Z');
  assert.equal(keyLabel('Mod+Z', false), 'Ctrl+Z');
  assert.equal(keyLabel('Alt+ArrowLeft', true), '⌥←');
  assert.equal(keyLabel('Alt+ArrowLeft', false), 'Alt+ArrowLeft');
});

test('commandForKey runs a global command from an editable and skips a non-global one', () => {
  const plain = cmd('plain', 'Plain', 'document', { key: 'Mod+K' });
  const global = cmd('global', 'Global', 'document', { key: 'Mod+K', global: true });
  const event = key('k', { meta: true });
  assert.equal(commandForKey(event, [plain, global], ctx, { inEditable: true, mac: true }), global);
  assert.equal(commandForKey(event, [plain], ctx, { inEditable: true, mac: true }), undefined);
  assert.equal(commandForKey(event, [plain, global], ctx, { inEditable: false, mac: true }), plain);
});

test('commandForKey matches an alternate chord in keys and checks when', () => {
  const two = cmd('two', 'Two', 'document', { key: 'Mod+[', keys: ['Alt+ArrowLeft'] });
  assert.equal(commandForKey(key('ArrowLeft', { alt: true }), [two], ctx, { inEditable: false, mac: true }), two);
  assert.equal(commandForKey(key('[', { ctrl: true }), [two], ctx, { inEditable: false, mac: false }), two);
  assert.equal(commandForKey(key('ArrowLeft'), [two], ctx, { inEditable: false, mac: true }), undefined);
  const off = cmd('off', 'Off', 'document', { key: 'Mod+O', when: () => false });
  assert.equal(commandForKey(key('o', { meta: true }), [off], ctx, { inEditable: false, mac: true }), undefined);
});

// ---- V-07: the two choices are commands, present only while a changed file waits for one ----

const KEEP = 'document.keep-mine-as-copy';
const TAKE = 'document.take-version-on-disk';
const dec = new TextDecoder();
const enc = new TextEncoder();

function conflictStore(): { store: DocumentStore; files: Map<string, Uint8Array>; writes: string[] } {
  const files = new Map<string, Uint8Array>([['/d/a.md', enc.encode('# One\n')]]);
  const writes: string[] = [];
  const store = openDocumentStore(
    {
      async writeFileAtomic(path, bytes) { writes.push(path); files.set(path, new Uint8Array(bytes)); },
      async peekFile(path) { return files.get(path)!; },
      async exists(path) { return files.has(path); },
    },
    '/d/a.md',
    enc.encode('# One\n'),
  );
  return { store, files, writes };
}

test('the choice commands are absent from the palette when no changed file waits', async () => {
  const { store } = conflictStore();
  const withDoc = { ...ctx, document: store } as AppContext;
  const ids = (c: AppContext) => paletteCommands(documentCommands(), c, '').map((x) => x.id);
  assert.ok(!ids(ctx).includes(KEEP) && !ids(ctx).includes(TAKE), 'no document');
  assert.ok(!ids(withDoc).includes(KEEP) && !ids(withDoc).includes(TAKE), 'a document with nothing pending');
  // Dirty alone is not a conflict.
  await store.apply({ range: { file: '/d/a.md', start: 2, end: 5 }, replacement: 'Two', label: 'edit' });
  assert.ok(!ids(withDoc).includes(KEEP) && !ids(withDoc).includes(TAKE), 'unsaved edits alone');
  assert.equal(await store.reload(enc.encode('# Theirs\n')), 'kept');
  assert.ok(ids(withDoc).includes(KEEP) && ids(withDoc).includes(TAKE), 'present while a change waits');
});

function runWith(store: DocumentStore, id: string, app: Partial<AppHandle>, said: string[]): Promise<void> {
  setAppHandle(app as AppHandle);
  const context = { ...ctx, document: store, showNotice: (text: string) => void said.push(text) } as AppContext;
  return documentCommands().find((c) => c.id === id)!.run(context);
}

test('Source text not yet folded in is counted: Keep my version copies it, Take theirs discards it (V-07)', async () => {
  for (const id of [KEEP, TAKE]) {
    const { store, files, writes } = conflictStore();
    // Nothing in the store yet: the reader's edit is only in Source, which holds it while the file changes.
    assert.equal(await store.reload(enc.encode('# Theirs\n'), { holds: () => true }), 'kept');
    files.set('/d/a.md', enc.encode('# Theirs\n'));
    let unfolded = true;
    const said: string[] = [];
    await runWith(
      store,
      id,
      {
        hasUnfoldedSource: () => unfolded,
        async foldSource() {
          if (!unfolded) return;
          unfolded = false;
          await store.commitSource('# One typed in Source\n');
        },
      },
      said,
    );
    assert.equal(dec.decode(store.snapshot().buffer.bytes), '# Theirs\n');
    assert.equal(store.conflict(), null);
    if (id === KEEP) {
      assert.deepEqual(writes, ['/d/a (mine).md']);
      assert.equal(dec.decode(files.get('/d/a (mine).md')!), '# One typed in Source\n', 'the unfolded text is in the copy');
      assert.match(said.join(' '), /a \(mine\)\.md/);
    } else {
      assert.deepEqual(writes, [], 'discarding writes nothing');
    }
  }
});

test('a pane whose Source text cannot be folded is refused: nothing is written or discarded (V-07)', async () => {
  const { store, writes } = conflictStore();
  await store.apply({ range: { file: '/d/a.md', start: 2, end: 5 }, replacement: 'Two', label: 'edit' });
  assert.equal(await store.reload(enc.encode('# Theirs\n')), 'kept');
  const said: string[] = [];
  await runWith(store, TAKE, { hasUnfoldedSource: () => true, foldSource: async () => {} }, said);
  assert.equal(dec.decode(store.snapshot().buffer.bytes), '# Two\n');
  assert.ok(store.conflict(), 'still pending');
  assert.deepEqual(writes, []);
  assert.equal(said.length, 1);
});

test('a failed copy says why, and the edits and the pending choice stay (V-07)', async () => {
  const files = new Map<string, Uint8Array>([['/d/a.md', enc.encode('# One\n')]]);
  const store = openDocumentStore(
    {
      async writeFileAtomic() { throw new Error('the disk is full'); },
      async peekFile(path) { return files.get(path)!; },
      async exists() { return false; },
    },
    '/d/a.md',
    enc.encode('# One\n'),
  );
  await store.apply({ range: { file: '/d/a.md', start: 2, end: 5 }, replacement: 'Two', label: 'edit' });
  files.set('/d/a.md', enc.encode('# Theirs\n'));
  assert.equal(await store.reload(enc.encode('# Theirs\n')), 'kept');
  const said: string[] = [];
  await runWith(store, KEEP, { hasUnfoldedSource: () => false, foldSource: async () => {} }, said);
  assert.match(said[0] ?? '', /Could not save a copy: the disk is full\. Nothing was changed/);
  assert.equal(dec.decode(store.snapshot().buffer.bytes), '# Two\n');
  assert.ok(store.conflict());
});

test('the notice for a changed file names both commands by their palette titles, after what it always said (V-07)', () => {
  for (const id of [KEEP, TAKE]) {
    const title = documentCommands().find((c) => c.id === id)!.title;
    assert.ok(DISK_CHANGED_CHOOSE.includes(`"${title}"`), title);
  }
  assert.ok(DISK_CHANGED_CHOOSE.startsWith('The file changed on disk; your edits were kept.'));
});
