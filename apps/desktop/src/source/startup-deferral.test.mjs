// CM6 must not appear on the production startup import graph (MARXY-33 / MARXY-37).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../../../../', import.meta.url);
const main = readFileSync(new URL('apps/desktop/src/main.ts', root), 'utf8');
const app = readFileSync(new URL('apps/desktop/src/app.ts', root), 'utf8');

test('main.ts does not statically import Source mode or CodeMirror', () => {
  assert.doesNotMatch(main, /@codemirror|src\/source/);
});

test('app.ts does not statically import CodeMirror', () => {
  assert.doesNotMatch(app, /@codemirror/);
});
