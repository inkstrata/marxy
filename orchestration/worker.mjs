// One worker run, any role: implement, review, resolve (a merge conflict), plan (ADR-0034).
// usage: node orchestration/worker.mjs --run <run-id>
//
// The reconciler writes runs/<id>/run.json (what to do, where, with which model, the full prompt and
// the deadline), appends the event that claims the story for this run, and starts this detached in
// its own session. The worker prepares the worktree, runs the agent in the agent's own process group
// with its output streaming to runs/<id>/out.log, and writes runs/<id>/exit.json when it ends. It
// never touches the board: the reconciler reads exit.json and decides what the run meant.
//
// Every way a run can end is bounded and recorded:
//   exited   the agent finished (its code is recorded)
//   timeout  the deadline passed (attemptMinutes); the agent's whole process group is stopped
//   stalled  no output for stallMinutes; stopped the same way. stream-json prints every tool call,
//            so silence that long is a hung agent, not a thinking one
//   setup    the worktree or install failed before the agent started (bounded by proc.mjs limits)
//   auth     the CLI could not authenticate; not the story's fault, and the attempt is refunded
import { spawn } from 'node:child_process';
import { closeSync, existsSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { git, run as runSync, LIMIT, stopGroup } from './proc.mjs';
import { runFile, resultPath, writeJsonAtomic, readJsonOr, fleetPath, repoHome } from './store.mjs';
import { OUTCOME } from './outcomes.mjs';
import { board } from './machine.mjs';

export const AUTH_FAILURE = /Authentication required|agent login|CURSOR_API_KEY/i;
const POLL_MS = 15_000;

/** The agent CLI argv for a run spec. Exported so a test can check it without running anything. */
export function agentArgs(spec) {
  const args = ['-p', '--force', '--trust', '--output-format', 'stream-json', '--model', spec.model];
  if (spec.cliEffortFlag && spec.effort) args.push(spec.cliEffortFlag, spec.effort);
  args.push(spec.prompt);
  return args;
}

/**
 * Snapshot a worktree's uncommitted work to `refs/fleet/wip/KEY/<stamp>` before an attempt reuses it.
 * `git stash create` writes a commit without touching refs/stash, which is shared by every worktree of
 * the clone; the ref keeps it reachable. Nothing in the worktree changes.
 */
export function snapshotWip(wt, key, { now = new Date(), g = (args, opts) => git(args, { cwd: wt, ...opts }) } = {}) {
  const status = g(['status', '--porcelain']);
  if (!status.ok || !status.out) return null;
  // Unsigned: a headless worker must never stop on a signing key's passphrase (MARXY-223 learned it).
  const created = g(['-c', 'commit.gpgsign=false', 'stash', 'create', `fleet: ${key} before a new attempt`]);
  if (!created.ok || !created.out) return null;
  const ref = `refs/fleet/wip/${key}/${now.toISOString().replace(/[-:.]/g, '')}`;
  g(['update-ref', ref, created.out]);
  const patch = g(['diff', 'HEAD']);
  if (patch.ok) writeFileSync(fleetPath('wip', `${key}.${now.toISOString().replace(/[-:.]/g, '')}.patch`), patch.out + '\n');
  return ref;
}

/**
 * Put a reverted story's work back on its fresh branch (ADR-0043): revert the revert that landed on
 * main, or cherry-pick the original commit when that is not known. Unsigned, hookless commits, since a
 * headless worker must never stop on a passphrase. A change that no longer applies is abandoned whole
 * and reported, so the agent starts from main and is told where the earlier work is.
 */
export function reapplyWork(wt, reopened, { g = (args, opts) => git(args, { cwd: wt, ...opts }) } = {}) {
  const quiet = ['-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null'];
  const attempts = [
    reopened?.revertSha && { how: 'revert', undo: 'revert', args: [...quiet, 'revert', '--no-edit', reopened.revertSha] },
    reopened?.sha && { how: 'cherry-pick', undo: 'cherry-pick', args: [...quiet, 'cherry-pick', reopened.sha] },
  ].filter(Boolean);
  let why = 'the reverted commit is not known';
  for (const a of attempts) {
    const r = g(a.args);
    if (r.ok) return { how: a.how };
    g([a.undo, '--abort']);
    why = `${a.how} failed: ${(r.err || r.out).split('\n')[0]}`;
  }
  return { how: null, why };
}

/** The sentence a reopened story's prompt gains, saying whether its earlier work is already on the branch. */
export function reapplyNote(reopened, applied) {
  const sha = String(reopened?.sha ?? '').slice(0, 7);
  return applied.how
    ? `\n\n## The earlier work is already on your branch\n\nThis story was merged, then reverted because it turned main red. The reverted change (${sha}) has been applied again on top of current main by \`git ${applied.how}\`; \`git log\` shows it. Fix what the failure above names on top of it. Do not rewrite it from scratch.\n`
    : `\n\n## The earlier work could not be re-applied\n\nThis story was merged, then reverted because it turned main red, and the change (${sha || 'unknown'}) could not be applied again automatically (${applied.why}). Your branch starts from current main. Read the reverted commit with \`git show ${reopened?.sha ?? '<sha>'}\`, bring its work back by hand, and fix what the failure above names.\n`;
}

/**
 * The worktree for an implement or resolve run. An existing one is reused (a second attempt continues
 * the first) after a snapshot; a missing one is cut from the story's branch on origin when it exists,
 * so a returned story keeps its PR's commits, and from origin/main otherwise. A reopened story
 * (`reopened`, ADR-0043) never continues its merged branch: it is cut from main with the reverted work
 * applied again.
 */
export function prepareWorktree(spec, { g = (args, opts) => git(args, { cwd: repoHome(), ...opts }), reopened = null } = {}) {
  const wt = spec.worktree;
  // The cycle and other workers fetch in the same repository; a concurrent fetch holds the ref lock
  // for a moment, and failing setup on it cost a story a try. Once more after a pause is enough.
  let fetch = g(['fetch', '-q', 'origin']);
  if (!fetch.ok && /cannot lock ref|unable to update local ref|\.lock/.test(fetch.err)) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2000);
    fetch = g(['fetch', '-q', 'origin']);
  }
  if (!fetch.ok) return { ok: false, why: `git fetch: ${fetch.err.split('\n')[0]}` };
  if (existsSync(wt)) return { ok: true, wt, snapshot: snapshotWip(wt, spec.key) };
  const remote = g(['rev-parse', '--verify', '-q', `refs/remotes/origin/${spec.branch}`]);
  const local = g(['rev-parse', '--verify', '-q', `refs/heads/${spec.branch}`]);
  const fresh = reopened && !remote.ok;
  const add = fresh
    ? g(['worktree', 'add', '--no-track', '-B', spec.branch, wt, 'origin/main'])
    : remote.ok
    ? g(['worktree', 'add', '--no-track', '-B', spec.branch, wt, `origin/${spec.branch}`])
    : local.ok
      ? g(['worktree', 'add', '--no-track', '-B', spec.branch, wt, spec.branch])
      : g(['worktree', 'add', '--no-track', '-b', spec.branch, wt, 'origin/main']);
  if (!add.ok) return { ok: false, why: `git worktree add: ${add.err.split('\n')[0]}` };
  return fresh ? { ok: true, wt, applied: reapplyWork(wt, reopened) } : { ok: true, wt };
}

