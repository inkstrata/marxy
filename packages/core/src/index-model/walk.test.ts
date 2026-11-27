// Walk honours root `.gitignore` / `.ignore` and never follows a symlink out of the root.

import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectFiles, parseIgnore } from './index.ts';
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

test('a symlink to a directory outside the root is not followed', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'marxy-index-link-'));
  const outside = mkdtempSync(join(tmpdir(), 'marxy-index-outside-'));
  try {
    writeFileSync(join(root, 'inside.md'), '# in\n');
    writeFileSync(join(outside, 'escape.md'), '# out\n');
    try {
      symlinkSync(outside, join(root, 'escape'));
    } catch (e) {
      // Windows without Developer Mode or the privilege refuses symlinks.
      if ((e as NodeJS.ErrnoException).code === 'EPERM') return t.skip('symlinks are not permitted here');
      throw e;
    }
    const found = collectFiles(root, nodeReader()).map((f) => f.relativePath);
    assert.deepEqual(found, ['inside.md']);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('a file and a folder with a backslash in the name keep it from walk to open path', { skip: process.platform === 'win32' }, () => {
  const root = mkdtempSync(join(tmpdir(), 'marxy-index-bslash-'));
  try {
    mkdirSync(join(root, 'a\\b'));
    writeFileSync(join(root, 'a\\b', 'c.md'), '# c\n');
    writeFileSync(join(root, 'x\\y.md'), '# y\n');
    const found = collectFiles(root, nodeReader());
    assert.deepEqual(found.map((f) => f.relativePath).sort(), ['a\\b/c.md', 'x\\y.md']);
    for (const f of found) assert.ok(f.path.startsWith(root) && f.path.includes('\\'), f.path);
    assert.ok(found.some((f) => f.path === `${root}/a\\b/c.md`));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a listing entry whose path climbs out of the root through a .. segment is not indexed', () => {
  const root = '/repo';
  const entry = (name: string, path: string, isDir = false) => ({ name, path, isDir, mtimeMs: 0, size: 1 });
  const reader = {
    readDir: (dir: string) => dir === root
      ? [
          entry('ok.md', '/repo/ok.md'),
          entry('passwd.md', '/repo/foo/../../etc/passwd.md'),
          entry('inside.md', '/repo/foo/../inside.md'),
          entry('dot.md', '/repo/./dot.md'),
          entry('up', '/repo/../up', true),
        ]
      : [],
    readText: () => undefined,
  };
  assert.deepEqual(collectFiles(root, reader).map((f) => f.path), ['/repo/ok.md']);
});

test('collectFiles names the folders the ignore rules and deny globs left out, outermost only, and not the built-in names', () => {
  const root = mkdtempSync(join(tmpdir(), 'marxy-index-ignored-dirs-'));
  try {
    writeFileSync(join(root, '.gitignore'), 'gen-out/\n');
    for (const dir of ['gen-out/deep', 'denied-by-glob', 'node_modules/x', 'kept']) mkdirSync(join(root, dir), { recursive: true });
    for (const file of ['gen-out/deep/a.js', 'denied-by-glob/b.md', 'node_modules/x/c.js', 'kept/d.md']) writeFileSync(join(root, file), 'x');
    const ignoredDirs: string[] = [];
    const found = collectFiles(root, nodeReader(), { extraRules: parseIgnore('denied-by-glob/\n', ''), ignoredDirs });
    assert.deepEqual(found.map((f) => f.relativePath), ['kept/d.md']);
    const slash = (p: string) => p.replace(/\\/g, '/');
    assert.deepEqual(ignoredDirs.map((d) => slash(d).slice(slash(root).length + 1)).sort(), ['denied-by-glob', 'gen-out']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
