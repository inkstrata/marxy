// How Source lays the worker's runs: each piece replaces the marks over its span and no others, the marks follow an
// edit until the re-read pieces arrive, the last piece clears what an older, longer text left, and a mark never runs past
// the text. The parity of the result with Read is role-parity.test.mjs's.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { EditorState } from '@codemirror/state';
import { RUN_ROLES } from '@marxy/core/src/highlight/runs.ts';
import { rolesOfMarks } from '../../test/support/source-roles.mjs';
import { marksFromRuns, pieceEffect, runMarks } from './colour.ts';

const role = (name) => RUN_ROLES.indexOf(name);
const runs = (...triples) => Uint32Array.from(triples.flat());
const lay = (state, piece) => state.update({ effects: pieceEffect(piece, state.doc.length) }).state;
const roles = (state) => rolesOfMarks(state.field(runMarks), state.doc.length);

test('a piece lays its runs as marks with Read\'s classes', () => {
  let state = EditorState.create({ doc: 'const a = "s";', extensions: [runMarks] });
  state = lay(state, { from: 0, to: 15, done: true, runs: runs([0, 5, role('keyword')], [10, 13, role('string')]) });
  const r = roles(state);
  assert.equal(r[0], 'keyword');
  assert.equal(r[6], null);
  assert.equal(r[11], 'string');
  const classes = [];
  state.field(runMarks).between(0, state.doc.length, (_f, _t, d) => void classes.push(d.spec.class));
  assert.deepEqual(classes, ['marxy-tok-keyword', 'marxy-tok-string']);
});

test('a piece replaces the marks over its span and keeps those outside it', () => {
  let state = EditorState.create({ doc: 'aaaa\nbbbb\ncccc', extensions: [runMarks] });
  state = lay(state, { from: 0, to: 15, done: true, runs: runs([0, 4, role('comment')], [5, 9, role('comment')], [10, 14, role('comment')]) });
  state = lay(state, { from: 5, to: 10, done: false, runs: runs([5, 9, role('string')]) });
  assert.deepEqual([roles(state)[0], roles(state)[6], roles(state)[11]], ['comment', 'string', 'comment']);
  state = lay(state, { from: 5, to: 10, done: false, runs: runs() });
  assert.deepEqual([roles(state)[0], roles(state)[6], roles(state)[11]], ['comment', null, 'comment']);
});

test('the marks follow an edit until its pieces come; the last piece clears past the end of a shorter text', () => {
  let state = EditorState.create({ doc: 'let x = 1;\nlet y = 2;', extensions: [runMarks] });
  state = lay(state, { from: 0, to: 22, done: true, runs: runs([0, 3, role('keyword')], [11, 14, role('keyword')]) });
  state = state.update({ changes: { from: 0, insert: '\n\n' } }).state;
  assert.equal(roles(state)[2], 'keyword');
  assert.equal(roles(state)[13], 'keyword');
  state = state.update({ changes: { from: 12, to: state.doc.length } }).state;
  state = lay(state, { from: 0, to: 13, done: true, runs: runs([2, 5, role('keyword')]) });
  assert.deepEqual(roles(state).filter(Boolean), ['keyword', 'keyword', 'keyword']);
});

test('a run is cut at the text\'s end, and one past it is dropped', () => {
  assert.equal(marksFromRuns(runs([0, 10, role('string')], [12, 14, role('string')]), 0, 8).length, 1);
  assert.equal(marksFromRuns(runs([0, 10, role('string')]), 0, 8)[0].to, 8);
  assert.equal(marksFromRuns(runs([0, 2, role('string')]), 100)[0].from, 100);
});
