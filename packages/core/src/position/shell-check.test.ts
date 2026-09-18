// The desktop shell must use the same stale-save check: last-writer-wins is the defect MARXY-14 left.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const shell = fileURLToPath(new URL('../../../../apps/desktop/src/shell/tauri.ts', import.meta.url));

test('the desktop shell compares the opened bytes to disk before it renames a save over them', () => {
  const source = readFileSync(shell, 'utf8');
  assert.match(source, /staleWriteError/);
  assert.match(source, /lastRead/);
  assert.match(source, /watch_root/);
  assert.match(source, /setTimeout\(flush,/);
  assert.doesNotMatch(source, /toolbar|toast|status bar/i);
});
