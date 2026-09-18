// Back and forward keys walk the session history (ADR-0011).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { historyDirection, type PaletteKey } from './keys.ts';
import { emptySession, goBack, goForward, recordOpen } from './session.ts';

function key(partial: Partial<PaletteKey> & Pick<PaletteKey, 'key'>): PaletteKey {
  return {
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...partial,
  };
}

test('standard back and forward keys resolve to history directions', () => {
  assert.equal(historyDirection(key({ key: '[', metaKey: true })), 'back');
  assert.equal(historyDirection(key({ key: ']', metaKey: true })), 'forward');
  assert.equal(historyDirection(key({ key: '[', ctrlKey: true })), 'back');
  assert.equal(historyDirection(key({ key: ']', ctrlKey: true })), 'forward');
  assert.equal(historyDirection(key({ key: 'ArrowLeft', altKey: true })), 'back');
  assert.equal(historyDirection(key({ key: 'ArrowRight', altKey: true })), 'forward');
  assert.equal(historyDirection(key({ key: 'BrowserBack' })), 'back');
  assert.equal(historyDirection(key({ key: 'BrowserForward' })), 'forward');
});

test('plain arrows and shifted chords are not history', () => {
  assert.equal(historyDirection(key({ key: 'ArrowLeft' })), undefined);
  assert.equal(historyDirection(key({ key: '[', metaKey: true, shiftKey: true })), undefined);
});

test('those keys actually walk back and forward', () => {
  let session = emptySession('/repo');
  session = recordOpen(session, '/one.md');
  session = recordOpen(session, '/two.md');
  session = recordOpen(session, '/three.md');

  const backKey = historyDirection(key({ key: '[', metaKey: true }));
  assert.equal(backKey, 'back');
  const back = goBack(session);
  assert.ok(back !== undefined);
  assert.equal(back!.path, '/two.md');

  const fwdKey = historyDirection(key({ key: 'ArrowRight', altKey: true }));
  assert.equal(fwdKey, 'forward');
  const fwd = goForward(back!.session);
  assert.ok(fwd !== undefined);
  assert.equal(fwd!.path, '/three.md');
});
