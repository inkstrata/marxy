// The sidebar's trees (W-08): the roots split into repositories and folders, the checkouts of one repository as one row,
// folders first then files, only the open folders consulted, and which listed folders a change makes stale.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { FileStat } from '@marxy/shell-api';
import { changedByGroup, closeWithin, splitRoots, staleDirs, visibleRows, TREE_CHILD_CAP, type Listing } from './sidebar-tree.ts';
import { SIDEBAR_SECTION_IDS, SIDEBAR_SECTIONS } from './sidebar.ts';

const stat = (path: string, isDir = false): FileStat => ({ path, size: 1, mtimeMs: 1, isDir });

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

test('changed files are counted once per path inside the repository, however many checkouts hold a copy', () => {
  const entries = [{ path: '/wt/a/x.md' }, { path: '/wt/b/x.md' }, { path: '/wt/b/y.md' }, { path: '/wt/a/z.md' }, { path: '/other/q.md' }];
  const keyOf = (path: string) => (path.startsWith('/wt/') ? { group: '/g/.git', rel: path.slice('/wt/a/'.length) } : undefined);
  const changed = new Set(['/wt/a/x.md', '/wt/b/x.md', '/wt/b/y.md', '/other/q.md']);
  assert.deepEqual([...changedByGroup(entries, keyOf, (e) => changed.has(e.path))], [['/g/.git', 2]]);
});

test('folders come first, then files, each by name, with numbers by value', () => {
  const listings = new Map<string, Listing>([['/r', [stat('/r/b.md'), stat('/r/zeta', true), stat('/r/a10.md'), stat('/r/a2.md'), stat('/r/Alpha', true)]]]);
  assert.deepEqual(visibleRows('/r', new Set(['/r']), listings).map((r) => r.path), ['/r/Alpha', '/r/zeta', '/r/a2.md', '/r/a10.md', '/r/b.md']);
});

test('only the open folders are consulted: a closed folder shows no children, an open one that is not listed yet is loading', () => {
  const listings = new Map<string, Listing>([
    ['/r', [stat('/r/open', true), stat('/r/closed', true), stat('/r/f.md')]],
    ['/r/closed', [stat('/r/closed/hidden.md')]],
  ]);
  const rows = visibleRows('/r', new Set(['/r', '/r/open']), listings);
  assert.deepEqual(rows.map((r) => `${r.kind}:${r.path}:${r.depth}`), ['dir:/r/closed:2', 'dir:/r/open:2', 'file:/r/f.md:2']);
  const open = rows.find((r) => r.path === '/r/open');
  assert.ok(open?.kind === 'dir' && open.expanded && open.loading);
  const closed = rows.find((r) => r.path === '/r/closed');
  assert.ok(closed?.kind === 'dir' && !closed.expanded && !closed.loading);
});

test('children sit one level deeper than their folder, to any depth', () => {
  const listings = new Map<string, Listing>([
    ['/r', [stat('/r/a', true)]],
    ['/r/a', [stat('/r/a/b', true)]],
    ['/r/a/b', [stat('/r/a/b/c.md')]],
  ]);
  const rows = visibleRows('/r', new Set(['/r', '/r/a', '/r/a/b']), listings);
  assert.deepEqual(rows.map((r) => [r.path, r.depth]), [['/r/a', 2], ['/r/a/b', 3], ['/r/a/b/c.md', 4]]);
});

test('a folder that could not be listed says so; a folder over the cap says how many are not drawn', () => {
  assert.deepEqual(visibleRows('/r', new Set(['/r']), new Map<string, Listing>([['/r', 'failed']])).map((r) => r.kind === 'note' && r.text), ['Could not be read']);
  const many = Array.from({ length: TREE_CHILD_CAP + 3 }, (_, i) => stat(`/r/f${String(i).padStart(5, '0')}.md`));
  const rows = visibleRows('/r', new Set(['/r']), new Map<string, Listing>([['/r', many]]));
  assert.equal(rows.length, TREE_CHILD_CAP + 1);
  assert.deepEqual(rows.at(-1), { kind: 'note', path: '/r\0more', depth: 2, text: '3 more not shown' });
});

test('closing a folder closes what was open under it and nothing beside it', () => {
  assert.deepEqual([...closeWithin(new Set(['/r', '/r/a', '/r/a/b', '/r/ab']), '/r/a')].sort(), ['/r', '/r/ab']);
});

test('a path that appeared makes the nearest listed folder above it stale; one that went makes only the folder that names it stale', () => {
  const listings = new Map<string, Listing>([
    ['/r', [stat('/r/sub', true), stat('/r/old.md')]],
    ['/r/sub', [stat('/r/sub/a.md')]],
  ]);
  assert.deepEqual([...staleDirs(listings, ['/r/new.md'], [])], ['/r']);
  assert.deepEqual([...staleDirs(listings, ['/r/sub/b.md'], [])], ['/r/sub']);
  assert.deepEqual([...staleDirs(listings, ['/r/fresh/deep/c.md'], [])], ['/r']);
  assert.deepEqual([...staleDirs(listings, [], ['/r/old.md'])], ['/r']);
  assert.deepEqual([...staleDirs(listings, ['/r/old.md', '/r/sub/a.md'], [])], [], 'a file already listed (modified) costs no read');
  assert.deepEqual([...staleDirs(listings, [], ['/r/sub/gone/x.md'])], [], 'nothing names it');
  assert.deepEqual([...staleDirs(new Map<string, Listing>([['/r', 'loading']]), ['/r/n.md'], [])], [], 'a folder not listed yet is not asked again');
});

test('Repositories and Folders are sidebar sections after Pinned, in the ids the file remembers', () => {
  assert.deepEqual(SIDEBAR_SECTIONS.map((s) => [s.id, s.title]).slice(2), [['repos', 'Repositories'], ['folders', 'Folders']]);
  assert.deepEqual([...SIDEBAR_SECTION_IDS], SIDEBAR_SECTIONS.map((s) => s.id));
});
