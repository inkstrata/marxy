// Regression tests for slash-normalised path helpers (index model, ADR-0020).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, joinPath, normalizePath, relativePath } from './paths.ts';

test('normalizePath strips trailing slashes except the filesystem root', () => {
  assert.equal(normalizePath('/a/b/'), '/a/b');
  assert.equal(normalizePath('/'), '/');
});

test('dirname and joinPath round-trip directory segments', () => {
  assert.equal(dirname('/repo/src/readme.md'), '/repo/src');
  assert.equal(joinPath('/repo', 'src/readme.md'), '/repo/src/readme.md');
});

// Sole production caller: walk.ts `relativePath(root, entry.path)` with index `root` (always a directory).
test('relativePath from an index root directory to nested files', () => {
  const root = '/var/project';
  assert.equal(relativePath(root, joinPath(root, 'src/readme.md')), 'src/readme.md');
  assert.equal(relativePath(root, joinPath(root, 'src/nested/doc.md')), 'src/nested/doc.md');
});

test('relativePath resolves a mistaken file path for from when basename could match to', () => {
  const root = '/var/project';
  const doc = joinPath(root, 'foo.md');
  const nested = joinPath(joinPath(root, 'foo'), 'bar.md');
  assert.equal(relativePath(doc, nested), 'foo/bar.md');
});

test('relativePath keeps directory from when to is under it', () => {
  const root = '/var/project';
  const dir = joinPath(root, 'foo');
  const nested = joinPath(dir, 'bar.md');
  assert.equal(relativePath(dir, nested), 'bar.md');
});

test('relativePath from the filesystem root gives a downward path', () => {
  assert.equal(relativePath('/', '/a/b.md'), 'a/b.md');
  assert.equal(relativePath('/', '/b.md'), 'b.md');
});

test('relativePath does not take a sibling with a shared name prefix as inside', () => {
  assert.equal(relativePath('/a/docs', '/a/docs2/x.md'), '../docs2/x.md');
});
