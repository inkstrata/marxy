import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { checkoutOf, gitGroupKey } from './checkout.ts';

const dirs = (...held: string[]) => (dir: string) => held.includes(dir);

test('checkoutOf: the nearest ancestor with a .git, within the root', () => {
  const has = dirs('/r', '/r/sub');
  assert.equal(checkoutOf('/r/docs/a.md', '/r', has), '/r');
  assert.equal(checkoutOf('/r/sub/docs/a.md', '/r', has), '/r/sub');
  assert.equal(checkoutOf('/r/sub/a.md', '/r', has), '/r/sub');
});

test('checkoutOf: no .git below the root gives the root; the root is never left', () => {
  assert.equal(checkoutOf('/r/docs/a.md', '/r', dirs()), '/r');
  // A .git above the root is not seen: the walk never listed it.
  assert.equal(checkoutOf('/r/docs/a.md', '/r', dirs('/')), '/r');
  // `/rx` is not under `/r`.
  assert.equal(checkoutOf('/rx/a.md', '/r', dirs('/rx')), '/r');
  assert.equal(checkoutOf('/r/a.md', '/', dirs('/r')), '/r');
});

test('gitGroupKey: a main checkout and its worktrees share one key; another repository does not', () => {
  const main = gitGroupKey('/r', undefined);
  assert.equal(main, '/r/.git');
  assert.equal(gitGroupKey('/wt/a', 'gitdir: /r/.git/worktrees/a\n'), main);
  assert.equal(gitGroupKey('/wt/b', 'gitdir: /r/.git/worktrees/b'), main);
  assert.notEqual(gitGroupKey('/other', undefined), main);
  assert.notEqual(gitGroupKey('/wt/c', 'gitdir: /other/.git/worktrees/c\n'), main);
});

test('gitGroupKey: a relative gitdir is resolved against the checkout', () => {
  assert.equal(gitGroupKey('/wt/a', 'gitdir: ../../r/.git/worktrees/a\n'), '/r/.git');
  assert.equal(gitGroupKey('/r/sub', 'gitdir: ../.git/worktrees/sub\r\n'), '/r/.git');
});

test('gitGroupKey: a .git file that names no gitdir keys its checkout alone', () => {
  assert.equal(gitGroupKey('/x', 'garbage'), '/x/.git');
  assert.equal(gitGroupKey('/', undefined), '/.git');
});

test('gitGroupKey: a submodule keeps its own key', () => {
  assert.equal(gitGroupKey('/r/sub', 'gitdir: ../.git/modules/sub\n'), '/r/.git/modules/sub');
});
