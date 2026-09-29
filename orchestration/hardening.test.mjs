// Regression tests for a batch of small orchestration defects (MARXY-337): torn event-log line,
// PR title key, doctor fallback plan, canvas patching, dependency cycles, `state.mjs review`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { append, readEvents } from './store.mjs';
import { collect } from './readiness.mjs';
import { fallbackPlan } from './doctor.mjs';
import { resolveClaims } from './ready.mjs';
import { patchCanvasData, longestUnfinishedChain } from './canvases.mjs';
import { verbEvents } from './state.mjs';
import { timing } from './machine.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const tmp = () => mkdtempSync(join(tmpdir(), 'marxy-hard-'));

test('an append after a torn last line starts a fresh line, so neither event is lost', () => {
  const p = join(tmp(), 'events.jsonl');
  append({ type: 'story', key: 'MARXY-1', to: 'in_progress' }, { path: p });
  writeFileSync(p, '{"type":"story","key":"MARXY-2","to":"in_pro', { flag: 'a' });
  append({ type: 'story', key: 'MARXY-3', to: 'in_review', set: { pr: 5 } }, { path: p });
  const r = readEvents(p);
  assert.deepEqual(r.events.map(e => e.key), ['MARXY-1', 'MARXY-3']);
  assert.equal(r.skipped, 1);
  append({ type: 'story', key: 'MARXY-4', to: 'in_progress' }, { path: p });
  assert.equal(readFileSync(p, 'utf8').split('\n').length, 5); // no blank line added when the file ended cleanly
});

test('a pull request titled with an older key first is read as its trailing (KEY)', () => {
  const rows = collect({
    prs: [{ number: 7, title: 'revert MARXY-43 change (MARXY-250)', url: 'u', headRefName: 'x', headRefOid: 'a'.repeat(40), state: 'OPEN', mergeable: 'MERGEABLE', statusCheckRollup: [], files: [] }],
    verify: () => ({ ok: false }),
    computeOrder: () => ({ order: [], excluded: [] }),
    readResult: () => null,
    stories: [{ Key: 'MARXY-43', Paths: 'a' }, { Key: 'MARXY-250', Paths: 'b' }],
    codeownersText: '',
  });
  assert.equal(rows[0].key, 'MARXY-250');
});

test('the doctor fallback plan carries a byKey map, so resolveClaims does not crash', () => {
  const plan = fallbackPlan([{ Key: 'MARXY-1', Paths: 'a' }]);
  assert.ok(plan.byKey.has('MARXY-1'));
  const b = { stories: {}, runs: {} };
  assert.doesNotThrow(() => resolveClaims({ board: b, plan, worktrees: [{ key: 'MARXY-1', path: '/tmp/marxy-nowhere/MARXY-1', branch: 'feat/MARXY-1-x', dirty: true, ahead: 0, lastActivityMs: Date.now() }], t: timing(), nowMs: Date.now(), rowOf: () => null }));
});

test('patchCanvasData writes $-sequences in the data literally', () => {
  const f = join(tmp(), 'c.canvas.tsx');
  writeFileSync(f, 'a\nconst DATA = {\n  "x": 1\n} as unknown as Data;\nb\n');
  patchCanvasData(f, { note: "costs $& and $' and $$ and $1" });
  const text = readFileSync(f, 'utf8');
  assert.ok(text.includes(`"note": "costs $& and $' and $$ and $1"`), text);
  assert.ok(text.startsWith('a\n') && text.endsWith('b\n'));
});

test('longestUnfinishedChain terminates on a dependency cycle', () => {
  const b = { stories: { 'MARXY-1': { status: 'todo' }, 'MARXY-2': { status: 'todo' }, 'MARXY-3': { status: 'todo' } } };
  const d = { deps: { 'MARXY-1': ['MARXY-2'], 'MARXY-2': ['MARXY-1'], 'MARXY-3': ['MARXY-2'] } };
  const chain = longestUnfinishedChain(d, b);
  assert.ok(chain.length >= 2 && chain.length <= 3);
  assert.equal(new Set(chain).size, chain.length);
});

test('review with no or an invalid PR number records nothing and exits non-zero', () => {
  for (const bad of [undefined, 'abc', '0', '-3', '1.5', '12x']) {
    assert.equal(verbEvents('review', 'MARXY-1', bad === undefined ? [] : [bad], { stories: {} }), null, String(bad));
  }
  assert.equal(verbEvents('review', 'MARXY-1', ['42'], { stories: {} })[0].set.pr, 42);
  const dir = tmp();
  const r = spawnSync('node', [join(here, 'state.mjs'), 'review', 'MARXY-1'], { env: { ...process.env, MARXY_FLEET_DIR: dir }, encoding: 'utf8' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /positive integer/);
  assert.throws(() => readFileSync(join(dir, 'events.jsonl')), /ENOENT/);
});
