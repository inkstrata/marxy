// The tracker's reader: which lines are rows, which column names a branch, and what a row's branches say of it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crossCheck, parseTodo, splitRow, TEMPLATE } from './todo.mjs';

const SAMPLE = `# Todo

Prose with a | bar is not a row.

## Next

| # | What | Why | Size | Branch |
| --- | --- | --- | --- | --- |
| F1 | Cold launches record \`first_text\` | a median needs its marks | S | \`start-marks\` |
| F2 | Larger slices while idle | 89 s per MB | M | \`idle-setting\`, then \`idle-polish\` |
| F3 | A cell with a \\| bar | | S | |
| note | not an id, so not a row | | | |

## Rounds

| # | What | Round |
|:---|---:|:---:|
| P1 | Old Word files as text | 9 \`legacy-office\` |
| P2 | Held | held |

## Housekeeping

| # | What | State |
| --- | --- | --- |
| H1 | Remove worktrees | \`harden\` holds only build output |
`;

test('a table line splits into trimmed cells, and an escaped bar stays in its cell', () => {
  assert.deepEqual(splitRow('| a | b c |  |'), ['a', 'b c', '']);
  assert.deepEqual(splitRow('| a \\| b | c |'), ['a | b', 'c']);
});

test('rows are the table lines whose first cell is an id, each under its heading', () => {
  const rows = parseTodo(SAMPLE);
  assert.deepEqual(rows.map(r => r.id), ['F1', 'F2', 'F3', 'P1', 'P2', 'H1']);
  assert.deepEqual(rows.map(r => r.section), ['Next', 'Next', 'Next', 'Rounds', 'Rounds', 'Housekeeping']);
  assert.equal(rows[0].what, 'Cold launches record `first_text`');
  assert.equal(rows[2].what, 'A cell with a | bar');
  assert.equal(rows[0].line, 9);
});

test('branches come from the Branch or Round column only, as the names in backticks', () => {
  const rows = Object.fromEntries(parseTodo(SAMPLE).map(r => [r.id, r.branches]));
  assert.deepEqual(rows.F1, ['start-marks']);
  assert.deepEqual(rows.F2, ['idle-setting', 'idle-polish']);
  assert.deepEqual(rows.F3, []);
  assert.deepEqual(rows.P1, ['legacy-office']);
  assert.deepEqual(rows.P2, []);
  assert.deepEqual(rows.H1, [], 'a State column is the writer\'s own, whatever it puts in backticks');
});

test('a row has landed only when every branch it names is merged', () => {
  const states = { 'start-marks': 'merged', 'idle-setting': 'merged', 'idle-polish': 'open', 'legacy-office': 'at-base' };
  const x = crossCheck(parseTodo(SAMPLE), b => states[b] ?? null);
  assert.deepEqual(x.landed.map(r => r.id), ['F1']);
  assert.deepEqual(x.inFlight.map(r => r.id), ['F2', 'P1']);
  assert.deepEqual(x.waiting.map(r => r.id), ['F3', 'P2', 'H1']);
  assert.deepEqual(x.duplicates, []);
});

test('an id used twice is reported with both lines', () => {
  const x = crossCheck(parseTodo('| # | What |\n| --- | --- |\n| A1 | one |\n| A1 | two |\n'), () => null);
  assert.deepEqual(x.duplicates, [{ id: 'A1', lines: [3, 4] }]);
});

test('the template is an empty tracker the reader accepts', () => {
  assert.deepEqual(parseTodo(TEMPLATE), []);
  assert.match(TEMPLATE, /\| # \| What \| Why \| Size \| Branch \|/);
});