/** Ends a run: the record the reconciler reads. Written once, atomically. */
function finish(id, record) {
  writeJsonAtomic(runFile(id, 'exit.json'), { ...record, endedAt: new Date().toISOString() });
}

/** Run the agent under the deadline and the stall watchdog. Resolves with the exit record. */
export async function superviseAgent(spec, { bin = spec.bin ?? 'cursor-agent', cwd, now = () => Date.now(), poll = POLL_MS } = {}) {
  const log = runFile(spec.id, 'out.log');
  const fd = openSync(log, 'a');
  let child;
  try {
    child = spawn(bin, agentArgs(spec), {
      cwd, detached: true, stdio: ['ignore', fd, fd],
      env: { ...process.env, MARXY_RUN: spec.id, MARXY_STORY: spec.key ?? '' },
    });
  } finally {
    closeSync(fd);
  }
  const exited = new Promise(res => {
    child.on('exit', (code, signal) => res({ code, signal }));
    child.on('error', e => res({ code: null, error: String(e.message ?? e) }));
  });
  writeJsonAtomic(runFile(spec.id, 'agent.json'), { pid: child.pid, started: new Date().toISOString() });
  const deadline = Date.parse(spec.deadline);
  const stallMs = spec.stallMinutes * 60_000;
  let lastSize = -1;
  let lastGrowth = now();
  for (;;) {
    const tick = new Promise(res => setTimeout(() => res(null), poll));
    const done = await Promise.race([exited, tick]);
    const size = existsSync(log) ? statSync(log).size : 0;
    if (done) {
      const text = size ? readFileSync(log, 'utf8').slice(-4000) : '';
      const auth = done.code !== 0 && AUTH_FAILURE.test(text);
      return { outcome: auth ? OUTCOME.AUTH : OUTCOME.EXITED, code: done.code, signal: done.signal ?? null, error: done.error, logBytes: size };
    }
    if (size !== lastSize) { lastSize = size; lastGrowth = now(); }
    const why = now() > deadline ? OUTCOME.TIMEOUT : now() - lastGrowth > stallMs ? OUTCOME.STALLED : null;
    if (why) {
      await stopGroup(child.pid);
      await exited;
      return { outcome: why, code: null, logBytes: size };
    }
  }
}

