// Run implementors headlessly through the Cursor CLI, one worktree per story, in parallel.
// usage: node dispatch.mjs KEY [KEY…] [--wait]   (env CURSOR_AGENT overrides the binary name)
// By default each story runs in a detached worker (`--worker KEY`) holding a lease on its row, and
// this returns at once; `--wait` runs the attempts in this process instead (MARXY-208).
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, openSync, writeSync, closeSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, here, stories, state, saveState, models, slug, typeOf, isPlaceholderKey } from './lib.mjs';
import { leaseHeld, newLease, spawnDetached } from './lease.mjs';

export const AUTH_FAILURE_LOG =
  "Error: Authentication required. Please run 'agent login' first, or set CURSOR_API_KEY environment variable.";

export function isAuthFailure({ code, log, resultExists }) {
  if (code === 0 || resultExists) return false;
  return log.toString('utf8').trim() === AUTH_FAILURE_LOG;
}

export function authFailureBulletPrefix(date = new Date().toISOString().slice(0, 10)) {
  return `- [ ] ${date} — **Headless auth failure:**`;
}

/** Restore attempts and todo status after a headless auth failure; does not persist. */
export function applyAuthFailureToStory(s2, key, attemptsBefore) {
  const r2 = s2.stories[key] ??= { status: 'todo', attempts: 0 };
  r2.attempts = attemptsBefore;
  r2.status = 'todo';
  return r2;
}

export function noteAuthFailure(key, needsHumanPath = here('needs-human.md'), now = new Date()) {
  const date = now.toISOString().slice(0, 10);
  const prefix = authFailureBulletPrefix(date);
  let content = readFileSync(needsHumanPath, 'utf8');
  const lines = content.split('\n');
  const idx = lines.findIndex(l => l.startsWith(prefix));
  const suffix = ' — dispatch as an in-app subagent until credentials are fixed.';
  if (idx >= 0) {
    const keys = [...lines[idx].matchAll(/MARXY-\d+/g)].map(m => m[0]);
    if (!keys.includes(key)) keys.push(key);
    keys.sort((a, b) => {
      const na = Number(a.slice(6));
      const nb = Number(b.slice(6));
      return na - nb || a.localeCompare(b);
    });
    lines[idx] = `${prefix} ${keys.join(', ')}${suffix}`;
    content = lines.join('\n');
  } else {
    const sep = content.endsWith('\n') || !content.length ? '' : '\n';
    content = `${content}${sep}${prefix} ${key}${suffix}\n`;
  }
  writeFileSync(needsHumanPath, content);
}

const jira = a => {
  const r = spawnSync(process.execPath, [here('jira.mjs'), ...a], { encoding: 'utf8' });
  if (r.status !== 0) console.error(`jira: not mirrored. Run: node orchestration/jira.mjs ${a.join(' ')}`);
};

/**
 * Claim a story for one attempt: in_progress, attempts + 1, and a lease naming the process that runs
 * it. The lease is what lets reap.mjs tell a running attempt from one whose worker died (MARXY-208).
 * Pure over `s`; the caller saves.
 */
export function claim(s, key, st, { m, lease }) {
  const rec = s.stories[key] ??= { status: 'todo', attempts: 0 };
  const role = rec.attempts >= m.maxAttempts ? 'implementorEscalation' : 'implementor';
  rec.status = 'in_progress';
  delete rec.parkedReason;
  rec.attempts += 1;
  rec.branch = `${typeOf(st)}/${key}-${slug(st.Summary)}`;
  // Stored relative to the repo root, the form every other script resolves it from.
  rec.worktree = `../marxy-wt/${key}`;
  rec.role = role;
  rec.model = m[role].model;
  rec.started = lease.started;
  rec.lease = lease;
  return rec;
}

/** Whether `rec` is still this process's to finish: a reaped or re-claimed story is not. */
export const owns = (rec, pid = process.pid) => rec?.status === 'in_progress' && rec.lease?.pid === pid;

const storyOf = key => {
  const st = stories().find(x => x.Key === key);
  if (!st) {
    throw new Error(isPlaceholderKey(key)
      ? `${key} is a placeholder key with no Jira issue yet; run node orchestration/jira.mjs sync to give it a real one first`
      : `unknown ${key}`);
  }
  return st;
};

