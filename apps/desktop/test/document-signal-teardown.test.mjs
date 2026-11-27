// A destroyed boot's document signal lets go of its panes: no document or change subscription stays on them.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { createDocumentSignal } from '../src/frame/document-signal.ts';

/** Panes as the signal sees them: subscriptions counted, so a leftover shows. */
function fakePanes() {
  const live = { docs: 0, changes: 0 };
  const docCbs = new Set();
  const changeCbs = new Set();
  const splitCbs = [];
  const pane = () => ({
    content: {
      onDocumentChange(cb) {
        docCbs.add(cb);
        live.docs++;
        return () => {
          if (docCbs.delete(cb)) live.docs--;
        };
      },
    },
  });
  const set = {
    panes: [pane()],
    onChange(cb) {
      changeCbs.add(cb);
      live.changes++;
      return () => {
        if (changeCbs.delete(cb)) live.changes--;
      };
    },
    onSplit(cb) {
      splitCbs.push(cb);
    },
  };
  const split = () => {
    set.panes.push(pane());
    return splitCbs.map((cb) => cb());
  };
  return { live, set, split, docCbs, changeCbs };
}

test('after destroy no pane document or change subscription is left, and nothing is heard', () => {
  const p = fakePanes();
  const signal = createDocumentSignal({ panes: () => p.set });
  let heard = 0;
  signal.onChange(() => heard++);
  [...p.docCbs][0]();
  assert.equal(heard, 1);
  p.split();
  assert.equal(p.live.docs, 2);
  // The pane callbacks as they were before destroy: a pane still holding one must reach nobody.
  const stale = [...p.docCbs, ...p.changeCbs];
  signal.destroy();
  assert.deepEqual(p.live, { docs: 0, changes: 0 });
  heard = 0;
  for (const cb of stale) cb();
  assert.equal(heard, 0);
});

test('a pane split after destroy is not watched', () => {
  const p = fakePanes();
  const signal = createDocumentSignal({ panes: () => p.set });
  signal.destroy();
  const cleanups = p.split();
  assert.equal(p.live.docs, 0);
  for (const off of cleanups) off();
  assert.deepEqual(p.live, { docs: 0, changes: 0 });
});
