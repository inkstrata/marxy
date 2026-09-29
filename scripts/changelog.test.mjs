// scripts/changelog.mjs --release folds changelog.d/ fragments into CHANGELOG.md and removes
// them, touching no other byte (MARXY-315).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { foldRelease, fragmentFiles, release } from './changelog.mjs';
import { FRAGMENT_DIR } from './lib/changelog.mjs';

test('foldRelease inserts a new version heading right after Unreleased, in fragment order', () => {
  const changelog = '# Changelog\n\nFormat note.\n\n## Unreleased\n\n- old line (MARXY-1)\n';
  const out = foldRelease({
    changelog, fragments: ['New thing (MARXY-2)', 'Another (MARXY-3)'], version: '0.1.0', date: '2026-09-28',
  });
  assert.match(out, /## Unreleased\n\n- old line \(MARXY-1\)\n\n## 0\.1\.0 - 2026-09-28\n\n- New thing \(MARXY-2\)\n- Another \(MARXY-3\)/);
});

test('foldRelease on a second release keeps the first release below the new one', () => {
  const changelog = '# Changelog\n\n## Unreleased\n\n- old line (MARXY-1)\n\n## 0.1.0 - 2026-09-28\n\n- New thing (MARXY-2)\n';
  const out = foldRelease({ changelog, fragments: ['Next thing (MARXY-4)'], version: '0.2.0', date: '2026-10-01' });
  const posUnreleased = out.indexOf('## Unreleased');
  const pos02 = out.indexOf('## 0.2.0');
  const pos01 = out.indexOf('## 0.1.0');
  assert.ok(posUnreleased < pos02 && pos02 < pos01, 'newest release sits between Unreleased and the prior release');
  assert.match(out, /New thing \(MARXY-2\)/, 'the prior release entry is untouched');
});

test('foldRelease with no Unreleased section appends the version at the end', () => {
  const changelog = '# Changelog\n';
  const out = foldRelease({ changelog, fragments: ['A thing (MARXY-1)'], version: '0.1.0', date: '2026-09-28' });
  assert.match(out, /# Changelog\n\n## 0\.1\.0 - 2026-09-28\n\n- A thing \(MARXY-1\)\n/);
});

test('fragmentFiles lists .md files sorted numerically by key, and skips README.md', () => {
  const dir = mkdtempSync(join(tmpdir(), 'marxy-fragments-'));
  try {
    for (const f of ['README.md', 'MARXY-9.md', 'MARXY-100.md', 'MARXY-2.md']) writeFileSync(join(dir, f), 'x (KEY)\n');
    assert.deepEqual(fragmentFiles(dir), ['MARXY-2.md', 'MARXY-9.md', 'MARXY-100.md']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('fragmentFiles on a missing directory is empty, not a throw', () => {
  assert.deepEqual(fragmentFiles(join(tmpdir(), 'marxy-does-not-exist-changelog-d')), []);
});

test('release folds every fragment into CHANGELOG.md, deletes the fragments, and touches nothing else', () => {
  const root = mkdtempSync(join(tmpdir(), 'marxy-release-'));
  try {
    mkdirSync(join(root, FRAGMENT_DIR));
    writeFileSync(join(root, FRAGMENT_DIR, 'README.md'), 'the rule\n');
    writeFileSync(join(root, FRAGMENT_DIR, 'MARXY-2.md'), 'Second thing (MARXY-2)\n');
    writeFileSync(join(root, FRAGMENT_DIR, 'MARXY-1.md'), 'First thing (MARXY-1)\n');
    writeFileSync(join(root, 'CHANGELOG.md'), '# Changelog\n\n## Unreleased\n\n- pre-existing line (MARXY-0)\n');
    writeFileSync(join(root, 'unrelated.txt'), 'do not touch me\n');

    const result = release({ root, version: '0.5.0', date: '2026-09-28' });
    assert.equal(result.folded, 2);

    const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
    assert.match(changelog, /## Unreleased\n\n- pre-existing line \(MARXY-0\)\n\n## 0\.5\.0 - 2026-09-28/);
    // Key order: MARXY-1 before MARXY-2, regardless of the order they were written to disk.
    const idx1 = changelog.indexOf('First thing (MARXY-1)');
    const idx2 = changelog.indexOf('Second thing (MARXY-2)');
    assert.ok(idx1 > 0 && idx2 > idx1);

    assert.ok(!existsSync(join(root, FRAGMENT_DIR, 'MARXY-1.md')));
    assert.ok(!existsSync(join(root, FRAGMENT_DIR, 'MARXY-2.md')));
    assert.ok(existsSync(join(root, FRAGMENT_DIR, 'README.md')), 'README.md is not a fragment; release leaves it');
    assert.equal(readFileSync(join(root, 'unrelated.txt'), 'utf8'), 'do not touch me\n');
    assert.deepEqual(readdirSync(join(root, FRAGMENT_DIR)), ['README.md']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('release with no fragments folds an empty section and deletes nothing', () => {
  const root = mkdtempSync(join(tmpdir(), 'marxy-release-empty-'));
  try {
    mkdirSync(join(root, FRAGMENT_DIR));
    writeFileSync(join(root, 'CHANGELOG.md'), '# Changelog\n\n## Unreleased\n\n- pre-existing line (MARXY-0)\n');
    const result = release({ root, version: '0.1.0', date: '2026-09-28' });
    assert.equal(result.folded, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

