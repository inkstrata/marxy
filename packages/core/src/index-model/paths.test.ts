// Regression tests for slash-normalised path helpers (index model, ADR-0020).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { basename, dirname, isUnderRoot, joinPath, normalizePath, pathUnder, relativePath } from './paths.ts';

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

test('relativePath takes a dotted root name as a folder, never as a mistaken file (C-11)', () => {
  // A root named like a file (`v1.2`, `notes.d`) is a folder: a sibling of it is outside, by `..`.
  assert.equal(relativePath('/repo/v1.2', '/repo/readme.md'), '../readme.md');
  assert.equal(relativePath('/a/notes.d', '/a/private/y.md'), '../private/y.md');
  assert.equal(relativePath('/repo/v1.2', '/repo/v1.2/x.md'), 'x.md');
});

test('pathUnder: strict and lexical containment, with no guess from a root name (C-11)', () => {
  assert.equal(pathUnder('/repo/v1.2', '/repo/readme.md'), undefined, 'a dotted root name is still a folder');
  assert.equal(pathUnder('/a/notes.d', '/a/private/y.md'), undefined);
  assert.equal(pathUnder('/repo/v1.2', '/repo/v1.2/a/b.md'), 'a/b.md');
  assert.equal(pathUnder('/a/docs', '/a/docs2/x.md'), undefined, 'a shared name prefix is not containment');
  assert.equal(pathUnder('/a/docs', '/a/docs'), '');
  assert.equal(pathUnder('/a/docs', '/a/docs/../private/y.md'), undefined, 'a `..` segment is never under a root');
  assert.equal(pathUnder('/a/docs', '/a/docs/./x.md'), undefined, 'nor is a `.` segment');
  assert.equal(pathUnder('/', '/b.md'), 'b.md');
  assert.equal(pathUnder('/a/docs', '/a/docs//x.md'), undefined, 'an empty segment is never under a root');
  assert.equal(pathUnder('/a/docs', '/a/docs/x//y.md'), undefined);
  assert.equal(pathUnder('/', '//b.md'), undefined);
  assert.equal(pathUnder('C:\\x', 'C:\\x\\y\\z.md'), 'y/z.md');
  assert.equal(isUnderRoot('/a/docs/x.md', '/a/docs/'), true);
  assert.equal(isUnderRoot('/a/docsx', '/a/docs'), false);
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

test('a backslash is part of a name on POSIX paths', () => {
  assert.equal(normalizePath('/a\\b/'), '/a\\b');
  assert.equal(joinPath('/repo', 'a\\b.md'), '/repo/a\\b.md');
  assert.equal(joinPath('/repo/a\\b', 'c.md'), '/repo/a\\b/c.md');
  assert.equal(dirname('/repo/a\\b/c.md'), '/repo/a\\b');
  assert.equal(basename('/repo/a\\b.md'), 'a\\b.md');
  assert.equal(relativePath('/repo', '/repo/a\\b/c.md'), 'a\\b/c.md');
});

test('a Windows drive or UNC path still takes both separators', () => {
  assert.equal(normalizePath('C:\\x\\y'), 'C:/x/y');
  assert.equal(normalizePath('C:\\x\\y\\'), 'C:/x/y');
  assert.equal(normalizePath('\\\\host\\share\\f'), '//host/share/f');
  assert.equal(joinPath('C:\\x', 'y\\z.md'), 'C:/x/y/z.md');
  assert.equal(joinPath('C:\\x', 'D:\\other'), 'D:/other');
  assert.equal(basename('C:\\x\\y.md'), 'y.md');
  assert.equal(relativePath('C:\\x', 'C:\\x\\y\\z.md'), 'y/z.md');
});
