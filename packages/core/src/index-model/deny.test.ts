// node_modules (and the rest of the deny list) are never indexed, even when they contain markdown.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectFiles, isDeniedPath } from './index.ts';
import { nodeReader } from './node-reader.test.ts';

test('isDeniedPath treats node_modules as denied wherever it sits', () => {
  assert.equal(isDeniedPath('node_modules/left-pad/index.md'), true);
  assert.equal(isDeniedPath('target/debug/lib.rs'), true);
  assert.equal(isDeniedPath('dist/bundle.js'), true);
  assert.equal(isDeniedPath('src/readme.md'), false);
});

test('a walk never indexes files under node_modules', () => {
  const root = mkdtempSync(join(tmpdir(), 'marxy-index-deny-'));
  try {
    mkdirSync(join(root, 'src'));
    mkdirSync(join(root, 'node_modules', 'left-pad'), { recursive: true });
    writeFileSync(join(root, 'src', 'readme.md'), '# src\n');
    writeFileSync(join(root, 'node_modules', 'left-pad', 'index.md'), '# pkg\n');
    writeFileSync(join(root, 'node_modules', 'README.md'), '# never\n');
    const found = collectFiles(root, nodeReader());
    assert.deepEqual(
      found.map((file) => file.relativePath).sort(),
      ['src/readme.md'],
    );
    assert.equal(
      found.some((file) => file.path.includes('node_modules')),
      false,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
