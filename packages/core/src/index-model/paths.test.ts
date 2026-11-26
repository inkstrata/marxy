// Regression tests for slash-normalised path helpers (index model).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { basename, dirname, isUnderRoot, joinPath, normalizePath, pathUnder, relativePath, fileKey, sameFilePath } from './paths.ts';

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

test('relativePath takes a dotted root name as a folder, never as a mistaken file', () => {
  // A root named like a file (`v1.2`, `notes.d`) is a folder: a sibling of it is outside, by `..`.
  assert.equal(relativePath('/repo/v1.2', '/repo/readme.md'), '../readme.md');
  assert.equal(relativePath('/a/notes.d', '/a/private/y.md'), '../private/y.md');
  assert.equal(relativePath('/repo/v1.2', '/repo/v1.2/x.md'), 'x.md');
});

test('pathUnder: strict and lexical containment, with no guess from a root name', () => {
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

test('sameFilePath: a Windows path names one file whatever the case of its letters; a POSIX path is exact', () => {
  assert.equal(sameFilePath('C:\\A\\b.md', 'c:\\a\\B.md'), true);
  assert.equal(sameFilePath('C:\\Ærø\\Æ.md', 'c:/ærø/æ.MD'), true, 'letters past ASCII fold too');
  assert.equal(sameFilePath('\\\\?\\C:\\A\\b.md', 'C:\\a\\b.md'), true, 'the verbatim spelling is the same file');
  assert.equal(sameFilePath('\\\\Server\\Share\\x.md', '\\\\server\\share\\X.md'), true);
  assert.equal(sameFilePath('C:\\A\\b.md', 'C:\\A\\b.mdx'), false);
  // One character to one: a fold that makes two characters of one (ß as SS) is not how Windows compares names.
  assert.equal(sameFilePath('C:\\straße.md', 'C:\\STRASSE.md'), false);
  assert.equal(sameFilePath('/r/A.md', '/r/a.md'), false);
  assert.equal(sameFilePath('/r/A.md', '/r/A.md'), true);
});

test('sameFilePath folds a letter only when its case pair goes both ways: ı and ſ are not I and S', () => {
  assert.equal(sameFilePath('C:\\notes\\é.md', 'C:\\NOTES\\É.md'), true);
  assert.equal(sameFilePath('C:\\notes\\i.md', 'C:\\notes\\I.md'), true);
  // Upper-cased, `ı` is `I` and `ſ` is `S`, but neither comes back: `ı.md` and `I.md` are two files.
  assert.equal(sameFilePath('C:\\notes\\ı.md', 'C:\\notes\\I.md'), false);
  assert.equal(sameFilePath('C:\\notes\\ı.md', 'C:\\notes\\i.md'), false);
  assert.equal(sameFilePath('C:\\notes\\ſ.md', 'C:\\notes\\S.md'), false);
  assert.equal(sameFilePath('C:\\notes\\ſ.md', 'C:\\notes\\s.md'), false);
  assert.equal(sameFilePath('C:\\notes\\ß.md', 'C:\\notes\\ß.md'), true);
  assert.equal(sameFilePath('C:\\notes\\ß.md', 'C:\\notes\\SS.md'), false);
  assert.equal(sameFilePath('C:\\notes\\ß.md', 'C:\\notes\\ss.md'), false);
  assert.equal(sameFilePath('C:\\notes\\ς.md', 'C:\\notes\\Σ.md'), false, 'final sigma does not come back from Σ');
});

test('sameFilePath folds . and .. segments and doubled separators in a Windows path; a POSIX path keeps ..', () => {
  assert.equal(sameFilePath('C:\\a\\.\\b\\..\\c.md', 'c:/A/c.md'), true);
  assert.equal(sameFilePath('C:\\a\\\\b.md', 'C:\\a\\b.md'), true);
  assert.equal(sameFilePath('C:/a//b/./c.md', 'C:\\a\\b\\c.md'), true);
  assert.equal(sameFilePath('C:\\..\\a.md', 'C:\\a.md'), true, 'not above the drive');
  assert.equal(sameFilePath('\\\\s\\share\\..\\x.md', '\\\\s\\share\\x.md'), true, 'not above the share');
  assert.equal(sameFilePath('C:\\a\\..\\b.md', 'C:\\a\\b.md'), false);
  assert.equal(sameFilePath('D:\\a.md', 'C:\\a.md'), false);
  assert.equal(sameFilePath('/r/./a.md', '/r//a.md'), true);
  assert.equal(sameFilePath('/r/./a.md', '/r/a.md'), true);
  // On macOS and Linux `x` may be a link, so `x/..` need not be `/r`.
  assert.equal(sameFilePath('/r/x/../a.md', '/r/a.md'), false);
});

test('fileKey is one key for every spelling of a file, and differs between files', () => {
  assert.equal(fileKey('C:\\Notes\\Plan.md'), fileKey('c:/notes/./PLAN.md'));
  assert.equal(fileKey('\\\\?\\UNC\\srv\\Share\\a.md'), fileKey('\\\\SRV\\share\\A.md'));
  assert.notEqual(fileKey('C:\\Notes\\Plan.md'), fileKey('C:\\Notes\\Plan.md.bak'));
  assert.equal(fileKey('/r/Plan.md'), '/r/Plan.md');
  assert.equal(fileKey('untitled'), 'untitled');
  assert.equal(fileKey('archive-entry:4/notes//a.md'), 'archive-entry:4/notes//a.md', 'a name that is not a path is its own key');
});
