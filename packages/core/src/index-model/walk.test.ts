// Walk honours root `.gitignore` / `.ignore` and never follows a symlink out of the root.

import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectFiles } from './index.ts';
import { nodeReader } from './node-reader.test.ts';

test('a .gitignore and a .ignore file both drop matching files', () => {
  const root = mkdtempSync(join(tmpdir(), 'marxy-index-ignore-'));
  try {
    writeFileSync(join(root, '.gitignore'), '*.tmp\n');
    writeFileSync(join(root, '.ignore'), 'secret.md\n');
    writeFileSync(join(root, 'keep.md'), '# keep\n');
    writeFileSync(join(root, 'drop.tmp'), 'x');
    writeFileSync(join(root, 'secret.md'), '# secret\n');
    const found = collectFiles(root, nodeReader()).map((f) => f.relativePath).sort();
    assert.deepEqual(found, ['keep.md']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a symlink to a directory outside the root is not followed', () => {
  const root = mkdtempSync(join(tmpdir(), 'marxy-index-link-'));
  const outside = mkdtempSync(join(tmpdir(), 'marxy-index-outside-'));
  try {
    writeFileSync(join(root, 'inside.md'), '# in\n');
    writeFileSync(join(outside, 'escape.md'), '# out\n');
    symlinkSync(outside, join(root, 'escape'));
    const found = collectFiles(root, nodeReader()).map((f) => f.relativePath);
    assert.deepEqual(found, ['inside.md']);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});
