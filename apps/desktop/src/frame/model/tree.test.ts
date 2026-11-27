// The sidebar's places: the roots split into repositories and folders, the checkouts of one repository as one row.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { splitRoots } from './tree.ts';

test('two worktrees of one repository are one Repositories row with two checkouts, and a plain folder is a Folders row', () => {
  const groups: Record<string, string> = { '/wt/a': '/gitrepo/.git', '/wt/b': '/gitrepo/.git' };
  const out = splitRoots(['/wt/a', '/plain', '/wt/b'], (root) => groups[root]);
  assert.deepEqual(out.repositories.map((r) => [r.id, r.name, r.root, r.checkouts]), [['/gitrepo/.git', 'a', '/wt/a', ['/wt/a', '/wt/b']]]);
  assert.deepEqual(out.folders.map((f) => [f.name, f.root]), [['plain', '/plain']]);
});

test('the main checkout (a .git directory) is the row, wherever it came in the list', () => {
  const groups: Record<string, string> = { '/wt/a': '/main/.git', '/main': '/main/.git' };
  const out = splitRoots(['/wt/a', '/main'], (root) => groups[root]);
  assert.equal(out.repositories.length, 1);
  assert.deepEqual([out.repositories[0]!.name, out.repositories[0]!.root, out.repositories[0]!.checkouts], ['main', '/main', ['/main', '/wt/a']]);
});

test('a root that is not itself a checkout is a folder, and a root given twice is one row', () => {
  const out = splitRoots(['/x', '/x'], () => undefined);
  assert.equal(out.repositories.length, 0);
  assert.deepEqual(out.folders.map((f) => f.root), ['/x']);
});
