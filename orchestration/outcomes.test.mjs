// Run outcomes are defined once in outcomes.mjs (MARXY-255).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  OUTCOME, GHOST_BYTES, RUN_OUTCOMES, inferOutcome, neverRan, isMachineFault, isAuthOutcome, producedWork,
} from './outcomes.mjs';

const root = join(import.meta.dirname, '..');
const read = rel => readFileSync(join(root, rel), 'utf8');

test('every run outcome string is listed exactly once', () => {
  assert.deepEqual([...RUN_OUTCOMES].sort(), [...Object.values(OUTCOME)].sort());
  assert.equal(new Set(RUN_OUTCOMES).size, RUN_OUTCOMES.length);
});

test('inferOutcome matches observeRuns shapes', () => {
  assert.equal(inferOutcome({ exit: { outcome: OUTCOME.EXITED } }), OUTCOME.EXITED);
  assert.equal(inferOutcome({ alive: true }), OUTCOME.TIMEOUT);
  assert.equal(inferOutcome({ alive: false }), OUTCOME.DEAD);
});

test('neverRan and isMachineFault partition the refund and dispatch cases', () => {
  assert.ok(neverRan(OUTCOME.SETUP));
  assert.ok(neverRan(OUTCOME.AUTH));
  assert.ok(neverRan(OUTCOME.DEAD));
  assert.ok(!neverRan(OUTCOME.EXITED));
  for (const o of [OUTCOME.AUTH, OUTCOME.SETUP, OUTCOME.NOT_STARTED]) assert.ok(isMachineFault(o));
  assert.ok(!isMachineFault(OUTCOME.TIMEOUT));
  assert.ok(isAuthOutcome(OUTCOME.AUTH));
});

test('producedWork uses the shared ghost threshold', () => {
  assert.equal(producedWork({}, GHOST_BYTES), false);
  assert.equal(producedWork({}, GHOST_BYTES + 1), true);
  assert.equal(producedWork({ ahead: 1 }, 0), true);
});

const GREP_MODULES = [
  'orchestration/worker.mjs',
  'orchestration/cycle.mjs',
  'orchestration/runs.mjs',
  'orchestration/doctor.mjs',
  'orchestration/fleet.mjs',
];

test('no module outside outcomes.mjs assigns or classifies run outcome literals', () => {
  const names = RUN_OUTCOMES.map(o => o.replace(/-/g, '\\-')).join('|');
  const assign = new RegExp(String.raw`\boutcome\s*:\s*['"](?:${names})['"]`, 'g');
  const classify = new RegExp(String.raw`\boutcome\s*===?\s*['"](?:${names})['"]`, 'g');
  const last = new RegExp(String.raw`\blastOutcome\s*===?\s*['"](?:${names})['"]`, 'g');
  const infer = new RegExp(String.raw`\?\?\s*['"](?:timeout|dead)['"]`, 'g');
  const bad = [];
  for (const rel of GREP_MODULES) {
    const text = read(rel);
    for (const re of [assign, classify, last, infer]) {
      re.lastIndex = 0;
      for (const m of text.matchAll(re)) {
        const line = text.slice(0, m.index).split('\n').length;
        bad.push(`${rel}:${line}: ${m[0]}`);
      }
    }
  }
  assert.deepEqual(bad, [], 'move outcome strings and classification to outcomes.mjs');
});
