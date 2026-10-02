// The palette's command list, chord labels and key dispatch (A-12).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AppContext, Command } from '../commands/registry.ts';
import { commandForKey, keyLabel, paletteCommands } from './commands.ts';

const ctx = {
  shell: { clipboardWrite: async () => {} },
  selection: { kind: 'none' },
  operationInput: () => null,
  closePalette: () => {},
  showNotice: () => {},
} as AppContext;

function cmd(id: string, title: string, group: Command['group'], extra: Partial<Command> = {}): Command {
  return { id, title, group, when: () => true, run: async () => {}, ...extra };
}

const key = (k: string, mods: { meta?: boolean; ctrl?: boolean; shift?: boolean; alt?: boolean } = {}) => ({
  key: k,
  metaKey: mods.meta === true,
  ctrlKey: mods.ctrl === true,
  shiftKey: mods.shift === true,
  altKey: mods.alt === true,
});

test('paletteCommands keeps only the commands whose when holds', () => {
  const all = [
    cmd('a', 'Save', 'document'),
    cmd('b', 'Undo', 'document', { when: () => false }),
  ];
  assert.deepEqual(paletteCommands(all, ctx, '').map((c) => c.id), ['a']);
});

test('paletteCommands filters by title on the query and ignores case and edge space', () => {
  const all = [cmd('a', 'Save', 'document'), cmd('b', 'Save as', 'document'), cmd('c', 'Toggle line numbers in Source', 'view')];
  assert.deepEqual(paletteCommands(all, ctx, ' SAVE ').map((c) => c.id), ['a', 'b']);
  assert.deepEqual(paletteCommands(all, ctx, 'zzzz').map((c) => c.id), []);
});

test('paletteCommands orders by group (document, view, app, selection) then title', () => {
  const all = [
    cmd('s1', 'Copy code', 'selection'),
    cmd('a1', 'Zoom', 'app'),
    cmd('v1', 'Jump to source', 'view'),
    cmd('d2', 'Undo', 'document'),
    cmd('d1', 'Save', 'document'),
    cmd('a0', 'About', 'app'),
  ];
  assert.deepEqual(paletteCommands(all, ctx, '').map((c) => c.id), ['d1', 'd2', 'v1', 'a0', 'a1', 's1']);
});

test('keyLabel spells a chord for a Mac and for Linux', () => {
  assert.equal(keyLabel('Mod+Shift+S', true), '⇧⌘S');
  assert.equal(keyLabel('Mod+Shift+S', false), 'Ctrl+Shift+S');
  assert.equal(keyLabel('Mod+Z', true), '⌘Z');
  assert.equal(keyLabel('Mod+Z', false), 'Ctrl+Z');
  assert.equal(keyLabel('Alt+ArrowLeft', true), '⌥←');
  assert.equal(keyLabel('Alt+ArrowLeft', false), 'Alt+ArrowLeft');
});

test('commandForKey runs a global command from an editable and skips a non-global one', () => {
  const plain = cmd('plain', 'Plain', 'document', { key: 'Mod+K' });
  const global = cmd('global', 'Global', 'document', { key: 'Mod+K', global: true });
  const event = key('k', { meta: true });
  assert.equal(commandForKey(event, [plain, global], ctx, { inEditable: true, mac: true }), global);
  assert.equal(commandForKey(event, [plain], ctx, { inEditable: true, mac: true }), undefined);
  assert.equal(commandForKey(event, [plain, global], ctx, { inEditable: false, mac: true }), plain);
});

test('commandForKey matches an alternate chord in keys and checks when', () => {
  const two = cmd('two', 'Two', 'document', { key: 'Mod+[', keys: ['Alt+ArrowLeft'] });
  assert.equal(commandForKey(key('ArrowLeft', { alt: true }), [two], ctx, { inEditable: false, mac: true }), two);
  assert.equal(commandForKey(key('[', { ctrl: true }), [two], ctx, { inEditable: false, mac: false }), two);
  assert.equal(commandForKey(key('ArrowLeft'), [two], ctx, { inEditable: false, mac: true }), undefined);
  const off = cmd('off', 'Off', 'document', { key: 'Mod+O', when: () => false });
  assert.equal(commandForKey(key('o', { meta: true }), [off], ctx, { inEditable: false, mac: true }), undefined);
});
