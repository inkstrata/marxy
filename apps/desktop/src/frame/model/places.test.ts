// The places in the reader's order, a move within them, and how a file would be read by its name.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inOrder, leftOutWhy, moved, readAsWords } from './places.ts';

const places = (...roots: string[]) => roots.map((root) => ({ root }));

test('the order named comes first, the rest keep the order they came in, and a gone place is passed over', () => {
  const out = inOrder(places('/a', '/b', '/c', '/d'), ['/c', '/gone', '/a']).map((p) => p.root);
  assert.deepEqual(out, ['/c', '/a', '/b', '/d']);
});

test('a move swaps a place with its neighbour, and does nothing past either end', () => {
  assert.deepEqual(moved(['/a', '/b', '/c'], '/b', -1), ['/b', '/a', '/c']);
  assert.deepEqual(moved(['/a', '/b', '/c'], '/c', 1), ['/a', '/b', '/c']);
  assert.deepEqual(moved(['/a', '/b'], '/x', 1), ['/a', '/b']);
  assert.deepEqual(moved(['/a', '/b'], '/b', -1, ['/a', '/gone', '/b']), ['/b', '/a', '/gone'], 'a gone place keeps its name in the order');
});

test('a file is read by its name as the Reading card says it, and search says what it leaves out', () => {
  assert.deepEqual(readAsWords('plan.md'), { words: 'Markdown', searched: true, skipped: null });
  assert.equal(readAsWords('build.log').words, 'a log');
  assert.equal(readAsWords('fix.patch').words, 'a patch');
  assert.equal(readAsWords('p95.csv').words, 'data, a table');
  assert.equal(readAsWords('runs.jsonl').words, 'data, records');
  assert.equal(readAsWords('release.json').words, 'data, a tree');
  assert.deepEqual(readAsWords('photo.png'), { words: 'binary, an image', searched: false, skipped: 'binary' });
  assert.deepEqual(readAsWords('/r/README'), { words: 'text', searched: true, skipped: null });
  // LICENSE-MIT is a prose name since the alias table; a name the registry does not know is set as written.
  assert.equal(readAsWords('LICENSE-MIT').words, 'text');
  assert.equal(readAsWords('LICENSE-THIRD-PARTY').words, 'text, set as written');
  assert.match(leftOutWhy('node_modules') ?? '', /tools and builds/);
  assert.match(leftOutWhy('.versions') ?? '', /dot folder/);
  assert.equal(leftOutWhy('docs'), null);
});
