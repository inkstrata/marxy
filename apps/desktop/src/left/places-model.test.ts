// Places as data: kinds, the filter's terms, the orders and a place's tree.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { census, foldersTo, kindCount, KIND_GROUPS, groupOf, isDot, parseFilter, passes, relOf, sorter, treeOf, type PlaceFile } from './places-model.ts';

const f = (path: string, size = 10, mtimeMs = 0, root: string | null = '/w'): PlaceFile => ({ path, root, size, mtimeMs });

test('a file is counted under the kind its name says', () => {
  assert.equal(groupOf('/w/plans/plan.md'), 'prose');
  assert.equal(groupOf('/w/src/main.rs'), 'code');
  assert.equal(groupOf('/w/data/services.json'), 'data');
  assert.equal(groupOf('/w/data/latency.csv'), 'data');
  assert.equal(groupOf('/w/logs/indexer.log'), 'logs');
  assert.equal(groupOf('/w/patches/fix.diff'), 'patches');
  assert.equal(groupOf('/w/notes.txt'), 'text');
  assert.equal(groupOf('/w/paper.pdf'), 'pages');
  assert.equal(groupOf('/w/harbour.jpg'), 'pictures');
  assert.equal(groupOf('/w/drop.zip'), 'containers');
  assert.equal(groupOf('/w/face.woff2'), 'fonts');
  assert.equal(groupOf('/w/clip.wav'), 'sound and film');
  for (const name of ['a.docx', 'a.pptx', 'a.odt', 'a.odp', 'a.doc', 'a.ppt']) assert.equal(groupOf(`/w/${name}`), 'prose', name);
  assert.equal(groupOf('/w/blob.bin'), 'bytes');
});

test('the filter: words of the path, kind:, and sizes over and under', () => {
  const q = parseFilter('plan kind:pro >1kb <2mb');
  assert.deepEqual(q.words, ['plan']);
  assert.deepEqual(q.kinds, ['pro']);
  assert.deepEqual(q.sizes, [{ over: true, bytes: 1024 }, { over: false, bytes: 2 * 1024 * 1024 }]);
  assert.equal(passes(f('/w/plans/plan.md', 4000), q), true);
  assert.equal(passes(f('/w/plans/plan.md', 400), q), false, 'too small');
  assert.equal(passes(f('/w/plans/plan.json', 4000), q), false, 'not prose');
  assert.equal(passes(f('/w/notes.md', 4000), q), false, 'no plan in its path');
  assert.equal(passes(f('/elsewhere/plan.md', 4000, 0, '/elsewhere'), parseFilter('elsewhere')), false, 'the place itself is not part of the path matched');
  assert.equal(parseFilter('  ').any, false);
});

test('orders: by name with dot files last, by kind, largest first, newest first', () => {
  const files = [f('/w/b.md', 5, 3), f('/w/.a.md', 50, 1), f('/w/a.rs', 7, 2), f('/w/c.md', 1, 9)];
  const names = (o: 'name' | 'kind' | 'size' | 'modified') => files.slice().sort(sorter(o)).map((x) => relOf(x));
  assert.deepEqual(names('name'), ['a.rs', 'b.md', 'c.md', '.a.md']);
  assert.deepEqual(names('kind'), ['b.md', 'c.md', '.a.md', 'a.rs']);
  assert.deepEqual(names('size'), ['.a.md', 'a.rs', 'b.md', 'c.md']);
  assert.deepEqual(names('modified'), ['c.md', 'b.md', 'a.rs', '.a.md']);
  assert.equal(isDot(f('/w/.github/ci.yml')), true);
  assert.equal(isDot(f('/w/src/ci.yml')), false);
});

test('the count line and a place as a tree', () => {
  const files = [f('/w/plans/a.md'), f('/w/plans/old/b.md'), f('/w/data/c.json'), f('/w/d.md')];
  assert.deepEqual(census(files), [['prose', 3], ['data', 1]]);
  const tree = treeOf('/w/', files);
  assert.equal(tree.count, 4);
  assert.deepEqual([...tree.dirs.keys()], ['plans', 'data']);
  assert.equal(tree.dirs.get('plans')!.count, 2);
  assert.equal(tree.dirs.get('plans')!.dirs.get('old')!.path, '/w/plans/old');
  assert.deepEqual(tree.files.map((x) => x.path), ['/w/d.md']);
  assert.deepEqual(foldersTo('/w', '/w/plans/old/b.md'), ['/w/plans', '/w/plans/old']);
  assert.deepEqual(foldersTo('/w', '/x/b.md'), []);
});

test('a viewer file in its place is listed in the place and counted by kind', () => {
  const files = [f('/w/reading/paper.pdf', 10, 0, '/w/reading'), f('/w/reading/report.docx', 10, 0, '/w/reading'), f('/w/reading/tide.png', 10, 0, '/w/reading')];
  assert.deepEqual(census(files), [['prose', 1], ['pages', 1], ['pictures', 1]]);
  assert.deepEqual(treeOf('/w/reading', files).files.map((x) => relOf(x)), ['paper.pdf', 'report.docx', 'tide.png']);
});

test('the count line says each kind in correct plurals', () => {
  assert.deepEqual(KIND_GROUPS.map((g) => kindCount(1, g)), ['1 prose', '1 code', '1 data', '1 log', '1 patch', '1 text', '1 page', '1 picture', '1 sound or film', '1 container', '1 font', '1 file of bytes']);
  assert.deepEqual(KIND_GROUPS.map((g) => kindCount(2, g)), ['2 prose', '2 code', '2 data', '2 logs', '2 patches', '2 text', '2 pages', '2 pictures', '2 sound and film', '2 containers', '2 fonts', '2 files of bytes']);
  assert.equal(kindCount(1200, 'logs'), '1,200 logs');
});
