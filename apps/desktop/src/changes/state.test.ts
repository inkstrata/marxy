import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { AppHandle } from '../app-types.ts';
import { followAnyDocument } from '../pane/any-document.ts';
import { installChangesWatch, onChangesSummary } from './state.ts';

type Change = { kind: string };

function fakeStore(path: string) {
  const subs = new Set<(snap: { path: string }, change: Change) => void>();
  return {
    snapshot: () => ({ path }),
    subscribe(cb: (snap: { path: string }, change: Change) => void) {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    edit: () => subs.forEach((cb) => cb({ path }, { kind: 'edit' })),
  };
}

/** A pane whose content opens a store directly, as a followed link does: no pane-set event follows. */
function fakePane(first: ReturnType<typeof fakeStore> | null) {
  let store = first;
  const docs = new Set<() => void>();
  return {
    content: {
      store: () => store,
      onDocumentChange: (cb: () => void) => (docs.add(cb), () => docs.delete(cb)),
    },
    openDirectly(next: ReturnType<typeof fakeStore>) {
      store = next;
      docs.forEach((cb) => cb());
    },
  };
}

function setup() {
  const left = fakePane(fakeStore('/r/left.md'));
  const right = fakePane(fakeStore('/r/right.md'));
  const panes = { panes: [left, right], onChange: () => () => {} };
  const handle = {
    panes: () => ({ ...panes, onAnyDocumentChange: (cb: () => void) => followAnyDocument(panes as never, cb) }),
    // The first pane's alone: the right pane's documents never reach it.
    onDocumentChange: (cb: () => void) => left.content.onDocumentChange(cb),
  } as unknown as AppHandle;
  return { left, right, handle };
}

test('a document opened straight into the second pane is followed: its edits reach the changes listeners', () => {
  const { right, handle } = setup();
  const heard: string[] = [];
  const offSummary = onChangesSummary((path) => heard.push(path));
  const off = installChangesWatch(handle);
  const opened = fakeStore('/r/linked.md');
  right.openDirectly(opened);
  heard.length = 0;
  opened.edit();
  assert.deepEqual(heard, ['/r/linked.md']);
  off();
  offSummary();
});
