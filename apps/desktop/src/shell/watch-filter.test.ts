// `fs-watch` payloads reach only the watch whose key they carry (C-05).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eventsForWatch, refusalForWatch } from './watch-filter.ts';

const TREE = '/notes\u0000tree';
const FOLDER = '/notes';

test('a payload for this watch key yields its events, rename targets kept', () => {
  const payload = {
    key: TREE,
    events: [
      { kind: 'created', path: '/notes/a/b/new.md' },
      { kind: 'renamed', path: '/notes/x.md', to: '/notes/y.md' },
    ],
  };
  assert.deepEqual(eventsForWatch(payload, TREE), [
    { kind: 'created', path: '/notes/a/b/new.md' },
    { kind: 'renamed', path: '/notes/x.md', to: '/notes/y.md' },
  ]);
});

test('a payload from another key yields no events, even for the same directory', () => {
  const payload = { key: FOLDER, events: [{ kind: 'modified', path: '/notes/open.md' }] };
  assert.deepEqual(eventsForWatch(payload, TREE), []);
  assert.deepEqual(eventsForWatch({ key: TREE, events: payload.events }, FOLDER), []);
});

test('a malformed payload yields no events', () => {
  for (const payload of [
    undefined,
    null,
    'fs-watch',
    42,
    [{ kind: 'modified', path: '/notes/open.md' }],
    { events: [{ kind: 'modified', path: '/notes/open.md' }] },
    { key: TREE },
    { key: TREE, events: 'modified' },
    { key: TREE, events: { 0: { kind: 'modified', path: '/notes/open.md' } } },
  ]) {
    assert.deepEqual(eventsForWatch(payload, TREE), [], JSON.stringify(payload));
  }
});

test('a malformed event inside a good payload is dropped and the rest kept', () => {
  const good = { kind: 'removed', path: '/notes/gone.md' };
  const payload = {
    key: TREE,
    events: [null, 'created', { kind: 'exploded', path: '/notes/a.md' }, { kind: 'created' }, { kind: 'renamed', path: '/notes/b.md', to: 7 }, good],
  };
  assert.deepEqual(eventsForWatch(payload, TREE), [good]);
});

test('a refusal payload for this key gives its reason; no other payload does', () => {
  assert.equal(refusalForWatch({ key: TREE, events: [], refused: 'too many files' }, TREE), 'too many files');
  assert.equal(refusalForWatch({ key: FOLDER, events: [], refused: 'too many files' }, TREE), undefined, "another watch's");
  assert.equal(refusalForWatch({ key: TREE, events: [] }, TREE), undefined, 'an ordinary batch');
  for (const payload of [undefined, null, 'refused', 7, { key: TREE, refused: 7 }, { refused: 'x' }]) {
    assert.equal(refusalForWatch(payload, TREE), undefined, JSON.stringify(payload));
  }
  assert.deepEqual(eventsForWatch({ key: TREE, events: [], refused: 'too many files' }, TREE), [], 'and it carries no events');
});
