// A credential name changes only whether Find reads the file: Source draws its column guide (and wraps, by the same `fileTypeOf` kind) as for any file no row names.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readAsWords } from '../frame/model/places.ts';
import { defaultColumnGuideForPath } from './view-aids.ts';

test('a credential file keeps the column-guide default of a file no row names', () => {
  for (const path of ['/r/.npmrc', '/r/id_rsa', '/r/server.key']) {
    assert.equal(defaultColumnGuideForPath(path), defaultColumnGuideForPath('/r/zz-no-such-kind'), path);
  }
});

test('the card says a credential file is not searched', () => {
  const words = readAsWords('/r/.npmrc');
  assert.equal(words.skipped, 'may hold secrets');
  assert.equal(words.searched, false);
  assert.equal(readAsWords('/r/zz-no-such-kind').searched, true);
});
