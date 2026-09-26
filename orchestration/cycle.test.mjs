// The reconcile cycle, end to end, against a fake world (ADR-0034). Each test is one of the ways the
// old loop got stuck, and shows the state now has a way out that fires on its own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { reconcile, reviewStep, holdClass, primaryHold } from './cycle.mjs';
import { fold, timing } from './machine.mjs';
import { snapshotFrom } from './github.mjs';
import { models } from './lib.mjs';

process.env.MARXY_FLEET_DIR ??= mkdtempSync(join(tmpdir(), 'marxy-fleet-cycle-'));
const M = { ...models(undefined, ['node'], {}), compute: 'default', mergeQueue: false };
const T = timing(M);
const NOW = '2026-09-26T12:00:00.000Z';
const nowMs = Date.parse(NOW);
const HEAD = 'a'.repeat(40);
const minutesAgo = n => new Date(nowMs - n * 60_000).toISOString();

const row = (Key, Paths, extra = {}) => ({ Key, Type: 'Story', Summary: `${Key} summary`, Paths, Acceptance: 'a check', Labels: 'ops', ...extra });
const pr = (number, key, extra = {}) => ({
  number, title: `feat(x): thing (${key})`, headRefName: `feat/${key}-thing`, headRefOid: HEAD, isDraft: false, state: 'OPEN',
  mergeStateStatus: 'CLEAN', mergeable: 'MERGEABLE', statusCheckRollup: [{ name: 'ci', conclusion: 'SUCCESS' }],
  files: [{ path: 'x' }], createdAt: minutesAgo(600), reviewDecision: '', latestReviews: [], autoMergeRequest: null, ...extra,
});
const approved = { ok: true, head: HEAD };

/** A world the cycle can run against: an in-memory event log, a snapshot, and a record of every effect. */
function world({ stories = {}, rows = [], open = [], recent = [], worktrees = [], runObs = {}, facts = {}, results = {}, hasCli = true, m = M, lastPlan = minutesAgo(60), extraEvents = [] } = {}) {
  const events = [{ type: 'imported', at: minutesAgo(600), by: 'test', board: { stories, merges: 0, mergesAtLastPlan: 0, lastPlan } }, ...extraEvents];
  const calls = { gh: [], spawn: [], stop: [], notes: [], jira: [], exit: [], specs: [] };
  const plan = { rows, byKey: new Map(rows.map(r => [r.Key, r])), deps: { deps: {}, phases: { ops: rows.map(r => r.Key) } }, extraAllowed: ['CHANGELOG.md'], renames: {} };
  const io = {
    bin: 'cursor-agent',
    now: () => new Date(NOW),
    fetch: () => null,
    plan: () => plan,
    board: () => fold(events, { renames: {} }),
    snapshot: () => snapshotFrom(open, recent),
    runs: b => Object.fromEntries(Object.entries(b.runs).filter(([, r]) => !r.ended).map(([id]) => [id, runObs[id] ?? { alive: true, logBytes: 10 }])),
    worktrees: () => worktrees,
    hasCli: () => hasCli,
    result: key => results[key] ?? null,
    logTail: () => '',
    prFacts: key => ({
      row: plan.byKey.get(key) ?? null, files: ['CHANGELOG.md', 'x'], outside: [], attribution: false,
      approval: { ok: false, why: 'not reviewed (no results/KEY.approved)' }, codeowners: '', result: { status: 'done' },
      ...(facts[key] ?? {}),
    }),
    prFiles: () => [],
    prState: () => 'MERGED',
    gh: args => { calls.gh.push(args); return { ok: true, out: '', err: '' }; },
    commit: evs => { const w = evs.filter(Boolean).map(e => ({ at: NOW, by: 'test', ...e })); events.push(...w); return w; },
    writeSpec: spec => calls.specs.push(spec),
    writeExit: (id, r) => calls.exit.push([id, r]),
    spawnWorker: id => { calls.spawn.push(id); return 4242; },
    stopRun: id => calls.stop.push(id),
    writeNotes: (k, text) => calls.notes.push([k, text]),
    jira: args => { calls.jira.push(args); return { ok: true }; },
    report: r => r,
  };
  const b = () => fold(events, { renames: {} });
  return { io, events, calls, b, run: opts => reconcile({ io, m, ...opts }) };
}

const started = (calls, role) => calls.specs.filter(s => s.role === role).map(s => s.key ?? 'planner');

