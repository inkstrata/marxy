import { test } from 'node:test';
import assert from 'node:assert/strict';
import { besideIn, folderOrder } from './folder-order.ts';

const f = (path: string) => ({ path, isDir: false });
const d = (path: string) => ({ path, isDir: true });

test('folders come first, then files by name without regard to case', () => {
  const sorted = folderOrder([f('/a/b.md'), d('/a/z'), f('/a/A.md'), d('/a/m'), f('/a/c.md')]);
  assert.deepEqual(sorted.map((e) => e.path), ['/a/m', '/a/z', '/a/A.md', '/a/b.md', '/a/c.md']);
});

test('a file has the files either side of it in that order, folders left out', () => {
  const dir = [f('/a/b.md'), d('/a/0-dir'), f('/a/a.md'), f('/a/c.md')];
  assert.deepEqual(besideIn(dir, '/a/b.md'), { index: 1, count: 3, previous: '/a/a.md', next: '/a/c.md' });
});

test('nothing wraps: the first file has no previous and the last no next', () => {
  const dir = [f('/a/a.md'), f('/a/b.md'), f('/a/c.md')];
  assert.equal(besideIn(dir, '/a/a.md').previous, null);
  assert.equal(besideIn(dir, '/a/a.md').next, '/a/b.md');
  assert.equal(besideIn(dir, '/a/c.md').next, null);
  assert.equal(besideIn(dir, '/a/c.md').previous, '/a/b.md');
});

test('a folder with one file has no neighbours', () => {
  assert.deepEqual(besideIn([f('/a/only.txt'), d('/a/sub')], '/a/only.txt'), { index: 0, count: 1, previous: null, next: null });
});

test('files of every kind stand in one list by name', () => {
  const dir = [f('/a/notes.md'), f('/a/photo.png'), f('/a/data.csv'), f('/a/app.log'), f('/a/z.pdf')];
  assert.equal(besideIn(dir, '/a/data.csv').previous, '/a/app.log');
  assert.equal(besideIn(dir, '/a/data.csv').next, '/a/notes.md');
  assert.equal(besideIn(dir, '/a/photo.png').next, '/a/z.pdf');
});

test('a file the listing does not hold is put in at its place, so stepping works from it', () => {
  assert.deepEqual(besideIn([f('/a/a.md'), f('/a/c.md')], '/a/b.md'), { index: 1, count: 3, previous: '/a/a.md', next: '/a/c.md' });
});

test('a drive letter in another case is the same file', () => {
  const dir = [f('C:/r/a.md'), f('C:/r/b.md'), f('C:/r/c.md')];
  assert.deepEqual(besideIn(dir, 'c:/r/b.md'), { index: 1, count: 3, previous: 'C:/r/a.md', next: 'C:/r/c.md' });
});

test('numbers in names go by value', () => {
  const dir = [f('/a/img10.png'), f('/a/img2.png'), f('/a/img1.png')];
  assert.equal(besideIn(dir, '/a/img2.png').next, '/a/img10.png');
  assert.equal(besideIn(dir, '/a/img2.png').previous, '/a/img1.png');
});
