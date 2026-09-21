// MARXY-96: island removals carry byte provenance; renderer-pass removals do not.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseMarkdown } from '../parse/parse.ts';
import { renderDocumentSafeHtml } from './pipeline.ts';

const readmePath = new URL('../../../../fixtures/corpus/02-readme-real-world.md', import.meta.url);

test('an island removal in 02-readme-real-world.md carries that island src', () => {
  const bytes = readFileSync(readmePath);
  const document = parseMarkdown(bytes, { file: '02-readme-real-world.md' });
  const { removed } = renderDocumentSafeHtml(document);
  const island = removed.find((removal) => removal.src !== undefined);
  assert.ok(island !== undefined, 'expected at least one island removal from the README header block');
  const block = document.children.find((child) => child.type === 'htmlBlock');
  assert.ok(block?.type === 'htmlBlock');
  assert.equal(island.src?.start, block.src.start);
  assert.equal(island.src?.end, block.src.end);
});

test('a renderer-pass image removal has no island src', () => {
  const document = parseMarkdown('![x](https://example.invalid/x.png)\n', { file: 't.md' });
  const { removed } = renderDocumentSafeHtml(document);
  const image = removed.find((removal) => removal.what === 'attribute' && removal.name === 'src' && removal.on === 'img');
  assert.ok(image !== undefined);
  assert.equal(image.src, undefined);
  assert.equal(image.url, 'https://example.invalid/x.png');
});
