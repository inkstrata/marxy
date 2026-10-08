// `fs-watch` payloads reach only the watch whose key they carry (C-05).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEarlyBuffer, eventsForWatch, isNotWatching, refusalForWatch } from './watch-filter.ts';

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

test('the early buffer replays what it kept once, then is empty (C-11.2)', () => {
  const buffer = createEarlyBuffer();
  buffer.add({ key: TREE, events: [{ kind: 'created', path: '/notes/a.md' }] });
  buffer.add({ key: TREE, events: [], refused: 'too many files' });
  assert.equal(buffer.drain().length, 2);
  assert.deepEqual(buffer.drain(), [], 'a second drain finds nothing: the payloads are not held for the life of the watch');
});

test('the early buffer drops batches past its limit but keeps a refusal that comes after them (C-11.2)', () => {
  const buffer = createEarlyBuffer(3);
  for (let i = 0; i < 10; i++) buffer.add({ key: TREE, events: [{ kind: 'modified', path: `/notes/${i}.md` }] });
  buffer.add({ key: TREE, events: [], refused: 'too many files' });
  const kept = buffer.drain();
  assert.equal(kept.length, 4, 'three batches and the refusal');
  assert.deepEqual(kept.at(-1), { key: TREE, events: [], refused: 'too many files' });
  assert.deepEqual(
    kept.slice(0, 3).map((p) => (p as { events: { path: string }[] }).events[0]?.path),
    ['/notes/0.md', '/notes/1.md', '/notes/2.md'],
  );
});

test('the early buffer bounds refusals too, so other watches cannot fill it (C-11.2)', () => {
  const buffer = createEarlyBuffer(2);
  for (let i = 0; i < 9; i++) buffer.add({ key: `/other${i}`, events: [], refused: 'x' });
  assert.equal(buffer.drain().length, 2);
});

test('only the shell\'s "not watching" is a benign unwatch error (C-11.2)', () => {
  assert.equal(isNotWatching('not watching /notes'), true);
  assert.equal(isNotWatching(new Error('not watching /notes')), true);
  assert.equal(isNotWatching('/notes: Permission denied (os error 13)'), false);
  assert.equal(isNotWatching(new Error('failed to lock the watch table')), false);
  assert.equal(isNotWatching(undefined), false);
  assert.equal(isNotWatching({ code: 'io', message: 'not watching' }), false, 'a bare string or an Error, as Tauri rejects');
});
