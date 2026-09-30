// Menu items replay the chord the palette and view toggle already bind (MARXY-342).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { historyDirection } from '../palette/keys.ts';
import { MENU_COMMAND_IDS, runMenuCommand } from './menu-commands.ts';

class FakeKeyboardEvent {
  readonly type: string;
  readonly key: string;
  readonly metaKey: boolean;
  readonly ctrlKey = false;
  readonly altKey = false;
  readonly shiftKey: boolean;
  constructor(type: string, init: { key: string; metaKey?: boolean; shiftKey?: boolean }) {
    this.type = type;
    this.key = init.key;
    this.metaKey = init.metaKey ?? false;
    this.shiftKey = init.shiftKey ?? false;
  }
}
(globalThis as { KeyboardEvent?: unknown }).KeyboardEvent = FakeKeyboardEvent;

function capture(id: string): FakeKeyboardEvent | undefined {
  let seen: FakeKeyboardEvent | undefined;
  const target = { dispatchEvent: (e: FakeKeyboardEvent) => ((seen = e), true) } as unknown as EventTarget;
  runMenuCommand(id, target);
  return seen;
}

test('every menu id maps to a Cmd chord', () => {
  assert.deepEqual([...MENU_COMMAND_IDS].sort(), [
    'marxy-go-back',
    'marxy-go-forward',
    'marxy-open-quickly',
    'marxy-toggle-source',
  ]);
  for (const id of MENU_COMMAND_IDS) {
    const e = capture(id);
    assert.equal(e?.type, 'keydown');
    assert.equal(e?.metaKey, true);
  }
});

test('back and forward are the chords history already resolves', () => {
  assert.equal(historyDirection(capture('marxy-go-back')!), 'back');
  assert.equal(historyDirection(capture('marxy-go-forward')!), 'forward');
});

test('the palette and view toggle chords are Cmd+P and Cmd+E', () => {
  assert.equal(capture('marxy-open-quickly')?.key, 'p');
  assert.equal(capture('marxy-toggle-source')?.key, 'e');
});

test('an unknown id does nothing', () => {
  assert.equal(capture('marxy-quit'), undefined);
  assert.equal(runMenuCommand('constructor', {} as EventTarget), false);
});
