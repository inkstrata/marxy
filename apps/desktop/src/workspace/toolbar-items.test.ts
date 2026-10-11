// The toolbar's table (W-05): which doors are drawn is a pure function of the registry and of what fills the
// panel regions. No DOM here; toolbar.test.mjs draws it in WebKit.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { commands } from '../commands/index.ts';
import { FOLD_ORDER, MODE_CHOICES, TOOLBAR_ITEMS, visibleItems } from './toolbar.ts';

const ids = (items: readonly { readonly id: string }[]): string[] => items.map((item) => item.id);
// The panel toggles are registered now (W-03); the tests below add them on purpose, to say when they are drawn.
const real = commands().map((c) => c.id).filter((id) => id !== 'view.toggle-sidebar' && id !== 'view.toggle-inspector');

test('the items are in the toolbar order, and a mode choice is a command of its item', () => {
  assert.deepEqual(ids(TOOLBAR_ITEMS), [
    'sidebar', 'back', 'forward', 'title', 'new', 'mode', 'kind', 'copy', 'export', 'transform', 'find', 'inspector',
  ]);
  assert.deepEqual(MODE_CHOICES.map((c) => c.command), TOOLBAR_ITEMS.find((i) => i.id === 'mode')!.commands);
});

test('with every command and both panels filled, every item is drawn, in order', () => {
  const every = TOOLBAR_ITEMS.flatMap((item) => item.commands);
  assert.deepEqual(ids(visibleItems(TOOLBAR_ITEMS, every, ['sidebar', 'inspector'])), ids(TOOLBAR_ITEMS));
});

test('with nothing registered the title alone is drawn', () => {
  assert.deepEqual(ids(visibleItems(TOOLBAR_ITEMS, [], [])), ['title']);
});

test('the registry today draws back, forward, title, Read/Split/Source, the kind chip (K-07), Copy, Transform (W-21) and Find, and nothing else', () => {
  assert.deepEqual(ids(visibleItems(TOOLBAR_ITEMS, real, [])), ['back', 'forward', 'title', 'mode', 'kind', 'copy', 'transform', 'find']);
});

test('no Extract button and no theme switcher: the table names neither,', () => {
  for (const item of TOOLBAR_ITEMS) {
    assert.doesNotMatch(item.id, /extract|theme/i);
    for (const command of item.commands) assert.doesNotMatch(command, /extract|theme/i, `${item.id}: ${command}`);
  }
});

// The kind chip's door was opened by K-07: `kind.chip` is registered and the chip is drawn.
test('kind.chip is registered, and removing it removes the kind control', () => {
  assert.ok(real.includes('kind.chip'));
  assert.ok(!ids(visibleItems(TOOLBAR_ITEMS, real.filter((id) => id !== 'kind.chip'), [])).includes('kind'));
});

// The door: a story registers its command and its control appears, with no change to the toolbar.
const DOORS: ReadonlyArray<readonly [string, string, string[]]> = [
  ['export.menu', 'export', ['back', 'forward', 'title', 'mode', 'kind', 'copy', 'export', 'transform', 'find']],
  ['document.new-menu', 'new', ['back', 'forward', 'title', 'new', 'mode', 'kind', 'copy', 'transform', 'find']],
];

for (const [command, item, expected] of DOORS) {
  test(`registering ${command} adds the ${item} control, in place, and removing it removes it`, () => {
    assert.ok(!real.includes(command), `${command} is not registered yet; this test is the door for the story that does`);
    assert.deepEqual(ids(visibleItems(TOOLBAR_ITEMS, [...real, command], [])), expected);
    assert.ok(!ids(visibleItems(TOOLBAR_ITEMS, real, [])).includes(item));
  });
}

// Transform's door was opened by W-21: `transform.open` is registered and the control is drawn.
test('transform.open is registered, so the Transform control is drawn; without the command it is not', () => {
  assert.ok(real.includes('transform.open'));
  assert.ok(ids(visibleItems(TOOLBAR_ITEMS, real, [])).includes('transform'));
  assert.ok(!ids(visibleItems(TOOLBAR_ITEMS, real.filter((id) => id !== 'transform.open'), [])).includes('transform'));
});

test('a panel toggle is drawn only when its command is registered and something fills its region', () => {
  const toggles = ['view.toggle-sidebar', 'view.toggle-inspector'];
  const base = ['back', 'forward', 'title', 'mode', 'kind', 'copy', 'transform', 'find'];
  assert.deepEqual(ids(visibleItems(TOOLBAR_ITEMS, [...real, ...toggles], [])), base, 'commands without content draw nothing');
  assert.deepEqual(ids(visibleItems(TOOLBAR_ITEMS, real, ['sidebar', 'inspector'])), base, 'content without commands draws nothing');
  assert.deepEqual(ids(visibleItems(TOOLBAR_ITEMS, [...real, ...toggles], ['sidebar'])), ['sidebar', ...base]);
  assert.deepEqual(ids(visibleItems(TOOLBAR_ITEMS, [...real, ...toggles], ['inspector'])), [...base, 'inspector']);
});

test('the mode switch is drawn when any of its three commands is registered', () => {
  assert.deepEqual(ids(visibleItems(TOOLBAR_ITEMS, ['view.mode-source'], [])), ['title', 'mode']);
});

test('the doors that fold into More are real button doors, each with its own place in the order', () => {
  const byId = new Map(TOOLBAR_ITEMS.map((i) => [i.id, i]));
  for (const id of Object.keys(FOLD_ORDER)) assert.equal(byId.get(id)?.kind, 'button', `${id} is a button door`);
  const orders = Object.values(FOLD_ORDER);
  assert.equal(new Set(orders).size, orders.length);
});
