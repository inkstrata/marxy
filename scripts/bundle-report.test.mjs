import assert from 'node:assert/strict';
import { test } from 'node:test';
import { groupOf, summarise } from './bundle-report.mjs';

const root = new URL('..', import.meta.url).pathname;

test('F-111: a module belongs to its npm package, or to its folder under a workspace src/', () => {
  assert.equal(groupOf(`${root}node_modules/.pnpm/micromark@4.0.2/node_modules/micromark/lib/x.js`), 'micromark');
  assert.equal(groupOf(`${root}node_modules/.pnpm/@lezer+common@1.0.0/node_modules/@lezer/common/dist/index.js`), '@lezer/common');
  assert.equal(groupOf(`${root}apps/desktop/src/palette/view.ts`), 'apps/desktop/src/palette');
  assert.equal(groupOf(`${root}packages/core/src/parse/parse.ts`), 'packages/core/src/parse');
  assert.equal(groupOf(`${root}apps/desktop/src/main.ts`), 'apps/desktop/src/(top level)');
  assert.equal(groupOf('\0vite/preload-helper.js'), 'vite/preload-helper.js');
});

test('F-111: a chunk is summed by group, largest first', () => {
  const rows = summarise({
    modules: {
      [`${root}apps/desktop/src/a/x.ts`]: { renderedLength: 10 },
      [`${root}apps/desktop/src/a/y.ts`]: { renderedLength: 5 },
      [`${root}apps/desktop/src/b/z.ts`]: { renderedLength: 40 },
    },
  });
  assert.deepEqual(rows, [
    { group: 'apps/desktop/src/b', bytes: 40, modules: 1 },
    { group: 'apps/desktop/src/a', bytes: 15, modules: 2 },
  ]);
});
