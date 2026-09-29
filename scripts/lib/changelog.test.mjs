// One changelog fragment per story instead of one shared CHANGELOG.md section (MARXY-315).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  FRAGMENT_DIR, fragmentPath, isFragmentPath, fragmentKey, validFragment,
  changelogHasUnreleasedLine, hasEntry,
} from './changelog.mjs';

test('fragmentPath and isFragmentPath agree on the shape of a fragment file', () => {
  assert.equal(fragmentPath('MARXY-1'), 'changelog.d/MARXY-1.md');
  assert.ok(isFragmentPath('changelog.d/MARXY-1.md'));
  assert.ok(!isFragmentPath('CHANGELOG.md'));
  assert.ok(!isFragmentPath('changelog.d/nested/MARXY-1.md'));
  assert.equal(fragmentKey('changelog.d/MARXY-1.md'), 'MARXY-1');
  assert.equal(fragmentKey('CHANGELOG.md'), null);
  assert.equal(FRAGMENT_DIR, 'changelog.d');
});

test('validFragment requires exactly one line ending in (KEY)', () => {
  assert.ok(validFragment('A reader-facing sentence (MARXY-1)', 'MARXY-1'));
  assert.ok(validFragment('A reader-facing sentence (MARXY-1)\n', 'MARXY-1')); // trailing newline is fine
  assert.ok(!validFragment('A reader-facing sentence (MARXY-2)', 'MARXY-1'), 'wrong key');
  assert.ok(!validFragment('line one\nline two (MARXY-1)', 'MARXY-1'), 'more than one line');
  assert.ok(!validFragment('no key at the end', 'MARXY-1'));
  assert.ok(!validFragment('', 'MARXY-1'));
});

test('changelogHasUnreleasedLine only looks inside the Unreleased section', () => {
  const text = '# Changelog\n\n## Unreleased\n\n- a line (MARXY-1)\n\n## 0.1.0 - 2026-01-01\n\n- an old line (MARXY-9)\n';
  assert.ok(changelogHasUnreleasedLine(text, 'MARXY-1'));
  assert.ok(!changelogHasUnreleasedLine(text, 'MARXY-9'), 'MARXY-9 is under the released heading, not Unreleased');
  assert.ok(!changelogHasUnreleasedLine(text, 'MARXY-2'));
});

test('hasEntry accepts a fragment file, presence-only, when there is no reader', () => {
  assert.ok(hasEntry(['changelog.d/MARXY-1.md', 'src/x.ts'], 'MARXY-1'));
  assert.ok(!hasEntry(['src/x.ts'], 'MARXY-1'));
});

test('hasEntry accepts a transitional CHANGELOG.md line, presence-only, when there is no reader', () => {
  assert.ok(hasEntry(['CHANGELOG.md', 'src/x.ts'], 'MARXY-1'));
});

test('hasEntry with a reader validates fragment content, and a fragment naming the wrong key fails', () => {
  const read = f => ({ 'changelog.d/MARXY-1.md': 'the right sentence (MARXY-1)' })[f] ?? null;
  assert.ok(hasEntry(['changelog.d/MARXY-1.md'], 'MARXY-1', read));

  const wrongKey = f => ({ 'changelog.d/MARXY-1.md': 'a sentence that names the wrong key (MARXY-9)' })[f] ?? null;
  assert.ok(!hasEntry(['changelog.d/MARXY-1.md'], 'MARXY-1', wrongKey));
});

test('hasEntry with a reader validates the CHANGELOG.md Unreleased line', () => {
  const good = () => '# Changelog\n\n## Unreleased\n\n- a line (MARXY-1)\n';
  assert.ok(hasEntry(['CHANGELOG.md'], 'MARXY-1', good));

  const bad = () => '# Changelog\n\n## Unreleased\n\n- a line about someone else (MARXY-9)\n';
  assert.ok(!hasEntry(['CHANGELOG.md'], 'MARXY-1', bad));
});

test('hasEntry falls back to presence when the reader cannot find the file (a fake rev, a deleted file)', () => {
  const missing = () => null;
  assert.ok(hasEntry(['changelog.d/MARXY-1.md'], 'MARXY-1', missing));
  assert.ok(hasEntry(['CHANGELOG.md'], 'MARXY-1', missing));
});

test('hasEntry without a key accepts CHANGELOG.md or any fragment at all', () => {
  assert.ok(hasEntry(['changelog.d/MARXY-7.md'], undefined));
  assert.ok(hasEntry(['CHANGELOG.md'], undefined));
  assert.ok(!hasEntry(['src/x.ts'], undefined));
});

test('hasEntry with no matching path at all fails', () => {
  assert.ok(!hasEntry(['src/x.ts', 'docs/readme.md'], 'MARXY-1'));
  assert.ok(!hasEntry([], 'MARXY-1'));
});

// MARXY-315 acceptance criterion 5: two branches that each add their own fragment merge with
// no conflict — the whole point of moving off one shared CHANGELOG.md section. Proven with a
// real git merge-tree on a throwaway repo, not just by reasoning about disjoint file paths.
test('two branches that each add a changelog.d fragment merge with no conflict', () => {
  const dir = mkdtempSync(join(tmpdir(), 'marxy-changelog-merge-'));
  try {
    const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 'test@example.invalid');
    git('config', 'user.name', 'test');
    // A developer's global signing (an SSH key behind a passphrase) must not decide whether this passes.
    git('config', 'commit.gpgsign', 'false');
    git('config', 'tag.gpgsign', 'false');
    mkdirSync(join(dir, FRAGMENT_DIR));
    writeFileSync(join(dir, FRAGMENT_DIR, 'README.md'), 'the rule\n');
    git('add', '.');
    git('commit', '-q', '-m', 'base');
    const base = git('rev-parse', 'HEAD').trim();

    git('checkout', '-q', '-b', 'story-a');
    writeFileSync(join(dir, FRAGMENT_DIR, 'MARXY-1.md'), 'Fixed the first thing (MARXY-1)\n');
    git('add', '.');
    git('commit', '-q', '-m', 'story a');
    const a = git('rev-parse', 'HEAD').trim();

    git('checkout', '-q', '-b', 'story-b', base);
    writeFileSync(join(dir, FRAGMENT_DIR, 'MARXY-2.md'), 'Fixed the second thing (MARXY-2)\n');
    git('add', '.');
    git('commit', '-q', '-m', 'story b');
    const b = git('rev-parse', 'HEAD').trim();

    const tree = git('merge-tree', '--write-tree', a, b);
    assert.ok(!/CONFLICT/.test(tree), `expected a clean merge, got:\n${tree}`);

    const listing = git('ls-tree', '-r', '--name-only', tree.trim().split('\n')[0]);
    assert.ok(listing.includes('changelog.d/MARXY-1.md'));
    assert.ok(listing.includes('changelog.d/MARXY-2.md'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
