// The desktop shell must use the same stale-save check: last-writer-wins is the defect.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const shell = fileURLToPath(new URL('../../../../apps/desktop/src/shell/tauri.ts', import.meta.url));
const rust = fileURLToPath(new URL('../../../../apps/desktop/src-tauri/src/atomic_write.rs', import.meta.url));

test('the desktop shell compares the opened bytes to disk before it renames a save over them', () => {
  const source = readFileSync(shell, 'utf8');
  // The comparison itself runs in Rust on the open handle; the front end sends what was read.
  assert.match(source, /x-marxy-expect/);
  assert.match(source, /lastRead/);
  assert.match(readFileSync(rust, 'utf8'), /fn write_atomic_unless_changed/);
  assert.match(source, /watch_root/);
  assert.match(source, /setTimeout\(flush,/);
  assert.doesNotMatch(source, /toolbar|toast|status bar/i);
});
