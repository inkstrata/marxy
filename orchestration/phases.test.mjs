// The ops lane and the phase rules the committed board must keep (MARXY-107).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { stories, deps, phaseOf, earlierPhaseOpen, ROOT } from './lib.mjs';
import { selectReady } from './ready.mjs';
import { plannerReasons } from './planner-trigger.mjs';
import { LIMIT, isPlanSurface, budgetedInsertions, forbiddenNames } from './branch-diff.mjs';

const story = (Key, Paths, Labels = '') => ({ Key, Type: 'Story', Summary: Key, Paths, Labels, Acceptance: 'a check' });
const board = statuses => ({ stories: Object.fromEntries(Object.entries(statuses).map(([k, status]) => [k, { status, attempts: 0 }])) });

test('a story in a non-numeric phase is never phase-blocked and never holds a numbered phase', () => {
  const d = { phases: { 0: ['A'], 1: ['B'], ops: ['C'] }, deps: {} };
  const all = [story('A', 'a'), story('B', 'b'), story('C', 'c')];
  assert.equal(earlierPhaseOpen(phaseOf('C', d), d, board({ A: 'todo', C: 'todo' })), false);
  const open = selectReady({ all, d, s: board({ A: 'todo', B: 'todo', C: 'todo' }), cap: Infinity });
  assert.deepEqual(open.ready.map(r => r.key).sort(), ['A', 'C'], 'phase 0 open: B waits, the ops story does not');
  const closed = selectReady({ all, d, s: board({ A: 'done', B: 'todo', C: 'todo' }), cap: Infinity });
  assert.deepEqual(closed.ready.map(r => r.key).sort(), ['B', 'C'], 'an open ops story does not hold phase 1');
});

const d = deps();
const csv = stories().filter(s => s.Type === 'Story');

test('the committed board: every CSV story is in exactly one phase', () => {
  const seen = {};
  for (const [p, keys] of Object.entries(d.phases)) for (const k of keys) (seen[k] ??= []).push(p);
  assert.deepEqual(csv.filter(s => !seen[s.Key]).map(s => s.Key), [], 'stories with no phase');
  assert.deepEqual(
    csv.filter(s => (seen[s.Key] ?? []).length > 1).map(s => [s.Key, seen[s.Key]]),
    [],
    'stories in more than one phase',
  );
});

test('the committed board: no story depends on a story in a later numbered phase', () => {
  const bad = [];
  for (const [k, ds] of Object.entries(d.deps)) {
    for (const x of ds) {
      const [a, b] = [phaseOf(k, d), phaseOf(x, d)];
      if (Number.isFinite(a) && Number.isFinite(b) && b > a) bad.push(`${k} (phase ${a}) → ${x} (phase ${b})`);
    }
  }
  assert.deepEqual(bad, [], 'a later-phase dependency can never be satisfied: the phase rule holds it until the earlier phase closes');
});

test('Phase 1 opens while ops work is still todo; a phase story takes a contested path', () => {
  const landed = new Set([
    ...(d.phases[0] ?? []),
    'MARXY-19', 'MARXY-29', 'MARXY-34', 'MARXY-35',
    'MARXY-64', 'MARXY-67', 'MARXY-68', 'MARXY-72', 'MARXY-73',
  ]);
  const statuses = Object.fromEntries([
    ...[...(d.phases[0] ?? []), ...csv.map(s => s.Key)].map(k => [k, landed.has(k) ? 'done' : 'todo']),
  ]);
  const r = selectReady({ all: csv, d, s: board(statuses), cap: Infinity });
  assert.ok(r.ready.some(x => x.key === 'MARXY-75'), 'MARXY-75 is offered while ops stories are still todo');
  assert.ok(r.blockedByDeps.includes('MARXY-20'), 'MARXY-20 waits on MARXY-75, by dependency and not by phase');
  const after = selectReady({ all: csv, d, s: board({ ...statuses, 'MARXY-75': 'done' }), cap: Infinity });
  assert.ok(after.ready.some(x => x.key === 'MARXY-20'), 'MARXY-20 is offered once MARXY-75 is done');
  const opsTheme = (d.phases.ops ?? []).filter(k => {
    const st = csv.find(s => s.Key === k);
    return st && /packages\/theme/.test(st.Paths);
  });
  const themeReady = after.ready.some(x => opsTheme.includes(x.key));
  assert.ok(
    after.blockedByPaths.includes('MARXY-8') || !themeReady,
    'after.blockedByPaths contains MARXY-8, or no ops key sharing packages/theme is in after.ready',
  );
});

