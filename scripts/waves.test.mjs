// waves.mjs rewrites only the State and PR cells of waves.md, by story id, and --check fails when stale (X-20).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseProgress, effective, updateWaves, redundantOverrides, PLAN_DIR } from './waves.mjs';

const LEDGER = [
  '| Id | Title | Model | State | PR | Worktree | Notes |',
  '| --- | --- | --- | --- | --- | --- | --- |',
  '| W-02 | shell | opus | merged | [#561](https://github.com/inkstrata/marxy/pull/561) | — | notes with a | pipe |',
  '| W-09 | inspector | sonnet | ready | — | — | |',
  '| K-05a | kind | sonnet | merged | [#573](https://github.com/inkstrata/marxy/pull/573) | — | |',
].join('\n');

const WAVES = [
  'Prose that mentions [W-02](x.md) and a pipe | outside a table stays.',
  '',
  '| Feature | How to reach it | Story | State | PR |',
  '| --- | --- | --- | --- | --- |',
  '| Unfold the window | `⌘\\` | [W-02](cards.md#w-02) | ready | — |',
  '| The inspector | unfolded | [W-09](cards.md#w-09) | ready | — |',
  '',
  '| Fix | Story | State | PR |',
  '| --- | --- | --- | --- |',
  '| The kind at open | [K-05a](cards.md#k-05a) | running | — |',
].join('\n');

test('parseProgress reads id, state and PR number, and ignores prose rows', () => {
  const p = parseProgress(`# Ledger\n\n${LEDGER}\n\nprose | not a row\n`);
  assert.deepEqual([...p.keys()], ['W-02', 'W-09', 'K-05a']);
  assert.deepEqual(p.get('W-02'), { state: 'merged', pr: '561' });
  assert.deepEqual(p.get('W-09'), { state: 'ready', pr: null });
});

test('updateWaves sets State and PR by id in tables with different column orders, and nothing else', () => {
  const { text, unknown } = updateWaves(WAVES, parseProgress(LEDGER));
  assert.deepEqual(unknown, []);
  const lines = text.split('\n');
  assert.equal(lines[4], '| Unfold the window | `⌘\\` | [W-02](cards.md#w-02) | merged | [#561](https://github.com/inkstrata/marxy/pull/561) |');
  assert.equal(lines[5], '| The inspector | unfolded | [W-09](cards.md#w-09) | ready | — |');
  assert.equal(lines[9], '| The kind at open | [K-05a](cards.md#k-05a) | merged | [#573](https://github.com/inkstrata/marxy/pull/573) |');
  for (const i of [0, 1, 2, 3, 6, 7, 8]) assert.equal(lines[i], WAVES.split('\n')[i]);
});

test('updateWaves is idempotent', () => {
  const once = updateWaves(WAVES, parseProgress(LEDGER)).text;
  assert.equal(updateWaves(once, parseProgress(LEDGER)).text, once);
});

test('an id the ledger lacks is reported and its row is left alone', () => {
  const { text, unknown } = updateWaves(WAVES, new Map());
  assert.deepEqual(unknown, ['W-02', 'W-09', 'K-05a']);
  assert.equal(text, WAVES);
});

test('an override wins only while it is further along than the ledger', () => {
  const p = parseProgress(LEDGER);
  const ov = { 'W-09': { state: 'in review', pr: 607 }, 'W-02': { state: 'ready' }, 'F-40': { state: 'merged', pr: 605 } };
  assert.deepEqual(effective('W-09', p, ov), { state: 'in review', pr: '607' });
  assert.deepEqual(effective('W-02', p, ov), { state: 'merged', pr: '561' });
  assert.deepEqual(effective('F-40', p, ov), { state: 'merged', pr: '605' });
  assert.equal(effective('Z-99', p, ov), null);
  assert.deepEqual(redundantOverrides(p, ov), ['W-02']);
});

test('the CLI writes the file, and --check exits 1 only while it is stale', () => {
  const root = mkdtempSync(join(tmpdir(), 'waves-'));
  try {
    mkdirSync(join(root, PLAN_DIR), { recursive: true });
    writeFileSync(join(root, PLAN_DIR, 'progress.md'), LEDGER);
    writeFileSync(join(root, PLAN_DIR, 'waves.md'), WAVES);
    const script = fileURLToPath(new URL('./waves.mjs', import.meta.url));
    const run = (...args) => spawnSync(process.execPath, [script, ...args, '--root', root], { encoding: 'utf8' });
    assert.equal(run('--check').status, 1);
    assert.equal(readFileSync(join(root, PLAN_DIR, 'waves.md'), 'utf8'), WAVES, '--check writes nothing');
    assert.equal(run().status, 0);
    assert.equal(run('--check').status, 0);
    writeFileSync(join(root, PLAN_DIR, 'progress.md'), LEDGER.replace('| ready |', '| in review |'));
    assert.equal(run('--check').status, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
