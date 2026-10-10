// An image beside a document in a folder named a\b resolves into that folder (C-03.1).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathsForDocument } from './images.ts';

test('pathsForDocument keeps a backslash in the folder name on POSIX', () => {
  assert.deepEqual(pathsForDocument('/repo/a\\b/doc.md'), { documentDir: '/repo/a\\b', imageRoot: '/repo/a\\b' });
});

test('pathsForDocument still normalises a Windows path', () => {
  assert.equal(pathsForDocument('C:\\repo\\docs\\doc.md').documentDir, 'C:/repo/docs');
});