test('the planner is not kept due by a dropped story', () => {
  const m = { plannerEveryMerges: 5, plannerEveryDays: 7 };
  const s = {
    lastPlan: new Date(0).toISOString(),
    merges: 0,
    mergesAtLastPlan: 0,
    stories: { X: { status: 'blocked' }, Z: { status: 'escalate' } },
  };
  const all = [story('X', 'x', 'ops,dropped'), story('Z', 'z')];
  const reasons = plannerReasons({ s, m, all, now: 1000 });
  assert.deepEqual(reasons, ['escalated/blocked: Z']);
});

test('orchestration/state.json is untracked and gitignored', () => {
  const tracked = spawnSync('git', ['ls-files', '--', 'orchestration/state.json'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(tracked.status, 0);
  assert.equal(tracked.stdout.trim(), '', 'state.json must not be tracked');
  const ignored = spawnSync('git', ['check-ignore', '-q', 'orchestration/state.json'], { cwd: ROOT });
  assert.equal(ignored.status, 0, 'state.json must be gitignored');
});

test('scope cuts light first and the plan names dark as primary', () => {
  const scope = readFileSync(`${ROOT}docs/scope.md`, 'utf8');
  const plan = readFileSync(`${ROOT}docs/plan.md`, 'utf8');
  const slip = scope.split('## If the schedule still slips')[1] ?? '';
  assert.match(slip, /Light variant \(ship dark/);
  assert.doesNotMatch(slip.split('\n')[0] + (slip.match(/1\..*/) ?? [''])[0], /^1\. Dark variant/);
  assert.match(plan, /dark primary \(ADR-0024\)/);
});

// Shallow CI checkouts often have no origin/main; git diff then exits 128 and held
// every non-docs PR (MARXY-114, same class as MARXY-108).
function resolveThreeDotBase(opts, git = execFileSync) {
  for (const ref of ['origin/main', 'main']) {
    try {
      git('git', ['rev-parse', '--verify', ref], {
        cwd: opts.cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      return ref;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

function parseNumstat(stdout) {
  return stdout.split('\n').filter(Boolean).map(line => {
    const [added, , file] = line.split('\t');
    return { added, file };
  });
}

function assertBudgeted(rows) {
  const added = budgetedInsertions(rows);
  assert.ok(added < LIMIT, `diff is +${added}, want under ${LIMIT}`);
  return added;
}

function runBranchDiffGuard({ resolveBase, skip }) {
  const base = resolveBase();
  if (!base) {
    skip('neither origin/main nor main is a resolvable git ref');
    return 'skipped';
  }
  const range = `${base}...HEAD`;
  const numstat = spawnSync('git', ['diff', '--numstat', range], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(numstat.status, 0);
  assertBudgeted(parseNumstat(numstat.stdout));
  const names = spawnSync('git', ['diff', '--name-only', range], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(names.status, 0);
  // 2026-09-18 plan deltas stayed discarded with MARXY-107. ADR-0015 and
  // taste-review #0 were on that same forbid list until MARXY-127 landed them.
  assert.deepEqual(forbiddenNames(names.stdout.split('\n').filter(Boolean)), []);
  return 'asserted';
}

test('the branch diff stays under 600 lines and omits the discarded extras', t => {
  runBranchDiffGuard({
    resolveBase: () => resolveThreeDotBase({ cwd: ROOT }),
    skip: reason => t.skip(reason),
  });
});

test('resolveThreeDotBase returns null when neither origin/main nor main verifies', () => {
  const calls = [];
  const git = (_cmd, args) => {
    calls.push(args);
    const err = new Error('fatal: Needed a single revision');
    err.status = 128;
    throw err;
  };
  assert.equal(resolveThreeDotBase({ cwd: '/tmp' }, git), null);
  assert.deepEqual(calls, [
    ['rev-parse', '--verify', 'origin/main'],
    ['rev-parse', '--verify', 'main'],
  ]);
});

test('resolveThreeDotBase prefers origin/main, then main', () => {
  const originFirst = (_cmd, args) => {
    if (args.includes('origin/main')) return 'abc\n';
    throw new Error('must not fall through when origin/main verifies');
  };
  assert.equal(resolveThreeDotBase({ cwd: '/tmp' }, originFirst), 'origin/main');

  const mainOnly = (_cmd, args) => {
    if (args.includes('origin/main')) throw new Error('missing');
    if (args.includes('main')) return 'def\n';
    throw new Error('unexpected ref');
  };
  assert.equal(resolveThreeDotBase({ cwd: '/tmp' }, mainOnly), 'main');
});

test('the branch diff guard skips when no base ref resolves', () => {
  let skipped;
  const outcome = runBranchDiffGuard({
    resolveBase: () => null,
    skip: reason => {
      skipped = reason;
    },
  });
  assert.equal(outcome, 'skipped');
  assert.match(skipped, /resolvable git ref/);
});

const PLAN_SURFACE_900 = [
  { added: 150, file: 'docs/plan/jira-issues.csv' },
  { added: 150, file: 'docs/plan/deltas/x.md' },
  { added: 150, file: 'docs/plan/tasks/K.md' },
  { added: 150, file: 'orchestration/deps.json' },
  { added: 150, file: 'orchestration/jira-map.json' },
  { added: 150, file: 'CHANGELOG.md' },
];

test('LIMIT is 600, isPlanSurface matches only the plan surface, and a binary row is 0', () => {
  assert.equal(LIMIT, 600);
  for (const f of [
    'docs/plan/jira-issues.csv',
    'docs/plan/deltas/x.md',
    'docs/plan/tasks/K.md',
    'orchestration/deps.json',
    'orchestration/jira-map.json',
    'orchestration/results/MARXY-142.json',
    'CHANGELOG.md',
  ]) {
    assert.equal(isPlanSurface(f), true, f);
  }
  for (const f of [
    'packages/core/src/render/images.ts',
    'apps/desktop/src/app.ts',
    'orchestration/cycle.mjs',
    'docs/hygiene.md',
    'docs/plan.md',
  ]) {
    assert.equal(isPlanSurface(f), false, f);
  }
  assert.equal(budgetedInsertions([{ added: '-', file: 'packages/core/src/x.bin' }]), 0);
});

test('branch-diff.mjs never shells out to git', () => {
  const src = readFileSync(new URL('./branch-diff.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /child_process|execFileSync|spawnSync|execSync|execFile\(/);
});

test('900 plan-surface insertions are not budgeted and the guard passes', () => {
  assert.equal(budgetedInsertions(PLAN_SURFACE_900), 0);
  assertBudgeted(PLAN_SURFACE_900);
});

test('plan-surface rows plus 601 in images.ts fail naming the counted total', () => {
  const rows = [...PLAN_SURFACE_900, { added: 601, file: 'packages/core/src/render/images.ts' }];
  assert.equal(budgetedInsertions(rows), 601);
  assert.throws(() => assertBudgeted(rows), /601/);
});

test('plan-surface rows plus 599 in images.ts pass', () => {
  const rows = [...PLAN_SURFACE_900, { added: 599, file: 'packages/core/src/render/images.ts' }];
  assert.equal(budgetedInsertions(rows), 599);
  assertBudgeted(rows);
});

test('601 insertions in apps/desktop/src/app.ts alone fail', () => {
  const rows = [{ added: 601, file: 'apps/desktop/src/app.ts' }];
  assert.equal(budgetedInsertions(rows), 601);
  assert.throws(() => assertBudgeted(rows), /601/);
});

test('601 insertions in orchestration/cycle.mjs alone fail', () => {
  const rows = [{ added: 601, file: 'orchestration/cycle.mjs' }];
  assert.equal(budgetedInsertions(rows), 601);
  assert.throws(() => assertBudgeted(rows), /601/);
});

test('forbiddenNames returns only the discarded 2026-09-18 delta', () => {
  assert.deepEqual(
    forbiddenNames([
      'docs/plan/deltas/2026-09-18-perf-budget.md',
      'docs/plan/deltas/2026-09-19-after-8.md',
    ]),
    ['docs/plan/deltas/2026-09-18-perf-budget.md'],
  );
});

test('a plan-surface-only change that re-adds a 2026-09-18 delta still fails', () => {
  const names = [
    ...PLAN_SURFACE_900.map(r => r.file),
    'docs/plan/deltas/2026-09-18-perf-budget.md',
  ];
  assert.equal(budgetedInsertions(PLAN_SURFACE_900), 0);
  assert.deepEqual(forbiddenNames(names), ['docs/plan/deltas/2026-09-18-perf-budget.md']);
  assert.throws(() => assert.deepEqual(forbiddenNames(names), []));
});

test('the live guard still uses the module, numstat, and every test from before the rewrite', () => {
  const src = readFileSync(new URL('./phases.test.mjs', import.meta.url), 'utf8');
  assert.match(src, /\['diff', '--numstat', range\]/);
  assert.match(src, /budgetedInsertions\(/);
  assert.match(src, /forbiddenNames\(/);
  for (const title of [
    'a story in a non-numeric phase is never phase-blocked and never holds a numbered phase',
    'the committed board: every CSV story is in exactly one phase',
    'the committed board: no story depends on a story in a later numbered phase',
    'Phase 1 opens while ops work is still todo; a phase story takes a contested path',
    'the planner is not kept due by a dropped story',
    'orchestration/state.json is untracked and gitignored',
    'scope cuts light first and the plan names dark as primary',
    'the branch diff stays under 600 lines and omits the discarded extras',
    'resolveThreeDotBase returns null when neither origin/main nor main verifies',
    'resolveThreeDotBase prefers origin/main, then main',
    'the branch diff guard skips when no base ref resolves',
  ]) {
    assert.ok(src.includes(`test('${title}'`), `missing test: ${title}`);
  }
});
