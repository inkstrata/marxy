// Index build of a 20k-file tree stays under 2 s. Creation time is not part of the budget.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex, collectFiles } from './index.ts';
import { nodeReader } from './node-reader.test.ts';

const TREE = 20_000;
const BUDGET_MS = 2_000;

test('a 20,000-file tree indexes in under two seconds and skips node_modules', { timeout: 120_000 }, () => {
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
    assert.ok(elapsed < BUDGET_MS, `indexed ${TREE} files in ${elapsed.toFixed(1)} ms; budget ${BUDGET_MS} ms`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