test('2026-09-26: idle dirty worktrees no longer hold every todo story; they are named instead', () => {
  const w = world({
    rows: [row('MARXY-1', 'apps/desktop/src/a.ts'), row('MARXY-2', 'packages/core/src/b'), row('MARXY-195', 'apps/desktop/src/a.ts')],
    worktrees: [{ key: 'MARXY-195', path: '/wt/MARXY-195', branch: 'feat/MARXY-195-x', dirty: true, ahead: 0, lastActivityMs: nowMs - 5 * 3_600_000 }],
  });
  const r = w.run();
  assert.deepEqual(started(w.calls, 'implement').sort(), ['MARXY-1', 'MARXY-2']);
  assert.ok(r.attention.some(a => a.key === 'MARXY-195' && /nothing owns it/.test(a.why)));
  assert.equal(w.b().stories['MARXY-1'].status, 'in_progress');
  assert.equal(w.b().stories['MARXY-1'].attempts, 1);
});

test('a worktree someone is working in right now does hold its paths, for as long as it stays active', () => {
  const rows = [row('MARXY-1', 'apps/desktop/src/a.ts'), row('MARXY-195', 'apps/desktop/src/a.ts')];
  const w = world({ rows, worktrees: [{ key: 'MARXY-195', path: '/wt/195', branch: 'feat/MARXY-195-x', dirty: true, ahead: 0, lastActivityMs: nowMs - 5 * 60_000 }] });
  const r = w.run();
  assert.deepEqual(started(w.calls, 'implement'), []);
  assert.match(r.ready.waits['MARXY-1'], /held by MARXY-195/);
});

test('a finished implement run with a PR moves to review, and the same cycle starts its reviewer', () => {
  const w = world({
    rows: [row('MARXY-1', 'a')],
    stories: { 'MARXY-1': { status: 'in_progress', attempts: 1, run: 'r1', branch: 'feat/MARXY-1-thing' } },
    extraEvents: [{ type: 'run', run: 'r1', at: minutesAgo(30), set: { key: 'MARXY-1', role: 'implement', started: minutesAgo(30), deadline: minutesAgo(-15) } }],
    runObs: { r1: { exit: { outcome: 'exited', code: 0 }, logBytes: 9000 } },
    results: { 'MARXY-1': { status: 'done', pr: 7 } },
    open: [pr(7, 'MARXY-1')],
  });
  w.run();
  const rec = w.b().stories['MARXY-1'];
  assert.equal(rec.status, 'in_review');
  assert.equal(rec.pr, 7);
  assert.deepEqual(started(w.calls, 'review'), ['MARXY-1']);
  assert.ok(w.calls.jira.some(a => a[0] === 'pr' && a[1] === 'MARXY-1'));
});

test('reviewers run in parallel up to reviewLanes, and review load never stops dispatch (amends ADR-0025 §1)', () => {
  const keys = ['MARXY-1', 'MARXY-2', 'MARXY-3', 'MARXY-4', 'MARXY-5', 'MARXY-6'];
  const w = world({
    rows: [...keys.map((k, i) => row(k, `p${i}`)), row('MARXY-9', 'free')],
    stories: Object.fromEntries(keys.map((k, i) => [k, { status: 'in_review', pr: 10 + i, attempts: 1 }])),
    open: keys.map((k, i) => pr(10 + i, k)),
  });
  w.run();
  assert.equal(started(w.calls, 'review').length, T.reviewLanes);
  assert.deepEqual(started(w.calls, 'implement'), ['MARXY-9']);
});

test('a conflicting PR stays in review and gets a resolver; after its tries it is parked and named', () => {
  const dirty = pr(7, 'MARXY-1', { mergeStateStatus: 'DIRTY', mergeable: 'CONFLICTING' });
  const w = world({ rows: [row('MARXY-1', 'a')], stories: { 'MARXY-1': { status: 'in_review', pr: 7, attempts: 1 } }, open: [dirty] });
  w.run();
  assert.deepEqual(started(w.calls, 'resolve'), ['MARXY-1']);
  assert.equal(w.b().stories['MARXY-1'].status, 'in_review');
  const spent = world({ rows: [row('MARXY-1', 'a')], stories: { 'MARXY-1': { status: 'in_review', pr: 7, attempts: 1, resolveTries: T.resolveTries } }, open: [dirty] });
  const r = spent.run();
  assert.equal(spent.b().stories['MARXY-1'].status, 'blocked');
  assert.match(spent.b().stories['MARXY-1'].parkedReason, /still conflicts/);
  assert.equal(started(spent.calls, 'resolve').length, 0);
  assert.ok(r.lines.some(l => /parked/.test(l)));
});

