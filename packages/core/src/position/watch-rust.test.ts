// The Rust watcher is the privileged implementation (ADR-0010). These cases compile that
// exact file with rustc --test so a copy cannot drift past a red run.

import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const watchSource = join(repoRoot, 'apps', 'desktop', 'src-tauri', 'src', 'watch', 'mod.rs');

test('the shipped Rust watcher covers in-place, atomic rename, delete and move', () => {
  const source = readFileSync(watchSource, 'utf8');
  for (const name of [
    'in_place_write_while_open_reloads',
    'write_temp_then_rename_while_open_reloads',
    'delete_while_open_is_gone',
    'move_while_open_follows',
  ]) {
    assert.ok(source.includes(`fn ${name}`), `Rust watcher lost the ${name} case`);
  }

  const dir = mkdtempSync(join(tmpdir(), 'marxy-34-rustc-'));
  try {
    const crate = join(dir, 'watch.rs');
    writeFileSync(crate, source);
    const binary = join(dir, 'watch-tests');
    const built = spawnSync('rustc', ['--edition', '2021', '--test', '-o', binary, crate], {
      encoding: 'utf8',
    });
    assert.equal(built.status, 0, `rustc --test failed: ${built.stderr}`);
    const run = spawnSync(binary, [], { encoding: 'utf8' });
    assert.equal(run.status, 0, `Rust watcher tests failed:\n${run.stdout}\n${run.stderr}`);
    assert.match(run.stdout, /test result: ok/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
