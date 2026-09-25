// Reclaim in_progress stories whose worker is gone (MARXY-208).
// usage: node orchestration/reap.mjs [--apply] [--json]
//
// in_progress reserves a story's paths, and until this existed only the worker that set it could
// clear it. On 2026-09-23 five workers were killed with the shell that launched them; their rows
// held every todo story's paths for thirty hours. Each in_progress story now gets a verdict:
//
//   live   its lease is held (the worker is running, however long the machine slept), or it has
//          no lease and something happened within staleMinutes
//   ghost  nobody is running it and it left nothing: no commits, a clean worktree, no agent output.
//          The attempt never happened, so it is refunded and the story goes back to todo; the
//          second ghost in a row parks it blocked, because then something in the environment is
//          killing workers and redispatching will not fix it
//   dead   the lease holder is gone but it left work behind: the ordinary return (the attempt
//          counts; the worktree is reused by the next attempt)
//   quiet  no lease, quiet for staleMinutes, but work in the worktree. An in-app subagent leaves
//          no pid to check, so this is named for a person and never reaped by a machine
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, here, state, saveState, models } from './lib.mjs';
import { leaseHeld, ageMinutes, killOrphans } from './lease.mjs';

export const VERDICT = { LIVE: 'live', GHOST: 'ghost', DEAD: 'dead', QUIET: 'quiet' };

/** Minutes of silence after which a story with no lease is presumed abandoned. */
export const staleMinutesOf = m => m.staleMinutes ?? 2 * (m.attemptMinutes ?? 45);

/**
 * facts: { held: true | false | null, ahead, dirty, logBytes, lastActivityMs }.
 * Pure, so every verdict has a test.
 */
export function classify(rec, facts, { nowMs = Date.now(), staleMinutes = 90 } = {}) {
  if (rec?.status !== 'in_progress') return null;
  const left = [
    facts.ahead > 0 && `${facts.ahead} commit(s)`,
    facts.dirty && 'uncommitted changes',
    facts.logBytes > 0 && 'agent output',
  ].filter(Boolean);
  const evidence = left.length > 0;
  const pid = rec.lease?.pid;
  if (facts.held === true) return { verdict: VERDICT.LIVE, why: `worker pid ${pid} running` };
  if (facts.held === false) {
    return evidence
      ? { verdict: VERDICT.DEAD, why: `worker pid ${pid} gone; left ${left.join(', ')}` }
      : { verdict: VERDICT.GHOST, why: `worker pid ${pid} gone; left nothing` };
  }
  const since = Math.max(Date.parse(rec.started ?? '') || 0, facts.lastActivityMs ?? 0);
  const quiet = Math.round(ageMinutes(new Date(since).toISOString(), nowMs));
  if (quiet < staleMinutes) return { verdict: VERDICT.LIVE, why: `no lease; last activity ${quiet} min ago` };
  return evidence
    ? { verdict: VERDICT.QUIET, why: `no lease; quiet ${quiet} min; left ${left.join(', ')} — a person decides` }
    : { verdict: VERDICT.GHOST, why: `no lease; quiet ${quiet} min; left nothing` };
}

/** The board move a verdict makes. Mutates rec; returns the new status, or null for no move. */
export function reapTransition(rec, verdict, { now = new Date().toISOString(), maxAttempts = 2, maxReaps = 2, why = '' } = {}) {
  if (verdict !== VERDICT.GHOST && verdict !== VERDICT.DEAD) return null;
  delete rec.lease;
  rec.reapedAt = now;
  if (why) rec.reapedWhy = why;
  if (verdict === VERDICT.GHOST) {
    rec.attempts = Math.max(0, (rec.attempts ?? 0) - 1);
    rec.reaps = (rec.reaps ?? 0) + 1;
    if (rec.reaps >= maxReaps) {
      rec.status = 'blocked';
      rec.blockedAt = now;
      rec.parkedReason = `dispatch died ${rec.reaps} times before the implementor wrote anything — something is killing workers; run node orchestration/doctor.mjs`;
    } else {
      rec.status = 'todo';
      delete rec.parkedReason;
    }
  } else {
    delete rec.parkedReason;
    rec.status = (rec.attempts ?? 0) >= maxAttempts ? 'escalate' : 'todo';
    if (rec.status === 'escalate') rec.blockedAt = now;
  }
  return rec.status;
}