test('red CI is waited on for its grace period, then returned to the implementor with notes; the same head is not re-adopted', () => {
  const red = pr(7, 'MARXY-1', { statusCheckRollup: [{ name: 'ci', conclusion: 'FAILURE' }] });
  const young = world({ rows: [row('MARXY-1', 'a')], stories: { 'MARXY-1': { status: 'in_review', pr: 7, attempts: 1 } }, open: [red] });
  young.run();
  assert.equal(young.b().stories['MARXY-1'].status, 'in_review');
  assert.equal(young.b().stories['MARXY-1'].hold.class, 'red');
  const old = world({
    rows: [row('MARXY-1', 'a')],
    stories: { 'MARXY-1': { status: 'in_review', pr: 7, attempts: 1, hold: { class: 'red', reason: 'red: ci', since: minutesAgo(T.redGraceMinutes + 1) } } },
    open: [red],
  });
  old.run();
  const rec = old.b().stories['MARXY-1'];
  // Returned, then dispatched again in the same cycle: the story is not left waiting for anyone.
  assert.equal(rec.returned.head, HEAD);
  assert.match(old.calls.notes[0][1], /red: ci/);
  assert.deepEqual(started(old.calls, 'implement'), ['MARXY-1']);
  assert.equal(rec.status, 'in_progress');
});

test('a returned PR with no new push is not adopted back; a new head is (MARXY-217)', () => {
  const stories = { 'MARXY-1': { status: 'todo', attempts: 1, pr: 7, returned: { at: minutesAgo(5), head: HEAD, why: 'red' } } };
  const rows = [row('MARXY-1', 'a', { Labels: 'ops,no-dispatch' })];
  const same = world({ rows, stories, open: [pr(7, 'MARXY-1')] });
  same.run();
  assert.equal(same.b().stories['MARXY-1'].status, 'todo');
  const pushed = world({ rows, stories, open: [pr(7, 'MARXY-1', { headRefOid: 'b'.repeat(40) })] });
  pushed.run();
  assert.equal(pushed.b().stories['MARXY-1'].status, 'in_review');
});

test('a CODEOWNERS hold is named at once as a gate item, and holds nothing else', () => {
  const w = world({
    rows: [row('MARXY-1', 'orchestration/cycle.mjs'), row('MARXY-2', 'packages/x')],
    stories: { 'MARXY-1': { status: 'in_review', pr: 7, attempts: 1 } },
    open: [pr(7, 'MARXY-1', { reviewDecision: 'REVIEW_REQUIRED' })],
    facts: { 'MARXY-1': { approval: approved } },
  });
  const r = w.run();
  assert.ok(r.attention.some(a => a.key === 'MARXY-1' && a.gate));
  assert.deepEqual(started(w.calls, 'implement'), ['MARXY-2']);
});

test('a PR with no board row anywhere is named at once with the command that fixes it', () => {
  const w = world({ rows: [], stories: {}, open: [pr(9, 'MARXY-77')], facts: { 'MARXY-77': { row: null } } });
  const r = w.run();
  assert.equal(w.b().stories['MARXY-77'].status, 'in_review');
  assert.ok(r.attention.some(a => a.key === 'MARXY-77' && /out-of-plan\.mjs row/.test(a.why)));
});

test('an approved, green PR merges pinned to its head and is recorded done', () => {
  const w = world({ rows: [row('MARXY-1', 'a')], stories: { 'MARXY-1': { status: 'in_review', pr: 7, attempts: 1 } }, open: [pr(7, 'MARXY-1')], facts: { 'MARXY-1': { approval: approved } } });
  w.run();
  const merge = w.calls.gh.find(a => a[0] === 'pr' && a[1] === 'merge');
  assert.ok(merge.includes('--match-head-commit') && merge.includes(HEAD));
  assert.equal(w.b().stories['MARXY-1'].status, 'done');
  assert.equal(w.b().merges, 1);
});

