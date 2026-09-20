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
