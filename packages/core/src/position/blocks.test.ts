// Reading-line block math: compute and restore are inverses at corpus boundaries (ADR-0018).

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseMarkdown } from '../parse/parse.ts';
import {
  positionAtScroll,
  scrollTopForPosition,
  sameFirstVisibleBlock,
  type LayoutBlock,
} from './blocks.ts';

const corpus = new URL('../../../../fixtures/corpus/', import.meta.url);

function syntheticBlocks(document: ReturnType<typeof parseMarkdown>, blockHeight = 100): LayoutBlock[] {
  const blocks: LayoutBlock[] = [];
  let top = 0;
  for (const node of document.children) {
    blocks.push({ start: node.src.start, top, height: blockHeight });
    top += blockHeight;
  }
  return blocks;
}

test('fraction is 0 at a block top and 1 at its bottom', () => {
  const blocks: LayoutBlock[] = [{ start: 10, top: 200, height: 80 }];
  const viewport = 500;
  const atTop = scrollTopForPosition(blocks, 10, 0, viewport);
  const atBottom = scrollTopForPosition(blocks, 10, 1, viewport);
  assert.equal(positionAtScroll(blocks, atTop, viewport).fraction, 0);
  assert.equal(positionAtScroll(blocks, atBottom, viewport).fraction, 1);
});

test('restore is the inverse of compute at every corpus block boundary', () => {
  const bytes = new Uint8Array(readFileSync(new URL('01-long-technical.md', corpus)));
  const document = parseMarkdown(bytes, { file: '01-long-technical.md' });
  const blocks = syntheticBlocks(document);
  const viewports = [480, 720, 1080];
  for (const viewportHeight of viewports) {
    for (const block of blocks) {
      for (const fraction of [0, 0.25, 0.5, 1]) {
        const scrollTop = scrollTopForPosition(blocks, block.start, fraction, viewportHeight);
        // A page cannot scroll above its top: there the position is the top (0, 0), tested below.
        if (scrollTop <= 0) continue;
        const back = positionAtScroll(blocks, scrollTop, viewportHeight);
        const resync = scrollTopForPosition(blocks, back.byteOffset, back.fraction, viewportHeight);
        assert.ok(
          Math.abs(resync - scrollTop) < 0.05,
          `scroll round-trip failed for start=${block.start} fraction=${fraction} at ${viewportHeight}px`,
        );
      }
    }
  }
});

test('reopening within one line keeps the same first visible block', () => {
  const bytes = new Uint8Array(readFileSync(new URL('02-readme-real-world.md', corpus)));
  const document = parseMarkdown(bytes, { file: '02-readme-real-world.md' });
  const blocks = syntheticBlocks(document, 120);
  const viewport = 800;
  const scrollBefore = scrollTopForPosition(blocks, blocks[5].start, 0.3, viewport);
  const scrollAfter = scrollTopForPosition(blocks, blocks[5].start, 0.35, viewport);
  assert.ok(sameFirstVisibleBlock(blocks, scrollBefore, scrollAfter, viewport, 24));
});

test('a pair a block apart is not "within one line" (S-05-0003)', () => {
  const blocks: LayoutBlock[] = [
    { start: 0, top: 0, height: 100 },
    { start: 40, top: 100, height: 100 },
  ];
  const viewport = 800;
  const top = scrollTopForPosition(blocks, 0, 0, viewport);
  const bottom = scrollTopForPosition(blocks, 0, 1, viewport);
  assert.equal(Math.abs(top - bottom), 100);
  assert.equal(sameFirstVisibleBlock(blocks, top, bottom, viewport, 24), false);
  // A fifth of a 100 px block is 20 px: within a 24 px line.
  const near = scrollTopForPosition(blocks, 0, 0.2, viewport);
  assert.equal(sameFirstVisibleBlock(blocks, top, near, viewport, 24), true);
});

test('a byte inside a block restores to that block, not the next one (S-05-0001)', () => {
  const blocks: LayoutBlock[] = [
    { start: 0, top: 0, height: 400 },
    { start: 500, top: 400, height: 80 },
  ];
  const viewport = 800;
  const top = scrollTopForPosition(blocks, 200, 0, viewport);
  assert.deepEqual(positionAtScroll(blocks, top, viewport), { byteOffset: 0, fraction: 0 });
  // Past the last block's start: the last block. Before the first: the first.
  assert.deepEqual(positionAtScroll(blocks, scrollTopForPosition(blocks, 900, 0.5, viewport), viewport), {
    byteOffset: 500,
    fraction: 0.5,
  });
  const late: LayoutBlock[] = [{ start: 10, top: 50, height: 100 }, ...blocks.slice(1)];
  assert.equal(scrollTopForPosition(late, 3, 0, viewport), 50 - 0.4 * viewport);
  // A block start is still that block's top.
  assert.equal(scrollTopForPosition(blocks, 500, 0, viewport), 400 - 0.4 * viewport);
});

test('a reader who has not scrolled is at byte 0 whatever block crosses the reading line (F-19.1)', () => {
  const blocks: LayoutBlock[] = [
    { start: 0, top: 0, height: 40 },
    { start: 9, top: 40, height: 600 },
  ];
  const viewport = 760;
  assert.deepEqual(positionAtScroll(blocks, 0, viewport), { byteOffset: 0, fraction: 0 });
  assert.deepEqual(positionAtScroll(blocks, -12, viewport), { byteOffset: 0, fraction: 0 });
  // The reading line (304 px) is inside the second block as soon as there is any scroll.
  assert.equal(positionAtScroll(blocks, 1, viewport).byteOffset, 9);
});