test('approved but CI pending enables auto-merge once; --no-merge and --dry-run never merge', () => {
  const pending = pr(7, 'MARXY-1', { statusCheckRollup: [{ name: 'ci', status: 'IN_PROGRESS' }] });
  const mk = () => world({ rows: [row('MARXY-1', 'a')], stories: { 'MARXY-1': { status: 'in_review', pr: 7, attempts: 1 } }, open: [pending], facts: { 'MARXY-1': { approval: approved } } });
  const w = mk();
  w.run();
  assert.ok(w.calls.gh.some(a => a[1] === 'merge' && a.includes('--auto')));
  const quiet = mk();
  quiet.run({ noMerge: true });
  assert.equal(quiet.calls.gh.length, 0);
  const dry = mk();
  dry.run({ dry: true });
  assert.equal(dry.calls.gh.length + dry.calls.spawn.length + dry.calls.jira.length, 0);
});

test('one BEHIND branch is updated per cycle, in review order; with mergeQueue on, none are', () => {
  const behind = n => pr(n, `MARXY-${n}`, { mergeStateStatus: 'BEHIND' });
  const stories = { 'MARXY-1': { status: 'in_review', pr: 1, attempts: 1 }, 'MARXY-2': { status: 'in_review', pr: 2, attempts: 1 } };
  const facts = { 'MARXY-1': { approval: approved }, 'MARXY-2': { approval: approved } };
  const w = world({ rows: [row('MARXY-1', 'a'), row('MARXY-2', 'b')], stories, open: [behind(1), behind(2)], facts });
  w.run();
  assert.equal(w.calls.gh.filter(a => a[1] === 'update-branch').length, 1);
  const q = world({ rows: [row('MARXY-1', 'a'), row('MARXY-2', 'b')], stories, open: [behind(1), behind(2)], facts, m: { ...M, mergeQueue: true } });
  q.run();
  assert.equal(q.calls.gh.filter(a => a[1] === 'update-branch').length, 0);
});

test('a worker alive past its deadline is stopped and its attempt finished as a timeout', () => {
  const w = world({
    rows: [row('MARXY-1', 'a')],
    stories: { 'MARXY-1': { status: 'in_progress', attempts: 1, run: 'r1' } },
    extraEvents: [{ type: 'run', run: 'r1', at: minutesAgo(90), set: { key: 'MARXY-1', role: 'implement', started: minutesAgo(90), deadline: minutesAgo(45) } }],
    runObs: { r1: { alive: true, logBytes: 50_000 } },
    worktrees: [{ key: 'MARXY-1', path: '/wt/1', dirty: true, ahead: 1, lastActivityMs: nowMs - 60 * 60_000 }],
  });
  w.run();
  assert.deepEqual(w.calls.stop, ['r1']);
  assert.equal(w.b().runs.r1.outcome, 'timeout');
  assert.notEqual(w.b().stories['MARXY-1'].run, 'r1');
});

test('a claim past its expiry lapses to todo, and work left behind is named', () => {
  const w = world({
    rows: [row('MARXY-1', 'a')],
    stories: { 'MARXY-1': { status: 'in_progress', attempts: 0, claim: { by: 'a person', until: minutesAgo(1) } } },
    worktrees: [{ key: 'MARXY-1', path: '/wt/1', branch: 'feat/MARXY-1-x', dirty: true, ahead: 0, lastActivityMs: nowMs - 3 * 3_600_000 }],
  });
  const r = w.run();
  assert.ok(r.attention.some(a => a.key === 'MARXY-1' && /claim lapsed/.test(a.why)));
  // Lapsed, then (its worktree idle) dispatched again rather than left waiting.
  assert.deepEqual(started(w.calls, 'implement'), ['MARXY-1']);
});

test('the planner starts when due and off cooldown; a run that ended reads the escalations before it', () => {
  const w = world({ rows: [row('MARXY-1', 'a')], lastPlan: null });
  w.run();
  assert.deepEqual(started(w.calls, 'plan'), ['planner']);
  assert.equal(started(w.calls, 'implement').length, 0, 'never planned holds dispatch');
  const read = world({
    rows: [row('MARXY-1', 'a'), row('MARXY-2', 'b')],
    stories: { 'MARXY-2': { status: 'escalate', attempts: 3, blockedAt: minutesAgo(300) } },
    extraEvents: [{ type: 'board', at: minutesAgo(10), set: { planner: { run: null, started: minutesAgo(200), lastEnded: minutesAgo(10), lastOutcome: 'exited' } } }],
  });
  read.run();
  assert.deepEqual(started(read.calls, 'implement'), ['MARXY-1'], 'an escalation the planner has read no longer holds dispatch');
});