const git = a => {
  try {
    return execFileSync('git', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
};
const mtime = p => { try { return statSync(p).mtimeMs; } catch { return null; } };

/** What the machine can see of one in_progress story. */
export function gatherFacts(key, rec, { root = ROOT, results = here('results') } = {}) {
  const facts = { held: leaseHeld(rec.lease), ahead: 0, dirty: false, logBytes: 0, lastActivityMs: null };
  const times = [];
  const wt = rec.worktree ? resolve(root, rec.worktree) : null;
  if (wt && existsSync(wt)) {
    // Read before `git status`, which may refresh the index and move its mtime.
    const index = git(['-C', wt, 'rev-parse', '--path-format=absolute', '--git-path', 'index']);
    if (index) times.push(mtime(index));
    facts.ahead = Number(git(['-C', wt, 'rev-list', '--count', 'origin/main..HEAD'])) || 0;
    const status = git(['--no-optional-locks', '-C', wt, 'status', '--porcelain']);
    // An unreadable worktree counts as having work: never reap what cannot be seen.
    facts.dirty = status === null || status.length > 0;
    for (const line of (status ?? '').split('\n').filter(Boolean).slice(0, 200)) {
      times.push(mtime(resolve(wt, line.slice(3).split(' -> ').pop())));
    }
    if (facts.ahead > 0) times.push(Number(git(['-C', wt, 'log', '-1', '--format=%ct'])) * 1000 || null);
  }
  const log = resolve(results, `${key}.log`);
  const started = Date.parse(rec.started ?? '') || 0;
  if (existsSync(log) && (mtime(log) ?? 0) >= started) {
    facts.logBytes = statSync(log).size;
    times.push(mtime(log));
  }
  const known = times.filter(Number.isFinite);
  facts.lastActivityMs = known.length ? Math.max(...known) : null;
  return facts;
}

/** Every in_progress story with its verdict. */
export function survey({ board = state(), m = models(), nowMs = Date.now(), facts = gatherFacts } = {}) {
  const staleMinutes = staleMinutesOf(m);
  return Object.entries(board.stories ?? {})
    .filter(([, rec]) => rec.status === 'in_progress')
    .map(([key, rec]) => ({ key, rec, ...classify(rec, facts(key, rec), { nowMs, staleMinutes }) }));
}

/**
 * Reap every ghost and dead story. `apply: false` only reports. Mirrors each move into Jira the
 * way state.mjs does. Returns the survey, each entry carrying `to` when it moved.
 */
export function runReap({ apply = false, say = console.log, m = models(), jira = defaultJira } = {}) {
  const rows = survey({ m });
  const moved = rows.filter(r => r.verdict === VERDICT.GHOST || r.verdict === VERDICT.DEAD);
  if (apply && moved.length) {
    const board = state();
    const now = new Date().toISOString();
    for (const r of moved) {
      const rec = board.stories[r.key];
      // Re-read under the write: a worker that finished since the survey owns its own row.
      if (rec?.status !== 'in_progress' || rec.lease?.pid !== r.rec.lease?.pid) continue;
      // An agent orphaned by its worker would keep writing into a worktree the next attempt reuses.
      if (killOrphans(rec.lease)) r.why += '; stopped its orphaned agent';
      r.to = reapTransition(rec, r.verdict, { now, maxAttempts: m.maxAttempts ?? 2, why: r.why });
    }
    saveState(board);
    for (const r of moved) if (r.to) jira(r.key, r.to);
  }
  for (const r of rows) {
    if (r.verdict === VERDICT.LIVE) continue;
    const act = r.to ? ` → ${r.to}` : apply ? '' : ' (not applied)';
    say(`reap: ${r.key} ${r.verdict} — ${r.why}${act}`);
  }
  return rows;
}

function defaultJira(key, status) {
  const r = spawnSync(process.execPath, [here('jira.mjs'), 'move', key, status], { encoding: 'utf8' });
  if (r.status !== 0) console.error(`jira: not mirrored. Run: node orchestration/jira.mjs move ${key} ${status}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const json = process.argv.includes('--json');
  const rows = runReap({ apply: process.argv.includes('--apply'), say: json ? () => {} : console.log });
  if (json) console.log(JSON.stringify(rows.map(({ rec, ...r }) => r), null, 2));
  else if (!rows.length) console.log('reap: nothing in progress');
  else if (rows.every(r => r.verdict === VERDICT.LIVE)) console.log(`reap: ${rows.length} in progress, all live`);
}
