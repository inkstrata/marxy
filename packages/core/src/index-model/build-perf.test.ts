// A 20k-file tree indexes correctly: every file found, node_modules skipped, no notice. How long
// that took is printed, not asserted (MARXY-153): the old `elapsed < 2_000` was a wall-clock
// ceiling on a shared runner, which fails for a busy machine exactly as it fails for a regression,
// and ADR-0032 already settled that no speed number fails the build.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex, collectFiles } from './index.ts';
import { nodeReader } from './node-reader.test.ts';

const TREE = 20_000;

test('a 20,000-file tree indexes every file and skips node_modules', { timeout: 120_000 }, () => {
  const root = mkdtempSync(join(tmpdir(), 'marxy-index-20k-'));
  try {
    const dirs = 200;
    const perDir = TREE / dirs;
    for (let d = 0; d < dirs; d++) {
      const dir = join(root, `d${d}`);
      mkdirSync(dir);
      for (let f = 0; f < perDir; f++) writeFileSync(join(dir, `f${f}.md`), '');
    }
    mkdirSync(join(root, 'node_modules', 'pkg'), { recursive: true });
    writeFileSync(join(root, 'node_modules', 'pkg', 'secret.md'), '# no\n');

    const started = performance.now();
    const candidates = collectFiles(root, nodeReader());
    const built = buildIndex(root, candidates);
    const elapsed = performance.now() - started;

    assert.equal(built.entries.length, TREE);
    assert.equal(
      built.entries.some((entry) => entry.path.includes('node_modules')),
      false,
    );
    assert.equal(built.notice, undefined);
    console.log(`index: ${TREE} files in ${elapsed.toFixed(1)} ms`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
