// Whether an approval survives a merge of main, checked in a real temporary repository (MARXY-106).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onlyMainArrived, resolutionFromSides } from './approve.mjs';

const ID = ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null'];

/** A repository where `feat` (the reviewed work) and `main` both moved on from a common base. */
function repo({ mainTouchesChangelog }) {
  const dir = mkdtempSync(join(tmpdir(), 'marxy-approve-'));
  const git = args => execFileSync('git', [...ID, '-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const write = (f, t) => writeFileSync(join(dir, f), t);
  const commit = msg => { git(['add', '-A']); git(['commit', '-q', '-m', msg]); return git(['rev-parse', 'HEAD']); };
  git(['init', '-q', '-b', 'main']);
  write('a.txt', 'one\ntwo\nthree\n');
  write('CHANGELOG.md', '# Changelog\n\n## Unreleased\n- base\n');
  commit('base');
  git(['checkout', '-q', '-b', 'feat']);
  write('a.txt', 'one\ntwo\nthree\nfeat line\n');
  write('CHANGELOG.md', '# Changelog\n\n## Unreleased\n- base\n- feat\n');
  const approved = commit('feat');
  git(['checkout', '-q', 'main']);
  write('b.txt', 'main file\n');
  if (mainTouchesChangelog) write('CHANGELOG.md', '# Changelog\n\n## Unreleased\n- base\n- main\n');
  commit('main moves');
  git(['checkout', '-q', 'feat']);
  const check = head => onlyMainArrived(approved, head, { git, mainRef: 'main', fetch: false });
  /** Merge main into feat; when it conflicts, write `changelog` as the hand resolution. */
  const mergeMain = changelog => {
    try { git(['merge', '-q', '--no-edit', 'main']); } catch {
      write('CHANGELOG.md', changelog);
      git(['add', 'CHANGELOG.md']);
      git(['commit', '-q', '--no-edit']);
    }
    return git(['rev-parse', 'HEAD']);
  };
  return { dir, git, write, commit, check, mergeMain, done: () => rmSync(dir, { recursive: true, force: true }) };
}

test('a clean merge of main keeps the approval', () => {
  const r = repo({ mainTouchesChangelog: false });
  try {
    const v = r.check(r.mergeMain());
    assert.equal(v.ok, true, v.why);
  } finally { r.done(); }
});

test('a hand resolution that keeps both sides keeps the approval', () => {
  const r = repo({ mainTouchesChangelog: true });
  try {
    const v = r.check(r.mergeMain('# Changelog\n\n## Unreleased\n- base\n- main\n- feat\n'));
    assert.equal(v.ok, true, v.why);
  } finally { r.done(); }
});

test('a hand resolution that drops main\'s line voids the approval', () => {
  const r = repo({ mainTouchesChangelog: true });
  try {
    const v = r.check(r.mergeMain('# Changelog\n\n## Unreleased\n- base\n- feat\n'));
    assert.equal(v.ok, false);
    assert.match(v.why, /CHANGELOG\.md/);
  } finally { r.done(); }
});

test('a hand resolution that drops a reviewed line voids the approval', () => {
  const r = repo({ mainTouchesChangelog: true });
  try {
    const v = r.check(r.mergeMain('# Changelog\n\n## Unreleased\n- base\n- main\n'));
    assert.equal(v.ok, false);
  } finally { r.done(); }
});

test('a hand resolution with a line neither side had voids the approval', () => {
  const r = repo({ mainTouchesChangelog: true });
  try {
    const v = r.check(r.mergeMain('# Changelog\n\n## Unreleased\n- base\n- main\n- feat\n- unreviewed\n'));
    assert.equal(v.ok, false);
  } finally { r.done(); }
});

test('new work after the merge voids the approval, naming the file', () => {
  const r = repo({ mainTouchesChangelog: false });
  try {
    r.mergeMain();
    r.write('a.txt', 'one\ntwo\nthree\nfeat line\nsneaked in\n');
    const v = r.check(r.commit('more'));
    assert.equal(v.ok, false);
    assert.match(v.why, /a\.txt/);
  } finally { r.done(); }
});

test('a head that does not contain the reviewed commit voids the approval', () => {
  const r = repo({ mainTouchesChangelog: false });
  try {
    const v = r.check(r.git(['rev-parse', 'main']));
    assert.equal(v.ok, false);
    assert.match(v.why, /not an ancestor/);
  } finally { r.done(); }
});

test('resolutionFromSides allows a line a side deleted to stay deleted', () => {
  assert.equal(resolutionFromSides({ base: ['a', 'b'], ours: ['a'], theirs: ['a', 'b', 'c'], result: ['a', 'c'] }), true);
  assert.equal(resolutionFromSides({ base: ['a', 'b'], ours: ['a', 'b'], theirs: ['a', 'b', 'c'], result: ['a', 'c'] }), false);
});
