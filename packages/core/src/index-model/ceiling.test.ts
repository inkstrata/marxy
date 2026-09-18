// 50k ceiling: keep newest by mtime and emit a summoned notice, not a banner.

import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INDEX_LIMITS } from '../contracts/index-entry.ts';
import { applyCeiling, buildIndex } from './index.ts';

test('the ceiling is the frozen contract limit', () => {
  assert.equal(INDEX_LIMITS.entriesPerRoot, 50_000);
  const rust = readFileSync(new URL('../../../../apps/desktop/src-tauri/src/index/mod.rs', import.meta.url), 'utf8');
  assert.match(rust, /ENTRIES_PER_ROOT: usize = 50_000/);
});

test('50,001 candidates trigger the ceiling notice and drop the oldest mtime', () => {
  const candidates = Array.from({ length: INDEX_LIMITS.entriesPerRoot + 1 }, (_, i) => ({
    path: `/repo/f${i}.md`,
    relativePath: `f${i}.md`,
    mtimeMs: i,
    size: 1,
  }));
  const { kept, notice } = applyCeiling(candidates);
  assert.equal(kept.length, INDEX_LIMITS.entriesPerRoot);
  assert.deepEqual(notice, {
    kind: 'ceiling',
    limit: INDEX_LIMITS.entriesPerRoot,
    omitted: 1,
  });
  assert.equal(
    kept.some((item) => item.mtimeMs === 0),
    false,
    'the oldest file should have been dropped',
  );
  assert.ok(kept.some((item) => item.mtimeMs === INDEX_LIMITS.entriesPerRoot));
});

test('buildIndex surfaces the same notice so the palette can summon it', () => {
  const candidates = Array.from({ length: INDEX_LIMITS.entriesPerRoot + 2 }, (_, i) => ({
    path: `/repo/n${i}.md`,
    relativePath: `n${i}.md`,
    mtimeMs: 1_000 + i,
    size: 8,
  }));
  const built = buildIndex('/repo', candidates);
  assert.equal(built.entries.length, INDEX_LIMITS.entriesPerRoot);
  assert.equal(built.notice?.kind, 'ceiling');
  assert.equal(built.notice?.omitted, 2);
});
