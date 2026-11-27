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

test('a backslash is not a separator: a folder named a\\node_modules is not node_modules', () => {
  assert.equal(isDeniedPath('a\\node_modules/x.md'), false);
  assert.equal(isDeniedPath('a/node_modules/x.md'), true);
});

// the list names folders. A file called build or out is a file, and the name matches in any case, as the
// desktop shell's copies (commands/fs.rs and the rest) match it.
test('only a folder is denied by its name, in any case', async () => {
  const { isDeniedName, buildIndex } = await import('./index.ts');
  const { isIgnored } = await import('./ignore.ts');
  assert.equal(isIgnored('out', false, []), false);
  assert.equal(isIgnored('out', true, []), true);
  assert.equal(isIgnored('scripts/build', false, []), false);
  assert.equal(isIgnored('scripts/build/x.md', false, []), true);
  assert.equal(isIgnored('docs/Build/x.md', false, []), true);
  assert.equal(isDeniedName('Build'), true);
  assert.equal(isDeniedName('NODE_MODULES'), true);
  assert.equal(isDeniedPath('scripts/build'), false);
  assert.equal(isDeniedPath('scripts/build', true), true);
  assert.equal(isDeniedPath('Dist/bundle.js'), true);
  const built = buildIndex('/r', [{ path: '/r/notes/out.md', relativePath: 'notes/out.md', mtimeMs: 0, size: 1 }]);
  assert.equal(built.entries.length, 1);
});

test('a walk lists a file named like a denied folder, and skips the folder', () => {
  const root = mkdtempSync(join(tmpdir(), 'marxy-index-deny-file-'));
  try {
    mkdirSync(join(root, 'scripts'));
    mkdirSync(join(root, 'Build'));
    writeFileSync(join(root, 'scripts', 'build'), '#!/bin/sh\n');
    writeFileSync(join(root, 'out'), 'notes\n');
    writeFileSync(join(root, 'Build', 'x.md'), '# never\n');
    const found = collectFiles(root, nodeReader()).map((file) => file.relativePath).sort();
    assert.deepEqual(found, ['out', 'scripts/build']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
