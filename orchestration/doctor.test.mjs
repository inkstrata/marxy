import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { diagnose, snapshot, VERDICT } from './doctor.mjs';
import { append } from './store.mjs';

test('diagnose names ghost workers and points at doctor --fix', () => {
  const x = {
    loop: { held: true, lease: { pid: 1, started: '2026-01-01T00:00:00.000Z' } },
    cycle: { held: false, lease: null },
    planner: { held: false, gate: { run: false, why: 'not due' }, authFailure: false },
    statusAgeMinutes: 1,
    stuckCycleMinutes: 30,
    main: { branch: 'main', ahead: 0, behind: 0 },
    inflight: [{ key: 'MARXY-1', verdict: VERDICT.GHOST, why: 'worker gone; left nothing', rec: {} }],
    parked: [],
    ready: { ready: [], blockedByPaths: [], blockedByDeps: [], blockedByLanes: [] },
    todo: 1,
    holders: {},
    needsHuman: 0,
    fleetDoctor: [],
  };
  const f = diagnose(x);
  assert.ok(f.some(g => g.area === 'MARXY-1' && g.level === 'fail' && g.fix?.includes('doctor.mjs --fix')));
});

test('snapshot and diagnose run against a temporary fleet store', () => {
  process.env.MARXY_FLEET_DIR = mkdtempSync(join(tmpdir(), 'marxy-doctor-'));
  append({ type: 'imported', board: { stories: {} } });
  const x = snapshot();
  assert.ok(x.loop);
  assert.ok(Array.isArray(diagnose(x)));
});
