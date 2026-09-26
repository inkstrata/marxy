// What is the fleet doing, is anything stuck, and what fixes it (MARXY-208, ADR-0034).
// usage: node orchestration/doctor.mjs [--fix] [--json]
//
// Health for people and for the orchestrator dashboard (`snapshot` / `diagnose`). `--fix` applies
// only repairs that cannot lose work: dead loop and cycle leases are removed, and finished runs
// whose worker is gone are reconciled the same way the cycle would. Judgement calls stay named.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, here, stories, models, pathsOf, overlap, laneBudget } from './lib.mjs';
import { board, commit, timing } from './machine.mjs';
import { leaseHeld, readLease, ageMinutes } from './lease.mjs';
import { observeWorktrees, observeRuns, pathHolds } from './observe.mjs';
import { selectReady } from './ready.mjs';
import { plannerReasons } from './planner-trigger.mjs';
import { planAt } from './plan.mjs';
import { finishRun } from './runs.mjs';
import { fleetDir, fleetPath, loopLeasePath, cycleLockPath, resultPath, runFile, readJsonOr, repoHome } from './store.mjs';
import { run as runFleet } from './fleet.mjs';

export const VERDICT = { LIVE: 'live', GHOST: 'ghost', DEAD: 'dead', QUIET: 'quiet' };

