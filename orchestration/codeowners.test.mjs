// CODEOWNERS parsing and the approval rule the merge bar relies on (MARXY-172).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { codeOwnerPatterns, ownedBy, ownersOf, codeOwnerStatus } from './codeowners.mjs';

const HEAD = 'a'.repeat(40);

test('directory lines match by prefix and file lines exactly', () => {
  const p = codeOwnerPatterns('# c\n/a/dir/ @x\n/a/file.mjs @x\n');
  assert.ok(ownedBy(p, 'a/dir/deep/f.ts'));
  assert.ok(ownedBy(p, 'a/file.mjs'));
  assert.ok(!ownedBy(p, 'a/file.mjs.bak'));
  assert.ok(!ownedBy(p, 'a/other.ts'));
});

test('a glob line matches within a segment and ** crosses directories', () => {
  const p = codeOwnerPatterns('/apps/*/src-tauri/ @x\n/docs/**/secret.md @x\n');
  assert.ok(ownedBy(p, 'apps/desktop/src-tauri/tauri.conf.json'));
  assert.ok(!ownedBy(p, 'apps/desktop/src/main.ts'));
  assert.ok(ownedBy(p, 'docs/a/b/secret.md'));
});

test('the last matching line decides the owners, as on GitHub', () => {
  const p = codeOwnerPatterns('/src/ @a\n/src/gen/ @b\n');
  assert.deepEqual(ownersOf(p, 'src/x.ts'), ['a']);
  assert.deepEqual(ownersOf(p, 'src/gen/y.ts'), ['b']);
  assert.deepEqual(ownersOf(p, 'docs/z.md'), []);
});

test('a team owner never counts as approved, so a person has to decide', () => {
  const r = codeOwnerStatus({
    files: ['src/x.ts'],
    codeowners: '/src/ @org/team\n',
    reviews: [{ author: { login: 'org' }, state: 'APPROVED', commit: { oid: HEAD } }],
    headRefOid: HEAD,
  });
  assert.deepEqual(r.unapproved, ['src/x.ts']);
});

test('a review with no commit recorded never counts', () => {
  const r = codeOwnerStatus({
    files: ['src/x.ts'],
    codeowners: '/src/ @a\n',
    reviews: [{ author: { login: 'a' }, state: 'APPROVED' }],
    headRefOid: HEAD,
  });
  assert.deepEqual(r.unapproved, ['src/x.ts']);
});

// A real repo: main has a commit, the PR branches off it, a person approves the branch tip.
function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'marxy-owners-'));
  const git = args => execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: dir, encoding: 'utf8' }).trim();
  const commit = (file, text, msg) => { writeFileSync(join(dir, file), text); git(['add', file]); git(['commit', '-q', '-m', msg]); return git(['rev-parse', 'HEAD']); };
  git(['init', '-q', '-b', 'main']);
  commit('base.txt', 'base\n', 'base');
  git(['update-ref', 'refs/remotes/origin/main', 'HEAD']);
  git(['checkout', '-q', '-b', 'pr']);
  const reviewed = commit('work.txt', 'work\n', 'work');
  return { dir, git, commit, reviewed };
}
const status = (reviewed, head, git) => codeOwnerStatus({
  files: ['src/x.ts'],
  codeowners: '/src/ @a\n',
  reviews: [{ author: { login: 'a' }, state: 'APPROVED', commit: { oid: reviewed } }],
  headRefOid: head,
  git,
}).unapproved;

test('an approval on the head counts without asking git', () => {
  assert.deepEqual(status(HEAD, HEAD, () => { throw new Error('git called'); }), []);
});

test('an approval survives a merge that only brings in main', () => {
  const t = repo();
  try {
    t.git(['checkout', '-q', 'main']);
    const main = t.commit('other.txt', 'other\n', 'main moves');
    t.git(['update-ref', 'refs/remotes/origin/main', main]);
    t.git(['checkout', '-q', 'pr']);
    t.git(['merge', '-q', '--no-ff', '-m', 'merge main', 'main']);
    const head = t.git(['rev-parse', 'HEAD']);
    assert.deepEqual(status(t.reviewed, head, t.git), []);
  } finally { rmSync(t.dir, { recursive: true, force: true }); }
});

test('an approval does not survive any other commit', () => {
  const t = repo();
  try {
    const head = t.commit('work.txt', 'changed after review\n', 'more work');
    assert.deepEqual(status(t.reviewed, head, t.git), ['src/x.ts']);
  } finally { rmSync(t.dir, { recursive: true, force: true }); }
});
