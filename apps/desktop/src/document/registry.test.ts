// The store registry: one store per open path, counted by
// the views holding it, closed by the last one to let go. Node only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStoreRegistry } from './registry.ts';
import { openDocumentStore, type DocumentStore, type StoreIo } from './store.ts';

const enc = new TextEncoder();
const io: StoreIo = { writeFileAtomic: async () => {} };

function opener(path: string, text: string): { open: () => DocumentStore; readonly made: DocumentStore[] } {
  const made: DocumentStore[] = [];
  return {
    made,
    open: () => {
      const store = openDocumentStore(io, path, enc.encode(text));
      made.push(store);
      return store;
    },
  };
}

function closed(store: DocumentStore): Promise<boolean> {
  // A closed store refuses every transition.
  return store.undo().then(
    () => false,
    () => true,
  );
}

test('the same path gives the same store, and different paths different ones', () => {
  const stores = createStoreRegistry();
  const a = opener('/r/A.md', '# A\n');
  const b = opener('/r/B.md', '# B\n');
  const first = stores.acquire('/r/A.md', a.open);
  const again = stores.acquire('/r/A.md', a.open);
  const other = stores.acquire('/r/B.md', b.open);
  assert.equal(again, first);
  assert.notEqual(other, first);
  assert.equal(a.made.length, 1, 'the second view of A parsed nothing');
  assert.equal(stores.views(first), 2);
  assert.equal(stores.views(other), 1);
  assert.equal(stores.held('/r/A.md'), first);
  assert.equal(stores.held('/r/C.md'), null);
});

test('the last view to let go closes the store; an earlier one does not', async () => {
  const stores = createStoreRegistry();
  const a = opener('/r/A.md', '# A\n');
  const store = stores.acquire('/r/A.md', a.open);
  stores.acquire('/r/A.md', a.open);
  assert.equal(stores.release(store), false);
  assert.equal(await closed(store), false, 'one view still shows it');
  assert.equal(stores.views(store), 1);
  assert.equal(stores.release(store), true);
  assert.equal(await closed(store), true);
  assert.equal(stores.held('/r/A.md'), null);
  // The next open of the path is a new store, read afresh.
  const next = stores.acquire('/r/A.md', a.open);
  assert.notEqual(next, store);
  assert.equal(a.made.length, 2);
});

test('a store follows its file through a Save as, and one closed elsewhere is forgotten', async () => {
  const stores = createStoreRegistry();
  const a = opener('/r/A.md', '# A\n');
  const store = stores.acquire('/r/A.md', a.open);
  await store.apply({ range: { file: '/r/A.md', start: 2, end: 3 }, replacement: 'Z', label: 'edit' });
  await store.save({ to: '/r/Z.md' });
  assert.equal(stores.held('/r/Z.md'), store);
  assert.equal(stores.held('/r/A.md'), null);
  store.close();
  assert.equal(stores.held('/r/Z.md'), null);
  assert.equal(stores.views(store), 0);
});

test('a store that closes is said by its path, so the shell can let its stale-write record go', async () => {
  const gone: string[] = [];
  const stores = createStoreRegistry({
    onClosed: (path) => {
      gone.push(path);
    },
  });
  const a = opener('/r/A.md', '# A\n');
  const store = stores.acquire('/r/A.md', a.open);
  stores.acquire('/r/A.md', a.open);
  stores.release(store);
  assert.deepEqual(gone, [], 'another view still holds it');
  stores.release(store);
  assert.deepEqual(gone, ['/r/A.md']);
  // Closed by anything else (the app going) says so too.
  const b = stores.acquire('/r/B.md', opener('/r/B.md', '# B\n').open);
  b.close();
  assert.deepEqual(gone, ['/r/A.md', '/r/B.md']);
});

test('a store closed while its save is running is said closed at once, and the step it hands back runs only once the save is done', async () => {
  const said: string[] = [];
  const gone: string[] = [];
  const stores = createStoreRegistry({
    onClosed: (path) => {
      said.push(path);
      return () => gone.push(path);
    },
  });
  let go: () => void = () => {};
  const held = new Promise<void>((r) => (go = r));
  const written: string[] = [];
  const slow: StoreIo = {
    writeFileAtomic: async (path) => {
      await held;
      written.push(path);
    },
  };
  const store = stores.acquire('/r/A.md', () => openDocumentStore(slow, '/r/A.md', enc.encode('# A\n')));
  await store.apply({ range: { file: '/r/A.md', start: 2, end: 3 }, replacement: 'Z', label: 'edit' });
  const saving = store.save();
  await new Promise((r) => setTimeout(r, 0));
  stores.release(store);
  assert.equal(stores.held('/r/A.md'), null, 'no view can take it any more');
  assert.deepEqual(said, ['/r/A.md']);
  assert.deepEqual(gone, [], 'the save has not written yet');
  go();
  assert.equal((await saving).result, 'saved');
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(written, ['/r/A.md']);
  assert.deepEqual(gone, ['/r/A.md']);
});

