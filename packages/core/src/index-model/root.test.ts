// Root detection matches ADR-0012: enclosing repository, else the file's own directory.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectIndexRoot } from './index.ts';
import { nodeReader } from './node-reader.test.ts';

function scratch(label: string): string {
  const dir = mkdtempSync(join(tmpdir(), `marxy-index-root-${label}-`));
  return dir;
}

test('a file inside a git repository indexes the repository root', () => {
  const repo = scratch('repo');
  try {
    mkdirSync(join(repo, '.git'));
    mkdirSync(join(repo, 'src', 'nested'), { recursive: true });
    const file = join(repo, 'src', 'nested', 'readme.md');
    writeFileSync(file, '# hi\n');
    assert.equal(detectIndexRoot(file, nodeReader()), repo);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('a file with no enclosing repository indexes its own directory', () => {
  const dir = scratch('norepo');
  try {
    const file = join(dir, 'notes.md');
    writeFileSync(file, 'notes\n');
    assert.equal(detectIndexRoot(file, nodeReader()), dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a .git file (worktree) counts as a repository root', () => {
  const repo = scratch('worktree');
  try {
    writeFileSync(join(repo, '.git'), 'gitdir: /tmp/somewhere\n');
    const file = join(repo, 'doc.md');
    writeFileSync(file, 'x\n');
    assert.equal(detectIndexRoot(file, nodeReader()), repo);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
