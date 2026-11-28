import { test } from 'node:test';
import assert from 'node:assert/strict';
import { archiveTag, keepable, normPath, staleBranches, staleFolders, staleTrees } from './stale.mjs';

const NOW = Date.parse('2026-11-27T12:00:00Z');
const ago = d => NOW - d * 864e5;
const tree = (over = {}) => ({ path: '/w/a', branch: 'agent/a', commitMs: ago(40), touchedMs: ago(40), onOrigin: false, tagged: false, isMain: false, protectedPath: false, ...over });

test('only worktrees whose newest commit and newest file are over 30 days old are picked', () => {
  const picked = staleTrees([
    tree(), tree({ path: '/w/new', commitMs: ago(29) }), tree({ path: '/w/edge', commitMs: ago(30) }),
    tree({ path: '/w/edited', touchedMs: ago(2) }), tree({ path: '/w/unread', touchedMs: NaN }), tree({ path: '/w/unwalked', touchedMs: undefined }),
  ], NOW);
  assert.deepEqual(picked.map(t => t.path), ['/w/a']);
});

test('the main checkout, protected worktrees and ones git could not read are never picked', () => {
  assert.deepEqual(staleTrees([tree({ isMain: true }), tree({ protectedPath: true }), tree({ commitMs: NaN }), tree({ error: 'git failed' })], NOW), []);
});

test('a tip on origin or under an archive tag is safe, any other is tagged first', () => {
  const [a, b, c] = staleTrees([tree({ onOrigin: true }), tree({ tagged: true }), tree()], NOW);
  assert.deepEqual([a.safe, b.safe, c.safe], [true, true, false]);
  assert.equal(archiveTag(c), 'archive/branch/agent/a');
  assert.equal(archiveTag({ branch: null, name: 'old-folder' }), 'archive/branch/old-folder');
});

test('paths compare the same whatever the slashes, and fold case on Windows only', () => {
  assert.equal(normPath('D:/Dev/marxy-wt/x', 'win32'), normPath('D:\\DEV\\marxy-wt\\x', 'win32'));
  assert.notEqual(normPath('/a/B', 'linux'), normPath('/a/b', 'linux'));
});

test('unregistered folders untouched for 14 days are picked; nightly, registered, git-holding ones are not', () => {
  const e = (name, d, over = {}) => ({ name, path: `D:\\Dev\\marxy-wt\\${name}`, touchedMs: ago(d), hasGit: false, ...over });
  const win = process.platform === 'win32';
  const out = staleFolders([e('old', 20), e('recent', 3), e('nightly', 90), e('tree', 90), e('repo', 90, { hasGit: true }), e('unread', NaN)], ['D:/Dev/marxy-wt/TREE'], NOW);
  // On other systems a drive path is relative and resolves differently, so only the Windows run can see the slash match.
  assert.deepEqual(out.map(x => x.name), win ? ['old'] : ['old', 'tree']);
});

test('what a build can remake is not archived', () => {
  assert.deepEqual(keepable(['.env', 'src/a.ts', 'node_modules/x/y.js', 'a/target/b', 'web/dist/c.js', '.venv/bin/p', '.pnpm-store/v3/f']), ['.env', 'src/a.ts']);
});

test('local branches with no worktree and safe tips go; the base and held ones stay', () => {
  const b = (name, over = {}) => ({ name, inMain: false, tagged: false, ...over });
  const out = staleBranches([b('main', { inMain: true }), b('agent/done', { inMain: true }), b('agent/tagged', { tagged: true }), b('agent/open'), b('agent/held', { inMain: true })], ['agent/held']);
  assert.deepEqual(out, ['agent/done', 'agent/tagged']);
});
