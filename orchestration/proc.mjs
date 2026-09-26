// Every subprocess the fleet starts has a time limit, and every long one runs in its own process
// group so a timeout stops the whole tree, not only the child it spawned (ADR-0034).
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { closeSync, mkdirSync, openSync } from 'node:fs';
import { dirname } from 'node:path';

/** Default ceilings, in milliseconds. A call that needs longer says so. */
export const LIMIT = { git: 60_000, gh: 90_000, jira: 60_000, install: 15 * 60_000, quick: 15_000 };

/**
 * Run to completion with a ceiling. Returns `{ ok, out, err, code, timedOut }` and never throws, so a
 * hung `gh` or `git fetch` costs one cycle a bounded wait instead of the loop.
 */
export function run(cmd, args, { cwd, timeoutMs = LIMIT.git, env, input } = {}) {
  const r = spawnSync(cmd, args, {
    cwd, env, input, encoding: 'utf8', timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: 64 << 20,
  });
  const timedOut = r.error?.code === 'ETIMEDOUT';
  return {
    ok: r.status === 0 && !r.error,
    out: (r.stdout ?? '').trim(),
    err: (r.stderr ?? '').trim() || (r.error ? String(r.error.message) : ''),
    code: r.status,
    timedOut,
  };
}

/** `run`, reduced to its output or null. For reads where failure just means "unknown". */
export function read(cmd, args, opts) {
  const r = run(cmd, args, opts);
  return r.ok ? r.out : null;
}

export const git = (args, opts = {}) => run('git', args, { timeoutMs: LIMIT.git, ...opts });
export const gh = (args, opts = {}) => run('gh', args, { timeoutMs: LIMIT.gh, ...opts });

export function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

/** The full command line of `pid`, or null when ps cannot say. */
export function commandOf(pid) {
  try {
    return execFileSync('ps', ['-ww', '-o', 'command=', '-p', String(pid)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: LIMIT.quick }).trim();
  } catch { return null; }
}

/**
 * Whether the process a run recorded is still that process: alive, and its command line still
 * carries `match` (a recycled pid does not). A live pid whose command cannot be read counts as
 * alive: when in doubt, never reap.
 */
export function stillRunning({ pid, match } = {}, { alive = pidAlive, command = commandOf } = {}) {
  if (!pid) return false;
  if (!alive(pid)) return false;
  const cmd = command(pid);
  if (cmd === null) return true;
  return !match || cmd.includes(match);
}

/**
 * Start a detached process leading its own session and process group, its output appended to `log`.
 * Nothing ties it to the caller. Returns the pid (which is also the group id), or null.
 */
export function spawnDetached(cmd, args, { cwd, log, env = process.env } = {}) {
  mkdirSync(dirname(log), { recursive: true });
  const fd = openSync(log, 'a');
  try {
    const child = spawn(cmd, args, { cwd, env, detached: true, stdio: ['ignore', fd, fd] });
    child.on('error', () => {});
    child.unref();
    return child.pid ?? null;
  } finally {
    closeSync(fd);
  }
}

/** Signal a whole process group. True when the group existed. */
export function killGroup(pgid, signal = 'SIGTERM', kill = process.kill.bind(process)) {
  if (!Number.isInteger(pgid) || pgid <= 0) return false;
  try { kill(-pgid, signal); return true; } catch { return false; }
}

/** TERM the group, then KILL it after `graceMs` if anything is left. */
export async function stopGroup(pgid, { graceMs = 10_000 } = {}) {
  if (!killGroup(pgid, 'SIGTERM')) return false;
  const until = Date.now() + graceMs;
  while (Date.now() < until) {
    await new Promise(r => setTimeout(r, 250));
    if (!killGroup(pgid, 0)) return true;
  }
  killGroup(pgid, 'SIGKILL');
  return true;
}
