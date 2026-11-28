import { test } from 'node:test';
import assert from 'node:assert/strict';
import { archiveTag, staleBranches, staleFolders, staleTrees } from './stale.mjs';

const NOW = Date.parse('2026-11-27T12:00:00Z');
const ago = d => NOW - d * 864e5;
const tree = (over = {}) => ({ path: '/w/a', branch: 'agent/a', commitMs: ago(40), onOrigin: false, tagged: false, isMain: false, protectedPath: false, ...over });

test('only worktrees whose newest commit is over 30 days old are picked', () => {
  const picked = staleTrees([tree(), tree({ path: '/w/new', commitMs: ago(29) }), tree({ path: '/w/edge', commitMs: ago(30) })], NOW);
  assert.deepEqual(picked.map(t => t.path), ['/w/a']);
});

test('the main checkout and protected worktrees are never picked', () => {
  assert.deepEqual(staleTrees([tree({ isMain: true }), tree({ protectedPath: true }), tree({ commitMs: NaN })], NOW), []);
});

test('a tip on origin or under an archive tag is safe, any other is tagged first', () => {
  const [a, b, c] = staleTrees([tree({ onOrigin: true }), tree({ tagged: true }), tree()], NOW);
  assert.deepEqual([a.safe, b.safe, c.safe], [true, true, false]);
  assert.equal(archiveTag(c), 'archive/branch/agent/a');
  assert.equal(archiveTag({ branch: null, name: 'old-folder' }), 'archive/branch/old-folder');
});

test('unregistered folders untouched for 14 days are picked; nightly and registered ones are not', () => {
  const e = (name, d) => ({ name, path: `/Dev/marxy-wt/${name}`, touchedMs: ago(d) });
  const out = staleFolders([e('old', 20), e('recent', 3), e('nightly', 90), e('tree', 90)], ['/dev/marxy-wt/TREE'], NOW);
  assert.deepEqual(out.map(x => x.name), ['old']);
});

test('local branches with no worktree and safe tips go; the base and held ones stay', () => {
  const b = (name, over = {}) => ({ name, inMain: false, tagged: false, ...over });
  const out = staleBranches([b('main', { inMain: true }), b('agent/done', { inMain: true }), b('agent/tagged', { tagged: true }), b('agent/open'), b('agent/held', { inMain: true })], ['agent/held']);
  assert.deepEqual(out, ['agent/done', 'agent/tagged']);
});