/** One run, start to finish. */
export async function work(id) {
  const spec = readJsonOr(runFile(id, 'run.json'));
  if (!spec) {
    console.error(`worker: no run.json for ${id}`);
    process.exitCode = 2;
    return;
  }
  let cwd = spec.cwd;
  if (spec.role === 'implement' || spec.role === 'resolve') {
    const reopened = spec.role === 'implement' ? board({ write: false }).stories[spec.key]?.reopened ?? null : null;
    const wt = prepareWorktree(spec, { reopened });
    if (!wt.ok) return finish(id, { outcome: OUTCOME.SETUP, why: wt.why });
    cwd = wt.wt;
    if (wt.applied) {
      spec.prompt += reapplyNote(reopened, wt.applied);
      console.log(`${spec.key}: reverted work ${wt.applied.how ? `re-applied by ${wt.applied.how}` : `not re-applied (${wt.applied.why})`}`);
    }
    if (wt.snapshot) console.log(`${spec.key}: uncommitted work snapshotted to ${wt.snapshot}`);
    if (spec.install) {
      const inst = runSync('pnpm', ['install', '--frozen-lockfile', '--silent'], { cwd, timeoutMs: LIMIT.install });
      if (!inst.ok) return finish(id, { outcome: OUTCOME.SETUP, why: `pnpm install ${inst.timedOut ? 'timed out' : 'failed'}: ${inst.err.split('\n').slice(-1)[0]}` });
    }
  }
  // A result left by an earlier attempt would report this one as whatever that was.
  if (spec.role === 'implement') rmSync(resultPath(spec.key), { force: true });
  const record = await superviseAgent(spec, { cwd });
  finish(id, record);
  console.log(`${id}: ${record.outcome}${record.code != null ? ` (exit ${record.code})` : ''}, ${record.logBytes} bytes of output`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const at = process.argv.indexOf('--run');
  const id = at >= 0 ? process.argv[at + 1] : null;
  if (!id) {
    console.error('usage: worker.mjs --run <run-id>');
    process.exit(2);
  }
  await work(id);
}
