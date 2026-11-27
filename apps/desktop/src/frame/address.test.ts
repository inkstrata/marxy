// The head's address and the spine's map: pure parts.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { folderSteps, headingChain, headingIndexAt, siblingHeadings, type HeadingMark } from './address.ts';
import { estimatedHeight, scrollTopAt, spineFraction, thumbOf, yOfByte, type SpineGeometry } from './spine-map.ts';

const H: HeadingMark[] = [
  { level: 1, text: 'Plan', start: 0 },
  { level: 2, text: 'Scope', start: 100 },
  { level: 3, text: 'In', start: 150 },
  { level: 3, text: 'Out', start: 200 },
  { level: 2, text: 'Dates', start: 300 },
  { level: 3, text: 'Freeze', start: 350 },
  { level: 2, text: 'Rollback', start: 500 },
];

test('the chain of headings the reading line is under, outermost first', () => {
  assert.equal(headingIndexAt(H, 50), 0);
  assert.equal(headingIndexAt([{ level: 2, text: 'x', start: 10 }], 5), -1);
  assert.deepEqual(headingChain(H, 210).map((i) => H[i]!.text), ['Plan', 'Scope', 'Out']);
  assert.deepEqual(headingChain(H, 320).map((i) => H[i]!.text), ['Plan', 'Dates']);
  assert.deepEqual(headingChain(H, 0).map((i) => H[i]!.text), ['Plan']);
  assert.deepEqual(headingChain([{ level: 2, text: 'a', start: 0 }, { level: 2, text: 'b', start: 9 }], 20).map((i) => i), [1]);
});

test('a heading\'s siblings are its level within the section that holds it', () => {
  assert.deepEqual(siblingHeadings(H, 3).map((i) => H[i]!.text), ['In', 'Out']);
  assert.deepEqual(siblingHeadings(H, 4).map((i) => H[i]!.text), ['Scope', 'Dates', 'Rollback']);
  assert.deepEqual(siblingHeadings(H, 5).map((i) => H[i]!.text), ['Freeze']);
});

test('the folders run from the deepest place that holds the file; a file in no place from its drive', () => {
  assert.deepEqual(folderSteps('/w/plans/q4/a.md', ['/w', '/w/plans']), [
    { label: 'plans', dir: '/w/plans' },
    { label: 'q4', dir: '/w/plans/q4' },
  ]);
  assert.deepEqual(folderSteps('/w/a.md', ['/w/']), [{ label: 'w', dir: '/w' }]);
  assert.deepEqual(folderSteps('/r/A.md', []), [
    { label: '/', dir: '/' },
    { label: 'r', dir: '/r' },
  ]);
  assert.deepEqual(folderSteps('C:/Users/me/a.md', ['C:/Other']).map((s) => s.label), ['C:', 'Users', 'me']);
  assert.deepEqual(folderSteps('C:\\Users\\me\\a.md', ['C:\\Users']).map((s) => s.dir), ['C:/Users', 'C:/Users/me']);
});

test('the drive crumb opens the drive\'s root, and a UNC share keeps its two slashes', () => {
  assert.deepEqual(folderSteps('C:/Users/a.md', []), [
    { label: 'C:', dir: 'C:/' },
    { label: 'Users', dir: 'C:/Users' },
  ]);
  assert.deepEqual(folderSteps('C:/a.md', []), [{ label: 'C:', dir: 'C:/' }]);
  assert.deepEqual(folderSteps('D:/x/a.md', ['D:/']), [
    { label: 'D:', dir: 'D:/' },
    { label: 'x', dir: 'D:/x' },
  ]);
  assert.deepEqual(folderSteps('//host/share/docs/a.md', []), [
    { label: '//host/share', dir: '//host/share' },
    { label: 'docs', dir: '//host/share/docs' },
  ]);
  assert.deepEqual(folderSteps('/a.md', []), [{ label: '/', dir: '/' }]);
});

const whole: SpineGeometry = {
  blocks: [
    { start: 0, top: 0, height: 100 },
    { start: 50, top: 100, height: 100 },
    { start: 120, top: 200, height: 800 },
  ],
  offset: 56,
  scrollHeight: 1100,
  totalBytes: 200,
  mountedBytes: 200,
};

test('a byte sits where its block is, from the block list', () => {
  assert.equal(yOfByte(whole, 60), 156);
  assert.equal(yOfByte(whole, 0), 56);
  assert.equal(spineFraction(whole, 120), 256 / 1100);
  assert.deepEqual(thumbOf(whole, 550, 550), { top: 0.5, size: 0.5 });
  assert.equal(scrollTopAt(whole, 0.5, 400), 350);
});

test('past the mounted end, a byte is placed by its share of what is still to come', () => {
  const half: SpineGeometry = { blocks: [{ start: 0, top: 0, height: 500 }], offset: 0, scrollHeight: 500, totalBytes: 1000, mountedBytes: 500 };
  assert.equal(estimatedHeight(half), 1000);
  assert.equal(yOfByte(half, 750), 750);
  assert.equal(spineFraction(half, 1000), 1);
  assert.equal(spineFraction({ ...half, blocks: [] }, 250), 0.25);
});
