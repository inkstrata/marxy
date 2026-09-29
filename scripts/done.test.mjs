// MARXY-312: a failed `pnpm done` re-run must not leave a stale done / all-ok gates record on disk.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildResultRecord, gatesFromOutput } from './done.mjs';

const STALE_DONE = {
  key: 'MARXY-312',
  status: 'done',
  branch: 'feat/MARXY-312-slug',
  gates: { 'story boundary (whole branch)': 'ok', precheck: 'ok' },
  acceptance: [{ criterion: 'old', checkedBy: 'scripts/done.test.mjs' }],
  outsidePaths: [],
  needsAdr: false,
  queueEntry: false,
  notes: '',
  pr: 99,
};

const FAILED_GATES_TEXT = '✓ story boundary (whole branch)\n✗ precheck';

test('gatesFromOutput maps check lines to ok or failed', () => {
  assert.deepEqual(gatesFromOutput(FAILED_GATES_TEXT), {
    'story boundary (whole branch)': 'ok',
    precheck: 'failed',
  });
});

test('a failed re-run after status done refreshes status and gates, not only acceptance', () => {
  const acceptance = [{ criterion: 'new row', checkedBy: 'scripts/done.test.mjs' }];
  const result = buildResultRecord({
    key: 'MARXY-312',
    ok: false,
    branch: 'feat/MARXY-312-slug',
    gatesText: FAILED_GATES_TEXT,
    acceptance,
    existing: STALE_DONE,
  });
  assert.equal(result.status, 'failed');
  assert.equal(result.gates.precheck, 'failed');
  assert.deepEqual(result.acceptance, acceptance);
  assert.equal(result.pr, 99, 'other fields from the prior record stay');
  assert.notEqual(result.status, 'done');
  assert.ok(Object.values(result.gates).some(v => v === 'failed'), 'gates must reflect this run');
});

test('a successful re-run still only refreshes acceptance when a result already exists', () => {
  const existing = { ...STALE_DONE, status: 'done' };
  const acceptance = [{ criterion: 'filled', checkedBy: 'scripts/done.test.mjs' }];
  const result = buildResultRecord({
    key: 'MARXY-312',
    ok: true,
    branch: 'feat/MARXY-312-other',
    gatesText: '✓ story boundary (whole branch)\n✓ precheck',
    acceptance,
    existing,
  });
  assert.equal(result.status, 'done');
  assert.deepEqual(result.gates, existing.gates);
  assert.deepEqual(result.acceptance, acceptance);
});

test('MARXY-337: a green re-run after a failed one becomes done with fresh gates and branch', () => {
  const failed = { ...STALE_DONE, status: 'failed', branch: 'feat/old', gates: { precheck: 'failed' } };
  const result = buildResultRecord({
    key: 'MARXY-312',
    ok: true,
    branch: 'feat/MARXY-312-slug',
    gatesText: '✓ story boundary (whole branch)\n✓ precheck',
    acceptance: [],
    existing: failed,
  });
  assert.equal(result.status, 'done');
  assert.equal(result.branch, 'feat/MARXY-312-slug');
  assert.deepEqual(result.gates, { 'story boundary (whole branch)': 'ok', precheck: 'ok' });
});

test('MARXY-337: a first run that leaves an acceptance row TODO is not written as done', () => {
  const result = buildResultRecord({
    key: 'MARXY-312', ok: true, branch: 'b', gatesText: '✓ precheck', acceptance: [{ criterion: 'c', checkedBy: 'TODO' }], existing: null, todo: true,
  });
  assert.equal(result.status, 'failed');
  const rerun = buildResultRecord({
    key: 'MARXY-312', ok: true, branch: 'b', gatesText: '✓ precheck', acceptance: [], existing: { ...STALE_DONE, status: 'failed' }, todo: false,
  });
  assert.equal(rerun.status, 'done');
});
