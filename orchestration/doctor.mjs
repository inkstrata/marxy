// What is the fleet doing, is anything stuck, and what fixes it (MARXY-208).
// usage: node orchestration/doctor.mjs [--fix] [--json]
//
// The first thing an orchestrator runs when it starts, after a machine wakes, or whenever the board
// looks wrong. It reads everything that can go stale — the loop, the cycle lock, the planner, every
// in-flight story's worker, the orchestrator checkout, and why nothing is ready — and names a
// command for each problem. `--fix` applies only the repairs that cannot lose work: it reaps ghost
// and dead stories (reap.mjs), clears locks whose holder is gone, and refreshes the canvases.
// Anything that needs judgement (a quiet story with work in its worktree) is named, never fixed.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, here, state, stories, models, pathsOf, overlap } from './lib.mjs';
import { leaseHeld, readLease, ageMinutes, LOOP_LEASE, CYCLE_LOCK } from './lease.mjs';
import { survey, runReap, VERDICT } from './reap.mjs';
import { selectReady } from './ready.mjs';
import { plannerGate, PLANNER_LEASE, PLANNER_LOG } from './plan-dispatch.mjs';
import { isAuthFailure } from './dispatch.mjs';

/**
 * Findings from a snapshot of the fleet. Pure, so each rule has a test.
 * Each finding: { level: 'ok' | 'warn' | 'fail', area, msg, fix? } — `fix` is a command to run.
 */
export function diagnose(x) {
  const f = [];
  const add = (level, area, msg, fix) => f.push({ level, area, msg, ...(fix ? { fix } : {}) });

  // The loop. Not running is a choice, not a fault; a lease left by a dead loop is a fault.
  if (x.loop.held === true) add('ok', 'loop', `running, pid ${x.loop.lease.pid} since ${x.loop.lease.started}`);
  else if (x.loop.lease) add('warn', 'loop', `not running; its lease (pid ${x.loop.lease.pid}) outlived it`, './orchestration/loop.sh start');
  else add('warn', 'loop', 'not running — nothing merges or dispatches until a cycle runs', './orchestration/loop.sh start');
  if (x.statusAgeMinutes != null && x.loop.held === true && x.statusAgeMinutes > x.stuckCycleMinutes) {
    add('fail', 'loop', `running, but status.md is ${Math.round(x.statusAgeMinutes)} min old — a cycle is hung`, 'tail orchestration/results/loop.log; ./orchestration/loop.sh stop && ./orchestration/loop.sh start');
  }

  if (x.cycle.lease && x.cycle.held === false) add('warn', 'cycle', `lock left by a cycle that died (pid ${x.cycle.lease.pid})`, 'node orchestration/doctor.mjs --fix');
  else if (x.cycle.held === true) add('ok', 'cycle', `running now, pid ${x.cycle.lease.pid} since ${x.cycle.lease.started}`);

  if (x.planner.held === true) add('ok', 'planner', `running, pid ${x.planner.lease.pid} since ${x.planner.lease.started}`);
  else if (x.planner.authFailure) add('fail', 'planner', 'the last headless planner could not authenticate', 'cursor-agent login');
  else if (x.planner.gate && !x.planner.gate.run) add('ok', 'planner', x.planner.gate.why);

  // The orchestrator checkout must be main and level with origin/main, or the board it reads lies.
  if (x.main.branch !== 'main') add('fail', 'checkout', `the orchestrator checkout is on ${x.main.branch}, not main`, `git -C ${ROOT} switch main`);
  else if (x.main.behind > 0 && x.main.ahead > 0) add('fail', 'checkout', `main has diverged from origin/main (${x.main.ahead} ahead, ${x.main.behind} behind)`, `git -C ${ROOT} pull --rebase`);
  else if (x.main.behind > 0) add('warn', 'checkout', `main is ${x.main.behind} behind origin/main; the next cycle fast-forwards it`);
  else if (x.main.ahead > 0) add('warn', 'checkout', `main has ${x.main.ahead} local commit(s) not on origin/main`, `git -C ${ROOT} log --oneline origin/main..main`);

  for (const r of x.inflight) {
    if (r.verdict === VERDICT.LIVE) add('ok', r.key, `in progress — ${r.why}`);
    else if (r.verdict === VERDICT.QUIET) add('fail', r.key, r.why, `git -C ${ROOT}${r.rec?.worktree ?? '../marxy-wt/' + r.key} log --oneline origin/main..; then node orchestration/state.mjs return ${r.key} or finish it`);
    else add('fail', r.key, `${r.verdict}: ${r.why}`, 'node orchestration/doctor.mjs --fix');
  }
  for (const k of x.parked) add('warn', k.key, `blocked — ${k.reason}`);

  // Why nothing starts. Todo work with an empty ready list is either honest waiting or a jam.
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
  return f;
}

