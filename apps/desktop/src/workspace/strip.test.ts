// The strip's table (K-07): no kind lists more than four tools, a tool names a command or null, the config's tool ids are
// these ids, and what is drawn is exactly the row's tools whose commands are registered. No DOM; kind-chip.test.mjs draws it.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { KINDS } from '@marxy/core/src/contracts/kinds.ts';
import { MAX_STRIP_TOOLS, parseConfig, STRIP_TOOL_IDS } from '@marxy/theme/src/config.ts';
import { commands } from '../commands/index.ts';
import { STRIP_TOOLS, STRIP_TOOL_BY_ID, toolsFor } from './strip.ts';

const none = { strip: {} };
const real = commands().map((c) => c.id);

test('every kind has a row; none lists more than four tools; a tool names a command or null', () => {
  assert.deepEqual(Object.keys(STRIP_TOOLS), [...KINDS]);
  for (const kind of KINDS) {
    assert.ok(STRIP_TOOLS[kind].length <= MAX_STRIP_TOOLS, `${kind} lists ${STRIP_TOOLS[kind].length}`);
    for (const t of STRIP_TOOLS[kind]) assert.ok(t.command === null || typeof t.command === 'string', `${kind}/${t.id}`);
  }
});

test('a tool id means one tool wherever it is listed, and the config\'s known ids are exactly the table\'s', () => {
  const seen = new Map<string, string>();
  for (const list of Object.values(STRIP_TOOLS)) {
    for (const t of list) {
      const was = seen.get(t.id);
      assert.ok(was === undefined || was === `${t.label}|${t.command}`, `${t.id} differs between kinds`);
      seen.set(t.id, `${t.label}|${t.command}`);
    }
  }
  assert.deepEqual([...STRIP_TOOL_BY_ID.keys()].sort(), [...STRIP_TOOL_IDS].sort());
});

test('every command a tool names is a command the registry has today, or the tool is not drawn', () => {
  const named = [...STRIP_TOOL_BY_ID.values()].flatMap((t) => (t.command === null ? [] : [t.command]));
  for (const id of named) assert.ok(real.includes(id), `${id} is not registered`);
});

test('today the strip holds only what exists: Changes for report and changelog, Outline for readme and docs, Line numbers for code', () => {
  const drawn = (kind: (typeof KINDS)[number]) => toolsFor(kind, none, real).map((t) => t.label);
  assert.deepEqual(drawn('report'), ['Changes']);
  assert.deepEqual(drawn('changelog'), ['Changes']);
  assert.deepEqual(drawn('readme'), ['Outline']);
  assert.deepEqual(drawn('docs'), ['Outline']);
  assert.deepEqual(drawn('code'), ['Line numbers']);
  for (const kind of ['article', 'book', 'transcript', 'data', 'notes', 'log', 'terminal', 'diff', 'html'] as const) {
    assert.deepEqual(drawn(kind), [], kind);
  }
});

test('a tool is drawn only when its command is registered, in the row\'s order, and never more than four', () => {
  assert.deepEqual(toolsFor('report', none, []), []);
  const all = [...STRIP_TOOL_BY_ID.values()].flatMap((t) => (t.command === null ? [] : [t.command]));
  assert.deepEqual(toolsFor('code', none, all).map((t) => t.id), ['line-numbers']);
  // Pretend the code row were fully built: the cap still holds.
  const config = { strip: { code: ['line-numbers', 'wrap', 'symbols', 'go-to-line'] } };
  assert.ok(toolsFor('code', config, all).length <= MAX_STRIP_TOOLS);
});

test('[strip] chooses and orders: a named list replaces the kind\'s row, an empty one hides the strip, an unknown id is gone', () => {
  const config = parseConfig(new TextEncoder().encode('[strip]\nreport = ["outline", "nope", "changes"]\ncode = []\n')).config;
  assert.deepEqual(toolsFor('report', config, real).map((t) => t.id), ['outline', 'changes']);
  assert.deepEqual(toolsFor('code', config, real), []);
  assert.deepEqual(toolsFor('readme', config, real).map((t) => t.id), ['outline']);
});