/**
 * Start each story in a detached worker and return at once. The worker is its own session writing to
 * results/KEY.dispatch.log, so the shell, terminal or agent that ran this (or cycle.mjs) can be killed,
 * time out or close without taking the attempt with it — which is exactly how five attempts died on
 * 2026-09-23. The claim is written here, before this returns, so the next cycle sees the story taken.
 */
export function launch(keys, { m = models() } = {}) {
  const sts = keys.map(storyOf);
  mkdirSync(here('results'), { recursive: true });
  const s = state();
  const started = [];
  for (const st of sts) {
    const key = st.Key;
    const cur = s.stories[key];
    // Only a lease whose holder is provably gone may be taken over; anything else is someone's
    // attempt (an in-app subagent has no lease), and node orchestration/reap.mjs judges those.
    if (cur?.status === 'in_progress' && leaseHeld(cur.lease) !== false) {
      const by = cur.lease ? `worker pid ${cur.lease.pid} since ${cur.lease.started}` : `no lease, started ${cur.started}`;
      console.log(`${key}: already in progress (${by}); not started again — node orchestration/reap.mjs judges it`);
      continue;
    }
    const log = here(`results/${key}.dispatch.log`);
    const match = `--worker ${key}`;
    const pid = spawnDetached(process.execPath, [here('dispatch.mjs'), '--worker', key], {
      cwd: ROOT, log, env: { ...process.env, MARXY_COMPUTE: m.compute },
    });
    if (!pid) {
      console.error(`${key}: could not start a worker; see ${log}`);
      continue;
    }
    claim(s, key, st, { m, lease: newLease(pid, match) });
    started.push(key);
    console.log(`${key}: worker pid ${pid}, log ${log}`);
  }
  saveState(s);
  for (const key of started) jira(['move', key, 'in_progress']);
  return started;
}

/**
 * One attempt, from the worker that holds its lease: worktree, install, the agent under the
 * attemptMinutes cap, then the outcome — written only while this process still owns the row.
 */