const git = a => {
  try {
    return execFileSync('git', ['-C', repoHome(), ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
};

/** In-flight stories and runs with a liveness verdict for diagnose() and the dashboard. */
export function surveyInflight({ b, runObs, worktrees, t, nowMs = Date.now() }) {
  const staleMin = t.staleMinutes ?? 2 * (t.attemptMinutes ?? 45);
  const wtOf = key => worktrees.find(w => w.key === key);
  const items = [];
  for (const [id, run] of Object.entries(b.runs ?? {})) {
    if (run.ended) continue;
    const obs = runObs[id] ?? { alive: false, logBytes: 0 };
    const key = run.key ?? 'planner';
    if (obs.alive) {
      items.push({ key, verdict: VERDICT.LIVE, why: `${run.role} running until ${run.deadline}`, rec: b.stories[run.key] });
      continue;
    }
    const wt = run.key ? wtOf(run.key) : null;
    const worked = (wt?.ahead ?? 0) > 0 || wt?.dirty || (obs.logBytes ?? 0) > 2048;
    items.push({
      key,
      verdict: worked ? VERDICT.DEAD : VERDICT.GHOST,
      why: `worker gone${worked ? '; left work behind' : '; left nothing'}`,
      rec: b.stories[run.key],
    });
  }
  for (const [key, rec] of Object.entries(b.stories ?? {})) {
    if (rec.status !== 'in_progress' || rec.run) continue;
    const wt = wtOf(key);
    const left = [wt?.ahead > 0 && `${wt.ahead} commit(s)`, wt?.dirty && 'uncommitted changes'].filter(Boolean);
    const since = Math.max(Date.parse(rec.started ?? '') || 0, wt?.lastActivityMs ?? 0);
    const quietMin = Math.round(ageMinutes(new Date(since).toISOString(), nowMs));
    if (Number(rec.pr) > 0) items.push({ key, verdict: VERDICT.LIVE, why: `PR #${rec.pr} is open`, rec });
    else if (quietMin < staleMin) items.push({ key, verdict: VERDICT.LIVE, why: `last activity ${quietMin} min ago`, rec });
    else {
      items.push({
        key,
        verdict: left.length ? VERDICT.QUIET : VERDICT.GHOST,
        why: `no run; quiet ${quietMin} min${left.length ? `; ${left.join(', ')}` : ''}`,
        rec,
      });
    }
  }
  return items;
}

/**
 * Findings from a snapshot. Pure, so each rule has a test.
 * Each finding: { level: 'ok' | 'warn' | 'fail', area, msg, fix? }.
 */
export function diagnose(x) {
  const f = [];
  const add = (level, area, msg, fix) => f.push({ level, area, msg, ...(fix ? { fix } : {}) });

  if (x.loop.held === true) add('ok', 'loop', `running, pid ${x.loop.lease.pid} since ${x.loop.lease.started}`);
  else if (x.loop.lease) add('warn', 'loop', `not running; its lease (pid ${x.loop.lease.pid}) outlived it`, './orchestration/loop.sh start --minimal');
  else add('warn', 'loop', 'not running — nothing merges or dispatches until a cycle runs', './orchestration/loop.sh start --minimal');
  if (x.statusAgeMinutes != null && x.loop.held === true && x.statusAgeMinutes > x.stuckCycleMinutes) {
    add('fail', 'loop', `running, but status.md is ${Math.round(x.statusAgeMinutes)} min old — a cycle is hung`, 'tail orchestration/results/loop.log; ./orchestration/loop.sh stop && ./orchestration/loop.sh start --minimal');
  }

  if (x.cycle.lease && x.cycle.held === false) add('warn', 'cycle', `lock left by a cycle that died (pid ${x.cycle.lease.pid})`, 'node orchestration/doctor.mjs --fix');
  else if (x.cycle.held === true) add('ok', 'cycle', `running now, pid ${x.cycle.lease.pid} since ${x.cycle.lease.started}`);

  if (x.planner.held === true) add('ok', 'planner', `running, pid ${x.planner.lease.pid} since ${x.planner.lease.started}`);
  else if (x.planner.authFailure) add('fail', 'planner', 'the last headless planner could not authenticate', 'cursor-agent login');
  else if (x.planner.gate && !x.planner.gate.run) add('ok', 'planner', x.planner.gate.why);
  else if (x.planner.gate?.run) add('ok', 'planner', `due: ${x.planner.gate.why}`);

  if (x.main.branch !== 'main') add('fail', 'checkout', `the orchestrator checkout is on ${x.main.branch}, not main`, `git -C ${ROOT} switch main`);
  else if (x.main.behind > 0 && x.main.ahead > 0) add('fail', 'checkout', `main has diverged from origin/main (${x.main.ahead} ahead, ${x.main.behind} behind)`, `git -C ${ROOT} pull --rebase`);
  else if (x.main.behind > 0) add('warn', 'checkout', `main is ${x.main.behind} behind origin/main; the next cycle fast-forwards it`);
  else if (x.main.ahead > 0) add('warn', 'checkout', `main has ${x.main.ahead} local commit(s) not on origin/main`, `git -C ${ROOT} log --oneline origin/main..main`);

  for (const r of x.inflight) {
    if (r.verdict === VERDICT.LIVE) add('ok', r.key, `in progress — ${r.why}`);
    else if (r.verdict === VERDICT.QUIET) {
      add('fail', r.key, r.why, `git -C ${ROOT}${r.rec?.worktree ?? '../marxy-wt/' + r.key} log --oneline origin/main..; then node orchestration/fleet.mjs return ${r.key} or finish it`);
    } else add('fail', r.key, `${r.verdict}: ${r.why}`, 'node orchestration/doctor.mjs --fix');
  }
  for (const k of x.parked) add('warn', k.key, `blocked — ${k.reason}`);

  const r = x.ready;
  if (r.ready.length) add('ok', 'ready', `${r.ready.length} ready: ${r.ready.map(s => s.key).join(', ')}`);
  else if (x.todo > 0) {
    const holders = Object.entries(x.holders).map(([k, by]) => `${k} ← ${by.join(', ')}`);
    const dead = x.inflight.filter(i => i.verdict !== VERDICT.LIVE).map(i => i.key);
    const level = dead.length ? 'fail' : 'warn';
    add(level, 'ready', `nothing ready of ${x.todo} todo: ${r.blockedByPaths.length} wait on paths, ${r.blockedByDeps.length} on deps, ${r.blockedByLanes.length} on lanes`
      + (holders.length ? `; paths held: ${holders.join('; ')}` : '')
      + (dead.length ? `; held by stories nobody is running: ${dead.join(', ')}` : ''), dead.length ? 'node orchestration/doctor.mjs --fix' : undefined);
  }
  if (x.needsHuman > 0) add('warn', 'human', `${x.needsHuman} open item(s) in orchestration/needs-human.md`);

  for (const line of x.fleetDoctor ?? []) {
    if (line.startsWith('✗ ')) add('fail', 'fleet', line.slice(2));
  }
  return f;
}

/** The live snapshot diagnose() reads. */
export function snapshot({ m = models(), b = board(), nowMs = Date.now() } = {}) {
  const lease = path => {
    const l = readLease(path);
    return { lease: l, held: leaseHeld(l) };
  };
  const t = timing(m);
  let plan;
  try { plan = planAt('origin/main'); } catch { plan = { rows: stories(), deps: {}, extraAllowed: [] }; }
  const all = plan.rows ?? stories();
  const statusOf = k => b.stories[k]?.status ?? 'todo';
  const worktrees = observeWorktrees();
  const claims = pathHolds({ board: b, plan, worktrees, t, nowMs });
  const ready = selectReady({
    all, s: b, d: plan.deps, cap: laneBudget(m), claims, extraAllowed: plan.extraAllowed ?? [],
  });
  const busy = all.filter(st => ['in_progress', 'in_review'].includes(statusOf(st.Key)));
  const holders = {};
  for (const k of ready.blockedByPaths) {
    const st = all.find(row => row.Key === k);
    if (!st) continue;
    const by = busy.filter(row => overlap(pathsOf(st), pathsOf(row))).map(row => `${row.Key} (${statusOf(row.Key)})`);
    if (by.length) holders[k] = by;
  }
  const runObs = observeRuns(b);
  const plannerRun = b.planner?.run ? b.runs[b.planner.run] : null;
  const plannerObs = b.planner?.run ? runObs[b.planner.run] : null;
  const reasons = plannerReasons({ s: b, m, all, d: plan.deps, now: nowMs });
  const planner = {
    held: Boolean(plannerRun && !plannerRun.ended && plannerObs?.alive),
    lease: b.planner?.started ? { pid: plannerRun?.pid, started: b.planner.started } : null,
    authFailure: b.planner?.lastOutcome === 'auth',
    gate: { run: reasons.length > 0, why: reasons.length ? reasons.join('; ') : 'not due' },
  };
  const statusPath = fleetPath('status.md');
  const counts = (git(['rev-list', '--left-right', '--count', 'main...origin/main']) ?? '0 0').split(/\s+/).map(Number);
  const needsHuman = existsSync(here('needs-human.md'))
    ? readFileSync(here('needs-human.md'), 'utf8').split('\n').filter(l => l.startsWith('- [ ]')).length : 0;
  const fleetDoctor = runFleet('doctor', [], { plan: () => plan }).lines.filter(l => l.startsWith('✗ '));
  return {
    loop: lease(loopLeasePath()),
    cycle: lease(cycleLockPath()),
    planner,
    statusAgeMinutes: existsSync(statusPath) ? ageMinutes(new Date(statSync(statusPath).mtimeMs).toISOString(), nowMs) : null,
    stuckCycleMinutes: m.stuckCycleMinutes ?? 30,
    main: { branch: git(['branch', '--show-current']), ahead: counts[0] || 0, behind: counts[1] || 0 },
    inflight: surveyInflight({ b, runObs, worktrees, t, nowMs }),
    parked: Object.entries(b.stories ?? {}).filter(([, rec]) => rec.status === 'blocked' && rec.parkedReason).map(([key, rec]) => ({ key, reason: rec.parkedReason })),
    ready,
    todo: all.filter(st => statusOf(st.Key) === 'todo').length,
    holders,
    needsHuman,
    fleetDoctor,
  };
}

function logTail(id) {
  const path = runFile(id, 'out.log');
  if (!existsSync(path)) return '';
  const buf = readFileSync(path);
  return (buf.length > 4096 ? buf.subarray(buf.length - 4096) : buf).toString('utf8');
}

/** Repairs that cannot lose work. Returns what it did. */
export function fix(x, { say = console.log, dry = false } = {}) {
  const done = [];
  for (const [name, l, path] of [['loop lease', x.loop, loopLeasePath()], ['cycle lock', x.cycle, cycleLockPath()]]) {
    if (l.lease && l.held === false) {
      if (!dry) rmSync(path, { force: true });
      say(`fix: removed the ${name} of dead pid ${l.lease.pid}`);
      done.push(name);
    }
  }
  let b = board();
  const t = timing(models());
  const nowIso = new Date().toISOString();
  const worktrees = observeWorktrees();
  for (const [id, obs] of Object.entries(observeRuns(b))) {
    if (obs.alive) continue;
    const run = b.runs[id];
    if (!run || run.ended) continue;
    const rec = run.key ? b.stories[run.key] : null;
    const result = run.role === 'implement' && run.key ? readJsonOr(resultPath(run.key)) : null;
    const wt = run.key ? worktrees.find(w => w.key === run.key) : null;
    const out = finishRun({
      id, run, obs, rec, result, t, now: nowIso,
      prOpen: null,
      evidence: { ahead: wt?.ahead ?? 0, dirty: wt?.dirty ?? false },
      logTail: logTail(id),
    });
    if (!dry) commit(out.events);
    for (const line of out.lines) say(`fix: ${line}`);
    done.push(id);
    b = board();
  }
  return done;
}

const MARK = { ok: '✓', warn: '!', fail: '✗' };

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const argv = process.argv.slice(2);
  let x = snapshot();
  if (argv.includes('--fix')) {
    fix(x);
    x = snapshot();
  }
  const findings = diagnose(x);
  if (argv.includes('--json')) console.log(JSON.stringify(findings, null, 2));
  else {
    console.log(`fleet store: ${fleetDir()}`);
    for (const g of findings) console.log(`${MARK[g.level]} ${g.area}: ${g.msg}${g.fix ? `\n    → ${g.fix}` : ''}`);
    const bad = findings.filter(g => g.level === 'fail').length;
    console.log(bad ? `\n${bad} problem(s). \`node orchestration/doctor.mjs --fix\` applies the safe repairs.` : '\nhealthy.');
  }
  process.exitCode = findings.some(g => g.level === 'fail') ? 1 : 0;
}
