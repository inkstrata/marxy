// The registry's context reads the open document from the store, and its edits carry the version the
// selection was read at (B-12, from the B-11 review): an edit resolved before another change is refused.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AppHandle } from '../app.ts';
import { openDocumentStore, type DocumentStore } from '../document/store.ts';
import { buildAppContext } from './bind.ts';
import type { RenderedSelection, SelectionShell } from './view.ts';
import type { Selection } from './selection.ts';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const shell = { clipboardWrite: async () => {} } as unknown as SelectionShell;

/** An app handle with `store` open and `selected` selected, as far as `buildAppContext` reads one. */
function handleFor(store: DocumentStore, selected: Selection): AppHandle {
  const selection = {
    state: () => ({ selection: selected }),
    runtime: () => {
      const snap = store.snapshot();
      return { article: null, nodeMap: snap.nodeMap, document: snap.ast, buffer: snap.buffer, version: snap.version, shell };
    },
  } as unknown as RenderedSelection;
  return { selection, document: () => store, shell } as unknown as AppHandle;
}

function storeOf(text: string): DocumentStore {
  return openDocumentStore({ writeFileAtomic: async () => {} }, '/doc.md', encoder.encode(text));
}

const bytes = (store: DocumentStore): string => decoder.decode(store.snapshot().buffer.bytes);

test('a context with no document has no selection and no operation input', () => {
  const ctx = buildAppContext(null);
  assert.equal(ctx.document, null);
  assert.equal(ctx.selection.kind, 'none');
  assert.equal(ctx.operationInput(), null);
});

test('the context reads the selection and the document from the store', async () => {
  const store = storeOf('# T\n\nbody\n');
  const ctx = buildAppContext(handleFor(store, { kind: 'document' }));
  assert.equal(ctx.document, store);
  const input = ctx.operationInput();
  assert.ok(input);
  assert.equal(input.text, '# T\n\nbody\n');
  assert.equal(await ctx.applyBufferMutation?.({ range: input.range, replacement: '# U\n', label: 'test' }), true);
  assert.equal(bytes(store), '# U\n');
});

test('an edit resolved before another change is refused, and the store keeps the other change', async () => {
  const store = storeOf('# T\n\nbody\n');
  const ctx = buildAppContext(handleFor(store, { kind: 'document' }));
  const input = ctx.operationInput();
  assert.ok(input);
  // Another view's edit lands between the selection being read and its operation applying.
  assert.equal(await store.apply({ range: { file: '/doc.md', start: 0, end: 0 }, replacement: 'x', label: 'other' }), true);
  const written = await ctx.applyBufferMutation?.({ range: input.range, replacement: '# U\n', label: 'test' });
  assert.equal(written, false);
  assert.equal(bytes(store), 'x# T\n\nbody\n');
});

test('an edit resolved before a save still applies: the version moved, the bytes did not', async () => {
  const store = storeOf('# T\n\nbody\n');
  await store.apply({ range: { file: '/doc.md', start: 4, end: 4 }, replacement: 'x', label: 'dirty' });
  const ctx = buildAppContext(handleFor(store, { kind: 'document' }));
  const input = ctx.operationInput();
  assert.ok(input);
  // A tick made while a save is in flight: the save commits first and bumps the version.
  const read = store.snapshot().version;
  assert.equal((await store.save()).result, 'saved');
  assert.notEqual(store.snapshot().version, read);
  assert.equal(await ctx.applyBufferMutation?.({ range: input.range, replacement: '# U\n', label: 'test' }), true);
  assert.equal(bytes(store), '# U\n');
});
