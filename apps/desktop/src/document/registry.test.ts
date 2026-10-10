// The store registry (D-01 under P1; ADR-0037 Amendment 1, point 1): one store per open path, counted by
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
