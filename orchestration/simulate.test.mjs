// Seeded random outcome sequences through finishRun must never strand a story (MARXY-255, ADR-0034).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fold, STATES, timing, isTerminal } from './machine.mjs';
import { finishRun, claimEvents, buildSpec } from './runs.mjs';
import { OUTCOME, isMachineFault } from './outcomes.mjs';
import { models } from './lib.mjs';

const KEY = 'MARXY-999';
const M = models(undefined, ['node'], {});
const T = timing(M);
const at = n => new Date(Date.UTC(2026, 8, 27, 10, n)).toISOString();

function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const STEP_OUTCOMES = [
  OUTCOME.EXITED, OUTCOME.TIMEOUT, OUTCOME.STALLED, OUTCOME.SETUP, OUTCOME.AUTH, OUTCOME.DEAD,
];

const row = () => ({ Key: KEY, Summary: 'sim', Paths: 'a', Acceptance: 'x', Labels: 'ops' });

function obsFor(outcome, rand) {
  const logBytes = rand() < 0.45 ? 100 : 4000;
  switch (outcome) {
    case OUTCOME.EXITED:
      return { exit: { outcome, code: rand() < 0.4 ? 0 : 1 }, logBytes };
    case OUTCOME.SETUP:
      return { exit: { outcome, why: 'sim setup' }, logBytes: 0 };
    case OUTCOME.AUTH:
      return { exit: { outcome, code: 1 }, logBytes: 0 };
    case OUTCOME.DEAD:
      return { alive: false, logBytes: 0 };
    default:
      return { exit: { outcome }, logBytes: 0 };
  }
}

function append(events, newOnes) {
  const base = events.length;
  for (let i = 0; i < newOnes.length; i++) events.push({ at: at(base + i), by: 'sim', ...newOnes[i] });
  return fold(events);
}

function finishCharges(out, beforeAttempts) {
  const se = out.events.find(e => e.type === 'story' && e.key === KEY);
  if (!se || se.inc?.attempts === -1) return 0;
  if (se.to !== 'todo' && se.to !== 'escalate') return 0;
  let n = 1;
  const forced = se.set?.attempts;
  if (forced != null && forced > beforeAttempts) n += forced - beforeAttempts;
  return n;
}

function ownsExit(status) {
  const s = STATES[status];
  return Boolean(s && (s.terminal || (s.owner && s.exit)));
}

function stranded(rec, b) {
  const status = rec?.status ?? 'todo';
  if (isTerminal(status)) return false;
  if (!ownsExit(status)) return true;
  if (status !== 'in_progress') return false;
  const run = rec.run ? b.runs[rec.run] : null;
  if (run && !run.ended) return false;
  if (rec.claim && Date.parse(rec.claim.until) > Date.parse(at(5000))) return false;
  return true;
}

function dispatch(events, b, id, n) {
  const rec = b.stories[KEY] ?? { attempts: 0 };
  const spec = buildSpec({
    role: 'implement', key: KEY, row: row(), rec, m: M, t: T,
    now: new Date(at(n)),
  });
  spec.id = id;
  return append(events, claimEvents(spec));
}

function runSequence(seed) {
  const rand = mulberry32(seed);
  const steps = 3 + Math.floor(rand() * 12);
  const events = [{ type: 'imported', at: at(0), board: { stories: {}, runs: {}, planner: {}, merges: 0, mergesAtLastPlan: 0, lastPlan: null } }];
  let b = dispatch(events, fold(events), 'r0', 1);
  let nonRefunded = 0;
  let runN = 0;

  for (let step = 0; step < steps; step++) {
    const rec = b.stories[KEY];
    if (!rec?.run || b.runs[rec.run]?.ended) {
      if (rec?.status === 'todo') {
        runN += 1;
        b = dispatch(events, b, `r${runN}`, 10 + step * 3);
      } else break;
    }
    const id = b.stories[KEY]?.run;
    const run = b.runs[id];
    if (!run || run.ended) break;

    const beforeAttempts = b.stories[KEY]?.attempts ?? 0;
    const outcome = STEP_OUTCOMES[Math.floor(rand() * STEP_OUTCOMES.length)];
    const obs = obsFor(outcome, rand);
    const evidence = { ahead: rand() < 0.2 ? 1 : 0, dirty: rand() < 0.1 };

    const out = finishRun({
      id, run, obs, rec: b.stories[KEY], result: null, prOpen: null, evidence,
      logTail: '', t: T, now: at(20 + step * 3),
    });
    nonRefunded += finishCharges(out, beforeAttempts);
    b = append(events, out.events);

    const after = b.stories[KEY] ?? { status: 'todo', attempts: 0 };
    assert.ok(!stranded(after, b), `seq ${seed} step ${step} ${outcome}: ${after.status} run=${after.run ?? 'none'}`);
    assert.ok(ownsExit(after.status ?? 'todo'), `seq ${seed} step ${step}: ${after.status} has no owner/exit`);

    const open = after.status === 'in_progress' && after.run && !b.runs[after.run]?.ended ? 1 : 0;
    assert.ok((after.attempts ?? 0) <= nonRefunded + open, `seq ${seed} step ${step}: attempts ${after.attempts} > failures ${nonRefunded}+${open}`);

    if (isMachineFault(outcome)) {
      assert.notEqual(after.status, 'in_progress', `seq ${seed}: machine fault ${outcome} left in_progress`);
      assert.ok(['todo', 'blocked', 'in_review', 'done', 'escalate'].includes(after.status), `seq ${seed}: fault ${outcome} → ${after.status}`);
    }
  }
}

test('10,000 seeded outcome sequences never strand a story or over-count attempts', { timeout: 120_000 }, () => {
  for (let seed = 1; seed <= 10_000; seed++) runSequence(seed);
});
