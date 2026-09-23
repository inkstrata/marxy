// A branch may edit the board for its own story and no other (MARXY-190).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boardEdits, reviewBoundary } from './own-row.mjs';

const HEAD = 'Key,Type,Summary,Epic,Parent,Labels,Paths,Description,Acceptance\n';
const row = (key, paths, summary = 's') => `${key},Story,${summary},,MARXY-4,ops,"${paths}",d,a\n`;
const deps = (phases, d = {}) => JSON.stringify({ _note: 'n', phases, deps: d });

test('a branch that adds only its own row and deps entry edits only itself', () => {
  const e = reviewBoundary('MARXY-9', {
    baseCsv: HEAD + row('MARXY-1', 'a'),
    headCsv: HEAD + row('MARXY-1', 'a') + row('MARXY-9', 'orchestration/x.mjs'),
    baseDeps: deps({ ops: ['MARXY-1'] }, { 'MARXY-1': [] }),
    headDeps: deps({ ops: ['MARXY-1', 'MARXY-9'] }, { 'MARXY-1': [], 'MARXY-9': [] }),
  });
  assert.equal(e.ownOnly, true);
  assert.equal(e.added, true);
  assert.deepEqual(e.widened, ['orchestration/x.mjs']);
  assert.equal(e.story.Key, 'MARXY-9');
});

test('widening its own Paths is its own edit, and the widened row governs', () => {
  const e = reviewBoundary('MARXY-1', {
    baseCsv: HEAD + row('MARXY-1', 'a'),
    headCsv: HEAD + row('MARXY-1', 'a, b'),
    baseDeps: deps({ ops: ['MARXY-1'] }),
    headDeps: deps({ ops: ['MARXY-1'] }),
  });
  assert.equal(e.ownOnly, true);
  assert.deepEqual(e.widened, ['b']);
  assert.equal(e.story.Paths, 'a, b');
});

test("editing another story's row is not allowed, and the base row governs", () => {
  const e = reviewBoundary('MARXY-1', {
    baseCsv: HEAD + row('MARXY-1', 'a') + row('MARXY-2', 'x'),
    headCsv: HEAD + row('MARXY-1', 'a, b') + row('MARXY-2', 'x, y'),
  });
  assert.equal(e.ownOnly, false);
  assert.deepEqual(e.others, ['MARXY-2']);
  assert.equal(e.story.Paths, 'a');
});

test("moving another story between phases, or editing deps.json's note, is someone else's edit", () => {
  const base = { baseCsv: HEAD, headCsv: HEAD };
  assert.deepEqual(
    boardEdits('MARXY-1', { ...base, baseDeps: deps({ 1: ['MARXY-2'] }), headDeps: deps({ 2: ['MARXY-2'] }) }).others,
    ['MARXY-2'],
  );
  assert.deepEqual(
    boardEdits('MARXY-1', { ...base, baseDeps: deps({}), headDeps: JSON.stringify({ _note: 'changed', phases: {}, deps: {} }) }).others,
    ['(deps.json)'],
  );
});

test('re-quoting a cell or reordering a phase list is not an edit', () => {
  const e = boardEdits('MARXY-1', {
    baseCsv: HEAD + 'MARXY-2,Story,s,,MARXY-4,ops,x,d,a\n',
    headCsv: HEAD + '"MARXY-2","Story","s","","MARXY-4","ops","x","d","a"\n',
    baseDeps: deps({ ops: ['MARXY-2', 'MARXY-3'] }),
    headDeps: deps({ ops: ['MARXY-3', 'MARXY-2'] }),
  });
  assert.deepEqual(e.touched, []);
});
