// One resolution attempt for a pull request the cycle returned because it conflicts with main
// (MARXY-217). Adoption will not put that PR back in review while it still conflicts, and
// ready.mjs never offers an in_progress story, so without this the conflict has no owner.
// usage: node conflict-dispatch.mjs KEY
// At most one attempt per cycle. A second cycle does not start another while the lease is held.
// `attempts` is not incremented: a conflict is queue depth, not a failed attempt (ADR-0025).
// After MAX_CONFLICT_TRIES unresolved tries the story is left in progress and named, not started again.
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, here, models, state, updateState } from './lib.mjs';
import { resolveAgentBin } from './dispatch.mjs';
import { prConflicts } from './adopt.mjs';
import { findWorktree } from './reap.mjs';
import { leaseHeld, newLease, readLease, spawnDetached } from './lease.mjs';

export const MAX_CONFLICT_TRIES = 3;

export function conflictLeasePath(key) {
  return here(`results/${key}.conflict.lease`);
}

export function conflictLogPath(key) {
  return here(`results/${key}.conflict.log`);
}

/** Record one resolution try. Does not touch `attempts`. */
export function noteConflictTry(rec) {
  rec.conflictTries = (rec.conflictTries ?? 0) + 1;
  return rec;
}

/**
 * The one in_progress story whose open PR still conflicts and has tries left.
 * Oldest PR number first. A held lease is skipped, not counted as exhausted.
 */
export function chooseConflict({ stories = {}, openByNumber = new Map(), held = () => false } = {}) {
  const ready = [];
  const exhausted = [];
  for (const [key, rec] of Object.entries(stories)) {
    if (rec?.status !== 'in_progress' || !(Number(rec.pr) > 0)) continue;
    const pr = openByNumber.get(Number(rec.pr));
    if (!pr || !prConflicts(pr)) continue;
    if ((rec.conflictTries ?? 0) >= MAX_CONFLICT_TRIES) { exhausted.push(key); continue; }
    if (held(key)) continue;
    ready.push({ key, pr: Number(rec.pr) });
  }
  ready.sort((a, b) => a.pr - b.pr);
  const first = ready[0];
  if (!first) {
    return {
      key: null,
      why: exhausted.length
        ? `${exhausted.join(', ')} still conflicts after ${MAX_CONFLICT_TRIES} tries; left in progress`
        : 'no conflicting pull request in progress',
      exhausted,
    };
  }
  return { key: first.key, pr: first.pr, why: `PR #${first.pr} conflicts with main`, exhausted };
}

/** Whether this cycle should spawn. Dry-run and a missing CLI only name the key. */
export function planConflictDispatch({ stories = {}, openPrs = [], hasCli = false, dry = false, held = () => false } = {}) {
  const openByNumber = openPrs instanceof Map ? openPrs : new Map((openPrs ?? []).map(pr => [pr.number, pr]));
  const choice = chooseConflict({ stories, openByNumber, held });
  return { ...choice, spawn: Boolean(choice.key && hasCli && !dry) };
}

export function conflictPrompt(prompt, key) {
  return `${String(prompt).trimEnd()}

Resolve the conflict on ${key} only. Where this prompt says the branch, it is the one checked out in this worktree.
`;
}

export function conflictSpawnArgs({ m = models(), bin = resolveAgentBin(), prompt = '', key }) {
  const role = m.implementor;
  const args = ['-p', '--force', '--model', role.model, '--output-format', 'text'];
  if (m.cliEffortFlag && role.effort) args.push(m.cliEffortFlag, role.effort);
  args.push(conflictPrompt(prompt, key));
  return { bin, args };
}

/**
 * Spawn a detached worker unless its lease is held. Increments `conflictTries` only, never `attempts`.
 */
export function launchConflict(key, {
  m = models(),
  leasePath = conflictLeasePath(key),
  logPath = conflictLogPath(key),
  spawn = spawnDetached,
  held = leaseHeld,
  now = () => new Date(),
} = {}) {
  const lease = readLease(leasePath);
  if (held(lease) === true) {
    console.log(`${key}: conflict resolver already running (pid ${lease.pid} since ${lease.started}); not started again`);
    return { skipped: true, key };
  }
  const before = state().stories[key]?.attempts;
  updateState(s => {
    const rec = s.stories[key];
    if (rec) noteConflictTry(rec);
  });
  const match = `--conflict ${key}`;
  const pid = spawn(process.execPath, [here('conflict-dispatch.mjs'), '--worker', key], {
    cwd: ROOT,
    log: logPath,
    env: { ...process.env, MARXY_COMPUTE: m.compute },
  });
  if (!pid) {
    console.log(`${key}: conflict resolver could not start`);
    return { skipped: true, key };
  }
  mkdirSync(dirname(leasePath), { recursive: true });
  writeFileSync(leasePath, JSON.stringify(newLease(pid, match, now())) + '\n');
  const attempts = state().stories[key]?.attempts;
  console.log(`${key}: conflict resolver started, pid ${pid}, log ${logPath}`);
  if (before != null && attempts !== before) console.log(`${key}: attempts changed (${before} → ${attempts}), which a conflict try must not do`);
  return { pid, key };
}

/** Merge origin/main in the story's worktree. A clean merge is pushed; conflicts go to the agent. */
export async function workConflict(key, {
  m = models(),
  root = ROOT,
  bin,
  prompt = readFileSync(here('prompts/conflict.md'), 'utf8'),
} = {}) {
  const rec = state().stories[key] ?? {};
  const wt = findWorktree(key, rec, { root });
  if (!wt) {
    console.error(`${key}: no worktree to resolve PR #${rec.pr ?? '?'} in`);
    return { code: 1 };
  }
  const git = args => spawnSync('git', args, { cwd: wt, encoding: 'utf8' });
  git(['fetch', '-q', 'origin']);
  const merge = git(['merge', '--no-edit', 'origin/main']);
  if (merge.status === 0) {
    const push = git(['push']);
    console.log(`${key}: merged origin/main cleanly; push exit ${push.status}`);
    return { code: push.status ?? 1 };
  }
  const { bin: cmd, args } = conflictSpawnArgs({ m, prompt, key, ...(bin ? { bin } : {}) });
  const child = spawn(cmd, args, { cwd: wt, stdio: ['ignore', 'pipe', 'pipe'] });
  const take = d => { process.stdout.write(d); };
  child.stdout.on('data', take);
  child.stderr.on('data', take);
  const timer = setTimeout(() => child.kill('SIGTERM'), (m.attemptMinutes ?? 45) * 60_000);
  let code;
  try {
    code = await new Promise((resolvePromise, reject) => {
      child.on('error', reject);
      child.on('exit', resolvePromise);
    });
  } finally {
    clearTimeout(timer);
  }
  console.log(`${key}: conflict resolver exit ${code}`);
  return { code };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const workerAt = process.argv.indexOf('--worker');
  if (workerAt >= 0) {
    await workConflict(process.argv[workerAt + 1]);
  } else {
    const key = process.argv[2];
    if (!/^MARXY-\d+$/.test(key ?? '')) {
      console.error('usage: conflict-dispatch.mjs KEY');
      process.exit(2);
    }
    launchConflict(key);
  }
}
