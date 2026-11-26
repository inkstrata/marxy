import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { AppHandle } from '../app-types.ts';
import { installChangesWatch } from '../changes/state.ts';
import type { Note } from './anchor.ts';

const FILE = '/data/notes.json';
const note = (l0: number, key: string, text = 'n'): Note => ({ l0, l1: l0 + 1, key, text });
const enc = new TextEncoder();
const dec = new TextDecoder();

type Change = { kind: string; renamedFrom?: string };

/** A fake document in a pane: its text can be changed and its path moved, as a store's transitions do. */
function fakeDoc(path: string, text: string) {
  const subs = new Set<(snap: unknown, change: Change) => void>();
  let snap = { path, buffer: { text, bytes: enc.encode(text) }, dirty: false, disk: null };
  const store = {
    snapshot: () => snap,
    subscribe(cb: (snap: unknown, change: Change) => void) {
      subs.add(cb);
      return () => subs.delete(cb);
    },
  };
  const set = (next: Partial<{ path: string; text: string }>, change: Change): void => {
    const t = next.text ?? snap.buffer.text;
    snap = { ...snap, path: next.path ?? snap.path, buffer: { text: t, bytes: enc.encode(t) } };
    for (const cb of [...subs]) cb(snap, change);
  };
  return { store, set };
}

/** A fresh notes store (its module state is its own) over a fake shell. */
async function setup(opts: { read: () => Promise<Uint8Array>; configPaths?: () => Promise<{ data: string }>; docs?: ReturnType<typeof fakeDoc>[] }) {
  const mod = (await import(`./store.ts?${Math.random()}`)) as typeof import('./store.ts');
  const writes: string[] = [];
  const shell = {
    readFile: async (p: string) => {
      assert.equal(p, FILE);
      return opts.read();
    },
    writeFileAtomic: async (_p: string, bytes: Uint8Array) => {
      writes.push(dec.decode(bytes));
    },
    configPaths: opts.configPaths ?? (async () => ({ data: '/data' })),
  };
  const panes = (opts.docs ?? []).map((d) => ({ content: { store: () => d.store } }));
  const handle = { shell, panes: () => ({ panes, onChange: () => () => {}, onAnyDocumentChange: () => () => {} }) } as unknown as AppHandle;
  const offWatch = installChangesWatch(handle);
  const offNotes = mod.installNotesStore(handle);
  await mod.notesLoaded();
  return { mod, writes, off: () => (offNotes(), offWatch()) };
}

const ioError = (): Promise<never> => Promise.reject(Object.assign(new Error('denied'), { code: 'io' }));
const missing = (): Promise<never> => Promise.reject(Object.assign(new Error('not found'), { code: 'not-found' }));
const fileOf = (files: Record<string, Note[]>): Uint8Array => enc.encode(JSON.stringify({ version: 1, files }));

test('notes.json that could not be read is never written over; a later read that works merges and then writes', async () => {
  let read: () => Promise<Uint8Array> = ioError;
  const { mod, writes, off } = await setup({ read: () => read() });
  mod.setNotes('/r/a.md', [note(0, 'a')]);
  await mod.flushNotes();
  assert.deepEqual(writes, [], 'a read that failed is not an empty file');
  read = async () => fileOf({ '/r/b.md': [note(2, 'b', 'kept')] });
  await mod.flushNotes();
  assert.equal(writes.length, 1);
  assert.deepEqual(Object.keys(JSON.parse(writes[0]!).files), ['/r/a.md', '/r/b.md'], "the file's notes are kept beside the new one");
  off();
});

test('notes.json with no data folder answer yet is not written; a missing one is written', async () => {
  let paths: () => Promise<{ data: string }> = () => Promise.reject(new Error('no paths'));
  const failed = await setup({ read: missing, configPaths: () => paths() });
  failed.mod.setNotes('/r/a.md', [note(0, 'a')]);
  await failed.mod.flushNotes();
  assert.deepEqual(failed.writes, []);
  paths = async () => ({ data: '/data' });
  await failed.mod.flushNotes();
  assert.equal(failed.writes.length, 1, 'once the folder is known and the file is missing, it is written');
  failed.off();
});

test("a scratch's notes stay in memory, and a Save As takes them to the new path", async () => {
  const doc = fakeDoc('untitled', 'one\ntwo\n');
  const { mod, writes, off } = await setup({ read: missing, docs: [doc] });
  mod.setNotes('untitled', [note(1, 'two')]);
  await mod.flushNotes();
  assert.deepEqual(JSON.parse(writes.at(-1)!).files, {}, 'nothing of the scratch is written');
  doc.set({ path: '/r/saved.md' }, { kind: 'save', renamedFrom: 'untitled' });
  assert.deepEqual(mod.notesFor('untitled'), []);
  assert.deepEqual(mod.notesFor('/r/saved.md'), [note(1, 'two')]);
  await mod.flushNotes();
  assert.deepEqual(Object.keys(JSON.parse(writes.at(-1)!).files), ['/r/saved.md']);
  off();
});

test('a note follows edits to its file, and an edit that moves nothing writes nothing', async () => {
  const doc = fakeDoc('/r/a.md', 'a\nb\nc\n');
  const { mod, writes, off } = await setup({ read: async () => fileOf({ '/r/a.md': [note(1, 'b')] }), docs: [doc] });
  await mod.flushNotes();
  const before = writes.length;
  doc.set({ text: 'a!\nb\nc\n' }, { kind: 'apply' });
  await mod.flushNotes();
  assert.equal(writes.length, before + 1, 'flush writes once');
  const list = mod.notesFor('/r/a.md');
  doc.set({ text: 'a!!\nb\nc\n' }, { kind: 'apply' });
  assert.equal(mod.notesFor('/r/a.md'), list, 'an edit above that adds no line: the same notes');
  doc.set({ text: 'a!!\nb, edited\nc\n' }, { kind: 'apply' });
  assert.deepEqual(mod.notesFor('/r/a.md'), [note(1, 'b, edited')], 'the noted line edited: key refreshed');
  doc.set({ text: 'new\na!!\nb, edited\nc\n' }, { kind: 'apply' });
  assert.deepEqual(mod.notesFor('/r/a.md'), [note(2, 'b, edited')], 'a line added above: moved down');
  off();
});

test('notes kept under a backslash path by an earlier build read under the slashed path, merged, each note once', async () => {
  const mod = (await import(`./store.ts?${Math.random()}`)) as typeof import('./store.ts');
  const read = mod.parseNotesFile(
    JSON.stringify({ version: 1, files: { 'C:\\n\\a.md': [note(1, 'k1'), note(3, 'k2')], 'C:/n/a.md': [note(3, 'k2'), note(5, 'k3')] } }),
  );
  assert.deepEqual([...read.keys()], ['C:/n/a.md']);
  assert.deepEqual(read.get('C:/n/a.md')!.map((n) => n.key), ['k1', 'k2', 'k3']);
});
