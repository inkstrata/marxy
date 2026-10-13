// Menu clicks run registry commands through the registry, with the focused pane's context (W-20, ADR-0073).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commands } from '../commands/index.ts';
import type { AppContext, Command } from '../commands/registry.ts';
import { wrapSelection } from '../source/format-ops.ts';
import { CHORD_ITEM_IDS, MENU_COMMAND_IDS, menuStates, runMenuCommand, type MenuDeps } from './menu-commands.ts';
import { createMenuSync } from './menu-state.ts';

class FakeKeyboardEvent {
  readonly type: string;
  readonly key: string;
  readonly metaKey: boolean;
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

const ctx = {} as AppContext;

/** A Source editor stand-in: the real Bold arithmetic over a text and a selection, offered only while Source is focused. */
function sourcePane(text: string, from: number, to: number) {
  const state = { text, from, to, focus: 'source' as 'source' | 'rendered', documentSawChord: 0 };
  const bold: Command = {
    id: 'source.format-bold',
    title: 'Bold',
    key: 'Mod+B',
    global: true,
    group: 'selection',
    when: () => state.focus === 'source',
    async run() {
      const outcome = wrapSelection(state.text, { from: state.from, to: state.to }, 'bold');
      if (!('edit' in outcome)) return;
      for (const c of [...outcome.edit.changes].sort((a, b) => b.from - a.from)) {
        state.text = state.text.slice(0, c.from) + c.insert + state.text.slice(c.to);
      }
    },
  };
  const failed: unknown[] = [];
  const deps: MenuDeps = { commands: () => [bold], context: () => ctx, fail: (_c, e) => failed.push(e) };
  return { state, deps, failed };
}

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

test('a click on Bold with a Source pane focused wraps the selection; a replayed chord on document could not', async () => {
  const { state, deps } = sourcePane('one two three\n', 4, 7);
  const document = { dispatchEvent: () => (state.documentSawChord++, true) } as unknown as EventTarget;
  assert.equal(runMenuCommand('cmd:source.format-bold', document, deps), true);
  await settle();
  assert.equal(state.text, 'one **two** three\n');
  assert.equal(state.documentSawChord, 0, 'no chord was replayed');
});

test('a click on an item whose when is false runs nothing', async () => {
  const { state, deps } = sourcePane('one two three\n', 4, 7);
  state.focus = 'rendered';
  assert.equal(runMenuCommand('cmd:source.format-bold', undefined, deps), true);
  await settle();
  assert.equal(state.text, 'one two three\n');
});

test('a rejecting command is said, not swallowed', async () => {
  const boom: Command = { id: 'x.boom', title: 'Boom', group: 'app', when: () => true, run: () => Promise.reject(new Error('no')) };
  const failed: string[] = [];
  runMenuCommand('cmd:x.boom', undefined, { commands: () => [boom], context: () => ctx, fail: (c) => failed.push(c.title) });
  await settle();
  assert.deepEqual(failed, ['Boom']);
});

test('the two palette doors replay the palette chords', () => {
  assert.deepEqual([...CHORD_ITEM_IDS].sort(), ['marxy-keyboard-shortcuts', 'marxy-open-quickly']);
  assert.equal(capture('marxy-open-quickly')?.key, 'p');
  assert.equal(capture('marxy-open-quickly')?.shiftKey, false);
  assert.equal(capture('marxy-keyboard-shortcuts')?.key, 'p');
  assert.equal(capture('marxy-keyboard-shortcuts')?.shiftKey, true);
  for (const id of CHORD_ITEM_IDS) assert.equal(capture(id)?.metaKey, true);
});

test('an unknown id does nothing', () => {
  assert.equal(capture('marxy-quit'), undefined);
  assert.equal(runMenuCommand('constructor', {} as EventTarget), false);
  assert.equal(runMenuCommand('cmd:no.such', undefined, { commands, context: () => ctx, fail() {} }), false);
  assert.equal(runMenuCommand('cmd:nav.back'), false, 'a command item needs the app behind it');
});

test('every menu command id is a registry command', () => {
  const ids = new Set(commands().map((c) => c.id));
  for (const id of MENU_COMMAND_IDS) assert.ok(ids.has(id), id);
  assert.equal(new Set(MENU_COMMAND_IDS).size, MENU_COMMAND_IDS.length);
});

test('menu state follows each command\'s when, and a throwing when is disabled', () => {
  const { state, deps } = sourcePane('x', 0, 1);
  const fake = { ...deps, commands: () => [...deps.commands(), { id: 'nav.back', title: 'Back', group: 'view', when: () => { throw new Error('x'); }, run: async () => {} } as Command] };
  assert.equal(menuStates(fake)['source.format-bold'], true);
  assert.equal(menuStates(fake)['nav.back'], false);
  assert.equal(menuStates(fake)['view.find'], false, 'a command the registry lacks is disabled');
  state.focus = 'rendered';
  assert.equal(menuStates(fake)['source.format-bold'], false);
});

test('the real registry: Bold is offered nowhere without a Source pane, so its item is disabled', () => {
  const states = menuStates({ commands, context: () => ctx });
  assert.equal(states['source.format-bold'], false);
});

test('the shell is told of a change once, and only a change', async () => {
  const { state, deps } = sourcePane('x', 0, 1);
  const sent: Array<Record<string, boolean>> = [];
  const sync = createMenuSync(deps, { setMenuEnabled: async (s) => void sent.push(s) });
  assert.equal(await sync(), true);
  assert.equal(await sync(), false);
  state.focus = 'rendered';
  assert.equal(await sync(), true);
  assert.equal(sent.length, 2);
  assert.equal(sent[0]!['source.format-bold'], true);
  assert.equal(sent[1]!['source.format-bold'], false);
});
