// What a commit is answerable for, in a throwaway repository rather than in this one, because the
// case that matters is a merge and this repository is mid-merge at unpredictable times.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { stagedNames } from './repo.mjs';

/** Build a repository whose story branch is one commit behind a main that touched other files. */
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'marxy-repo-test-'));
  const git = (...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
  const write = (f, s) => writeFileSync(join(dir, f), s);
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'user.name', 'test');
  // A developer's global signing (an SSH key behind a passphrase) must not decide whether this passes.
  git('config', 'commit.gpgsign', 'false');
  git('config', 'tag.gpgsign', 'false');
  write('mine.txt', 'one\n'); write('shared.txt', 'base\n');
  git('add', '-A'); git('commit', '-q', '-m', 'base');
  git('checkout', '-q', '-b', 'story');
  write('mine.txt', 'one\ntwo\n'); write('shared.txt', 'base\nstory\n');
  git('add', '-A'); git('commit', '-q', '-m', 'story work');
  git('checkout', '-q', 'main');
  write('theirs.txt', 'theirs\n'); write('shared.txt', 'base\nmain\n');
  git('add', '-A'); git('commit', '-q', '-m', 'other work');
  git('checkout', '-q', 'story');
  return { dir, git };
}

const stagedIn = cwd => stagedNames({ cwd }).split('\n').filter(Boolean).sort();

test('a merge of main answers for what was resolved, not for what the merge carried', () => {
  const { dir, git } = fixture();
  try {
    try { git('merge', 'main'); } catch { /* shared.txt conflicts, which is the point */ }
    writeFileSync(join(dir, 'shared.txt'), 'base\nstory\nmain\n');
    git('add', 'shared.txt');
    const staged = stagedIn(dir);
    assert.deepEqual(staged, ['shared.txt'], 'only the resolved file is the author\'s');
    assert.ok(!staged.includes('theirs.txt'), 'a file main brought is not a boundary violation');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a conflict resolution that edits another file is still the author\'s', () => {
  const { dir, git } = fixture();
  try {
    try { git('merge', 'main'); } catch { /* expected */ }
    writeFileSync(join(dir, 'shared.txt'), 'base\nstory\nmain\n');
    // Editing a file the other side brought, while resolving, is exactly what the check must catch.
    writeFileSync(join(dir, 'theirs.txt'), 'theirs\nand mine\n');
    git('add', 'shared.txt', 'theirs.txt');
    assert.deepEqual(stagedIn(dir), ['shared.txt', 'theirs.txt']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('outside a merge every staged file is the author\'s', () => {
  const { dir, git } = fixture();
  try {
    writeFileSync(join(dir, 'mine.txt'), 'one\ntwo\nthree\n');
    git('add', 'mine.txt');
    assert.deepEqual(stagedIn(dir), ['mine.txt']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
