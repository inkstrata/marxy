import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { pdfBlocks, times } from './pdf-blocks.ts';

// A US Letter page's viewport at scale 1: y flipped, origin at the top.
const VIEW = [1, 0, 0, -1, 0, 792];
const run = (str: string, x: number, y: number, size: number, width = str.length * size * 0.5) => ({ str, transform: [size, 0, 0, size, x, y], width });

test('matrices compose as PDF writes them', () => {
  assert.deepEqual(times(VIEW, [12, 0, 0, 12, 72, 700]), [12, 0, 0, -12, 72, 92]);
});

test('a heading, then a paragraph of three lines, then one after a gap: three blocks, each its text in order', () => {
  const blocks = pdfBlocks(
    [
      run('The case for', 72, 700, 24),
      run('ragged lines', 72 + 12 * 12 + 6, 700, 24),
      run('Justified text', 72, 650, 11),
      run('spreads its spaces', 72, 636, 11),
      run('unevenly.', 72, 622, 11),
      run('', 0, 0, 11),
      run('A second paragraph.', 72, 590, 11),
    ],
    VIEW,
  );
  assert.deepEqual(
    blocks.map((b) => b.text),
    ['The case for ragged lines', 'Justified text spreads its spaces unevenly.', 'A second paragraph.'],
  );
  const [h, p] = blocks;
  assert.ok(h!.top < p!.top && h!.bottom <= p!.top, 'the heading is above the paragraph');
  assert.equal(p!.left, 72);
  assert.ok(Math.abs(p!.top - (792 - 650 - 11 * 0.85)) < 0.01, 'the top is the first line\'s ascent');
});

test('runs on one line join, with a space only where the page leaves room', () => {
  const [b] = pdfBlocks([run('Hyph', 72, 700, 10, 20), run('enated', 92, 700, 10, 30), run('word', 130, 700, 10, 20)], VIEW);
  assert.equal(b!.text, 'Hyphenated word');
});

test('a page with no text has no blocks', () => {
  assert.deepEqual(pdfBlocks([], VIEW), []);
  assert.deepEqual(pdfBlocks([run('   ', 72, 700, 10)], VIEW), []);
});