const git = a => { try { return execFileSync('git', ['-C', ROOT, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; } };

/** The live snapshot diagnose() reads. */
export function snapshot({ m = models(), board = state(), nowMs = Date.now() } = {}) {
  const lease = path => { const l = readLease(path); return { lease: l, held: leaseHeld(l) }; };
  const planner = lease(PLANNER_LEASE);
  planner.authFailure = planner.held === false && existsSync(PLANNER_LOG)
    && isAuthFailure({ code: 1, log: readFileSync(PLANNER_LOG), resultExists: false });
  planner.gate = plannerGate({ lease: planner.lease, held: planner.held, nowMs, cooldownMinutes: m.plannerCooldownMinutes ?? 240 });
  const all = stories();
  const statusOf = k => board.stories[k]?.status ?? 'todo';
  const ready = selectReady({ all, s: board });
  const busy = all.filter(st => ['in_progress', 'in_review'].includes(statusOf(st.Key)));
  const holders = {};
  for (const k of ready.blockedByPaths) {
    const st = all.find(x => x.Key === k);
    const by = busy.filter(b => overlap(pathsOf(st), pathsOf(b))).map(b => `${b.Key} (${statusOf(b.Key)})`);
    if (by.length) holders[k] = by;
  }
  const statusPath = here('status.md');
  const counts = (git(['rev-list', '--left-right', '--count', 'main...origin/main']) ?? '0 0').split(/\s+/).map(Number);
  const needsHuman = existsSync(here('needs-human.md'))
    ? readFileSync(here('needs-human.md'), 'utf8').split('\n').filter(l => l.startsWith('- [ ]')).length : 0;
  return {
    loop: lease(LOOP_LEASE),
    cycle: lease(CYCLE_LOCK),
    planner,
    statusAgeMinutes: existsSync(statusPath) ? ageMinutes(new Date(statSync(statusPath).mtimeMs).toISOString(), nowMs) : null,
    // A cycle that blocks longer than this is hung: dispatch no longer waits on implementors.
    stuckCycleMinutes: m.stuckCycleMinutes ?? 30,
    main: { branch: git(['branch', '--show-current']), ahead: counts[0] || 0, behind: counts[1] || 0 },
    inflight: survey({ board, m, nowMs }),
    parked: Object.entries(board.stories ?? {}).filter(([, r]) => r.status === 'blocked' && r.reaps).map(([key, r]) => ({ key, reason: r.parkedReason ?? 'reaped' })),
    ready,
    todo: all.filter(st => statusOf(st.Key) === 'todo').length,
    holders,
    needsHuman,
  };
}

/** The repairs that cannot lose work. Returns what it did. */
export function fix(x, { say = console.log } = {}) {
  const done = [];
  if (x.inflight.some(r => r.verdict === VERDICT.GHOST || r.verdict === VERDICT.DEAD)) {
    runReap({ apply: true, say });
    done.push('reaped');
  }
  for (const [name, l, path] of [['loop lease', x.loop, LOOP_LEASE], ['cycle lock', x.cycle, CYCLE_LOCK]]) {
    if (l.lease && l.held === false) {
      rmSync(path, { force: true });
      say(`fix: removed the ${name} of dead pid ${l.lease.pid}`);
      done.push(name);
    }
  }
  return done;
}

async function refreshCanvases(say) {
  const { defaultCanvasDir, gatherCanvasData, writeCanvases } = await import('./canvases.mjs');
  const dir = defaultCanvasDir();
  if (!existsSync(dir)) return;
  try {
    writeCanvases(gatherCanvasData(), dir);
    say(`fix: canvases refreshed in ${dir}`);
  } catch (e) {
    say(`fix: canvases not refreshed — ${String(e.message ?? e).split('\n')[0]}`);
  }
}

const MARK = { ok: '✓', warn: '!', fail: '✗' };

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const argv = process.argv.slice(2);
  let x = snapshot();
  if (argv.includes('--fix')) {
    fix(x);
    await refreshCanvases(console.log);
    x = snapshot();
  }
  const findings = diagnose(x);
  if (argv.includes('--json')) console.log(JSON.stringify(findings, null, 2));
  else {
    for (const g of findings) console.log(`${MARK[g.level]} ${g.area}: ${g.msg}${g.fix ? `\n    → ${g.fix}` : ''}`);
    const bad = findings.filter(g => g.level === 'fail').length;
    console.log(bad ? `\n${bad} problem(s). \`node orchestration/doctor.mjs --fix\` applies the safe repairs.` : '\nhealthy.');
  }
  process.exitCode = findings.some(g => g.level === 'fail') ? 1 : 0;
}