export async function work(key, { m = models(), waitForClaimMs = 30_000 } = {}) {
  const st = storyOf(key);
  // launch() writes the claim just after spawning this process; wait until it names us.
  const deadline = Date.now() + waitForClaimMs;
  while (!owns(state().stories[key]) && Date.now() < deadline) await new Promise(r => setTimeout(r, 250));
  const rec = state().stories[key];
  if (!owns(rec)) {
    console.error(`${key}: no claim names pid ${process.pid}; nothing to do`);
    return;
  }
  const attemptsBefore = rec.attempts - 1;
  const role = m[rec.role ?? 'implementor'];
  const release = why => {
    const s2 = state();
    const r2 = s2.stories[key];
    if (!owns(r2)) return;
    r2.attempts = attemptsBefore;
    r2.status = 'todo';
    delete r2.lease;
    saveState(s2);
    jira(['move', key, 'todo']);
    console.error(`${key}: ${why}; attempt not charged, back to todo`);
  };
  const resultPath = here(`results/${key}.json`);
  const log = here(`results/${key}.log`);
  let child = null;
  let code;
  const out = [];
  try {
    const bin = process.env.CURSOR_AGENT || 'cursor-agent';
    const tpl = readFileSync(here('prompts/implementor.md'), 'utf8');
    mkdirSync(resolve(ROOT, '../marxy-wt'), { recursive: true });
    const git = a => execFileSync('git', ['-C', ROOT, ...a], { stdio: 'inherit' });
    // Cut from the main that exists on the remote, not from the orchestrator's local main, which can be
    // behind it and carries the orchestrator's uncommitted board edits besides.
    git(['fetch', '-q', 'origin']);
    const { branch } = rec;
    const wt = resolve(ROOT, rec.worktree);
    if (!existsSync(wt)) git(['worktree', 'add', '-B', branch, wt, 'origin/main']);
    execFileSync('pnpm', ['install', '--frozen-lockfile', '--silent'], { cwd: wt, stdio: 'inherit' });
    // A result left by the previous attempt would report this attempt as whatever that one was.
    rmSync(resultPath, { force: true });
    const notes = existsSync(here(`results/${key}.notes.md`))
      ? `\n\n## Reviewer notes from the previous attempt\n\n${readFileSync(here(`results/${key}.notes.md`), 'utf8')}`
      : '';
    const story =
      ['Key', 'Summary', 'Labels', 'Paths', 'Description', 'Acceptance'].map(k => `- **${k}:** ${st[k] || '—'}`).join('\n') +
      notes;
    const prompt =
      tpl.replaceAll('{{STORY}}', story).replaceAll('{{KEY}}', key) +
      `\n\nWrite the result file to ${resultPath} (absolute path; the main worktree, not yours).`;
    const args = ['-p', '--force', '--model', role.model, '--output-format', 'text'];
    if (m.cliEffortFlag && role.effort) args.push(m.cliEffortFlag, role.effort);
    // Streamed as it arrives, so a worker that dies mid-attempt still leaves its output behind.
    const logFd = openSync(log, 'w');
    child = spawn(bin, [...args, prompt], { cwd: wt, stdio: ['ignore', 'pipe', 'pipe'] });
    const take = d => { out.push(d); writeSync(logFd, d); };
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    const timer = setTimeout(() => child.kill('SIGTERM'), m.attemptMinutes * 60_000);
    code = await new Promise((r, reject) => { child.on('error', reject); child.on('exit', r); });
    clearTimeout(timer);
    closeSync(logFd);
  } catch (e) {
    child?.kill('SIGTERM');
    release(`worker failed before the agent finished (${String(e.message ?? e).split('\n')[0]})`);
    return;
  }
  const logBuf = Buffer.concat(out);
  let result = null;
  try {
    result = existsSync(resultPath) ? JSON.parse(readFileSync(resultPath, 'utf8')) : null;
  } catch {
    /* unreadable is failed */
  }
  const resultExists = existsSync(resultPath);
  const s2 = state();
  const r2 = s2.stories[key];
  if (!owns(r2)) {
    console.error(`${key}: the board no longer names this worker (reaped or re-claimed); result ${result?.status ?? 'failed'} not recorded, log ${log}`);
    return;
  }
  delete r2.lease;
  delete r2.reaps;
  if (isAuthFailure({ code, log: logBuf, resultExists })) {
    applyAuthFailureToStory(s2, key, attemptsBefore);
    saveState(s2);
    jira(['move', key, 'todo']);
    noteAuthFailure(key);
    console.log(`${key}: auth failure (not a real attempt), exit ${code}, now ${r2.status}, log ${log}`);
    return;
  }
  // in_review is the only status the cycle reads for merging, and it needs the PR number to read it.
  if (result?.status === 'done' && Number(result.pr) > 0) {
    r2.status = 'in_review';
    r2.pr = Number(result.pr);
    saveState(s2);
    jira(['pr', key, String(r2.pr)]);
  } else if (result?.status === 'blocked') {
    r2.status = 'blocked';
    saveState(s2);
    jira(['move', key, 'blocked']);
  } else {
    r2.status = 'todo';
    saveState(s2);
    jira(['move', key, 'todo']);
  }
  const why = result?.status === 'done' && !(Number(result.pr) > 0) ? ' (result says done but names no PR)' : '';
  console.log(`${key}: exit ${code}, result ${result?.status ?? 'failed'}${why}, now ${r2.status}, log ${log}`);
}

/** In this process, for a caller that wants to wait (and be killed with) the attempts. */
async function runInForeground(keys, { m = models() } = {}) {
  const sts = keys.map(storyOf);
  const s = state();
  for (const st of sts) claim(s, st.Key, st, { m, lease: newLease(process.pid, 'dispatch.mjs') });
  saveState(s);
  for (const st of sts) jira(['move', st.Key, 'in_progress']);
  const settled = await Promise.allSettled(sts.map(st => work(st.Key, { m, waitForClaimMs: 0 })));
  settled.filter(r => r.status === 'rejected').forEach(r => console.error(String(r.reason)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const argv = process.argv.slice(2);
  const keys = argv.filter(a => !a.startsWith('--'));
  if (!keys.length) {
    console.error('usage: dispatch.mjs KEY… [--wait] [--low|--minimal|--high|--compute=NAME]');
    process.exit(2);
  }
  try {
    if (argv.includes('--worker')) await work(keys[0]);
    else if (argv.includes('--wait')) await runInForeground(keys);
    else launch(keys);
  } catch (e) {
    console.error(String(e.message ?? e));
    process.exit(1);
  }
}
