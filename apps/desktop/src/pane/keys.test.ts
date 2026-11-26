import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { isAltGraphText, isMacOptionText, paneChordFor } from './keys.ts';

const press = (init: { key: string; code: string; altGraph?: boolean; shiftKey?: boolean }) => ({
  key: init.key,
  code: init.code,
  metaKey: false,
  ctrlKey: true,
  altKey: true,
  shiftKey: init.shiftKey ?? false,
  getModifierState: (k: string) => k === 'AltGraph' && init.altGraph === true,
});

test('AltGr on Windows types its character: no pane chord takes Polish c-acute, a Hungarian @ or {', () => {
  for (const [code, key] of [['KeyC', 'ć'], ['KeyV', '@'], ['KeyB', '{'], ['KeyN', 'ń'], ['KeyC', 'Ć']] as const) {
    assert.equal(isAltGraphText(press({ key, code }), false), true, `${code} ${key}`);
    assert.equal(paneChordFor(press({ key, code }), false), null, `${code} ${key}`);
  }
});

test('AltGraph set says text whatever the key: German AltGr+ß is a backslash, and Mod+Alt+\\ does not take it', () => {
  assert.equal(isAltGraphText(press({ key: '\\', code: 'Minus', altGraph: true }), false), true);
  assert.equal(isAltGraphText(press({ key: '\\', code: 'Backslash', altGraph: true }), false), true);
  assert.equal(paneChordFor(press({ key: '\\', code: 'Backslash', altGraph: true }), false), null);
});

test('Ctrl+Alt on a layout without AltGr is still the chord', () => {
  assert.equal(paneChordFor(press({ key: 'c', code: 'KeyC' }), false)?.command, 'branch.clip');
  assert.equal(paneChordFor(press({ key: 'V', code: 'KeyV', shiftKey: true }), false), null);
  assert.equal(paneChordFor(press({ key: '\\', code: 'Backslash' }), false)?.command, 'view.open-beside');
  assert.equal(paneChordFor(press({ key: 'ArrowLeft', code: 'ArrowLeft' }), false)?.command, 'view.focus-left');
});

test('a Mac has no AltGr: Option types characters, and Control+Option is never text to this rule', () => {
  assert.equal(isAltGraphText(press({ key: 'ç', code: 'KeyC', altGraph: true }), true), false);
});

const option = (key: string, code: string) => ({ key, code, metaKey: false, ctrlKey: false, altKey: true, shiftKey: false });

test('Option on a Mac types ASCII punctuation: German Option+5 is [ and UK Option+3 is #, not a panel', () => {
  for (const [code, key] of [['Digit5', '['], ['Digit6', ']'], ['Digit7', '|'], ['Digit8', '{'], ['Digit3', '#']] as const) {
    assert.equal(isMacOptionText(option(key, code), true), true, `${code} ${key}`);
    assert.equal(paneChordFor(option(key, code), true), null, `${code} ${key}`);
  }
});

test('Option+digit that types no ASCII (US Option+1 is the inverted bang) is still the panel chord; Windows unchanged', () => {
  assert.equal(paneChordFor(option('¡', 'Digit1'), true)?.command, 'left.places');
  assert.equal(paneChordFor(option('∑', 'KeyW'), true)?.command, 'tab.close');
  assert.equal(paneChordFor(option('5', 'Digit5'), false)?.command, 'left.search');
  assert.equal(isMacOptionText(option('[', 'Digit5'), false), false);
});
