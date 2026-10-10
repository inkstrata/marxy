// The verb menu's row limit and its "All actions…" row (C-13, ADR-0054 §1, §5; C-13.1). No DOM needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AppContext, Command } from '../commands/registry.ts';
import { ALL_ACTIONS_TITLE, MENU_VERB_LIMIT, verbMenuRows } from './verb-menu.ts';
import { MENU_ORDER } from './verbs.ts';

const ctx = { selection: { kind: 'text' } } as unknown as AppContext;

function made(id: string, applies = true): Command {
  return { id, title: `Made ${id}`, group: 'selection', when: () => applies, run: async () => {} };
}

/** Runs `fn` with `MENU_ORDER.text` extended by `extra` ids (the real order has no kind with more than seven). */
function withText(extra: readonly string[], fn: () => void): void {
  const order = MENU_ORDER.text as string[];
  const saved = [...order];
  order.splice(0, order.length, ...extra);
  try {
    fn();
  } finally {
    order.splice(0, order.length, ...saved);
  }
}

test('the menu shows at most seven verbs, then "All actions…" last', () => {
  assert.equal(MENU_VERB_LIMIT, 7);
  const ids = Array.from({ length: 8 }, (_, i) => `made.verb-${i + 1}`);
  withText(ids, () => {
    const rows = verbMenuRows(ctx, ids.map((id) => made(id)));
    assert.equal(rows.length, 8, rows.map((r) => r.title).join(' | '));
    assert.deepEqual(rows.slice(0, 7).map((r) => r.command?.id), ids.slice(0, 7));
    assert.equal(rows[7]?.command, null);
    assert.equal(rows[7]?.title, ALL_ACTIONS_TITLE);
  });
});

test('seven verbs and no other operation: no "All actions…" row', () => {
  const ids = Array.from({ length: 7 }, (_, i) => `made.verb-${i + 1}`);
  withText(ids, () => {
    const rows = verbMenuRows(ctx, ids.map((id) => made(id)));
    assert.equal(rows.length, 7);
    assert.ok(rows.every((r) => r.command !== null));
  });
});

test('an applicable operation that no row shows adds "All actions…"', () => {
  const ids = ['made.verb-1', 'made.verb-2'];
  withText(ids, () => {
    const registered = [...ids.map((id) => made(id)), made('op.elsewhere'), made('op.inapplicable', false)];
    const rows = verbMenuRows(ctx, registered);
    assert.deepEqual(rows.map((r) => r.title), ['Made made.verb-1', 'Made made.verb-2', ALL_ACTIONS_TITLE]);
    const without = verbMenuRows(ctx, [...ids.map((id) => made(id)), made('op.inapplicable', false)]);
    assert.equal(without.length, 2);
  });
});