test('Jira is mirrored after everything else, and a missing credential stops only the Jira calls', () => {
  const w = world({ rows: [row('MARXY-1', 'a')] });
  w.io.jira = args => { w.calls.jira.push(args); return { ok: false, code: 3 }; };
  const r = w.run();
  assert.equal(w.calls.jira.length, 1);
  assert.deepEqual(started(w.calls, 'implement'), ['MARXY-1']);
  assert.ok(r.lines.some(l => /not mirrored/.test(l)));
});

test('without cursor-agent nothing is claimed; the cycle names what it would start', () => {
  const w = world({ rows: [row('MARXY-1', 'a')], hasCli: false });
  const r = w.run();
  assert.equal(w.calls.spawn.length, 0);
  assert.equal(w.b().stories['MARXY-1'], undefined);
  assert.ok(r.lines.some(l => /would start implement/.test(l)));
});

test('hold classes and the step each one takes', () => {
  assert.equal(holdClass('pending: ci'), 'wait');
  assert.equal(holdClass('red: ci'), 'red');
  assert.equal(holdClass("files outside the story's paths: x"), 'return');
  assert.equal(holdClass('human review required (CODEOWNERS): a'), 'human');
  assert.equal(holdClass('not reviewed (no results/KEY.approved)'), 'review');
  assert.equal(primaryHold(['pending: ci', 'not reviewed (no results/KEY.approved)', 'no CHANGELOG entry']).class, 'return');
  const base = { rec: {}, pr: pr(1, 'MARXY-1'), t: T, nowMs, dispatchable: true };
  assert.equal(reviewStep({ ...base, decision: { action: 'merge', reasons: [] } }).step, 'merge');
  assert.equal(reviewStep({ ...base, decision: { action: 'hold', reasons: ['no CHANGELOG entry'] } }).step, 'return');
  assert.equal(reviewStep({ ...base, dispatchable: false, decision: { action: 'hold', reasons: ['no CHANGELOG entry'] } }).step, 'attention');
  assert.equal(reviewStep({ ...base, rec: { reviewTries: T.reviewTries }, decision: { action: 'hold', reasons: ['not reviewed (no results/KEY.approved)'] } }).step, 'attention');
  assert.equal(reviewStep({ ...base, rec: { hold: { class: 'other', since: minutesAgo(T.holdAttentionMinutes + 1) } }, decision: { action: 'hold', reasons: ['could not compute the branch diff, so no boundary check ran'] } }).step, 'attention');
  assert.equal(reviewStep({ ...base, activeRun: { role: 'review', deadline: NOW }, decision: { action: 'merge', reasons: [] } }).step, 'wait');
});

test('one story whose facts cannot be read does not stop the cycle: the next PR still merges, and the failure is named', () => {
  const w = world({
    rows: [row('MARXY-1', 'a'), row('MARXY-2', 'b')],
    stories: { 'MARXY-1': { status: 'in_review', pr: 1, attempts: 1 }, 'MARXY-2': { status: 'in_review', pr: 2, attempts: 1 } },
    open: [pr(1, 'MARXY-1'), pr(2, 'MARXY-2')],
    facts: { 'MARXY-2': { approval: approved } },
  });
  const real = w.io.prFacts;
  w.io.prFacts = (key, ...rest) => { if (key === 'MARXY-1') throw new Error('git show timed out'); return real(key, ...rest); };
  const r = w.run();
  assert.equal(w.b().stories['MARXY-2'].status, 'done');
  assert.ok(r.attention.some(a => a.key === 'MARXY-1' && /review step step failed|review step failed/.test(a.why) && /git show timed out/.test(a.why)));
});

test('a result file that breaks its schema holds the merge with the fix named', () => {
  const w = world({
    rows: [row('MARXY-1', 'a')],
    stories: { 'MARXY-1': { status: 'in_review', pr: 1, attempts: 1, hold: { class: 'result', reason: 'x', since: minutesAgo(T.holdAttentionMinutes + 1) } } },
    open: [pr(1, 'MARXY-1')],
    facts: { 'MARXY-1': { approval: approved, resultProblems: ['missing "gates"'] } },
  });
  const r = w.run();
  assert.notEqual(w.b().stories['MARXY-1'].status, 'done');
  assert.ok(r.attention.some(a => /result file problems: missing "gates".*pnpm done MARXY-1/.test(a.why)));
});