test('on Windows one file is one store whatever the case of its path; elsewhere the case is part of the name', () => {
  const stores = createStoreRegistry();
  const win = opener('C:\\Notes\\Plan.md', '# Plan\n');
  const first = stores.acquire('C:\\Notes\\Plan.md', win.open);
  assert.equal(stores.acquire('c:\\notes\\PLAN.md', win.open), first, 'another case of the same name');
  assert.equal(stores.acquire('C:/Notes/plan.MD', win.open), first, 'and with forward slashes');
  assert.equal(stores.held('\\\\?\\C:\\NOTES\\Plan.md'), first, 'and in its verbatim spelling');
  assert.equal(win.made.length, 1, 'one store was made');
  assert.equal(stores.views(first), 3);
  assert.equal(stores.held('C:\\Notes\\Plan.md.bak'), null);
  assert.equal(stores.held('D:\\Notes\\Plan.md'), null);
  const posix = opener('/r/Plan.md', '# Plan\n');
  const upper = stores.acquire('/r/Plan.md', posix.open);
  const lower = stores.acquire('/r/plan.md', opener('/r/plan.md', '# plan\n').open);
  assert.notEqual(lower, upper, 'two names on a case-sensitive volume are two files');
});

const warmPolicy = (limit = 3) => ({ limit, keeps: (s: DocumentStore) => !s.snapshot().dirty });

test('a store released with keep stays open and is claimed back whole; held and acquire do not see it', async () => {
  const stores = createStoreRegistry({ warm: warmPolicy() });
  const a = opener('/r/A.md', '# A\n');
  const store = stores.acquire('/r/A.md', a.open);
  assert.equal(stores.release(store, { keep: true }), false);
  assert.equal(await closed(store), false);
  assert.equal(stores.held('/r/A.md'), null, 'no view holds it');
  assert.deepEqual(stores.warm(), [store]);
  assert.equal(stores.claim('/r/A.md'), store);
  assert.equal(stores.views(store), 1);
  assert.deepEqual(stores.warm(), []);
  assert.equal(a.made.length, 1, 'nothing was made again');
});

test('without keep, or without a policy, a released store closes as before', async () => {
  const stores = createStoreRegistry({ warm: warmPolicy() });
  const a = opener('/r/A.md', '# A\n');
  const one = stores.acquire('/r/A.md', a.open);
  assert.equal(stores.release(one), true);
  const plain = createStoreRegistry();
  const two = plain.acquire('/r/A.md', a.open);
  assert.equal(plain.release(two, { keep: true }), true);
  assert.equal(await closed(two), true);
});

test('a fourth warm store evicts the oldest, which closes and tells onClosed', async () => {
  const gone: string[] = [];
  const stores = createStoreRegistry({ warm: warmPolicy(), onClosed: (p) => void gone.push(p) });
  const made = ['A', 'B', 'C', 'D'].map((n) => stores.acquire(`/r/${n}.md`, opener(`/r/${n}.md`, `# ${n}\n`).open));
  for (const s of made) stores.release(s, { keep: true });
  assert.equal(stores.warm().length, 3);
  assert.equal(await closed(made[0]!), true);
  assert.deepEqual(gone, ['/r/A.md']);
  assert.equal(stores.claim('/r/A.md'), null);
});

test('a dirty store is not kept, and a store that went dirty while warm is not claimed', async () => {
  const stores = createStoreRegistry({ warm: warmPolicy() });
  const a = opener('/r/A.md', '# A\n');
  const dirty = stores.acquire('/r/A.md', a.open);
  await dirty.apply({ range: { file: '/r/A.md', start: 0, end: 1 }, replacement: '!', label: 'edit' });
  assert.equal(stores.release(dirty, { keep: true }), true, 'unsaved edits are never backgrounded');
  const b = opener('/r/B.md', '# B\n');
  const warm = stores.acquire('/r/B.md', b.open);
  stores.release(warm, { keep: true });
  await warm.apply({ range: { file: '/r/B.md', start: 0, end: 1 }, replacement: '!', label: 'edit' });
  assert.equal(stores.claim('/r/B.md'), null);
  assert.equal(await closed(warm), true);
});

test('acquire for a path with a warm store closes it without forgetting the new store\'s read record', async () => {
  const gone: string[] = [];
  const stores = createStoreRegistry({ warm: warmPolicy(), onClosed: (p) => void gone.push(p) });
  const a = opener('/r/A.md', '# A\n');
  const old = stores.acquire('/r/A.md', a.open);
  stores.release(old, { keep: true });
  const next = stores.acquire('/r/A.md', a.open);
  assert.notEqual(next, old);
  assert.equal(await closed(old), true);
  assert.deepEqual(gone, [], 'the path\'s record belongs to the new store');
});

test('unseen marks are taken once, drop and retain close warm stores, and a store moved onto a warm path evicts it', async () => {
  const stores = createStoreRegistry({ warm: warmPolicy() });
  const [a, b, c] = ['A', 'B', 'C'].map((n) => stores.acquire(`/r/${n}.md`, opener(`/r/${n}.md`, `# ${n}\n`).open));
  stores.release(a!, { keep: true });
  stores.markUnseen(a!);
  assert.equal(stores.takeUnseen(a!), true);
  assert.equal(stores.takeUnseen(a!), false);
  assert.equal(stores.drop('/r/A.md'), true);
  assert.equal(await closed(a!), true);
  stores.release(b!, { keep: true });
  stores.retain(['/r/Z.md']);
  assert.equal(await closed(b!), true);
  const d = stores.acquire('/r/D.md', opener('/r/D.md', '# D\n').open);
  const e = stores.acquire('/r/E.md', opener('/r/E.md', '# E\n').open);
  stores.release(e, { keep: true });
  await d.rename('/r/E.md');
  assert.equal(await closed(e), true, 'two stores for one file would each save it');
  assert.equal(stores.held('/r/E.md'), d);
  void c;
});
