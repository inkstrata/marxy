// Compiles the Tauri walker with a bare rustc, as the fidelity gate does for atomic_write.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const source = fileURLToPath(new URL('../../../../apps/desktop/src-tauri/src/index/mod.rs', import.meta.url));

test('the Tauri walker compiles and its rust tests pass', { timeout: 120_000 }, () => {
  const work = mkdtempSync(join(tmpdir(), 'marxy-index-rustc-'));
  const binary = join(work, 'marxy-index-tests');
  try {
    const built = spawnSync(
      'rustc',
      ['--test', '--edition', '2021', '--crate-name', 'marxy_index', '-A', 'dead_code', '-o', binary, source],
      { encoding: 'utf8' },
    );
    assert.equal(built.status, 0, built.stderr || built.error?.message || 'rustc failed');
    const run = spawnSync(binary, [], { encoding: 'utf8' });
    assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
    assert.match(run.stdout, /test result: ok/);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
